'use strict';
// HubSpot CRM push. Each saved lead becomes (or updates) a contact matched on phone,
// plus a new deal in the "Blue Star Leads" pipeline at the "New lead" stage.
// Needs HUBSPOT_TOKEN (a private app token). Run scripts/hubspot-setup.js once first.
const API = 'https://api.hubapi.com';
const PIPELINE = (process.env.HUBSPOT_PIPELINE || 'Blue Star Leads').trim();
const STAGE = (process.env.HUBSPOT_STAGE || 'New lead').trim();

const LOSS = { fire: 'Fire', smoke: 'Smoke', water: 'Water', storm: 'Storm', denied: 'Denied claim', other: 'Other' };

// Where the lead came from, from the click IDs and UTMs the page saved on first touch.
function leadSource(l) {
  const src = String(l.utm_source || '').toLowerCase();
  if (l.fbclid || /^(fb|facebook|meta|ig|instagram)/.test(src)) return 'meta_ads';
  if (l.gclid || l.gbraid || l.wbraid || (src === 'google' && /cpc|paid|ppc/.test(String(l.utm_medium || '').toLowerCase()))) return 'google_ads';
  if (src) return 'other_utm';
  if (/google\.|bing\.|yahoo\.|duckduckgo\./.test(String(l.referrer || ''))) return 'organic_search';
  return 'direct';
}

async function hs(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_TOKEN.trim()}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${r.status} ${j.message || ''}`.slice(0, 250)); e.status = r.status; e.category = j.category; throw e; }
  return j;
}

// Pipeline and stage IDs, looked up by name once and cached.
let stageCache = null;
async function pipelineStage() {
  if (process.env.HUBSPOT_PIPELINE_ID && process.env.HUBSPOT_STAGE_ID) return { pipeline: process.env.HUBSPOT_PIPELINE_ID, stage: process.env.HUBSPOT_STAGE_ID };
  if (stageCache) return stageCache;
  const j = await hs('/crm/v3/pipelines/deals');
  const p = (j.results || []).find(x => x.label.toLowerCase() === PIPELINE.toLowerCase());
  const s = p && p.stages.find(x => x.label.toLowerCase() === STAGE.toLowerCase());
  if (!s) return null;
  return (stageCache = { pipeline: p.id, stage: s.id });
}

function contactProps(l) {
  const digits = String(l.phone || '').replace(/\D/g, '');
  const parts = String(l.name || '').trim().split(/\s+/);
  const segs = String(l.address || '').split(',').map(s => s.trim()).filter(Boolean);
  const zip = l.zip && /^\d{5}$/.test(l.zip) ? l.zip : '';
  const p = {
    firstname: parts[0] || '', lastname: parts.slice(1).join(' '),
    phone: digits.length === 10 ? '+1' + digits : l.phone,
    address: segs[0] || '', city: segs.length >= 3 ? segs[1] : '', zip,
    state: zip && +zip >= 90000 && +zip <= 96199 ? 'CA' : '',
    bs_phone_digits: digits,
    bs_lead_source: leadSource(l),
    bs_loss_type: l.loss_type || '', bs_claim_status: l.claim_status || '', bs_owner: l.owner || '',
    bs_form: l.source || 'quiz', bs_page_variant: l.page_variant || '',
    bs_property_address: l.address || '', bs_lead_id: String(l.public_id || ''),
    bs_utm_source: l.utm_source || '', bs_utm_medium: l.utm_medium || '', bs_utm_campaign: l.utm_campaign || '',
    bs_utm_term: l.utm_term || '', bs_utm_content: l.utm_content || '',
    bs_gclid: l.gclid || l.gbraid || l.wbraid || '', bs_fbclid: l.fbclid || '', bs_landing_url: l.landing_url || '',
  };
  if (l.email) p.email = l.email;
  for (const k of Object.keys(p)) if (p[k] === '' && !k.startsWith('bs_')) delete p[k];
  return p;
}

async function upsertContact(l) {
  const properties = contactProps(l);
  const up = (idProperty, id) => hs('/crm/v3/objects/contacts/batch/upsert', { method: 'POST', body: JSON.stringify({ inputs: [{ idProperty, id, properties }] }) });
  try { return (await up('bs_phone_digits', properties.bs_phone_digits)).results[0].id; }
  catch (e) {
    // Same email already on another contact: update that contact instead.
    if (l.email && (e.status === 409 || e.category === 'CONFLICT')) { delete properties.bs_phone_digits; return (await up('email', l.email)).results[0].id; }
    throw e;
  }
}

async function createDeal(l, contactId, ps) {
  const where = (String(l.address || '').split(',')[1] || l.zip || '').trim();
  const lines = [
    `Loss: ${LOSS[l.loss_type] || l.loss_type || ''}`, `Claim: ${l.claim_status || ''}`, `Owner: ${l.owner || ''}`,
    `Address: ${l.address || ''}`, `Form: ${l.source || 'quiz'} (${l.page_variant || 'default'})`, l.notes ? `Notes: ${l.notes}` : '',
  ].filter(Boolean);
  const j = await hs('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        dealname: [l.name, LOSS[l.loss_type], where].filter(Boolean).join(' - ').slice(0, 200),
        pipeline: ps.pipeline, dealstage: ps.stage, description: lines.join('\n'),
        bs_lead_id: String(l.public_id), bs_lead_source: leadSource(l), bs_loss_type: l.loss_type || '',
        bs_form: l.source || 'quiz', bs_page_variant: l.page_variant || '',
      },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }],
    }),
  });
  return j.id;
}

// Returns a short status for the leads table.
async function pushLead(l) {
  if (!(process.env.HUBSPOT_TOKEN || '').trim()) return 'skipped: no HUBSPOT_TOKEN';
  if (!l.public_id) return 'skipped: no lead id';
  let contactId;
  try { contactId = await upsertContact(l); } catch (e) { return `failed contact: ${e.message}`.slice(0, 300); }
  try {
    const ps = await pipelineStage();
    if (!ps) return `contact ${contactId}; no deal: pipeline "${PIPELINE}" / stage "${STAGE}" not found`;
    return `contact ${contactId}; deal ${await createDeal(l, contactId, ps)}`;
  } catch (e) { return `contact ${contactId}; failed deal: ${e.message}`.slice(0, 300); }
}

// Call times picked on the thank-you page go onto the deal.
async function addCallback(publicId, slot) {
  if (!(process.env.HUBSPOT_TOKEN || '').trim()) return;
  await hs(`/crm/v3/objects/deals/${encodeURIComponent(publicId)}?idProperty=bs_lead_id`, { method: 'PATCH', body: JSON.stringify({ properties: { bs_callback_slot: slot } }) });
}

module.exports = { pushLead, addCallback, leadSource, contactProps };
