// One time HubSpot setup. Safe to run again: it only creates what is missing.
// HUBSPOT_TOKEN=pat-... node scripts/hubspot-setup.js
// Creates the "Blue Star lead" properties on contacts and deals, and the "Blue Star Leads" deal pipeline.
'use strict';
const TOKEN = (process.env.HUBSPOT_TOKEN || '').trim();
if (!TOKEN) { console.error('Set HUBSPOT_TOKEN first.'); process.exit(1); }
const API = 'https://api.hubapi.com';
async function hs(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
const opt = (pairs) => pairs.map(([value, label], i) => ({ value, label, displayOrder: i }));
const ENUMS = {
  bs_lead_source: opt([['meta_ads', 'Meta ads'], ['google_ads', 'Google ads'], ['organic_search', 'Organic search'], ['other_utm', 'Other tagged link'], ['direct', 'Direct or unknown']]),
  bs_loss_type: opt([['fire', 'Fire'], ['smoke', 'Smoke'], ['water', 'Water or leak'], ['storm', 'Storm or fallen tree'], ['denied', 'Claim denied'], ['other', 'Something else']]),
  bs_claim_status: opt([['not_filed', 'Not filed yet'], ['waiting', 'Filed, still waiting'], ['low_offer', 'Offer looks low'], ['denied', 'Denied']]),
  bs_owner: opt([['own_home', 'Owns the home'], ['landlord', 'Landlord or business owner']]),
  bs_form: opt([['quiz', 'Quiz'], ['contact', 'Contact form'], ['form', 'One screen form']]),
};
const TEXT = { bs_page_variant: 'Page variant', bs_property_address: 'Property address', bs_lead_id: 'Lead ID (landing page)', bs_utm_source: 'UTM source', bs_utm_medium: 'UTM medium', bs_utm_campaign: 'UTM campaign', bs_utm_term: 'UTM term', bs_utm_content: 'UTM content', bs_gclid: 'Google click ID', bs_fbclid: 'Meta click ID', bs_landing_url: 'Landing page URL', bs_callback_slot: 'Call times picked' };
const LABELS = { bs_lead_source: 'Lead source', bs_loss_type: 'Loss type', bs_claim_status: 'Claim status', bs_owner: 'Owner type', bs_form: 'Form' };

const CONTACT = ['bs_lead_source', 'bs_loss_type', 'bs_claim_status', 'bs_owner', 'bs_form', 'bs_page_variant', 'bs_property_address', 'bs_lead_id', 'bs_utm_source', 'bs_utm_medium', 'bs_utm_campaign', 'bs_utm_term', 'bs_utm_content', 'bs_gclid', 'bs_fbclid', 'bs_landing_url'];
const DEAL = ['bs_lead_source', 'bs_loss_type', 'bs_form', 'bs_page_variant', 'bs_lead_id', 'bs_callback_slot'];

async function ensureProp(obj, name, extra = {}) {
  const have = await hs(`/crm/v3/properties/${obj}/${name}`);
  if (have.ok) return console.log(`ok     ${obj}.${name} exists`);
  const def = ENUMS[name]
    ? { name, label: LABELS[name], type: 'enumeration', fieldType: 'select', groupName: 'blue_star_lead', options: ENUMS[name] }
    : { name, label: TEXT[name] || name, type: 'string', fieldType: 'text', groupName: 'blue_star_lead' };
  const r = await hs(`/crm/v3/properties/${obj}`, { method: 'POST', body: JSON.stringify({ ...def, ...extra }) });
  console.log(r.ok ? `made   ${obj}.${name}` : `FAILED ${obj}.${name}: ${r.status} ${r.j.message}`);
}

(async () => {
  for (const obj of ['contacts', 'deals']) {
    const g = await hs(`/crm/v3/properties/${obj}/groups`, { method: 'POST', body: JSON.stringify({ name: 'blue_star_lead', label: 'Blue Star lead', displayOrder: -1 }) });
    console.log(g.ok ? `made   ${obj} group` : g.status === 409 ? `ok     ${obj} group exists` : `FAILED ${obj} group: ${g.status} ${g.j.message}`);
  }
  // Phone digits is how a repeat lead finds the same contact; it has to be unique.
  await ensureProp('contacts', 'bs_phone_digits', { label: 'Phone digits (match key)', type: 'string', fieldType: 'text', groupName: 'blue_star_lead', hasUniqueValue: true });
  for (const n of CONTACT) await ensureProp('contacts', n);
  // Lead ID is unique on deals so call times can be added to the right deal later.
  for (const n of DEAL) await ensureProp('deals', n, n === 'bs_lead_id' ? { hasUniqueValue: true } : {});

  const pipes = await hs('/crm/v3/pipelines/deals');
  if (!pipes.ok) return console.log(`FAILED reading pipelines: ${pipes.status} ${pipes.j.message}`);
  const found = pipes.j.results.find(p => p.label === 'Blue Star Leads');
  if (found) return console.log('ok     pipeline "Blue Star Leads" exists:', found.stages.map(s => s.label).join(' > '));
  const st = (label, probability, displayOrder, isClosed = false) => ({ label, displayOrder, metadata: { probability: String(probability), ...(isClosed ? { isClosed: 'true' } : {}) } });
  const r = await hs('/crm/v3/pipelines/deals', { method: 'POST', body: JSON.stringify({
    label: 'Blue Star Leads', displayOrder: 0,
    stages: [st('New lead', 0.1, 0), st('Contacted', 0.2, 1), st('Qualified', 0.4, 2), st('Review booked', 0.6, 3), st('Signed', 1.0, 4, true), st('Lost', 0.0, 5, true)],
  }) });
  console.log(r.ok ? 'made   pipeline "Blue Star Leads"' : `FAILED pipeline: ${r.status} ${r.j.message}\n       Make it by hand in HubSpot: Settings > Objects > Deals > Pipelines. Stages: New lead, Contacted, Qualified, Review booked, Signed (won), Lost.`);
})();
