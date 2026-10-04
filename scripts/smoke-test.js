// Run against a running server: BASE=http://localhost:3000 ADMIN_KEY=... npm test
const BASE = process.env.BASE || 'http://localhost:3000';
const KEY = process.env.ADMIN_KEY || '';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const post = (p, b, h = {}) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });
const good = { loss_type: 'fire', claim_status: 'low_offer', loss_timing: 'm1_6', name: 'Test Lead', phone: '(916) 555-0199', zip: '95811', elapsed_ms: 42000, utm_source: 'google', utm_campaign: 'fire-test', gclid: 'TEST123', page_variant: 'fire' };

(async () => {
  let r = await fetch(BASE + '/');
  let t = await r.text();
  ok(r.status === 200 && t.includes('Get a free second opinion'), 'home renders default headline');
  ok(t.includes('name="viewport"') && t.includes('viewport-fit=cover'), 'viewport meta present');
  ok(t.includes('noindex'), 'noindex by default');
  t = await (await fetch(BASE + '/?loss=denied')).text();
  ok(t.includes('Your claim was denied.') && t.includes('data-variant="denied"'), 'headline variant by ?loss=');
  r = await fetch(BASE + '/health'); ok(r.ok, 'health ok ' + JSON.stringify(await r.json()));
  r = await fetch(BASE + '/privacy'); ok(r.ok && (await r.text()).includes('Privacy notice'), 'privacy page');
  r = await fetch(BASE + '/fonts/sg-700.woff2'); ok(r.ok && /immutable/.test(r.headers.get('cache-control')), 'fonts cached immutable');

  r = await post('/api/lead', { ...good, phone: '123', zip: '9', name: '' }, { 'X-Real-IP': '10.0.0.1' });
  let j = await r.json(); ok(r.status === 400 && j.errors.phone && j.errors.zip && j.errors.name, 'invalid fields rejected');

  r = await post('/api/lead', good, { 'X-Real-IP': '10.0.0.2' });
  j = await r.json(); ok(r.ok && j.ok && /^[0-9a-f-]{36}$/.test(j.id) && j.first_name === 'Test', 'valid lead saved ' + j.id);
  const id = j.id;

  r = await post(`/api/lead/${id}/callback`, { slot: 'Tue Oct 6, 11:00 AM PT' }, { 'X-Real-IP': '10.0.0.2' });
  ok(r.ok, 'callback slot saved');

  r = await post('/api/lead', { ...good, name: 'Bot Fast', elapsed_ms: 900 }, { 'X-Real-IP': '10.0.0.3' });
  ok(r.ok, 'fast bot gets a quiet ok');
  r = await post('/api/lead', { ...good, name: 'Bot Honey', company: 'x' }, { 'X-Real-IP': '10.0.0.4' });
  ok(r.ok, 'honeypot bot gets a quiet ok');

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
