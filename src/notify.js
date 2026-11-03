'use strict';
// Lead email alerts — Resend primary (lead@bluestaradjusters.com -> mike@bluestaradjusters.com, CC nayem.adsmanager@gmail.com)
// with automatic FormSubmit fallback if RESEND_API_KEY is absent or fails.
const { LABELS } = require('./validate');

const DEFAULT_PRIMARY = 'mike@bluestaradjusters.com';
const DEFAULT_CC = 'nayem.adsmanager@gmail.com';
const DEFAULT_FROM = 'Blue Star Adjusters <lead@bluestaradjusters.com>';
const FORM_ORIGIN = (process.env.FORMSUBMIT_ORIGIN || 'https://quiz.bluestaradjusters.com').replace(/\/+$/, '');

function TO() {
  const raw = (process.env.NOTIFY_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  if (raw.length && raw.every(e => /\.invalid$/i.test(e))) return raw;

  const primary = (process.env.NOTIFY_PRIMARY || DEFAULT_PRIMARY).trim();
  const defaultCc = (process.env.NOTIFY_CC || DEFAULT_CC).split(',').map(s => s.trim()).filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const addr of [primary, ...defaultCc, ...raw]) {
    const key = addr.toLowerCase();
    if (!key || seen.has(key) || /\.invalid$/i.test(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function ptTime(d) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d ? new Date(d) : new Date()) + ' PT';
}

function zipToState(zip) {
  if (!zip || !/^\d{5}$/.test(String(zip))) return '';
  const z = +zip;
  return (z >= 90000 && z <= 96199) ? 'CA'
    : (z >= 85000 && z <= 86599) ? 'AZ'
    : (z >= 88900 && z <= 89899) ? 'NV'
    : (z >= 97000 && z <= 97999) ? 'OR'
    : (z >= 98000 && z <= 99499) ? 'WA'
    : (z >= 80000 && z <= 81699) ? 'CO'
    : (z >= 83200 && z <= 83899) ? 'ID'
    : (z >= 59000 && z <= 59999) ? 'MT' : '';
}

const CAMPAIGN_MAP = {
  bsa_wa_spokane_nov26: { market: 'WA · Spokane & Nine Mile Falls', label: 'WA Spokane — Fire & Smoke Claims', state: 'WA' },
  '120248797843760534': { market: 'WA · Spokane & Nine Mile Falls', label: 'WA Spokane — Fire & Smoke Claims', state: 'WA' },
  bsa_nv_reno_nov26: { market: 'NV · NW Reno & North Valleys', label: 'NV Reno — Wildfire Smoke & Ash Claims', state: 'NV' },
  '120248797847020534': { market: 'NV · NW Reno & North Valleys', label: 'NV Reno — Wildfire Smoke & Ash Claims', state: 'NV' },
  bsa_co_denver_nov26: { market: 'CO · Denver & Aurora', label: 'CO Denver & Aurora — Hail & Storm Claims', state: 'CO' },
  '120248797848000534': { market: 'CO · Denver & Aurora', label: 'CO Denver & Aurora — Hail & Storm Claims', state: 'CO' },
  bsa_ca_southoc_nov26: { market: 'CA · San Clemente & South OC', label: 'CA South OC — Norte Fire Smoke Claims', state: 'CA' },
  '120248797849940534': { market: 'CA · San Clemente & South OC', label: 'CA South OC — Norte Fire Smoke Claims', state: 'CA' },
  bsa_az_hail_oct26: { market: 'AZ · Phoenix & East Valley', label: 'AZ Phoenix — Hail & Storm Claims', state: 'AZ' },
  bsa_az_hail: { market: 'AZ · Phoenix & East Valley', label: 'AZ Phoenix — Hail & Storm Claims', state: 'AZ' },
  '120248791830950534': { market: 'AZ · Phoenix & East Valley', label: 'AZ Phoenix — Hail & Storm Claims', state: 'AZ' },
  bsa_lp_zips: { market: 'CA · High-Loss ZIPs', label: 'CA — Property Loss ZIPs Funnel', state: 'CA' },
  bsa_if_la: { market: 'CA · Los Angeles', label: 'CA Los Angeles — Fire & Smoke Claims', state: 'CA' },
};

const CREATIVE_MAP = {
  a1_01_filter: 'Soot on HVAC Filter / Window Track (Smoke Test)',
  a2_01_filter: 'Soot on HVAC Filter / Window Track (Smoke Test)',
  a4_01_filter: 'Soot on HVAC Filter / Window Track (Smoke Test)',
  a1_02_lot: 'Cleared Lot / Rebuild Estimate Lower Than Builder Bid',
  a2_02_attic: 'Hidden Attic & Insulation Wildfire Smoke/Ash',
  a1_03_heat: 'Turned Heat On & Smelled Wildfire Smoke (Ducts/Walls)',
  a2_03_heat: 'Turned Heat On & Smelled Wildfire Smoke (Ducts/Walls)',
  a3_01_bruise: 'Hail-Bruised Roof Shingles Inspection',
  a3_02_downspout: 'Dented Gutters & Downspouts (Hail Proof)',
  a3_04_neighbors: 'Neighbors Getting Full Roofs vs. Patch Offer',
  a1_04_free_review: 'Free Line-by-Line Insurance Estimate Review',
  a2_04_free_review: 'Free Line-by-Line Insurance Estimate Review',
  a3_05_free_review: 'Free Line-by-Line Insurance Estimate Review',
  a4_03_free_review: 'Free Line-by-Line Insurance Estimate Review',
  a1_05_zero_risk: 'Lowball Offer / Check — No Upfront Cost Review',
  a2_05_zero_risk: 'Lowball Offer / Check — No Upfront Cost Review',
  a3_06_zero_risk: 'Lowball Offer / Check — No Upfront Cost Review',
  a4_04_zero_risk: 'Lowball Offer / Check — No Upfront Cost Review',
  a1_06_ghosted: 'Insurance Adjuster Not Calling Back / Ghosting',
  a2_06_ghosted: 'Insurance Adjuster Not Calling Back / Ghosting',
  a3_07_ghosted: 'Insurance Adjuster Not Calling Back / Ghosting',
  a4_05_ghosted: 'Insurance Adjuster Not Calling Back / Ghosting',
  a3_08_table: 'Carrier Adjuster vs. Public Adjuster Comparison',
  a1_08_notes: 'Before You Cash That Insurance Check (Checklist)',
  a2_08_notes: 'Before You Cash That Insurance Check (Checklist)',
  a3_09_notes: 'Before You Cash That Insurance Check (Checklist)',
  a4_07_notes: 'Before You Cash That Insurance Check (Checklist)',
  a1_09_proof: '$17K Carrier Smoke Offer Case Study Proof',
  a2_09_proof: '$17K Carrier Smoke Offer Case Study Proof',
  '04': 'Estimate Too Low to Rebuild (#04)',
  '07': 'Adjuster Not Calling Back (#07)',
  '08': 'Fourth Adjuster — Stop Starting Over (#08)',
  '13': 'Smoke Claim Testing (#13)',
  '14': 'Smoke Claim Testing (#14)',
  '17': 'Insurer Sends an Adjuster — Have Your Own (#17)',
  '19': 'Two Adjusters — One Works for You (#19)',
  '20': 'Got a Number? Don’t Sign Yet (#20)',
  '21': 'Smoke Claim Testing (#21)',
  '29': 'Rebuilding to Today’s Code (#29)',
  '30': 'Burst Pipe — Get Your Own Adjuster (#30)',
};

const HERO_HEADLINES = {
  default: 'Home or business damaged?',
  fire: 'Your fire claim offer looks too low. Get a free second opinion.',
  smoke: 'Insurance says your smoke damage only needs a light clean. Get a second opinion.',
  water: 'Your water damage claim came back low. Get a free second opinion.',
  denied: 'Your claim was denied. That isn’t always the final answer.',
  storm: 'Your storm damage claim came back low. Get a free second opinion.',
  hail: 'Hail or storm damage claim? Get a free second opinion.',
  rebuild: 'Estimate too low to rebuild? Get it checked.',
  calls: 'Adjuster not calling back? Hand the calls to us.',
  restart: 'Fourth adjuster. Same claim. Stop starting over.',
  code: 'Rebuilding to today’s code? Check your estimate first.',
  'smoke-test': 'Smoke claim? Get it tested before you settle.',
  pipe: 'Burst pipe? Get your own adjuster first.',
  two: 'Two adjusters. One works for you.',
  sign: 'Got a number? Don’t sign yet.',
  own: 'The insurer sends an adjuster. You can have one too.',
  'smoke-filter': 'Soot on the filter or window track? Get hidden smoke tested free.',
  'smoke-heat': 'Turned the heat on and smelled wildfire smoke? Get your ducts and walls tested.',
  'smoke-attic': 'Smoke settles where nobody looks. Get your attic and ducts checked free.',
  'rebuild-gap': 'Rebuild estimate lower than your builder’s bid? Have a public adjuster check every line.',
  'hail-roof': 'Neighbors getting full roofs while you got a patch? Get a free hail claim review.',
  'hail-gap': 'Hail check won’t cover the roofer’s full bid? Have a public adjuster check what’s missing.',
  'free-review': 'Got an insurance estimate? Have a licensed public adjuster check what they left out.',
  'zero-risk': 'Already got a check or lowball offer? Get a free claim review with no upfront cost.',
  ghosted: 'Tired of chasing your insurance adjuster? Hand every call and negotiation to yours.',
  'two-adj': 'The insurer’s adjuster works for them. Hire a licensed public adjuster who works for you.',
  checklist: 'Before you cash that insurance check, have a licensed public adjuster review it free.',
  'case-proof': 'Insurer offered $17K for smoke. Get your claim checked before you settle.',
};

function humanizeSlug(slug) {
  if (!slug) return '';
  return String(slug)
    .replace(/^bsa_/i, '')
    .replace(/^[a-z]\d+_\d+_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function decodeAttribution(lead) {
  let u = null;
  try { if (lead.landing_url) u = new URL(lead.landing_url); } catch (_) {}
  const q = k => (u && u.searchParams.get(k)) || '';

  const utmSource = (lead.utm_source || q('utm_source') || '').trim();
  const utmMedium = (lead.utm_medium || q('utm_medium') || '').trim();
  const utmCampaign = (lead.utm_campaign || q('utm_campaign') || '').trim();
  const utmContent = (lead.utm_content || q('utm_content') || '').trim();
  const utmTerm = (lead.utm_term || q('utm_term') || q('hsa_kw') || '').trim();
  const hsaCam = q('hsa_cam').trim();
  const hsaGrp = q('hsa_grp').trim();
  const hsaAd = q('hsa_ad').trim();
  const fbclid = (lead.fbclid || q('fbclid') || '').trim();
  const gclid = (lead.gclid || lead.gbraid || lead.wbraid || q('gclid') || q('gbraid') || q('wbraid') || '').trim();
  const heroKey = (q('h') || (lead.page_variant && lead.page_variant !== 'b' ? lead.page_variant : '') || q('loss') || '').toLowerCase();

  // Channel
  const srcLo = utmSource.toLowerCase();
  let channel = 'Direct Visit';
  if (fbclid || /^(meta|fb|facebook|ig|instagram)$/.test(srcLo)) {
    channel = 'Meta Paid Ads (Facebook / Instagram)';
  } else if (gclid || (srcLo === 'google' && /cpc|ppc|paid/i.test(utmMedium))) {
    channel = 'Google Paid Search Ads';
  } else if (utmSource) {
    channel = `Campaign Link (${[utmSource, utmMedium].filter(Boolean).join(' / ')})`;
  } else if (lead.referrer && /google\.|bing\.|yahoo\.|duckduckgo\./i.test(lead.referrer)) {
    try { channel = `Organic Search (${new URL(lead.referrer).hostname.replace(/^www\./, '')})`; }
    catch (_) { channel = 'Organic Search'; }
  } else if (lead.source === 'website') {
    channel = 'Main Website (bluestaradjusters.com)';
  }

  // Campaign & Market
  const campEntry = CAMPAIGN_MAP[utmCampaign.toLowerCase()] || CAMPAIGN_MAP[hsaCam] || null;
  let campaignDisplay = '';
  if (campEntry) {
    campaignDisplay = utmCampaign && utmCampaign !== hsaCam
      ? `${campEntry.label} (${utmCampaign})`
      : campEntry.label;
  } else if (utmCampaign) {
    campaignDisplay = `${humanizeSlug(utmCampaign)} (${utmCampaign})`;
  } else if (hsaCam) {
    campaignDisplay = `Campaign ID ${hsaCam}`;
  }

  // State / Market badge
  const addrStateMatch = String(lead.address || '').match(/,\s*([A-Z]{2})\s+\d{5}\b/) || String(lead.address || '').match(/\b(CA|WA|NV|CO|AZ|OR|ID|MT)\b/);
  const urlState = (q('state') || '').toUpperCase();
  const propState = (lead.property_state || zipToState(lead.zip) || (addrStateMatch ? addrStateMatch[1] : '') || (campEntry ? campEntry.state : '') || urlState || '').toUpperCase();
  const marketBadge = campEntry
    ? campEntry.market
    : propState
      ? `${propState}${lead.zip ? ' · ' + lead.zip : ''}`
      : (lead.zip ? `ZIP ${lead.zip}` : 'Claim Review');

  // Creative / Ad Angle
  const creativeKnown = CREATIVE_MAP[utmContent.toLowerCase()] || CREATIVE_MAP[utmContent];
  let creativeDisplay = '';
  if (creativeKnown) {
    creativeDisplay = `${creativeKnown} [${utmContent}]`;
  } else if (utmContent) {
    creativeDisplay = `${humanizeSlug(utmContent)} [${utmContent}]`;
  } else if (hsaAd) {
    creativeDisplay = `Ad ID ${hsaAd}`;
  }

  // Headline shown on page
  const headlineDisplay = HERO_HEADLINES[heroKey] || (lead.page_variant === 'b' ? 'Multi-step property claim form (Page B)' : '');

  // Form / Funnel label (keep exact legacy strings in rowsFor for FormSubmit test compatibility, and descriptive label for HTML)
  const formLabel = lead.source === 'website'
    ? `Main Website — ${lead.form_location || 'bluestaradjusters.com'}`
    : lead.source === 'contact'
      ? 'Quiz Funnel — Bottom Contact Form'
      : lead.source === 'form'
        ? 'Quiz Funnel — Page B (Multi-Step Form)'
        : 'Quiz Funnel — Page A (4-Step Claim Quiz)';

  return {
    channel,
    campaignDisplay,
    creativeDisplay,
    utmTerm,
    headlineDisplay,
    formLabel,
    propState,
    marketBadge,
    hsaCam,
    hsaGrp,
    hsaAd,
    fbclid,
    gclid,
  };
}

function rowsFor(lead) {
  const telDigits = String(lead.phone || '').replace(/\D/g, '');
  const attr = decodeAttribution(lead);
  const legacyForm = lead.source === 'website'
    ? `Main website (${lead.form_location || 'bluestaradjusters.com'})`
    : lead.source === 'contact'
      ? 'Contact form (bottom of page)'
      : lead.source === 'form'
        ? 'Page B (multi-step form)'
        : 'Quiz';
  return [
    ['Name', lead.name],
    ['Phone', lead.phone, telDigits ? `tel:+1${telDigits}` : null],
    ['Email', lead.email, lead.email ? `mailto:${lead.email}` : null],
    ['Property address', lead.address],
    ['State / ZIP', [attr.propState, lead.zip].filter(Boolean).join(' · ') || null],
    ['What happened', lead.loss_label || LABELS.loss_type[lead.loss_type] || lead.loss_type],
    ['Ownership', LABELS.owner[lead.owner] || lead.owner],
    ['Claim status', LABELS.claim_status[lead.claim_status] || lead.claim_status],
    ['When', LABELS.loss_timing[lead.loss_timing] || lead.loss_timing],
    ['Message', lead.notes],
    ['Attached files', lead.attachment_names],
    ['Channel', attr.channel],
    ['Campaign', attr.campaignDisplay],
    ['Ad creative', attr.creativeDisplay],
    ['Search keyword', attr.utmTerm],
    ['Headline shown', attr.headlineDisplay],
    ['Form', legacyForm],
    ['Page version', lead.page_variant],
    ['Received', ptTime(lead.created_at)],
    ['Landing URL', lead.landing_url],
    ['Lead ID', lead.public_id],
  ].filter(r => r[1]);
}

function sectionTable(title, items) {
  const filtered = items.filter(x => x && x[1]);
  if (!filtered.length) return '';
  return `
  <div style="margin-top:20px">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#1D4ED8;margin:0 0 8px">${esc(title)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #E2E8F0;border-radius:6px;overflow:hidden">
      ${filtered.map(([k, v, opts = {}], idx) => `
      <tr>
        <td width="34%" valign="top" style="padding:10px 14px;background:#F8FAFC;border-bottom:${idx < filtered.length - 1 ? '1px solid #E2E8F0' : 'none'};border-right:1px solid #E2E8F0;font-size:13px;font-weight:600;color:#334155">${esc(k)}</td>
        <td valign="top" style="padding:10px 14px;background:#FFFFFF;border-bottom:${idx < filtered.length - 1 ? '1px solid #E2E8F0' : 'none'};font-size:14px;color:#0F172A;${opts.mono ? 'font-family:Menlo,Consolas,monospace;font-size:12px;word-break:break-all;' : ''}${opts.bold ? 'font-weight:700;' : ''}">
          ${opts.href ? `<a href="${esc(opts.href)}" style="color:#1D4ED8;text-decoration:none;font-weight:600">${esc(v)}</a>` : esc(v)}
          ${opts.sub ? `<div style="font-size:12px;color:#64748B;margin-top:2px">${opts.subHtml || esc(opts.sub)}</div>` : ''}
        </td>
      </tr>`).join('')}
    </table>
  </div>`;
}

function render(lead) {
  const rows = rowsFor(lead);
  const attr = decodeAttribution(lead);
  const telDigits = String(lead.phone || '').replace(/\D/g, '');
  const lossText = lead.loss_label || LABELS.loss_type[lead.loss_type] || lead.loss_type || 'Claim Review';
  const claimText = LABELS.claim_status[lead.claim_status] || lead.claim_status || '';
  const ownerText = LABELS.owner[lead.owner] || lead.owner || '';
  const mapsUrl = lead.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.address)}` : '';

  const tag = attr.propState ? `[${attr.marketBadge}] ` : '';
  const subject = `${tag}New ${lossText} Lead — ${lead.name} · ${lead.phone}`;

  const contactItems = [
    ['Homeowner / Contact', lead.name, { bold: true }],
    ['Phone Number', lead.phone, telDigits ? { href: `tel:+1${telDigits}`, bold: true } : { bold: true }],
    ['Email Address', lead.email, lead.email ? { href: `mailto:${lead.email}` } : {}],
    ['Property Address', lead.address, mapsUrl ? { subHtml: `<a href="${esc(mapsUrl)}" style="color:#1D4ED8;text-decoration:none">Open in Google Maps &#8599;</a>` } : {}],
    ['State / ZIP', [attr.propState, lead.zip].filter(Boolean).join(' · ')],
    ['Submitted', ptTime(lead.created_at)],
  ];

  const claimItems = [
    ['Damage / Loss Type', lossText, { bold: true }],
    ['Property Ownership', ownerText],
    ['Claim Status', claimText || (lead.source === 'form' ? 'Step 2 saved (completing on next screen)' : null)],
    ['When Loss Occurred', LABELS.loss_timing[lead.loss_timing] || lead.loss_timing],
    ['Notes / Message', lead.notes],
    ['Attached Documents', lead.attachment_names],
  ];

  const adIdsLine = [
    attr.hsaCam ? `Campaign ID: ${attr.hsaCam}` : '',
    attr.hsaGrp ? `Ad Set ID: ${attr.hsaGrp}` : '',
    attr.hsaAd ? `Ad ID: ${attr.hsaAd}` : '',
  ].filter(Boolean).join(' · ');

  const sourceItems = [
    ['Traffic Channel', attr.channel, { bold: true }],
    ['Campaign & Market', attr.campaignDisplay || (lead.source === 'website' ? 'Direct / Website Organic' : 'Unattributed / Direct'), adIdsLine ? { sub: adIdsLine } : {}],
    ['Ad Creative & Angle', attr.creativeDisplay],
    ['Search Keyword', attr.utmTerm],
    ['Headline Shown on LP', attr.headlineDisplay],
    ['Funnel / Form Path', attr.formLabel],
    ['Landing Page URL', lead.landing_url, { mono: true }],
    ['Lead Reference ID', lead.public_id, { mono: true }],
  ];

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A">
  <div style="max-width:640px;margin:0 auto;padding:24px 12px">
    <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-top:4px solid #1D4ED8;border-radius:8px;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,0.06)">
      <div style="background:#0B1536;padding:22px 24px;color:#FFFFFF">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#93C5FD;margin-bottom:6px">
          BLUE STAR ADJUSTERS &middot; ${esc(attr.marketBadge)}
        </div>
        <div style="font-size:22px;font-weight:700;line-height:1.25;margin:0 0 6px;color:#FFFFFF">${esc(lead.name)}</div>
        <div style="font-size:14px;color:#CBD5E1;margin:0 0 16px">
          ${esc(lossText)}${claimText ? ' &middot; ' + esc(claimText) : ''}${lead.address ? ' &middot; ' + esc(lead.address) : ''}
        </div>
        ${telDigits ? `<a href="tel:+1${esc(telDigits)}" style="display:inline-block;background:#2563EB;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:6px">Call ${esc(lead.phone)}</a>` : ''}
        ${mapsUrl ? `<a href="${esc(mapsUrl)}" style="display:inline-block;background:rgba(255,255,255,0.12);color:#FFFFFF;font-size:13px;font-weight:600;text-decoration:none;padding:10px 14px;border-radius:6px;margin-left:8px">View Map &#8599;</a>` : ''}
      </div>
      <div style="padding:8px 24px 24px">
        ${sectionTable('1. Contact & Property', contactItems)}
        ${sectionTable('2. Claim & Qualification Details', claimItems)}
        ${sectionTable('3. Campaign, Ad Creative & Funnel Source', sourceItems)}
        <div style="margin-top:20px;padding-top:14px;border-top:1px solid #E2E8F0;font-size:12px;color:#64748B;line-height:1.5">
          Aim to call back within the hour during business hours (9 AM &ndash; 5 PM Pacific). This lead is also logged in PostgreSQL and synced to HubSpot (<b>Blue Star Leads</b> pipeline).
        </div>
      </div>
    </div>
  </div>
</body></html>`;

  const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');
  return { subject, html, text, rows };
}

async function withTimeout(p, ms) {
  let t;
  const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(t); }
}

async function sendResendTo(toList, ccList, subject, html, text, extra = {}) {
  const payload = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
    to: toList,
    subject,
    html,
    text,
  };
  if (ccList.length) payload.cc = ccList;
  if (extra.replyTo) payload.reply_to = extra.replyTo;
  if (Array.isArray(extra.attachments) && extra.attachments.length) payload.attachments = extra.attachments;
  const r = await withTimeout(fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }), 12000);
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return 'sent:resend';
}

async function postFormSubmit(toEmail, ccList, subject, rows) {
  const body = { _subject: subject, _template: 'table', _captcha: 'false' };
  if (ccList.length) body._cc = ccList.join(',');
  for (const [k, v] of rows) body[k] = String(v);
  const r = await withTimeout(fetch(`https://formsubmit.co/ajax/${encodeURIComponent(toEmail)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Referer: `${FORM_ORIGIN}/`, Origin: FORM_ORIGIN },
    body: JSON.stringify(body),
  }), 15000);
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && String(j.success) !== 'false', status: r.status, message: j.message || '' };
}

async function deliver(subject, html, text, rows, extra = {}) {
  const [first, ...rest] = TO();
  if (process.env.RESEND_API_KEY) {
    try { return await sendResendTo([first], rest, subject, html, text, extra); }
    catch (e) { console.warn('[notify] resend primary failed, falling back to formsubmit:', e.message); }
  }
  const primary = await postFormSubmit(first, rest, subject, rows);
  if (primary.ok) return 'sent:formsubmit';
  if (rest.length && /activat/i.test(primary.message)) {
    const pendingSubject = `[Pending ${first} activation] ${subject}`;
    if (process.env.RESEND_API_KEY) {
      try {
        await sendResendTo([rest[0]], rest.slice(1), pendingSubject, html, text, extra);
        return 'sent:resend_backup_pending_activation';
      } catch (_) {}
    }
    const backup = await postFormSubmit(rest[0], rest.slice(1), pendingSubject, rows);
    if (backup.ok) return 'sent:formsubmit_backup_pending_activation';
  }
  throw new Error(`formsubmit ${primary.status}: ${primary.message}`.slice(0, 200));
}

async function notifyLead(lead, extra = {}) {
  const { subject, html, text, rows } = render(lead);
  const opts = { ...extra };
  if (lead.email && !opts.replyTo) opts.replyTo = lead.email;
  return deliver(subject, html, text, rows, opts);
}

async function notifyCallback(info, slot, publicId) {
  const times = String(slot).split('; ').filter(Boolean);
  const telDigits = String(info.phone || '').replace(/\D/g, '');
  const subject = times.length > 1
    ? `Callback Requested (${times.length} times): ${info.name || 'Lead'} · ${info.phone || ''}`
    : `Callback Requested: ${times[0] || slot} — ${info.name || 'Lead'}`;
  const rows = [
    ...times.map((t, i) => [times.length > 1 ? `Preferred Time ${i + 1} (PT)` : 'Preferred Time (PT)', t]),
    ['Homeowner', info.name],
    ['Phone', info.phone],
    ['Lead ID', publicId],
  ].filter(r => r[1]);
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A">
  <div style="max-width:580px;margin:0 auto;background:#FFFFFF;border:1px solid #CBD5E1;border-top:4px solid #1D4ED8;border-radius:8px;overflow:hidden">
    <div style="background:#0B1536;padding:18px 22px;color:#FFFFFF">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#93C5FD;margin-bottom:4px">BLUE STAR ADJUSTERS &middot; CALLBACK SCHEDULED</div>
      <div style="font-size:19px;font-weight:700">${esc(info.name || 'Homeowner')} Picked ${times.length > 1 ? `${times.length} Callback Windows` : 'a Callback Window'}</div>
    </div>
    <div style="padding:12px 22px 22px">
      ${sectionTable('Callback Details', rows.map(([k, v]) => [k, v, k === 'Phone' && telDigits ? { href: `tel:+1${telDigits}`, bold: true } : {}]))}
    </div>
  </div></body></html>`;
  return deliver(subject, html, rows.map(r => r.join(': ')).join('\n'), rows);
}

// Someone typed a valid phone number but never pressed send.
async function notifyPartial(p) {
  const telDigits = String(p.phone || '').replace(/\D/g, '');
  const attr = decodeAttribution({ ...p, source: p.form });
  const rows = [
    ['Note', 'Started the form with a valid phone number but left before submitting. Call manually only (no automated SMS consent yet).'],
    ['Name', p.name || 'Not entered yet'],
    ['Phone', p.phone, telDigits ? `tel:+1${telDigits}` : null],
    ['Property address', p.address],
    ['State / ZIP', [attr.propState, p.zip].filter(Boolean).join(' · ') || null],
    ['What happened', LABELS.loss_type[p.loss_type] || p.loss_type],
    ['Ownership', LABELS.owner[p.owner] || p.owner],
    ['Claim status', LABELS.claim_status[p.claim_status] || p.claim_status],
    ['Channel', attr.channel],
    ['Campaign', attr.campaignDisplay],
    ['Ad creative', attr.creativeDisplay],
    ['Form', attr.formLabel],
    ['Last active', ptTime(p.updated_at)],
    ['Landing URL', p.landing_url],
    ['Partial ID', p.pid],
  ].filter(r => r[1]);
  const tag = attr.propState ? `[${attr.marketBadge}] ` : '';
  const subject = `${tag}Unfinished Form — ${p.name || 'Homeowner'} · ${p.phone}`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0F172A">
  <div style="max-width:620px;margin:0 auto;background:#FFFFFF;border:1px solid #CBD5E1;border-top:4px solid #D97706;border-radius:8px;overflow:hidden">
    <div style="background:#0B1536;padding:18px 22px;color:#FFFFFF">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#FCD34D;margin-bottom:4px">BLUE STAR ADJUSTERS &middot; ABANDONED FORM LEAD</div>
      <div style="font-size:19px;font-weight:700">${esc(p.name || 'Homeowner')} &middot; ${esc(p.phone)}</div>
      <div style="font-size:13px;color:#CBD5E1;margin-top:4px">Entered phone number on the landing page without pressing submit. Manual phone follow-up only.</div>
    </div>
    <div style="padding:8px 22px 22px">
      ${sectionTable('Unfinished Form Summary', rows.map(([k, v, href]) => [k, v, href ? { href, bold: k === 'Phone' } : {}]))}
    </div>
  </div></body></html>`;
  return deliver(subject, html, rows.map(r => `${r[0]}: ${r[1]}`).join('\n'), rows.map(r => [r[0], r[1]]));
}

module.exports = { notifyLead, notifyCallback, notifyPartial, render, decodeAttribution, TO };
