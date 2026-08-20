/* ═══════════════════════════════════════════════════════════════════
   Habi-Food Mobile — UI primitives

   Toast, bottom sheet, pull-to-refresh and the small formatting helpers the
   screens share. Single-column, touch-first, no desktop idioms: no hover-only
   affordances, no multi-column grids beyond paired stat tiles, nothing smaller
   than a 44px tap target.

   MOBILE ONLY.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const doc = global.document;

  /* ── escaping ─────────────────────────────────────────────────── */
  const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ENT[c]);
  }

  /* ── formatting ───────────────────────────────────────────────── */
  function relDays(days) {
    if (days == null) return '';
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    if (days < 0) return Math.abs(days) + ' days ago';
    if (days < 7) return 'In ' + days + ' days';
    const weeks = Math.round(days / 7);
    return 'In ' + weeks + ' week' + (weeks === 1 ? '' : 's');
  }

  function since(iso) {
    if (!iso) return 'never';
    const then = new Date(iso);
    if (isNaN(then)) return 'never';
    const days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 14) return days + ' days ago';
    return then.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }

  function dateAU(value) {
    const d = value instanceof Date ? value : new Date(value);
    return isNaN(d) ? '' : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /** Distance in km between two lat/lng pairs (haversine). */
  function km(a, b) {
    if (!a || !b) return null;
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const la1 = a.lat * Math.PI / 180;
    const la2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ── toast ────────────────────────────────────────────────────── */
  let toastTimer = null;
  function toast(msg, ms) {
    const el = doc.getElementById('hf-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2600);
  }

  /* ── bottom sheet ─────────────────────────────────────────────── */
  const Sheet = {
    onClose: null,

    open(title, bodyHtml, opts) {
      opts = opts || {};
      const sheet = doc.getElementById('hf-sheet');
      const scrim = doc.getElementById('hf-sheet-scrim');
      doc.getElementById('hf-sheet-title').innerHTML = title;
      doc.getElementById('hf-sheet-sub').innerHTML = opts.sub || '';
      doc.getElementById('hf-sheet-body').innerHTML = bodyHtml;
      doc.getElementById('hf-sheet-body').scrollTop = 0;
      sheet.classList.add('open');
      scrim.classList.add('open');
      Sheet.onClose = opts.onClose || null;
      global.HFNative && global.HFNative.tap('LIGHT');
    },

    close() {
      doc.getElementById('hf-sheet').classList.remove('open');
      doc.getElementById('hf-sheet-scrim').classList.remove('open');
      if (Sheet.onClose) { const fn = Sheet.onClose; Sheet.onClose = null; fn(); }
    },

    isOpen() {
      return doc.getElementById('hf-sheet').classList.contains('open');
    },

    /** Drag-to-dismiss: below a third of its height, or a fast flick, it goes. */
    bindDrag() {
      const sheet = doc.getElementById('hf-sheet');
      const head = doc.getElementById('hf-sheet-handle');
      let startY = 0, lastY = 0, startAt = 0, dragging = false;

      head.addEventListener('touchstart', (e) => {
        dragging = true;
        startY = lastY = e.touches[0].clientY;
        startAt = Date.now();
        sheet.classList.add('dragging');
      }, { passive: true });

      head.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        lastY = e.touches[0].clientY;
        const dy = Math.max(0, lastY - startY);
        sheet.style.transform = 'translateY(' + dy + 'px)';
      }, { passive: true });

      head.addEventListener('touchend', () => {
        if (!dragging) return;
        dragging = false;
        sheet.classList.remove('dragging');
        sheet.style.transform = '';
        const dy = lastY - startY;
        const velocity = dy / Math.max(1, Date.now() - startAt);
        if (dy > sheet.offsetHeight / 3 || velocity > 0.6) Sheet.close();
      });
    },
  };

  /* ── pull to refresh ──────────────────────────────────────────── */
  /**
   * Standard mobile gesture: drag down at the top of the list to refresh.
   * `handler` is async; the indicator spins until it settles.
   */
  function bindPullToRefresh(handler) {
    const scroll = doc.getElementById('hf-scroll');
    const ptr = doc.getElementById('hf-ptr');
    const THRESHOLD = 68;
    let startY = 0, pulling = false, busy = false;

    scroll.addEventListener('touchstart', (e) => {
      if (busy || scroll.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      pulling = true;
    }, { passive: true });

    scroll.addEventListener('touchmove', (e) => {
      if (!pulling || busy) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) { ptr.style.height = '0px'; return; }
      // Resistance, so the pull feels weighted rather than free-running.
      const h = Math.min(THRESHOLD * 1.4, dy * 0.5);
      ptr.style.height = h + 'px';
      ptr.querySelector('.label').textContent =
        h >= THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
    }, { passive: true });

    scroll.addEventListener('touchend', async () => {
      if (!pulling || busy) return;
      pulling = false;
      const h = parseFloat(ptr.style.height) || 0;
      if (h < THRESHOLD) { ptr.style.height = '0px'; return; }

      busy = true;
      ptr.classList.add('busy');
      ptr.style.height = THRESHOLD + 'px';
      ptr.querySelector('.label').textContent = 'Refreshing…';
      global.HFNative && global.HFNative.tap('LIGHT');
      try { await handler(); } catch (e) { /* handler reports its own errors */ }
      ptr.classList.remove('busy');
      ptr.style.height = '0px';
      busy = false;
    });
  }

  /* ── small builders ───────────────────────────────────────────── */
  /**
   * A list row. Text wraps rather than truncating — a browse item like
   * "Eucalyptus viminalis — 10+ branchlets (EVC-matched to release site)" is
   * useless clipped, and a phone has the vertical room to spare. The right-hand
   * slot is capped so it can never squeeze the label column to nothing.
   */
  function row(opts) {
    const sub = opts.sub ? '<span class="hf-row-sub block">' + opts.sub + '</span>' : '';
    const right = opts.right
      ? '<span class="shrink-0 max-w-[38%] flex justify-end ml-1">' + opts.right + '</span>'
      : '';
    const chev = opts.tap ? '<i class="hf-chev self-center"></i>' : '';
    const tag = opts.tap ? 'button' : 'div';
    const action = opts.tap ? ' onclick="' + opts.tap + '"' : '';
    return '<' + tag + ' class="hf-row items-start py-3"' + action + '>' +
      (opts.icon ? '<span class="text-[19px] leading-none shrink-0 mt-0.5">' + opts.icon + '</span>' : '') +
      '<span class="flex-1 min-w-0">' +
        '<span class="hf-row-title block">' + opts.title + '</span>' + sub +
      '</span>' +
      right + chev +
      '</' + tag + '>';
  }

  function card(title, bodyHtml, actionHtml) {
    return '<section class="hf-card mb-3">' +
      (title ? '<div class="hf-card-head"><span>' + title + '</span>' + (actionHtml || '') + '</div>' : '') +
      bodyHtml + '</section>';
  }

  function empty(msg) { return '<div class="hf-empty">' + msg + '</div>'; }

  global.HFUI = {
    esc, relDays, since, dateAU, km,
    toast, Sheet, bindPullToRefresh,
    row, card, empty,
  };
})(window);
