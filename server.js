'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const db = require('./src/db');
const { validateLead, validatePartial } = require('./src/validate');
const { notifyLead, notifyCallback, notifyPartial } = require('./src/notify');
const capi = require('./src/capi');
const hubspot = require('./src/hubspot');
const s3 = require('./src/s3');

// After a lead is saved: server Lead event to Meta, contact + deal to HubSpot. Never blocks the visitor.
function syncLead(lead) {
  capi.sendLead(lead)
    .then(s => { console.log('[capi]', lead.public_id, s); return db.setSyncStatus(lead.public_id, 'capi_status', s); })
    .catch(e => console.error('[capi]', e.message));
  hubspot.pushLead(lead)
    .then(s => { console.log('[hubspot]', lead.public_id, s); return db.setSyncStatus(lead.public_id, 'hubspot_status', s); })
    .catch(e => console.error('[hubspot]', e.message));
}

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });
  next();
});

// ---------- headline variants: match the ad group with ?loss=fire|smoke|water|denied ----------
const HEADLINES = {
  default: 'Home or business damaged?',
  fire: 'Your fire claim offer looks too low. Get a free second opinion.',
  smoke: 'Insurance says your smoke damage only needs a light clean. Get a second opinion.',
  water: 'Your water damage claim came back low. Get a free second opinion.',
  denied: 'Your claim was denied. That isn’t always the final answer.',
  storm: 'Your storm damage claim came back low. Get a free second opinion.',
  // Meta landing page ads: ?h= repeats the headline of the ad that was clicked. "|" starts the blue half.
  rebuild: 'Estimate too low to rebuild?|Get it checked.',
  calls: 'Adjuster not calling back?|Hand the calls to us.',
  restart: 'Fourth adjuster. Same claim.|Stop starting over.',
  code: 'Rebuilding to today’s code?|Check your estimate first.',
  'smoke-test': 'Smoke claim?|Get it tested before you settle.',
  pipe: 'Burst pipe?|Get your own adjuster first.',
  two: 'Two adjusters.|One works for you.',
  sign: 'Got a number?|Don’t sign yet.',
  own: 'The insurer sends an adjuster.|You can have one too.',
};
const AD_H = { '04': 'rebuild', '07': 'calls', '08': 'restart', '29': 'code', '13': 'smoke-test', '14': 'smoke-test', '21': 'smoke-test', '30': 'pipe', '19': 'two', '20': 'sign', '17': 'own' };
// app.js is versioned by content hash so a deploy can never pair new HTML with a cached old script.
const APP_V = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(PUB, 'app.js'))).digest('hex').slice(0, 10);
const TEMPLATE = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace('src="/app.js"', `src="/app.js?v=${APP_V}"`);
const GTM = (process.env.GTM_ID || 'GTM-5246KXDV').trim();
const gtmHead = /^GTM-[A-Z0-9]+$/.test(GTM)
  ? `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>`
  : '';
const gtmBody = gtmHead ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : '';
// Meta Pixel. Override with META_PIXEL_ID in Railway, or set it to "off" to disable.
const PIXEL = (process.env.META_PIXEL_ID || '2836808853350981').trim();
const pixelOn = /^\d{10,20}$/.test(PIXEL);
const pixelHead = pixelOn
  ? `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq.disablePushState=true;fbq('init','${PIXEL}');fbq('track','PageView');</script>`
  : '';
const pixelBody = pixelOn ? `<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${PIXEL}&ev=PageView&noscript=1"></noscript>` : '';
const ROBOTS = process.env.ALLOW_INDEX === 'true' ? 'index,follow' : 'noindex,follow';

function page(req, robots) {
  // Meta LP campaign ads already carry utm_content=<ad number>, so the headline follows the ad without editing it.
  const adKey = req.query.utm_campaign === 'bsa_lp_zips' ? AD_H[String(req.query.utm_content || '')] : '';
  const key = String(req.query.h || adKey || req.query.loss || '').toLowerCase();
  const variant = HEADLINES[key] ? key : 'default';
  return TEMPLATE
    .replaceAll('{{H1}}', HEADLINES[variant].includes('|') ? HEADLINES[variant].replace(/^(.*)\|(.*)$/, '$1 <span class="hl">$2</span>') : HEADLINES[variant].replace('too low.', '<span class="hl">too low.</span>'))
    .replaceAll('{{VARIANT}}', variant)
    .replaceAll('{{GTM_HEAD}}', gtmHead)
    .replaceAll('{{GTM_BODY}}', gtmBody)
    .replaceAll('{{PIXEL_HEAD}}', pixelHead)
    .replaceAll('{{PIXEL_BODY}}', pixelBody)
    .replaceAll('{{ROBOTS}}', robots || ROBOTS);
}

// ---------- Page B (V5 multi-step) and the 50/50 split at / ----------
// Sticky cookie bs_lp=a|b. ?lp=a or ?lp=b forces a page and resets the cookie. LP_SPLIT_B = percent sent to B (default 50, 0 turns B off).
const B_V = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(PUB, 'b.js'))).digest('hex').slice(0, 10);
const TEMPLATE_B = fs.readFileSync(path.join(__dirname, 'views', 'page-b.html'), 'utf8').replace('src="/b.js"', `src="/b.js?v=${B_V}"`);
const SPLIT_B = Math.max(0, Math.min(100, Number(process.env.LP_SPLIT_B ?? 50)));
const lpCookie = req => (/(?:^|;\s*)bs_lp=([ab])\b/.exec(req.get('cookie') || '') || [])[1];
function pickVariant(req, res) {
  const forced = String(req.query.lp || '').toLowerCase();
  let v = forced === 'a' || forced === 'b' ? forced : lpCookie(req);
  if (v !== 'a' && v !== 'b') v = Math.random() * 100 < SPLIT_B ? 'b' : 'a';
  if (lpCookie(req) !== v) res.append('Set-Cookie', `bs_lp=${v}; Max-Age=7776000; Path=/; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  return v;
}
function pageB(req, robots, ty) {
  return TEMPLATE_B
    .replaceAll('{{GTM_HEAD}}', gtmHead)
    .replaceAll('{{GTM_BODY}}', gtmBody)
    .replaceAll('{{PIXEL_HEAD}}', pixelHead)
    .replaceAll('{{PIXEL_BODY}}', pixelBody)
    .replaceAll('{{ROBOTS}}', robots || ROBOTS)
    .replaceAll('{{TY}}', ty ? 'ty' : '');
}

app.get('/', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', Vary: 'Cookie' });
  if (pickVariant(req, res) === 'b') return res.type('html').send(pageB(req));
  res.type('html').send(page(req));
});
app.get('/index.html', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(page(req));
});

// Real thank you page after a lead is saved. Same page shell; app.js shows the thank you screen and call time picker.
// Page B visitors (cookie bs_lp=b) get the Page B thank you screen with the weekday calendar.
app.get(['/thank-you', '/thank-you/'], (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Cookie' });
  if (lpCookie(req) === 'b' && req.query.lp !== 'a') return res.type('html').send(pageB(req, 'noindex,nofollow', true));
  res.type('html').send(page(req, 'noindex,nofollow').replace(/<title>[^<]*<\/title>/, '<title>Thank you. We have your request | Blue Star Adjusters</title>'));
});

app.use(express.static(PUB, {
  index: false,
  extensions: ['html'],
  setHeaders(res, file) {
    if (/\.(woff2|webp|svg|png|jpg)$/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/\.(js|css)$/.test(file)) res.set('Cache-Control', 'public, max-age=3600');
  },
}));

// ---------- simple in-memory rate limit: 6 submissions per IP per 10 minutes ----------
const hits = new Map();
// Railway's edge sets X-Real-IP. Fall back to the proxy-derived address.
const clientIp = req => String(req.get('x-real-ip') || req.ip || '').slice(0, 64);
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 6;
}

app.post('/api/lead', express.json({ limit: '16kb' }), express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  const b = req.body || {};
  // Plain form post means the page script didn't run: answer with a page, not JSON.
  const plain = !req.is('application/json');
  if (plain && !b.source) b.source = 'contact';
  const reply = (code, json) => plain ? res.redirect(303, json.ok ? '/thanks' : '/#contact') : res.status(code).json(json);
  const ip = clientIp(req);
  if (limited(ip)) return reply(429, { ok: false, error: 'Too many attempts. Please call toll free (888) 971-2524.' });

  const { ok, errors, lead } = validateLead(b);
  if (!ok) return reply(400, { ok: false, errors });

  // Bots: hidden honeypot field filled, or the whole quiz done in under 3 seconds.
  const spam = Boolean(b.company) || (Number(b.elapsed_ms) > 0 && Number(b.elapsed_ms) < 3000);
  lead.is_spam = spam;
  lead.ip = ip;
  lead.user_agent = String(req.get('user-agent') || '').slice(0, 400);

  if (!spam) {
    const dup = await db.findRecent(lead.phone).catch(() => null);
    if (dup) { db.convertPartials(lead.phone).catch(() => {}); return reply(200, { ok: true, id: dup, first_name: lead.name.split(' ')[0], duplicate: true }); }
  }

  let saved;
  try { saved = await db.insertLead(lead); }
  catch (e) {
    console.error('[lead] db insert failed', e.message);
    // Still try to email so the lead is never lost.
    saved = { ...lead, public_id: 'unsaved-' + Date.now() };
  }

  if (!spam) await db.convertPartials(lead.phone).catch(e => console.error('[partial] convert', e.message));
  if (!spam) {
    try {
      const status = await notifyLead(saved).catch(async () => { await new Promise(r => setTimeout(r, 1500)); return notifyLead(saved); });
      await db.setEmailStatus(saved.public_id, status, null).catch(() => {});
    } catch (e) {
      console.error('[lead] email failed', e.message);
      await db.setEmailStatus(saved.public_id, 'failed', e.message).catch(() => {});
    }
  }
  reply(200, { ok: true, id: saved.public_id, first_name: lead.name.split(' ')[0] });
  if (!spam) syncLead(saved);
});

app.post('/api/lead/:id/callback', express.json({ limit: '4kb' }), async (req, res) => {
  const id = String(req.params.id);
  // One or more call times: { slots: [...] } from the multi picker, or { slot } from older pages.
  const b = req.body || {};
  const raw = Array.isArray(b.slots) ? b.slots : (b.slot ? [b.slot] : []);
  const list = [...new Set(raw.map(x => String(x || '').trim().slice(0, 60)).filter(Boolean))].slice(0, 6);
  const slot = list.join('; ').slice(0, 400);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !slot) return res.status(400).json({ ok: false });
  if (limited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    const info = await db.setCallback(id, slot);
    if (!info) return res.status(404).json({ ok: false });
    notifyCallback(info, slot, id).catch(e => console.error('[callback] email failed', e.message));
    hubspot.addCallback(id, slot).catch(e => console.error('[callback] hubspot', e.message));
    res.json({ ok: true });
  } catch (e) {
    console.error('[callback]', e.message);
    res.status(500).json({ ok: false });
  }
});

// Looser limit (40 per 10 minutes) for unfinished forms and Page B follow-up calls (claim status, uploads).
const partialHits = new Map();
function partialLimited(ip) {
  const now = Date.now(), arr = (partialHits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  arr.push(now); partialHits.set(ip, arr);
  if (partialHits.size > 5000) partialHits.clear();
  return arr.length > 40;
}

// ---------- Page B step 3: claim status for a lead saved at step 2 ----------
const { LABELS } = require('./src/validate');
const leadIdOk = id => /^[0-9a-f-]{36}$/i.test(id);
app.post('/api/lead/:id/status', express.json({ limit: '2kb' }), async (req, res) => {
  const id = String(req.params.id), cs = String((req.body || {}).claim_status || '');
  if (!leadIdOk(id) || !LABELS.claim_status[cs]) return res.status(400).json({ ok: false });
  if (partialLimited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    const row = await db.setClaimStatus(id, cs);
    if (!row) return res.status(404).json({ ok: false });
    res.json({ ok: true });
    hubspot.setClaimStatus(row.phone, cs).then(s => console.log('[hubspot] claim status', id, s)).catch(e => console.error('[hubspot] claim status', e.message));
  } catch (e) { console.error('[status]', e.message); res.status(500).json({ ok: false }); }
});

// ---------- Page B step 4: uploads go straight from the browser to the bucket ----------
const UP_MAX_FILES = 10, UP_MAX_TOTAL = 250 * 1024 * 1024;
const UP_EXT = /\.(jpe?g|png|heic|heif|webp|gif|mp4|mov|m4v|3gp|webm|pdf|doc|docx)$/i;
const linkSecret = () => process.env.FILE_LINK_SECRET || process.env.ADMIN_KEY || process.env.S3_SECRET_ACCESS_KEY || '';
const fileToken = key => Buffer.from(key).toString('base64url') + '.' + require('crypto').createHmac('sha256', linkSecret()).update(key).digest('base64url').slice(0, 32);
app.post('/api/lead/:id/uploads', express.json({ limit: '8kb' }), async (req, res) => {
  const id = String(req.params.id);
  const files = Array.isArray((req.body || {}).files) ? req.body.files : [];
  if (!leadIdOk(id) || !files.length) return res.status(400).json({ ok: false });
  if (!s3.configured()) return res.status(503).json({ ok: false, error: 'Uploads are not available right now. Please share them on the call.' });
  if (partialLimited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    if (!(await db.getLead(id))) return res.status(404).json({ ok: false });
    const have = (await db.listFiles(id)).filter(f => f.status !== 'failed');
    const clean = files.map(f => ({ name: String(f.name || '').trim().slice(0, 120), size: Math.floor(Number(f.size) || 0), type: String(f.type || '').slice(0, 100) }));
    if (clean.some(f => !UP_EXT.test(f.name) || f.size < 1)) return res.status(400).json({ ok: false, error: 'Photos, videos, PDF or Word files only.' });
    if (have.length + clean.length > UP_MAX_FILES) return res.status(400).json({ ok: false, error: `Up to ${UP_MAX_FILES} files. Share the rest on the call.` });
    if (have.reduce((a, f) => a + f.size, 0) + clean.reduce((a, f) => a + f.size, 0) > UP_MAX_TOTAL) return res.status(400).json({ ok: false, error: 'That’s over 250 MB in total. Remove a file or share the rest on the call.' });
    const out = [];
    for (const f of clean) {
      const safe = f.name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-');
      f.object_key = `leads/${id}/${require('crypto').randomBytes(4).toString('hex')}-${safe}`;
      f.type = f.type || 'application/octet-stream';
      out.push({ key: f.object_key, ...s3.presignPost(f.object_key, f.type, f.size) });
    }
    await db.addFiles(id, clean);
    res.json({ ok: true, uploads: out });
  } catch (e) { console.error('[uploads]', e.message); res.status(500).json({ ok: false }); }
});
// After the browser finishes: check each file is in the bucket, then a note with links goes on the HubSpot deal.
app.post('/api/lead/:id/uploads/done', express.json({ limit: '8kb' }), async (req, res) => {
  const id = String(req.params.id);
  const keys = Array.isArray((req.body || {}).keys) ? req.body.keys.map(String).slice(0, UP_MAX_FILES) : [];
  if (!leadIdOk(id) || !keys.length || !s3.configured()) return res.status(400).json({ ok: false });
  if (partialLimited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    const mine = (await db.listFiles(id)).filter(f => keys.includes(f.object_key));
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const ok = [];
    for (const f of mine) {
      const size = await s3.headSize(f.object_key).catch(() => null);
      await db.setFileStatus(id, f.object_key, size ? 'uploaded' : 'failed', size);
      if (size) ok.push({ name: f.name, size, url: `${base}/f/${fileToken(f.object_key)}` });
    }
    res.json({ ok: true, saved: ok.length });
    if (ok.length) hubspot.addFilesNote(id, ok).then(s => console.log('[hubspot] files', id, s)).catch(e => console.error('[hubspot] files', e.message));
  } catch (e) { console.error('[uploads done]', e.message); res.status(500).json({ ok: false }); }
});
// File link used in the HubSpot note: checks the signed token, then sends a 1 hour download link from the bucket.
app.get('/f/:token', (req, res) => {
  const [k64] = String(req.params.token).split('.');
  let key = ''; try { key = Buffer.from(k64 || '', 'base64url').toString(); } catch (e) {}
  const a = Buffer.from(String(req.params.token)), b = Buffer.from(key ? fileToken(key) : '');
  if (!linkSecret() || !key.startsWith('leads/') || a.length !== b.length || !require('crypto').timingSafeEqual(a, b) || !s3.configured()) return res.status(404).send('Not found');
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.redirect(302, s3.presignUrl('GET', key, 3600));
});

// ---------- unfinished forms: saved while typing, alert after PARTIAL_DELAY_MIN minutes idle ----------
app.post('/api/partial', express.text({ type: () => true, limit: '8kb' }), async (req, res) => {
  let b;
  try { b = typeof req.body === 'string' && req.body ? JSON.parse(req.body) : {}; } catch (e) { return res.status(400).json({ ok: false }); }
  const pid = String(b.pid || '').slice(0, 64);
  if (!/^[\w-]{8,64}$/.test(pid)) return res.status(400).json({ ok: false });
  if (b.company) return res.json({ ok: true });
  const ip = clientIp(req);
  if (partialLimited(ip)) return res.status(429).json({ ok: false });
  // Page B renter exit: close the step 1 partial so no unfinished form alert goes out.
  if (b.form === 'form' && b.owner === 'rent') {
    try { await db.closePartial(pid, 'renter'); return res.json({ ok: true }); }
    catch (e) { console.error('[partial] renter', e.message); return res.status(500).json({ ok: false }); }
  }
  const p = validatePartial(b);
  if (!p) return res.status(400).json({ ok: false });
  p.ip = ip; p.user_agent = String(req.get('user-agent') || '').slice(0, 400);
  try { await db.upsertPartial(pid, p); res.json({ ok: true }); }
  catch (e) { console.error('[partial]', e.message); res.status(500).json({ ok: false }); }
});

const PARTIAL_DELAY_MIN = Math.max(0, Number(process.env.PARTIAL_DELAY_MIN ?? 5));
async function sweepPartials() {
  if (process.env.PARTIAL_ALERTS === 'off') return;
  let due = [];
  try { due = await db.claimDuePartials(PARTIAL_DELAY_MIN); } catch (e) { return console.error('[partial] sweep', e.message); }
  for (const p of due) {
    try {
      if (await db.hasLead(p.phone)) { await db.setPartialStatus(p.pid, 'converted'); continue; }
      await notifyPartial(p);
      await db.setPartialStatus(p.pid, 'alerted');
    } catch (e) {
      console.error('[partial] alert failed', e.message);
      await db.setPartialStatus(p.pid, 'alert_failed').catch(() => {});
    }
  }
}
setInterval(sweepPartials, Number(process.env.PARTIAL_SWEEP_MS) || 60000).unref();

// CSV of unfinished forms: /admin/partials.csv?key=YOUR_ADMIN_KEY
app.get('/admin/partials.csv', async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(404).send('Not found');
  const rows = await db.listPartials();
  const cols = ['updated_at', 'status', 'form', 'name', 'phone', 'address', 'zip', 'loss_type', 'claim_status', 'loss_timing', 'utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid', 'landing_url', 'pid'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bluestar-unfinished-forms.csv"', 'Cache-Control': 'no-store' });
  res.send([cols.join(','), ...rows.map(r => cols.map(c => q(r[c] instanceof Date ? r[c].toISOString() : r[c])).join(','))].join('\n'));
});

// ---------- CSV export: /admin/leads.csv?key=YOUR_ADMIN_KEY ----------
app.get('/admin/leads.csv', async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(404).send('Not found');
  const rows = await db.listLeads();
  const cols = ['created_at', 'name', 'phone', 'address', 'zip', 'loss_type', 'claim_status', 'loss_timing', 'callback_slot', 'source', 'email', 'notes', 'page_variant', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'email_status', 'capi_status', 'hubspot_status', 'is_spam', 'public_id'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bluestar-leads.csv"', 'Cache-Control': 'no-store' });
  res.send([cols.join(','), ...rows.map(r => cols.map(c => q(r[c] instanceof Date ? r[c].toISOString() : r[c])).join(','))].join('\n'));
});

// Re-send one saved lead to Meta and HubSpot: /admin/resync?key=YOUR_ADMIN_KEY&id=LEAD_PUBLIC_ID
// Meta drops a repeat with the same event_id inside 48 hours, so this cannot double count.
app.get('/admin/resync', async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(404).send('Not found');
  const lead = await db.getLead(String(req.query.id || '')).catch(() => null);
  if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });
  const [c, h] = await Promise.all([capi.sendLead(lead), hubspot.pushLead(lead)]);
  await db.setSyncStatus(lead.public_id, 'capi_status', c).catch(() => {});
  await db.setSyncStatus(lead.public_id, 'hubspot_status', h).catch(() => {});
  res.json({ ok: true, capi: c, hubspot: h });
});

// Send yourself a test alert after deploy: /admin/test-email?key=YOUR_ADMIN_KEY
app.get('/admin/test-email', async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(404).send('Not found');
  try {
    const status = await notifyLead({ public_id: 'test', name: 'Test Lead', phone: '(916) 555-0100', zip: '95811', loss_type: 'fire', claim_status: 'low_offer', loss_timing: 'm1_6', page_variant: 'default', utm_source: 'test', created_at: new Date() });
    res.json({ ok: true, status, to: (process.env.NOTIFY_TO || 'nayem.adsmanager@gmail.com') });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.get('/health', async (req, res) => {
  try { res.json({ ok: true, storage: await db.ping() }); }
  catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

app.use((req, res) => res.redirect(302, '/'));

db.init()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`[web] listening on ${PORT}`)))
  .then(() => {
    if (!s3.configured()) return console.warn('[s3] not configured, uploads disabled');
    s3.ensureCors()
      .then(r => r.ok ? console.log(`[s3] CORS set for ${r.origins.join(', ')}`) : console.error(`[s3] CORS failed ${r.status}: ${r.body}`))
      .catch(e => console.error('[s3] CORS failed', e.message));
  })
  .catch(e => { console.error('[boot]', e); process.exit(1); });
