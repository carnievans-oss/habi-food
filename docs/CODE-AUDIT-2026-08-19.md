# Habi-Food — Code Audit

**Date:** 19 August 2026
**Scope reviewed:** `habifood_v51_19Aug2026` build (`index.html`, 23,618 lines; `conditions.html`; `privacy.html`), plus the state of this repository.
**Method:** full read of the auth/admin, release-assessment, Firebase persistence and SOS subsystems; static sweeps for dead code, shadowed definitions, duplicate DOM ids, unwritten Firebase paths, and unescaped `innerHTML` sinks. Findings were traced to the dated fix comments the codebase carries in place of an external tracker.

> **Important:** the v5.1 build is **not in this repository.** `main`'s `index.html` is 14,227 lines; the reviewed build is 23,618. Line numbers below refer to the v5.1 upload. Where a finding also exists in the committed `index.html`, it is noted.

---

## Severity summary

| # | Finding | Severity |
|---|---|---|
| A1 | Admin PIN check accepts the stored hash itself as a valid PIN | **Critical** |
| A2 | Client self-grants `admin_uids` — privilege escalation | **Critical** |
| A3 | Legacy `btoa()` PINs still accepted, and recoverable by any user | **High** |
| A4 | Stored XSS from applicant/feedback data into the admin panel | **High** |
| B1 | Release-site score denominator (133) exceeds achievable total (123) | **High** |
| B2 | Licence numbers containing `/` are concatenated raw into Firebase paths | **High** |
| A5 | `demoOk = pin==='1234'` opens the admin panel unconditionally | Medium |
| A6 | No SRI on third-party scripts; no CSP | Medium |
| A7 | `password === '1234'` silently diverts a real login into demo mode | Medium |
| A9 | Sign-out clears 5 of 34 `localStorage` keys — including leaving the admin PIN hash | Medium |
| B3 | Admin "Platform Diagnostics" reads Firebase paths nothing ever writes | Medium |
| B4 | Release-site assessments are localStorage-only — no cross-device durability | Medium |
| B5 | `sendSOS()` is permanently shadowed and writes an incompatible record shape | Medium |
| B6 | Duplicate live `id="admin-content"` | Medium |
| A8 | `eval()` used to resolve a layer-group variable | Low |
| B7 | 24 defined-but-never-called functions | Low |
| C1–C5 | Repository hygiene: stale build, ~24 MB of duplicate HTML, deleted CI, stale docs | Medium |

---

## A. Security

### A1 — Admin PIN check accepts the stored hash itself as a valid PIN — **Critical**

Both admin gates compute:

```js
const hashOk   = storedHash && (newHash === storedHash);
const legacyOk = storedHash && (btoa(pin) === storedHash);
const rawOk    = storedHash && (pin === storedHash);   // ← accepts the hash as the PIN
```

`index.html:17855` (`checkAdminPin`) and `index.html:21689` (`_verifyAdminGatePin`). Also present in the committed build at `index.html:12481`.

`rawOk` means *whoever can read the stored hash can authenticate by pasting it verbatim.* The hash is not hard to read — line 9229 loads it into a global on every launch, for every session:

```js
db.ref('config/adminPin').once('value', snap => { if (snap.val()) adminPinHash = snap.val(); });
```

So any signed-in carer opens devtools, reads `adminPinHash`, pastes it into the PIN box, and passes. It also chains with A9: the hash is left in `localStorage.wc_admin_pin_hash` after sign-out, so on a shared shelter computer the next user can read it with no Firebase access at all.

**Fix:** delete the `rawOk` branch in both gates. There is no legitimate case where the stored hash is also a valid input. Separately, `config/adminPin` should not be world-readable — restrict it in the security rules and drop the line 9229 preload (the gate already fetches it on demand at 17839).

---

### A2 — Client self-grants `admin_uids` — **Critical**

On every successful PIN entry:

```js
if (!demoOk && authUser && db) {
  try { await db.ref('admin_uids/' + authUser.uid).set(true); }
  catch (e) { console.warn('admin_uids self-heal failed:', e.message); }
}
```

`index.html:17887` and `21695`.

The comment above it explains the reasoning, and states plainly that the rules were written to allow it:

> *"The security rules ALREADY permit a signed-in user to write true to their OWN `admin_uids/{their own uid}` entry … this exists precisely to allow this kind of bootstrap."*

That is the vulnerability, not the workaround. If the rule permits a user to set their own admin flag, **the PIN is not a security boundary at all** — any signed-in carer can run one line in the console and become an admin, without ever seeing the PIN dialog:

```js
firebase.database().ref('admin_uids/' + firebase.auth().currentUser.uid).set(true)
```

Admin then unlocks the applicant register (names, licence numbers, phone numbers, email addresses), revocation, user deletion, and `config` writes.

**Fix, in order:**
1. Change the rule so `admin_uids/$uid` is writable **only** by an existing admin — never by `$uid` itself.
2. Remove the self-heal from the client.
3. Bootstrap and repair admin UIDs from the Firebase console or a Cloud Function.
4. Audit the current contents of `admin_uids` against the intended admin list.

The original problem this was working around (an admin whose UID changed after a password reset became permanently locked out) is real and worth solving — but with an admin-issued recovery path, not a client-side write.

---

### A3 — Legacy `btoa()` PINs still accepted, and recoverable — **High**

```js
const legacyOk = storedHash && (btoa(pin) === storedHash);
```

`btoa()` is base64 encoding, not hashing. Any account still on a legacy value has its PIN recoverable in one call — `atob(adminPinHash)` — by anyone who can read the global from A1.

The upgrade path only fires when someone signs in with the legacy PIN (`index.html:17898`), so a dormant admin account keeps a plaintext-equivalent PIN indefinitely.

**Fix:** drop `legacyOk`. Sweep `config/adminPin` and any `wc_admin_pin_hash` for values that base64-decode to printable ASCII, and force those admins through a PIN reset.

---

### A4 — Stored XSS from applicant and feedback data into the admin panel — **High**

Applicant-controlled strings reach the admin panel through `innerHTML` with no escaping, in both text and attribute position:

| Location | Fields |
|---|---|
| `index.html:18347–18361` (pending applications) | `a.name`, `a.org`, `a.licence`, `a.authority`, `a.expiry`, `a.species`, `a.phone`, `a.email` |
| `index.html:18396–18430` (approved carers) | `u.name`, `u.org`, `u.licence`, `u.species`, `u.revocationReason` — plus `onclick="adminRevoke('${uid}','${u.name}','${u.licence}')"` |
| `index.html:18453` (feedback) | `f.category`, `f.name`, `f.message`, `f.email`, `f.region` |
| `index.html:18440` and `9218–9225` (presence) | `p.name` / `c.name`, `p.region` / `c.region` |

`submitApplication()` writes every one of these fields straight from an unauthenticated public form (`submitApplication()`, `index.html:5305`) into `applications/`. So an attacker submits an application whose "Organisation" is a `<img src=x onerror=…>` payload, and it executes in the admin's browser the moment the admin opens the panel to review it. Combined with A2, that is a full database takeover from a public form.

Two partial mitigations exist and neither is sufficient:
- `${u.name.replace(/'/g,'')}` at one call site only — and it throws `TypeError` if `u.name` is undefined;
- `${(u.name||'').replace(/'/g,'\`')}` at `index.html:22069` — swapping quotes for backticks does not neutralise `"`, `<`, or `>`.

The codebase already contains a correct escaper — `index.html:23082`:

```js
function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
```

but it is scoped inside the SOS IIFE and used only by the SOS banner, which is the newest module. The older admin code never got it.

**Fix:** promote `esc()` to a global helper and apply it at all sites above. For the `onclick` handlers, prefer moving the id to a `data-` attribute with a delegated listener rather than escaping into a string literal.

---

### A5 — `demoOk = pin === '1234'` opens the admin panel unconditionally — Medium

`index.html:17847`:

```js
const demoOk = pin === '1234';
```

Anyone reaching the admin modal — including an anonymous session on the public page — can type `1234` and open the admin UI. Writes still fail against the rules, but the panel *reads* on open: `loadAdminContent()` pulls `applications`, `approved_users`, `presence` and `feedback`. If any of those is readable to `auth != null` (which the anonymous sign-in at page load satisfies), the panel renders the full applicant register — names, licence numbers, phone numbers, email addresses.

The newer gate gets this right at `index.html:21690`: `const demoOk = (pin==='1234' && isDemo);`

**Fix:** apply the same `&& isDemo` guard at 17847, and confirm the read rules on `applications` / `approved_users` / `feedback` require `admin_uids`, not just `auth != null`.

---

### A6 — No Subresource Integrity, no CSP — Medium

Seven third-party scripts load with no `integrity` attribute (`index.html:12–18`): Leaflet, markercluster and leaflet.heat from cdnjs, Chart.js from jsDelivr, and three Firebase compat bundles from gstatic. `grep -c integrity=` returns 0.

`netlify.toml` sets `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`, but no `Content-Security-Policy`, and there is no CSP `<meta>` in the document.

For an application handling wildlife-permit PII and admin credentials, a compromised or hijacked CDN path is a full compromise with no defence in depth.

**Fix:** add `integrity` + `crossorigin="anonymous"` to the pinned cdnjs and jsDelivr tags, and add a CSP to `netlify.toml` allowlisting the specific script, style, font and `connect-src` origins the app actually uses.

---

### A7 — `password === '1234'` diverts a real login into demo mode — Medium

`index.html:5608`:

```js
if (password==='1234' || password==='demo' || idInput==='demo') { demoMode(); return; }
```

This fires on the **password** field for *any* licence number. A carer who chose `1234` as their password is silently dropped into a demo shelter with fake animals instead of their own records — and `demoMode()` then sets `adminPinHash = btoa('1234')` (`index.html:5190`), planting a legacy-format hash that A1 and A3 both accept.

**Fix:** trigger demo only from the explicit "Try Demo Mode" control, or at minimum only on `idInput === 'demo'`. Do not set `adminPinHash` in `demoMode()`.

---

### A8 — `eval()` for layer-group lookup — Low

`index.html:7683`:

```js
const g = eval(id.replace('ly-','') + 'G') || null;
```

The input derives from a hardcoded element id, so this is not currently attacker-reachable — but it defeats any future CSP without `unsafe-eval`, and breaks silently under any minifier that renames the `…G` globals.

**Fix:** replace with an explicit lookup object, e.g. `const LAYER_GROUPS = { roads: roadsG, hydro: hydroG, … }`.

---

### A9 — Sign-out leaves 29 of 34 `localStorage` keys behind — Medium

`leaveTeam()` (`index.html:5474`) and the account-deletion path (`18783`) remove only `wc_fb`, `wc_name`, `wc_region`, `wc_wildlife`, `wc_role`.

The app writes 34 keys. Left on the device after sign-out:

`wc_admin_pin_hash` · `wc_org` · `wc_email` · `wc_release_sites` · `wc_browse_spots_v2` · `wc_browse_runs` · `wc_browse_lastpicked` · `wc_custom_pins` · `wc_sos` · `wc_feedback` · `wc_shelter_logo` · `wc_run_completions` · `wc_pending_apps` · `wc_pending_msgs` · `hf_reports` · `hf_identity_map` · `hf_prefs` · `hf_reminders` · `hf_browse_history` · `hf_tree_history` · `hf_lgas` · and others.

Wildlife rehab is frequently done from shared shelter computers, and `SECURITY.md` commits to *"Browse stage — private to the carer only. Never leaves your device."* — which cuts both ways: it also has to leave with them. `wc_admin_pin_hash` surviving sign-out is the one that chains into A1.

**Fix:** enumerate and clear all `wc_*` and `hf_*` keys on sign-out, retaining only a genuine device identifier (`hf_device_id`) if one is needed.

---

## B. Correctness — glitches and shortfalls

### B1 — Release-site score is divided by a total the app cannot reach — **High**

`index.html:12342`:

```js
const rawTotal    = foodScore + hollowScore + territoryScore + predatorScore
                  + infraScore + connectScore + overlayScore + waterScore;
const standardised = Math.round(rawTotal / 133 * 100);
```

133 is the sum of the `max` values declared in the `cats` array (`index.html:12357–12390`) and echoed in the UI at line 2474. But three categories can never reach their declared maximum:

| Cat | Title | Declared max | Highest reachable | Where |
|---|---|---|---|---|
| D | Predator Risk | 15 | **12** | `predatorScore` initialises to 12 and only ever decreases (12 / 10 / 6) — `index.html:12259` |
| E | Infrastructure Risk | 15 | **10** | `const infraScore = 10;` — a hardcoded constant — `index.html:12275` |
| F | Habitat Connectivity | 20 | **18** | best branch is `wet_sclerophyll`/`riparian` → 18 — `index.html:12279` |

Achievable total is **123**, not 133. Consequences:

- A perfect site scores 123/133 = **92**. The tool can never return 100.
- Every score is understated by ~7.5%, and the `>= 75` / `>= 55` verdict thresholds are calibrated against a scale nothing reaches. A site with raw 93–99 reads CONDITIONAL when it should read APPROVED; raw 68–73 reads NOT APPROVED when it should read CONDITIONAL.
- The exported report prints `${d.rawTotal}/133` (`index.html:12610`) — so the wrong denominator goes out on documents intended as DEECA-facing evidence.

The category bars also render "12/15" and "10/15" at a perfect site, which reads to the carer as a deficiency at that location rather than a scale artefact.

**Fix — pick one and make it consistent across the scorer, the `cats` maxima, line 2474 and the report footer:**
- **(a)** Change the denominator to 123 and correct the three `max` values to 12 / 10 / 18. Fastest, and makes the printed bars honest. Re-check the 75/55 thresholds afterwards — they shift meaning.
- **(b)** Make D, E and F able to reach 15/15/20 — D needs an upper branch for confirmed no-fire-history, E needs the VicMap Roads intersection the comment describes as outstanding, F needs a 20-point habitat class. Better long-term, more work.

Until then, Cat E is a constant contributing no information to any assessment.

---

### B2 — Licence numbers contain `/` and are concatenated raw into Firebase paths — **High**

The app's own form placeholders are `AW2024/XXXXX` and *"e.g. AW2024/XXXXX — as it appears on your permit"*. `/` is the path separator in Firebase Realtime Database.

`wildlifeReg` is interpolated **unsanitised** into:

```
animals/{licence}/{id}              ×3
browse_spots/{licence}/{id}         ×4
browse_runs/{licence}/…             ×4
browse_lastpicked/{licence}         ×1
run_records/{licence}/…             ×1
release_sites/{licence}/{id}/hidden ×1
messages_by_licence/{licence}/…     ×2
```

Exactly one path family sanitises — `user_prefs`, via `prefKey()` (`index.html:13229`):

```js
const clean = s => String(s||'').replace(/[.#$/\[\]]/g,'_').trim();
```

For licence `AW2024/12345`, `db.ref('animals/' + wildlifeReg + '/' + id)` resolves to `animals/AW2024/12345/{id}` — one level deeper than intended. Reads and writes stay symmetric, so it looks like it works, but:

- **Security rules break.** A rule written as `animals/$licence` binds `$licence` to `"AW2024"`, not `"AW2024/12345"`. Compared against `root.child('user_licences/'+auth.uid).val()` it never matches — every affected carer gets `PERMISSION_DENIED`. If the rule is instead a permissive `auth != null`, every carer whose licence starts `AW2024/` can read every sibling's animal records. Neither is acceptable.
- **Carers collide by prefix.** All `AW2024/*` licences share the `animals/AW2024` subtree.
- This is a strong candidate for the "data doesn't persist / seems to vanish" reports the 24 Jul 2026 comment at `index.html:18645` was chasing. That fix corrected the *shape* of the auto-save path but left the key unsanitised, so it would still misbehave for any slash-bearing licence.

**Fix:** promote a single `licenceKey()` helper (reuse `prefKey()`'s `clean()`) and route **every** path through it. Then run a one-off migration to move data currently sitting under split paths, and re-derive `user_licences` accordingly. Ask a couple of real carers what their permit numbers actually look like before choosing the sanitisation, so the migration is done once.

---

### B3 — Admin "Platform Diagnostics" reports numbers from paths nothing writes — Medium

`index.html:21847–21849`:

```js
const [adb, rel, brws] = await Promise.all([
  _ddb.ref('all_data').once('value'),
  _ddb.ref('all_data').orderByChild('status').equalTo('released').limitToLast(1).once('value'),
  _ddb.ref('user_browse_spots').limitToLast(5).once('value')
]);
```

Neither `all_data` nor `user_browse_spots` is ever written anywhere in the codebase — animal records go to `animals/{licence}/{id}` and browse spots to `browse_spots/{licence}/{id}`. The panel therefore always shows **0 animal records** and **Last release: Never**, regardless of actual platform state.

There is a second, independent bug two lines down (`index.html:21860`):

```js
const lastBrowseId = Object.keys(lastBrowseSnap)[lastBrowseSnap.length - 1];
```

`lastBrowseSnap` is a plain object from `.val()`, so `.length` is `undefined`; the index evaluates to `NaN` and `lastBrowseId` is always `undefined`. "Last edit" is permanently `—`.

**Fix:** point the reads at `animals` and `browse_spots`, aggregate across the per-licence level, and use `Object.keys(snap)[Object.keys(snap).length - 1]`.

---

### B4 — Release-site assessments never leave the browser — Medium

Every read and write of `wc_release_sites` is `localStorage` (`index.html:12482, 12488, 17128, 17417, 17420, 17429, 17437, 17517, 18744, 19701, 20300, 20402`). The only Firebase touch is a `hidden` flag:

```js
if (db && !isDemo) db.ref('release_sites/' + wildlifeReg + '/' + id + '/hidden').set(true);
```

`index.html:17421` — which writes a `hidden` marker into an otherwise-empty node whose parent record does not exist.

So a carer's release-site assessments — the artefact this feature exists to produce, and the one carried into DEECA-facing reports — are lost on a browser clear, a device change, or a switch from phone to desktop. There is no export-and-restore path either.

Separately, `index.html:18744` defaults to an **array** where all eleven other sites default to an object:

```js
const sites = JSON.parse(localStorage.getItem('wc_release_sites') || '[]');   // ← '[]'
```

On a fresh device this yields `[]` where the rest of the code expects `{}`.

**Fix:** mirror completed assessments to `release_sites/{licenceKey}/{id}` on save, hydrate from Firebase at launch with localStorage as the offline cache (the same pattern `browse_spots` already uses), and normalise the `'[]'` default to `'{}'`.

---

### B5 — `sendSOS()` is permanently shadowed and writes an incompatible shape — Medium

Two definitions exist:

- `async function sendSOS()` — `index.html:17755`
- `window.sendSOS = function(){…}` — `index.html:23217`

The `window.` assignment runs later and wins, so the button at `index.html:2584` always calls the newer one. The ~40-line function at 17755 is unreachable.

They are not equivalent. The old one writes:

```js
{ carer, region, licence, suburb, detail, created, status: 'active' }   // → sos/sos_<Date.now()>
```

The banner reader (`index.html:23401`) filters on `o.active !== false` and renders `top.shelterName`, `t.label`, `top.operatorName`, `top.phone`, `top.lga`. An old-shape record has no `active` field, so it passes the filter, and no `shelterName`/`label`, so it renders as **"SOS ACTIVE — undefined · undefined"** to every signed-in carer.

The old key scheme `'sos_' + Date.now()` also collides if two SOS are raised in the same millisecond; the new path uses `.push()`.

**Fix:** delete the shadowed function at 17755. Check `sos/` in the live database for any `sos_*` keys and either migrate them to the new shape or clear them.

---

### B6 — Duplicate live `id="admin-content"` — Medium

- `index.html:3606` — `<div id="admin-content" style="display:none">`, the old admin modal
- `index.html:23607` — `<div id="admin-content">`, the new v8 admin shell

`getElementById` returns the first. So `checkAdminPin` (`17905`) and the modal's close button (`3837`) both target the old modal, and any future code that reaches for the new shell's content area by id will silently hit a hidden div instead.

This is the same class of bug the team already found and documented at `index.html:1220` for `sc-dashboard`, along with the project's stated remedy — *rename the older element rather than delete the markup.* Applying that policy here resolves it.

**Fix:** rename `index.html:3606` to `admin-modal-content` and update its two references.

---

### B7 — 24 functions defined and never called — Low

```
_shareStub_unused    applyLGAPreference   biodiversityNear    burnplanNearPoint
calcBrowseQty        clearMobSpecies      closeMenuDrawer     downloadReport
enterAdminShell      exportCSV            fmtDaysOut          hollowsNear
loadShelterLogo      locateMe             nearestWaterM       overlaysAtPoint
populateDashboard    shareVolunteerSheet  showAlerts          showTreeGuide
toggleActionMenu     toggleHeat           toggleLayers        togglePanel
```

Two groups are worth separating:

**Genuinely superseded — safe to remove.** `overlaysAtPoint` (11904), `hollowsNear` (11921), `biodiversityNear` (11933), `nearestWaterM` (12072), `burnplanNearPoint` (4770) are the older "SITE EVIDENCE LOOKUPS (all verified live 14 Jul 2026)" helpers. The release assessment now calls `planningOverlaysAtPoint`, `oldGrowthAtPoint`, `hydroNearPoint`, `nrsAtPoint`, `crownLandAtPoint` and `fireHistoryAtPoint` via the `Promise.allSettled` block at `index.html:12154`. The old set is dead weight that reads as live integration.

**Possibly unwired UI — check before removing.** `exportCSV`, `downloadReport`, `locateMe`, `showAlerts`, `toggleHeat`, `toggleLayers`, `populateDashboard`, `enterAdminShell`, `calcBrowseQty`, `loadShelterLogo`, `shareVolunteerSheet` look like features that lost their trigger during a UI rework rather than features that were replaced. `exportCSV` and `downloadReport` in particular are user-visible capabilities — worth confirming whether the buttons are meant to exist.

---

## C. Repository hygiene

### C1 — This repository does not contain the current code — Medium

`main`'s `index.html` is 14,227 lines; the v5.1 build is 23,618. Everything in sections A and B above is only in the upload. Anyone cloning this repo, and any deployment built from it, is running roughly two-thirds of the current application.

**Fix:** commit the v5.1 build (plus `conditions.html` and `privacy.html`, which have no counterpart in the repo at all) and keep deploying from the repo rather than by upload.

### C2 — ~24 MB of duplicate HTML — Medium

13 HTML files at the repo root, including four byte-identical pairs:

| Duplicate pair | md5 |
|---|---|
| `habifood-22.html` = `index-37.html` | `45432235…` |
| `habifood-12.html` = `index-25.html` | `9148193c…` |
| `habifood-18.html` = `index-30.html` | `962d2ce8…` |
| `habifood-33.html` = `index-36.html` | `ebb342a2…` |

Because `netlify.toml` publishes the repo root (`publish = "."`), **every one of these is live and publicly fetchable.** Old builds carry the A1–A5 flaws without any later fixes, so patching `index.html` alone does not remove them from the internet.

**Fix:** delete the superseded builds — git history preserves them — or move them under a directory excluded from publish. This is the single highest-leverage hygiene item, because it shrinks the live attack surface as well as the repo.

### C3 — CI/deployment removed — Low

Commit `59c8d62` ("Delete .github directory") removed `deploy-pages.yml` and `generator-generic-ossf-slsa3-publish.yml`. There is now no automated deploy or supply-chain provenance job. If GitHub Pages was the intended target, it is unwired; if Netlify is now the only target, that is fine, but worth stating in the deploy guide.

### C4 — `deploy guide.md` is stale — Medium

- Names `habifood.html` as "complete web application" — it is 2,423 lines, an old cut, and not what deploys as the site.
- Publishes five access codes: `1234`, `WILD-1234`, `DEMO-2026`, `CARER-001`, `TEST-123`. None appear anywhere in v5.1 — real codes now live in `access_codes/` in Firebase. Only the `1234` / `demo` demo shortcut is real (A7). Publishing anything that reads as a live access code in a repo for a permit-gated platform is worth removing regardless.
- Says login is "Enter `1234`" — the flow is now licence + password, or an access code.

### C5 — `SECURITY.md` still carries GitHub template boilerplate — Low

The "Supported Versions" table lists 5.1.x / 5.0.x / 4.0.x — versions this project does not use — and "Reporting a Vulnerability" is the unedited placeholder: *"Use this section to tell people where to go, how often they can expect to get an update…"*.

The genuinely valuable content — the privacy-by-design section on what is and is not shared between carers — sits underneath that boilerplate, and is a strong statement of the platform's design position. It deserves not to be prefaced by an unfilled template.

**Fix:** replace the placeholder with a real disclosure contact (`support@habi-food.com.au` is already used throughout the app), drop the fictional version table, and lead with the privacy section.

---

## Suggested order of work

1. **A1 + A2 + A3** — delete `rawOk` and `legacyOk`, remove the `admin_uids` self-heal, fix the rule, audit `admin_uids`. These are one afternoon and they close a public-form-to-database-admin path.
2. **C2** — delete the duplicate builds. Nothing else removes the old vulnerable copies from the live site.
3. **A4** — promote `esc()` to global and apply it to the admin panel, feedback and presence renderers.
4. **B1** — decide the denominator question and make the scorer, the `cats` maxima, line 2474 and the report footer agree. This one changes assessment outcomes, so it should be a deliberate decision rather than a silent patch.
5. **B2** — introduce `licenceKey()`, then migrate. Confirm real permit formats first.
6. **A5, A7, A9, A6** — the remaining security items.
7. **B3–B7, C1, C3–C5** — correctness and hygiene.

## What could not be verified

- **Firebase security rules** are not in this repository, so every rules-dependent conclusion (A2, A5, B2) is inferred from client code and from the comments describing the rules. The rules should be committed here — they are load-bearing for the entire access model and are currently reviewable only through the Firebase console.
- **Live database state** — whether `admin_uids` currently holds unintended UIDs, whether `sos/` holds old-shape records, and how many licences contain `/` — all need a console check.
- **`conditions.html` and `privacy.html`** were read for their claims about local-only storage but not audited in depth; they are small and static.
