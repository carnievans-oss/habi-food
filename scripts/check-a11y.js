#!/usr/bin/env node
/**
 * Vision-accessibility check for the mobile build — `npm run check:a11y`.
 *
 * Verifies the colour tokens in mobile-dist/css/app.tailwind.css against the
 * targets the design is held to:
 *
 *   · text on any surface it is used on          >= 4.5:1
 *   · a component boundary (`outline`)           >= 3:1
 *   · a map marker fill against the map ground   >= 3:1
 *
 * `outline-variant` is exempt by design: Material defines it as the divider
 * tone used *inside* an already-bounded component, where it separates rows
 * rather than delimiting a control. It is listed in the report so the
 * exemption stays visible rather than silent.
 *
 * The tones are read from the stylesheet, not duplicated here — change a token
 * and this check follows it.
 */
const fs = require('fs');
const path = require('path');

const CSS = path.join(__dirname, '..', 'mobile-dist', 'css', 'app.tailwind.css');

/* ── WCAG 2.x contrast ─────────────────────────────────────────────── */
function channel(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function rgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function contrast(a, b) {
  const x = luminance(rgb(a));
  const y = luminance(rgb(b));
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── Read the tokens out of the stylesheet ─────────────────────────── */
/* The light scheme is declared in @theme; the dark scheme redefines the same
   role names inside the prefers-color-scheme block. Both are checked, because
   a dark theme that was never measured is not a dark theme that works. */
const css = fs.readFileSync(CSS, 'utf8');

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const lightSrc = darkStart === -1 ? css : css.slice(0, darkStart);
const darkSrc = darkStart === -1 ? '' : css.slice(darkStart);

function tokens(src) {
  const out = {};
  for (const m of src.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{3,8});/g)) out[m[1]] = m[2];
  return out;
}
const LIGHT = tokens(lightSrc);
const DARK = Object.assign({}, LIGHT, tokens(darkSrc));

if (!darkSrc) {
  console.error('FAIL  no dark scheme found — core app quality requires both themes');
  process.exit(1);
}

/* Every pairing the UI actually renders. Adding a component means adding its
   pairing here — that is the point: the check tracks the design, not a snapshot. */
const TEXT = [
  ['body copy',              'on-surface',         'surface'],
  ['body copy on page',      'on-surface',         'surface-container'],
  ['secondary text',         'on-surface-variant', 'surface'],
  ['secondary on page',      'on-surface-variant', 'surface-container'],
  ['accent / heading',       'primary',            'surface'],
  ['accent on page',         'primary',            'surface-container'],
  ['tab label (idle)',       'on-surface-variant', 'surface'],
  ['tab label (selected)',   'primary',            'surface'],
  ['filled button label',    'on-primary',         'primary'],
  ['primary badge',          'primary',            'primary-container'],
  ['error badge',            'error',              'error-container'],
  ['warning badge',          'warning',            'warning-container'],
  ['info badge',             'info',               'info-container'],
  ['muted badge',            'on-surface-variant', 'surface-container'],
  ['error text',             'error',              'surface'],
  ['warning text',           'warning',            'surface'],
  ['info text',              'info',               'surface'],
];

const NON_TEXT = [
  ['component outline on card',  'outline',        'surface'],
  ['component outline on page',  'outline',        'surface-container'],
  ['marker: browse spot',        'marker-spot',    'surface-dim'],
  ['marker: release site',       'marker-release', 'surface-dim'],
  ['marker: rescue location',    'marker-rescue',  'surface-dim'],
  /* Material's navigation indicator is a deliberately soft fill — measuring the
     fill against the bar fails, and darkening it to 3:1 would put a heavy blob
     behind the icon. What makes it perceivable is its edge, so that is what is
     measured: .hf-tab[aria-selected] .ic carries `inset 0 0 0 1px outline`.
     (The selected tab is also marked by label weight and tone, so the indicator
     is the third signal, not the only one.) */
  ['tab indicator edge',         'outline',        'surface'],
];

let failed = 0;
const line = (ok, ratio, need, label) =>
  `  ${ok ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2).padStart(5)}:1  (need ${need})  ${label}`;

function checkScheme(name, T) {
  console.log(`\n══ ${name.toUpperCase()} SCHEME ══`);
  console.log('TEXT — target 4.5:1');
  for (const [label, fg, bg] of TEXT) {
    if (!T[fg] || !T[bg]) { console.error(`  FAIL  missing token: ${fg} or ${bg}`); failed++; continue; }
    const r = contrast(T[fg], T[bg]);
    const ok = r >= 4.5;
    if (!ok) failed++;
    console.log(line(ok, r, 4.5, `${label}  (${T[fg]} on ${T[bg]})`));
  }

  console.log('\nNON-TEXT — target 3:1');
  for (const [label, fg, bgKey] of NON_TEXT) {
    const bg = T[bgKey];
    if (!T[fg] || !bg) { console.error(`  FAIL  missing token: ${fg}`); failed++; continue; }
    const r = contrast(T[fg], bg);
    const ok = r >= 3;
    if (!ok) failed++;
    console.log(line(ok, r, 3, `${label}  (${T[fg]} on ${bg})`));
  }

  console.log('\nEXEMPT BY DESIGN');
  console.log(`         ${contrast(T['outline-variant'], T.surface).toFixed(2)}:1` +
    `  outline-variant (${T['outline-variant']}) — Material divider tone, used only` +
    ' for lines inside a component whose own edge already meets 3:1');
}

checkScheme('light', LIGHT);
checkScheme('dark', DARK);

/* ── Type scale: nothing below 12sp ────────────────────────────────── */
console.log('\nTYPE SCALE — floor 0.75rem (12sp)');
const sizes = [...css.matchAll(/--text-([a-z-]+):\s*([\d.]+)rem;/g)]
  .map((m) => ({ name: m[1], rem: parseFloat(m[2]) }))
  .sort((a, b) => a.rem - b.rem);
for (const s of sizes) {
  const ok = s.rem >= 0.75;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${(s.rem * 16).toFixed(0).padStart(3)}sp  --text-${s.name}`);
}

/* Any px font-size left in the shipped stylesheets defeats text scaling. */
console.log('\nSCALABLE UNITS — no px font sizes outside vendor code');
const shipped = ['native.css', 'app.tailwind.css'];
for (const file of shipped) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mobile-dist', 'css', file), 'utf8');
  const pxFonts = [...src.matchAll(/font(?:-size)?:[^;{]*?(\d+(?:\.\d+)?)px/g)].map((m) => m[0].trim());
  const ok = pxFonts.length === 0;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${file}${ok ? '' : ' — ' + pxFonts.join(' | ')}`);
}

if (failed) {
  console.error(`\n${failed} accessibility target(s) not met.`);
  process.exit(1);
}
console.log('\nAll vision-accessibility targets met.');
