/* ═══════════════════════════════════════════════════════════════════
   Habi-Food Mobile — configuration

   MOBILE ONLY. Never linked from the desktop build at the repo root.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  global.HF_CFG = {
    appName: 'Habi-Food',
    build: 'mobile',
    version: '1.0.0',

    // Firebase web API keys are safe to embed publicly — access is enforced by
    // Firebase Security Rules, not by keeping the key secret. Same project as
    // the desktop build so a carer sees the same records on both.
    firebase: {
      apiKey: 'AIzaSyB7kQy3ZaDV-aXLiTsKL6qydf9said7yRs',
      authDomain: 'habifood-network.firebaseapp.com',
      databaseURL: 'https://habifood-network-default-rtdb.asia-southeast1.firebasedatabase.app',
      projectId: 'habifood-network',
      storageBucket: 'habifood-network.firebasestorage.app',
      messagingSenderId: '305811242876',
      appId: '1:305811242876:web:d01f941578b386dbeaeef9',
    },

    // localStorage keys. Deliberately prefixed hfm_ (not the desktop's wc_/hf_)
    // so the two builds cannot corrupt each other's state when both are open
    // against the same origin.
    keys: {
      session: 'hfm_session',
      cache: 'hfm_cache',
      queue: 'hfm_queue',
      prefs: 'hfm_prefs',
    },

    map: {
      center: [-37.84, 145.24],   // Melbourne's east — the demo shelter's patch
      zoom: 10,
      maxZoom: 18,
      tiles: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    },

    // How long cached network data is treated as fresh before a background
    // refresh is attempted. Field work happens on bad signal — stale data beats
    // a spinner.
    cacheTtlMs: 10 * 60 * 1000,
  };
})(window);
