'use strict';
// Railway bucket (S3 compatible), no SDK. AWS Signature V4, built from Node crypto only.
// Env: S3_ENDPOINT, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.
// Optional S3_PATH_STYLE=true if the bucket's Credentials tab says path style.
const crypto = require('crypto');

const env = () => ({
  endpoint: (process.env.S3_ENDPOINT || '').trim().replace(/\/+$/, ''),
  bucket: (process.env.S3_BUCKET || '').trim(),
  region: (process.env.S3_REGION || 'auto').trim(),
  key: (process.env.S3_ACCESS_KEY_ID || '').trim(),
  secret: (process.env.S3_SECRET_ACCESS_KEY || '').trim(),
  pathStyle: process.env.S3_PATH_STYLE === 'true',
});
const configured = () => { const e = env(); return Boolean(e.endpoint && e.bucket && e.key && e.secret); };

const hmac = (k, v) => crypto.createHmac('sha256', k).update(v).digest();
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
// RFC 3986 encoding, as SigV4 requires.
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = p => p.split('/').map(enc).join('/');

function stamp(now) {
  const iso = (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return { amzDate: iso, date: iso.slice(0, 8) };
}
function signingKey(secret, date, region) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), 's3'), 'aws4_request');
}
// Bucket base URL: virtual hosted (bucket.host) by default, or host/bucket.
function base(e) {
  const u = new URL(e.endpoint);
  return e.pathStyle ? { host: u.host, origin: `${u.protocol}//${u.host}`, prefix: '/' + e.bucket } : { host: `${e.bucket}.${u.host}`, origin: `${u.protocol}//${e.bucket}.${u.host}`, prefix: '' };
}

// Presigned URL for GET or HEAD on one object (query string auth).
function presignUrl(method, objectKey, expires, opts = {}) {
  const e = { ...env(), ...(opts.env || {}) };
  const { amzDate, date } = stamp(opts.now);
  const b = base(e);
  const scope = `${date}/${e.region}/s3/aws4_request`;
  const path = `${b.prefix}/${encPath(objectKey)}`;
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${e.key}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  if (opts.query) Object.assign(q, opts.query);
  const cq = Object.keys(q).sort().map(k => `${enc(k)}=${enc(q[k])}`).join('&');
  const creq = [method, path, cq, `host:${b.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha(creq)].join('\n');
  const sig = hmac(signingKey(e.secret, date, e.region), sts).toString('hex');
  return `${b.origin}${path}?${cq}&X-Amz-Signature=${sig}`;
}

// Presigned POST: the browser uploads straight to the bucket. Size and type are enforced by the bucket.
function presignPost(objectKey, contentType, maxBytes, expiresSec = 3600, opts = {}) {
  const e = { ...env(), ...(opts.env || {}) };
  const { amzDate, date } = stamp(opts.now);
  const b = base(e);
  const credential = `${e.key}/${date}/${e.region}/s3/aws4_request`;
  const policy = {
    expiration: new Date((opts.now || new Date()).getTime() + expiresSec * 1000).toISOString(),
    conditions: [
      { bucket: e.bucket }, { key: objectKey }, { 'Content-Type': contentType },
      ['content-length-range', 1, maxBytes],
      { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' }, { 'x-amz-credential': credential }, { 'x-amz-date': amzDate },
    ],
  };
  const policyB64 = Buffer.from(JSON.stringify(policy)).toString('base64');
  const sig = hmac(signingKey(e.secret, date, e.region), policyB64).toString('hex');
  return {
    url: `${b.origin}${b.prefix}/`,
    fields: { key: objectKey, 'Content-Type': contentType, 'x-amz-algorithm': 'AWS4-HMAC-SHA256', 'x-amz-credential': credential, 'x-amz-date': amzDate, Policy: policyB64, 'X-Amz-Signature': sig },
  };
}

// Size of an uploaded object, or null when it is not there.
async function headSize(objectKey) {
  const r = await fetch(presignUrl('HEAD', objectKey, 300), { method: 'HEAD', signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  return Number(r.headers.get('content-length') || 0);
}

// Signed request with headers (used once, for the bucket CORS rule).
async function signedRequest(method, query, body, extraHeaders = {}) {
  const e = env();
  const { amzDate, date } = stamp();
  const b = base(e);
  const payloadHash = sha(body || '');
  const headers = { host: b.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])) };
  const names = Object.keys(headers).sort();
  const creq = [method, `${b.prefix}/`, query, names.map(n => `${n}:${String(headers[n]).trim()}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${date}/${e.region}/s3/aws4_request`;
  const sig = hmac(signingKey(e.secret, date, e.region), ['AWS4-HMAC-SHA256', amzDate, scope, sha(creq)].join('\n')).toString('hex');
  const h = { ...headers, Authorization: `AWS4-HMAC-SHA256 Credential=${e.key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
  delete h.host;
  return fetch(`${b.origin}${b.prefix}/?${query}`, { method, headers: h, body, signal: AbortSignal.timeout(15000) });
}

module.exports = { configured, presignUrl, presignPost, headSize, signedRequest };
