/* ═══════════════════════════════════════════════════════════════════
   Habi-Food Mobile — data layer

   Talks to the same Firebase project and the same record shapes as the desktop
   build, but with mobile's own access pattern: cache first, network second,
   queued writes. Screens never touch Firebase directly — they call HFData and
   get plain objects back whether the answer came from the network, the cache,
   or demo data.

   MOBILE ONLY.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const CFG = global.HF_CFG;
  const Store = global.HFStore;
  const D = global.HF_DOMAIN;

  let db = null;
  let authReady = null;

  /* ── Firebase, lazily and defensively ─────────────────────────── */
  function firebaseReady() {
    if (db) return true;
    if (typeof global.firebase === 'undefined' || !global.firebase.database) return false;
    try {
      if (!global.firebase.apps.length) global.firebase.initializeApp(CFG.firebase);
      db = global.firebase.database();
      // Security Rules require auth != null, so sign in anonymously before any
      // read. Failure is recorded, not thrown — the app continues on cache.
      if (!authReady && global.firebase.auth) {
        authReady = global.firebase.auth().signInAnonymously()
          .then(() => true)
          .catch((e) => { console.warn('anon auth:', e.message); return false; });
      }
      return true;
    } catch (e) {
      console.warn('firebase init:', e.message);
      return false;
    }
  }

  async function ref(path) {
    if (!firebaseReady()) throw new Error('offline');
    if (authReady) await authReady;
    return db.ref(path);
  }

  async function readPath(path) {
    const r = await ref(path);
    const snap = await r.once('value');
    return snap.val();
  }

  /**
   * Apply a write locally, then send it — or queue it if the send fails.
   * Returns 'sent' or 'queued' so the UI can tell the carer which happened
   * rather than pretending everything reached the network.
   */
  async function write(path, value, method) {
    const op = { path, value, method: method || 'set' };
    if (session() && session().demo) return 'local';
    try {
      const r = await ref(path);
      await (op.method === 'update' ? r.update(value) : r.set(value));
      return 'sent';
    } catch (e) {
      Store.enqueue(op);
      return 'queued';
    }
  }

  /* ── session ──────────────────────────────────────────────────── */
  function session() { return Store.session(); }

  async function signInDemo() {
    Store.setSession({
      name: 'Demo Carer',
      org: 'Habi-Food Demo Shelter',
      licence: 'DEMO',
      region: 'Yarra Ranges',
      role: 'carer',
      demo: true,
      since: new Date().toISOString(),
    });
    Store.cacheClear();
    Store.cacheSet('animals', JSON.parse(JSON.stringify(D.DEMO_ANIMALS)));
    return session();
  }

  /**
   * Access-code sign-in, mirroring the desktop redemption flow:
   * validate the code, confirm the licence sits in approved_users, check permit
   * status and expiry, then burn the code. Errors are phrased for a carer in a
   * paddock, not for a console.
   */
  async function signInWithCode(name, licence, code) {
    if (!name || !licence || !code) throw new Error('Enter your name, licence number and access code.');
    licence = licence.trim();
    code = code.trim();

    if (!firebaseReady()) {
      throw new Error('No connection to the network right now. You can use Demo mode offline, or try again once you have signal.');
    }
    const ok = await authReady;
    if (ok === false) {
      throw new Error('Could not verify this device with the network. Try again shortly, or contact the administrator if it keeps happening.');
    }

    const codeData = await readPath('access_codes/' + code);
    if (!codeData) throw new Error('Access code not found. Check you copied it exactly, with no extra spaces.');
    if (codeData.used) throw new Error('This access code has already been used. Contact the administrator for a new one.');
    if (codeData.licence && codeData.licence.trim().toLowerCase() !== licence.toLowerCase()) {
      throw new Error('This access code was issued for a different licence number.');
    }

    const r = await ref('approved_users');
    const snap = await r.orderByChild('licence').equalTo(licence).once('value');
    const approved = snap.val();
    if (!approved) throw new Error('Licence number not found in the approved network. Check it matches your application exactly.');

    const userId = Object.keys(approved)[0];
    const user = approved[userId];

    if (user.status === 'revoked') throw new Error('Your access has been removed. Contact DEECA Wildlife Licensing.');
    if (user.status === 'pending_revocation') throw new Error('Your permit is under review. Sign in on the desktop site to export your records.');
    if (user.expiry && new Date(user.expiry) < new Date()) {
      throw new Error('Your permit expired on ' + new Date(user.expiry).toLocaleDateString('en-AU') + '. Contact DEECA to renew.');
    }

    // Past every failure path — only now is the code spent. These go straight
    // to the database rather than through write(): write() consults the current
    // session, and at this moment that is still the previous one (possibly a
    // demo session), which would send the redemption to the local queue and
    // leave the code unspent on the network.
    const now = new Date().toISOString();
    await (await ref('access_codes/' + code)).update({ used: true, usedAt: now });
    await (await ref('approved_users/' + userId + '/lastLogin')).set(now);

    Store.setSession({
      name: name.trim(),
      org: user.org || '',
      licence: licence,
      region: user.region || '',
      role: user.role || 'carer',
      userId: userId,
      demo: false,
      since: new Date().toISOString(),
    });
    Store.cacheClear();
    return session();
  }

  function signOut() {
    Store.clearSession();
    Store.cacheClear();
  }

  /* ── animals ──────────────────────────────────────────────────── */
  /**
   * Cache-first read of this carer's animals. Returns immediately from cache
   * when there is one; `opts.force` waits for the network instead.
   */
  async function animals(opts) {
    opts = opts || {};
    const s = session();
    if (!s) return {};
    if (s.demo) {
      const cached = Store.cacheGet('animals');
      return (cached && cached.value) || JSON.parse(JSON.stringify(D.DEMO_ANIMALS));
    }

    const cached = Store.cacheGet('animals');
    if (cached && !opts.force && !cached.stale) return cached.value;

    try {
      const val = await readPath('animals/' + s.licence);
      return Store.cacheSet('animals', val || {});
    } catch (e) {
      if (cached) return cached.value;      // stale beats empty in the field
      return {};
    }
  }

  function list(map) {
    return Object.values(map || {}).filter(Boolean);
  }

  function inCare(map) { return list(map).filter((a) => a.status === 'in_care'); }
  function released(map) { return list(map).filter((a) => a.status === 'released'); }

  function speciesOf(a) {
    return (D.SPM && D.SPM[a.species]) || { name: a.species || 'Unknown', color: '#5f7a66' };
  }

  function stageOf(a) {
    const key = a.browseStage || 'formula';
    return Object.assign({ key: key }, D.BROWSE_STAGES[key] || D.BROWSE_STAGES.formula);
  }

  /**
   * Some species' `needs` entries are stored as a JSON-encoded array string
   * rather than an array (an upstream quirk in index.html). Normalise both.
   */
  function needList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [value];
      } catch (e) {
        return [value];
      }
    }
    return [];
  }

  /**
   * What has to be cut today, aggregated across every animal in care.
   * One row per plant item, carrying the animals that need it — which is how a
   * carer actually works: one trip, one list, not one list per animal.
   */
  function browseList(map) {
    const rows = new Map();
    inCare(map).forEach((a) => {
      const stage = stageOf(a);
      const needs = needList((stage.needs || {})[a.species]);
      needs.forEach((item) => {
        const key = item.trim();
        if (!rows.has(key)) rows.set(key, { item: key, animals: [], stages: new Set() });
        const row = rows.get(key);
        row.animals.push({
          id: a.id,
          ref: a.animalRef || a.id,
          species: speciesOf(a).name,
          color: speciesOf(a).color,
        });
        row.stages.add(stage.label);
      });
    });
    return Array.from(rows.values())
      .map((r) => ({ item: r.item, animals: r.animals, stages: Array.from(r.stages) }))
      .sort((a, b) => b.animals.length - a.animals.length || a.item.localeCompare(b.item));
  }

  /** Advance an animal to the next browse stage. */
  async function advanceStage(id, map) {
    const a = (map || {})[id];
    if (!a) throw new Error('Animal not found');
    const idx = D.STAGE_ORDER.indexOf(a.browseStage || 'formula');
    const next = idx >= 0 && idx < D.STAGE_ORDER.length - 1 ? D.STAGE_ORDER[idx + 1] : null;
    if (!next) return { changed: false, stage: a.browseStage };

    a.browseStage = next;
    Store.cacheSet('animals', map);
    const s = session();
    const status = s.demo ? 'local'
      : await write('animals/' + s.licence + '/' + id + '/browseStage', next);
    return { changed: true, stage: next, status: status };
  }

  /* ── browse spots ─────────────────────────────────────────────── */
  function spots() {
    const cached = Store.cacheGet('spots');
    return (cached && cached.value) || {};
  }

  function spotList() {
    return Object.values(spots()).filter((s) => s && !s.hidden);
  }

  async function loadSpots(opts) {
    const s = session();
    if (!s || s.demo) return spots();
    const cached = Store.cacheGet('spots');
    if (cached && !(opts || {}).force && !cached.stale) return cached.value;
    try {
      const val = await readPath('browse_spots/' + s.licence);
      return Store.cacheSet('spots', val || {});
    } catch (e) {
      return (cached && cached.value) || {};
    }
  }

  async function saveSpot(spot) {
    const s = session();
    const id = spot.id || ('spot_' + Date.now());
    const record = {
      id: id,
      lat: spot.lat,
      lng: spot.lng,
      address: spot.address || (Number(spot.lat).toFixed(5) + ', ' + Number(spot.lng).toFixed(5)),
      speciesList: spot.speciesList || [],
      notes: spot.notes || '',
      saved: spot.saved || new Date().toISOString(),
      lastCollected: spot.lastCollected || null,
      hidden: false,
      source: 'mobile',
    };
    const all = spots();
    all[id] = record;
    Store.cacheSet('spots', all);
    const status = s.demo ? 'local' : await write('browse_spots/' + s.licence + '/' + id, record);
    return { spot: record, status: status };
  }

  async function markCollected(id) {
    const all = spots();
    const spot = all[id];
    if (!spot) throw new Error('Spot not found');
    spot.lastCollected = new Date().toISOString();
    Store.cacheSet('spots', all);
    const s = session();
    const status = s.demo ? 'local'
      : await write('browse_spots/' + s.licence + '/' + id + '/lastCollected', spot.lastCollected);
    return { spot: spot, status: status };
  }

  async function hideSpot(id) {
    const all = spots();
    if (!all[id]) return;
    all[id].hidden = true;
    Store.cacheSet('spots', all);
    const s = session();
    if (!s.demo) await write('browse_spots/' + s.licence + '/' + id + '/hidden', true);
  }

  /* ── operational events ───────────────────────────────────────── */
  /** Burns, clearing and works, with days-out computed live (never stored). */
  function events() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return (D.DEMO_OPS_EVENTS || []).map((e) => {
      const when = new Date(e.date + 'T00:00:00');
      const daysOut = Math.round((when - today) / 86400000);
      return Object.assign({}, e, {
        daysOut: daysOut,
        when: when,
        past: daysOut < 0,
      });
    }).sort((a, b) => a.daysOut - b.daysOut);
  }

  function upcoming(days) {
    const limit = days == null ? 21 : days;
    return events().filter((e) => e.daysOut >= 0 && e.daysOut <= limit);
  }

  /* ── alerts ───────────────────────────────────────────────────── */
  /**
   * Everything that wants the carer's attention, newest concern first:
   * missing animals posted to the network, then high-impact works close enough
   * to change what gets collected this week.
   */
  function alerts(map) {
    const out = [];
    list(map).forEach((a) => {
      if (a.alert && a.alert.active) {
        out.push({
          kind: 'animal',
          severity: 'alert',
          title: (speciesOf(a).name) + ' — ' + (a.animalRef || a.id),
          body: a.alert.message || '',
          meta: a.alert.contact || '',
          at: a.alert.posted_at || null,
          animalId: a.id,
        });
      }
    });
    upcoming(14).forEach((e) => {
      if (e.impact !== 'high') return;
      out.push({
        kind: 'event',
        severity: e.daysOut <= 7 ? 'alert' : 'warn',
        title: e.title,
        body: e.location || '',
        meta: e.daysOut === 0 ? 'Today' : ('In ' + e.daysOut + ' day' + (e.daysOut === 1 ? '' : 's')),
        at: e.date,
        event: e,
      });
    });
    return out;
  }

  /* ── sync ─────────────────────────────────────────────────────── */
  /** Push anything queued while offline. Safe to call often. */
  async function sync() {
    const s = session();
    if (!s || s.demo) return { sent: 0, failed: 0 };
    if (!firebaseReady()) return { sent: 0, failed: Store.pendingCount() };
    return Store.flush(async (op) => {
      const r = await ref(op.path);
      if (op.method === 'update') await r.update(op.value);
      else await r.set(op.value);
    });
  }

  global.HFData = {
    session, signInDemo, signInWithCode, signOut,
    animals, list, inCare, released, speciesOf, stageOf, needList,
    browseList, advanceStage,
    spots, spotList, loadSpots, saveSpot, markCollected, hideSpot,
    events, upcoming, alerts, sync,
    pendingCount: () => Store.pendingCount(),
  };
})(window);
