'use strict';
// Allowed answers. Keys are what the page sends; labels are what the email shows.
const LABELS = {
  loss_type: { fire: 'Fire', smoke: 'Smoke damage', water: 'Water or a leak', storm: 'Hail, storm or tree', hail: 'Hail or wind damage', denied: 'Claim denied', other: 'Something else' },
  claim_status: { not_filed: 'Haven’t filed yet', waiting: 'Filed, still waiting', low_offer: 'Got an offer, it looks low', denied: 'Denied, in full or in part' },
  owner: { own_home: 'Owns the home', landlord: 'Landlord or business owner', rent: 'Renter' },
  loss_timing: { month: 'In the last month', m1_6: '1 to 6 months ago', m6_12: '6 to 12 months ago', over_year: 'Over a year ago' },
};

const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

function validateLead(b) {
  const errors = {};
  const out = {};
  // source 'contact' = bottom contact form: claim status and timing are optional there.
  // source 'form' = Page B multi-step: the lead saves at the ownership answer, claim status comes one step later.
  const contact = b.source === 'contact';
  const pageB = b.source === 'form';
  out.source = contact ? 'contact' : pageB ? 'form' : 'quiz';
  for (const k of ['loss_type', 'claim_status']) {
    if (LABELS[k][b[k]]) out[k] = b[k];
    else if ((contact || pageB) && k !== 'loss_type' && !b[k]) out[k] = null;
    else errors[k] = pageB && k === 'loss_type' ? 'Please choose what happened.' : 'Please choose an answer.';
  }
  // The quiz no longer asks when the damage happened. Keep it if an old page sends it.
  out.loss_timing = LABELS.loss_timing[b.loss_timing] ? b.loss_timing : null;
  // Owners only. Renters are stopped on the page and refused here, so no lead is saved and no Lead event fires.
  if (b.owner === 'own_home' || b.owner === 'landlord') out.owner = b.owner;
  else errors.owner = b.owner === 'rent' ? 'We take building claims for property owners only.' : 'Please choose an answer.';
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

  // Property ZIP (5 digits) or address is required; never block a homeowner who enters their 5-digit ZIP on Step 1.
  let zip = String(b.zip || '').replace(/\D/g, '').slice(0, 5);
  const rawAddr = clip(b.address, 200).replace(/\s+/g, ' ');
  if (zip.length !== 5 && rawAddr) {
    if (/^\d{5}(?:-\d{4})?$/.test(rawAddr)) {
      zip = rawAddr.slice(0, 5);
    } else {
      const tail = rawAddr.replace(/^\s*\d+[a-zA-Z]?\b/, '');
      const m = tail.match(/\b(\d{5})\b/g);
      zip = m ? m[m.length - 1] : '';
    }
  }
  const address = rawAddr || (zip.length === 5 ? `ZIP ${zip}` : '');
  if (address.length < 2 || !/[a-zA-Z0-9]/.test(address)) {
    if (pageB && !rawAddr) errors.zip = 'Please enter the 5-digit property ZIP code.';
    else errors.address = 'Please enter the property address or 5-digit ZIP.';
  }
  out.address = address || null;
  out.zip = zip || null;

  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'page_variant']) out[k] = clip(b[k], 300) || null;
  out.landing_url = clip(b.landing_url, 1000) || null;
  out.referrer = clip(b.referrer, 1000) || null;
  // Meta browser cookies, passed to the Conversions API only (not stored).
  out.fbp = clip(b.fbp, 200) || null;
  out.fbc = clip(b.fbc, 500) || null;
  const s = Number(b.elapsed_ms);
  out.seconds_to_submit = Number.isFinite(s) ? Math.round(s / 1000) : null;
  return { ok: Object.keys(errors).length === 0, errors, lead: out };
}

// Unfinished form: only a valid US phone is required. Everything else is kept if present.
function validatePartial(b) {
  if (b.owner === 'rent') return null; // never alert on a renter
  let digits = String(b.phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10 || /^[01]/.test(digits) || /^(\d)\1{9}$/.test(digits)) return null;
  const out = { phone: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` };
  out.form = b.form === 'contact' ? 'contact' : b.form === 'form' ? 'form' : 'quiz';
  out.name = clip(b.name, 80).replace(/\s+/g, ' ') || null;
  out.address = clip(b.address, 200).replace(/\s+/g, ' ') || null;
  const zip = String(b.zip || '').replace(/\D/g, '').slice(0, 5);
  out.zip = zip.length === 5 ? zip : null;
  for (const k of ['loss_type', 'claim_status', 'loss_timing', 'owner']) out[k] = LABELS[k][b[k]] ? b[k] : null;
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'page_variant']) out[k] = clip(b[k], 300) || null;
  out.landing_url = clip(b.landing_url, 1000) || null;
  out.referrer = clip(b.referrer, 1000) || null;
  return out;
}

module.exports = { LABELS, validateLead, validatePartial };
