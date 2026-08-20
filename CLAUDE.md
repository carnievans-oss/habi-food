# Habi-Food — working rules

Habi-Food is a network app for licensed Victorian wildlife carers: it tracks
animals in care, works out what browse (native food) each one needs, remembers
where that food was collected, and warns about burns and clearing works that
change what will be available.

## Repository shape

```
index.html            desktop web app — single file, ~14k lines, vanilla JS + Leaflet + Firebase
habifood*.html        earlier desktop revisions, kept for reference
index-*.html
mobile-dist/          the mobile web build — ALL mobile HTML, CSS and JS
android/              Capacitor Android project (committed; build output is not)
capacitor.config.json webDir points at mobile-dist
scripts/              build and guard scripts
docs/MOBILE.md        the mobile build in full
```

## The one rule that matters

**Desktop layout and mobile layout are isolated.**

- All mobile HTML, CSS and JS goes in `mobile-dist/`. Nothing mobile-specific
  is ever added to `index.html` or any other root page.
- `mobile-dist/` never references a file outside itself.
- Root pages never reference `mobile-dist/`.
- The mobile build is phone-only: single column, bottom tab bar, no desktop
  breakpoints, no three-column grids.

Run `npm run check:isolation` before committing — it enforces all of the above
and fails the build on a violation.

## Working on the mobile app

```bash
npm run mobile:build      # domain data + Tailwind + isolation check
npm run mobile:serve      # preview at localhost:5173 (serves mobile-dist only)
npm run android:sync      # rebuild web assets, then cap sync android
```

**After changing any mobile screen, run `npm run android:sync`** so the Android
project gets the new assets. `npx cap sync android` on its own copies
`mobile-dist/` as it currently sits on disk — sync without rebuilding and the
APK ships stale CSS.

Styling is Tailwind v4 compiled locally into `mobile-dist/css/tailwind.css`.
Never link a Tailwind CDN: the packaged app must render with no network.

### Accessibility rules that must not regress

`npm run check:a11y` (part of `mobile:build`) enforces these; docs/MOBILE.md
explains them.

- Colour comes from the Material 3 role tokens in `css/app.tailwind.css`, in
  both the light and dark blocks. Never hard-code a colour in a component rule
  — the tones are solved for 4.5:1 (text) and 3:1 (boundaries), and a literal
  bypasses the check.
- Font sizes are `rem`, from the `--text-*` scale. Never px, and never below
  `0.75rem` (12sp). `MainActivity` maps the Android system font scale onto the
  WebView, which is what makes rem behave like sp — do not remove it.
- Do not add `user-scalable=no` or `maximum-scale` to the viewport.
- Touch targets are at least 48dp.
- Never let colour be the only carrier of a status: badges take a glyph, map
  markers take a shape, the selected tab takes an indicator and a weight.
- Do not orientation-lock the activity; the layout must work in landscape, on
  a tablet and in split-screen.

## Working on the desktop app

`index.html` is one large file with inline styles and scripts. Match the
surrounding style: terse vanilla JS, no build step, no framework. Keep its
existing responsive rules, but do not add new mobile-specific ones — that work
belongs in `mobile-dist/`.

## Shared data

Species, food lists, browse stages, rescue causes and demo records live in
`index.html` and are generated into `mobile-dist/js/domain.js` by
`npm run mobile:domain`. Edit the constants in `index.html`; never edit
`domain.js` by hand — it is overwritten, and the isolation check fails when it
is stale.

## Data and safety

- Firebase web API keys are public by design; access is enforced by Security
  Rules. Do not treat them as secrets, and do not add real secrets to the repo.
- Never invent numbers. Counts, dates and species facts come from the data —
  the desktop build's own comments are emphatic about this, and the mobile
  build follows it.
- Carer records are personal information under a DEECA permit. Do not add
  logging, analytics or third-party calls that would send record contents
  anywhere.
- Offline honesty: when a write is queued rather than sent, the UI says so.
