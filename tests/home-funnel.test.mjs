/*
 * The homepage leads with OpenE2EE Relay and offers a free start.
 *
 * The page sold the SDK alone. The Relay was one navigation word and one
 * sentence inside the last row of a deck. The only route into the Console was
 * the word "Console" in the utility strip, sixteen pixels from a theme toggle,
 * and it was hidden below 62rem. A reader who arrived ready to start could not
 * see where to.
 *
 * This file asserts the funnel the rebuilt page carries: a filled primary
 * action into the Console, the demo demoted to the secondary, and the free plan
 * named from the catalog before the demo band runs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { relayPlans } from '../src/data/relay-pricing.mjs';

const built = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
  () => null,
);

/*
 * Read loudly rather than skipping. Every assertion below is about rendered
 * markup, so a missing build would turn the whole file green while the page it
 * describes had never been produced.
 */
assert.ok(built, 'dist/index.html is missing; run npm run build before npm test');

const source = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');

const free = relayPlans[0];

/** The markup of one action row, from its hook to the end of the element. */
function actionRow(hook) {
  const start = built.indexOf(`data-actions="${hook}"`);
  if (start === -1) return null;
  const end = built.indexOf('</div>', start);
  return built.slice(start, end === -1 ? undefined : end);
}

test('the hero starts a Relay project, and the demo follows it', () => {
  const row = actionRow('hero');
  assert.ok(row, 'the hero sets no action row this test can read');

  const anchors = [...row.matchAll(/<a\s[^>]*>/g)].map((match) => match[0]);
  assert.equal(anchors.length, 2, `the hero offers ${anchors.length} actions; two is the decision`);

  const [start, demo] = anchors;

  /* The primary is the free start, and the click leaves this site. A page that
   * sells a managed product and offers no route into it is a brochure. */
  assert.match(
    start,
    /href="https:\/\/console\.open-e2ee\.dev\//,
    'the hero leads with something other than the Console',
  );
  assert.match(demo, /href="#demo"/, 'the demo is not the second action');

  /* Read the controls rather than the anchors: the primary carries its label
   * and its terms in two spans under one anchor, so the fill is on a child.
   * Exactly one of the two is filled, because two filled buttons state no
   * order, which is the state this row exists to remove. */
  const controls = [...row.matchAll(/class="[^"]*\boe-button\b[^"]*"/g)].map((match) => match[0]);
  assert.equal(controls.length, 2, `the hero row draws ${controls.length} controls for two actions`);

  const filled = controls.filter((control) => !control.includes('oe-button-secondary'));
  assert.equal(filled.length, 1, `the hero row carries ${filled.length} filled controls`);
  assert.equal(controls[0], filled[0], 'the free start is not the filled control');
});

test('the free plan is named, from the catalog, before the demo runs', () => {
  const named = built.indexOf(`>${free.name}<`);
  const demo = built.indexOf('id="demo"');

  assert.ok(named !== -1, `the page never names the ${free.name} plan`);
  assert.ok(demo !== -1, 'the page carries no demo to sit above');
  assert.ok(named < demo, `the ${free.name} plan is named below the demo band`);

  /* The capacity is the catalog's, rendered rather than typed. A page that
   * repeats the numbers by hand passes on the day it ships and drifts from the
   * product contract at the next capacity change. */
  const band = built.slice(named, demo);
  const capacity = [
    `${free.relayMau} Relay MAU`,
    `${free.deliveryUnits} delivery units`,
    `${free.storage} storage`,
  ];
  for (const value of capacity) {
    assert.ok(band.includes(value), `the band does not carry the catalog's "${value}"`);
  }
  assert.match(source, /relayPlans/, 'the page does not read the Relay catalog');
});

/*
 * A glyph that renders as emoji by default, plus a text-default pictograph that
 * a variation selector forces into emoji. `Extended_Pictographic` alone is the
 * wrong reading: it holds the copyright sign the footer sets, which is
 * typography rather than decoration.
 */
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/gu;

test('the page sets no emoji', () => {
  const emoji = [...built.matchAll(EMOJI)].map((match) => match[0]);
  assert.deepEqual(emoji, [], `the page sets ${emoji.length} emoji: ${emoji.join(' ')}`);
});
