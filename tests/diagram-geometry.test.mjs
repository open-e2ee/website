/*
 * The two geometric rules, decided from the built markup.
 *
 * `scripts/measure-diagram-geometry.mjs` proves the same two rules in a real
 * Chrome, which is the only thing that knows how wide a shaped run of a font is.
 * It needs a browser, a served build, and about a minute. This file needs the
 * build alone, so the rules hold on every run of the suite rather than on the
 * runs that can afford a renderer.
 *
 * Every figure the components draw writes its coordinates as literal attributes,
 * so a box, a boundary rule, and an arrow shaft are all readable from the
 * markup. A text run is not: only a renderer knows its advance. It is bounded
 * here instead, from the three sizes `src/styles/demo.css` sets and from the one
 * monospace face they are all set in, and every bound is drawn wider and taller
 * than the face measures. A label that clears a rule under these numbers clears
 * it on screen with room to spare, and the tightest clearance in the six figures
 * is 5.2 units under bounds that already run 0.02em per character wide.
 *
 * The counts this file reads match the renderer's exactly, figure for figure:
 * 10, 2, 3, 4, 6, 3 boxes and 16, 5, 4, 8, 15, 6 labels. The parser and the
 * browser see the same drawings.
 *
 * A figure drawn through `<use>` has no geometry at these coordinates, so the
 * signature diagram on `/security` is outside this file and inside the
 * measurement script.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const DIST = new URL('../dist/', import.meta.url);

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

/** The three label sizes, in the user units the components are written in. */
const SIZES = {
  'diagram-boundary-label': 12,
  'diagram-label': 13,
  'diagram-tick-label': 11,
};

/* Bounds rather than metrics. JetBrains Mono advances 0.60em and the stylesheet
   adds 0.02em of letter spacing; a run is measured here at 0.64em per character.
   The face rises 1.00em above the baseline and drops 0.31em below it at 13 user
   units, and this box is 1.05 and 0.40. */
const ADVANCE = 0.64;
const ASCENT = 1.05;
const DESCENT = 0.4;

/* How near an endpoint has to be to a box before the arrow counts as starting or
   ending there. The same 20 units `scripts/measure-diagram-geometry.mjs` uses,
   for the same reason: the head is drawn past the shaft, and the shaft is held
   off an open form's 4-unit stroke by a visible gap. */
const TOUCH_UNITS = 20;

const attribute = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const number = (tag, name) => Number(attribute(tag, name) ?? 0);
const rect = (x, y, width, height) => ({
  x,
  y,
  width,
  height,
  right: x + width,
  bottom: y + height,
});

/** Every built page, as the path a reader types. */
async function pages() {
  const found = [];
  const walk = async (directory, path) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(new URL(`${entry.name}/`, directory), `${path}${entry.name}/`);
      else if (entry.name === 'index.html') found.push(path);
    }
  };
  await walk(DIST, '/');
  return found.sort();
}

/**
 * One drawing, classified the way the measurement script classifies it.
 *
 * `<defs>` holds shapes drawn somewhere else, and `<title>` and `<desc>` hold
 * the words a screen reader speaks rather than words the drawing sets.
 */
function figure(markup, viewBox, path) {
  const body = markup.replace(/<(defs|title|desc)\b[\s\S]*?<\/\1>/g, '');
  const boxes = [];
  const rules = [];
  const arrows = [];
  const labels = [];

  for (const [, tag] of body.matchAll(/<rect\b([^>]*?)\/?>/g)) {
    const measured = rect(
      number(tag, 'x'),
      number(tag, 'y'),
      number(tag, 'width'),
      number(tag, 'height'),
    );
    if (
      attribute(tag, 'fill') === 'none' &&
      attribute(tag, 'stroke') &&
      measured.width >= 50 &&
      measured.height >= 50
    ) {
      boxes.push(measured);
      continue;
    }
    const thin = Math.min(measured.width, measured.height);
    const long = Math.max(measured.width, measured.height);
    if (thin <= 4 && long >= 20) {
      arrows.push({ ...measured, vertical: measured.height > measured.width });
    }
  }

  for (const [, tag] of body.matchAll(/<line\b([^>]*?)\/?>/g)) {
    if (!attribute(tag, 'stroke-dasharray')) continue;
    const x = Math.min(number(tag, 'x1'), number(tag, 'x2'));
    const y = Math.min(number(tag, 'y1'), number(tag, 'y2'));
    rules.push(
      rect(
        x,
        y,
        Math.abs(number(tag, 'x2') - number(tag, 'x1')),
        Math.abs(number(tag, 'y2') - number(tag, 'y1')),
      ),
    );
  }

  for (const [, tag, inner] of body.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const text = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    const named = (attribute(tag, 'class') ?? '').split(/\s+/).filter((name) => name in SIZES);
    assert.equal(
      named.length,
      1,
      `${path} sets "${text}" in no known label size; the width bound would be a guess`,
    );
    const size = SIZES[named[0]];
    const width = text.length * size * ADVANCE;
    const left =
      attribute(tag, 'text-anchor') === 'middle' ? number(tag, 'x') - width / 2 : number(tag, 'x');
    labels.push({
      ...rect(left, number(tag, 'y') - size * ASCENT, width, size * (ASCENT + DESCENT)),
      text,
    });
  }

  return { arrows, boxes, labels, path, rules, viewBox };
}

/** Every figure in the build whose coordinates are written where they are drawn. */
async function figures() {
  const found = [];
  for (const path of await pages()) {
    const html = await readFile(new URL(`.${path}index.html`, DIST), 'utf8');
    for (const [, inside] of html.matchAll(
      /<figure class="diagram[^"]*"[^>]*>([\s\S]*?)<\/figure>/g,
    )) {
      for (const [, open, markup] of inside.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)) {
        if (/<use\b/.test(markup)) continue;
        found.push(figure(markup, attribute(open, 'viewBox'), path));
      }
    }
  }
  return found;
}

const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

/* An arrow drawn clear over a form, from one side of it to the other, is read
   as passing through the form: the eye follows the shaft, and the form under it
   is on the path. */
const spans = (arrow, box) =>
  arrow.vertical
    ? box.y >= arrow.y && box.bottom <= arrow.bottom
    : box.x >= arrow.x && box.right <= arrow.right;

/** Does the arrow start or end at this box? Either end, either side of it. */
function anchored(arrow, box) {
  const near = (x, y) =>
    x >= box.x - TOUCH_UNITS &&
    x <= box.right + TOUCH_UNITS &&
    y >= box.y - TOUCH_UNITS &&
    y <= box.bottom + TOUCH_UNITS;
  if (arrow.vertical) {
    const x = arrow.x + arrow.width / 2;
    return near(x, arrow.y) || near(x, arrow.bottom);
  }
  const y = arrow.y + arrow.height / 2;
  return near(arrow.x, y) || near(arrow.right, y);
}

/** Arrows that reach a box they neither start at nor end at. */
function strayArrows(drawing) {
  const found = [];
  for (const [index, arrow] of drawing.arrows.entries()) {
    for (const [at, box] of drawing.boxes.entries()) {
      if (!overlaps(arrow, box) && !spans(arrow, box)) continue;
      if (anchored(arrow, box)) continue;
      found.push(
        `${drawing.path} ${drawing.viewBox}: arrow ${index} at ${arrow.x},${arrow.y} ` +
          `${arrow.width}x${arrow.height} reaches box ${at} at ${box.x},${box.y} ` +
          `${box.width}x${box.height}, and starts at neither end of it`,
      );
    }
  }
  return found;
}

/** Boundary rules drawn through the words around them. */
function struckLabels(drawing) {
  const found = [];
  for (const [index, rule] of drawing.rules.entries()) {
    for (const label of drawing.labels) {
      if (!overlaps(rule, label)) continue;
      found.push(
        `${drawing.path} ${drawing.viewBox}: rule ${index} at x ${rule.x}, y ${rule.y} to ` +
          `${rule.bottom} runs through "${label.text}"`,
      );
    }
  }
  return found;
}

test('reads every figure the components draw', async () => {
  const drawings = await figures();
  if (drawings.length === 0) return skipUnbuilt();

  assert.equal(drawings.length, 6, `the build carries ${drawings.length} literal figures`);
  for (const drawing of drawings) {
    assert.match(drawing.viewBox ?? '', /^0 0 \d+ \d+$/, `${drawing.path} draws without a viewBox`);
    assert.ok(drawing.boxes.length >= 1, `${drawing.path} ${drawing.viewBox} classifies no form`);
    assert.ok(drawing.labels.length >= 3, `${drawing.path} ${drawing.viewBox} classifies no words`);
  }
  const arrows = drawings.reduce((count, drawing) => count + drawing.arrows.length, 0);
  const rules = drawings.reduce((count, drawing) => count + drawing.rules.length, 0);
  assert.ok(arrows >= 5, `the build carries ${arrows} arrow shafts; a blind parser reads none`);
  assert.ok(rules >= 8, `the build carries ${rules} boundary rules; a blind parser reads none`);
});

test('no arrow crosses a box it does not touch', async () => {
  const drawings = await figures();
  if (drawings.length === 0) return skipUnbuilt();
  const faults = drawings.flatMap(strayArrows);
  assert.deepEqual(faults, [], `an arrow states a path:\n${faults.join('\n')}`);
});

test('no trust boundary runs through a label', async () => {
  const drawings = await figures();
  if (drawings.length === 0) return skipUnbuilt();
  const faults = drawings.flatMap(struckLabels);
  assert.deepEqual(faults, [], `a rule states a place:\n${faults.join('\n')}`);
});

/*
 * The two faults, drawn on purpose. A checker that reports six clean figures and
 * cannot report a dirty one is a checker that reports six clean figures whatever
 * they hold.
 */
const SHAFT = '<rect x="60" y="99" width="200" height="2" fill="#000"/>';
const FORM = '<rect x="120" y="40" width="90" height="90" fill="none" stroke="#000"/>';

test('faults an arrow drawn through a form it starts nowhere near', () => {
  const drawn = figure(
    `${SHAFT}${FORM}<text x="10" y="200" class="diagram-label">across</text>`,
    '0 0 300 220',
    '/probe/',
  );
  assert.equal(drawn.arrows.length, 1, 'the shaft was not classified as an arrow');
  assert.equal(drawn.boxes.length, 1, 'the form was not classified as a box');
  const faults = strayArrows(drawn);
  assert.equal(faults.length, 1, 'the shaft over the form raised no fault');
  assert.match(faults[0], /starts at neither end of it/);
});

/* The other half of the rule, and the shape NoWayBack shipped: a shaft that
   never touches the form, drawn from one side of it to the other 20 units
   above it. The eye follows the shaft, and the form under it is on the path. */
test('faults an arrow carried clear past a form it never reaches', () => {
  const drawn = figure(
    `<rect x="60" y="20" width="200" height="2" fill="#000"/>${FORM}`,
    '0 0 300 220',
    '/probe/',
  );
  const faults = strayArrows(drawn);
  assert.equal(faults.length, 1, 'the sweep past the form raised no fault');
  assert.match(faults[0], /starts at neither end of it/);
});

test('clears an arrow that ends against the form it points at', () => {
  const drawn = figure(
    `<rect x="60" y="99" width="45" height="2" fill="#000"/>${FORM}`,
    '0 0 300 220',
    '/probe/',
  );
  assert.deepEqual(strayArrows(drawn), []);
});

/* A rule is a zero-width rect, so it is never the box that encloses the other
   one. The word has to straddle it, which is what the word that names a
   boundary does. */
const RULE = '<line x1="150" y1="20" x2="150" y2="200" stroke="#000" stroke-dasharray="2 6"/>';

test('faults a boundary rule drawn through the word that names it', () => {
  const drawn = figure(
    `${RULE}<text x="150" y="120" text-anchor="middle" class="diagram-boundary-label">seal</text>`,
    '0 0 300 220',
    '/probe/',
  );
  assert.equal(drawn.rules.length, 1, 'the dashed line was not classified as a rule');
  const faults = struckLabels(drawn);
  assert.equal(faults.length, 1, 'the rule through the word raised no fault');
  assert.match(faults[0], /runs through "seal"/);
});

test('clears a boundary rule that stops above the word that names it', () => {
  const drawn = figure(
    `${RULE}<text x="150" y="14" text-anchor="middle" class="diagram-boundary-label">seal</text>`,
    '0 0 300 220',
    '/probe/',
  );
  assert.deepEqual(struckLabels(drawn), []);
});

/*
 * The bound, against the metrics rather than against itself. Reading the
 * constants back out of the module that set them proves arithmetic and nothing
 * else; these are the numbers the renderer gave for the same face, so the
 * assertion fails both when the bound stops covering the run and when it grows
 * so far past it that a clearance the eye can see reads as a collision.
 */
test('bounds a centered run wider and taller than the face sets it', () => {
  const drawn = figure(
    '<text x="100" y="50" text-anchor="middle" class="diagram-label">metadata</text>',
    '0 0 200 100',
    '/probe/',
  );
  const [label] = drawn.labels;
  assert.ok(label.width >= 8 * 13 * 0.62, `8 characters bounded at ${label.width} units`);
  assert.ok(label.width <= 8 * 13 * 0.7, `8 characters bounded at ${label.width} units`);
  assert.equal(label.x, 100 - label.width / 2, 'a centered run is not centered on its own x');
  assert.ok(label.y <= 50 - 13, `the run rises ${50 - label.y} units above its baseline`);
  assert.ok(label.y >= 50 - 13 * 1.2, `the run rises ${50 - label.y} units above its baseline`);
  assert.ok(label.bottom >= 50 + 13 * 0.31, `the run drops ${label.bottom - 50} units`);
  assert.ok(label.bottom <= 50 + 13 * 0.5, `the run drops ${label.bottom - 50} units`);
});

test('refuses a label set in a size it cannot bound', () => {
  assert.throws(
    () => figure('<text x="10" y="20" class="caption">unsized</text>', '0 0 100 50', '/probe/'),
    /sets "unsized" in no known label size/,
  );
});
