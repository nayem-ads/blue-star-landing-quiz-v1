'use strict';
// Local testing only. Preload with: node -r ./test/stub-fetch.cjs server.js
// Every outside call (FormSubmit, Resend, Meta, HubSpot, the bucket) gets a fake answer. Nothing leaves this machine.
// Calls are written to STUB_LOG (default data/stub-calls.ndjson) so tests can check what would have been sent.
const fs = require('fs');
const path = require('path');
const LOG = process.env.STUB_LOG || path.join(__dirname, '..', 'data', 'stub-calls.ndjson');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
const realFetch = global.fetch;
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

global.fetch = async function stubbedFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return realFetch(input, init);
  const method = (init.method || 'GET').toUpperCase();
  let body = init.body;
  try { body = typeof body === 'string' ? JSON.parse(body) : body ? String(body) : null; } catch (e) {}
  fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), host: url.hostname, method, path: url.pathname, search: url.search, body }) + '\n');
  const h = url.hostname, p = url.pathname;
  if (h === 'formsubmit.co') return json({ success: 'true', message: 'stubbed' });
  if (h === 'api.resend.com') return json({ id: 'stub-email' });
  if (h === 'graph.facebook.com') return json({ events_received: 1, fbtrace_id: 'stub' });
  if (h === 'api.hubapi.com') {
    if (p.endsWith('/pipelines/deals')) return json({ results: [{ id: 'p1', label: 'Blue Star Leads', stages: [{ id: 's1', label: 'New lead' }] }] });
    if (p.endsWith('/contacts/batch/upsert')) return json({ results: [{ id: '101' }] });
    if (p === '/crm/v3/objects/deals' && method === 'POST') return json({ id: '201' });
    if (p.startsWith('/crm/v3/objects/deals/')) return json({ id: '201' });
    if (p.startsWith('/crm/v3/objects/contacts/')) return json({ id: '101' });
    if (p === '/crm/v3/objects/notes') return json({ id: '301' });
    return json({});
  }
  if (process.env.S3_ENDPOINT && h.endsWith(new URL(process.env.S3_ENDPOINT).hostname)) {
    return new Response(null, { status: 200, headers: { 'Content-Length': process.env.STUB_S3_SIZE || '2048' } });
  }
  throw new Error(`stub-fetch: blocked outside call to ${h}`);
};
console.log('[stub-fetch] outside calls are stubbed; log:', LOG);
