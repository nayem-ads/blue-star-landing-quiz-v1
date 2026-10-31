// Page B (V5 multi-step). Step 1 saves an unfinished form only. The lead saves at the ownership answer (step 2).
(function () {
  'use strict';
  var d = document, w = window, body = d.body;
  var KEY = 'bs_b_v1';
  var TRACK = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid'];
  var LOSS = { fire: 1, smoke: 1, water: 1, storm: 1, denied: 1, other: 1 };
  var CALL = 'Please try again or call toll free (888) 971-2524.';
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function $(id) { return d.getElementById(id); }

  // Same events as Page A, tagged page_variant b. Lead fires once, after the server saves the lead (eventID = lead id).
  function dl(ev, extra) {
    extra = extra || {};
    w.dataLayer = w.dataLayer || []; var o = { event: ev, page_variant: 'b' }; for (var k in extra) o[k] = extra[k]; w.dataLayer.push(o);
    if (typeof w.fbq !== 'function') return;
    if (ev === 'generate_lead') w.fbq('track', 'Lead', { content_name: extra.loss_type, content_category: extra.claim_status, form: 'form' }, { eventID: extra.lead_id });
    else if (ev === 'call_click') w.fbq('track', 'Contact', { content_name: extra.location });
    else if (ev === 'callback_booked') w.fbq('track', 'Schedule', { content_name: extra.slot });
    else if (ev === 'quiz_start') w.fbq('trackCustom', 'QuizStart');
    else if (ev === 'quiz_answer') w.fbq('trackCustom', 'QuizAnswer', { step: extra.step, answer: extra.answer });
  }
  function ck(n) { try { var m = d.cookie.match(new RegExp('(?:^|; )' + n + '=([^;]*)')); return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; } }
  function digitsOf(v) { var x = String(v || '').replace(/\D/g, ''); if (x.length === 11 && x[0] === '1') x = x.slice(1); return x; }
  function post(url, data) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); }); }

  var state = load();
  var TY = body.dataset.ty === 'ty';
  var qs = new URLSearchParams(location.search);
  state.track = state.track || {};
  TRACK.forEach(function (k) { if (qs.get(k)) state.track[k] = qs.get(k); });
  if (!state.landing_url) { state.landing_url = location.href.split('#')[0]; state.referrer = d.referrer || ''; }
  if (!state.pid) state.pid = (w.crypto && w.crypto.randomUUID) ? w.crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  save();

  d.addEventListener('click', function (e) { var c = e.target.closest('[data-call]'); if (c) dl('call_click', { location: c.dataset.call }); });

  // ---------- screens ----------
  var ORDER = { '1': 1, '2': 2, '2b': 2, '3': 3, '4': 4, '5': 5 };
  function show(step, push) {
    if (TY) step = '5';
    else {
      if (step !== '1' && !state.step1) step = '1';
      if ((step === '3' || step === '4') && !state.lead_id) step = '2';
      if (step === '5') step = state.lead_id ? '4' : '1';
    }
    var all = d.querySelectorAll('[data-step]');
    for (var i = 0; i < all.length; i++) all[i].classList.toggle('on', all[i].dataset.step === step);
    if (push) history.pushState({ step: step }, '', step === '1' ? location.pathname + location.search : '#step-' + step);
    w.scrollTo(0, 0);
    if (step === '2' || step === '3') marks();
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
  var SKIP = {}; 'n s e w north south east west old'.split(' ').forEach(function (x) { SKIP[x] = 1; });
  function acFormat(p, q) {
    var street = p.street || (p.type === 'street' ? p.name : '');
    if (!street) return null;
    if (p.type === 'house' && !p.housenumber) return null; // a building with no number is not an address
    // Only keep results that match what they typed: the street's first name word and the house number.
    var words = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    var first = street.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(function (x) { return x && !SKIP[x]; })[0];
    if (!first || !words.some(function (x) { return !/^\d+$/.test(x) && first.indexOf(x) === 0; })) return null;
    var qm = /^\s*(\d+[a-z]?)\b/i.exec(q), qnum = qm ? qm[1] : '';
    if (qnum && p.housenumber && String(p.housenumber).toLowerCase().indexOf(qnum.toLowerCase()) !== 0) return null;
    var num = p.housenumber || qnum; // street known but this house is not in the map yet: keep the number they typed
    var line1 = (num ? num + ' ' : '') + street;
    var st = US[p.state] || p.state || '';
    var line2 = [p.city || p.town || p.village || p.district || p.county, [st, p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return { line1: line1, line2: line2, full: line1 + (line2 ? ', ' + line2 : ''), zip: /^\d{5}/.test(p.postcode || '') ? p.postcode.slice(0, 5) : '' };
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
      input.value = it.full; if (zipEl) zipEl.value = it.zip;
      items = []; close(); if (onPick) onPick();
      try { input.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }
    function search(q) {
      if (ctl) try { ctl.abort(); } catch (e) {}
      ctl = w.AbortController ? new AbortController() : null;
      var my = ++seq;
      fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=10&lang=en&lat=38.58&lon=-121.49', ctl ? { signal: ctl.signal } : {})
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (my !== seq || !j || !j.features) return;
          var seen = {}; items = [];
          j.features.forEach(function (f) {
            var p = f.properties || {};
            if (p.countrycode !== 'US' || (p.type !== 'house' && p.type !== 'street')) return;
            var it = acFormat(p, q); if (!it || seen[it.full]) return;
            seen[it.full] = 1; it.ca = p.state === 'California' ? 0 : 1; items.push(it);
          });
          items = items.map(function (it, i) { it.i = i; return it; }).sort(function (x, y) { return x.ca - y.ca || x.i - y.i; }).slice(0, 5); active = -1; // California first
          if (d.activeElement === input) render();
        })
        .catch(function () {});
    }
    input.addEventListener('input', function () {
      if (zipEl) zipEl.value = '';
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


  // ---------- step 1 ----------
  var markBad = function () {};
  var f1 = $('f1'), sel = $('f-loss'), fname = $('f-name'), fphone = $('f-phone'), faddr = $('f-address');
  function fmtPhone(x) { return x.length > 6 ? '(' + x.slice(0, 3) + ') ' + x.slice(3, 6) + '-' + x.slice(6) : x.length > 3 ? '(' + x.slice(0, 3) + ') ' + x.slice(3) : x; }
  if (f1) {
    if (state.loss_type) sel.value = state.loss_type;
    else if (LOSS[qs.get('loss')]) sel.value = qs.get('loss'); // ?loss= from the ad pre-selects what happened
    ['name', 'phone', 'address'].forEach(function (k) { if (state[k] && !f1[k].value) f1[k].value = state[k]; });
    if (state.zip) f1.zip.value = state.zip;
    var started = function () { if (!state.t0) { state.t0 = Date.now(); save(); dl('quiz_start'); } };
    f1.addEventListener('focusin', started);
    fphone.addEventListener('input', function () { var x = digitsOf(fphone.value).slice(0, 10); fphone.value = fmtPhone(x); });
    var bad = function (k, on) { var f = f1.querySelector('.fld[data-f="' + k + '"]'); if (f) f.classList.toggle('bad', !!on); (k === 'loss_type' ? sel : f1[k]).setAttribute('aria-invalid', on ? 'true' : 'false'); };
    var okOf = function (k) {
      var v = (k === 'loss_type' ? sel.value : f1[k].value || '').trim();
      if (k === 'loss_type') return !!LOSS[v];
      if (k === 'name') return v.length >= 2 && /[a-z]/i.test(v);
      if (k === 'phone') { var p = digitsOf(v); return p.length === 10 && !/^[01]/.test(p) && !/^(\d)\1{9}$/.test(p); }
      return v.length >= 6 && /[a-z]/i.test(v) && /\d/.test(v);
    };
    var sum = $('sum'), sumT = $('sum-t');
    var refreshSum = function () {
      var n = f1.querySelectorAll('.fld.bad').length;
      sum.hidden = !n; sumT.textContent = n === 1 ? 'Almost there. Please fix the highlighted item.' : 'Almost there. Please fix the ' + n + ' highlighted items.';
    };
    ['name', 'phone', 'address'].forEach(function (k) {
      f1[k].addEventListener('input', function () { bad(k, false); if (!sum.hidden) refreshSum(); });
      f1[k].addEventListener('blur', function () { if (f1[k].value) { bad(k, !okOf(k)); if (!sum.hidden) refreshSum(); } });
    });
    sel.addEventListener('change', function () { started(); bad('loss_type', false); if (!sum.hidden) refreshSum(); });
    f1.addEventListener('submit', function (e) {
      e.preventDefault(); started();
      var keys = ['loss_type', 'name', 'phone', 'address'], first = null;
      keys.forEach(function (k) { var ok = okOf(k); bad(k, !ok); if (!ok && !first) first = k; });
      refreshSum();
      if (first) { (first === 'loss_type' ? sel : f1[first]).focus(); return; }
      state.loss_type = sel.value; state.name = fname.value.trim().replace(/\s+/g, ' '); state.phone = fphone.value; state.address = faddr.value.trim(); state.zip = f1.zip.value;
      state.step1 = true; save();
      dl('quiz_answer', { step: 1, answer: state.loss_type });
      // Unfinished form only. The team is alerted if they stop here; it closes when the lead saves or they say they rent.
      var p = { pid: state.pid, form: 'form', name: state.name, phone: state.phone, address: state.address, zip: state.zip, loss_type: state.loss_type, company: f1.company.value, page_variant: 'b', landing_url: state.landing_url, referrer: state.referrer };
      for (var t in state.track) p[t] = state.track[t];
      fetch('/api/partial', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(p), keepalive: true }).catch(function () {});
      show('2', true);
    });
    markBad = function (errs) { Object.keys(errs).forEach(function (k) { bad(k, true); }); refreshSum(); };
    acInit(faddr, function () { bad('address', !okOf('address')); });
  }

  // ---------- step 2: ownership. Owner = save the lead. Renter = exit, no lead, no alert ----------
  var busy = false, err2 = $('err2');
  d.addEventListener('click', function (e) {
    var o = e.target.closest('.opt'); if (!o || busy) return;
    var k = o.dataset.k, v = o.dataset.v;
    state[k] = v; save(); marks();
    if (k === 'owner') {
      dl('quiz_answer', { step: 2, answer: v });
      if (v === 'rent') {
        fetch('/api/partial', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ pid: state.pid, form: 'form', owner: 'rent', phone: state.phone }), keepalive: true }).catch(function () {});
        return setTimeout(function () { show('2b', true); }, 160);
      }
      if (state.lead_id && state.lead_phone === digitsOf(state.phone)) return setTimeout(function () { show('3', true); }, 160); // already saved, no second Lead
      saveLead(o);
    } else if (k === 'claim_status') {
      dl('quiz_answer', { step: 3, answer: v });
      if (state.lead_id) fetch('/api/lead/' + encodeURIComponent(state.lead_id) + '/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ claim_status: v }), keepalive: true }).catch(function () {});
      setTimeout(function () { show('4', true); }, 160);
    }
  });
  function saveLead(btn) {
    busy = true; err2.hidden = true; btn.setAttribute('aria-busy', 'true');
    var payload = {
      source: 'form', loss_type: state.loss_type, owner: state.owner, name: state.name, phone: state.phone, address: state.address, zip: state.zip,
      company: f1 ? f1.company.value : '', elapsed_ms: state.t0 ? Date.now() - state.t0 : null, page_variant: 'b', landing_url: state.landing_url, referrer: state.referrer
    };
    for (var t in state.track) payload[t] = state.track[t];
    payload.fbp = ck('_fbp'); payload.fbc = ck('_fbc');
    post('/api/lead', payload).then(function (j) {
      if (j.ok) {
        state.lead_id = j.id; state.first_name = j.first_name || ''; state.lead_phone = digitsOf(state.phone);
        state.fired = state.fired || {};
        if (!state.fired[j.id]) { state.fired[j.id] = 1; save(); dl('generate_lead', { lead_id: j.id, loss_type: state.loss_type, claim_status: '', form: 'form' }); }
        save(); show('3', true);
      } else if (j.errors && (j.errors.loss_type || j.errors.name || j.errors.phone || j.errors.address)) {
        show('1', true); markBad(j.errors);
      } else { throw new Error(j.error || 'save'); }
    }).catch(function (e) {
      err2.textContent = (e && e.message && e.message !== 'save' && e.message.indexOf('fetch') === -1 ? e.message : 'We couldn’t save that.') + (e && /call/.test(e.message || '') ? '' : ' ' + CALL);
      err2.hidden = false;
    }).finally(function () { busy = false; btn.removeAttribute('aria-busy'); });
  }
  var ob = $('own-back');
  if (ob) ob.addEventListener('click', function () { state.owner = ''; save(); show('2', true); });

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
