'use strict';
// Meta Conversions API: sends the same Lead the browser pixel sends, from the server.
// event_id = lead public_id, the same eventID app.js gives fbq('track','Lead'), so Meta counts it once.
// Needs META_CAPI_TOKEN (Events Manager > dataset > Settings > Conversions API > Generate access token).
// META_TEST_EVENT_CODE sends to Test Events only. Remove it to go live.
const crypto = require('crypto');

const PIXEL = (process.env.META_PIXEL_ID || '2836808853350981').trim();
const VER = (process.env.META_GRAPH_VERSION || 'v23.0').trim();

const sha = v => crypto.createHash('sha256').update(v).digest('hex');
const norm = v => String(v || '').trim().toLowerCase();
const letters = v => norm(v).normalize('NFKD').replace(/[^\p{L}]/gu, '');

// Lead fields -> Meta user_data. Every personal field is normalised then SHA-256 hashed, as Meta requires.
function userData(lead) {
  const u = {};
  const digits = String(lead.phone || '').replace(/\D/g, '');
  if (digits.length === 10) { u.ph = [sha('1' + digits)]; u.external_id = [sha('1' + digits)]; }
  if (lead.email) u.em = [sha(norm(lead.email))];
  const parts = String(lead.name || '').trim().split(/\s+/).filter(Boolean);
  if (parts[0] && letters(parts[0])) u.fn = [sha(letters(parts[0]))];
  if (parts.length > 1 && letters(parts[parts.length - 1])) u.ln = [sha(letters(parts[parts.length - 1]))];
  const zip = String(lead.zip || '').replace(/\D/g, '').slice(0, 5);
  if (zip.length === 5) {
    u.zp = [sha(zip)];
    // 90000 to 96199 are California ZIPs. Only then is the state known for sure.
    if (+zip >= 90000 && +zip <= 96199) u.st = [sha('ca')];
  }
  // "1610 R St, Sacramento, CA 95811": the city is the part after the street.
  const segs = String(lead.address || '').split(',').map(s => s.trim()).filter(Boolean);
  if (segs.length >= 3 && letters(segs[1])) u.ct = [sha(letters(segs[1]))];
  u.country = [sha('us')];
  if (lead.ip) u.client_ip_address = lead.ip;
  if (lead.user_agent) u.client_user_agent = lead.user_agent;
  if (/^fb\.\d\.\d+\.\d+$/.test(lead.fbp || '')) u.fbp = lead.fbp;
  if (/^fb\.\d\.\d+\.\S+$/.test(lead.fbc || '')) u.fbc = lead.fbc;
  else if (lead.fbclid) u.fbc = `fb.1.${Date.now()}.${lead.fbclid}`;
  return u;
}

function leadEvent(lead) {
  const url = /^https:\/\//.test(lead.landing_url || '') ? lead.landing_url : (process.env.PUBLIC_URL || undefined);
  return {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: String(lead.public_id),
    action_source: 'website',
    event_source_url: url,
    user_data: userData(lead),
    custom_data: { content_name: lead.loss_type || undefined, content_category: lead.claim_status || undefined, form: lead.source || 'quiz' },
  };
}

// Returns a short status for the leads table: sent, test, skipped: ..., failed: ...
async function sendLead(lead) {
  const token = (process.env.META_CAPI_TOKEN || '').trim();
  if (!token) return 'skipped: no META_CAPI_TOKEN';
  if (!lead.public_id) return 'skipped: no lead id';
  const test = (process.env.META_TEST_EVENT_CODE || '').trim();
  const body = { data: [leadEvent(lead)], access_token: token };
  if (test) body.test_event_code = test;
  try {
    const r = await fetch(`https://graph.facebook.com/${VER}/${PIXEL}/events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.events_received) return `failed: ${r.status} ${(j.error && j.error.message) || ''}`.slice(0, 300);
    return test ? `test (${test})` : 'sent';
  } catch (e) { return `failed: ${e.message}`.slice(0, 300); }
}

module.exports = { sendLead, leadEvent, userData };
