/* ═══════════════════════════════════════════════════════════════════
   Habi-Food Mobile — offline-first store

   Carers collect browse in gullies and state forest where there is no signal.
   Every read is served from cache first and every write is recorded locally
   and queued, so the app is fully usable with the radio off and reconciles
   when a bar of reception comes back.

   MOBILE ONLY.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const K = global.HF_CFG.keys;

  function raw(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }

  function put(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      // Quota exhausted (a long field season of runs). Drop the cache — it is
      // rebuildable — and keep session and queue, which are not.
      try {
        localStorage.removeItem(K.cache);
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e2) {
        console.warn('store: write failed', e2);
        return false;
      }
    }
  }

  const Store = {
    /* ── session ─────────────────────────────────────────────────── */
    session() { return raw(K.session, null); },
    setSession(s) { put(K.session, s); },
    clearSession() {
      try { localStorage.removeItem(K.session); } catch (e) {}
    },

    /* ── preferences ─────────────────────────────────────────────── */
    prefs() { return raw(K.prefs, {}); },
    setPref(name, value) {
      const p = Store.prefs();
      p[name] = value;
      put(K.prefs, p);
      return p;
    },

    /* ── cache ───────────────────────────────────────────────────── */
    cacheGet(name) {
      const c = raw(K.cache, {});
      const entry = c[name];
      if (!entry) return null;
      return {
        value: entry.v,
        at: entry.t,
        stale: (Date.now() - entry.t) > global.HF_CFG.cacheTtlMs,
      };
    },

    cacheSet(name, value) {
      const c = raw(K.cache, {});
      c[name] = { v: value, t: Date.now() };
      put(K.cache, c);
      return value;
    },

    cacheClear() {
      try { localStorage.removeItem(K.cache); } catch (e) {}
    },

    /* ── write queue ─────────────────────────────────────────────── */
    /**
     * Record an intended remote write. `op` is {path, method, value} where
     * method is 'set' or 'update'. Writes are keyed by path so a stop marked
     * collected three times queues once, holding the latest value.
     */
    enqueue(op) {
      const q = raw(K.queue, []);
      const idx = q.findIndex((x) => x.path === op.path && x.method === op.method);
      const entry = Object.assign({ at: Date.now() }, op);
      if (idx >= 0) q[idx] = entry; else q.push(entry);
      put(K.queue, q);
      return q.length;
    },

    pending() { return raw(K.queue, []); },
    pendingCount() { return raw(K.queue, []).length; },

    /**
     * Hand each queued write to `send(op)` — an async function that resolves on
     * success and rejects on failure. Entries that fail stay queued for the
     * next attempt; the queue is never dropped on error.
     */
    async flush(send) {
      const q = raw(K.queue, []);
      if (!q.length) return { sent: 0, failed: 0 };
      const kept = [];
      let sent = 0;
      for (const op of q) {
        try {
          await send(op);
          sent++;
        } catch (e) {
          kept.push(op);
        }
      }
      put(K.queue, kept);
      return { sent, failed: kept.length };
    },
  };

  global.HFStore = Store;
})(window);
