'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const db = require('./src/db');
const { validateLead } = require('./src/validate');
const { notifyLead, notifyCallback } = require('./src/notify');

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
  default: 'Your insurance offer looks too low. Get a free second opinion.',
  fire: 'Your fire claim offer looks too low. Get a free second opinion.',
  smoke: 'Insurance says your smoke damage only needs a light clean. Get a second opinion.',
  water: 'Your water damage claim came back low. Get a free second opinion.',
  denied: 'Your claim was denied. That isn’t always the final answer.',
};
const TEMPLATE = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
const GTM = (process.env.GTM_ID || '').trim();
const gtmHead = /^GTM-[A-Z0-9]+$/.test(GTM)
  ? `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>`
  : '';
const gtmBody = gtmHead ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : '';
const ROBOTS = process.env.ALLOW_INDEX === 'true' ? 'index,follow' : 'noindex,follow';

function page(req) {
  const key = String(req.query.loss || req.query.h || '').toLowerCase();
  const variant = HEADLINES[key] ? key : 'default';
  return TEMPLATE
    .replaceAll('{{H1}}', HEADLINES[variant])
    .replaceAll('{{VARIANT}}', variant)
    .replaceAll('{{GTM_HEAD}}', gtmHead)
    .replaceAll('{{GTM_BODY}}', gtmBody)
    .replaceAll('{{ROBOTS}}', ROBOTS);
}

app.get(['/', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(page(req));
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

app.post('/api/lead', express.json({ limit: '16kb' }), async (req, res) => {
  const b = req.body || {};
  const ip = clientIp(req);
  if (limited(ip)) return res.status(429).json({ ok: false, error: 'Too many attempts. Please call (916) 507-1005.' });

  const { ok, errors, lead } = validateLead(b);
  if (!ok) return res.status(400).json({ ok: false, errors });

  // Bots: hidden honeypot field filled, or the whole quiz done in under 3 seconds.
  const spam = Boolean(b.company) || (Number(b.elapsed_ms) > 0 && Number(b.elapsed_ms) < 3000);
  lead.is_spam = spam;
  lead.ip = ip;
  lead.user_agent = String(req.get('user-agent') || '').slice(0, 400);

  if (!spam) {
    const dup = await db.findRecent(lead.phone).catch(() => null);
    if (dup) return res.json({ ok: true, id: dup, first_name: lead.name.split(' ')[0], duplicate: true });
  }

  let saved;
  try { saved = await db.insertLead(lead); }
  catch (e) {
    console.error('[lead] db insert failed', e.message);
    // Still try to email so the lead is never lost.
    saved = { ...lead, public_id: 'unsaved-' + Date.now() };
  }

  if (!spam) {
    try {
      const status = await notifyLead(saved).catch(async () => { await new Promise(r => setTimeout(r, 1500)); return notifyLead(saved); });
      await db.setEmailStatus(saved.public_id, status, null).catch(() => {});
    } catch (e) {
      console.error('[lead] email failed', e.message);
      await db.setEmailStatus(saved.public_id, 'failed', e.message).catch(() => {});
    }
  }
  res.json({ ok: true, id: saved.public_id, first_name: lead.name.split(' ')[0] });
});

app.post('/api/lead/:id/callback', express.json({ limit: '4kb' }), async (req, res) => {
  const id = String(req.params.id);
  const slot = String((req.body || {}).slot || '').slice(0, 60);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !slot) return res.status(400).json({ ok: false });
  if (limited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    const info = await db.setCallback(id, slot);
    if (!info) return res.status(404).json({ ok: false });
    notifyCallback(info, slot, id).catch(e => console.error('[callback] email failed', e.message));
    res.json({ ok: true });
  } catch (e) {
    console.error('[callback]', e.message);
    res.status(500).json({ ok: false });
  }
});

// ---------- CSV export: /admin/leads.csv?key=YOUR_ADMIN_KEY ----------
app.get('/admin/leads.csv', async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(404).send('Not found');
  const rows = await db.listLeads();
  const cols = ['created_at', 'name', 'phone', 'zip', 'loss_type', 'claim_status', 'loss_timing', 'callback_slot', 'page_variant', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'email_status', 'is_spam', 'public_id'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bluestar-leads.csv"', 'Cache-Control': 'no-store' });
  res.send([cols.join(','), ...rows.map(r => cols.map(c => q(r[c] instanceof Date ? r[c].toISOString() : r[c])).join(','))].join('\n'));
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
  .catch(e => { console.error('[boot]', e); process.exit(1); });
