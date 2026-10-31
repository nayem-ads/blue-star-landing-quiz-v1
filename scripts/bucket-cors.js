// One time: allow the landing page to upload straight to the Railway bucket from the browser.
// Run with the service's variables: railway run node scripts/bucket-cors.js
// Optional: CORS_ORIGINS="https://a.com,https://b.com" (default below).
const crypto = require('crypto');
const s3 = require('../src/s3');
const origins = (process.env.CORS_ORIGINS || 'https://quiz.bluestaradjusters.com,https://blue-star-landing-quiz-v1-production.up.railway.app').split(',').map(s => s.trim()).filter(Boolean);
const xml = `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration><CORSRule>${origins.map(o => `<AllowedOrigin>${o}</AllowedOrigin>`).join('')}<AllowedMethod>POST</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><MaxAgeSeconds>3000</MaxAgeSeconds></CORSRule></CORSConfiguration>`;
(async () => {
  if (!s3.configured()) { console.error('Missing S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY'); process.exit(1); }
  const md5 = crypto.createHash('md5').update(xml).digest('base64');
  const r = await s3.signedRequest('PUT', 'cors=', xml, { 'content-md5': md5, 'content-type': 'application/xml' });
  console.log(r.status, (await r.text()).slice(0, 300) || 'ok');
  console.log(r.ok ? `CORS set for: ${origins.join(', ')}` : 'CORS not set. See the response above.');
  process.exit(r.ok ? 0 : 1);
})();
