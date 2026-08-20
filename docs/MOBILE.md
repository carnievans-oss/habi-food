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
4. The mobile build stays single-column on every form factor. No desktop
   breakpoints (`min-width` ≥ 900px), no three-column grids. Paired stat tiles
   are the widest thing on a screen; on a wide window the column centres at a
   readable measure rather than growing new columns.

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
tappable control is at least 48 dp. Text inputs are 16 sp so iOS does not zoom
on focus. `viewport-fit=cover` plus the safe-area insets in `css/native.css`
keep content clear of the notch and the home indicator. See *Accessibility and
core app quality* below for the rest.

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

## Accessibility and core app quality

The mobile build is held to the Android core app quality guidelines and to
Material's vision-accessibility guidance. `npm run check:a11y` enforces the
measurable parts and runs as part of `npm run mobile:build`.

### Colour

Colour is expressed as Material 3 role tokens (`primary`, `on-surface`,
`outline`, …) over an eucalyptus tonal palette, in `css/app.tailwind.css`.
Every tone was **solved for its target**, not picked by eye:

| Role | Target | Light | Dark |
|---|---|---|---|
| body text on surface | 4.5:1 | 15.9:1 | 14.6:1 |
| secondary text on page | 4.5:1 | 4.8:1 | 10.1:1 |
| accent / heading | 4.5:1 | 8.7:1 | 10.2:1 |
| every status badge on its container | 4.5:1 | 4.5–7.7:1 | 5.2–6.6:1 |
| `outline` — component boundaries | 3:1 | 3.4:1 | 3.8:1 |
| map marker fills on map ground | 3:1 | 4.2–7.1:1 | 6.8–7.4:1 |

`outline-variant` is the one tone deliberately below 3:1. Material defines it
as the divider used *inside* a component whose own edge already meets 3:1 — it
separates rows, it does not delimit a control. The check prints it as an
explicit exemption rather than skipping it silently.

Both schemes are checked. The Android WebView follows the system setting, so
dark mode is a token swap: no component rule knows which theme it is in.

### Text sizing

Every size is in `rem` and comes from the scale in `css/app.tailwind.css`
(`--text-label-sm` … `--text-display`). **0.75rem = 12sp is the floor** and
nothing is smaller, tab labels and captions included.

`rem` only behaves like `sp` if the root font size follows the platform text
setting. A WebView does not do that on its own — its `textZoom` stays at 100
regardless of Settings → Display → Font size — so `MainActivity` copies the
system `fontScale` onto the WebView and re-applies it on configuration change.
Without that one method the entire scale is just pixels.

The layout is verified at 100%, 150% and 200% text: no clipping, no horizontal
overflow, every target still ≥ 48dp. Two things had to give at 200%:

- tab labels ellipsise rather than pushing the fifth tab off-screen (the full
  name stays in `aria-label`);
- the tab icons and the bar heights stop growing at a cap, because an icon is
  not what a low-vision user is trying to read — the label is, and it keeps
  scaling.

Zoom is **not** blocked. `user-scalable=no` would deny a low-vision carer the
last resort of pinching in, and there is no reason to: the layout reflows.

### Not colour alone

Every status distinction carries a second signal:

- badges lead with a glyph — ● ok, ▲ warning, ■ alert, ◆ info, ○ neutral;
- map markers differ by **shape** as well as tone — circle for a browse spot,
  diamond for a release site, triangle for a rescue — and the legend repeats
  the shape;
- the selected tab is marked by an indicator behind the icon (with a 3:1 edge),
  a heavier label, *and* the primary tone;
- the alert badge dot is reinforcement; the count is in the tab's accessible
  name;
- links are underlined as well as coloured.

### Adaptive layout

The app is single-column on every form factor — a phone layout stretched into
three columns on a tablet is not a tablet layout — but the column stops at a
readable measure (`--measure`, 34rem) and centres. That keeps line length in
Material's 45–75 character band in landscape, on a tablet, on an unfolded
foldable, and in a desktop window, instead of running text to 120 characters.

The activity is **not** orientation-locked (`resizeableActivity="true"`, no
`screenOrientation`), so the app fills the window in both orientations and in
split-screen. `configChanges` covers orientation, size and fold, so rotating
does not recreate the activity or lose state. Verified in portrait, landscape
and at tablet size.

### Other core-quality items addressed

- **State preservation** — the active tab, session, cached records and the
  queued-write list all survive relaunch and process death.
- **Back navigation** — the Android back button and the back gesture close the
  sheet, then step back to Today, then exit. `enableOnBackInvokedCallback` is
  on for predictive back.
- **Permission rationale** — the app explains why it wants a location, in a
  sheet, at the moment the carer taps "Save this spot", and only if permission
  has not already been granted. Declining leaves the rest of the app working.
- **Minimal permissions** — `INTERNET`, location, `ACCESS_NETWORK_STATE`. GPS
  is declared `required="false"`.
- **Autofill** — the sign-in fields carry `autocomplete` hints and `inputmode`.
- **Reduced motion** — `prefers-reduced-motion` collapses every transition.
- **Forced colours** — high-contrast mode keeps the boundaries that carry
  meaning.
- **Startup** — a splash is shown until the first screen paints, well inside
  the two-second guidance.
- **SDK** — `compileSdk` and `targetSdk` are 36; `minSdk` 24.

### Security notes for the Android shell

- **Cleartext traffic is disabled** by `res/xml/network_security_config.xml`.
  Every endpoint (Firebase, OSM tiles) is HTTPS, so an accidental `http://` URL
  fails loudly instead of quietly leaking a carer record.
- **Exported components** — only `MainActivity` is exported, and only for
  MAIN/LAUNCHER. It declares no deep links or custom schemes, so no external
  app can hand it data. The FileProvider is `exported="false"`.
- **FileProvider scope** — Capacitor's template grants `<external-path path="."/>`,
  the whole external storage root. The app shares no files, so the grant is
  narrowed to one cache subdirectory it owns.
- **Outbound intents** — external links go through the Browser plugin; the only
  intent built from data is the directions URL, whose latitude and longitude are
  numbers taken from a saved spot, never free text.
- **WebView** — no `addJavaScriptInterface`, no
  `setAllowUniversalAccessFromFileURLs`, and no `allowNavigation` entries, so
  the WebView stays on its own origin.

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
npm run mobile:build      # domain data + CSS + isolation check + a11y check
npm run mobile:serve      # http://localhost:5173
npm run check:a11y        # contrast and type-scale targets, both themes
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

- App ID `au.com.habifood.app`, name **Habi-Food**. Not orientation-locked —
  see *Adaptive layout* above.
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
