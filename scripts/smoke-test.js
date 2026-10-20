// Run against a running server: BASE=http://localhost:3000 ADMIN_KEY=... npm test
const BASE = process.env.BASE || 'http://localhost:3000';
const KEY = process.env.ADMIN_KEY || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const post = (p, b, h = {}) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });
const good = { loss_type: 'fire', owner: 'own_home', claim_status: 'low_offer', name: 'Test Lead', phone: '(916) 555-0199', zip: '95811', address: '1610 R St, Sacramento, CA 95811', elapsed_ms: 42000, utm_source: 'google', utm_campaign: 'fire-test', gclid: 'TEST123', page_variant: 'fire' };

(async () => {
  let r = await fetch(BASE + '/');
  let t = await r.text();
  ok(r.status === 200 && t.includes('Home or business damaged?'), 'home renders default headline');
  ok(t.includes('name="viewport"') && t.includes('viewport-fit=cover'), 'viewport meta present');
  ok(t.includes('noindex'), 'noindex by default');
  t = await (await fetch(BASE + '/?loss=denied')).text();
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
  j = await r.json(); ok(r.status === 400 && j.errors.address, 'quiz address without street number rejected');
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
  r = await fetch(`${BASE}/`); const html = await r.text(); ok(/src="\/app\.js\?v=[0-9a-f]{10}"/.test(html) && /method="post"/.test(html), 'app.js is versioned and forms post');

  const pp = (b, ip) => fetch(BASE + '/api/partial', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Real-IP': ip }, body: JSON.stringify(b) });
  r = await pp({ pid: 'smoke-partial-1', form: 'quiz', name: 'Partial Only', phone: '(916) 555-0181', address: '9 Elm St, Sacramento', loss_type: 'fire' }, '10.0.1.1');
  ok(r.ok, 'unfinished form saved (text/plain body)');
  r = await pp({ pid: 'smoke-partial-2', phone: '123' }, '10.0.1.1'); ok(r.status === 400, 'unfinished form with bad phone rejected');
  r = await pp({ pid: 'smoke-partial-3', name: 'Then Sent', phone: '(916) 555-0182' }, '10.0.1.1'); ok(r.ok, 'second unfinished form saved');
  r = await post('/api/lead', { ...good, name: 'Then Sent', phone: '(916) 555-0182' }, { 'X-Real-IP': '10.0.1.2' }); ok(r.ok, 'full lead from the same phone');
  r = await fetch(BASE + '/'); t = await r.text(); ok(!/Verify<\/a>/.test(t) && !/construction set/.test(t) && !/builder/i.test(t) && t.includes('logo-pcapia.webp') && !t.includes('logo-capia.webp') && t.includes('logo-napia.webp') && !t.includes('c-email'), 'page copy: no Verify, no builder quote, NAPIA and PCAPIA only, no email field');
  r = await post('/api/lead', { ...good, owner: 'rent', name: 'Renter Test', phone: '(916) 555-0161' }, { 'X-Real-IP': '10.0.3.1' });
  j = await r.json(); ok(r.status === 400 && j.errors && j.errors.owner, 'renter refused, no lead saved');
  r = await post('/api/lead', { ...good, owner: undefined, name: 'No Owner', phone: '(916) 555-0162' }, { 'X-Real-IP': '10.0.3.2' });
  j = await r.json(); ok(r.status === 400 && j.errors && j.errors.owner, 'ownership answer required');
  r = await post('/api/lead', { ...good, owner: 'landlord', name: 'Landlord Test', phone: '(916) 555-0163' }, { 'X-Real-IP': '10.0.3.3' });
  j = await r.json(); ok(r.ok && j.ok, 'landlord lead accepted');
  r = await fetch(BASE + '/'); t = await r.text(); ok(t.includes('data-k="owner" data-v="rent"') && t.includes('id="renter-exit"') && !t.includes('data-k="loss_timing"') && t.includes('name="owner"'), 'ownership question on quiz and contact form, timing question gone');
  if (KEY) {
    await new Promise(res => setTimeout(res, 2500));
    const pc = await (await fetch(`${BASE}/admin/partials.csv?key=${encodeURIComponent(KEY)}`)).text();
    const row = n => pc.split('\n').find(l => l.includes(n)) || '';
    ok(/"converted"/.test(row('Then Sent')), 'unfinished form marked converted after full lead');
    ok(/"(alerted|alert_failed)"/.test(row('Partial Only')), 'abandoned form picked up for an alert (' + (row('Partial Only').split(',')[1] || 'missing') + ')');
  }

  r = await post('/api/lead', { ...good, loss_type: 'storm', name: 'Storm Lead', phone: '(916) 555-0193' }, { 'X-Real-IP': '10.0.2.1' });
  ok(r.ok, 'storm loss type accepted');
  t = await (await fetch(BASE + '/?loss=storm')).text(); ok(t.includes('storm damage claim'), 'storm headline variant');
  t = await (await fetch(BASE + '/')).text();
  const vis = t.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<svg[\s\S]*?<\/svg>/g, '');
  ok(!/916|507-1005|Start my free review|builder|developer|Email \(optional\)|—|–/.test(vis) && (t.match(/tel:\+18889712524/g) || []).length >= 8 && !t.includes('tel:+1916'), 'copy v2: toll free only, no old CTA, no dashes');

  let last; for (let i = 0; i < 7; i++) last = await post('/api/lead', good, { 'X-Real-IP': '10.0.0.9' });
  ok(last.status === 429, 'rate limit after 6 per 10 minutes');

  if (KEY) {
    r = await fetch(`${BASE}/admin/leads.csv?key=${encodeURIComponent(KEY)}`);
    const csv = await r.text();
    ok(r.ok && csv.includes('Test Lead') && csv.includes('Tue Oct 6, 11:00 AM PT'), 'CSV export has lead + slot');
    ok(/Bot Fast.*true|true.*Bot Fast/.test(csv.split('\n').find(l => l.includes('Bot Fast')) || ''), 'spam flagged in DB');
  }
  r = await fetch(BASE + '/admin/leads.csv?key=wrong'); ok(r.status === 404, 'CSV hidden without key');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
