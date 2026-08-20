#!/usr/bin/env node
/**
 * Generate mobile-dist/js/domain.js from the canonical desktop app.
 *
 * The desktop build (index.html) is the single source of truth for DOMAIN DATA
 * — species, browse stages, rescue causes, demo records. The mobile build owns
 * its own LAYOUT and never imports desktop markup or CSS, but duplicating a
 * 700-line species table by hand would guarantee the two drift apart. So the
 * data blocks are lifted verbatim into a generated, never-hand-edited file.
 *
 *   npm run mobile:domain
 *
 * Layout stays isolated; facts about wildlife stay shared.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'mobile-dist', 'js', 'domain.js');

// Marker pair — the first is the opening of the data section, the second the
// last statement of it. Both are matched literally so a refactor upstream fails
// loudly here instead of silently emitting a truncated file.
const START = 'const CAUSES=[';
const END = "const STAGE_ORDER=['formula','transition','browseplus','prerelease'];";

const EXPORTS = [
  'CAUSES', 'SPECIES', 'SPM', 'DEMO_ANIMALS', 'DEMO_OPS_EVENTS',
  'BROWSE_STAGES', 'STAGE_ORDER', 'makeDate', 'makeEndDate',
];

function main() {
  const src = fs.readFileSync(SOURCE, 'utf8');

  const start = src.indexOf(START);
  if (start === -1) fail(`start marker not found in index.html: ${START}`);

  const endStart = src.indexOf(END, start);
  if (endStart === -1) fail(`end marker not found in index.html: ${END}`);
  const end = endStart + END.length;

  const block = src.slice(start, end);

  // Sanity-check every symbol we promise to export is actually declared.
  for (const name of EXPORTS) {
    if (!new RegExp(`(const|let|var|function)\\s+${name}\\b`).test(block)) {
      fail(`expected declaration of "${name}" inside the extracted block`);
    }
  }
  if (/document\.|window\.|getElementById/.test(block)) {
    fail('extracted block touches the DOM — it is no longer pure data');
  }

  const out = `/* ═══════════════════════════════════════════════════════════════════
   GENERATED FILE — DO NOT EDIT BY HAND.

   Domain data lifted verbatim from the desktop build (index.html) by
   scripts/extract-domain.js. Regenerate with:

       npm run mobile:domain

   Edit the data in index.html, never here: any change made here is lost on
   the next run, and the two builds would then disagree about what a species
   eats — which is the one thing they must never do.
   ═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

${block.split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n')}

  global.HF_DOMAIN = { ${EXPORTS.join(', ')} };
})(window);
`;

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, out);

  const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
  console.log(`domain.js written — ${EXPORTS.length} exports, ${kb} KB`);
}

function fail(msg) {
  console.error(`extract-domain: ${msg}`);
  process.exit(1);
}

main();
