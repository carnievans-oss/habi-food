#!/usr/bin/env node
/**
 * Enforce the desktop / mobile boundary — `npm run check:isolation`.
 *
 * The rule this repository is organised around: the desktop app lives at the
 * root, the mobile app lives in mobile-dist/, and neither reaches into the
 * other. Documentation alone does not hold a boundary; this does.
 *
 * Exits non-zero with a list of violations.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MOBILE = path.join(ROOT, 'mobile-dist');
const violations = [];

function fail(file, msg) {
  violations.push(`${path.relative(ROOT, file)}: ${msg}`);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'vendor', 'assets', '.git'].includes(entry.name)) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/* 1. The desktop build must not reference the mobile build. ────────── */
for (const file of fs.readdirSync(ROOT)) {
  if (!file.endsWith('.html')) continue;
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (/mobile-dist/.test(src)) {
    fail(path.join(ROOT, file), 'references mobile-dist/ — the desktop build must not depend on the mobile build');
  }
}

/* 2. The mobile build must not reach outside its own folder. ───────── */
const mobileFiles = walk(MOBILE);
for (const file of mobileFiles) {
  const ext = path.extname(file);
  if (!['.html', '.css', '.js', '.webmanifest'].includes(ext)) continue;
  const src = fs.readFileSync(file, 'utf8');

  // Build inputs legitimately point at sibling mobile sources; shipped assets
  // must not point outside mobile-dist at all.
  const isBuildInput = file.endsWith('app.tailwind.css');
  if (!isBuildInput) {
    // Any quoted path stepping out of mobile-dist, whether it is an HTML
    // attribute, a CSS url() or a string in a script.
    const escapes = src.match(/["'(]\.\.\//g);
    if (escapes) fail(file, `${escapes.length} path(s) escape mobile-dist/ with ../`);
  }
  // Desktop entry points by name. "./index.html" and "../index.html" are the
  // mobile build's own page and are resolved by the ../ check above.
  const desktopRefs = src.match(/habifood(?:-\d+)?\.html|index[-_]\d+\.html|["'(]\/index\.html/g);
  if (desktopRefs) {
    fail(file, `references desktop page(s): ${[...new Set(desktopRefs)].join(', ')}`);
  }
}

/* 3. No desktop layout idioms inside the mobile build. ─────────────── */
const cssFiles = mobileFiles.filter((f) => f.endsWith('.css') && !f.includes('vendor'));
for (const file of cssFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const wide = src.match(/@media[^{]*min-width\s*:\s*(\d+)px/g) || [];
  wide.forEach((m) => {
    const px = parseInt(m.match(/(\d+)px/)[1], 10);
    if (px >= 900) fail(file, `desktop breakpoint "${m.trim()}" — the mobile build is phone-only`);
  });
  if (/grid-template-columns\s*:\s*repeat\(\s*[3-9]/.test(src)) {
    fail(file, 'three-or-more-column grid — mobile layouts stay single-column (paired stat tiles aside)');
  }
}
for (const file of mobileFiles.filter((f) => /\.(html|js)$/.test(f) && !f.includes('vendor'))) {
  const src = fs.readFileSync(file, 'utf8');
  const cols = src.match(/grid-cols-([3-9]|1[0-2])\b/g);
  if (cols) fail(file, `desktop-width grid utilities: ${[...new Set(cols)].join(', ')}`);
}

/* 4. Generated domain data must match the desktop source. ──────────── */
const domainFile = path.join(MOBILE, 'js', 'domain.js');
if (!fs.existsSync(domainFile)) {
  violations.push('mobile-dist/js/domain.js is missing — run `npm run mobile:domain`');
} else {
  const before = fs.readFileSync(domainFile, 'utf8');
  execFileSync(process.execPath, [path.join(__dirname, 'extract-domain.js')], { stdio: 'ignore' });
  const after = fs.readFileSync(domainFile, 'utf8');
  if (before !== after) {
    fs.writeFileSync(domainFile, before);   // leave the tree as we found it
    violations.push('mobile-dist/js/domain.js is stale — run `npm run mobile:domain` and commit the result');
  }
}

/* 5. Every asset the mobile HTML asks for must exist. ──────────────── */
const html = fs.readFileSync(path.join(MOBILE, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
for (const rel of refs) {
  if (/^(https?:)?\/\//.test(rel)) continue;
  if (rel === 'capacitor.js') continue;       // injected by the native shell
  if (!fs.existsSync(path.join(MOBILE, rel))) {
    fail(path.join(MOBILE, 'index.html'), `missing local asset "${rel}"`);
  }
}

if (violations.length) {
  console.error('Desktop/mobile isolation check FAILED:\n');
  violations.forEach((v) => console.error('  ✗ ' + v));
  console.error('\nSee docs/MOBILE.md for the boundary rules.');
  process.exit(1);
}
console.log('Desktop/mobile isolation check passed — ' + mobileFiles.length + ' mobile files inspected.');
