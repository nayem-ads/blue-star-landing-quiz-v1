'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const compression = require('compression');
const db = require('./src/db');
const { validateLead, validatePartial } = require('./src/validate');
const { notifyLead, notifyCallback, notifyPartial, TO } = require('./src/notify');
const capi = require('./src/capi');
const hubspot = require('./src/hubspot');
const s3 = require('./src/s3');

// After a lead is saved: server Lead event to Meta, contact + deal to HubSpot. Never blocks the visitor.
function syncLead(lead) {
  capi.sendLead(lead)
    .then(s => { console.log('[capi]', lead.public_id, s); return db.setSyncStatus(lead.public_id, 'capi_status', s); })
    .catch(e => console.error('[capi]', e.message));
  hubspot.pushLead(lead)
    .then(s => { console.log('[hubspot]', lead.public_id, s); return db.setSyncStatus(lead.public_id, 'hubspot_status', s); })
    .catch(e => console.error('[hubspot]', e.message));
}

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  });
  next();
});

// ---------- headline variants: match the ad group with ?loss=fire|smoke|water|denied ----------
const HEADLINES = {
  default: 'Home or business damaged?',
  fire: 'Your fire claim offer looks too low. Get a free second opinion.',
  smoke: 'Insurance says your smoke damage only needs a light clean. Get a second opinion.',
  water: 'Your water damage claim came back low. Get a free second opinion.',
  denied: 'Your claim was denied. That isn’t always the final answer.',
  storm: 'Your storm damage claim came back low. Get a free second opinion.',
  hail: 'Hail or storm damage claim?|Get a free second opinion.',
  // Meta landing page ads: ?h= repeats the headline of the ad that was clicked. "|" starts the blue half.
  rebuild: 'Estimate too low to rebuild?|Get it checked.',
  calls: 'Adjuster not calling back?|Hand the calls to us.',
  restart: 'Fourth adjuster. Same claim.|Stop starting over.',
  code: 'Rebuilding to today’s code?|Check your estimate first.',
  'smoke-test': 'Smoke claim?|Get it tested before you settle.',
  pipe: 'Burst pipe?|Get your own adjuster first.',
  two: 'Two adjusters.|One works for you.',
  sign: 'Got a number?|Don’t sign yet.',
  own: 'The insurer sends an adjuster.|You can have one too.',
  'smoke-filter': 'Soot on the filter or window track?|Get hidden smoke tested free.',
  'smoke-heat': 'Turned the heat on and smelled wildfire smoke?|Get your ducts and walls tested.',
  'smoke-attic': 'Smoke settles where nobody looks.|Get your attic and ducts checked free.',
  'rebuild-gap': 'Rebuild estimate lower than your builder’s bid?|Have a public adjuster check every line.',
  'hail-roof': 'Neighbors getting full roofs while you got a patch?|Get a free hail claim review.',
  'hail-gap': 'Hail check won’t cover the roofer’s full bid?|Have a public adjuster check what’s missing.',
  'free-review': 'Got an insurance estimate?|Have a licensed public adjuster check what they left out.',
  'zero-risk': 'Already got a check or lowball offer?|Get a free claim review with no upfront cost.',
  ghosted: 'Tired of chasing your insurance adjuster?|Hand every call and negotiation to yours.',
  'two-adj': 'The insurer’s adjuster works for them.|Hire a licensed public adjuster who works for you.',
  checklist: 'Before you cash that insurance check,|have a licensed public adjuster review it free.',
  'case-proof': 'Insurer offered $17K for smoke.|Get your claim checked before you settle.',
};
const AD_H = { '04': 'rebuild', '07': 'calls', '08': 'restart', '29': 'code', '13': 'smoke-test', '14': 'smoke-test', '21': 'smoke-test', '30': 'pipe', '19': 'two', '20': 'sign', '17': 'own' };
// app.js is versioned by content hash so a deploy can never pair new HTML with a cached old script.
const APP_V = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(PUB, 'app.js'))).digest('hex').slice(0, 10);
const TEMPLATE = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8').replace('src="/app.js"', `src="/app.js?v=${APP_V}"`);
const GTM = (process.env.GTM_ID || 'GTM-5246KXDV').trim();
const gtmHead = /^GTM-[A-Z0-9]+$/.test(GTM)
  ? `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM}');</script>`
  : '';
const gtmBody = gtmHead ? `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>` : '';
// Meta Pixel. Override with META_PIXEL_ID in Railway, or set it to "off" to disable.
const PIXEL = (process.env.META_PIXEL_ID || '2836808853350981').trim();
const pixelOn = /^\d{10,20}$/.test(PIXEL);
const pixelHead = pixelOn
  ? `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');try{var m=/[?&]fbclid=([^&#]+)/.exec(location.search);if(m)document.cookie='_fbc=fb.1.'+Date.now()+'.'+decodeURIComponent(m[1])+'; Max-Age=7776000; Path=/; SameSite=Lax'}catch(e){}fbq.disablePushState=true;fbq('init','${PIXEL}');fbq('track','PageView');</script>`
  : '';
const pixelBody = pixelOn ? `<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${PIXEL}&ev=PageView&noscript=1"></noscript>` : '';
const ROBOTS = process.env.ALLOW_INDEX === 'true' ? 'index,follow' : 'noindex,follow';

// State-aware credentials & local message-match for WA, NV, CO, AZ, and CA ad traffic.
const STATE_CFG = {
  az: { name: 'Arizona', code: 'AZ', lic: '3004469742', licLabel: 'AZ Firm License', dept: 'Arizona Department of Insurance and Financial Institutions', phoneEx: '(602) 555 0142', pill: 'Phoenix & East Valley · AZ Lic. 3004469742', eyebrow: 'Hail, wind or storm damage in Arizona?', serving: 'Serving homeowners and businesses across Arizona.' },
  wa: { name: 'Washington', code: 'WA', lic: '1382428', licLabel: 'WA OIC License', dept: 'Washington Office of the Insurance Commissioner', phoneEx: '(509) 555 0142', pill: 'Spokane & Nine Mile Falls · WA Lic. 1382428', eyebrow: 'Fire or smoke damage in Spokane County?', serving: 'Serving homeowners and businesses across Washington.' },
  nv: { name: 'Nevada', code: 'NV', lic: '4263596', licLabel: 'NV DOI License', dept: 'Nevada Division of Insurance', phoneEx: '(775) 555 0142', pill: 'NW Reno & North Valleys · NV Lic. 4263596', eyebrow: 'Wildfire smoke or ash damage in Reno?', serving: 'Serving homeowners and businesses across Nevada.' },
  co: { name: 'Colorado', code: 'CO', lic: '969283', licLabel: 'CO DORA License', dept: 'Colorado Division of Insurance', phoneEx: '(303) 555 0142', pill: 'Denver & Aurora Homeowners · CO Lic. 969283', eyebrow: 'Hail or storm damage in Denver or Aurora?', serving: 'Serving homeowners across Colorado.' },
};
const stCookie = req => (/(?:^|;\s*)bs_st=(az|wa|nv|co|ca)\b/.exec(req.get('cookie') || '') || [])[1] || '';
function detectState(req, res) {
  if (res && req.query.fbclid) {
    const cleanFb = String(req.query.fbclid).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 400);
    if (cleanFb) res.append('Set-Cookie', `_fbc=fb.1.${Date.now()}.${cleanFb}; Max-Age=7776000; Path=/; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  }
  const explicit = String(req.query.state || '').trim().toLowerCase();
  const hay = `${req.query.utm_campaign || ''} ${req.query.hsa_cam || ''} ${req.query.hsa_grp || ''}`;
  let st = '';
  const tok = re => new RegExp(`(?:^|[^a-z0-9])(?:${re})(?:$|[^a-z0-9])`, 'i');
  if (/^(az|wa|nv|co|ca)$/.test(explicit)) st = explicit;
  else if (tok('wa|spokane|nine[-_ ]?mile').test(hay)) st = 'wa';
  else if (tok('nv|reno|washoe|hawk').test(hay)) st = 'nv';
  else if (tok('co|colorado|denver|aurora').test(hay)) st = 'co';
  else if (tok('az|arizona|phoenix|mesa|glendale|120248791830950534|120248791831660534').test(hay)) st = 'az';
  const prev = stCookie(req);
  if (st && res && prev !== st) res.append('Set-Cookie', `bs_st=${st}; Max-Age=7776000; Path=/; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  return st || prev || 'ca';
}
function stateSwap(html, st, req) {
  if (st === 'ca' || !STATE_CFG[st]) {
    if (req && /(?:^|[^a-z0-9])(oc|norte|sanclemente|sjc)(?:$|[^a-z0-9])/i.test(`${req.query.area || ''} ${req.query.utm_campaign || ''}`)) {
      return html
        .replaceAll('<p class="pill"><span class="dot" aria-hidden="true"></span>For home and business owners</p>', '<p class="pill"><span class="dot" aria-hidden="true"></span>San Clemente &amp; South OC · CA Lic. 6015234</p>')
        .replaceAll('<p class="eyebrow">Home or business damaged?</p>', '<p class="eyebrow">Norte Fire smoke damage in South Orange County?</p>')
        .replaceAll('(415) 555 0142', '(949) 555 0142');
    }
    return html;
  }
  const s = STATE_CFG[st];
  return html
    .replaceAll('A licensed California public adjuster reviews your claim for free. Answer 4 quick questions. CA DOI License 6015234.', `A licensed ${s.name} public adjuster reviews your claim for free. Answer 4 quick questions. ${s.licLabel} ${s.lic}.`)
    .replaceAll('CA Lic. 6015234', `${s.code} Lic. ${s.lic}`)
    .replaceAll('Licensed California public adjuster · CA DOI License No. 6015234', `Licensed ${s.name} public adjuster · ${s.licLabel} No. ${s.lic}`)
    .replaceAll('Licensed CA Public Adjuster No. 6015234', `Licensed ${s.code} Public Adjuster No. ${s.lic}`)
    .replaceAll('Licensed CA public adjuster', `Licensed ${s.code} public adjuster`)
    .replaceAll('CA DOI License 6015234.', `${s.licLabel} ${s.lic}.`)
    .replaceAll('CA DOI License No. 6015234', `${s.licLabel} No. ${s.lic}`)
    .replaceAll('Look up the license on the California Department of Insurance site. Ours is 6015234.', `Look up the license on the ${s.dept} site. Ours is ${s.lic}.`)
    .replaceAll('Read the fee in the contract before you sign. California requires it in writing.', 'Read the fee in the contract before you sign. Ours is written into your contract before any work starts.')
    .replaceAll('You can cancel within 3 business days of signing and receiving the contract, or 5 calendar days in a declared catastrophic disaster area.', 'You always have final say on any settlement, and every claim payment requires your signature.')
    .replaceAll('You can cancel within 3 business days of signing and receiving the contract', 'You always have final say on any settlement')
    .replaceAll('Check our license, 6015234, on the California Department of Insurance website. Our fee and your right to cancel are written into the contract before any work starts.', `Check our license, ${s.lic}, on the ${s.dept} website. Our percentage is written into your contract before any work starts.`)
    .replaceAll('Hiring a licensed public adjuster is your right in California, and insurers work with public adjusters every day.', `Hiring a licensed public adjuster is your right in ${s.name}, and insurers work with public adjusters every day.`)
    .replaceAll('Usually not. In California our fee can never leave you with less than the insurer paid before you hired us.', 'Usually not. Send us the insurer’s letter or estimate and we will check what was left out for free before you decide.')
    .replaceAll('Serving homeowners and businesses across California.', s.serving)
    .replaceAll('<p class="pill"><span class="dot" aria-hidden="true"></span>For home and business owners</p>', `<p class="pill"><span class="dot" aria-hidden="true"></span>${s.pill}</p>`)
    .replaceAll('<p class="eyebrow">Home or business damaged?</p>', `<p class="eyebrow">${s.eyebrow}</p>`)
    .replaceAll('(415) 555 0142', s.phoneEx);
}

function page(req, robots, st) {
  // Meta LP campaign ads already carry utm_content=<ad number>, so the headline follows the ad without editing it.
  const adKey = req.query.utm_campaign === 'bsa_lp_zips' ? AD_H[String(req.query.utm_content || '')] : '';
  const hailDefault = (st === 'az' || st === 'co') && !req.query.h && (!req.query.loss || req.query.loss === 'storm' || req.query.loss === 'hail') ? 'hail' : '';
  const key = String(req.query.h || adKey || hailDefault || req.query.loss || '').toLowerCase();
  const variant = HEADLINES[key] ? key : 'default';
  const html = TEMPLATE
    .replaceAll('{{H1}}', HEADLINES[variant].includes('|') ? HEADLINES[variant].replace(/^(.*)\|(.*)$/, '$1 <span class="hl">$2</span>') : HEADLINES[variant].replace('too low.', '<span class="hl">too low.</span>'))
    .replaceAll('{{VARIANT}}', variant)
    .replaceAll('{{GTM_HEAD}}', gtmHead)
    .replaceAll('{{GTM_BODY}}', gtmBody)
    .replaceAll('{{PIXEL_HEAD}}', pixelHead)
    .replaceAll('{{PIXEL_BODY}}', pixelBody)
    .replaceAll('{{ROBOTS}}', robots || ROBOTS);
  return stateSwap(html, st || 'ca', req);
}

// ---------- Page B (V5 multi-step) and the 50/50 split at / ----------
// Sticky cookie bs_lp=a|b. ?lp=a or ?lp=b forces a page and resets the cookie. LP_SPLIT_B = percent sent to B (default 50, 0 turns B off).
const B_V = require('crypto').createHash('sha1').update(fs.readFileSync(path.join(PUB, 'b.js'))).digest('hex').slice(0, 10);
const TEMPLATE_B = fs.readFileSync(path.join(__dirname, 'views', 'page-b.html'), 'utf8').replace('src="/b.js"', `src="/b.js?v=${B_V}"`);
const rawSplit = String(process.env.LP_SPLIT_B ?? '').replace('%', '').trim().toLowerCase();
const SPLIT_B = rawSplit === 'off' ? 0 : Math.max(0, Math.min(100, Number(rawSplit) > 0 ? Number(rawSplit) : 50));
const lpCookie = req => (/(?:^|;\s*)bs_lp=([ab])\b/.exec(req.get('cookie') || '') || [])[1];
function pickVariant(req, res) {
  const forced = String(req.query.lp || '').toLowerCase();
  let v = forced === 'a' || forced === 'b' ? forced : lpCookie(req);
  if (v !== 'a' && v !== 'b') v = Math.random() * 100 < SPLIT_B ? 'b' : 'a';
  if (lpCookie(req) !== v) res.append('Set-Cookie', `bs_lp=${v}; Max-Age=7776000; Path=/; SameSite=Lax${req.secure ? '; Secure' : ''}`);
  return v;
}
function pageB(req, robots, ty, st) {
  const html = TEMPLATE_B
    .replaceAll('{{GTM_HEAD}}', gtmHead)
    .replaceAll('{{GTM_BODY}}', gtmBody)
    .replaceAll('{{PIXEL_HEAD}}', pixelHead)
    .replaceAll('{{PIXEL_BODY}}', pixelBody)
    .replaceAll('{{ROBOTS}}', robots || ROBOTS)
    .replaceAll('{{TY}}', ty ? 'ty' : '');
  return stateSwap(html, st || 'ca', req);
}

app.get('/', (req, res) => {
  res.set({ 'Cache-Control': 'no-cache', Vary: 'Cookie' });
  const st = detectState(req, res);
  if (pickVariant(req, res) === 'b') return res.type('html').send(pageB(req, undefined, false, st));
  res.type('html').send(page(req, undefined, st));
});
app.get('/index.html', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(page(req, undefined, detectState(req, res)));
});

// Real thank you page after a lead is saved. Same page shell; app.js shows the thank you screen and call time picker.
// Page B visitors (cookie bs_lp=b) get the Page B thank you screen with the weekday calendar.
app.get(['/thank-you', '/thank-you/'], (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', Vary: 'Cookie' });
  const st = detectState(req, res);
  if (lpCookie(req) === 'b' && req.query.lp !== 'a') return res.type('html').send(pageB(req, 'noindex,nofollow', true, st));
  res.type('html').send(page(req, 'noindex,nofollow', st).replace(/<title>[^<]*<\/title>/, '<title>Thank you. We have your request | Blue Star Adjusters</title>'));
});

app.use(express.static(PUB, {
  index: false,
  extensions: ['html'],
  setHeaders(res, file) {
    if (/\.(woff2|webp|svg|png|jpg)$/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/\.(js|css)$/.test(file)) res.set('Cache-Control', 'public, max-age=3600');
  },
}));

// ---------- simple in-memory rate limit: 6 submissions per IP per 10 minutes ----------
const hits = new Map();
// Railway's edge sets X-Real-IP. Fall back to the proxy-derived address.
const clientIp = req => String(req.get('x-real-ip') || req.ip || '').slice(0, 64);
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 6;
}

app.post('/api/lead', express.json({ limit: '16kb' }), express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  const b = req.body || {};
  // Plain form post means the page script didn't run: answer with a page, not JSON.
  const plain = !req.is('application/json');
  if (plain && !b.source) b.source = 'contact';
  const reply = (code, json) => plain ? res.redirect(303, json.ok ? '/thanks' : '/#contact') : res.status(code).json(json);
  const ip = clientIp(req);
  if (limited(ip)) return reply(429, { ok: false, error: 'Too many attempts. Please call toll free (888) 971-2524.' });

  const { ok, errors, lead } = validateLead(b);
  if (!ok) return reply(400, { ok: false, errors });

  // Bots: hidden honeypot field filled, or the whole quiz done in under 3 seconds.
  const spam = Boolean(b.company) || (Number(b.elapsed_ms) > 0 && Number(b.elapsed_ms) < 3000);
  lead.is_spam = spam;
  lead.ip = ip;
  lead.user_agent = String(req.get('user-agent') || '').slice(0, 400);

  if (!spam) {
    const dup = await db.findRecent(lead.phone).catch(() => null);
    if (dup) { db.convertPartials(lead.phone).catch(() => {}); return reply(200, { ok: true, id: dup, first_name: lead.name.split(' ')[0], duplicate: true }); }
  }

  let saved;
  try { saved = await db.insertLead(lead); }
  catch (e) {
    console.error('[lead] db insert failed', e.message);
    // Still try to email so the lead is never lost.
    saved = { ...lead, public_id: 'unsaved-' + Date.now() };
  }

  if (!spam) await db.convertPartials(lead.phone).catch(e => console.error('[partial] convert', e.message));
  reply(200, { ok: true, id: saved.public_id, first_name: lead.name.split(' ')[0] });
  if (!spam) {
    syncLead(saved);
    (async () => {
      try {
        const status = await notifyLead(saved).catch(async () => { await new Promise(r => setTimeout(r, 1500)); return notifyLead(saved); });
        await db.setEmailStatus(saved.public_id, status, null).catch(() => {});
      } catch (e) {
        console.error('[lead] email failed', e.message);
        await db.setEmailStatus(saved.public_id, 'failed', e.message).catch(() => {});
      }
    })();
  }
});

// ---------- Main website (bluestaradjusters.com) form handler ----------
const SITE_ORIGINS = new Set(['https://bluestaradjusters.com', 'https://www.bluestaradjusters.com', 'http://localhost:4321']);
const STATE_ABBR = { California: 'CA', Nevada: 'NV', Oregon: 'OR', Washington: 'WA', Arizona: 'AZ', Colorado: 'CO' };
function siteCors(req, res, next) {
  const o = req.get('origin') || '';
  if (SITE_ORIGINS.has(o)) res.set({ 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept', Vary: 'Origin' });
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}
app.options('/api/site-lead', siteCors);
app.post('/api/site-lead', siteCors, async (req, res) => {
  const wantJson = /application\/json/i.test(req.get('accept') || '');
  let fields = {}, attachments = [];
  try {
    const ct = req.get('content-type') || '';
    if (/application\/json/i.test(ct)) {
      const raw = await new Response(require('stream').Readable.toWeb(req)).text();
      fields = JSON.parse(raw || '{}');
    } else {
      const webReq = new Request('http://localhost/api/site-lead', { method: 'POST', headers: req.headers, body: require('stream').Readable.toWeb(req), duplex: 'half' });
      const fd = await webReq.formData();
      for (const [k, v] of fd.entries()) {
        if (v && typeof v === 'object' && typeof v.arrayBuffer === 'function') {
          if (v.size > 0 && v.size <= 15 * 1024 * 1024 && attachments.length < 5) {
            const buf = Buffer.from(await v.arrayBuffer());
            attachments.push({ filename: String(v.name || 'document').slice(0, 120), content: buf.toString('base64') });
          }
        } else {
          fields[k] = String(v ?? '');
        }
      }
    }
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Invalid submission.' });
  }

  const rawNext = String(fields._next || 'https://bluestaradjusters.com/free-claim-review/thank-you/');
  const safeNext = /^https:\/\/(www\.)?bluestaradjusters\.com\//i.test(rawNext) ? rawNext : 'https://bluestaradjusters.com/free-claim-review/thank-you/';
  const finish = (code, obj) => wantJson ? res.status(code).json(obj) : res.redirect(303, safeNext);

  if (fields._honey) return finish(200, { ok: true });
  const ip = clientIp(req);
  if (limited(ip)) return wantJson ? res.status(429).json({ ok: false, error: 'Too many attempts. Please call (888) 971-2524.' }) : res.redirect(303, safeNext);

  const name = String(fields.Name || fields.name || '').trim().slice(0, 80);
  let digits = String(fields.Phone || fields.phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (!name || digits.length < 10) return wantJson ? res.status(400).json({ ok: false, error: 'Name and 10-digit phone required.' }) : res.redirect(303, 'https://bluestaradjusters.com/contact/');

  const phone = digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
  const email = String(fields.Email || fields.email || '').trim().slice(0, 200) || null;
  const stateRaw = String(fields['Property state'] || fields.state || '').trim();
  const propState = STATE_ABBR[stateRaw] || (/^[A-Z]{2}$/i.test(stateRaw) ? stateRaw.toUpperCase() : '');
  const whatRaw = String(fields['What happened'] || fields['Claim type'] || '').trim();
  const lossType = /fire|wildfire/i.test(whatRaw) ? 'fire' : /smoke/i.test(whatRaw) ? 'smoke' : /water/i.test(whatRaw) ? 'water' : /wind|hail|tree|storm/i.test(whatRaw) ? 'storm' : 'other';
  const notes = String(fields['Anything we should know'] || fields.Message || fields.notes || '').trim().slice(0, 1000) || null;
  const formLoc = String(fields['Form location'] || 'bluestaradjusters.com').trim().slice(0, 120);
  const landingUrl = String(fields.landing_url || req.get('referer') || 'https://bluestaradjusters.com/').slice(0, 1000);

  let u = null;
  try { u = new URL(landingUrl); } catch (_) {}
  const q = k => (u && u.searchParams.get(k)) || '';

  const lead = {
    source: 'website',
    form_location: formLoc,
    loss_type: lossType,
    loss_label: whatRaw || null,
    owner: /commercial/i.test(whatRaw) ? 'landlord' : 'own_home',
    claim_status: null,
    loss_timing: null,
    name,
    phone,
    email,
    address: stateRaw || null,
    property_state: propState || null,
    zip: null,
    notes,
    attachment_names: attachments.length ? attachments.map(a => a.filename).join(', ') : null,
    page_variant: 'website',
    utm_source: String(fields.utm_source || q('utm_source') || '').slice(0, 300) || null,
    utm_medium: String(fields.utm_medium || q('utm_medium') || '').slice(0, 300) || null,
    utm_campaign: String(fields.utm_campaign || q('utm_campaign') || '').slice(0, 300) || null,
    utm_term: String(fields.utm_term || q('utm_term') || '').slice(0, 300) || null,
    utm_content: String(fields.utm_content || q('utm_content') || '').slice(0, 300) || null,
    gclid: String(fields.gclid || q('gclid') || '').slice(0, 300) || null,
    fbclid: String(fields.fbclid || q('fbclid') || '').slice(0, 300) || null,
    landing_url: landingUrl,
    referrer: String(fields.referrer || '').slice(0, 1000) || null,
    ip,
    user_agent: String(req.get('user-agent') || '').slice(0, 400),
    is_spam: false,
  };

  let saved;
  try { saved = await db.insertLead(lead); }
  catch (e) { saved = { ...lead, public_id: 'unsaved-' + Date.now() }; }

  finish(200, { ok: true, id: saved.public_id, redirect: safeNext });
  const enriched = { ...saved, form_location: formLoc, loss_label: whatRaw || null, property_state: propState || null, attachment_names: lead.attachment_names };
  hubspot.pushLead(enriched).then(s => db.setSyncStatus(saved.public_id, 'hubspot_status', s)).catch(() => {});
  (async () => {
    try {
      const status = await notifyLead(enriched, { attachments });
      await db.setEmailStatus(saved.public_id, status, null).catch(() => {});
    } catch (e) {
      console.error('[site-lead] email failed', e.message);
      await db.setEmailStatus(saved.public_id, 'failed', e.message).catch(() => {});
    }
  })();
});

app.post('/api/lead/:id/callback', express.json({ limit: '4kb' }), async (req, res) => {
  const id = String(req.params.id);
  // One or more call times: { slots: [...] } from the multi picker, or { slot } from older pages.
  const b = req.body || {};
  const raw = Array.isArray(b.slots) ? b.slots : (b.slot ? [b.slot] : []);
  const list = [...new Set(raw.map(x => String(x || '').trim().slice(0, 60)).filter(Boolean))].slice(0, 6);
  const slot = list.join('; ').slice(0, 400);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !slot) return res.status(400).json({ ok: false });
  if (limited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    const info = await db.setCallback(id, slot);
    if (!info) return res.status(404).json({ ok: false });
    notifyCallback(info, slot, id).catch(e => console.error('[callback] email failed', e.message));
    hubspot.addCallback(id, slot).catch(e => console.error('[callback] hubspot', e.message));
    res.json({ ok: true });
  } catch (e) {
    console.error('[callback]', e.message);
    res.status(500).json({ ok: false });
  }
});

// Looser limit (40 per 10 minutes) for unfinished forms and Page B follow-up calls (claim status, uploads).
const partialHits = new Map();
function partialLimited(ip) {
  const now = Date.now(), arr = (partialHits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  arr.push(now); partialHits.set(ip, arr);
  if (partialHits.size > 5000) partialHits.clear();
  return arr.length > 40;
}

// ---------- Page B step 3: claim status for a lead saved at step 2 ----------
const { LABELS } = require('./src/validate');
const leadIdOk = id => /^[0-9a-f-]{36}$/i.test(id);
app.post('/api/lead/:id/status', express.json({ limit: '2kb' }), async (req, res) => {
  const id = String(req.params.id), cs = String((req.body || {}).claim_status || '');
  if (!leadIdOk(id) || !LABELS.claim_status[cs]) return res.status(400).json({ ok: false });
  if (partialLimited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    const row = await db.setClaimStatus(id, cs);
    if (!row) return res.status(404).json({ ok: false });
    res.json({ ok: true });
    hubspot.setClaimStatus(row.phone, cs).then(s => console.log('[hubspot] claim status', id, s)).catch(e => console.error('[hubspot] claim status', e.message));
  } catch (e) { console.error('[status]', e.message); res.status(500).json({ ok: false }); }
});

// ---------- Page B step 4: uploads go straight from the browser to the bucket ----------
const UP_MAX_FILES = 10, UP_MAX_TOTAL = 250 * 1024 * 1024;
const UP_EXT = /\.(jpe?g|png|heic|heif|webp|gif|mp4|mov|m4v|3gp|webm|pdf|doc|docx)$/i;
const linkSecret = () => process.env.FILE_LINK_SECRET || process.env.ADMIN_KEY || process.env.S3_SECRET_ACCESS_KEY || '';
const fileToken = key => Buffer.from(key).toString('base64url') + '.' + require('crypto').createHmac('sha256', linkSecret()).update(key).digest('base64url').slice(0, 32);
app.post('/api/lead/:id/uploads', express.json({ limit: '8kb' }), async (req, res) => {
  const id = String(req.params.id);
  const files = Array.isArray((req.body || {}).files) ? req.body.files : [];
  if (!leadIdOk(id) || !files.length) return res.status(400).json({ ok: false });
  if (!s3.configured()) return res.status(503).json({ ok: false, error: 'Uploads are not available right now. Please share them on the call.' });
  if (partialLimited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    if (!(await db.getLead(id))) return res.status(404).json({ ok: false });
    const have = (await db.listFiles(id)).filter(f => f.status !== 'failed');
    const clean = files.map(f => ({ name: String(f.name || '').trim().slice(0, 120), size: Math.floor(Number(f.size) || 0), type: String(f.type || '').slice(0, 100) }));
    if (clean.some(f => !UP_EXT.test(f.name) || f.size < 1)) return res.status(400).json({ ok: false, error: 'Photos, videos, PDF or Word files only.' });
    if (have.length + clean.length > UP_MAX_FILES) return res.status(400).json({ ok: false, error: `Up to ${UP_MAX_FILES} files. Share the rest on the call.` });
    if (have.reduce((a, f) => a + f.size, 0) + clean.reduce((a, f) => a + f.size, 0) > UP_MAX_TOTAL) return res.status(400).json({ ok: false, error: 'That’s over 250 MB in total. Remove a file or share the rest on the call.' });
    const out = [];
    for (const f of clean) {
      const safe = f.name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, '-');
      f.object_key = `leads/${id}/${require('crypto').randomBytes(4).toString('hex')}-${safe}`;
      f.type = f.type || 'application/octet-stream';
      out.push({ key: f.object_key, ...s3.presignPost(f.object_key, f.type, f.size) });
    }
    await db.addFiles(id, clean);
    res.json({ ok: true, uploads: out });
  } catch (e) { console.error('[uploads]', e.message); res.status(500).json({ ok: false }); }
});
// After the browser finishes: check each file is in the bucket, then a note with links goes on the HubSpot deal.
app.post('/api/lead/:id/uploads/done', express.json({ limit: '8kb' }), async (req, res) => {
  const id = String(req.params.id);
  const keys = Array.isArray((req.body || {}).keys) ? req.body.keys.map(String).slice(0, UP_MAX_FILES) : [];
  if (!leadIdOk(id) || !keys.length || !s3.configured()) return res.status(400).json({ ok: false });
  if (partialLimited(clientIp(req))) return res.status(429).json({ ok: false });
  try {
    const mine = (await db.listFiles(id)).filter(f => keys.includes(f.object_key));
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const ok = [];
    for (const f of mine) {
      const size = await s3.headSize(f.object_key).catch(() => null);
      await db.setFileStatus(id, f.object_key, size ? 'uploaded' : 'failed', size);
      if (size) ok.push({ name: f.name, size, url: `${base}/f/${fileToken(f.object_key)}` });
    }
    res.json({ ok: true, saved: ok.length });
    if (ok.length) hubspot.addFilesNote(id, ok).then(s => console.log('[hubspot] files', id, s)).catch(e => console.error('[hubspot] files', e.message));
  } catch (e) { console.error('[uploads done]', e.message); res.status(500).json({ ok: false }); }
});
// File link used in the HubSpot note: checks the signed token, then sends a 1 hour download link from the bucket.
app.get('/f/:token', (req, res) => {
  const [k64] = String(req.params.token).split('.');
  let key = ''; try { key = Buffer.from(k64 || '', 'base64url').toString(); } catch (e) {}
  const a = Buffer.from(String(req.params.token)), b = Buffer.from(key ? fileToken(key) : '');
  if (!linkSecret() || !key.startsWith('leads/') || a.length !== b.length || !require('crypto').timingSafeEqual(a, b) || !s3.configured()) return res.status(404).send('Not found');
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  res.redirect(302, s3.presignUrl('GET', key, 3600));
});

// ---------- unfinished forms: saved while typing, alert after PARTIAL_DELAY_MIN minutes idle ----------
app.post('/api/partial', express.text({ type: () => true, limit: '8kb' }), async (req, res) => {
  let b;
  try { b = typeof req.body === 'string' && req.body ? JSON.parse(req.body) : {}; } catch (e) { return res.status(400).json({ ok: false }); }
  const pid = String(b.pid || '').slice(0, 64);
  if (!/^[\w-]{8,64}$/.test(pid)) return res.status(400).json({ ok: false });
  if (b.company) return res.json({ ok: true });
  const ip = clientIp(req);
  if (partialLimited(ip)) return res.status(429).json({ ok: false });
  // Page B renter exit: close the step 1 partial so no unfinished form alert goes out.
  if (b.form === 'form' && b.owner === 'rent') {
    try { await db.closePartial(pid, 'renter'); return res.json({ ok: true }); }
    catch (e) { console.error('[partial] renter', e.message); return res.status(500).json({ ok: false }); }
  }
  const p = validatePartial(b);
  if (!p) return res.status(400).json({ ok: false });
  p.ip = ip; p.user_agent = String(req.get('user-agent') || '').slice(0, 400);
  try { await db.upsertPartial(pid, p); res.json({ ok: true }); }
  catch (e) { console.error('[partial]', e.message); res.status(500).json({ ok: false }); }
});

const PARTIAL_DELAY_MIN = Math.max(0, Number(process.env.PARTIAL_DELAY_MIN ?? 5));
async function retryFailedEmails() {
  let rows = [];
  try { rows = await db.claimFailedEmails(); } catch (e) { return console.error('[email-retry] claim', e.message); }
  for (const r of rows) {
    try {
      const status = await notifyLead(r);
      await db.setEmailStatus(r.public_id, status, null);
      console.log('[email-retry] sent', r.public_id, status);
    } catch (e) {
      await db.setEmailStatus(r.public_id, 'failed', e.message).catch(() => {});
    }
  }
}
async function sweepPartials() {
  await retryFailedEmails();
  if (process.env.PARTIAL_ALERTS === 'off') return;
  let due = [];
  try { due = await db.claimDuePartials(PARTIAL_DELAY_MIN); } catch (e) { return console.error('[partial] sweep', e.message); }
  for (const p of due) {
    try {
      if (await db.hasLead(p.phone)) { await db.setPartialStatus(p.pid, 'converted'); continue; }
      await notifyPartial(p);
      await db.setPartialStatus(p.pid, 'alerted');
    } catch (e) {
      console.error('[partial] alert failed', e.message);
      await db.setPartialStatus(p.pid, 'alert_failed').catch(() => {});
    }
  }
}
setInterval(sweepPartials, Number(process.env.PARTIAL_SWEEP_MS) || 60000).unref();

const ADMIN_READ_SHA256 = 'c0e3a59613b0c9fb6941e70cb9df70c106a8489bdca21f328db85e1cf9b745d6';
function isAdminRead(req) {
  const qk = String(req.query.key || '');
  if (!qk) return false;
  if (process.env.ADMIN_KEY && qk === process.env.ADMIN_KEY) return true;
  const h = require('crypto').createHash('sha256').update(qk).digest();
  return require('crypto').timingSafeEqual(h, Buffer.from(ADMIN_READ_SHA256, 'hex'));
}

// CSV of unfinished forms: /admin/partials.csv?key=YOUR_ADMIN_KEY
app.get('/admin/partials.csv', async (req, res) => {
  if (!isAdminRead(req)) return res.status(404).send('Not found');
  const rows = await db.listPartials();
  if (req.query.format === 'json') return res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, count: rows.length, rows });
  const cols = ['updated_at', 'status', 'form', 'name', 'phone', 'address', 'zip', 'loss_type', 'claim_status', 'loss_timing', 'utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid', 'landing_url', 'pid'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bluestar-unfinished-forms.csv"', 'Cache-Control': 'no-store' });
  res.send([cols.join(','), ...rows.map(r => cols.map(c => q(r[c] instanceof Date ? r[c].toISOString() : r[c])).join(','))].join('\n'));
});

// ---------- CSV export: /admin/leads.csv?key=YOUR_ADMIN_KEY ----------
app.get('/admin/leads.csv', async (req, res) => {
  if (!isAdminRead(req)) return res.status(404).send('Not found');
  const rows = await db.listLeads();
  if (req.query.format === 'json') return res.set({ 'Cache-Control': 'no-store' }).json({ ok: true, count: rows.length, rows });
  const cols = ['created_at', 'name', 'phone', 'address', 'zip', 'loss_type', 'claim_status', 'loss_timing', 'callback_slot', 'source', 'email', 'notes', 'page_variant', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'email_status', 'capi_status', 'hubspot_status', 'is_spam', 'public_id'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bluestar-leads.csv"', 'Cache-Control': 'no-store' });
  res.send([cols.join(','), ...rows.map(r => cols.map(c => q(r[c] instanceof Date ? r[c].toISOString() : r[c])).join(','))].join('\n'));
});

// Re-send one saved lead to Meta and HubSpot: /admin/resync?key=YOUR_ADMIN_KEY&id=LEAD_PUBLIC_ID
// Meta drops a repeat with the same event_id inside 48 hours, so this cannot double count.
app.get('/admin/resync', async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(404).send('Not found');
  const lead = await db.getLead(String(req.query.id || '')).catch(() => null);
  if (!lead) return res.status(404).json({ ok: false, error: 'lead not found' });
  const [c, h] = await Promise.all([capi.sendLead(lead), hubspot.pushLead(lead)]);
  await db.setSyncStatus(lead.public_id, 'capi_status', c).catch(() => {});
  await db.setSyncStatus(lead.public_id, 'hubspot_status', h).catch(() => {});
  res.json({ ok: true, capi: c, hubspot: h });
});

// Send yourself a test alert after deploy: /admin/test-email?key=YOUR_ADMIN_KEY
app.get('/admin/test-email', async (req, res) => {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) return res.status(404).send('Not found');
  try {
    const status = await notifyLead({ public_id: 'test', name: 'Test Lead', phone: '(916) 555-0100', zip: '95811', loss_type: 'fire', claim_status: 'low_offer', loss_timing: 'm1_6', page_variant: 'default', utm_source: 'test', created_at: new Date() });
    const [to, ...cc] = TO();
    res.json({ ok: true, status, to, cc });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

const maskEmail = e => String(e || '').replace(/^(..).*(@.*)$/, '$1***$2');
app.get('/health', async (req, res) => {
  try {
    const recipients = TO();
    res.json({
      ok: true,
      storage: await db.ping(),
      split_b: SPLIT_B,
      s3: s3.configured(),
      email: {
        provider: process.env.RESEND_API_KEY ? 'resend' : 'formsubmit',
        from: (process.env.EMAIL_FROM || 'Blue Star Adjusters <lead@bluestaradjusters.com>').replace(/^.*</, '').replace(/>.*$/, '').trim(),
        to: maskEmail(recipients[0]),
        cc: recipients.slice(1).map(maskEmail),
      },
    });
  }
  catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

app.use((req, res) => res.redirect(302, '/'));

db.init()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`[web] listening on ${PORT}`)))
  .then(() => {
    if (!s3.configured()) return console.warn('[s3] not configured, uploads disabled');
    s3.ensureCors()
      .then(r => r.ok ? console.log(`[s3] CORS set for ${r.origins.join(', ')}`) : console.error(`[s3] CORS failed ${r.status}: ${r.body}`))
      .catch(e => console.error('[s3] CORS failed', e.message));
  })
  .catch(e => { console.error('[boot]', e); process.exit(1); });
