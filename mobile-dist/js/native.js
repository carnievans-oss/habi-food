/* ═══════════════════════════════════════════════════════════════════
   Habi-Food Mobile — Capacitor bridge

   Every call degrades to a browser equivalent (or a no-op) when the app is
   served as a web page, so `npm run mobile:serve` behaves the same as the
   installed app minus the platform trimmings. Plugins are addressed through
   Capacitor.Plugins rather than imported, which keeps this a plain script the
   WebView can load with no bundler.

   Optional plugins — install only what you ship:
     npm i @capacitor/status-bar @capacitor/haptics @capacitor/geolocation \
           @capacitor/network @capacitor/app @capacitor/keyboard
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const Cap = global.Capacitor || null;
  const plugins = (Cap && Cap.Plugins) || {};
  const isNative = !!(Cap && typeof Cap.isNativePlatform === 'function' && Cap.isNativePlatform());
  const platform = (Cap && Cap.getPlatform && Cap.getPlatform()) || 'web';

  function has(name) { return !!plugins[name]; }

  const Native = {
    isNative,
    platform,

    /** Tint the status bar to match the app bar; native only. */
    async initChrome() {
      if (!isNative || !has('StatusBar')) return;
      try {
        await plugins.StatusBar.setStyle({ style: 'LIGHT' });
        if (platform === 'android') {
          await plugins.StatusBar.setBackgroundColor({ color: '#1e4d34' });
          await plugins.StatusBar.setOverlaysWebView({ overlay: false });
        }
      } catch (e) { /* a themed bar is a nicety, never a blocker */ }
    },

    /** Hide the native splash once the first screen has painted. */
    async hideSplash() {
      if (!isNative || !has('SplashScreen')) return;
      try { await plugins.SplashScreen.hide(); } catch (e) {}
    },

    /**
     * Light physical feedback on a committing action (marking a stop collected,
     * advancing a stage). Silent on the web — there is no honest equivalent.
     */
    async tap(style) {
      if (!isNative || !has('Haptics')) return;
      try { await plugins.Haptics.impact({ style: style || 'LIGHT' }); } catch (e) {}
    },

    async notify(type) {
      if (!isNative || !has('Haptics')) return;
      try { await plugins.Haptics.notification({ type: type || 'SUCCESS' }); } catch (e) {}
    },

    /**
     * Current position. Uses the Geolocation plugin natively (which routes
     * through the OS permission prompt) and the standard web API otherwise.
     * Resolves to null rather than throwing — a carer with location off should
     * still get the rest of the screen.
     */
    async position(timeoutMs) {
      const timeout = timeoutMs || 8000;
      try {
        if (isNative && has('Geolocation')) {
          const r = await plugins.Geolocation.getCurrentPosition({
            enableHighAccuracy: true, timeout,
          });
          return { lat: r.coords.latitude, lng: r.coords.longitude, accuracy: r.coords.accuracy };
        }
        if (global.navigator && navigator.geolocation) {
          return await new Promise((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (r) => resolve({ lat: r.coords.latitude, lng: r.coords.longitude, accuracy: r.coords.accuracy }),
              () => resolve(null),
              { enableHighAccuracy: true, timeout, maximumAge: 60000 }
            );
          });
        }
      } catch (e) { /* fall through */ }
      return null;
    },

    /** true / false — assume online if nothing can tell us otherwise. */
    async online() {
      try {
        if (isNative && has('Network')) {
          const s = await plugins.Network.getStatus();
          return !!s.connected;
        }
      } catch (e) {}
      return global.navigator ? navigator.onLine !== false : true;
    },

    /** Subscribe to connectivity changes. Returns an unsubscribe function. */
    onConnectivity(fn) {
      if (isNative && has('Network')) {
        let handle;
        plugins.Network.addListener('networkStatusChange', (s) => fn(!!s.connected))
          .then((h) => { handle = h; })
          .catch(() => {});
        return () => { try { handle && handle.remove(); } catch (e) {} };
      }
      const on = () => fn(true);
      const off = () => fn(false);
      global.addEventListener('online', on);
      global.addEventListener('offline', off);
      return () => {
        global.removeEventListener('online', on);
        global.removeEventListener('offline', off);
      };
    },

    /**
     * Android hardware back button. `fn` returns true when it consumed the
     * press; when nothing consumes it at the root screen we exit the app,
     * which is the behaviour Android users expect.
     */
    onBack(fn) {
      if (!isNative || !has('App')) return () => {};
      let handle;
      plugins.App.addListener('backButton', () => {
        const consumed = fn();
        if (!consumed) { try { plugins.App.exitApp(); } catch (e) {} }
      }).then((h) => { handle = h; }).catch(() => {});
      return () => { try { handle && handle.remove(); } catch (e) {} };
    },

    /** Fires when the app returns to the foreground — a good moment to sync. */
    onResume(fn) {
      if (isNative && has('App')) {
        let handle;
        plugins.App.addListener('appStateChange', (s) => { if (s.isActive) fn(); })
          .then((h) => { handle = h; }).catch(() => {});
        return () => { try { handle && handle.remove(); } catch (e) {} };
      }
      const onVis = () => { if (!document.hidden) fn(); };
      document.addEventListener('visibilitychange', onVis);
      return () => document.removeEventListener('visibilitychange', onVis);
    },

    /** Open a URL outside the app (maps, tel:, agency pages). */
    async openExternal(url) {
      try {
        if (isNative && has('Browser') && /^https?:/i.test(url)) {
          await plugins.Browser.open({ url });
          return;
        }
      } catch (e) {}
      global.open(url, '_blank', 'noopener');
    },
  };

  global.HFNative = Native;
})(window);
