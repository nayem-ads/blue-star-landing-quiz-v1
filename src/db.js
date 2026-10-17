'use strict';
// Lead storage. Uses Postgres when DATABASE_URL is set (Railway Postgres).
// Without it (local dev only) leads are appended to data/leads.ndjson.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pool = null;
const FILE = path.join(__dirname, '..', 'data', 'leads.ndjson');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id            BIGSERIAL PRIMARY KEY,
  public_id     UUID NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  loss_type     TEXT NOT NULL,
  claim_status  TEXT NOT NULL,
  loss_timing   TEXT NOT NULL,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  zip           TEXT NOT NULL,
  callback_slot TEXT,
  page_variant  TEXT,
  utm_source    TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  gclid TEXT, gbraid TEXT, wbraid TEXT, fbclid TEXT,
  landing_url   TEXT,
  referrer      TEXT,
  user_agent    TEXT,
  ip            TEXT,
  seconds_to_submit INTEGER,
  is_spam       BOOLEAN NOT NULL DEFAULT false,
  email_status  TEXT,
  email_error   TEXT
);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE leads ALTER COLUMN zip DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN claim_status DROP NOT NULL;
ALTER TABLE leads ALTER COLUMN loss_timing DROP NOT NULL;
CREATE TABLE IF NOT EXISTS partial_leads (
  pid TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'open',
  form TEXT, name TEXT, phone TEXT NOT NULL, address TEXT, zip TEXT,
  loss_type TEXT, claim_status TEXT, loss_timing TEXT, page_variant TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_term TEXT, utm_content TEXT,
  gclid TEXT, gbraid TEXT, wbraid TEXT, fbclid TEXT,
  landing_url TEXT, referrer TEXT, ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS partial_leads_open_idx ON partial_leads (status, updated_at);
CREATE INDEX IF NOT EXISTS partial_leads_phone_idx ON partial_leads (phone);
`;

const COLS = ['public_id','loss_type','claim_status','loss_timing','name','phone','zip','page_variant',
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','fbclid',
  'landing_url','referrer','user_agent','ip','seconds_to_submit','is_spam','source','email','notes','address'];

async function init() {
  if (!process.env.DATABASE_URL) {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    console.warn('[db] DATABASE_URL not set. Using data/leads.ndjson (local dev only).');
    return;
  }
  const { Pool } = require('pg');
  const url = process.env.DATABASE_URL;
  const internal = /\.railway\.internal|localhost|127\.0\.0\.1/.test(url);
  pool = new Pool({
    connectionString: url,
    ssl: process.env.PGSSL === 'disable' || internal ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
  });
  // Retry: on Railway the database can come up a few seconds after the app.
  for (let i = 1; i <= 10; i++) {
    try { await pool.query(SCHEMA); console.log('[db] ready'); return; }
    catch (e) { console.error(`[db] connect attempt ${i} failed: ${e.message}`); await new Promise(r => setTimeout(r, 2000 * i)); }
  }
  throw new Error('Database unreachable after 10 attempts');
}

async function insertLead(lead) {
  const row = { ...lead, public_id: crypto.randomUUID() };
  if (!pool) {
    fs.appendFileSync(FILE, JSON.stringify({ ...row, created_at: new Date().toISOString() }) + '\n');
    return row;
  }
  const vals = COLS.map(c => row[c] ?? null);
  const ph = COLS.map((_, i) => '$' + (i + 1)).join(',');
  const r = await pool.query(`INSERT INTO leads (${COLS.join(',')}) VALUES (${ph}) RETURNING id, public_id, created_at`, vals);
  return { ...row, id: r.rows[0].id, created_at: r.rows[0].created_at };
}

async function setEmailStatus(publicId, status, error) {
  if (!pool) return;
  await pool.query('UPDATE leads SET email_status=$2, email_error=$3 WHERE public_id=$1', [publicId, status, error ? String(error).slice(0, 500) : null]);
}

async function setCallback(publicId, slot) {
  if (!pool) {
    fs.appendFileSync(FILE, JSON.stringify({ callback_for: publicId, slot, at: new Date().toISOString() }) + '\n');
    return { name: '', phone: '' };
  }
  const r = await pool.query('UPDATE leads SET callback_slot=$2 WHERE public_id=$1 RETURNING name, phone, loss_type, zip', [publicId, slot]);
  return r.rows[0] || null;
}

async function listLeads(limit = 5000) {
  if (!pool) {
    if (!fs.existsSync(FILE)) return [];
    return fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(r => r.phone);
  }
  const r = await pool.query('SELECT * FROM leads ORDER BY created_at DESC LIMIT $1', [limit]);
  return r.rows;
}

// Same phone within 30 minutes = the same person submitting twice (double tap, back button).
async function findRecent(phone) {
  if (!pool) return null;
  const r = await pool.query("SELECT public_id FROM leads WHERE phone=$1 AND is_spam=false AND created_at > now() - interval '30 minutes' ORDER BY created_at DESC LIMIT 1", [phone]);
  return r.rows[0] ? r.rows[0].public_id : null;
}

// ---------- unfinished forms (partial leads) ----------
// status: open -> converted (they sent the form) | alerted (team emailed) | alert_failed
const PCOLS = ['form', 'name', 'phone', 'address', 'zip', 'loss_type', 'claim_status', 'loss_timing', 'page_variant',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid',
  'landing_url', 'referrer', 'ip', 'user_agent'];
const PART = new Map(); // file mode only (local dev)

async function upsertPartial(pid, p) {
  if (!pool) {
    const cur = PART.get(pid);
    if (cur && cur.status !== 'open') return;
    PART.set(pid, { ...(cur || { created_at: new Date() }), ...p, pid, status: 'open', updated_at: new Date() });
    return;
  }
  const vals = [pid, ...PCOLS.map(c => p[c] ?? null)];
  const ph = vals.map((_, i) => '$' + (i + 1)).join(',');
  const set = PCOLS.map(c => `${c}=EXCLUDED.${c}`).join(',');
  await pool.query(`INSERT INTO partial_leads (pid,${PCOLS.join(',')}) VALUES (${ph})
    ON CONFLICT (pid) DO UPDATE SET ${set}, updated_at=now() WHERE partial_leads.status='open'`, vals);
}

async function convertPartials(phone) {
  if (!pool) { for (const p of PART.values()) if (p.phone === phone && p.status === 'open') p.status = 'converted'; return; }
  await pool.query("UPDATE partial_leads SET status='converted' WHERE phone=$1 AND status='open'", [phone]);
}

// Open partials untouched for `minutes`. Claims them (status 'alerting') so one alert goes out per partial.
async function claimDuePartials(minutes) {
  const cutoff = Date.now() - minutes * 60000;
  if (!pool) {
    const due = [...PART.values()].filter(p => p.status === 'open' && new Date(p.updated_at).getTime() <= cutoff);
    due.forEach(p => { p.status = 'alerting'; });
    return due;
  }
  const r = await pool.query(`UPDATE partial_leads SET status='alerting' WHERE pid IN (
    SELECT pid FROM partial_leads WHERE status='open' AND updated_at <= now() - make_interval(secs => $1::float8 * 60) ORDER BY updated_at LIMIT 20
  ) RETURNING *`, [minutes]);
  return r.rows;
}

async function setPartialStatus(pid, status) {
  if (!pool) { const p = PART.get(pid); if (p) p.status = status; return; }
  await pool.query('UPDATE partial_leads SET status=$2 WHERE pid=$1', [pid, status]);
}

// Did this phone send a full lead in the last 24 hours?
async function hasLead(phone) {
  if (!pool) {
    if (!fs.existsSync(FILE)) return false;
    const day = Date.now() - 864e5;
    return fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).some(l => { try { const r = JSON.parse(l); return r.phone === phone && !r.is_spam && new Date(r.created_at).getTime() > day; } catch (e) { return false; } });
  }
  const r = await pool.query("SELECT 1 FROM leads WHERE phone=$1 AND is_spam=false AND created_at > now() - interval '24 hours' LIMIT 1", [phone]);
  return r.rowCount > 0;
}

async function listPartials(limit = 5000) {
  if (!pool) return [...PART.values()].sort((x, y) => new Date(y.updated_at) - new Date(x.updated_at));
  const r = await pool.query('SELECT * FROM partial_leads ORDER BY updated_at DESC LIMIT $1', [limit]);
  return r.rows;
}

async function ping() {
  if (!pool) return 'file';
  await pool.query('SELECT 1');
  return 'postgres';
}

module.exports = { init, findRecent, insertLead, setEmailStatus, setCallback, listLeads, ping, upsertPartial, convertPartials, claimDuePartials, setPartialStatus, hasLead, listPartials };
