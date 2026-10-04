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
`;

const COLS = ['public_id','loss_type','claim_status','loss_timing','name','phone','zip','page_variant',
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','fbclid',
  'landing_url','referrer','user_agent','ip','seconds_to_submit','is_spam'];

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

async function ping() {
  if (!pool) return 'file';
  await pool.query('SELECT 1');
  return 'postgres';
}

module.exports = { init, findRecent, insertLead, setEmailStatus, setCallback, listLeads, ping };
