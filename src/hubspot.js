'use strict';
// HubSpot CRM push + inbound Lead Ad / HubSpot Form -> Resend email notification sync.
// Outbound: each website lead becomes (or updates) a contact matched on phone + a deal in "Blue Star Leads" ("New lead").
// Inbound: polls HubSpot for new Meta Instant Form / HubSpot Form contacts, logs them in Postgres, creates a "Blue Star Leads" deal,
// stamps bs_lead_id to prevent duplicates, and sends the exact same rich HTML notification email to Mike + CC Nayem.
const API_BASE = () => (process.env.HUBSPOT_API || 'https://api.hubapi.com').replace(/\/+$/, '');
const PIPELINE = (process.env.HUBSPOT_PIPELINE || 'Blue Star Leads').trim();
const STAGE = (process.env.HUBSPOT_STAGE || 'New lead').trim();
const PORTAL_URL = 'https://app-eu1.hubspot.com/contacts/149045473/record';
const DEFAULT_SYNC_SINCE = '2026-11-08T03:30:00.000Z';

const LOSS = { fire: 'Fire', smoke: 'Smoke', water: 'Water', storm: 'Hail / Storm', hail: 'Hail', denied: 'Denied claim', other: 'Other' };
const SAFE_FORMS = new Set(['quiz', 'contact', 'form']);
const SAFE_LOSS = new Set(['fire', 'smoke', 'water', 'storm', 'denied', 'other']);
const SAFE_OWNER = new Set(['own_home', 'landlord']);

const US_STATES = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA',
  washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
};

const KNOWN_LEAD_AD_PROPS = {
  do_you_own_the_damaged_property: 'Do you own the damaged property?',
  what_happened_to_your_property: 'What happened to your property?',
  is_this_your_property: 'Is this your property?',
  what_happened: 'What happened?',
  what_kind_of_damage: 'What kind of damage?',
  when_did_the_damage_happen: 'When did the damage happen?',
  where_is_your_claim_right_now: 'Where is your claim right now?',
};

function zipState(zip) {
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

function normalizeState(raw, zip) {
  const s = String(raw || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const mapped = US_STATES[s.toLowerCase()];
  if (mapped) return mapped;
  return zipState(zip);
}

// Where the lead came from, from the click IDs and UTMs the page saved on first touch.
function leadSource(l) {
  if (l.source === 'instant_form') return 'meta_ads';
  const src = String(l.utm_source || '').toLowerCase();
  if (l.fbclid || /^(fb|facebook|meta|ig|instagram)/.test(src)) return 'meta_ads';
  if (l.gclid || l.gbraid || l.wbraid || (src === 'google' && /cpc|paid|ppc/.test(String(l.utm_medium || '').toLowerCase()))) return 'google_ads';
  if (src) return 'other_utm';
  if (/google\.|bing\.|yahoo\.|duckduckgo\./.test(String(l.referrer || ''))) return 'organic_search';
  return 'direct';
}

function hsLossEnum(lossType) {
  if (!lossType) return '';
  if (lossType === 'hail') return 'storm';
  return SAFE_LOSS.has(lossType) ? lossType : 'other';
}

function hsFormEnum(source) {
  return SAFE_FORMS.has(source) ? source : 'form';
}

async function hs(path, opts = {}) {
  const r = await fetch(API_BASE() + path, {
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
    state: normalizeState(l.property_state, zip),
    bs_phone_digits: digits,
    bs_lead_source: leadSource(l),
    bs_loss_type: hsLossEnum(l.loss_type),
    bs_claim_status: l.claim_status || '',
    bs_owner: SAFE_OWNER.has(l.owner) ? l.owner : '',
    bs_form: hsFormEnum(l.source || 'quiz'),
    bs_page_variant: l.page_variant || (SAFE_FORMS.has(l.source) ? '' : (l.source || '')),
    bs_property_address: l.address || '', bs_lead_id: String(l.public_id || ''),
    bs_utm_source: l.utm_source || '', bs_utm_medium: l.utm_medium || '', bs_utm_campaign: l.utm_campaign || '',
    bs_utm_term: l.utm_term || '', bs_utm_content: l.utm_content || '',
    bs_gclid: l.gclid || l.gbraid || l.wbraid || '', bs_fbclid: l.fbclid || '', bs_landing_url: l.landing_url || '',
  };
  if (l.email) p.email = l.email;
  for (const k of Object.keys(p)) {
    if (p[k] === '' && (!k.startsWith('bs_') || k === 'bs_owner' || k === 'bs_loss_type' || k === 'bs_claim_status')) delete p[k];
  }
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
  const lossName = l.loss_label || LOSS[l.loss_type] || l.loss_type || 'Claim Review';
  const lines = [
    `Loss: ${lossName}`,
    l.claim_status ? `Claim: ${l.claim_status}` : '',
    l.owner ? `Owner: ${l.owner}` : '',
    l.address ? `Address: ${l.address}` : '',
    l.phone ? `Phone: ${l.phone}` : '',
    l.email ? `Email: ${l.email}` : '',
    `Form: ${l.source || 'quiz'} (${l.form_location || l.page_variant || 'default'})`,
    l.notes ? `Notes: ${l.notes}` : '',
  ].filter(Boolean);
  const props = {
    dealname: [l.name, LOSS[l.loss_type] || lossName, where].filter(Boolean).join(' - ').slice(0, 200),
    pipeline: ps.pipeline, dealstage: ps.stage, description: lines.join('\n'),
    bs_lead_id: String(l.public_id), bs_lead_source: leadSource(l),
    bs_form: hsFormEnum(l.source || 'quiz'),
    bs_page_variant: l.page_variant || (SAFE_FORMS.has(l.source) ? '' : (l.source || '')),
  };
  const lossEnum = hsLossEnum(l.loss_type);
  if (lossEnum) props.bs_loss_type = lossEnum;
  const j = await hs('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties: props,
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

// Page B step 3: claim status (and optional street address) lands after the contact exists. Contact is matched on phone digits.
async function setClaimStatus(phone, claimStatus, address) {
  if (!(process.env.HUBSPOT_TOKEN || '').trim()) return 'skipped: no HUBSPOT_TOKEN';
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length !== 10) return 'skipped: no phone';
  const properties = { bs_claim_status: claimStatus };
  const cleanAddr = typeof address === 'string' ? address.trim().slice(0, 200) : '';
  if (cleanAddr.length >= 4 && !/^ZIP\s+\d{5}$/i.test(cleanAddr)) {
    const segs = cleanAddr.split(',').map(s => s.trim()).filter(Boolean);
    properties.bs_property_address = cleanAddr;
    if (segs[0]) properties.address = segs[0];
    if (segs.length >= 3 && segs[1]) properties.city = segs[1];
  }
  await hs(`/crm/v3/objects/contacts/${digits}?idProperty=bs_phone_digits`, { method: 'PATCH', body: JSON.stringify({ properties }) });
  return 'updated';
}

// Page B step 4: a note on the deal listing the uploaded files with download links.
async function addFilesNote(publicId, files) {
  if (!(process.env.HUBSPOT_TOKEN || '').trim()) return 'skipped: no HUBSPOT_TOKEN';
  const deal = await hs(`/crm/v3/objects/deals/${encodeURIComponent(publicId)}?idProperty=bs_lead_id`);
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const mb = n => (n / 1048576).toFixed(n < 1048576 ? 2 : 1) + ' MB';
  const body = `<p><b>Files from the lead (${files.length})</b></p><ul>${files.map(f => `<li><a href="${esc(f.url)}">${esc(f.name)}</a> (${mb(f.size)})</li>`).join('')}</ul>`;
  const j = await hs('/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify({
      properties: { hs_timestamp: new Date().toISOString(), hs_note_body: body },
      associations: [{ to: { id: deal.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }] }],
    }),
  });
  return `note ${j.id}`;
}

// ---------- Inbound HubSpot Lead Ads / Form Sync -> Rich Email Notification ----------

function cleanLeadAdText(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.includes('_') && !s.includes(' ')) {
    const spaced = s.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).replace(/\bhvac\b/gi, 'HVAC').replace(/\bhoa\b/gi, 'HOA');
  }
  return s;
}

function formatUsPhone(raw) {
  const s = String(raw || '').trim();
  if (!s) return { formatted: '', digits10: '' };
  let digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length === 10) {
    return { formatted: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`, digits10: digits };
  }
  return { formatted: s.slice(0, 40), digits10: '' };
}

function extractZip5(rawZip, rawStreet) {
  const z = String(rawZip || '').trim();
  const m1 = z.match(/^(\d{5})(?:-\d{4})?$/);
  if (m1) return m1[1];
  const s = String(rawStreet || '').replace(/^\s*\d+[a-zA-Z]?\b/, '');
  const m2 = s.match(/\b(\d{5})\b/g);
  return m2 ? m2[m2.length - 1] : '';
}

function buildFullAddress(props, zip, st) {
  const rawStreet = String(props.address || props.property_address || props.bs_property_address || '').trim().replace(/\s+/g, ' ');
  const street = /^ZIP\s+\d{5}$/i.test(rawStreet) ? '' : rawStreet;
  const city = String(props.city || '').trim().replace(/\s+/g, ' ');
  const parts = [];
  if (street) parts.push(street);
  if (city && (!street || !street.toLowerCase().includes(city.toLowerCase()))) parts.push(city);
  const stateZip = [st, zip].filter(Boolean).join(' ');
  if (stateZip) {
    const alreadyHas = street && zip && street.includes(zip) && (!st || new RegExp(`\\b${st}\\b`, 'i').test(street));
    if (!alreadyHas) parts.push(stateZip);
  }
  return parts.join(', ').slice(0, 200) || null;
}

function hasAnyLeadAdAnswer(props, propLabels) {
  const names = Object.keys(propLabels || KNOWN_LEAD_AD_PROPS);
  return names.some(k => String(props[k] || '').trim() !== '');
}

function contactEventTimestampMs(props) {
  const candidates = [
    props.recent_conversion_date,
    props.hs_latest_source_timestamp,
    props.createdate,
  ];
  let best = 0;
  for (const c of candidates) {
    const t = c ? Date.parse(c) : NaN;
    if (Number.isFinite(t) && t > best) best = t;
  }
  return best;
}

// Strict filter so EMAIL_INTEGRATION inbox noise, Excel imports, and website-pushed leads NEVER trigger duplicate/bogus emails.
function isEligibleHubSpotLead(contact, cutoffMs, propLabels = KNOWN_LEAD_AD_PROPS) {
  if (!contact || !contact.id || !contact.properties) return false;
  const p = contact.properties;
  // 1. Any lead pushed by our website or already synced by this poller has bs_lead_id set.
  if (String(p.bs_lead_id || '').trim()) return false;

  // 2. Must have a phone or email to contact.
  const { formatted: phone } = formatUsPhone(p.phone || p.mobilephone || p.hs_calculated_phone_number);
  const email = String(p.email || '').trim();
  if (!phone && !email) return false;

  const objSrc = String(p.hs_object_source || '').toUpperCase();
  const latestSrc = String(p.hs_latest_source || '').toUpperCase();
  const origSrc = String(p.hs_analytics_source || '').toUpperCase();
  const convEvent = String(p.recent_conversion_event_name || p.first_conversion_event_name || '');
  const hasLeadAd = hasAnyLeadAdAnswer(p, propLabels);
  const hasNov8FormAnswer = Boolean(String(p.do_you_own_the_damaged_property || '').trim() || String(p.what_happened_to_your_property || '').trim());
  const isPaidSocialOrAd = objSrc === 'ADS' || latestSrc === 'PAID_SOCIAL' || origSrc === 'PAID_SOCIAL' || /facebook lead ad|instant form|lead ad/i.test(convEvent);
  const isNativeForm = objSrc === 'FORM' && !/bluestaradjusters\.com/i.test(String(p.hs_latest_source_data_1 || '')) && !/Email Capture \(hidden\)/i.test(convEvent);

  // 3. Reject inbox sync, imports, and API integrations unless the contact subsequently submitted a Lead Ad.
  if (['EMAIL_INTEGRATION', 'IMPORT', 'INTEGRATION', 'CRM_UI'].includes(objSrc) && !hasLeadAd && !(latestSrc === 'PAID_SOCIAL' && /lead ad|facebook/i.test(convEvent))) {
    return false;
  }
  if (!hasLeadAd && !isPaidSocialOrAd && !isNativeForm) return false;

  // 4. Cutoff guard so historical pre-launch contacts are never emailed.
  const eventTs = contactEventTimestampMs(p);
  if (cutoffMs && eventTs > 0 && eventTs < cutoffMs && !hasNov8FormAnswer) return false;
  if (cutoffMs && eventTs === 0 && !hasNov8FormAnswer) return false;

  return true;
}

function parseHubSpotContactToLead(contact, propLabels = KNOWN_LEAD_AD_PROPS) {
  const p = (contact && contact.properties) || {};
  const first = String(p.firstname || '').trim();
  const last = String(p.lastname || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    || String(p.hs_full_name_or_email || p.email || 'HubSpot Lead').trim().slice(0, 80);

  const { formatted: phone } = formatUsPhone(p.phone || p.mobilephone || p.hs_calculated_phone_number);
  const emailRaw = String(p.email || '').trim().slice(0, 200);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw) ? emailRaw : null;

  const zip = extractZip5(p.zip, p.address || p.property_address);
  const propState = normalizeState(p.state, zip);
  const address = buildFullAddress(p, zip, propState);

  // Ownership (Q1)
  const rawOwner = cleanLeadAdText(p.do_you_own_the_damaged_property || p.is_this_your_property || '');
  let owner = null, ownerLabel = null;
  if (rawOwner) {
    if (/\b(rent|renter|tenant|lease)\b|^no\b/i.test(rawOwner)) {
      owner = 'rent';
      ownerLabel = `Renter (${rawOwner})`;
    } else if (/commercial|landlord|business|hoa/i.test(rawOwner)) {
      owner = 'landlord';
      ownerLabel = rawOwner;
    } else if (/yes|own|homeowner/i.test(rawOwner)) {
      owner = 'own_home';
      ownerLabel = rawOwner;
    } else {
      ownerLabel = rawOwner;
    }
  }

  // Damage / Peril (Q2)
  const rawWhat = cleanLeadAdText(p.what_happened_to_your_property || p.what_happened || p.what_kind_of_damage || '');
  let lossType = 'other';
  if (/hail|wind|roof|storm|tree/i.test(rawWhat)) lossType = 'hail';
  else if (/fire|wildfire/i.test(rawWhat)) lossType = 'fire';
  else if (/smoke|soot|ash/i.test(rawWhat)) lossType = 'smoke';
  else if (/water|pipe|leak|flood/i.test(rawWhat)) lossType = 'water';
  else if (/denied|lowball|underpaid|offer/i.test(rawWhat)) lossType = 'denied';

  // Optional legacy/future Lead Ad questions
  const rawClaim = cleanLeadAdText(p.where_is_your_claim_right_now || '');
  let claimStatus = null;
  if (rawClaim) {
    if (/denied/i.test(rawClaim)) claimStatus = 'denied';
    else if (/low|offer|check|underpaid/i.test(rawClaim)) claimStatus = 'low_offer';
    else if (/wait|filed|open/i.test(rawClaim)) claimStatus = 'waiting';
    else if (/not|haven/i.test(rawClaim)) claimStatus = 'not_filed';
  }

  const rawWhen = cleanLeadAdText(p.when_did_the_damage_happen || '');
  let lossTiming = null;
  if (rawWhen) {
    if (/year/i.test(rawWhen)) lossTiming = 'over_year';
    else if (/6.*12/i.test(rawWhen)) lossTiming = 'm6_12';
    else if (/1.*6/i.test(rawWhen)) lossTiming = 'm1_6';
    else if (/month|week|day|recent/i.test(rawWhen)) lossTiming = 'month';
  }

  // Capture any additional custom lead_ads answers or message into notes so zero details are lost.
  const handledKeys = new Set([
    'do_you_own_the_damaged_property', 'is_this_your_property',
    'what_happened_to_your_property', 'what_happened', 'what_kind_of_damage',
    'where_is_your_claim_right_now', 'when_did_the_damage_happen',
  ]);
  const extraLines = [];
  for (const [k, label] of Object.entries(propLabels || KNOWN_LEAD_AD_PROPS)) {
    if (handledKeys.has(k)) continue;
    const val = cleanLeadAdText(p[k]);
    if (val) extraLines.push(`${label || k}: ${val}`);
  }
  if (p.message && String(p.message).trim()) extraLines.push(String(p.message).trim());
  const notes = extraLines.length ? extraLines.join(' | ').slice(0, 1000) : null;

  // Attribution
  const objSrc = String(p.hs_object_source || '').toUpperCase();
  const latestSrc = String(p.hs_latest_source || '').toUpperCase();
  const origSrc = String(p.hs_analytics_source || '').toUpperCase();
  const convEvent = String(p.recent_conversion_event_name || p.first_conversion_event_name || '').trim();
  const hasLeadAd = hasAnyLeadAdAnswer(p, propLabels);
  const isLeadAd = hasLeadAd || objSrc === 'ADS' || latestSrc === 'PAID_SOCIAL' || origSrc === 'PAID_SOCIAL' || /facebook lead ad|instant form|lead ad/i.test(convEvent);

  const rawFormName = (convEvent || String(p.hs_object_source_detail_1 || '').trim())
    .replace(/^Facebook Lead Ads:\s*/i, '')
    .trim();

  const ignoreData = v => !v || /^(INTEGRATION|IMPORT|EMAIL_INTEGRATION|OnboardingDataSync|\d{5,9})$/i.test(String(v).trim());
  const campCandidate = [p.hs_latest_source_data_2, p.hs_analytics_source_data_2, p.hs_object_source_detail_2]
    .map(v => String(v || '').trim())
    .find(v => !ignoreData(v)) || (isLeadAd ? '120248897062050534' : '');
  const contentCandidate = String(p.hs_object_source_detail_3 || '').trim();
  const platformCandidate = [p.hs_latest_source_data_1, p.hs_analytics_source_data_1]
    .map(v => String(v || '').trim())
    .find(v => !ignoreData(v) && !/^https?:\/\/|bluestaradjusters\.com/i.test(v)) || '';

  const eventTs = contactEventTimestampMs(p);
  const contactId = String(contact.id);

  return {
    source: isLeadAd ? 'instant_form' : 'hubspot',
    page_variant: isLeadAd ? 'instant_form' : 'hubspot',
    form_location: rawFormName || (isLeadAd ? 'BSA | Homeowner & Commercial Claim Check' : 'HubSpot Form'),
    loss_type: lossType,
    loss_label: rawWhat || null,
    owner: owner,
    owner_label: ownerLabel,
    claim_status: claimStatus,
    loss_timing: lossTiming,
    name: fullName.slice(0, 80),
    phone: phone || 'Not provided',
    email,
    address,
    property_state: propState || null,
    zip: zip || null,
    notes,
    utm_source: isLeadAd ? (platformCandidate ? platformCandidate.toLowerCase() : 'meta') : (latestSrc === 'PAID_SEARCH' ? 'google' : 'hubspot'),
    utm_medium: isLeadAd ? 'instant_form' : 'hubspot_form',
    utm_campaign: campCandidate ? campCandidate.slice(0, 300) : null,
    utm_term: null,
    utm_content: contentCandidate ? contentCandidate.slice(0, 300) : null,
    gclid: String(p.hs_google_click_id || '').trim().slice(0, 300) || null,
    fbclid: String(p.hs_facebook_click_id || '').trim().slice(0, 300) || null,
    landing_url: null,
    referrer: null,
    is_spam: false,
    hubspot_contact_id: contactId,
    hubspot_url: `${PORTAL_URL}/0-1/${encodeURIComponent(contactId)}`,
    created_at: eventTs ? new Date(eventTs).toISOString() : new Date().toISOString(),
  };
}

let leadAdPropsCache = { at: 0, map: { ...KNOWN_LEAD_AD_PROPS } };
async function getLeadAdPropMap() {
  if (Date.now() - leadAdPropsCache.at < 15 * 60 * 1000) return leadAdPropsCache.map;
  try {
    const j = await hs('/crm/v3/properties/contacts');
    const next = { ...KNOWN_LEAD_AD_PROPS };
    for (const p of (j.results || [])) {
      if (p && p.groupName === 'lead_ads' && p.name) next[p.name] = p.label || p.name;
    }
    leadAdPropsCache = { at: Date.now(), map: next };
  } catch (_) {}
  return leadAdPropsCache.map;
}

async function contactHasPipelineDeal(contactId, pipelineId) {
  try {
    const assoc = await hs(`/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/deals`);
    const ids = (assoc.results || []).map(r => String(r.toObjectId || '')).filter(Boolean);
    if (!ids.length) return null;
    const batch = await hs('/crm/v3/objects/deals/batch/read', {
      method: 'POST',
      body: JSON.stringify({ properties: ['pipeline', 'dealname'], inputs: ids.slice(0, 20).map(id => ({ id })) }),
    });
    const found = (batch.results || []).find(d => d.properties && String(d.properties.pipeline) === String(pipelineId));
    return found ? String(found.id) : null;
  } catch (_) {
    return null;
  }
}

async function stampHubSpotContact(contactId, lead, publicId) {
  const props = {
    bs_lead_id: String(publicId),
    bs_lead_source: leadSource(lead),
    bs_form: 'form',
    bs_page_variant: lead.source || 'instant_form',
  };
  const lossEnum = hsLossEnum(lead.loss_type);
  if (lossEnum) props.bs_loss_type = lossEnum;
  if (SAFE_OWNER.has(lead.owner)) props.bs_owner = lead.owner;
  if (lead.address) props.bs_property_address = lead.address;
  await hs(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: props }),
  });
  const digits = String(lead.phone || '').replace(/\D/g, '');
  if (digits.length === 10) {
    await hs(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: { bs_phone_digits: digits } }),
    }).catch(() => {});
  }
}

const processedContactIds = new Set();
let syncInFlight = false;
const syncState = { lastSyncAt: null, lastError: null, totalSynced: 0 };

function syncStatus() {
  return {
    configured: Boolean((process.env.HUBSPOT_TOKEN || '').trim()) && process.env.HUBSPOT_LEAD_SYNC !== 'off',
    since: (process.env.HUBSPOT_SYNC_SINCE || DEFAULT_SYNC_SINCE).trim(),
    last_sync_at: syncState.lastSyncAt,
    last_error: syncState.lastError,
    total_synced: syncState.totalSynced,
  };
}

async function syncLeadAds({ db, notifyLead, immediate = false } = {}) {
  if (!(process.env.HUBSPOT_TOKEN || '').trim() || process.env.HUBSPOT_LEAD_SYNC === 'off') {
    return { ok: true, skipped: 'disabled_or_unconfigured', checked: 0, synced: 0 };
  }
  if (syncInFlight) return { ok: true, skipped: 'in_flight', checked: 0, synced: 0 };
  syncInFlight = true;

  const sinceIso = (process.env.HUBSPOT_SYNC_SINCE || DEFAULT_SYNC_SINCE).trim();
  const cutoffMs = Date.parse(sinceIso) || Date.parse(DEFAULT_SYNC_SINCE);
  const lookbackMs = Math.max(cutoffMs, Date.now() - 48 * 3600 * 1000);
  const minAgeMs = immediate ? 0 : Number(process.env.HUBSPOT_MIN_AGE_MS ?? 15000);

  let checked = 0, synced = 0;
  try {
    const propMap = await getLeadAdPropMap();
    const propsToFetch = [
      'firstname', 'lastname', 'hs_full_name_or_email', 'email', 'phone', 'mobilephone', 'hs_calculated_phone_number',
      'address', 'property_address', 'bs_property_address', 'city', 'state', 'zip', 'message',
      'createdate', 'lastmodifieddate', 'recent_conversion_date', 'recent_conversion_event_name', 'first_conversion_event_name',
      'hs_object_source', 'hs_object_source_id', 'hs_object_source_detail_1', 'hs_object_source_detail_2', 'hs_object_source_detail_3',
      'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
      'hs_latest_source', 'hs_latest_source_data_1', 'hs_latest_source_data_2', 'hs_latest_source_timestamp',
      'hs_facebook_click_id', 'hs_google_click_id', 'num_associated_deals',
      'bs_lead_id', 'bs_form', 'bs_owner', 'bs_loss_type',
      ...Object.keys(propMap),
    ];

    const sinceStr = String(lookbackMs);
    const searchRes = await hs('/crm/v3/objects/contacts/search', {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [
          { filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: sinceStr }, { propertyName: 'hs_object_source', operator: 'EQ', value: 'ADS' }] },
          { filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: sinceStr }, { propertyName: 'hs_latest_source', operator: 'EQ', value: 'PAID_SOCIAL' }] },
          { filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: sinceStr }, { propertyName: 'do_you_own_the_damaged_property', operator: 'HAS_PROPERTY' }] },
          { filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: sinceStr }, { propertyName: 'what_happened_to_your_property', operator: 'HAS_PROPERTY' }] },
          { filters: [{ propertyName: 'lastmodifieddate', operator: 'GTE', value: sinceStr }, { propertyName: 'hs_object_source', operator: 'EQ', value: 'FORM' }] },
        ],
        properties: [...new Set(propsToFetch)],
        sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
        limit: 50,
      }),
    });

    const contacts = searchRes.results || [];
    checked = contacts.length;

    for (const contact of contacts) {
      const cid = String(contact.id || '');
      if (!cid || processedContactIds.has(cid)) continue;
      if (!isEligibleHubSpotLead(contact, cutoffMs, propMap)) continue;

      // Give HubSpot 15s to finish asynchronous attribution enrichment on brand-new submissions.
      const eventTs = contactEventTimestampMs(contact.properties || {});
      if (minAgeMs > 0 && eventTs > 0 && Date.now() - eventTs < minAgeMs) continue;

      // Check PostgreSQL deduplication by HubSpot contact ID first.
      if (db && typeof db.findByHubSpotId === 'function') {
        const existingByHs = await db.findByHubSpotId(cid).catch(() => null);
        if (existingByHs) {
          processedContactIds.add(cid);
          await stampHubSpotContact(cid, parseHubSpotContactToLead(contact, propMap), existingByHs.public_id).catch(() => {});
          continue;
        }
      }

      const lead = parseHubSpotContactToLead(contact, propMap);

      // If this exact 10-digit phone already submitted through the website in the last 24h, link without sending a duplicate email.
      const phoneDigits = String(lead.phone || '').replace(/\D/g, '');
      if (phoneDigits.length === 10 && db && typeof db.hasLead === 'function') {
        const recentWebsiteLead = await db.hasLead(lead.phone).catch(() => false);
        if (recentWebsiteLead) {
          processedContactIds.add(cid);
          const dupId = (typeof db.findRecent === 'function' && await db.findRecent(lead.phone).catch(() => null)) || `dup-phone-${cid}`;
          await stampHubSpotContact(cid, lead, dupId).catch(() => {});
          console.log('[hubspot-sync] linked existing phone lead without duplicate email:', cid, lead.phone);
          continue;
        }
      }

      // Insert into PostgreSQL leads table.
      let saved = { ...lead, public_id: `hs-${cid}` };
      if (db && typeof db.insertLead === 'function') {
        try {
          const inserted = await db.insertLead(lead);
          saved = { ...lead, ...inserted };
          if (typeof db.setSyncStatus === 'function') {
            await db.setSyncStatus(saved.public_id, 'capi_status', lead.source === 'instant_form' ? 'n/a: meta_instant_form' : 'n/a: hubspot_form').catch(() => {});
          }
        } catch (e) {
          if (/duplicate key|unique/i.test(e.message)) {
            processedContactIds.add(cid);
            continue;
          }
          console.error('[hubspot-sync] db insert failed:', e.message);
        }
      }

      processedContactIds.add(cid);
      if (processedContactIds.size > 5000) {
        const firstKey = processedContactIds.values().next().value;
        processedContactIds.delete(firstKey);
      }

      // Ensure a Deal exists in "Blue Star Leads" ("New lead") for qualified owners/commercial leads.
      let dealId = null;
      let hsStatus = `synced from contact ${cid}`;
      if (lead.owner !== 'rent') {
        try {
          const ps = await pipelineStage();
          if (ps) {
            const hasDeals = Number((contact.properties || {}).num_associated_deals || 0) > 0;
            dealId = hasDeals ? await contactHasPipelineDeal(cid, ps.pipeline) : null;
            if (!dealId) {
              dealId = await createDeal(saved, cid, ps);
            }
            hsStatus = `synced contact ${cid}; deal ${dealId}`;
          }
        } catch (e) {
          hsStatus = `synced contact ${cid}; failed deal: ${e.message}`.slice(0, 300);
          console.error('[hubspot-sync] createDeal failed:', e.message);
        }
      } else {
        hsStatus = `synced contact ${cid}; skipped deal (renter)`;
      }

      // Stamp bs_lead_id back onto HubSpot contact so future polls or container restarts skip it immediately.
      await stampHubSpotContact(cid, saved, saved.public_id).catch(e => console.warn('[hubspot-sync] stamp contact warning:', e.message));
      if (db && typeof db.setSyncStatus === 'function' && !String(saved.public_id).startsWith('hs-')) {
        await db.setSyncStatus(saved.public_id, 'hubspot_status', hsStatus).catch(() => {});
      }

      const enrichedLead = {
        ...saved,
        loss_label: lead.loss_label,
        owner_label: lead.owner_label,
        form_location: lead.form_location,
        property_state: lead.property_state,
        hubspot_contact_id: cid,
        hubspot_url: `${PORTAL_URL}/0-1/${encodeURIComponent(cid)}`,
        hubspot_deal_id: dealId,
        hubspot_deal_url: dealId ? `${PORTAL_URL}/0-3/${encodeURIComponent(dealId)}` : null,
      };

      // Deliver exact same Resend HTML email to mike@bluestaradjusters.com + CC nayem.adsmanager@gmail.com!
      if (typeof notifyLead === 'function') {
        try {
          const emailStatus = await notifyLead(enrichedLead).catch(async () => {
            await new Promise(r => setTimeout(r, 1500));
            return notifyLead(enrichedLead);
          });
          if (db && typeof db.setEmailStatus === 'function' && !String(saved.public_id).startsWith('hs-')) {
            await db.setEmailStatus(saved.public_id, emailStatus, null).catch(() => {});
          }
          console.log('[hubspot-sync] notified', saved.public_id, cid, emailStatus);
        } catch (e) {
          console.error('[hubspot-sync] email failed', cid, e.message);
          if (db && typeof db.setEmailStatus === 'function' && !String(saved.public_id).startsWith('hs-')) {
            await db.setEmailStatus(saved.public_id, 'failed', e.message).catch(() => {});
          }
        }
      }
      synced++;
      syncState.totalSynced++;
    }

    syncState.lastSyncAt = new Date().toISOString();
    syncState.lastError = null;
    return { ok: true, checked, synced, lastSyncAt: syncState.lastSyncAt };
  } catch (e) {
    syncState.lastError = e.message;
    console.error('[hubspot-sync] poll error:', e.message);
    return { ok: false, error: e.message, checked, synced };
  } finally {
    syncInFlight = false;
  }
}

module.exports = {
  pushLead,
  addCallback,
  setClaimStatus,
  addFilesNote,
  leadSource,
  contactProps,
  syncLeadAds,
  syncStatus,
  isEligibleHubSpotLead,
  parseHubSpotContactToLead,
};
