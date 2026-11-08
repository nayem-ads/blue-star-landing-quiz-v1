// Page B (1-screen qualified homeowner claim check). Step 1 filters renters and saves full owner leads immediately.
(function () {
  'use strict';
  var d = document, w = window, body = d.body;
  var KEY = 'bs_b_v1';
  var TRACK = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'hsa_cam', 'hsa_grp', 'hsa_ad', 'hsa_kw', 'matchtype', 'device'];
  var LOSS = { fire: 1, smoke: 1, water: 1, storm: 1, hail: 1, denied: 1, other: 1 };
  var OWN = { own_home: 1, landlord: 1, rent: 1 };
  var CALL = 'Please try again or call toll free (888) 971-2524.';
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function $(id) { return d.getElementById(id); }

  var PVAR = body.dataset.variant || 'b';
  // Same events as Page A, tagged page_variant. Lead fires once, after the server saves the lead (eventID = lead id).
  function dl(ev, extra) {
    extra = extra || {};
    w.dataLayer = w.dataLayer || []; var o = { event: ev, page_variant: PVAR }; for (var k in extra) o[k] = extra[k]; w.dataLayer.push(o);
    if (typeof w.fbq !== 'function') return;
    if (ev === 'generate_lead') w.fbq('track', 'Lead', { content_name: extra.loss_type, content_category: extra.claim_status, form: 'form', page_variant: PVAR }, { eventID: extra.lead_id });
    else if (ev === 'call_click') w.fbq('track', 'Contact', { content_name: extra.location, page_variant: PVAR });
    else if (ev === 'callback_booked') w.fbq('track', 'Schedule', { content_name: extra.slot, page_variant: PVAR });
    else if (ev === 'quiz_start') w.fbq('trackCustom', 'QuizStart', { page_variant: PVAR });
    else if (ev === 'quiz_answer') w.fbq('trackCustom', 'QuizAnswer', { step: extra.step, answer: extra.answer, page_variant: PVAR });
  }
  function ck(n) { try { var m = d.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } }
  function digitsOf(v) { var x = String(v || '').replace(/\D/g, ''); if (x.length === 11 && x[0] === '1') x = x.slice(1); return x; }
  function post(url, data) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); }); }

  var state = load();
  var TY = body.dataset.ty === 'ty';
  var qs = new URLSearchParams(location.search);
  state.track = state.track || {};
  TRACK.forEach(function (k) { if (qs.get(k)) state.track[k] = qs.get(k); });
  if (!state.landing_url || qs.get('fbclid') || qs.get('gclid') || qs.get('utm_campaign')) { state.landing_url = location.href.split('#')[0]; state.referrer = d.referrer || ''; }
  if (!state.pid) state.pid = (w.crypto && w.crypto.randomUUID) ? w.crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  save();
  try {
    if (!qs.get('state') && !/(?:^|;\s*)bs_st=(wa|nv|co|or|ca)\b/.test(d.cookie) && Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Phoenix') {
      d.cookie = 'bs_st=az; Max-Age=7776000; Path=/; SameSite=Lax';
      d.querySelectorAll('.brand span,.checks li,.foot').forEach(function (el) {
        if (el.innerHTML.indexOf('6015234') > -1 || el.innerHTML.indexOf('Licensed CA') > -1) {
          el.innerHTML = el.innerHTML.replace('CA Lic. 6015234', 'AZ Lic. 3004469742').replace('Licensed CA public adjuster', 'Licensed AZ public adjuster').replace('CA DOI License No. 6015234', 'AZ Firm License No. 3004469742');
        }
      });
    }
  } catch (e) {}

  d.addEventListener('click', function (e) { var c = e.target.closest('[data-call]'); if (c) dl('call_click', { location: c.dataset.call }); });

  // ---------- screens ----------
  function show(step, push) {
    if (TY) step = '5';
    else {
      if (step === '2') step = state.lead_id ? '3' : '1';
      if (step !== '1' && step !== '2b' && !state.step1) step = '1';
      if ((step === '3' || step === '4') && !state.lead_id) step = '1';
      if (step === '5') step = state.lead_id ? '4' : '1';
    }
    var all = d.querySelectorAll('[data-step]');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i].dataset.step === step);
    if (push) history.pushState({ step: step }, '', step === '1' ? location.pathname + location.search : '#step-' + step);
    w.scrollTo(0, 0);
    if (step === '3') marks();
    var h = d.querySelector('[data-step="' + step + '"] h2');
    if (h) setTimeout(function () { h.focus({ preventScroll: true }); }, 60);
  }
  function hashStep() { var m = /#step-(2b|[1-5])/.exec(location.hash); return m ? m[1] : '1'; }
  w.addEventListener('popstate', function (e) { if (!TY) show((e.state && e.state.step) || hashStep(), false); });
  var backs = d.querySelectorAll('[data-back]');
  for (var bi = 0; bi < backs.length; bi++) backs[bi].addEventListener('click', function () { history.back(); });
  function marks() {
    var o = d.querySelectorAll('.opt');
    for (var i = 0; i < o.length; i++) o[i].setAttribute('aria-pressed', state[o[i].dataset.k] === o[i].dataset.v ? 'true' : 'false');
  }

  // Address suggestions while typing (Photon, OpenStreetMap data, free, no key). Free typing always still works.
  var US = { Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY' };
  var SKIP = {}; 'n s e w ne nw se sw north south east west old'.split(' ').forEach(function (x) { SKIP[x] = 1; });
  var TZ_LL = { 'America/Phoenix': '&lat=33.45&lon=-112.07', 'America/Los_Angeles': '&lat=36.78&lon=-119.42', 'America/Denver': '&lat=39.74&lon=-104.99', 'America/Boise': '&lat=43.62&lon=-116.20', 'America/Chicago': '&lat=32.78&lon=-96.80', 'America/New_York': '&lat=38.90&lon=-77.04', 'America/Detroit': '&lat=42.33&lon=-83.05', 'America/Indiana/Indianapolis': '&lat=39.77&lon=-86.16' };
  var BIAS = ''; try { BIAS = TZ_LL[Intl.DateTimeFormat().resolvedOptions().timeZone] || ''; } catch (e) {}
  function acFormat(p, q) {
    var street = (p.street || (p.type === 'street' ? p.name : '') || '').replace(/[\s,]*(ste|suite|apt|unit|bldg|#)\b.*$/i, '').trim();
    if (!street) return null;
    var qm = /^\s*(\d+[a-z]?)\b/i.exec(q), qnum = qm ? qm[1] : '';
    var rest = qm ? q.slice(qm[0].length) : q;
    var words = rest.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (x) { return x && !SKIP[x]; });
    var first = street.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (x) { return x && !SKIP[x]; })[0];
    if (words.length && (!first || !words.some(function (x) { return first.indexOf(x) === 0 || x.indexOf(first) === 0; }))) return null;
    var pnum = p.housenumber ? String(p.housenumber).split(/[;,]/)[0].trim() : '';
    var num = qnum ? (pnum && pnum.toLowerCase().indexOf(qnum.toLowerCase()) === 0 ? pnum : qnum) : pnum;
    var line1 = (num ? num + ' ' : '') + street;
    var st = US[p.state] || p.state || '';
    var city = p.city || p.town || p.village || p.district || p.county || '';
    var zip = /^\d{5}/.test(p.postcode || '') ? p.postcode.slice(0, 5) : '';
    var line2 = [city, [st, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (!line2) return null;
    return { line1: line1, line2: line2, full: line1 + ', ' + line2, zip: zip };
  }
  function acInit(input, onPick) {
    if (!input) return;
    var list = d.getElementById(input.getAttribute('aria-controls')), zipEl = input.form && input.form.querySelector('input[name="zip"]');
    var items = [], active = -1, timer = null, ctl = null, seq = 0;
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); active = -1; }
    function render() {
      list.textContent = '';
      if (!items.length) return close();
      items.forEach(function (it, i) {
        var li = d.createElement('li'); li.id = list.id + '-' + i; li.setAttribute('role', 'option'); li.setAttribute('aria-selected', i === active ? 'true' : 'false');
        li.textContent = it.line1; var s = d.createElement('small'); s.textContent = it.line2; li.appendChild(s);
        li.addEventListener('mousedown', function (e) { e.preventDefault(); });
        li.addEventListener('click', function () { pick(i); });
        list.appendChild(li);
      });
      var f = d.createElement('li'); f.className = 'ac-foot'; f.setAttribute('role', 'presentation'); f.textContent = 'Suggestions © OpenStreetMap contributors'; list.appendChild(f);
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      if (active > -1) { input.setAttribute('aria-activedescendant', list.id + '-' + active); var on = d.getElementById(list.id + '-' + active); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    }
    function pick(i) {
      var it = items[i]; if (!it) return;
      input.value = it.full;
      if (zipEl && it.zip) { zipEl.value = it.zip; try { zipEl.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
      items = []; close(); if (onPick) onPick();
      try { input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }
    function search(q) {
      if (ctl) try { ctl.abort(); } catch (e) {}
      ctl = w.AbortController ? new AbortController() : null;
      var my = ++seq;
      fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + BIAS + '&bbox=-179.9,18.9,-66.9,71.4&limit=15&lang=en', ctl ? { signal: ctl.signal } : {})
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (my !== seq || !j || !j.features) return;
          var seen = {}; items = [];
          j.features.forEach(function (f) {
            var p = f.properties || {};
            if (p.countrycode !== 'US') return;
            var it = acFormat(p, q); if (!it || seen[it.full]) return;
            seen[it.full] = 1; items.push(it);
          });
          items = items.slice(0, 5); active = -1;
          if (d.activeElement === input) render();
        })
        .catch(function () {});
    }
    input.addEventListener('input', function () {
      var q = input.value.trim(); clearTimeout(timer);
      if (q.length < 3) { seq++; items = []; return close(); }
      timer = setTimeout(function () { search(q); }, 250);
    });
    input.addEventListener('keydown', function (e) {
      if (list.hidden || !items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render(); }
      else if (e.key === 'Enter' && active > -1) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
  }


  // ---------- step 1: direct owner qualification + instant lead save ----------
  var busy = false, markBad = function () {};
  var f1 = $('f1'), sel = $('f-loss'), fname = $('f-name'), fphone = $('f-phone'), fzip = $('f-zip'), faddr = $('f-address'), go1 = $('go1'), sum = $('sum'), sumT = $('sum-t');
  var ownRadios = f1 ? Array.prototype.slice.call(f1.querySelectorAll('input[name="owner"]')) : [];
  function getOwner() { for (var i = 0; i < ownRadios.length; i++) if (ownRadios[i].checked) return ownRadios[i].value; return ''; }
  function syncOwnerPills() { ownRadios.forEach(function (r) { var lbl = r.closest('.own-pill'); if (lbl) lbl.classList.toggle('on', r.checked); }); }
  function fmtPhone(x) { return x.length > 6 ? '(' + x.slice(0, 3) + ') ' + x.slice(3, 6) + '-' + x.slice(6) : x.length > 3 ? '(' + x.slice(0, 3) + ') ' + x.slice(3) : x; }
  function pushPartial(extra) {
    var pDigits = fphone ? digitsOf(fphone.value) : '';
    if (pDigits.length !== 10 || /^[01]/.test(pDigits) || /^(\d)\1{9}$/.test(pDigits)) return;
    var curOwn = getOwner() || state.owner || '';
    var p = {
      pid: state.pid, form: 'form',
      owner: curOwn,
      name: fname ? fname.value.trim().replace(/\s+/g, ' ') : (state.name || ''),
      phone: fmtPhone(pDigits),
      zip: fzip ? String(fzip.value || '').replace(/\D/g, '').slice(0, 5) : (state.zip || ''),
      address: faddr && faddr.value ? faddr.value.trim() : (state.address || ''),
      loss_type: sel ? sel.value : (state.loss_type || ''),
      company: f1 && f1.company ? f1.company.value : '',
      page_variant: PVAR, landing_url: state.landing_url, referrer: state.referrer
    };
    if (extra) for (var ek in extra) p[ek] = extra[ek];
    for (var t in state.track) p[t] = state.track[t];
    fetch('/api/partial', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(p), keepalive: true }).catch(function () {});
  }
  if (f1) {
    if (state.loss_type && LOSS[state.loss_type]) sel.value = state.loss_type;
    else if (LOSS[qs.get('loss')]) sel.value = qs.get('loss');
    else if (/az|hail|120248791830950534/i.test((qs.get('utm_campaign') || '') + ' ' + (qs.get('hsa_cam') || ''))) sel.value = 'hail';
    if (state.owner && OWN[state.owner] && state.owner !== 'rent') {
      ownRadios.forEach(function (r) { r.checked = (r.value === state.owner); });
      syncOwnerPills();
    }
    if (state.name && !fname.value) fname.value = state.name;
    if (state.phone && !fphone.value) fphone.value = state.phone;
    if (state.zip && fzip && !fzip.value) fzip.value = state.zip;
    if (state.address && faddr && !faddr.value && !/^ZIP\s+\d{5}$/i.test(state.address)) faddr.value = state.address;
    var started = function () { if (!state.t0) { state.t0 = Date.now(); save(); dl('quiz_start'); } };
    f1.addEventListener('focusin', started);
    var pTimer = null;
    fphone.addEventListener('input', function () {
      var x = digitsOf(fphone.value).slice(0, 10);
      fphone.value = fmtPhone(x);
      clearTimeout(pTimer);
      if (x.length === 10) pTimer = setTimeout(function () { pushPartial(); }, 1200);
    });
    if (fzip) fzip.addEventListener('input', function () { fzip.value = String(fzip.value || '').replace(/\D/g, '').slice(0, 5); });
    var extractZipFromAddr = function (s) {
      var raw = String(s || '').trim();
      if (/^\d{5}(?:-\d{4})?$/.test(raw)) return '';
      var tail = raw.replace(/^\s*\d+[a-z]?\b/i, '');
      var m = tail.match(/\b(\d{5})\b/g);
      return m ? m[m.length - 1] : '';
    };
    var fieldEl = function (k) { return k === 'loss_type' ? sel : k === 'owner' ? ownRadios[0] : k === 'address' ? faddr : k === 'zip' ? fzip : f1[k]; };
    var bad = function (k, on) {
      var f = f1.querySelector('.fld[data-f="' + k + '"]');
      if (f) f.classList.toggle('bad', !!on);
      if (k === 'owner') ownRadios.forEach(function (r) { r.setAttribute('aria-invalid', on ? 'true' : 'false'); });
      else { var el = fieldEl(k); if (el) el.setAttribute('aria-invalid', on ? 'true' : 'false'); }
    };
    var okOf = function (k) {
      if (k === 'owner') return !!OWN[getOwner()];
      var el = fieldEl(k);
      var v = (el ? el.value : '').trim();
      if (k === 'loss_type') return !!LOSS[v];
      if (k === 'address') return v.length >= 4 && /[a-z]/i.test(v) && !/^ZIP\s+\d{5}$/i.test(v);
      if (k === 'name') return v.length >= 2 && /[a-z]/i.test(v);
      if (k === 'phone') { var p = digitsOf(v); return p.length === 10 && !/^[01]/.test(p) && !/^(\d)\1{9}$/.test(p); }
      if (k === 'zip') return /^\d{5}$/.test(v);
      return v.length >= 2 && /[a-z0-9]/i.test(v);
    };
    var refreshSum = function () {
      var n = f1.querySelectorAll('.fld.bad').length;
      sum.hidden = !n; sumT.textContent = n === 1 ? 'Almost there. Please fix the highlighted item.' : 'Almost there. Please fix the ' + n + ' highlighted items.';
    };
    ['address', 'zip', 'name', 'phone'].forEach(function (k) {
      var el = fieldEl(k); if (!el) return;
      el.addEventListener('input', function () { bad(k, false); if (!sum.hidden) refreshSum(); });
      el.addEventListener('blur', function () {
        var check = function () {
          if (k === 'address' && faddr && fzip && !/^\d{5}$/.test(fzip.value)) {
            var ez = extractZipFromAddr(faddr.value);
            if (ez) { fzip.value = ez; bad('zip', false); }
          }
          if (el.value) { bad(k, !okOf(k)); if (!sum.hidden) refreshSum(); }
          if (k === 'phone' || k === 'address') pushPartial();
        };
        if (k === 'address') setTimeout(check, 180); else check();
      });
    });
    sel.addEventListener('change', function () { started(); bad('loss_type', false); if (!sum.hidden) refreshSum(); });
    ownRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        started(); syncOwnerPills(); bad('owner', false); if (!sum.hidden) refreshSum();
        var v = getOwner(); state.owner = v; save();
        if (v === 'rent') {
          clearTimeout(pTimer);
          dl('quiz_answer', { step: 2, answer: 'rent' });
          var pDigits = fphone ? digitsOf(fphone.value) : '';
          if (pDigits.length === 10) fetch('/api/partial', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ pid: state.pid, form: 'form', owner: 'rent', phone: fmtPhone(pDigits) }), keepalive: true }).catch(function () {});
          setTimeout(function () { show('2b', true); }, 140);
        }
      });
    });
    f1.addEventListener('submit', function (e) {
      e.preventDefault(); if (busy) return; started();
      if (faddr && fzip && !/^\d{5}$/.test(fzip.value)) {
        var ez = extractZipFromAddr(faddr.value);
        if (ez) fzip.value = ez;
      }
      var keys = ['loss_type', 'owner', 'address', 'zip', 'name', 'phone'], first = null;
      keys.forEach(function (k) { var ok = okOf(k); bad(k, !ok); if (!ok && !first) first = k; });
      refreshSum();
      if (first) { var fel = fieldEl(first); if (fel) fel.focus(); return; }
      state.loss_type = sel.value; state.owner = getOwner();
      state.address = faddr.value.trim().replace(/\s+/g, ' ');
      state.zip = fzip.value.trim();
      state.name = fname.value.trim().replace(/\s+/g, ' ');
      state.phone = fphone.value;
      state.step1 = true; save();
      dl('quiz_answer', { step: 1, answer: state.loss_type });
      dl('quiz_answer', { step: 2, answer: state.owner });
      clearTimeout(pTimer);
      if (state.owner === 'rent') {
        fetch('/api/partial', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ pid: state.pid, form: 'form', owner: 'rent', phone: state.phone }), keepalive: true }).catch(function () {});
        return show('2b', true);
      }
      if (state.lead_id && state.lead_phone === digitsOf(state.phone)) return show('3', true);
      saveLead(go1);
    });
    markBad = function (errs) { Object.keys(errs).forEach(function (k) { bad(k, true); }); refreshSum(); };
  }
  if (faddr) acInit(faddr, function () { if (faddr.value) { state.address = faddr.value.trim(); save(); } });

  // ---------- step 2 of 3 (s3): claim_status ----------
  d.addEventListener('click', function (e) {
    var o = e.target.closest('.opt'); if (!o || busy) return;
    var k = o.dataset.k, v = o.dataset.v;
    state[k] = v; save(); marks();
    if (k === 'claim_status') {
      dl('quiz_answer', { step: 3, answer: v });
      if (state.lead_id) fetch('/api/lead/' + encodeURIComponent(state.lead_id) + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim_status: v, address: state.address || '' }), keepalive: true }).catch(function () {});
      setTimeout(function () { show('4', true); }, 160);
    }
  });
  function saveLead(btn) {
    busy = true; if (sum) sum.hidden = true; if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); }
    var payload = {
      source: 'form', loss_type: state.loss_type, owner: state.owner, name: state.name, phone: state.phone,
      address: state.address, zip: state.zip,
      company: f1 ? f1.company.value : '', elapsed_ms: state.t0 ? Date.now() - state.t0 : null, page_variant: PVAR, landing_url: state.landing_url, referrer: state.referrer
    };
    for (var t in state.track) payload[t] = state.track[t];
    payload.fbp = ck('_fbp'); payload.fbc = ck('_fbc');
    post('/api/lead', payload).then(function (j) {
      if (j.ok) {
        state.lead_id = j.id; state.first_name = j.first_name || ''; state.lead_phone = digitsOf(state.phone);
        var e164 = state.lead_phone.length === 10 ? '+1' + state.lead_phone : '';
        state.done_phone = e164;
        try {
          var qMirror = JSON.parse(sessionStorage.getItem('bs_quiz_v1') || '{}');
          qMirror.done_phone = e164; qMirror.name = state.name || ''; qMirror.zip = state.zip || ''; qMirror.address = state.address || '';
          sessionStorage.setItem('bs_quiz_v1', JSON.stringify(qMirror));
        } catch (err) {}
        state.fired = state.fired || {};
        if (!state.fired[j.id]) {
          state.fired[j.id] = 1; save();
          var nParts = String(state.name || '').trim().split(/\s+/);
          dl('generate_lead', {
            lead_id: j.id,
            transaction_id: j.id,
            loss_type: state.loss_type,
            claim_status: '',
            form: 'form',
            phone_e164: e164,
            user_data: {
              phone_number: e164,
              address: {
                first_name: nParts[0] || '',
                last_name: nParts.slice(1).join(' ') || '',
                street: state.address || '',
                postal_code: state.zip || '',
                country: 'US'
              }
            }
          });
        }
        save(); show('3', true);
      } else if (j.errors && (j.errors.loss_type || j.errors.owner || j.errors.name || j.errors.phone || j.errors.zip || j.errors.address)) {
        show('1', false); markBad(j.errors);
      } else { throw new Error(j.error || 'save'); }
    }).catch(function (e) {
      pushPartial();
      if (sum && sumT) {
        sumT.textContent = (e && e.message && e.message !== 'save' && e.message.indexOf('fetch') === -1 ? e.message : 'We couldn’t save that.') + (e && /call/.test(e.message || '') ? '' : ' ' + CALL);
        sum.hidden = false;
      }
    }).finally(function () { busy = false; if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); } });
  }
  var ob = $('own-back');
  if (ob) ob.addEventListener('click', function () {
    state.owner = ''; save();
    ownRadios.forEach(function (r) { r.checked = false; });
    syncOwnerPills();
    show('1', true);
  });

  // ---------- step 4: optional uploads, browser straight to the bucket ----------
  var MAXF = 10, MAXT = 250 * 1024 * 1024, picked = [];
  var fin = $('f-files'), list = $('files'), uperr = $('uperr'), send4 = $('send4');
  function mb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function upErr(t) { uperr.textContent = t || ''; uperr.hidden = !t; }
  function drawFiles() {
    list.textContent = '';
    picked.forEach(function (f, i) {
      var li = d.createElement('li'); li.className = f.st === 'done' ? '' : f.st === 'bad' ? 'bad' : 'up';
      var isImg = /^image\//.test(f.file.type);
      li.innerHTML = '<span class="l"><svg class="ic"><use href="#' + (isImg ? 'i-img' : 'i-doc') + '"/></svg><span class="n"></span><span class="s"></span></span><span class="r"></span>';
      li.querySelector('.n').textContent = f.file.name; li.querySelector('.s').textContent = mb(f.file.size);
      var r = li.querySelector('.r');
      if (f.st === 'done') r.innerHTML = '<svg class="ic" aria-label="Uploaded"><use href="#i-check"/></svg>';
      else if (f.st === 'bad') r.textContent = 'Failed';
      else r.textContent = (f.pct || 0) + '%';
      if (f.st !== 'up') { var x = d.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + f.file.name); x.addEventListener('click', function () { picked.splice(i, 1); drawFiles(); }); r.appendChild(x); }
      list.appendChild(li);
    });
    var done = picked.filter(function (f) { return f.st === 'done'; }).length, up = picked.some(function (f) { return f.st === 'up'; });
    send4.disabled = !done || up;
  }
  function upload(f, u) {
    return new Promise(function (res) {
      var fd = new FormData(); for (var k in u.fields) fd.append(k, u.fields[k]); fd.append('file', f.file);
      var x = new XMLHttpRequest(); x.open('POST', u.url);
      x.upload.onprogress = function (e) { if (e.lengthComputable) { f.pct = Math.round(e.loaded / e.total * 100); drawFiles(); } };
      x.onload = function () { f.st = x.status >= 200 && x.status < 300 ? 'done' : 'bad'; f.key = u.key; drawFiles(); res(); };
      x.onerror = function () { f.st = 'bad'; drawFiles(); res(); };
      x.send(fd);
    });
  }
  if (fin) fin.addEventListener('change', function () {
    var add = Array.prototype.slice.call(fin.files || []); fin.value = ''; upErr('');
    if (!add.length || !state.lead_id) return;
    var keep = picked.filter(function (f) { return f.st !== 'bad'; });
    if (keep.length + add.length > MAXF) return upErr('Up to ' + MAXF + ' files. Share the rest on the call.');
    var total = keep.concat(add.map(function (x) { return { file: x }; })).reduce(function (a, f) { return a + f.file.size; }, 0);
    if (total > MAXT) return upErr('That’s over 250 MB in total. Remove a file or share the rest on the call.');
    var batch = add.map(function (x) { return { file: x, st: 'up', pct: 0 }; });
    picked = keep.concat(batch); drawFiles();
    post('/api/lead/' + encodeURIComponent(state.lead_id) + '/uploads', { files: batch.map(function (f) { return { name: f.file.name, size: f.file.size, type: f.file.type }; }) })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || 'We couldn’t start the upload.');
        return Promise.all(batch.map(function (f, i) { return upload(f, j.uploads[i]); }));
      })
      .catch(function (e) { batch.forEach(function (f) { f.st = 'bad'; }); drawFiles(); upErr((e && e.message) || 'We couldn’t upload that. You can share it on the call.'); });
  });
  function toThanks() { state.thanks = true; save(); location.assign('/thank-you'); }
  if (send4) send4.addEventListener('click', function () {
    var keys = picked.filter(function (f) { return f.st === 'done'; }).map(function (f) { return f.key; });
    send4.disabled = true; send4.firstChild.textContent = 'Sending';
    post('/api/lead/' + encodeURIComponent(state.lead_id) + '/uploads/done', { keys: keys })
      .then(function (j) { dl('files_uploaded', { file_count: j.saved || 0 }); })
      .catch(function () {})
      .finally(toThanks);
  });
  var sk = $('skip4'); if (sk) sk.addEventListener('click', toThanks);

  // ---------- step 5: thank you + weekday calendar (Pacific time) ----------
  var TIMES = ['9:00 AM', '10:00 AM', '11:00 AM', '1:00 PM', '2:00 PM', '3:00 PM', '4:00 PM'];
  var MINS = [540, 600, 660, 780, 840, 900, 960];
  var MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function ptNow() {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(w.__bsNow ? new Date(w.__bsNow) : new Date());
    var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
    return { y: +o.year, m: +o.month - 1, d: +o.day, min: (+o.hour % 24) * 60 + (+o.minute) };
  }
  var now, cal = {};
  function dayTimes(y, m, dd) {
    var wd = new Date(Date.UTC(y, m, dd)).getUTCDay();
    if (wd === 0 || wd === 6) return [];
    var key = y * 10000 + m * 100 + dd, today = now.y * 10000 + now.m * 100 + now.d;
    if (key < today) return [];
    if (key > today + 0 && new Date(Date.UTC(y, m, dd)) - new Date(Date.UTC(now.y, now.m, now.d)) > 62 * 864e5) return [];
    return TIMES.filter(function (t, i) { return key > today || MINS[i] - now.min >= 60; });
  }
  function short(y, m, dd) { return WD[new Date(Date.UTC(y, m, dd)).getUTCDay()].slice(0, 3) + ', ' + MON[m].slice(0, 3) + ' ' + dd; }
  function renderCal() {
    var y = cal.y, m = cal.m, g = $('grid'); g.textContent = '';
    $('month').textContent = MON[m] + ' ' + y;
    'SMTWTFS'.split('').forEach(function (c) { var s = d.createElement('span'); s.className = 'wd'; s.textContent = c; s.setAttribute('aria-hidden', 'true'); g.appendChild(s); });
    var startWd = new Date(Date.UTC(y, m, 1)).getUTCDay(), last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    for (var i = 0; i < startWd; i++) g.appendChild(d.createElement('span'));
    for (var dd = 1; dd <= last; dd++) (function (dd) {
      var b = d.createElement('button'); b.type = 'button'; b.textContent = dd;
      var ok = dayTimes(y, m, dd).length > 0;
      b.disabled = !ok; b.setAttribute('aria-label', WD[new Date(Date.UTC(y, m, dd)).getUTCDay()] + ' ' + MON[m] + ' ' + dd + (ok ? '' : ', closed'));
      b.setAttribute('aria-pressed', cal.sel && cal.sel.y === y && cal.sel.m === m && cal.sel.d === dd ? 'true' : 'false');
      b.addEventListener('click', function () { cal.sel = { y: y, m: m, d: dd }; cal.time = ''; renderCal(); });
      g.appendChild(b);
    })(dd);
    $('mprev').disabled = y < cal.minY || (y === cal.minY && m <= cal.minM);
    var lim = new Date(Date.UTC(now.y, now.m, now.d) + 62 * 864e5); $('mnext').disabled = y > lim.getUTCFullYear() || (y === lim.getUTCFullYear() && m >= lim.getUTCMonth());
    var sl = $('slots'), dn = $('dayname'); sl.textContent = '';
    if (!cal.sel) { dn.textContent = ''; }
    else {
      var s = cal.sel; dn.textContent = WD[new Date(Date.UTC(s.y, s.m, s.d)).getUTCDay()] + ', ' + MON[s.m] + ' ' + s.d;
      dayTimes(s.y, s.m, s.d).forEach(function (t) {
        var b = d.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', cal.time === t ? 'true' : 'false');
        b.addEventListener('click', function () { cal.time = t; renderCal(); });
        sl.appendChild(b);
      });
    }
    var c = $('confirm');
    c.disabled = !(cal.sel && cal.time);
    c.firstChild.textContent = cal.sel && cal.time ? 'Confirm ' + short(cal.sel.y, cal.sel.m, cal.sel.d) + ' at ' + cal.time : 'Pick a time';
  }
  function firstOpen() {
    for (var i = 0; i < 70; i++) { var dt = new Date(Date.UTC(now.y, now.m, now.d) + i * 864e5); if (dayTimes(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()).length) return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() }; }
    return null;
  }
  function thanks() {
    $('fname').textContent = state.first_name ? ', ' + state.first_name : '';
    if (!state.lead_id) { $('picker').hidden = true; return; }
    now = ptNow(); cal.sel = firstOpen(); cal.y = cal.sel ? cal.sel.y : now.y; cal.m = cal.sel ? cal.sel.m : now.m; cal.minY = cal.y; cal.minM = cal.m; cal.time = '';
    $('mprev').addEventListener('click', function () { cal.m--; if (cal.m < 0) { cal.m = 11; cal.y--; } renderCal(); });
    $('mnext').addEventListener('click', function () { cal.m++; if (cal.m > 11) { cal.m = 0; cal.y++; } renderCal(); });
    renderCal();
    var bk = $('booked');
    if (state.slot_saved) { bk.textContent = 'Requested: ' + state.slot_saved + '. We’ll confirm by phone.'; bk.hidden = false; }
    $('confirm').addEventListener('click', function () {
      var c = this, s = cal.sel, t = cal.time; if (!s || !t) return;
      var label = short(s.y, s.m, s.d).replace(',', '') + ', ' + t + ' PT'; // same format as Page A: "Tue Nov 3, 10:00 AM PT"
      c.disabled = true; c.firstChild.textContent = 'Saving';
      post('/api/lead/' + encodeURIComponent(state.lead_id) + '/callback', { slots: [label] }).then(function (j) {
        if (!j.ok) throw new Error('save');
        state.slot_saved = short(s.y, s.m, s.d) + ' at ' + t + ' Pacific'; save();
        dl('callback_booked', { slot: label, slot_count: 1 });
        bk.className = 'booked'; bk.textContent = 'Requested: ' + state.slot_saved + '. We’ll confirm by phone.'; bk.hidden = false;
        renderCal();
      }).catch(function () { bk.className = 'booked bad'; bk.textContent = 'We couldn’t save that. ' + CALL; bk.hidden = false; renderCal(); });
    });
  }

  // ---------- start ----------
  if (TY) { show('5', false); thanks(); return; }
  var initial = hashStep();
  history.replaceState({ step: initial }, '', location.href);
  if (initial !== '1') show(initial, false);
})();
