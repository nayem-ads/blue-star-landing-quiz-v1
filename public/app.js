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
  function dl(ev, extra) { w.dataLayer = w.dataLayer || []; var o = { event: ev, page_variant: body.dataset.variant }; for (var k in extra) o[k] = extra[k]; w.dataLayer.push(o); }

  var state = load();
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
    if (step >= 2 && !state.loss_type) step = 1;
    if (step >= 3 && !state.claim_status) step = 2;
    if (step >= 4 && !state.loss_timing) step = 3;
    if (step === 5 && !state.lead_id) step = 4;
    current = step;
    body.classList.toggle('funnel', step > 1);
    var screens = d.querySelectorAll('.screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.toggle('on', +screens[i].dataset.step === step);
    if (push) history.pushState({ step: step }, '', step > 1 ? '#step-' + step : location.pathname + location.search);
    w.scrollTo(0, 0);
    if (step > 1) {
      markSelected();
      if (step === 4) renderAnswers();
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

  d.getElementById('back').addEventListener('click', function () { history.back(); });
  w.addEventListener('popstate', function (e) { show((e.state && e.state.step) || stepFromHash(), false); });
  function stepFromHash() { var m = /#step-(\d)/.exec(location.hash); return m ? +m[1] : 1; }

  // Sticky bar: appears once the quiz card scrolls out of view.
  var sticky = d.getElementById('sticky'), quiz = d.getElementById('quiz');
  if ('IntersectionObserver' in w && quiz) {
    new IntersectionObserver(function (en) { sticky.classList.toggle('show', !en[0].isIntersecting && en[0].boundingClientRect.top < 0); }).observe(quiz);
  }
  d.getElementById('sticky-start').addEventListener('click', function () {
    w.scrollTo({ top: 0, behavior: 'smooth' });
    var first = quiz.querySelector('.tile'); if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 400);
  });

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
  var zip = d.getElementById('f-zip');
  zip.addEventListener('input', function () { zip.value = zip.value.replace(/\D/g, '').slice(0, 5); });

  function fieldErr(name, on) { var f = d.querySelector('.field[data-f="' + name + '"]'); if (f) f.classList.toggle('bad', !!on); }
  ['f-name', 'f-phone', 'f-zip'].forEach(function (id) {
    d.getElementById(id).addEventListener('blur', function (e) { if (e.target.value) check(e.target.name); });
    d.getElementById(id).addEventListener('input', function (e) { fieldErr(e.target.name, false); });
  });
  function check(name) {
    var v = d.getElementById('f-' + name).value.trim(), ok = true;
    if (name === 'name') ok = v.length >= 2 && /[a-z]/i.test(v);
    if (name === 'phone') { var p = v.replace(/\D/g, ''); if (p.length === 11 && p[0] === '1') p = p.slice(1); ok = p.length === 10 && !/^[01]/.test(p); }
    if (name === 'zip') ok = /^\d{5}$/.test(v);
    fieldErr(name, !ok); return ok;
  }

  var form = d.getElementById('lead'), btn = d.getElementById('submit'), ferr = d.getElementById('formerr');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    ferr.classList.remove('show');
    var okAll = ['name', 'phone', 'zip'].map(check).every(Boolean);
    if (!okAll) { var bad = form.querySelector('.field.bad input'); if (bad) bad.focus(); return; }
    btn.disabled = true; btn.textContent = 'Sending';
    var payload = {
      loss_type: state.loss_type, claim_status: state.claim_status, loss_timing: state.loss_timing,
      name: form.name.value, phone: form.phone.value, zip: form.zip.value, company: form.company.value,
      elapsed_ms: state.t0 ? Date.now() - state.t0 : null, page_variant: body.dataset.variant,
      landing_url: state.landing_url, referrer: state.referrer
    };
    for (var k in state.track) payload[k] = state.track[k];
    fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.j && res.j.ok) {
          state.lead_id = res.j.id; state.first_name = res.j.first_name; save();
          dl('generate_lead', { lead_id: res.j.id, loss_type: state.loss_type, claim_status: state.claim_status });
          show(5, true);
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
  var picked = { day: 0 };
  function renderSlots() {
    d.getElementById('fname').textContent = state.first_name ? ', ' + state.first_name : '';
    var list = days(), dd = d.getElementById('days'), tt = d.getElementById('times');
    dd.textContent = '';
    list.forEach(function (x, i) {
      var b = d.createElement('button'); b.type = 'button'; b.className = 'day'; b.setAttribute('aria-pressed', i === picked.day ? 'true' : 'false');
      b.innerHTML = (x.today ? 'Today' : x.wd) + '<b>' + x.md + '</b>';
      b.addEventListener('click', function () { picked.day = i; renderSlots(); });
      dd.appendChild(b);
    });
    tt.textContent = '';
    var day = list[picked.day] || list[0];
    if (!day) return;
    day.times.forEach(function (t) {
      var label = day.wd + ' ' + day.mon + ' ' + day.md + ', ' + t + ' PT';
      var b = d.createElement('button'); b.type = 'button'; b.className = 'time'; b.textContent = t;
      b.setAttribute('aria-pressed', state.slot === label ? 'true' : 'false');
      b.addEventListener('click', function () { book(label); });
      tt.appendChild(b);
    });
    if (state.slot) booked(state.slot);
  }
  function booked(label) { var el = d.getElementById('booked'); el.textContent = 'Booked: ' + label + '. We’ll call the number you gave us.'; el.classList.add('show'); }
  function book(label) {
    state.slot = label; save(); renderSlots(); booked(label);
    dl('callback_booked', { slot: label });
    if (!state.lead_id) return;
    fetch('/api/lead/' + encodeURIComponent(state.lead_id) + '/callback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slot: label }) }).catch(function () {});
  }

  // Restore position on reload or deep link.
  var initial = stepFromHash();
  history.replaceState({ step: initial }, '', location.href);
  if (initial > 1) show(initial, false);
})();
