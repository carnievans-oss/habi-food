/* ═══════════════════════════════════════════════════════════════════
   Habi-Food Mobile — screens

   Every view here is single-column and thumb-reachable. There are no desktop
   idioms in this file: no sidebars, no split panes, no dense tables, no
   hover-only controls. Primary actions sit low on the screen where a thumb
   rests; reference detail opens in a bottom sheet rather than a new page.

   MOBILE ONLY.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const U = global.HFUI;
  const Data = global.HFData;
  const esc = U.esc;

  // Cheap render-time state — the current animal map and the last known fix.
  const state = { animals: {}, here: null, map: null, layer: null };

  function screen(html) { return '<div class="hf-screen">' + html + '</div>'; }

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
  }

  const STATUS_LABEL = {
    in_care: 'In care', released: 'Released', missing: 'Missing',
    died: 'Died in care', transferred: 'Transferred',
  };
  function statusLabel(a) {
    return STATUS_LABEL[a.status] || (a.status || '').replace(/_/g, ' ');
  }

  /** Rescue cause id → the label the desktop build shows, with its icon. */
  function causeLabel(id) {
    const c = (global.HF_DOMAIN.CAUSES || []).find((x) => x.id === id);
    return c ? (c.icon + ' ' + c.label) : String(id || '').replace(/_/g, ' ');
  }

  function collectedLabel(iso) {
    return iso ? 'Last collected ' + U.since(iso) : 'Never collected';
  }

  /** One-line intro under the app bar. The app bar already carries the title,
      so screens never repeat it as a heading. */
  function intro(text) {
    return '<p class="text-[13px] text-muted leading-snug px-1 mb-4">' + text + '</p>';
  }

  /* ═══ LOGIN ═══════════════════════════════════════════════════ */
  function login() {
    return screen(
      '<div class="pt-2 pb-6">' +
        '<div class="text-center mb-7">' +
          '<div class="text-[44px] leading-none mb-2">🌿</div>' +
          '<h1 class="font-display text-[26px] font-black text-euca leading-tight">Habi-Food</h1>' +
          '<p class="text-[14px] text-muted mt-1">Australia\'s wildlife carer network</p>' +
        '</div>' +

        '<section class="hf-card mb-3">' +
          '<label class="hf-label" for="lg-name">Your name</label>' +
          '<input id="lg-name" class="hf-field mb-3" autocomplete="name" enterkeyhint="next" placeholder="Jane Carer">' +
          '<label class="hf-label" for="lg-lic">DEECA licence number</label>' +
          '<input id="lg-lic" class="hf-field mb-3" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="next" placeholder="e.g. 10001234">' +
          '<label class="hf-label" for="lg-code">Access code</label>' +
          '<input id="lg-code" class="hf-field" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Issued by your administrator">' +
          '<p id="lg-warn" class="hidden text-[13px] text-danger leading-snug mt-3"></p>' +
          '<button id="lg-go" class="hf-btn-primary hf-btn-block mt-4" onclick="HFApp.doLogin()">Sign in</button>' +
        '</section>' +

        '<button class="hf-btn-secondary hf-btn-block" onclick="HFApp.doDemo()">Try demo mode</button>' +
        '<p class="text-[12px] text-muted text-center leading-relaxed mt-4 px-2">' +
          'Demo mode runs entirely on this device with six sample Victorian animals. ' +
          'No network needed, nothing is written to the carer network.' +
        '</p>' +
      '</div>'
    );
  }

  /* ═══ TODAY ═══════════════════════════════════════════════════ */
  function today() {
    const s = Data.session();
    const animals = state.animals;
    const care = Data.inCare(animals);
    const rel = Data.released(animals);
    const needs = Data.browseList(animals);
    const spots = Data.spotList();
    const next = Data.upcoming(21)[0];
    const alerts = Data.alerts(animals);
    const queued = Data.pendingCount();

    const head =
      '<div class="px-1 mb-4">' +
        '<p class="text-[13px] text-muted">' + esc(new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })) + '</p>' +
        '<h1 class="font-display text-[24px] font-black text-euca leading-tight">' +
          greeting() + ', ' + esc((s.name || '').split(' ')[0] || 'carer') +
        '</h1>' +
        (s.demo ? '<span class="hf-pill-mute mt-2">Demo mode — sample data</span>' : '') +
        (queued ? '<span class="hf-pill-warn mt-2 ml-1">' + queued + ' change' + (queued === 1 ? '' : 's') + ' waiting to sync</span>' : '') +
      '</div>';

    const stats =
      '<div class="grid grid-cols-2 gap-2.5 mb-4">' +
        '<div class="hf-stat"><span class="hf-stat-n">' + care.length + '</span><span class="hf-stat-l">In care</span></div>' +
        '<div class="hf-stat"><span class="hf-stat-n">' + needs.length + '</span><span class="hf-stat-l">Browse items</span></div>' +
        '<div class="hf-stat"><span class="hf-stat-n">' + spots.length + '</span><span class="hf-stat-l">Saved spots</span></div>' +
        '<div class="hf-stat"><span class="hf-stat-n">' + rel.length + '</span><span class="hf-stat-l">Released</span></div>' +
      '</div>';

    // Today's cut list — the first thing a carer opens the app for.
    let collect;
    if (!needs.length) {
      collect = U.card('Collect today',
        U.empty(care.length
          ? 'Nobody in care needs browse yet — every animal is still on formula.'
          : 'No animals in care. Add an intake on the desktop site to start a browse plan.'));
    } else {
      const rows = needs.slice(0, 4).map((n) =>
        U.row({
          icon: '🌿',
          title: esc(n.item),
          sub: n.animals.map((a) => esc(a.ref)).join(' · '),
          right: '<span class="hf-pill-ok">' + n.animals.length + '</span>',
        })).join('');
      collect = U.card('Collect today',
        '<div class="hf-list">' + rows + '</div>' +
        (needs.length > 4
          ? '<button class="hf-btn-ghost hf-btn-block mt-2" onclick="HFApp.go(\'browse\')">See all ' + needs.length + ' items</button>'
          : ''),
        '<span class="hf-pill-ok">' + care.length + ' animal' + (care.length === 1 ? '' : 's') + '</span>');
    }

    const alertCard = alerts.length
      ? U.card('Needs attention',
          '<div class="hf-list">' + alerts.slice(0, 2).map((a) => U.row({
            icon: a.kind === 'animal' ? '🔍' : '🔥',
            title: esc(a.title),
            sub: esc(a.meta || a.body).slice(0, 90),
            tap: "HFApp.go('alerts')",
          })).join('') + '</div>',
          '<span class="hf-pill-alert">' + alerts.length + '</span>')
      : '';

    const eventCard = next
      ? U.card('Next in the landscape',
          '<p class="text-[15px] font-bold text-ink leading-snug">' + esc(next.title) + '</p>' +
          '<p class="text-[13px] text-muted mt-1 leading-snug">' + esc(next.location || '') + '</p>' +
          '<div class="flex items-center gap-2 mt-3">' +
            '<span class="' + (next.impact === 'high' ? 'hf-pill-alert' : next.impact === 'medium' ? 'hf-pill-warn' : 'hf-pill-mute') + '">' +
              esc(next.impact) + ' impact</span>' +
            '<span class="hf-pill-info">' + U.relDays(next.daysOut) + '</span>' +
          '</div>' +
          '<button class="hf-btn-secondary hf-btn-block mt-3" onclick="HFApp.openEvent(0)">What to prepare</button>')
      : '';

    return screen(head + stats + collect + alertCard + eventCard);
  }

  /* ═══ BROWSE ══════════════════════════════════════════════════ */
  function browse() {
    const animals = state.animals;
    const needs = Data.browseList(animals);
    const spots = Data.spotList();

    const cut = needs.length
      ? '<div class="hf-list">' + needs.map((n, i) => U.row({
          icon: '🌿',
          title: esc(n.item),
          sub: n.animals.map((a) => esc(a.ref) + ' · ' + esc(a.species)).join('<br>'),
          right: '<span class="hf-pill-ok">' + n.animals.length + '</span>',
          tap: 'HFApp.openNeed(' + i + ')',
        })).join('') + '</div>'
      : U.empty('Nothing to cut today. Browse needs appear here as animals move past the formula stage.');

    const spotRows = spots.length
      ? '<div class="hf-list">' + spots
          .map((s) => Object.assign({}, s, { dist: U.km(state.here, s) }))
          .sort((a, b) => (a.dist == null ? 9e9 : a.dist) - (b.dist == null ? 9e9 : b.dist))
          .map((s) => U.row({
            icon: '📍',
            title: esc(s.address),
            sub: collectedLabel(s.lastCollected) +
                 (s.dist != null ? ' · ' + s.dist.toFixed(1) + ' km away' : ''),
            tap: "HFApp.openSpot('" + esc(s.id) + "')",
          })).join('') + '</div>'
      : U.empty('No saved spots yet. Stand at a good tree and tap “Save this spot”.');

    return screen(
      intro('What to cut today, and where you cut it last time.') +
      U.card('Cut list', cut) +
      U.card('Saved spots', spotRows,
        '<span class="hf-pill-mute">' + spots.length + '</span>') +
      '<button class="hf-btn-primary hf-btn-block mb-2" onclick="HFApp.saveHere()">📍 Save this spot</button>' +
      '<p class="text-[12px] text-muted text-center leading-relaxed px-3 mb-2">' +
        'Uses your current location. Works offline — spots sync to the network next time you have signal.' +
      '</p>'
    );
  }

  /* ═══ MAP ═════════════════════════════════════════════════════ */
  function mapShell() {
    // A legend, because three colours of dot mean nothing without one.
    const key = [
      ['#256b45', 'Browse spot'],
      ['#a7c957', 'Release site'],
      ['#c87a00', 'Rescue'],
    ].map(([c, l]) =>
      '<span class="flex items-center gap-1.5">' +
        '<span style="width:9px;height:9px;border-radius:50%;background:' + c + ';border:1.5px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.12)"></span>' +
        l +
      '</span>').join('');

    return '<div id="hf-map"></div>' +
      '<div class="hf-map-legend">' + key + '</div>' +
      '<button class="hf-map-fab" onclick="HFApp.locate()" aria-label="Find my location">🎯</button>';
  }

  /**
   * Build the Leaflet map once, then refresh its markers on each visit.
   * Leaflet ships from mobile-dist/vendor so the map control still renders
   * with no connection (tiles need network; the app around them does not).
   */
  function mountMap() {
    const CFG = global.HF_CFG;
    if (typeof global.L === 'undefined') {
      document.getElementById('hf-map').innerHTML =
        '<div class="hf-empty">Map library unavailable in this build.</div>';
      return;
    }
    if (!state.map) {
      state.map = global.L.map('hf-map', {
        center: CFG.map.center,
        zoom: CFG.map.zoom,
        zoomControl: true,
        attributionControl: true,
        tap: true,
      });
      global.L.tileLayer(CFG.map.tiles, {
        maxZoom: CFG.map.maxZoom,
        attribution: CFG.map.attribution,
      }).addTo(state.map);
      state.layer = global.L.layerGroup().addTo(state.map);
    }
    setTimeout(() => { try { state.map.invalidateSize(); } catch (e) {} }, 60);
    refreshMarkers();
  }

  function dot(color, label) {
    return global.L.divIcon({
      className: '',
      html: '<div style="width:16px;height:16px;border-radius:50%;background:' + color +
            ';border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35)" title="' + label + '"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }

  function refreshMarkers() {
    if (!state.layer) return;
    state.layer.clearLayers();
    const bounds = [];

    Data.spotList().forEach((s) => {
      if (s.lat == null || s.lng == null) return;
      bounds.push([s.lat, s.lng]);
      global.L.marker([s.lat, s.lng], { icon: dot('#256b45', 'Browse spot') })
        .addTo(state.layer)
        .on('click', () => global.HFApp.openSpot(s.id));
    });

    Data.list(state.animals).forEach((a) => {
      const r = a.release;
      if (r && r.lat != null) {
        bounds.push([r.lat, r.lng]);
        global.L.marker([r.lat, r.lng], { icon: dot('#a7c957', 'Release site') })
          .addTo(state.layer)
          .on('click', () => global.HFApp.openAnimal(a.id));
      }
      const i = a.intake;
      if (i && i.lat != null) {
        bounds.push([i.lat, i.lng]);
        global.L.marker([i.lat, i.lng], { icon: dot('#c87a00', 'Rescue location') })
          .addTo(state.layer)
          .on('click', () => global.HFApp.openAnimal(a.id));
      }
    });

    if (state.here) {
      global.L.circleMarker([state.here.lat, state.here.lng], {
        radius: 7, color: '#2b6cb0', fillColor: '#2b6cb0', fillOpacity: 0.9, weight: 3,
      }).addTo(state.layer);
    }
    if (bounds.length > 1) {
      try { state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 }); } catch (e) {}
    }
  }

  /* ═══ ALERTS ══════════════════════════════════════════════════ */
  function alerts() {
    const items = Data.alerts(state.animals);
    const events = Data.upcoming(60);

    const alertList = items.length
      ? '<div class="hf-list">' + items.map((a, i) => U.row({
          icon: a.kind === 'animal' ? '🔍' : (a.severity === 'alert' ? '🔥' : '⚠️'),
          title: esc(a.title),
          // Contact and timing sit under the label, not beside it — a phone row
          // has one column of usable width, and the label owns it.
          sub: esc(a.body) + (a.meta ? '<br><b class="text-ink2">' + esc(a.meta) + '</b>' : ''),
          right: a.kind === 'event'
            ? '<span class="' + (a.severity === 'alert' ? 'hf-pill-alert' : 'hf-pill-warn') + '">' + esc(a.severity === 'alert' ? 'Soon' : 'Ahead') + '</span>'
            : '<span class="hf-pill-alert">Missing</span>',
          tap: a.kind === 'animal' ? "HFApp.openAnimal('" + esc(a.animalId) + "')" : 'HFApp.openEventById(' + i + ')',
        })).join('') + '</div>'
      : U.empty('Nothing needs your attention right now.');

    const eventList = events.length
      ? '<div class="hf-list">' + events.map((e, i) => U.row({
          icon: e.type === 'burn' ? '🔥' : e.type === 'clear' ? '🪓' : e.type === 'arbo' ? '🌳' : '🚜',
          title: esc(e.title),
          sub: esc(e.location || ''),
          right: '<span class="' + (e.impact === 'high' ? 'hf-pill-alert' : e.impact === 'medium' ? 'hf-pill-warn' : 'hf-pill-mute') + '">' + U.relDays(e.daysOut) + '</span>',
          tap: 'HFApp.openEvent(' + i + ')',
        })).join('') + '</div>'
      : U.empty('No scheduled works in the next two months.');

    return screen(
      intro('Missing animals, and works that change what you collect.') +
      U.card('Needs attention', alertList) +
      U.card('Scheduled works', eventList)
    );
  }

  /* ═══ MORE ════════════════════════════════════════════════════ */
  function more() {
    const s = Data.session();
    const care = Data.inCare(state.animals);
    const queued = Data.pendingCount();

    const animalRows = care.length
      ? '<div class="hf-list">' + care.map((a) => {
          const sp = Data.speciesOf(a);
          const st = Data.stageOf(a);
          return U.row({
            icon: st.icon || '🐾',
            title: esc(a.animalRef || a.id),
            sub: esc(sp.name) + ' · ' + esc(st.label),
            tap: "HFApp.openAnimal('" + esc(a.id) + "')",
          });
        }).join('') + '</div>'
      : U.empty('No animals in care.');

    return screen(
      U.card('In care', animalRows, '<span class="hf-pill-mute">' + care.length + '</span>') +

      U.card('Account',
        '<div class="hf-list">' +
          U.row({ icon: '👤', title: esc(s.name || ''), sub: esc(s.org || 'No organisation recorded') }) +
          U.row({ icon: '🪪', title: 'Licence', sub: esc(s.licence || '') }) +
          U.row({ icon: '📍', title: 'Region', sub: esc(s.region || 'Not recorded') }) +
        '</div>') +

      U.card('Sync',
        '<div class="hf-list">' +
          U.row({
            icon: queued ? '⏳' : '✅',
            title: queued ? queued + ' change' + (queued === 1 ? '' : 's') + ' waiting' : 'Everything synced',
            sub: s.demo ? 'Demo mode — nothing is sent to the network' : 'Queued changes send automatically when you have signal',
          }) +
        '</div>' +
        (s.demo ? '' : '<button class="hf-btn-secondary hf-btn-block mt-2" onclick="HFApp.syncNow()">Sync now</button>')) +

      U.card('About',
        '<p class="text-[14px] text-ink2 leading-relaxed">Habi-Food mobile ' + esc(global.HF_CFG.version) +
        ' · ' + esc(global.HFNative.platform) + ' build.</p>' +
        '<p class="text-[13px] text-muted leading-relaxed mt-2">' +
        'Licensed wildlife rehabilitator network, Victoria. The full desktop site carries intake, ' +
        'release records, reporting and admin — this app covers field work.</p>') +

      '<button class="hf-btn-secondary hf-btn-block mt-1 text-danger" onclick="HFApp.doSignOut()">Sign out</button>' +
      '<div class="h-2"></div>'
    );
  }

  /* ═══ SHEET BODIES ════════════════════════════════════════════ */
  function animalSheet(a) {
    const sp = Data.speciesOf(a);
    const st = Data.stageOf(a);
    const needs = Data.needList((st.needs || {})[a.species]);
    const nextIdx = global.HF_DOMAIN.STAGE_ORDER.indexOf(st.key) + 1;
    const next = global.HF_DOMAIN.STAGE_ORDER[nextIdx];

    return '<div class="flex items-center gap-2 mb-3 flex-wrap">' +
        '<span class="hf-pill-ok">' + esc(st.label) + '</span>' +
        '<span class="hf-pill-mute">' + esc(statusLabel(a)) + '</span>' +
        (a.intake && a.intake.cause ? '<span class="hf-pill-mute">' + esc(causeLabel(a.intake.cause)) + '</span>' : '') +
      '</div>' +
      '<p class="text-[14px] text-ink2 leading-relaxed selectable mb-3">' + esc(st.note || '') + '</p>' +
      (a.browseNote ? '<div class="hf-card mb-3 selectable"><p class="text-[14px] text-ink2 leading-relaxed">📝 ' + esc(a.browseNote) + '</p></div>' : '') +

      '<div class="hf-section">Browse required now</div>' +
      (needs.length
        ? '<div class="hf-list mb-3">' + needs.map((n) =>
            U.row({ icon: '🌿', title: esc(n) })).join('') + '</div>'
        : U.empty('Formula only at this stage — no browse to cut.')) +

      (a.intake ? '<div class="hf-section">Rescue</div>' +
        '<div class="hf-list mb-3">' +
          U.row({ icon: '📍', title: esc(a.intake.location || ''), sub: U.dateAU(a.intake.date) }) +
        '</div>' : '') +

      (next
        ? '<button class="hf-btn-primary hf-btn-block mt-2" onclick="HFApp.advance(\'' + esc(a.id) + '\')">' +
            'Advance to ' + esc(global.HF_DOMAIN.BROWSE_STAGES[next].label) + '</button>'
        : '<p class="text-[13px] text-muted text-center mt-2">Final browse stage — ready for release planning.</p>');
  }

  function spotSheet(s) {
    const dist = U.km(state.here, s);
    return '<div class="flex items-center gap-2 mb-3 flex-wrap">' +
        '<span class="hf-pill-ok">' + collectedLabel(s.lastCollected) + '</span>' +
        (dist != null ? '<span class="hf-pill-info">' + dist.toFixed(1) + ' km away</span>' : '') +
      '</div>' +
      (s.notes ? '<p class="text-[14px] text-ink2 leading-relaxed selectable mb-3">' + esc(s.notes) + '</p>' : '') +
      '<div class="hf-list mb-3">' +
        U.row({ icon: '🧭', title: 'Coordinates', sub: Number(s.lat).toFixed(5) + ', ' + Number(s.lng).toFixed(5) }) +
        U.row({ icon: '📅', title: 'Saved', sub: U.dateAU(s.saved) }) +
      '</div>' +
      '<button class="hf-btn-primary hf-btn-block mb-2" onclick="HFApp.collect(\'' + esc(s.id) + '\')">✓ Mark collected today</button>' +
      '<button class="hf-btn-secondary hf-btn-block mb-2" onclick="HFApp.directions(' + s.lat + ',' + s.lng + ')">🚗 Directions</button>' +
      '<button class="hf-btn-ghost hf-btn-block text-danger" onclick="HFApp.removeSpot(\'' + esc(s.id) + '\')">Remove spot</button>';
  }

  function eventSheet(e) {
    const prep = (e.prep || []).map((p) => U.row({ icon: '▪️', title: esc(p) })).join('');
    const species = (e.species || []).map((sp) => U.row({ icon: '🐾', title: esc(sp) })).join('');
    return '<div class="flex items-center gap-2 mb-3 flex-wrap">' +
        '<span class="' + (e.impact === 'high' ? 'hf-pill-alert' : e.impact === 'medium' ? 'hf-pill-warn' : 'hf-pill-mute') + '">' + esc(e.impact) + ' impact</span>' +
        '<span class="hf-pill-info">' + U.relDays(e.daysOut) + '</span>' +
        (e.area_ha ? '<span class="hf-pill-mute">' + esc(e.area_ha) + ' ha</span>' : '') +
      '</div>' +
      '<p class="text-[14px] text-ink2 leading-relaxed selectable mb-3">' + esc(e.location || '') + '</p>' +
      (species ? '<div class="hf-section">Species at risk</div><div class="hf-list mb-3">' + species + '</div>' : '') +
      (prep ? '<div class="hf-section">Prepare</div><div class="hf-list mb-3">' + prep + '</div>' : '');
  }

  function needSheet(n) {
    return '<p class="text-[15px] font-bold text-ink leading-snug selectable mb-3">' + esc(n.item) + '</p>' +
      '<div class="hf-section">Needed by</div>' +
      '<div class="hf-list mb-3">' + n.animals.map((a) => U.row({
        icon: '🐾', title: esc(a.ref), sub: esc(a.species),
        tap: "HFApp.openAnimal('" + esc(a.id) + "')",
      })).join('') + '</div>' +
      '<p class="text-[13px] text-muted leading-relaxed px-1">' +
        'Cut fresh on the day where you can. Pre-release animals should get browse from ' +
        'as close to the planned release site as possible — scent acclimatisation improves survival.' +
      '</p>';
  }

  global.HFScreens = {
    state, login, today, browse, mapShell, mountMap, refreshMarkers, statusLabel, causeLabel,
    alerts, more, animalSheet, spotSheet, eventSheet, needSheet,
  };
})(window);
