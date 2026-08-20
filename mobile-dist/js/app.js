/* ═══════════════════════════════════════════════════════════════════
   Habi-Food Mobile — application shell

   Owns the tab router, the bottom navigation, and every action the screens
   bind to. One scroll region, one visible screen at a time, sheets for detail:
   the shape of an app, not a page.

   MOBILE ONLY.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const doc = global.document;
  const U = global.HFUI;
  const Data = global.HFData;
  const S = global.HFScreens;
  const Native = global.HFNative;
  const Store = global.HFStore;

  const TABS = [
    { id: 'today',  label: 'Today',  icon: '🏠' },
    { id: 'browse', label: 'Browse', icon: '🌿' },
    { id: 'map',    label: 'Map',    icon: '🗺' },
    { id: 'alerts', label: 'Alerts', icon: '🔔' },
    { id: 'more',   label: 'More',   icon: '⋯' },
  ];

  // State_Preservation: the tab is part of where the carer was. Relaunching
  // from Home, or coming back after the system reclaimed the process, returns
  // them to the screen they were using rather than to the default one.
  let tab = (function () {
    const saved = global.HFStore.prefs().tab;
    return TABS.some((t) => t.id === saved) ? saved : 'today';
  })();
  let booted = false;

  function el(id) { return doc.getElementById(id); }

  /* ── chrome ───────────────────────────────────────────────────── */
  function renderTabBar() {
    const alertCount = Data.session() ? Data.alerts(S.state.animals).length : 0;
    el('hf-tabbar').innerHTML = TABS.map((t) => {
      const badged = t.id === 'alerts' && alertCount;
      // The badge dot is decorative; the count goes into the accessible name so
      // it is not carried by a coloured dot alone.
      const name = t.label + (badged ? ', ' + alertCount + ' needing attention' : '');
      return '<button class="hf-tab" role="tab" aria-selected="' + (t.id === tab) + '" ' +
        'aria-label="' + name + '" onclick="HFApp.go(\'' + t.id + '\')">' +
        '<span class="ic" aria-hidden="true">' + t.icon + '</span>' +
        '<span>' + t.label + '</span>' +
        (badged ? '<span class="dot" aria-hidden="true"></span>' : '') +
      '</button>';
    }).join('');
  }

  function setTitle(text, sub) {
    el('hf-title').textContent = text;
    el('hf-sub').textContent = sub || '';
    el('hf-sub').style.display = sub ? '' : 'none';
  }

  /* ── router ───────────────────────────────────────────────────── */
  function render() {
    const scroll = el('hf-scroll');
    const session = Data.session();

    if (!session) {
      el('hf-tabbar').style.display = 'none';
      scroll.classList.remove('is-map');
      setTitle('Habi-Food');
      scroll.innerHTML = S.login();
      return;
    }

    el('hf-tabbar').style.display = '';
    renderTabBar();

    const isMap = tab === 'map';
    scroll.classList.toggle('is-map', isMap);

    switch (tab) {
      case 'browse':
        setTitle('Browse', 'Cut list and saved spots');
        scroll.innerHTML = S.browse();
        break;
      case 'map':
        setTitle('Map', Data.spotList().length + ' saved spots');
        scroll.innerHTML = S.mapShell();
        S.mountMap();
        break;
      case 'alerts':
        setTitle('Alerts');
        scroll.innerHTML = S.alerts();
        break;
      case 'more':
        setTitle('More');
        scroll.innerHTML = S.more();
        break;
      default:
        setTitle('Habi-Food', session.demo ? 'Demo mode' : (session.org || 'Carer network'));
        scroll.innerHTML = S.today();
    }
    scroll.scrollTop = 0;
  }

  function go(next) {
    if (next === tab && next !== 'map') { render(); return; }
    tab = next;
    global.HFStore.setPref('tab', next);
    Native.tap('LIGHT');
    render();
  }

  /* ── data refresh ─────────────────────────────────────────────── */
  async function refresh(force) {
    if (!Data.session()) return;
    S.state.animals = await Data.animals({ force: !!force });
    await Data.loadSpots({ force: !!force });
    render();
  }

  /* ── actions ──────────────────────────────────────────────────── */
  async function doLogin() {
    const warn = el('lg-warn');
    const btn = el('lg-go');
    const name = el('lg-name').value.trim();
    const lic = el('lg-lic').value.trim();
    const code = el('lg-code').value.trim();

    warn.classList.add('hidden');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      await Data.signInWithCode(name, lic, code);
      Native.notify('SUCCESS');
      await refresh(true);
      U.toast('Signed in — welcome back');
    } catch (e) {
      warn.textContent = e.message;
      warn.classList.remove('hidden');
      Native.notify('ERROR');
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  async function doDemo() {
    await Data.signInDemo();
    await refresh();
    U.toast('Demo mode — six sample animals loaded');
  }

  function doSignOut() {
    Data.signOut();
    S.state.animals = {};
    tab = 'today';
    render();
    U.toast('Signed out');
  }

  /* Detail sheets */
  function openAnimal(id) {
    const a = S.state.animals[id];
    if (!a) return;
    const sp = Data.speciesOf(a);
    U.Sheet.open(U.esc(a.animalRef || a.id), S.animalSheet(a), { sub: U.esc(sp.name) });
  }

  function openSpot(id) {
    const s = Data.spots()[id];
    if (!s) return;
    U.Sheet.open('Browse spot', S.spotSheet(s), { sub: U.esc(s.address) });
  }

  function openEvent(i) {
    const e = Data.upcoming(60)[i];
    if (!e) return;
    U.Sheet.open(U.esc(e.title), S.eventSheet(e), { sub: U.esc(e.type) + ' · ' + U.dateAU(e.date) });
  }

  function openEventById(i) {
    const a = Data.alerts(S.state.animals)[i];
    if (!a || !a.event) return;
    U.Sheet.open(U.esc(a.event.title), S.eventSheet(a.event), { sub: U.dateAU(a.event.date) });
  }

  function openNeed(i) {
    const n = Data.browseList(S.state.animals)[i];
    if (!n) return;
    U.Sheet.open('Browse item', S.needSheet(n), { sub: n.animals.length + ' animal' + (n.animals.length === 1 ? '' : 's') });
  }

  /* Field actions */
  async function saveHere() {
    // Permission_Rationale: say why the location is wanted BEFORE the system
    // prompt appears, and only at the moment the carer asked to save a spot —
    // never at startup. If they decline, everything else still works.
    if (!Store.prefs().locationExplained && !(await Native.hasLocationPermission())) {
      const go = await U.confirm(
        'Save this spot',
        'Habi-Food records where you are standing so you can find this tree again, ' +
        'and so the spot can be shared as a collection point. Your location is stored ' +
        'with your own records and is never used for anything else.',
        'Continue'
      );
      if (!go) return;
      Store.setPref('locationExplained', true);
    }

    U.toast('Getting your location…');
    const pos = await Native.position();
    if (!pos) {
      U.toast('Could not get a location fix. Check location permission and try again in the open.', 4200);
      Native.notify('ERROR');
      return;
    }
    S.state.here = pos;
    const { status } = await Data.saveSpot({ lat: pos.lat, lng: pos.lng });
    Native.notify('SUCCESS');
    U.toast(status === 'queued'
      ? 'Spot saved on this device — will sync when you have signal'
      : 'Spot saved');
    render();
  }

  async function collect(id) {
    const { status } = await Data.markCollected(id);
    Native.notify('SUCCESS');
    U.Sheet.close();
    U.toast(status === 'queued' ? 'Marked collected — queued to sync' : 'Marked collected');
    render();
  }

  async function removeSpot(id) {
    await Data.hideSpot(id);
    U.Sheet.close();
    U.toast('Spot removed');
    render();
  }

  async function advance(id) {
    const r = await Data.advanceStage(id, S.state.animals);
    if (!r.changed) { U.toast('Already at the final browse stage'); return; }
    Native.notify('SUCCESS');
    U.Sheet.close();
    U.toast('Moved to ' + global.HF_DOMAIN.BROWSE_STAGES[r.stage].label +
      (r.status === 'queued' ? ' — queued to sync' : ''));
    render();
  }

  async function locate() {
    U.toast('Finding you…');
    const pos = await Native.position();
    if (!pos) { U.toast('No location fix available'); return; }
    S.state.here = pos;
    S.refreshMarkers();
    if (S.state.map) S.state.map.setView([pos.lat, pos.lng], 14);
  }

  function directions(lat, lng) {
    // Hand off to whatever maps app the phone actually uses.
    const url = Native.platform === 'ios'
      ? 'maps://?daddr=' + lat + ',' + lng
      : 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng;
    Native.openExternal(url);
  }

  async function syncNow() {
    U.toast('Syncing…');
    const r = await Data.sync();
    await refresh(true);
    U.toast(r.failed
      ? r.sent + ' sent, ' + r.failed + ' still waiting for signal'
      : (r.sent ? r.sent + ' change' + (r.sent === 1 ? '' : 's') + ' synced' : 'Everything is up to date'));
  }

  /* ── boot ─────────────────────────────────────────────────────── */
  async function boot() {
    if (booted) return;
    booted = true;

    U.Sheet.bindDrag();
    el('hf-sheet-scrim').addEventListener('click', () => U.Sheet.close());
    U.bindPullToRefresh(async () => {
      await refresh(true);
      const r = await Data.sync();
      if (r.sent) U.toast(r.sent + ' change' + (r.sent === 1 ? '' : 's') + ' synced');
    });

    await Native.initChrome();

    // Android back: close the sheet, else step back to Today, else let the OS
    // close the app — the behaviour Android users expect from a real app.
    Native.onBack(() => {
      if (U.Sheet.isOpen()) { U.Sheet.close(); return true; }
      if (Data.session() && tab !== 'today') { go('today'); return true; }
      return false;
    });

    Native.onConnectivity((online) => {
      doc.body.classList.toggle('is-offline', !online);
      if (online) Data.sync().then((r) => { if (r.sent) refresh(true); });
    });
    doc.body.classList.toggle('is-offline', !(await Native.online()));

    Native.onResume(() => {
      Data.sync().then((r) => { if (r.sent) refresh(true); });
    });

    if (Data.session()) {
      S.state.animals = await Data.animals();
      await Data.loadSpots();
      // A last known fix makes distances useful the moment Browse opens.
      Native.position(4000).then((p) => { if (p) { S.state.here = p; } });
    }

    render();
    el('hf-splash').classList.add('hide');
    setTimeout(() => { el('hf-splash').style.display = 'none'; }, 320);
    Native.hideSplash();

    // Anything queued from a previous offline session goes out now.
    Data.sync().then((r) => { if (r.sent) refresh(true); });
  }

  global.HFApp = {
    go, render, refresh, boot,
    doLogin, doDemo, doSignOut,
    openAnimal, openSpot, openEvent, openEventById, openNeed,
    saveHere, collect, removeSpot, advance, locate, directions, syncNow,
    closeSheet: () => U.Sheet.close(),
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
