# Habi-Food — mobile build

The repository carries two separate front ends. They share a Firebase project
and a set of facts about wildlife; they share no layout code at all.

| | Desktop | Mobile |
|---|---|---|
| Entry point | `index.html` (repo root) | `mobile-dist/index.html` |
| Styles | inline `<style>` in `index.html` | `mobile-dist/css/` |
| Scripts | inline `<script>` in `index.html` | `mobile-dist/js/` |
| Layout | rail + panels + map, multi-column | single column, bottom tab bar |
| Shipped as | Netlify site at `/` | Netlify at `/m/`, Android app via Capacitor |

## The boundary

**All mobile HTML, CSS and JS goes in `mobile-dist/`. Nothing else does.**

Concretely:

1. Never add a mobile breakpoint, `@media (max-width: …)` rule, or phone-only
   markup to `index.html` or any other root page. The desktop build keeps the
   responsive rules it already has; it does not gain new ones.
2. Never reference a root file from inside `mobile-dist/`. No `../index.html`,
   no shared stylesheet, no copied-in desktop component. Everything the mobile
   app loads is either inside `mobile-dist/` or a CDN URL.
3. Never reference `mobile-dist/` from a root page.
4. The mobile build is phone-only. No desktop breakpoints (`min-width` ≥ 900px),
   no three-column grids. Paired stat tiles are the widest thing on a screen.

`npm run check:isolation` enforces all four, plus the freshness of generated
data and the existence of every asset `index.html` links. Run it before you
commit; `npm run mobile:build` runs it for you.

## What is shared, and how

Domain data — species, food lists, browse stages, rescue causes, demo records
— has one source of truth: the constants inside `index.html`. Duplicating a
700-line species table by hand would guarantee the two builds eventually
disagree about what a koala eats, so it is generated instead:

```bash
npm run mobile:domain     # index.html → mobile-dist/js/domain.js
```

`mobile-dist/js/domain.js` is generated output. Never edit it — edit the
constants in `index.html` and regenerate. The isolation check fails if the
generated file is stale.

## Layout

Everything is one column in one scroll region, with five destinations in a
bottom tab bar:

| Tab | What it is for |
|---|---|
| Today | Greeting, counts, today's cut list, the next thing happening in the landscape |
| Browse | The aggregated cut list, saved collection spots sorted by distance, "save this spot" |
| Map | Saved spots, release sites and rescue locations on one touch map |
| Alerts | Missing animals and scheduled works that change what gets collected |
| More | Animals in care, account, sync state, sign out |

Detail opens in a drag-dismissible bottom sheet, never a new page. Every
tappable control is at least 44 px tall. Text inputs are 16 px so iOS does not
zoom on focus. `viewport-fit=cover` plus the safe-area insets in
`css/native.css` keep content clear of the notch and the home indicator.

### Styling

Tailwind CSS v4, compiled locally — never a CDN, because the packaged app has
to render with no network:

```bash
npm run mobile:css        # one-off build
npm run mobile:watch      # rebuild on change
```

`css/app.tailwind.css` is the input (design tokens plus the component layer);
`css/tailwind.css` is the committed output the page links. `css/native.css`
holds what utilities cannot express: safe areas, sheet physics, momentum
scrolling, tab bar chrome.

## Offline behaviour

Carers work where there is no signal, so the mobile build is offline-first:

- Reads are served from a local cache first and refreshed in the background.
- Writes apply locally straight away, then send. If the send fails they are
  queued in `localStorage` and flushed on reconnect, on resume, on pull-to-
  refresh, or from **More → Sync now**.
- The UI says which happened — "Spot saved" versus "saved on this device, will
  sync when you have signal". It never claims a write reached the network when
  it did not.
- Leaflet is vendored into `mobile-dist/vendor/`, so the map control loads
  offline even though tiles need a connection.

## Local development

```bash
npm install
npm run mobile:build      # domain data + CSS + isolation check
npm run mobile:serve      # http://localhost:5173
```

The dev server serves `mobile-dist/` **only** — if a mobile screen ever depends
on a desktop file, it breaks here rather than in the field. Use the browser's
device toolbar for a true preview.

## Android (Capacitor)

The project is already initialised (`capacitor.config.json`, `webDir:
mobile-dist`) and the Android platform is committed under `android/`.

```bash
npm install                 # once
npm run android:sync        # rebuild the web assets, then `cap sync android`
npm run android:open        # opens Android Studio
```

**After any change to a mobile screen, run `npm run android:sync`** (which is
`npm run mobile:build && npx cap sync android`). Building the web assets first
matters: `cap sync` copies `mobile-dist/` as it finds it, so syncing without
rebuilding ships stale CSS or stale domain data into the APK.

Then in Android Studio: **Build → Generate Signed Bundle / APK → Android App
Bundle** to produce the `.aab` for the Play Store. Signing keys are yours to
create and keep out of the repository — `*.keystore` and `*.jks` are ignored.

Configured for the app already:

- App ID `au.com.habifood.app`, name **Habi-Food**, portrait-locked.
- Permissions: `INTERNET`, `ACCESS_FINE_LOCATION` / `ACCESS_COARSE_LOCATION`
  (saving a browse spot), `ACCESS_NETWORK_STATE` (the offline banner). GPS is
  declared `required="false"` — the app is fully usable without a fix.
- Plugins wired through `js/native.js`: App, Browser, Geolocation, Haptics,
  Keyboard, Network, SplashScreen, StatusBar. Every call degrades to a browser
  equivalent, so the same code runs on the web.

### iOS

Not added. When you want it: `npm run ios:add && npm run ios:sync` on a Mac
with Xcode. `js/native.js` and the safe-area CSS already handle iOS.

## Firebase

The mobile app talks to the **same** Firebase project as the desktop build
(`habifood-network`), through the Firebase JS SDK loaded in `index.html`. That
works inside the Capacitor WebView today — no extra registration needed, and no
`google-services.json` required, because nothing here uses a native Firebase
SDK.

Two things to do in the Firebase console before the Android build is used in
anger:

1. **Authorised domains.** Firebase Auth checks the origin. A Capacitor WebView
   is `https://localhost` on Android and `capacitor://localhost` on iOS, not
   your web domain. Add both under **Authentication → Settings → Authorised
   domains**, or anonymous sign-in fails on device while working fine on the
   web.
2. **Register the Android app** — only needed if you later add native Firebase
   features (push notifications, Crashlytics, Analytics). **Project settings →
   Add app → Android**, package name `au.com.habifood.app`, then drop the
   generated `google-services.json` into `android/app/` and add the
   `google-services` Gradle plugin. Skip this entirely while the app uses the
   JS SDK only.

Security rules are unchanged: the app signs in anonymously and reads
`animals/{licence}`, `browse_spots/{licence}`, `access_codes/{code}` and
`approved_users` exactly as the desktop build does.
