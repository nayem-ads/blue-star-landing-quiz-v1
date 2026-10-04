'use strict';
// Lead email alerts.
// 1. RESEND_API_KEY set  -> Resend (recommended, free tier, 2 minute setup).
// 2. otherwise            -> FormSubmit (no account; first email asks you to click "Activate" once).
const { LABELS } = require('./validate');

const TO = () => (process.env.NOTIFY_TO || 'nayem.adsmanager@gmail.com').split(',').map(s => s.trim()).filter(Boolean);

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function ptTime(d) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(d ? new Date(d) : new Date()) + ' PT';
}

function rowsFor(lead) {
  const telDigits = String(lead.phone).replace(/\D/g, '');
  return [
    ['Name', lead.name],
    ['Phone', lead.phone, `tel:+1${telDigits}`],
    ['ZIP', lead.zip],
    ['What happened', LABELS.loss_type[lead.loss_type] || lead.loss_type],
    ['Claim status', LABELS.claim_status[lead.claim_status] || lead.claim_status],
    ['When', LABELS.loss_timing[lead.loss_timing] || lead.loss_timing],
    ['Received', ptTime(lead.created_at)],
    ['Page version', lead.page_variant],
    ['Source', [lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(' / ') || (lead.gclid ? 'google (gclid)' : lead.fbclid ? 'meta (fbclid)' : 'direct or unknown')],
    ['Keyword / ad', [lead.utm_term, lead.utm_content].filter(Boolean).join(' / ')],
    ['Landing URL', lead.landing_url],
    ['Lead ID', lead.public_id],
  ].filter(r => r[1]);
}

function render(lead) {
  const rows = rowsFor(lead);
  const subject = `New claim review lead: ${LABELS.loss_type[lead.loss_type] || lead.loss_type}, ${LABELS.claim_status[lead.claim_status] || ''} (${lead.zip})`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0E1630">
<p style="margin:0 0 12px"><b>New lead from the Quiz First landing page.</b> Call within the hour if you can, during 9 AM to 5 PM Pacific.</p>
<table cellpadding="8" style="border-collapse:collapse;border:1px solid #D9DFEC">${rows.map(([k, v, href]) =>
    `<tr><td style="background:#F4F6FB;border:1px solid #D9DFEC;font-weight:bold">${esc(k)}</td><td style="border:1px solid #D9DFEC">${href ? `<a href="${esc(href)}">${esc(v)}</a>` : esc(v)}</td></tr>`).join('')}</table>
<p style="color:#5E6885;font-size:12px;margin-top:16px">Blue Star Adjusters lead alert. Leads are also stored in the database.</p></div>`;
  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  return { subject, html, text, rows };
}

async function withTimeout(p, ms) {
  let t; const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(t); }
}

async function sendResend(subject, html, text) {
  const r = await withTimeout(fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || 'Blue Star Leads <onboarding@resend.dev>', to: TO(), subject, html, text }),
  }), 8000);
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return 'sent:resend';
}

async function sendFormSubmit(subject, rows) {
  const [first, ...rest] = TO();
  const body = { _subject: subject, _template: 'table', _captcha: 'false' };
  if (rest.length) body._cc = rest.join(',');
  for (const [k, v] of rows) body[k] = String(v);
  const r = await withTimeout(fetch(`https://formsubmit.co/ajax/${encodeURIComponent(first)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: process.env.PUBLIC_URL || 'https://bluestaradjusters.com', Origin: process.env.PUBLIC_URL || 'https://bluestaradjusters.com' },
    body: JSON.stringify(body),
  }), 8000);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || String(j.success) === 'false') throw new Error(`formsubmit ${r.status}: ${j.message || ''}`.slice(0, 200));
  return 'sent:formsubmit';
}

async function notifyLead(lead) {
  const { subject, html, text, rows } = render(lead);
  if (process.env.RESEND_API_KEY) return sendResend(subject, html, text);
  return sendFormSubmit(subject, rows);
}

async function notifyCallback(info, slot, publicId) {
  const subject = `Call time picked: ${slot} (${info.name || 'lead'})`;
  const rows = [['Call time (Pacific)', slot], ['Name', info.name], ['Phone', info.phone], ['Lead ID', publicId]].filter(r => r[1]);
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px"><p><b>The lead picked a call time.</b></p>${rows.map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}</div>`;
  if (process.env.RESEND_API_KEY) return sendResend(subject, html, rows.map(r => r.join(': ')).join('\n'));
  return sendFormSubmit(subject, rows);
}

module.exports = { notifyLead, notifyCallback, render };
