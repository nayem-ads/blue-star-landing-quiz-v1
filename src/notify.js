'use strict';
// Lead email alerts.
// 1. RESEND_API_KEY set  -> Resend (recommended, free tier, 2 minute setup).
// 2. otherwise            -> FormSubmit (no account; first email asks you to click "Activate" once).
const { LABELS } = require('./validate');

const TO = () => (process.env.NOTIFY_TO || 'nayem.adsmanager@gmail.com,mike@bluestaradjusters.com').split(',').map(s => s.trim()).filter(Boolean);

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function ptTime(d) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }).format(d ? new Date(d) : new Date()) + ' PT';
}

function rowsFor(lead) {
  const telDigits = String(lead.phone).replace(/\D/g, '');
  return [
    ['Name', lead.name],
    ['Phone', lead.phone, `tel:+1${telDigits}`],
    ['Form', lead.source === 'contact' ? 'Contact form (bottom of page)' : 'Quiz'],
    ['Email', lead.email, lead.email ? `mailto:${lead.email}` : null],
    ['Property address', lead.address],
    ['ZIP', lead.zip],
    ['What happened', LABELS.loss_type[lead.loss_type] || lead.loss_type],
    ['Ownership', LABELS.owner[lead.owner] || lead.owner],
    ['Claim status', LABELS.claim_status[lead.claim_status] || lead.claim_status],
    ['When', LABELS.loss_timing[lead.loss_timing] || lead.loss_timing],
    ['Message', lead.notes],
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
  const subject = `New ${lead.source === 'contact' ? 'contact form' : 'claim review'} lead: ${LABELS.loss_type[lead.loss_type] || lead.loss_type}${lead.claim_status ? ', ' + (LABELS.claim_status[lead.claim_status] || '') : ''} (${lead.zip || (lead.address ? lead.address.slice(0, 40) : 'no address')})`;
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
  const times = String(slot).split('; ').filter(Boolean);
  const subject = times.length > 1
    ? `Call times picked (${times.length}): ${times[0]} and more (${info.name || 'lead'})`
    : `Call time picked: ${times[0] || slot} (${info.name || 'lead'})`;
  const rows = [...times.map((t, i) => [times.length > 1 ? `Call time ${i + 1} (Pacific)` : 'Call time (Pacific)', t]), ['Name', info.name], ['Phone', info.phone], ['Lead ID', publicId]].filter(r => r[1]);
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px"><p><b>The lead picked ${times.length > 1 ? 'call times. Call at any of them.' : 'a call time.'}</b></p>${rows.map(([k, v]) => `<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}</div>`;
  if (process.env.RESEND_API_KEY) return sendResend(subject, html, rows.map(r => r.join(': ')).join('\n'));
  return sendFormSubmit(subject, rows);
}

// Someone typed a valid phone number but never pressed send.
async function notifyPartial(p) {
  const telDigits = String(p.phone).replace(/\D/g, '');
  const rows = [
    ['Status', 'Started the form but did not press send. They have not agreed to calls or texts yet, so call by hand only.'],
    ['Name', p.name], ['Phone', p.phone, `tel:+1${telDigits}`],
    ['Form', p.form === 'contact' ? 'Contact form (bottom of page)' : 'Quiz'],
    ['Property address', p.address], ['ZIP', p.zip],
    ['What happened', LABELS.loss_type[p.loss_type] || p.loss_type],
    ['Ownership', LABELS.owner[p.owner] || p.owner],
    ['Claim status', LABELS.claim_status[p.claim_status] || p.claim_status],
    ['When', LABELS.loss_timing[p.loss_timing] || p.loss_timing],
    ['Last typed', ptTime(p.updated_at)],
    ['Source', [p.utm_source, p.utm_medium, p.utm_campaign].filter(Boolean).join(' / ') || (p.gclid ? 'google (gclid)' : p.fbclid ? 'meta (fbclid)' : 'direct or unknown')],
    ['Landing URL', p.landing_url],
    ['Partial ID', p.pid],
  ].filter(r => r[1]);
  const subject = `Unfinished form: ${p.name || 'no name'} ${p.phone} did not press send`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0E1630"><p style="margin:0 0 12px"><b>Someone started the Quiz First form and left without sending it.</b></p>
<table cellpadding="8" style="border-collapse:collapse;border:1px solid #D9DFEC">${rows.map(([k, v, href]) =>
    `<tr><td style="background:#F4F6FB;border:1px solid #D9DFEC;font-weight:bold">${esc(k)}</td><td style="border:1px solid #D9DFEC">${href ? `<a href="${esc(href)}">${esc(v)}</a>` : esc(v)}</td></tr>`).join('')}</table></div>`;
  if (process.env.RESEND_API_KEY) return sendResend(subject, html, rows.map(r => `${r[0]}: ${r[1]}`).join('\n'));
  return sendFormSubmit(subject, rows.map(r => [r[0], r[1]]));
}

module.exports = { notifyLead, notifyCallback, notifyPartial, render };
