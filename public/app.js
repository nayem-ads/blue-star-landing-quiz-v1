(function () {
  'use strict';
  var d = document, w = window, body = d.body;
  var KEY = 'bs_quiz_v1';
  var LABEL = {
    loss_type: { fire: 'Fire', smoke: 'Smoke damage', water: 'Water or a leak', denied: 'Claim denied', other: 'Something else' },
    claim_status: { not_filed: 'Not filed yet', waiting: 'Still waiting', low_offer: 'Offer looks low', denied: 'Denied' },
    loss_timing: { month: 'Last month', m1_6: '1 to 6 months ago', m6_12: '6 to 12 months ago', over_year: 'Over a year ago' }
  };
  var TRACK = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'gbraid', 'wbraid', 'fbclid'];

  function load() { try { return JSON.parse(sessionStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function dl(ev, extra) { w.dataLayer = w.dataLayer || []; var o = { event: ev, page_variant: body.dataset.variant }; for (var k in extra) o[k] = extra[k]; w.dataLayer.push(o);
    // Meta Pixel mirrors of the same actions. Lead fires only after the server saves the lead (eventID = lead id, for dedupe).
    if (typeof w.fbq !== 'function') return;
    extra = extra || {};
    if (ev === 'generate_lead') w.fbq('track', 'Lead', { content_name: extra.loss_type, content_category: extra.claim_status, form: extra.form || 'quiz' }, { eventID: extra.lead_id });
    else if (ev === 'call_click') w.fbq('track', 'Contact', { content_name: extra.location });
    else if (ev === 'callback_booked') w.fbq('track', 'Schedule', { content_name: extra.slot });
    else if (ev === 'quiz_start') w.fbq('trackCustom', 'QuizStart');
    else if (ev === 'quiz_answer') w.fbq('trackCustom', 'QuizAnswer', { step: extra.step, answer: extra.answer });
    else if (ev === 'cta_click') w.fbq('trackCustom', 'CTAClick', { location: extra.location });
  }

  var state = load();
  var TY = /^\/thank-you\/?$/.test(location.pathname);
  // Keep first touch attribution for the session.
  var qs = new URLSearchParams(location.search);
  state.track = state.track || {};
  TRACK.forEach(function (k) { if (qs.get(k)) state.track[k] = qs.get(k); });
  if (!state.landing_url) { state.landing_url = location.href.split('#')[0]; state.referrer = d.referrer || ''; }
  save();

  var current = 1;
  function show(step, push) {
    step = Math.max(1, Math.min(5, step));
    // Never land on a later step without the answers it needs.
    if (TY) step = 5; // the thank you page always shows the thank you screen, whatever was answered
    else {
      if (step >= 2 && !state.loss_type) step = 1;
      if (step >= 3 && !state.claim_status) step = 2;
      if (step >= 4 && !state.loss_timing) step = 3;
      if (step === 5 && !state.lead_id) step = 4;
    }
    current = step;
    body.classList.toggle('funnel', step > 1);
    var screens = d.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.toggle('on', +screens[i].dataset.step === step);
    if (push) history.pushState({ step: step }, '', step > 1 ? '#step-' + step : location.pathname + location.search);
    w.scrollTo(0, 0);
    if (step > 1) {
      markSelected();
      if (step === 4) { renderAnswers(); prefill(); }
      if (step === 5) renderSlots();
      var h = d.querySelector('.screen.on h2');
      if (h) setTimeout(function () { h.focus({ preventScroll: true }); }, 60);
    }
  }

  function markSelected() {
    var opts = d.querySelectorAll('.opt');
    for (var i = 0; i < opts.length; i++) opts[i].setAttribute('aria-pressed', state[opts[i].dataset.k] === opts[i].dataset.v ? 'true' : 'false');
  }

  function start() { if (!state.t0) { state.t0 = Date.now(); dl('quiz_start'); } }

  // Step 1: loss type tiles (hero, final section, "Something else")
  d.addEventListener('click', function (e) {
    var t = e.target.closest('[data-loss]');
    if (t) {
      start();
      state.loss_type = t.dataset.loss; save();
      var all = d.querySelectorAll('.tile');
      for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', all[i].dataset.loss === state.loss_type ? 'true' : 'false');
      dl('quiz_answer', { step: 1, answer: state.loss_type });
      setTimeout(function () { show(2, true); }, 160);
      return;
    }
    var o = e.target.closest('.opt');
    if (o) {
      state[o.dataset.k] = o.dataset.v; save(); markSelected();
      dl('quiz_answer', { step: current, answer: o.dataset.v });
      setTimeout(function () { show(current + 1, true); }, 160);
      return;
    }
    var c = e.target.closest('[data-call]');
    if (c) dl('call_click', { location: c.dataset.call });
  });

  d.getElementById('back').addEventListener('click', function () { if (TY) location.href = '/'; else history.back(); });
  w.addEventListener('popstate', function (e) { if (TY) return; show((e.state && e.state.step) || stepFromHash(), false); });
  function stepFromHash() { var m = /#step-(\d)/.exec(location.hash); return m ? +m[1] : 1; }

  // Sticky bar: appears once the quiz card scrolls out of view.
  var sticky = d.getElementById('sticky'), quiz = d.getElementById('quiz');
  if ('IntersectionObserver' in w && quiz) {
    new IntersectionObserver(function (en) { sticky.classList.toggle('show', !en[0].isIntersecting && en[0].boundingClientRect.top < 0); }).observe(quiz);
  }
  function goQuiz() {
    w.scrollTo({ top: 0, behavior: 'smooth' });
    var first = quiz.querySelector('.tile'); if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 400);
  }
  d.getElementById('sticky-start').addEventListener('click', function () { dl('cta_click', { location: 'sticky' }); goQuiz(); });
  var starts = d.querySelectorAll('.js-start');
  for (var si = 0; si < starts.length; si++) starts[si].addEventListener('click', function (e) { dl('cta_click', { location: e.currentTarget.dataset.cta || 'page' }); goQuiz(); });

  // Progress bar fills on load.
  var bar1 = d.getElementById('bar1');
  if (bar1) setTimeout(function () { bar1.style.width = '25%'; }, 350);

  // Results bars grow when they scroll into view.
  var barSets = d.querySelectorAll('.bars');
  if ('IntersectionObserver' in w) {
    var bo = new IntersectionObserver(function (en) { en.forEach(function (x) { if (x.isIntersecting) { x.target.classList.add('in'); bo.unobserve(x.target); } }); }, { threshold: 0.4 });
    for (var bi = 0; bi < barSets.length; bi++) bo.observe(barSets[bi]);
  } else { for (var bj = 0; bj < barSets.length; bj++) barSets[bj].classList.add('in'); }

  // Logo slider: swipe on mobile, dots, gentle auto-advance every 3s. Static row on desktop.
  var sliders = d.querySelectorAll('[data-slider]');
  var still = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  Array.prototype.forEach.call(sliders, function (sl) {
    var tr = sl.querySelector('.ltrack'), dots = sl.querySelector('.ldots'), cards = tr.children;
    function pages() { var vis = Math.max(1, Math.round(tr.clientWidth / (cards[0].offsetWidth || 1))); return Math.max(1, cards.length - vis + 1); }
    function draw() {
      var n = pages(); dots.textContent = '';
      if (n < 2) return;
      var idx = Math.round(tr.scrollLeft / ((cards[0].offsetWidth || 1) + 8));
      for (var i = 0; i < n; i++) { var e = d.createElement('i'); if (i === Math.min(idx, n - 1)) e.className = 'on'; dots.appendChild(e); }
    }
    draw(); tr.addEventListener('scroll', function () { w.requestAnimationFrame(draw); }, { passive: true }); w.addEventListener('resize', draw);
    var paused = false;
    tr.addEventListener('touchstart', function () { paused = true; }, { passive: true });
    tr.addEventListener('mouseenter', function () { paused = true; });
    if (!still) setInterval(function () {
      if (paused || pages() < 2 || d.hidden) return;
      var step = (cards[0].offsetWidth || 0) + 8, max = tr.scrollWidth - tr.clientWidth;
      tr.scrollTo({ left: tr.scrollLeft + step > max + 2 ? 0 : tr.scrollLeft + step, behavior: 'smooth' });
    }, 3000);
  });

  // After a lead is saved: go to the real thank you page. generate_lead fires there once, so URL based conversions work too.
  function goThanks(id, first, ev) {
    if (state.lead_id !== id) { state.slots = []; state.slots_saved = ''; }
    state.lead_id = id; state.first_name = first || '';
    ev.lead_id = id; ev.page_variant = body.dataset.variant;
    state.pending_lead = ev; save();
    location.assign('/thank-you');
  }
  function addrOk(v) { v = (v || '').trim(); return v.length >= 6 && /[a-z]/i.test(v) && /\d/.test(v); }

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

  // Contact form (bottom of page). Same /api/lead endpoint; counts as a lead like the quiz.
  var pageT0 = Date.now();
  var cform = d.getElementById('cform');
  if (cform) try {
    var cwrap = d.getElementById('cform-wrap'), cbtn = d.getElementById('c-submit'), cerr = d.getElementById('cformerr'), cphone = d.getElementById('c-phone'), cecho = d.getElementById('c-echo');
    var fmt = function (x) { return x.length > 6 ? '(' + x.slice(0, 3) + ') ' + x.slice(3, 6) + '-' + x.slice(6) : x.length > 3 ? '(' + x.slice(0, 3) + ') ' + x.slice(3) : x; };
    cphone.addEventListener('input', function () {
      var x = cphone.value.replace(/\D/g, ''); if (x.length === 11 && x[0] === '1') x = x.slice(1); x = x.slice(0, 10);
      cphone.value = fmt(x); cecho.textContent = x.length === 10 ? ' at ' + cphone.value : '';
    });
    var cErr = function (n, on) { var f = cform.querySelector('.field[data-cf="' + n + '"]'); if (f) f.classList.toggle('bad', !!on); };
    var cCheck = function (n) {
      var v = (cform[n].value || '').trim(), ok = true;
      if (n === 'name') ok = v.length >= 2 && /[a-z]/i.test(v);
      if (n === 'phone') { var p = v.replace(/\D/g, ''); if (p.length === 11 && p[0] === '1') p = p.slice(1); ok = p.length === 10 && !/^[01]/.test(p); }
      if (n === 'email') ok = !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
      if (n === 'address') ok = addrOk(v);
      cErr(n, !ok); return ok;
    };
    ['name', 'phone', 'address'].forEach(function (n) {
      cform[n].addEventListener('blur', function () { if (cform[n].value) cCheck(n); });
      cform[n].addEventListener('input', function () { cErr(n, false); });
    });
    cform.addEventListener('submit', function (e) {
      e.preventDefault(); cerr.classList.remove('show');
      var okAll = ['name', 'phone', 'address'].map(cCheck).every(Boolean);
      if (!okAll) { var bad = cform.querySelector('.field.bad input'); if (bad) bad.focus(); return; }
      cbtn.disabled = true; var label = cbtn.innerHTML; cbtn.textContent = 'Sending';
      var payload = {
        source: 'contact', loss_type: cform.loss_type.value, claim_status: cform.claim_status.value || null,
        name: cform.name.value, phone: cform.phone.value, address: cform.address.value, zip: cform.zip.value, notes: cform.notes.value, company: cform.company.value,
        elapsed_ms: Date.now() - pageT0, page_variant: body.dataset.variant, landing_url: state.landing_url, referrer: state.referrer
      };
      for (var k in state.track) payload[k] = state.track[k];
      fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.ok) {
            state.done_phone = digitsOf(payload.phone);
            goThanks(j.id, j.first_name, { loss_type: payload.loss_type, claim_status: payload.claim_status || '', form: 'contact' });
          } else if (j && j.errors) { Object.keys(j.errors).forEach(function (k) { cErr(k, true); }); }
          else throw new Error((j && j.error) || 'error');
        })
        .catch(function (err) {
          cerr.textContent = (err && err.message && err.message !== 'error' && err.message.indexOf('Failed') === -1) ? err.message : 'We couldn’t send that. Please try again or call (916) 507-1005.';
          cerr.classList.add('show');
        })
        .finally(function () { cbtn.disabled = false; cbtn.innerHTML = label; });
    });
    acInit(d.getElementById('c-address'), function () { cCheck('address'); });
  } catch (e) { if (w.console) console.error('contact form init', e); }

  function renderAnswers() {
    var a = d.getElementById('answers'); a.textContent = '';
    ['loss_type', 'claim_status', 'loss_timing'].forEach(function (k) {
      if (!state[k]) return; var s = d.createElement('span'); s.textContent = LABEL[k][state[k]]; a.appendChild(s);
    });
  }

  // Phone: format as the user types, (415) 555-0142
  var phone = d.getElementById('f-phone');
  phone.addEventListener('input', function () {
    var x = phone.value.replace(/\D/g, '');
    if (x.length === 11 && x[0] === '1') x = x.slice(1);
    x = x.slice(0, 10);
    phone.value = x.length > 6 ? '(' + x.slice(0, 3) + ') ' + x.slice(3, 6) + '-' + x.slice(6) : x.length > 3 ? '(' + x.slice(0, 3) + ') ' + x.slice(3) : x;
  });

  function fieldErr(name, on) { var f = d.querySelector('.field[data-f="' + name + '"]'); if (f) f.classList.toggle('bad', !!on); }
  ['f-name', 'f-phone', 'f-address'].forEach(function (id) {
    d.getElementById(id).addEventListener('blur', function (e) { if (e.target.value) check(e.target.name); });
    d.getElementById(id).addEventListener('input', function (e) { fieldErr(e.target.name, false); });
  });
  function check(name) {
    var v = d.getElementById('f-' + name).value.trim(), ok = true;
    if (name === 'name') ok = v.length >= 2 && /[a-z]/i.test(v);
    if (name === 'phone') { var p = v.replace(/\D/g, ''); if (p.length === 11 && p[0] === '1') p = p.slice(1); ok = p.length === 10 && !/^[01]/.test(p); }
    if (name === 'address') ok = addrOk(v);
    fieldErr(name, !ok); return ok;
  }

  var form = d.getElementById('lead'), btn = d.getElementById('submit'), ferr = d.getElementById('formerr');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ferr.classList.remove('show');
    var okAll = ['name', 'phone', 'address'].map(check).every(Boolean);
    if (!okAll) { var bad = form.querySelector('.field.bad input'); if (bad) bad.focus(); return; }
    btn.disabled = true; btn.textContent = 'Sending';
    var payload = {
      loss_type: state.loss_type, claim_status: state.claim_status, loss_timing: state.loss_timing,
      name: form.name.value, phone: form.phone.value, address: form.address.value, zip: form.zip.value, company: form.company.value,
      elapsed_ms: state.t0 ? Date.now() - state.t0 : null, page_variant: body.dataset.variant,
      landing_url: state.landing_url, referrer: state.referrer
    };
    for (var k in state.track) payload[k] = state.track[k];
    fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.j && res.j.ok) {
          state.done_phone = digitsOf(payload.phone);
          goThanks(res.j.id, res.j.first_name, { loss_type: state.loss_type, claim_status: state.claim_status, form: 'quiz' });
        } else if (res.j && res.j.errors) {
          Object.keys(res.j.errors).forEach(function (k) { fieldErr(k, true); });
          if (res.j.errors.loss_type || res.j.errors.claim_status || res.j.errors.loss_timing) show(1, true);
        } else {
          throw new Error((res.j && res.j.error) || 'error');
        }
      })
      .catch(function (err) {
        ferr.textContent = (err && err.message && err.message !== 'error' && err.message.indexOf('Failed') === -1) ? err.message : 'We couldn’t send that. Please try again or call (916) 507-1005.';
        ferr.classList.add('show');
      })
      .finally(function () { btn.disabled = false; btn.textContent = 'Get my free review'; });
  });
  acInit(d.getElementById('f-address'), function () { check('address'); });

  // Thank you: call slots in Pacific time, next 3 business days, 9 AM to 5 PM only.
  var TIMES = ['9:30 AM', '11:00 AM', '1:30 PM', '3:30 PM'];
  var MIN = { '9:30 AM': 570, '11:00 AM': 660, '1:30 PM': 810, '3:30 PM': 930 };
  function ptNow() {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
    var o = {}; p.forEach(function (x) { o[x.type] = x.value; });
    return { y: +o.year, m: +o.month, d: +o.day, min: (+o.hour % 24) * 60 + (+o.minute) };
  }
  function days() {
    var n = ptNow(), out = [], base = Date.UTC(n.y, n.m - 1, n.d, 12);
    for (var i = 0; out.length < 3 && i < 10; i++) {
      var dt = new Date(base + i * 864e5), wd = dt.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      var times = TIMES.filter(function (t) { return i > 0 || MIN[t] - n.min >= 60; });
      if (!times.length) continue;
      out.push({ wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd], md: dt.getUTCDate(), mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][dt.getUTCMonth()], times: times, today: i === 0 });
    }
    return out;
  }
  var picked = { day: 0 }, MAXP = 6, slotMsg = '', slotBad = false;
  function slotLabel(x, t) { return x.wd + ' ' + x.mon + ' ' + x.md + ', ' + t + ' PT'; }
  function renderSlots() {
    d.getElementById('fname').textContent = state.first_name ? ', ' + state.first_name : '';
    var box = d.getElementById('slots'), li = d.getElementById('li-pick');
    if (!state.lead_id) { box.hidden = true; if (li) li.hidden = true; return; }
    state.slots = state.slots || [];
    var list = days(), dd = d.getElementById('days'), tt = d.getElementById('times'), order = [];
    list.forEach(function (x) { x.times.forEach(function (t) { order.push(slotLabel(x, t)); }); });
    state.slots.sort(function (p, q) { var i = order.indexOf(p), j = order.indexOf(q); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j); });
    dd.textContent = '';
    list.forEach(function (x, i) {
      var n = x.times.filter(function (t) { return state.slots.indexOf(slotLabel(x, t)) > -1; }).length;
      var b = d.createElement('button'); b.type = 'button'; b.className = 'day'; b.setAttribute('aria-pressed', i === picked.day ? 'true' : 'false');
      b.innerHTML = (x.today ? 'Today' : x.wd) + '<b>' + x.md + '</b>' + (n ? '<i aria-hidden="true">' + n + '</i>' : '');
      if (n) b.setAttribute('aria-label', (x.today ? 'Today' : x.wd) + ' ' + x.md + ', ' + n + ' picked');
      b.addEventListener('click', function () { picked.day = i; renderSlots(); });
      dd.appendChild(b);
    });
    tt.textContent = '';
    var day = list[picked.day] || list[0];
    if (day) day.times.forEach(function (t) {
      var label = slotLabel(day, t);
      var b = d.createElement('button'); b.type = 'button'; b.className = 'time'; b.textContent = t;
      b.setAttribute('aria-pressed', state.slots.indexOf(label) > -1 ? 'true' : 'false');
      b.addEventListener('click', function () { toggleSlot(label); });
      tt.appendChild(b);
    });
    var pk = d.getElementById('picks'), pl = d.getElementById('picklist');
    pl.textContent = ''; pk.hidden = !state.slots.length;
    state.slots.forEach(function (s) {
      var li2 = d.createElement('li'), b = d.createElement('button'); b.type = 'button';
      b.textContent = s.replace(' PT', '') + ' ×'; b.setAttribute('aria-label', 'Remove ' + s);
      b.addEventListener('click', function () { toggleSlot(s); });
      li2.appendChild(b); pl.appendChild(li2);
    });
    var sb = d.getElementById('slot-save'), same = state.slots.join('; ') === (state.slots_saved || '');
    sb.disabled = !state.slots.length || same;
    sb.textContent = state.slots_saved ? (same ? 'Call times saved' : 'Update my call times') : (state.slots.length > 1 ? 'Confirm these ' + state.slots.length + ' call times' : 'Confirm my call time');
    var el = d.getElementById('booked');
    var msg = slotMsg || (state.slots_saved && same ? 'Saved. We’ll call the number you gave us at one of these times.' : '');
    el.textContent = msg; el.classList.toggle('show', !!msg); el.classList.toggle('bad', !!slotMsg && slotBad);
  }
  function toggleSlot(label) {
    state.slots = state.slots || []; slotMsg = '';
    var i = state.slots.indexOf(label);
    if (i > -1) state.slots.splice(i, 1);
    else if (state.slots.length >= MAXP) { slotMsg = 'You can pick up to ' + MAXP + ' times.'; slotBad = true; }
    else state.slots.push(label);
    save(); renderSlots();
  }
  function saveSlots() {
    if (!state.lead_id || !state.slots || !state.slots.length) return;
    var picks = state.slots.slice(), sb = d.getElementById('slot-save');
    sb.disabled = true; sb.textContent = 'Saving'; slotMsg = '';
    fetch('/api/lead/' + encodeURIComponent(state.lead_id) + '/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slots: picks }) })
      .then(function (r) { if (!r.ok) throw new Error('save'); })
      .then(function () {
        state.slots_saved = picks.join('; '); save();
        dl('callback_booked', { slot: picks.join('; '), slot_count: picks.length });
        renderSlots();
      })
      .catch(function () { slotMsg = 'We couldn’t save that. Please try again or call (916) 507-1005.'; slotBad = true; renderSlots(); });
  }
  var slotSave = d.getElementById('slot-save');
  if (slotSave) slotSave.addEventListener('click', saveSlots);

  // Autofill across forms, and unfinished form capture. Details typed in one form fill the other.
  // A valid phone number left without pressing send is saved so the team can follow up (see /privacy).
  if (!state.pid) { state.pid = (w.crypto && w.crypto.randomUUID) ? w.crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); save(); }
  var lastPartial = '', ptimer = null;
  function digitsOf(v) { var x = String(v || '').replace(/\D/g, ''); if (x.length === 11 && x[0] === '1') x = x.slice(1); return x; }
  function remember(which, f) {
    var c = state.contact || {};
    ['name', 'phone', 'address', 'zip'].forEach(function (k) { if (f[k]) c[k] = f[k].value; });
    c.form = which; state.contact = c; save();
    var other = which === 'contact' ? form : cform;
    if (other) {
      ['name', 'phone', 'address'].forEach(function (k) { if (other[k] && c[k]) other[k].value = c[k]; });
      if (other.zip && c.zip) other.zip.value = c.zip;
      var p = other.querySelector('input[type="tel"]');
      if (p && p.value) { var x = digitsOf(p.value); p.value = x.length > 6 ? '(' + x.slice(0, 3) + ') ' + x.slice(3, 6) + '-' + x.slice(6) : x.length > 3 ? '(' + x.slice(0, 3) + ') ' + x.slice(3) : x; }
    }
  }
  function prefill() {
    var c = state.contact; if (!c) return;
    [form, cform].forEach(function (f) {
      if (!f) return;
      ['name', 'phone', 'address'].forEach(function (k) { if (f[k] && !f[k].value && c[k]) f[k].value = c[k]; });
      if (f.zip && !f.zip.value && c.zip && f.address && f.address.value === c.address) f.zip.value = c.zip;
    });
    var cp = d.getElementById('c-phone'); if (cp && cp.value) { try { cp.dispatchEvent(new Event('input')); } catch (e) {} }
  }
  function partialBody() {
    var c = state.contact || {}, ph = digitsOf(c.phone);
    if (ph.length !== 10 || /^[01]/.test(ph) || state.done_phone === ph) return null;
    var isC = c.form === 'contact' && cform, f = isC ? cform : form;
    if (f && f.company && f.company.value) return null;
    var b = {
      pid: state.pid, form: isC ? 'contact' : 'quiz', name: c.name || '', phone: c.phone, address: c.address || '', zip: c.zip || '',
      loss_type: isC ? cform.loss_type.value : (state.loss_type || ''), claim_status: isC ? cform.claim_status.value : (state.claim_status || ''),
      loss_timing: isC ? '' : (state.loss_timing || ''), page_variant: body.dataset.variant, landing_url: state.landing_url, referrer: state.referrer
    };
    for (var k in state.track) b[k] = state.track[k];
    return JSON.stringify(b);
  }
  function sendPartial(beacon) {
    clearTimeout(ptimer);
    var s = partialBody(); if (!s || s === lastPartial) return;
    lastPartial = s;
    if (beacon && navigator.sendBeacon) { try { if (navigator.sendBeacon('/api/partial', new Blob([s], { type: 'text/plain' }))) return; } catch (e) {} }
    fetch('/api/partial', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: s, keepalive: true }).catch(function () { lastPartial = ''; });
  }
  [['quiz', form], ['contact', cform]].forEach(function (pair) {
    var f = pair[1]; if (!f) return;
    ['name', 'phone', 'address'].forEach(function (k) {
      if (!f[k]) return;
      f[k].addEventListener('input', function () { remember(pair[0], f); clearTimeout(ptimer); ptimer = setTimeout(sendPartial, 4000); });
      f[k].addEventListener('change', function () { remember(pair[0], f); sendPartial(); });
    });
  });
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'hidden') sendPartial(true); });
  w.addEventListener('pagehide', function () { sendPartial(true); });
  if (!TY) prefill();

  // Real thank you page at /thank-you. The lead event fires once here, after the redirect.
  if (TY) {
    body.classList.add('ty');
    if (state.pending_lead) { var pl0 = state.pending_lead; delete state.pending_lead; save(); dl('generate_lead', pl0); }
    show(5, false);
    return;
  }

  // Restore position on reload or deep link.
  var initial = stepFromHash();
  history.replaceState({ step: initial }, '', location.href);
  if (initial > 1) show(initial, false);
})();
