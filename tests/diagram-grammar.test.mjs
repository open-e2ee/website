/*
 * One relay, drawn one way.
 *
 * Five components drew a relay and they drew it four different ways: a bare
 * outlined rectangle holding two sheared slabs and no metadata ticks, a pair of
 * brackets at one size, a pair of brackets at another, and an outlined store
 * with hand-rolled ticks. A reader who meets three of them across two articles
 * has no way to know they are the same thing, and two of the four wore the org
 * mark's own construction while claiming to draw the reader's infrastructure.
 *
 * `DESIGN.md` under *Two relay forms* settles it. The brackets are the mark, so
 * they belong to a drawing whose subject is OpenE2EE Relay. Every diagram in an
 * article is a diagram of the reader's architecture, and takes the unbranded
 * container instead. `src/lib/relay-form.mjs` is the only place that container
 * is constructed, and these guards hold it there.
 *
 * The geometry the drawings produce is the other half, and
 * `tests/diagram-geometry.test.mjs` reads that from the built pages.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { relayContainer } from '../src/lib/relay-form.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/*
 * The five diagrams of infrastructure the reader operates. `RelayMailboxes` is
 * deliberately not among them: it stands on /relay, whose subject is OpenE2EE
 * Relay itself, and `DESIGN.md` gives that drawing the branded form.
 */
const READER_DIAGRAMS = [
  'ExpoKeyMap',
  'NoWayBack',
  'WhereQueriesRun',
  'WhereWorkMoves',
  'WhoHoldsPlaintext',
];

const source = (name) => read(`../src/components/diagrams/${name}.astro`);

/*
 * Comments removed before any negative is asserted. Each of these components
 * explains the construction it replaced — an opacity ramp, a pair of brackets —
 * so a negative read against the raw file forbids the file from saying what it
 * fixed.
 */
const body = async (name) => (await source(name)).replace(/\/\*[\s\S]*?\*\//g, '');

test('composes the relay from the one module in every diagram of the reader architecture', async () => {
  for (const name of READER_DIAGRAMS) {
    const flat = await body(name);
    assert.match(
      flat,
      /from '\.\.\/\.\.\/lib\/relay-form\.mjs'/,
      `${name} does not reach the module that owns the relay form`,
    );
    assert.match(flat, /relayContainer\(/, `${name} draws a relay of its own`);
  }
});

test('keeps the mark on the product page and off the reader architecture', async () => {
  /* The brackets are the org mark's construction. A node wearing them is a node
     claimed as OpenE2EE's, which is a claim about someone else's diagram. */
  for (const name of READER_DIAGRAMS) {
    assert.doesNotMatch(
      await body(name),
      /carrierBrackets|carrierBracketPaths/,
      `${name} draws the reader's own relay in the OpenE2EE mark`,
    );
  }

  /* And the exemplar still wears it. Without this half, deleting the brackets
     everywhere would read as a pass. */
  assert.match(
    await body('RelayMailboxes'),
    /carrierBrackets\(/,
    'the product page no longer draws the branded relay',
  );
});

test('never draws content as partly readable', async () => {
  /* `ExpoKeyMap` ramped four ratchet steps through 0.4, 0.58, 0.76 and 1, which
     says the older session state is 40 percent readable. Encryption produces no
     such state. The grammar module emits no `opacity` attribute at all, and
     neither may a drawing. */
  for (const name of [...READER_DIAGRAMS, 'RelayMailboxes']) {
    assert.doesNotMatch(await body(name), /opacity/, `${name} draws a partly readable state`);
  }
});

test('names the semantic fills rather than the tokens under them', async () => {
  /* A raw custom property in a component is a fill chosen by that component. The
     exported constants are the grammar's own names for them, so a token renamed
     in the design package reaches every drawing at once. */
  for (const name of [...READER_DIAGRAMS, 'RelayMailboxes']) {
    assert.doesNotMatch(
      await body(name),
      /--oe-diagram-(?:ciphertext-fill|plaintext-stroke|content-bar)/,
      `${name} writes a diagram token of its own`,
    );
  }
});

test('holds the relay construction the baseline pins', async () => {
  /*
   * The container, its tick runs and its slabs, for one canonical call. This is
   * the byte-for-byte record of what the five diagrams all draw: a change to the
   * padding, the gap, the tick spacing, or the order the parts are emitted in
   * moves every relay on the site, and has to be a decision rather than a
   * side effect.
   */
  const pinned = await read('../scripts/redesign-baseline/diagram-relay-form.txt');
  assert.equal(
    `${relayContainer({ x: 0, y: 0, width: 240, height: 140 })}\n`,
    pinned,
    'the relay form no longer matches scripts/redesign-baseline/diagram-relay-form.txt',
  );
});

test('refuses a relay that cannot hold what it is asked to hold', async () => {
  /* The three marks the form owns are only worth having if the form cannot be
     built without them. A slab too narrow for its tick run would otherwise ship
     a relay with the ticks silently overlapping, which reads as one wide slab. */
  assert.throws(
    () => relayContainer({ x: 0, y: 0, width: 90, height: 140, slabs: 3 }),
    /cannot carry/,
    'a relay narrower than its metadata is accepted',
  );
  assert.throws(
    () => relayContainer({ x: 0, y: 0, width: 240, height: 50 }),
    /no interior/,
    'a relay shorter than its own cargo is accepted',
  );
});
