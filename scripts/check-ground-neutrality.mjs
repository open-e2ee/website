#!/usr/bin/env node
/*
 * Asserts that no dark ground carries a color cast.
 *
 *   node scripts/check-ground-neutrality.mjs
 *
 * Two readings, because a dark ground reaches the page by two routes.
 *
 * The first is the installed design package. Every dark role that paints a
 * large area is measured in the tokens the site actually ships, so a stale pin
 * fails here rather than on the rendered page.
 *
 * The second is this repository. A handful of site-owned `--oe-*` properties
 * hold literal hex values, and `BaseLayout.astro` writes two `theme-color`
 * tags that no token can reach. Those are measured from source.
 *
 * The instrument is HSL saturation, not OKLCH chroma. Chroma falls with
 * lightness, so a near black reports a small chroma while the eye still reads
 * a cast: the paper ramp measured under 0.009 chroma at every dark step while
 * its canvas ran 15 percent saturation and read brown. HSL saturation divides
 * the channel spread by the room that lightness leaves for it, so it reports
 * the cast at the strength a reader sees.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The ceiling, in HSL saturation percent. */
const LIMIT = 4;

/*
 * Only grounds. A hairline or a label at 30 percent lightness carries too few
 * pixels to read as a cast, and holding them to a ground's limit would price
 * in a change nobody asked for. Below this the surface is large and flat.
 */
const DARK = 25;

/*
 * The one exemption, and the reason it is not a loophole. Ghostty ships a
 * single appearance and `#282c34` is its own default background, quoted in
 * `src/styles/code.css` from `src/config/Config.zig`. A terminal panel that
 * matched our ramp would stop looking like the terminal it depicts.
 */
const FOREIGN = new Set(['--oe-shell']);

const SOURCES = [
  'src/styles/code.css',
  'src/styles/shared.css',
  'src/styles/article.css',
  'src/layouts/BaseLayout.astro',
  'public/theme-init.js',
];

const TOKENS = 'node_modules/@open-e2ee/design/packages/design/dist/css/tokens.css';

/** The share of the room that lightness leaves, taken up by the channel spread. */
function measure(hex) {
  const red = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const green = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const high = Math.max(red, green, blue);
  const low = Math.min(red, green, blue);
  const lightness = (high + low) / 2;
  const saturation =
    high === low ? 0 : (high - low) / (1 - Math.abs(2 * lightness - 1));
  return { lightness: lightness * 100, saturation: saturation * 100 };
}

const failures = [];
const readings = [];

function judge(where, name, hex) {
  const { lightness, saturation } = measure(hex);
  if (lightness >= DARK) return;
  const verdict = saturation <= LIMIT ? 'PASS' : 'FAIL';
  readings.push(
    `${verdict} ${where} ${name} ${hex} lightness ${lightness.toFixed(0)} percent, saturation ${saturation.toFixed(1)} percent`,
  );
  if (verdict === 'FAIL') failures.push(`${where} ${name} ${hex}`);
}

/*
 * The four grounds and the border that meets them, read from the dark block of
 * the installed tokens. The names are the ones the package emits.
 */
const GROUNDS = [
  '--oe-canvas',
  '--oe-surface',
  '--oe-surface-raised',
  '--oe-surface-sunken',
  '--oe-border',
  '--oe-code',
];

const tokenCss = await readFile(join(root, TOKENS), 'utf8');
const darkBlock = tokenCss.slice(tokenCss.indexOf(':root.dark'));
if (darkBlock === '') {
  process.stderr.write(`${TOKENS} has no :root.dark block\n`);
  process.exit(2);
}
let found = 0;
for (const name of GROUNDS) {
  const match = darkBlock.match(
    new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`),
  );
  if (match === null) continue;
  found += 1;
  judge('tokens', name, match[1].toLowerCase());
}
if (found !== GROUNDS.length) {
  process.stderr.write(
    `The dark token block answered ${found} of ${GROUNDS.length} ground names\n`,
  );
  process.exit(2);
}

/*
 * Site-owned literals. A declaration that names a property this repository
 * writes itself, and a theme-color tag, are the two ways a hex reaches a large
 * surface without passing through a token.
 */
for (const file of SOURCES) {
  const text = await readFile(join(root, file), 'utf8');
  const where = relative(root, join(root, file));
  for (const [, name, hex] of text.matchAll(
    /(--oe-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    if (FOREIGN.has(name)) continue;
    judge(where, name, hex.toLowerCase());
  }
  for (const [, hex] of text.matchAll(
    /name="theme-color"\s+content="(#[0-9a-fA-F]{6})"/g,
  )) {
    judge(where, 'theme-color', hex.toLowerCase());
  }
  /*
   * The first-paint resolver runs before the stylesheet applies, so it cannot
   * read a custom property and restates the two canvases as literals.
   */
  for (const [, hex] of text.matchAll(/\bdark:\s*'(#[0-9a-fA-F]{6})'/g)) {
    judge(where, 'first-paint canvas', hex.toLowerCase());
  }
}

process.stdout.write(`${readings.join('\n')}\n`);
if (failures.length > 0) {
  process.stdout.write(
    `${failures.length} dark ground exceeds ${LIMIT} percent saturation\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `${readings.length} dark grounds measure ${LIMIT} percent saturation or less\n`,
);
