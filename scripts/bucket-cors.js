// Re-apply the bucket CORS rule by hand. The server also does this on every boot.
// Run with the service's variables: railway run node scripts/bucket-cors.js
// Optional: CORS_ORIGINS="https://a.com,https://b.com".
const s3 = require('../src/s3');
(async () => {
  if (!s3.configured()) { console.error('Missing S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY'); process.exit(1); }
  const r = await s3.ensureCors();
  console.log(r.status, r.body || 'ok');
  console.log(r.ok ? `CORS set for: ${r.origins.join(', ')}` : 'CORS not set. See the response above.');
  process.exit(r.ok ? 0 : 1);
})();
