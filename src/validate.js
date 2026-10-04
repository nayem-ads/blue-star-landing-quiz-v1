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
  for (const k of ['loss_type', 'claim_status', 'loss_timing']) {
    if (!LABELS[k][b[k]]) errors[k] = 'Please choose an answer.';
    else out[k] = b[k];
  }
  const name = clip(b.name, 80).replace(/\s+/g, ' ');
  if (name.length < 2 || !/[a-zA-Z]/.test(name)) errors.name = 'Please enter your name.';
  out.name = name;

  let digits = String(b.phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits) || /^(\d)\1{9}$/.test(digits)) errors.phone = 'Please enter a 10 digit US mobile number.';
  out.phone = digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;

  const zip = String(b.zip || '').replace(/\D/g, '').slice(0, 5);
  if (zip.length !== 5) errors.zip = 'Please enter a 5 digit ZIP code.';
  out.zip = zip;

  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'page_variant']) out[k] = clip(b[k], 300) || null;
  out.landing_url = clip(b.landing_url, 1000) || null;
  out.referrer = clip(b.referrer, 1000) || null;
  const s = Number(b.elapsed_ms);
  out.seconds_to_submit = Number.isFinite(s) ? Math.round(s / 1000) : null;
  return { ok: Object.keys(errors).length === 0, errors, lead: out };
}

module.exports = { LABELS, validateLead };
