/**
 * 7 Stones booking widget.
 *
 * Renders a check-in / check-out picker (two-month calendar with the cheapest
 * nightly rate under each day) and sends the guest to the booking engine with
 * ?check_in=&check_out=&guests=[&agent_code=] already filled in.
 *
 * Prices come from the booking engine's public /api/{slug}/rate-calendar
 * endpoint; if it can't be reached the calendar simply shows no prices.
 */
(function () {
  'use strict';

  var MAX_MONTHS_AHEAD = 18;
  var stores = {}; // one price cache per booking site + property, shared by widgets

  // ─── Date helpers ───────────────────────────────────────────────────────────

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function parseYmd(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  function addDays(s, n) {
    var d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }

  function monthStart(d, offset) {
    return new Date(d.getFullYear(), d.getMonth() + (offset || 0), 1);
  }

  function shortDate(s) {
    return s
      ? parseYmd(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
  }

  function longDate(s) {
    return parseYmd(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  }

  function esc(v) {
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function symbolFor(currency) {
    try {
      var parts = new Intl.NumberFormat('en-PH', { style: 'currency', currency: currency }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'currency') return parts[i].value;
      }
    } catch (e) { /* fall through */ }
    return '';
  }

  /** 2500 -> "₱2.5K" so it fits under a day cell. */
  function compact(amount, symbol) {
    var n = Number(amount || 0);
    if (!n) return '';
    if (n >= 1000) {
      var k = n / 1000;
      return symbol + (k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'K';
    }
    return symbol + Math.round(n);
  }

  // ─── Markup ─────────────────────────────────────────────────────────────────

  var ICON_CAL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
  var ICON_TAG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.2"/></svg>';

  function shell(cfg) {
    var opts = '';
    for (var n = 1; n <= cfg.maxGuests; n++) {
      opts += '<option value="' + n + '">' + n + (n === 1 ? ' guest' : ' guests') + '</option>';
    }
    return (
      '<div class="bkw-bar">' +
        '<div class="bkw-pill">' +
          '<span class="bkw-dot">' + ICON_CAL + '</span>' +
          '<button type="button" class="bkw-date" data-bkw="in" aria-label="Check-in date"></button>' +
          '<span class="bkw-arrow" aria-hidden="true">&rarr;</span>' +
          '<button type="button" class="bkw-date" data-bkw="out" aria-label="Check-out date"></button>' +
          '<span class="bkw-sep" aria-hidden="true"></span>' +
          '<select class="bkw-guests" aria-label="Guests">' + opts + '</select>' +
        '</div>' +
        '<div class="bkw-promo-wrap">' +
          '<button type="button" class="bkw-promo-btn" aria-expanded="false">' + ICON_TAG + '<span class="bkw-promo-label">Promo Code</span></button>' +
          '<div class="bkw-promo-pop" hidden>' +
            '<span class="bkw-promo-lbl">Promo / agent code</span>' +
            '<div class="bkw-promo-row">' +
              '<input type="text" class="bkw-promo-in" maxlength="40" placeholder="Enter code" autocomplete="off">' +
              '<button type="button" class="bkw-promo-apply">Apply</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<a class="bkw-go" href="#">' + esc(cfg.buttonText) + '</a>' +
      '</div>' +
      '<div class="bkw-pop" role="dialog" aria-label="Choose your dates" hidden>' +
        '<div class="bkw-months"></div>' +
        '<div class="bkw-foot"><span class="bkw-cur"></span><span class="bkw-hint"></span></div>' +
      '</div>'
    );
  }

  // ─── Widget ─────────────────────────────────────────────────────────────────

  function init(root) {
    if (root.__bkw) return;

    var cfg;
    try {
      cfg = JSON.parse(root.getAttribute('data-bkw-config') || '{}');
    } catch (e) { return; }

    // The platform that serves prices (and, by default, the booking address).
    var api;
    try { api = new URL(cfg.apiUrl); } catch (e) { return; }
    if (!cfg.slug) return;

    // 0 / unset = automatic: use the property's own minimum stay once it is known.
    cfg.minNights = Math.max(0, parseInt(cfg.minNights, 10) || 0);
    cfg.maxGuests = Math.max(1, Math.min(20, parseInt(cfg.maxGuests, 10) || 8));
    cfg.buttonText = cfg.buttonText || 'Check Availability';

    root.__bkw = true;
    root.innerHTML = shell(cfg);

    // Shared by every widget for the same property, so a page with several
    // (or the same one twice) makes a single request per month.
    var storeKey = api.origin + '|' + cfg.slug;
    var store = stores[storeKey] || (stores[storeKey] = {
      prices: {}, loaded: {}, currency: 'PHP', minNights: 0, bookingUrl: '',
      maxGuests: 0, roomsLoaded: false, listeners: []
    });

    var $ = function (sel) { return root.querySelector(sel); };
    var el = {
      dateIn:     $('[data-bkw="in"]'),
      dateOut:    $('[data-bkw="out"]'),
      guests:     $('.bkw-guests'),
      promoBtn:   $('.bkw-promo-btn'),
      promoLabel: $('.bkw-promo-label'),
      promoPop:   $('.bkw-promo-pop'),
      promoIn:    $('.bkw-promo-in'),
      promoApply: $('.bkw-promo-apply'),
      go:         $('.bkw-go'),
      pop:        $('.bkw-pop'),
      months:     $('.bkw-months'),
      cur:        $('.bkw-cur'),
      hint:       $('.bkw-hint')
    };

    function minNights() {
      return cfg.minNights > 0 ? cfg.minNights : (store.minNights || 1);
    }

    // The admin's maxGuests setting is a ceiling; once we know the largest
    // room's actual capacity, the smaller of the two wins so the picker never
    // offers a party size nothing on the property can sleep.
    function effectiveMaxGuests() {
      return store.maxGuests > 0 ? Math.min(cfg.maxGuests, store.maxGuests) : cfg.maxGuests;
    }

    var today = ymd(new Date());
    var st = {
      checkIn:  addDays(today, 1),
      checkOut: addDays(today, 1 + minNights()),
      guests:   Math.min(2, cfg.maxGuests),
      promo:    '',
      mode:     'in',
      hover:    '',
      cursor:   monthStart(new Date())
    };

    if (cfg.openIn === 'new') {
      el.go.setAttribute('target', '_blank');
      el.go.setAttribute('rel', 'noopener');
    }

    // ── Booking link ──
    /** Explicit setting, else the address the platform reports, else the platform's path-based page. */
    function baseUrl() {
      return cfg.bookingUrl || store.bookingUrl || (api.origin + '/' + encodeURIComponent(cfg.slug));
    }

    function bookingUrl() {
      var u = new URL(baseUrl());
      u.searchParams.set('check_in', st.checkIn);
      u.searchParams.set('check_out', st.checkOut);
      u.searchParams.set('guests', String(st.guests));
      if (st.promo) u.searchParams.set('agent_code', st.promo);
      return u.toString();
    }

    // ── Open / close ──
    function calOpen() { return !el.pop.hidden; }

    function openCal(mode) {
      closePromo();
      st.mode = mode === 'out' && st.checkIn ? 'out' : 'in';
      st.hover = '';
      if (st.checkIn) st.cursor = monthStart(parseYmd(st.checkIn));
      renderMonths();
      el.pop.hidden = false;
      place();
      loadPrices();
      paint();
    }

    function closeCal() {
      el.pop.hidden = true;
      st.hover = '';
      paint();
    }

    function openPromo() {
      closeCal();
      el.promoIn.value = st.promo;
      el.promoPop.hidden = false;
      el.promoBtn.setAttribute('aria-expanded', 'true');
      el.promoIn.focus();
    }

    function closePromo() {
      el.promoPop.hidden = true;
      el.promoBtn.setAttribute('aria-expanded', 'false');
    }

    /** Keep the popover inside the viewport when the widget sits near an edge. */
    function place() {
      el.pop.style.left = '0px';
      var r = el.pop.getBoundingClientRect();
      var over = r.right - (document.documentElement.clientWidth - 8);
      if (over > 0) {
        var room = Math.max(0, root.getBoundingClientRect().left - 8);
        el.pop.style.left = -Math.min(over, room) + 'px';
      }
    }

    // ── Prices ──
    function loadPrices() {
      var from = ymd(st.cursor);
      if (store.loaded[from]) return;
      var to = ymd(new Date(st.cursor.getFullYear(), st.cursor.getMonth() + 2, 0));
      var url = api.origin + '/api/' + encodeURIComponent(cfg.slug) + '/rate-calendar?from=' + from + '&to=' + to;

      store.loaded[from] = true; // set early so paging doesn't fire duplicate requests
      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('rate-calendar ' + r.status)); })
        .then(function (data) {
          var p = data.prices || {};
          for (var k in p) if (Object.prototype.hasOwnProperty.call(p, k)) store.prices[k] = p[k];
          if (data.currency) store.currency = data.currency;
          if (parseInt(data.min_nights, 10) > 0) store.minNights = parseInt(data.min_nights, 10);
          if (data.booking_url) {
            try {
              var b = new URL(data.booking_url);
              if (b.protocol === 'https:' || b.protocol === 'http:') store.bookingUrl = b.toString();
            } catch (e) { /* ignore a malformed address */ }
          }
          for (var i = 0; i < store.listeners.length; i++) store.listeners[i]();
        })
        .catch(function () {
          delete store.loaded[from]; // allow a retry next time the month is shown
        });
    }

    // ── Room capacity ──
    /** Undated room list, purely to learn the largest room's max_guests. */
    function loadRoomCapacity() {
      if (store.roomsLoaded) return;
      store.roomsLoaded = true; // set early so duplicate widgets don't both fetch
      var url = api.origin + '/api/' + encodeURIComponent(cfg.slug) + '/rooms';
      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('rooms ' + r.status)); })
        .then(function (data) {
          var rooms = data.rooms || [];
          var max = 0;
          for (var i = 0; i < rooms.length; i++) {
            if (rooms[i].sold_out) continue;
            var m = parseInt(rooms[i].max_guests, 10);
            if (m > max) max = m;
          }
          if (max > 0) store.maxGuests = max;
          for (var j = 0; j < store.listeners.length; j++) store.listeners[j]();
        })
        .catch(function () {
          store.roomsLoaded = false; // allow a retry
        });
    }

    /** Rebuilds the guest picker for the current effective max, clamping the selection down if it shrank. */
    function renderGuestOptions() {
      var max = effectiveMaxGuests();
      if (st.guests > max) st.guests = max;
      var opts = '';
      for (var n = 1; n <= max; n++) {
        opts += '<option value="' + n + '">' + n + (n === 1 ? ' guest' : ' guests') + '</option>';
      }
      el.guests.innerHTML = opts;
      el.guests.value = String(st.guests);
    }

    /** Called whenever shared data (prices, minimum stay, booking address, room capacity) arrives. */
    store.listeners.push(function () {
      // A stay shorter than the property's minimum would be rejected at quote time.
      if (st.checkIn && st.checkOut && st.checkOut < addDays(st.checkIn, minNights())) {
        st.checkOut = addDays(st.checkIn, minNights());
      }
      renderGuestOptions();
      if (calOpen()) renderMonths();
      paint();
    });

    // ── Calendar rendering ──
    function renderMonths() {
      var symbol = symbolFor(store.currency);
      var now = monthStart(new Date());
      var canBack = st.cursor > now;
      var canForward = st.cursor < monthStart(now, MAX_MONTHS_AHEAD);
      var html = '';

      for (var m = 0; m < 2; m++) {
        var first = monthStart(st.cursor, m);
        var title = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        var count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();

        html += '<div class="bkw-month"><div class="bkw-head">';
        if (m === 0) {
          html += '<button type="button" class="bkw-nav" data-nav="-1" aria-label="Previous month"' + (canBack ? '' : ' disabled') + '>&larr;</button>' +
                  '<span class="bkw-title">' + esc(title) + '</span>' +
                  '<button type="button" class="bkw-nav bkw-nav-m" data-nav="1" aria-label="Next month"' + (canForward ? '' : ' disabled') + '>&rarr;</button>';
        } else {
          html += '<span class="bkw-nav-sp"></span>' +
                  '<span class="bkw-title">' + esc(title) + '</span>' +
                  '<button type="button" class="bkw-nav" data-nav="1" aria-label="Next month"' + (canForward ? '' : ' disabled') + '>&rarr;</button>';
        }
        html += '</div><div class="bkw-grid bkw-dow">';
        var dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (var w = 0; w < 7; w++) html += '<span>' + dow[w] + '</span>';
        html += '</div><div class="bkw-grid">';

        for (var b = 0; b < first.getDay(); b++) html += '<span></span>';
        for (var day = 1; day <= count; day++) {
          var date = ymd(new Date(first.getFullYear(), first.getMonth(), day));
          var past = date < today;
          html += '<button type="button" class="bkw-day" data-date="' + date + '"' + (past ? ' disabled' : '') +
                  ' aria-label="' + esc(longDate(date)) + '">' +
                  '<span class="bkw-num">' + day + '</span>' +
                  '<span class="bkw-price">' + (past ? '' : esc(compact(store.prices[date], symbol))) + '</span>' +
                  '</button>';
        }
        html += '</div></div>';
      }

      el.months.innerHTML = html;
    }

    /** Refresh everything that depends on the current selection, without rebuilding the DOM. */
    function paint() {
      el.dateIn.textContent  = shortDate(st.checkIn)  || 'Check-in';
      el.dateOut.textContent = shortDate(st.checkOut) || 'Check-out';
      el.dateIn.classList.toggle('on',  calOpen() && st.mode === 'in');
      el.dateOut.classList.toggle('on', calOpen() && st.mode === 'out');

      el.promoLabel.textContent = st.promo || 'Promo Code';
      el.promoBtn.classList.toggle('has-code', !!st.promo);

      if (st.checkIn && st.checkOut) el.go.setAttribute('href', bookingUrl());
      else el.go.setAttribute('href', '#');

      if (!calOpen()) return;

      var previewEnd = st.checkOut || (st.mode === 'out' && st.hover > st.checkIn ? st.hover : '');
      var days = el.months.querySelectorAll('.bkw-day');
      for (var i = 0; i < days.length; i++) {
        var d = days[i].getAttribute('data-date');
        days[i].classList.toggle('is-today', d === today);
        days[i].classList.toggle('is-start', d === st.checkIn);
        days[i].classList.toggle('is-end', !!previewEnd && d === previewEnd);
        days[i].classList.toggle('is-range', !!st.checkIn && !!previewEnd && d > st.checkIn && d < previewEnd);
      }

      el.cur.textContent = 'Price in ' + store.currency;
      if (st.mode === 'out') {
        el.hint.textContent = 'Now pick your check-out date';
      } else if (st.checkIn && st.checkOut) {
        var nights = Math.round((parseYmd(st.checkOut) - parseYmd(st.checkIn)) / 86400000);
        el.hint.textContent = nights + (nights === 1 ? ' night' : ' nights');
      } else {
        el.hint.textContent = '';
      }
    }

    function pickDay(date) {
      if (date < today) return;

      if (st.mode === 'in' || !st.checkIn || date <= st.checkIn) {
        st.checkIn = date;
        st.checkOut = '';
        st.mode = 'out';
        st.hover = '';
        paint();
        return;
      }

      // Respect the minimum stay instead of silently allowing a range the quote would reject.
      var minOut = addDays(st.checkIn, minNights());
      st.checkOut = date < minOut ? minOut : date;
      st.mode = 'in';
      closeCal();
    }

    function applyPromo() {
      st.promo = el.promoIn.value.trim();
      closePromo();
      paint();
    }

    // ── Events ──
    // Flag clicks that started inside the widget: the calendar re-renders on
    // navigation, so by the time the document handler runs the clicked node
    // is detached and root.contains() would wrongly report "outside".
    var inside = false;
    root.addEventListener('click', function (e) {
      inside = true;
      var t = e.target;

      var dateBtn = t.closest('.bkw-date');
      if (dateBtn) {
        var wanted = dateBtn.getAttribute('data-bkw');
        if (calOpen() && st.mode === wanted) closeCal();
        else openCal(wanted);
        return;
      }

      var nav = t.closest('.bkw-nav');
      if (nav) {
        if (!nav.disabled) {
          st.cursor = monthStart(st.cursor, parseInt(nav.getAttribute('data-nav'), 10));
          renderMonths();
          paint();
          loadPrices();
        }
        return;
      }

      var day = t.closest('.bkw-day');
      if (day) {
        if (!day.disabled) pickDay(day.getAttribute('data-date'));
        return;
      }

      if (t.closest('.bkw-promo-btn')) {
        if (el.promoPop.hidden) openPromo(); else closePromo();
        return;
      }

      if (t.closest('.bkw-promo-apply')) {
        applyPromo();
        return;
      }

      if (t.closest('.bkw-go') && !(st.checkIn && st.checkOut)) {
        e.preventDefault();
        openCal(st.checkIn ? 'out' : 'in');
      }
    });

    document.addEventListener('click', function () {
      if (inside) { inside = false; return; }
      if (calOpen()) closeCal();
      if (!el.promoPop.hidden) closePromo();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (calOpen()) closeCal();
      if (!el.promoPop.hidden) closePromo();
    });

    el.promoIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applyPromo(); }
    });

    el.months.addEventListener('mouseover', function (e) {
      if (st.mode !== 'out') return;
      var day = e.target.closest('.bkw-day');
      if (!day || day.disabled) return;
      var date = day.getAttribute('data-date');
      if (date !== st.hover) { st.hover = date; paint(); }
    });

    renderGuestOptions();
    el.guests.addEventListener('change', function () {
      st.guests = parseInt(el.guests.value, 10) || 2;
      paint();
    });

    window.addEventListener('resize', function () { if (calOpen()) place(); });

    paint();
    // Load the current window now (not on first click) so the minimum stay,
    // booking address and room capacity are known before the guest interacts,
    // and the calendar opens populated.
    loadPrices();
    loadRoomCapacity();
  }

  function initAll() {
    var nodes = document.querySelectorAll('.bkw[data-bkw-config]');
    for (var i = 0; i < nodes.length; i++) init(nodes[i]);
  }

  // Exposed so page builders that inject content late (Elementor previews) can re-run it.
  window.BoracayBooking = { init: initAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
