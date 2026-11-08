// Run against a running server: BASE=http://localhost:3000 ADMIN_KEY=... npm test
const BASE = process.env.BASE || 'http://localhost:3000';
const KEY = process.env.ADMIN_KEY || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const post = (p, b, h = {}) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });
const good = { loss_type: 'fire', owner: 'own_home', claim_status: 'low_offer', name: 'Test Lead', phone: '(916) 555-0199', zip: '95811', address: '1610 R St, Sacramento, CA 95811', elapsed_ms: 42000, utm_source: 'google', utm_campaign: 'fire-test', gclid: 'TEST123', page_variant: 'fire' };

(async () => {
  let r = await fetch(BASE + '/?lp=quiz');
  let t = await r.text();
  ok(r.status === 200 && t.includes('Home or business damaged?'), 'home renders default headline');
  ok(t.includes('name="viewport"') && t.includes('viewport-fit=cover'), 'viewport meta present');
  ok(t.includes('noindex'), 'noindex by default');
  t = await (await fetch(BASE + '/?lp=quiz&loss=denied')).text();
  ok(t.includes('Your claim was denied.') && t.includes('data-variant="denied"'), 'headline variant by ?loss=');
  r = await fetch(BASE + '/health'); ok(r.ok, 'health ok ' + JSON.stringify(await r.json()));
  r = await fetch(BASE + '/privacy'); ok(r.ok && (await r.text()).includes('Privacy notice'), 'privacy page');
  r = await fetch(BASE + '/fonts/sg-700.woff2'); ok(r.ok && /immutable/.test(r.headers.get('cache-control')), 'fonts cached immutable');

  r = await post('/api/lead', { ...good, phone: '123', zip: '9', name: '' }, { 'X-Real-IP': '10.0.0.1' });
  let j = await r.json(); ok(r.status === 400 && j.errors.phone && j.errors.name && !j.errors.zip, 'invalid fields rejected (ZIP no longer required)');

  r = await post('/api/lead', good, { 'X-Real-IP': '10.0.0.2' });
  j = await r.json(); ok(r.ok && j.ok && /^[0-9a-f-]{36}$/.test(j.id) && j.first_name === 'Test', 'valid lead saved ' + j.id);
  const id = j.id;

  r = await post(`/api/lead/${id}/callback`, { slot: 'Tue Oct 6, 11:00 AM PT' }, { 'X-Real-IP': '10.0.0.2' });
  ok(r.ok, 'callback slot saved');

  r = await post('/api/lead', { ...good, name: 'Bot Fast', elapsed_ms: 900 }, { 'X-Real-IP': '10.0.0.3' });
  ok(r.ok, 'fast bot gets a quiet ok');
  r = await post('/api/lead', { ...good, name: 'Bot Honey', company: 'x' }, { 'X-Real-IP': '10.0.0.4' });
  ok(r.ok, 'honeypot bot gets a quiet ok');

  r = await post('/api/lead', { source: 'contact', owner: 'own_home', loss_type: 'water', name: 'Contact Form', phone: '(916) 555-0166', address: '1610 R St, Sacramento 95811', email: 'test@example.com', notes: 'Ceiling leak', elapsed_ms: 30000 }, { 'X-Real-IP': '10.0.0.5' });
  j = await r.json(); ok(r.ok && j.ok, 'contact form lead saved (no claim status or timing)');
  r = await post('/api/lead', { source: 'contact', loss_type: 'water', name: 'Bad Email', phone: '(916) 555-0167', address: '2 Oak Ave, Davis 95616', email: 'nope', elapsed_ms: 30000 }, { 'X-Real-IP': '10.0.0.6' });
  j = await r.json(); ok(r.status === 400 && j.errors.email, 'contact form bad email rejected');
  r = await post('/api/lead', { source: 'contact', loss_type: 'fire', name: 'No Address', phone: '(916) 555-0168', elapsed_ms: 30000 }, { 'X-Real-IP': '10.0.0.7' });
  j = await r.json(); ok(r.status === 400 && j.errors.address, 'contact form without address rejected');
  r = await post('/api/lead', { ...good, name: 'No Number', phone: '(916) 555-0172', address: 'Main Street Sacramento' }, { 'X-Real-IP': '10.0.0.11' });
  j = await r.json(); ok(r.ok && j.ok, 'quiz address without street number accepted so no lead gets blocked');
  r = await post('/api/lead', { source: 'contact', owner: 'own_home', loss_type: 'fire', name: 'No Email', phone: '(916) 555-0173', address: '500 Capitol Mall, Sacramento, CA 95814', elapsed_ms: 30000 }, { 'X-Real-IP': '10.0.0.7' });
  j = await r.json(); ok(r.ok && j.ok, 'contact form lead saved with address, no ZIP, no email');
  r = await post(`/api/lead/${j.id}/callback`, { slots: ['Mon Oct 19, 9:30 AM PT', 'Mon Oct 19, 1:30 PM PT', 'Tue Oct 20, 11:00 AM PT'] }, { 'X-Real-IP': '10.0.0.7' });
  ok(r.ok, 'multiple call slots saved');
  r = await post(`/api/lead/${j.id}/callback`, { slots: [] }, { 'X-Real-IP': '10.0.0.7' });
  ok(r.status === 400, 'empty slots rejected');
  r = await post('/api/lead', { ...good, name: 'Quiz Address', phone: '(916) 555-0170', zip: '', address: '1 Main St, Oakland 94607' }, { 'X-Real-IP': '10.0.0.8' });
  j = await r.json(); ok(r.ok && j.ok, 'quiz lead saved with address and no ZIP');
  r = await fetch(`${BASE}/api/lead`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Real-IP': '10.0.0.10' }, body: 'name=No+Script&phone=9165550171&owner=own_home&loss_type=fire&address=12+Elm+St%2C+Sacramento&elapsed_ms=30000' });
  ok(r.status === 303 && r.headers.get('location') === '/thanks', 'plain form post lands on /thanks');
  r = await fetch(`${BASE}/thanks`); ok(r.ok && (await r.text()).includes('Got it'), 'thanks page renders');
  r = await fetch(`${BASE}/thank-you`); t = await r.text();
  ok(r.ok && t.includes('id="slot-save"') && t.includes('noindex,nofollow') && /no-store/.test(r.headers.get('cache-control')), 'thank-you page renders, noindex, not cached');
  r = await fetch(`${BASE}/?lp=quiz`); const html = await r.text(); ok(/src="\/app\.js\?v=[0-9a-f]{10}"/.test(html) && /method="post"/.test(html), 'app.js is versioned and forms post');

  const pp = (b, ip) => fetch(BASE + '/api/partial', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Real-IP': ip }, body: JSON.stringify(b) });
  r = await pp({ pid: 'smoke-partial-1', form: 'quiz', name: 'Partial Only', phone: '(916) 555-0181', address: '9 Elm St, Sacramento', loss_type: 'fire' }, '10.0.1.1');
  ok(r.ok, 'unfinished form saved (text/plain body)');
  r = await pp({ pid: 'smoke-partial-2', phone: '123' }, '10.0.1.1'); ok(r.status === 400, 'unfinished form with bad phone rejected');
  r = await pp({ pid: 'smoke-partial-3', name: 'Then Sent', phone: '(916) 555-0182' }, '10.0.1.1'); ok(r.ok, 'second unfinished form saved');
  r = await post('/api/lead', { ...good, name: 'Then Sent', phone: '(916) 555-0182' }, { 'X-Real-IP': '10.0.1.2' }); ok(r.ok, 'full lead from the same phone');
  r = await fetch(BASE + '/?lp=quiz'); t = await r.text(); ok(!/Verify<\/a>/.test(t) && !/construction set/.test(t) && !/builder/i.test(t) && t.includes('logo-pcapia.webp') && !t.includes('logo-capia.webp') && t.includes('logo-napia.webp') && !t.includes('c-email'), 'page copy: no Verify, no builder quote, NAPIA and PCAPIA only, no email field');
  r = await post('/api/lead', { ...good, owner: 'rent', name: 'Renter Test', phone: '(916) 555-0161' }, { 'X-Real-IP': '10.0.3.1' });
  j = await r.json(); ok(r.status === 400 && j.errors && j.errors.owner, 'renter refused, no lead saved');
  r = await post('/api/lead', { ...good, owner: undefined, name: 'No Owner', phone: '(916) 555-0162' }, { 'X-Real-IP': '10.0.3.2' });
  j = await r.json(); ok(r.status === 400 && j.errors && j.errors.owner, 'ownership answer required');
  r = await post('/api/lead', { ...good, owner: 'landlord', name: 'Landlord Test', phone: '(916) 555-0163' }, { 'X-Real-IP': '10.0.3.3' });
  j = await r.json(); ok(r.ok && j.ok, 'landlord lead accepted');
  r = await fetch(BASE + '/?lp=quiz'); t = await r.text(); ok(t.includes('data-k="owner" data-v="rent"') && t.includes('id="renter-exit"') && !t.includes('data-k="loss_timing"') && t.includes('name="owner"'), 'ownership question on quiz and contact form, timing question gone');
  if (KEY) {
    await new Promise(res => setTimeout(res, 2500));
    const pc = await (await fetch(`${BASE}/admin/partials.csv?key=${encodeURIComponent(KEY)}`)).text();
    const row = n => pc.split('\n').find(l => l.includes(n)) || '';
    ok(/"converted"/.test(row('Then Sent')), 'unfinished form marked converted after full lead');
    ok(/"(alerted|alert_failed)"/.test(row('Partial Only')), 'abandoned form picked up for an alert (' + (row('Partial Only').split(',')[1] || 'missing') + ')');
  }

  r = await post('/api/lead', { ...good, loss_type: 'storm', name: 'Storm Lead', phone: '(916) 555-0193' }, { 'X-Real-IP': '10.0.2.1' });
  ok(r.ok, 'storm loss type accepted');
  t = await (await fetch(BASE + '/?lp=quiz&loss=storm')).text(); ok(t.includes('storm damage claim'), 'storm headline variant');
  r = await post('/api/lead', { source: 'form', loss_type: 'storm', owner: 'own_home', name: 'AZ Hail Lead', phone: '(602) 555-0194', address: '1234 E Main St, Mesa, AZ 85203', zip: '', page_variant: 'b', utm_source: 'facebook', utm_campaign: 'bsa_az_hail', landing_url: 'https://quiz.bluestaradjusters.com/?utm_campaign=bsa_az_hail&fbclid=AZFBCLID999' }, { 'X-Real-IP': '10.0.2.2' });
  j = await r.json(); ok(r.ok && j.ok, 'any US address saved and 5-digit ZIP extracted');
  const { leadEvent } = require('../src/capi');
  const azEv = leadEvent({ public_id: 'az-1', phone: '(602) 555-0194', name: 'AZ Hail', zip: '85203', address: '1234 E Main St, Mesa, AZ 85203', loss_type: 'storm', source: 'form', page_variant: 'b', landing_url: 'https://quiz.bluestaradjusters.com/?fbclid=AZFBCLID999' });
  ok(azEv.user_data.st && azEv.user_data.st[0] === require('crypto').createHash('sha256').update('az').digest('hex') && /^fb\.1\.\d+\.AZFBCLID999$/.test(azEv.user_data.fbc) && azEv.custom_data.page_variant === 'b', 'CAPI hashes state, synthesizes fbc from landing_url fbclid, and sends page_variant');
  const { contactProps } = require('../src/hubspot');
  const azHs = contactProps({ public_id: 'az-1', phone: '(602) 555-0194', name: 'AZ Hail', zip: '85203', address: '1234 E Main St, Mesa, AZ 85203', loss_type: 'hail', owner: 'own_home', source: 'quiz', page_variant: 'hail' });
  ok(azHs.state === 'AZ' && azHs.bs_loss_type === 'storm', 'HubSpot maps AZ ZIP to state=AZ and hail to bs_loss_type=storm');
  t = await (await fetch(BASE + '/?lp=quiz&utm_campaign=bsa_az_hail&state=az')).text();
  ok(t.includes('3004469742') && !t.includes('6015234') && t.includes('Hail or storm damage claim?') && t.includes('Hail, storm or tree'), 'AZ Page A swaps license to 3004469742 and shows hail headline + tile');
  t = await (await fetch(BASE + '/?lp=b&hsa_cam=120248791830950534')).text();
  ok(t.includes('3004469742') && !t.includes('6015234') && t.includes('Hail or wind damage'), 'AZ Page B swaps license to 3004469742 via HubSpot campaign ID');
  t = await (await fetch(BASE + '/?lp=quiz')).text();
  const vis = t.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, '');
  ok(!/916|507-1005|Start my free review|builder|developer|Email \(optional\)|—|–/.test(vis) && (t.match(/tel:\+18889712524/g) || []).length >= 8 && !t.includes('tel:+1916'), 'copy v2: toll free only, no old CTA, no dashes');

  // ---------- Page B (1-screen qualified homeowner claim check) ----------
  const ck = c => ({ Cookie: c });
  t = await (await fetch(BASE + '/')).text();
  ok(t.includes('Step 1 of 3') && t.includes('name="owner"') && t.includes('id="f-address"') && !t.includes('Property street address (optional)') && !t.includes('id="s2"') && t.includes('data-variant="b"') && /src="\/b\.js\?v=[0-9a-f]{10}"/.test(t), 'default / serves Page B with Screen 1 required street address + ownership pills');
  t = await (await fetch(BASE + '/?lp=quiz', { headers: ck('bs_lp=b') })).text();
  ok(t.includes('id="quiz"') && !t.includes('Step 1 of 3'), '?lp=quiz serves Page A');
  r = await fetch(BASE + '/?lp=b', { headers: ck('bs_lp=a') });
  ok((await r.text()).includes('Step 1 of 3') && /bs_lp=b/.test(r.headers.get('set-cookie') || ''), '?lp=b overrides cookie and resets it');
  t = await (await fetch(BASE + '/?lp=b&state=az&h=pa-hail')).text();
  ok(t.includes('3004469742') && t.includes('Hail or roof claim denied or underpaid?'), 'Google Search AZ ?h=pa-hail variant renders');
  t = await (await fetch(BASE + '/thank-you', { headers: ck('bs_lp=b') })).text(); ok(t.includes('id="confirm"') && t.includes('data-ty="ty"') && t.includes('noindex,nofollow'), 'thank-you on cookie b is Page B calendar');
  const goodB = { source: 'form', loss_type: 'water', owner: 'own_home', name: 'Test Page Bee', phone: '(916) 555-0141', zip: '95811', address: '1610 R St, Sacramento, CA 95811', elapsed_ms: 25000, page_variant: 'b', utm_source: 'facebook', fbclid: 'FBTEST', fbp: 'fb.1.1700000000000.123', landing_url: 'https://quiz.bluestaradjusters.com/?utm_source=facebook' };
  r = await post('/api/lead', { ...goodB, owner: 'rent', phone: '(916) 555-0142' }, { 'X-Real-IP': '10.0.5.1' }); j = await r.json(); ok(r.status === 400 && j.errors.owner, 'Page B renter refused, no lead');
  r = await post('/api/lead', { ...goodB, address: '', phone: '(916) 555-0144' }, { 'X-Real-IP': '10.0.5.1' }); j = await r.json(); ok(r.status === 400 && j.errors.address, 'Page B missing street address rejected (address is must)');
  r = await post('/api/lead', { ...goodB, address: 'ZIP 95811', phone: '(916) 555-0145' }, { 'X-Real-IP': '10.0.5.1' }); j = await r.json(); ok(r.status === 400 && j.errors.address, 'Page B ZIP-only placeholder address rejected');
  r = await post('/api/lead', { ...goodB, loss_type: '' }, { 'X-Real-IP': '10.0.5.1' }); j = await r.json(); ok(r.status === 400 && j.errors.loss_type === 'Please choose what happened.', 'Page B missing loss type message');
  r = await post('/api/lead', goodB, { 'X-Real-IP': '10.0.5.2' }); j = await r.json(); ok(r.ok && j.ok && /^[0-9a-f-]{36}$/.test(j.id), 'Page B lead saves directly on Screen 1 with required street address + 5-digit ZIP + owner');
  const bid = j.id;
  r = await post(`/api/lead/${bid}/status`, { claim_status: 'low_offer', address: '1610 R St, Sacramento, CA 95811' }, { 'X-Real-IP': '10.0.5.2' }); ok(r.ok, 'step 2 of 3 claim status + optional street address saved on the lead');
  r = await post(`/api/lead/${bid}/status`, { claim_status: 'nope' }, { 'X-Real-IP': '10.0.5.2' }); ok(r.status === 400, 'bad claim status rejected');
  r = await post('/api/lead/00000000-0000-0000-0000-000000000000/status', { claim_status: 'denied' }, { 'X-Real-IP': '10.0.5.2' }); ok(r.status === 404, 'claim status for unknown lead 404');
  r = await pp({ pid: 'smoke-b-renter', form: 'form', name: 'B Renter', phone: '(916) 555-0143', loss_type: 'fire' }, '10.0.5.3'); ok(r.ok, 'Page B step 1 saved as unfinished form');
  r = await pp({ pid: 'smoke-b-renter', form: 'form', owner: 'rent', phone: '(916) 555-0143' }, '10.0.5.3'); ok(r.ok, 'Page B renter closes the unfinished form');
  const UP = process.env.S3_ENDPOINT;
  if (UP) {
    const up = (b, ip = '10.0.6.1') => post(`/api/lead/${bid}/uploads`, b, { 'X-Real-IP': ip });
    r = await up({ files: [{ name: 'kitchen ceiling.jpg', size: 2048, type: 'image/jpeg' }] }); j = await r.json();
    ok(r.ok && j.uploads.length === 1 && j.uploads[0].fields.Policy && j.uploads[0].key.startsWith(`leads/${bid}/`), 'upload: presigned POST issued');
    const key1 = j.uploads[0] && j.uploads[0].key;
    const pol = JSON.parse(Buffer.from(j.uploads[0].fields.Policy, 'base64').toString());
    ok(pol.conditions.some(c => Array.isArray(c) && c[0] === 'content-length-range' && c[2] === 2048), 'upload: bucket enforces the file size');
    r = await up({ files: [{ name: 'x.exe', size: 10, type: 'application/octet-stream' }] }, '10.0.6.2'); ok(r.status === 400, 'upload: wrong file type rejected');
    r = await up({ files: Array.from({ length: 10 }, (_, i) => ({ name: `p${i}.jpg`, size: 10, type: 'image/jpeg' })) }, '10.0.6.3'); ok(r.status === 400, 'upload: over 10 files rejected');
    r = await up({ files: [{ name: 'big.mov', size: 250 * 1024 * 1024, type: 'video/quicktime' }] }, '10.0.6.4'); ok(r.status === 400, 'upload: over 250 MB total rejected');
    r = await post('/api/lead/00000000-0000-0000-0000-000000000000/uploads', { files: [{ name: 'a.jpg', size: 1, type: 'image/jpeg' }] }, { 'X-Real-IP': '10.0.6.5' }); ok(r.status === 404, 'upload: unknown lead 404');
    r = await post(`/api/lead/${bid}/uploads/done`, { keys: [key1] }, { 'X-Real-IP': '10.0.6.6' }); j = await r.json(); ok(r.ok && j.saved === 1, 'upload done: file checked in bucket');
    await new Promise(res => setTimeout(res, 800));
    const calls = process.env.STUB_LOG ? require('fs').readFileSync(process.env.STUB_LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
    const note = calls.find(c => c.path === '/crm/v3/objects/notes');
    const link = note && (/href="([^"]+)"/.exec(note.body.properties.hs_note_body) || [])[1];
    ok(link && link.includes('/f/'), 'HubSpot note on the deal with a file link');
    if (link) {
      r = await fetch(link, { redirect: 'manual' }); ok(r.status === 302 && new URL(r.headers.get('location')).hostname.endsWith(new URL(UP).hostname), 'file link redirects to a signed bucket URL');
      r = await fetch(link.slice(0, -2) + 'xx', { redirect: 'manual' }); ok(r.status === 404, 'tampered file link 404');
    }
    if (calls.length) {
      const capi = calls.find(c => c.host === 'graph.facebook.com' && c.body.data[0].event_id === bid);
      ok(capi && capi.body.data[0].event_name === 'Lead' && capi.body.data[0].custom_data.form === 'form', 'Meta server Lead sent with event_id = lead id');
      const hc = calls.find(c => c.path.endsWith('/contacts/batch/upsert') && c.body.inputs[0].properties.bs_lead_id === bid);
      ok(hc && hc.body.inputs[0].properties.bs_form === 'form' && hc.body.inputs[0].properties.bs_page_variant === 'b' && hc.body.inputs[0].properties.bs_lead_source === 'meta_ads', 'HubSpot contact: bs_form=form, bs_page_variant=b, source meta_ads');
      const hd = calls.find(c => c.path === '/crm/v3/objects/deals' && c.body.properties.bs_lead_id === bid);
      ok(hd && hd.body.properties.bs_form === 'form' && hd.body.properties.bs_page_variant === 'b', 'HubSpot deal: bs_form=form, bs_page_variant=b');
      ok(calls.some(c => c.method === 'PATCH' && c.path === '/crm/v3/objects/contacts/9165550141' && c.body.properties.bs_claim_status === 'low_offer'), 'HubSpot contact claim status updated at step 3');
      ok(calls.some(c => c.host === 'formsubmit.co' && c.body.Form === 'Page B (multi-step form)' && c.body.Name === 'Page Bee'), 'lead email sent (stubbed) once at step 2');
      ok(!calls.some(c => c.host === 'formsubmit.co' && JSON.stringify(c.body).includes('555-0143')), 'no alert for the Page B renter');
    }
  } else console.log('SKIP upload tests: S3_ENDPOINT not set');

  let last; for (let i = 0; i < 7; i++) last = await post('/api/lead', good, { 'X-Real-IP': '10.0.0.9' });
  ok(last.status === 429, 'rate limit after 6 per 10 minutes');

  if (KEY) {
    r = await fetch(`${BASE}/admin/leads.csv?key=${encodeURIComponent(KEY)}`);
    const csv = await r.text();
    ok(r.ok && csv.includes('Test Lead') && csv.includes('Tue Oct 6, 11:00 AM PT'), 'CSV export has lead + slot');
    ok(/Bot Fast.*true|true.*Bot Fast/.test(csv.split('\n').find(l => l.includes('Bot Fast')) || ''), 'spam flagged in DB');
  }
  r = await fetch(BASE + '/admin/leads.csv?key=wrong'); ok(r.status === 404, 'CSV hidden without key');

  // ---------- HubSpot Lead Ads / Form -> Email Notification Parity ----------
  const { isEligibleHubSpotLead, parseHubSpotContactToLead, syncLeadAds } = require('../src/hubspot');
  const { render: renderNotify, TO: getRecipients } = require('../src/notify');
  const cutoff = Date.parse('2026-11-08T03:30:00.000Z');
  const savedNotifyTo = process.env.NOTIFY_TO;
  delete process.env.NOTIFY_TO;
  const recips = getRecipients();
  if (savedNotifyTo !== undefined) process.env.NOTIFY_TO = savedNotifyTo;
  ok(recips[0] === 'mike@bluestaradjusters.com' && recips.includes('nayem.adsmanager@gmail.com'), 'Recipients match website exactly: To mike@bluestaradjusters.com, CC nayem.adsmanager@gmail.com');

  ok(!isEligibleHubSpotLead({ id: '1', properties: { email: 'news@costar.com', hs_object_source: 'EMAIL_INTEGRATION', createdate: '2026-11-08T05:00:00Z' } }, cutoff), 'HubSpot filter rejects EMAIL_INTEGRATION inbox contacts');
  ok(!isEligibleHubSpotLead({ id: '2', properties: { phone: '5093267510', hs_object_source: 'IMPORT', createdate: '2026-11-08T05:00:00Z' } }, cutoff), 'HubSpot filter rejects Excel IMPORT contacts');
  ok(!isEligibleHubSpotLead({ id: '3', properties: { phone: '+19287153678', bs_lead_id: '79030ec8-c8b3-4bbf-bf7c-3e7e523a39ed', hs_object_source: 'ADS', createdate: '2026-11-08T05:00:00Z' } }, cutoff), 'HubSpot filter skips contacts already stamped with bs_lead_id');
  ok(!isEligibleHubSpotLead({ id: '4', properties: { email: 'roy@test.com', hs_object_source: 'FORM', createdate: '2026-09-07T23:35:13Z' } }, cutoff), 'HubSpot filter rejects historical pre-cutoff contacts');

  const sampleHsContact = {
    id: '991234567890',
    properties: {
      firstname: 'Marcus',
      lastname: 'Vance',
      phone: '+16025550188',
      email: 'marcus.vance@example.com',
      address: '4812 E Ray Rd',
      city: 'Phoenix',
      state: 'Arizona',
      zip: '85044-1234',
      do_you_own_the_damaged_property: 'yes,_homeowner',
      what_happened_to_your_property: 'hail,_wind_or_roof_damage',
      hs_object_source: 'ADS',
      hs_latest_source: 'PAID_SOCIAL',
      hs_latest_source_data_1: 'Facebook',
      hs_latest_source_data_2: 'BSA | AZ Hail + CA Fire & Smoke | Instant Form Leads | CBO $75',
      hs_object_source_detail_3: 'azh_if_01_ceiling_stain',
      recent_conversion_event_name: 'Facebook Lead Ads: BSA | Homeowner & Commercial Claim Check | Address + Higher Intent | Nov26',
      createdate: '2026-11-08T05:00:00.000Z',
    },
  };
  ok(isEligibleHubSpotLead(sampleHsContact, cutoff), 'HubSpot filter accepts genuine Meta Instant Form contact');
  const parsedHs = parseHubSpotContactToLead(sampleHsContact);
  ok(parsedHs.address === '4812 E Ray Rd, Phoenix, AZ 85044' && parsedHs.zip === '85044' && parsedHs.property_state === 'AZ' && parsedHs.owner === 'own_home' && parsedHs.loss_type === 'hail' && parsedHs.phone === '(602) 555-0188', 'HubSpot Lead Ad mapper formats street+city+state+ZIP, phone, owner, and peril');
  const renderedHs = renderNotify({ ...parsedHs, public_id: 'hs-uuid-1', hubspot_deal_id: '555000111', hubspot_deal_url: 'https://app-eu1.hubspot.com/contacts/149045473/record/0-3/555000111' });
  ok(
    renderedHs.subject.includes('[AZ · Phoenix & East Valley (85044)]') &&
    renderedHs.subject.includes('Hail, wind or roof damage') &&
    renderedHs.html.includes('4812 E Ray Rd, Phoenix, AZ 85044') &&
    renderedHs.html.includes('Meta Paid Ads — Instant Form (Synced via HubSpot)') &&
    renderedHs.html.includes('Meta Instant Form CBO — AZ Hail &amp; CA Fire/Smoke') &&
    renderedHs.html.includes('AZ Hail — Ceiling Stain / Hidden Roof Leak') &&
    renderedHs.html.includes('https://app-eu1.hubspot.com/contacts/149045473/record/0-1/991234567890') &&
    renderedHs.html.includes('Open Deal in Blue Star Leads'),
    'Rendered HubSpot email matches website template with full property address, Maps link, campaign, creative, and HubSpot links'
  );

  // Renter handling on Meta Instant Form
  const renterHs = parseHubSpotContactToLead({
    id: '991234567891',
    properties: { ...sampleHsContact.properties, do_you_own_the_damaged_property: 'No, I rent' },
  });
  const renderedRenter = renderNotify({ ...renterHs, public_id: 'hs-uuid-2' });
  ok(renterHs.owner === 'rent' && renderedRenter.subject.startsWith('[RENTER — Do Not Call]') && renderedRenter.html.includes('Disqualified Ownership Answer'), 'Meta Instant Form renter clearly flagged [RENTER — Do Not Call] in subject and banner');

  // End-to-end syncLeadAds mock server verification (proving deal creation + bs_lead_id stamp + zero duplicate emails)
  const http = require('http');
  const hsPatches = [], hsDeals = [], sentNotifications = [];
  let stampedId = '';
  const mockHs = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/crm/v3/properties/contacts') {
        return res.end(JSON.stringify({ results: [
          { groupName: 'lead_ads', name: 'do_you_own_the_damaged_property', label: 'Do you own the damaged property?' },
          { groupName: 'lead_ads', name: 'what_happened_to_your_property', label: 'What happened to your property?' },
        ] }));
      }
      if (req.url === '/crm/v3/objects/contacts/search') {
        return res.end(JSON.stringify({ results: [
          { id: '888001', properties: { email: 'inbox@tillys.com', hs_object_source: 'EMAIL_INTEGRATION', createdate: '2026-11-08T05:00:00.000Z' } },
          { id: '999001', properties: { ...sampleHsContact.properties, bs_lead_id: stampedId } },
        ] }));
      }
      if (req.url === '/crm/v3/pipelines/deals') {
        return res.end(JSON.stringify({ results: [{ id: '4288676036', label: 'Blue Star Leads', stages: [{ id: '6337571038', label: 'New lead' }] }] }));
      }
      if (req.url === '/crm/v3/objects/deals' && req.method === 'POST') {
        const parsed = JSON.parse(body);
        hsDeals.push(parsed);
        return res.end(JSON.stringify({ id: '777001' }));
      }
      if (req.url.startsWith('/crm/v3/objects/contacts/999001') && req.method === 'PATCH') {
        const parsed = JSON.parse(body);
        hsPatches.push(parsed);
        if (parsed.properties && parsed.properties.bs_lead_id) stampedId = parsed.properties.bs_lead_id;
        return res.end(JSON.stringify({ id: '999001' }));
      }
      res.end(JSON.stringify({ results: [] }));
    });
  });
  await new Promise(r => mockHs.listen(0, '127.0.0.1', r));
  const mockPort = mockHs.address().port;
  const prevApi = process.env.HUBSPOT_API, prevTok = process.env.HUBSPOT_TOKEN, prevSync = process.env.HUBSPOT_LEAD_SYNC;
  process.env.HUBSPOT_API = `http://127.0.0.1:${mockPort}`;
  process.env.HUBSPOT_TOKEN = 'mock-hs-token';
  delete process.env.HUBSPOT_LEAD_SYNC;
  const memDbRows = new Map();
  const mockDb = {
    findByHubSpotId: async id => [...memDbRows.values()].find(x => x.hubspot_contact_id === id) || null,
    hasLead: async () => false,
    insertLead: async l => { const row = { ...l, public_id: '00000000-0000-4000-8000-000000999001' }; memDbRows.set(row.public_id, row); return row; },
    setSyncStatus: async () => {},
    setEmailStatus: async () => {},
  };
  const run1 = await syncLeadAds({ db: mockDb, notifyLead: async l => { sentNotifications.push(l); return 'sent:resend'; }, immediate: true });
  const run2 = await syncLeadAds({ db: mockDb, notifyLead: async l => { sentNotifications.push(l); return 'sent:resend'; }, immediate: true });
  mockHs.close();
  if (prevApi === undefined) delete process.env.HUBSPOT_API; else process.env.HUBSPOT_API = prevApi;
  if (prevTok === undefined) delete process.env.HUBSPOT_TOKEN; else process.env.HUBSPOT_TOKEN = prevTok;
  if (prevSync === undefined) delete process.env.HUBSPOT_LEAD_SYNC; else process.env.HUBSPOT_LEAD_SYNC = prevSync;

  ok(
    run1.ok && run1.synced === 1 && run2.synced === 0 &&
    sentNotifications.length === 1 &&
    sentNotifications[0].hubspot_deal_id === '777001' &&
    hsDeals.length === 1 && hsDeals[0].properties.bs_form === 'form' && hsDeals[0].properties.bs_loss_type === 'storm' &&
    hsPatches.some(p => p.properties.bs_lead_id === '00000000-0000-4000-8000-000000999001' && p.properties.bs_owner === 'own_home'),
    'End-to-end syncLeadAds creates Blue Star Leads deal, stamps bs_lead_id, ignores inbox contacts, and sends exactly 1 email across repeated polls'
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
