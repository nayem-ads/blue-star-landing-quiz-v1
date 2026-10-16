'use strict';
// Allowed answers. Keys are what the page sends; labels are what the email shows.
const LABELS = {
  loss_type: { fire: 'Fire', smoke: 'Smoke damage', water: 'Water or a leak', denied: 'Claim denied', other: 'Something else' },
  claim_status: { not_filed: 'Haven’t filed yet', waiting: 'Filed, still waiting', low_offer: 'Got an offer, it looks low', denied: 'Denied, in full or in part' },
  loss_timing: { month: 'In the last month', m1_6: '1 to 6 months ago', m6_12: '6 to 12 months ago', over_year: 'Over a year ago' },
};

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function validateLead(b) {
  const errors = {};
  const out = {};
  // source 'contact' = bottom contact form: claim status and timing are optional there.
  const contact = b.source === 'contact';
  out.source = contact ? 'contact' : 'quiz';
  for (const k of ['loss_type', 'claim_status', 'loss_timing']) {
    if (LABELS[k][b[k]]) out[k] = b[k];
    else if (contact && k !== 'loss_type' && !b[k]) out[k] = null;
    else errors[k] = 'Please choose an answer.';
  }
  const email = clip(b.email, 200);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.email = 'Please check the email address.';
  out.email = email || null;
  out.notes = clip(b.notes, 1000) || null;
  const name = clip(b.name, 80).replace(/\s+/g, ' ');
  if (name.length < 2 || !/[a-zA-Z]/.test(name)) errors.name = 'Please enter your name.';
  out.name = name;

  let digits = String(b.phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits) || /^(\d)\1{9}$/.test(digits)) errors.phone = 'Please enter a 10 digit US mobile number.';
  out.phone = digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;

  // Contact form: property address is optional and replaces ZIP. Quiz still requires a 5 digit ZIP.
  // Property address is optional on both forms and replaces the ZIP field.
  out.address = clip(b.address, 200).replace(/\s+/g, ' ') || null;
  let zip = String(b.zip || '').replace(/\D/g, '').slice(0, 5);
  if (zip.length !== 5) {
    const m = (out.address || '').match(/\b(9\d{4})\b/); // pull a CA ZIP out of the address if one was typed
    zip = m ? m[1] : '';
  }
  out.zip = zip || null;

  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'page_variant']) out[k] = clip(b[k], 300) || null;
  out.landing_url = clip(b.landing_url, 1000) || null;
  out.referrer = clip(b.referrer, 1000) || null;
  const s = Number(b.elapsed_ms);
  out.seconds_to_submit = Number.isFinite(s) ? Math.round(s / 1000) : null;
  return { ok: Object.keys(errors).length === 0, errors, lead: out };
}

module.exports = { LABELS, validateLead };
