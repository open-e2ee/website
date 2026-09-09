/*
 * The lockup's fit, decided from the built markup and the built stylesheet.
 *
 * `scripts/measure-lockup-fit.mjs` proves the same two rules in a real Chrome,
 * which is the only thing that knows the ink box of a capital in a loaded face.
 * It needs a browser, a served build, and about a minute. This file needs the
 * build alone, so the rules hold on every run of the suite rather than on the
 * runs that can afford a renderer.
 *
 * Every figure comes out of `public/brand/manifest.json`, which the design
 * package writes from the numbers it draws the lockups with. The header sets
 * the mark in em of the wordmark's font size, so a manifest unit divided by
 * `wordmarkFontSize` is the em the stylesheet has to carry. A repin that moves
 * the lockup moves these expectations with it, and the stylesheet has to move
 * with them or the assertions fail.
 *
 * The manifest cannot say which face a browser loaded, so the cap height here
 * is the design package's measurement of Public Sans rather than a reading of
 * the rendered page. The rendered reading belongs to the script.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const DIST = new URL('../dist/', import.meta.url);
const MANIFEST = new URL('../public/brand/manifest.json', import.meta.url);

/* DESIGN.md's own bound: the mark stands at most 1.15 cap heights tall.
   `scripts/measure-lockup-fit.mjs` carries the same number for the same rule. */

/* The stylesheet rounds an em to three places, which costs at most half a
   thousandth. A thousandth admits that rounding and nothing else: the defect
   this guards against set the mark at 1.166em where the manifest asks for
   0.795em, and drew it a sixth too large. */
const TOLERANCE = 0.001;

/*
 * dist/ is absent on a clean checkout and present in CI, which builds before it
 * tests. A bare skip would let a dist-reading assertion report a pass in the one
 * place it is the only guard there is.
 */
const skipUnbuilt = () => {
  assert.ok(
    !process.env.CI,
    'dist/ is missing — CI builds before it tests, so a dist-reading assertion must never skip here',
  );
};

/** Every built page, as the path a reader types, with its markup. */
async function built() {
  const found = [];
  const walk = async (directory, path) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, directory), `${path}${entry.name}/`);
      else if (entry.name === 'index.html')
        found.push({ path, markup: await readFile(new URL(entry.name, directory), 'utf8') });
    }
  };
  await walk(DIST, '/');
  return found.sort((one, other) => one.path.localeCompare(other.path));
}

/**
 * Every built stylesheet, with its selector escapes removed.
 *
 * A class selector escapes the characters an arbitrary Tailwind value puts in a
 * class name, so `[&_.oe-mark]:h-[0.795em]` reaches the file as
 * `\[\&_\.oe-mark\]\:h-\[0\.795em\]`. Dropping the backslashes reads a selector
 * the way the class attribute writes it, rather than doubling every escape into
 * each pattern below.
 */
async function stylesheet() {
  const directory = new URL('_astro/', DIST);
  let text = '';
  for (const entry of await readdir(directory)) {
    if (entry.endsWith('.css')) text += await readFile(new URL(entry, directory), 'utf8');
  }
  return text.replace(/\\/g, '');
}

/** An attribute value as the document means it, not as HTML spells it. */
const unescape = (value) => value.replace(/&amp;/g, '&');

/** The chrome header of one built page: the row, the lockup, the navigation. */
function header({ markup, path }) {
  const row = /<header\b[^>]*>\s*<div class="([^"]*)"/.exec(markup);
  assert.ok(row, `${path} draws no header row`);
  const lockup =
    /aria-label="OpenE2EE home"><span class="([^"]*)"><span style="([^"]*)"/.exec(markup);
  assert.ok(lockup, `${path} draws no lockup in its header`);
  const navigation = /<nav class="([^"]*)" aria-label="Primary"/.exec(markup);
  assert.ok(navigation, `${path} draws no primary navigation`);
  return {
    row: unescape(row[1]).split(/\s+/),
    lockup: unescape(lockup[1]).split(/\s+/),
    lockupStyle: lockup[2],
    navigation: unescape(navigation[1]).split(/\s+/),
  };
}

/** The one class in a list that a pattern matches, and its captured value. */
function only(classes, pattern, what, path) {
  const hits = classes.map((name) => pattern.exec(name)).filter(Boolean);
  assert.equal(hits.length, 1, `${path} carries ${hits.length} ${what} classes, not one`);
  return hits[0][1];
}

/** The rem a spacing utility resolves to, read from the stylesheet. */
function spacingRem(css, name) {
  const step = /--spacing:([\d.]+)rem/.exec(css);
  assert.ok(step, 'the stylesheet declares no --spacing step');
  const rule = new RegExp(`\\.${name}\\{gap:calc\\(var\\(--spacing\\) \\* ([\\d.]+)\\)\\}`).exec(css);
  assert.ok(rule, `the stylesheet declares no .${name} rule`);
  return Number(step[1]) * Number(rule[1]);
}

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8')).lockups;

const markEm = manifest.symbolFontRatio;
const gapEm = manifest.gapFontRatio;

let pages = [];
let css = '';
try {
  pages = await built();
  css = await stylesheet();
} catch {
  skipUnbuilt();
}

test('the mark is the manifest share of the wordmark font size', { skip: pages.length === 0 }, () => {
  for (const page of pages) {
    const { lockup, path } = { ...header(page), path: page.path };
    for (const axis of ['h', 'w']) {
      const written = Number(
        only(lockup, new RegExp(`^\\[&_\\.oe-mark\\]:${axis}-\\[([\\d.]+)em\\]$`), `mark ${axis}`, path),
      );
      assert.ok(
        Math.abs(written - markEm) < TOLERANCE,
        `${path} sets the mark ${axis} to ${written}em where the manifest asks for ${markEm.toFixed(4)}em`,
      );
      const rule = new RegExp(
        `\\[&_\\.oe-mark\\]:${axis}-\\[${written}em\\] \\.oe-mark\\{(height|width):([\\d.]+)em\\}`,
      ).exec(css);
      assert.ok(rule, `the stylesheet carries no ${axis}-[${written}em] rule for .oe-mark`);
      assert.equal(Number(rule[2]), written, `.oe-mark renders at ${rule[2]}em, not ${written}em`);
    }
  }
});

test('the larger mark bottom aligns with the wordmark descender', { skip: pages.length === 0 }, () => {
  assert.equal(markEm, 1.3);
  for (const page of pages) {
    const { lockup, lockupStyle } = header(page);
    assert.match(lockupStyle, /align-items:\s*baseline/);
    const drop = Number(only(lockup, /^\[&_\.oe-mark\]:translate-y-\[([\d.]+)em\]$/, 'mark baseline drop', page.path));
    assert.ok(Math.abs(drop - manifest.symbolBaselineDropRatio) < TOLERANCE);
    assert.ok(Math.abs(drop - manifest.wordmarkInkBottomRatio) < TOLERANCE);
  }
});

test('the gap beside the mark is the manifest gap', { skip: pages.length === 0 }, () => {
  for (const page of pages) {
    const { lockupStyle } = header(page);
    const written = /gap:\s*([\d.]+)em/.exec(lockupStyle);
    assert.ok(written, `${page.path} sets no gap between the mark and the wordmark`);
    assert.ok(
      Math.abs(Number(written[1]) - gapEm) < TOLERANCE,
      `${page.path} sets ${written[1]}em beside the mark where the manifest asks for ${gapEm.toFixed(4)}em`,
    );
  }
});

test('the lockup keeps more clear space than the navigation', { skip: pages.length === 0 }, () => {
  for (const page of pages) {
    const { row, navigation, path } = { ...header(page), path: page.path };
    const rowGap = spacingRem(css, `gap-${only(row, /^gap-(\d+)$/, 'row gap', path)}`);
    const wordGap = spacingRem(css, `gap-${only(navigation, /^gap-(\d+)$/, 'navigation gap', path)}`);
    assert.ok(
      rowGap > wordGap,
      `${path} leaves the lockup ${rowGap}rem beside a ${wordGap}rem word gap, so it reads as the first word of the navigation`,
    );

    /* The row narrows at one width and the navigation leaves the row at
       another. Were the first the smaller of the two, the row would draw the
       narrow gap while the navigation is still in it. */
    const narrows = only(row, /^max-\[([\d.]+rem)\]:gap-\d+$/, 'narrow row gap', path);
    const leaves = only(navigation, /^max-\[([\d.]+rem)\]:hidden$/, 'navigation hide', path);
    assert.equal(
      narrows,
      leaves,
      `${path} narrows the header row at ${narrows} and hides the navigation at ${leaves}`,
    );
  }
});
