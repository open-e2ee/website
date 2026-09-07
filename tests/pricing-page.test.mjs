/*
 * /pricing leads with the Relay.
 *
 * The page sold four SDK commercial licenses and named no Relay plan. The
 * flagship was one ruled row among them, priced "Free then $99 per month",
 * carrying no action a reader could take. A visitor who came to buy delivery
 * capacity could not find a tier, a limit, or a button.
 *
 * This file asserts the shape the rebuilt page keeps: every plan in the
 * catalog, in catalog order, priced larger than it is named, ahead of a
 * licensing section the top of the page links to.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { relayPlans } from '../src/data/relay-pricing.mjs';
import { tiers } from '../src/data/pricing.mjs';

const built = await readFile(new URL('../dist/pricing/index.html', import.meta.url), 'utf8').catch(
  () => null,
);

/*
 * Read loudly rather than skipping. Every other assertion here is about
 * rendered markup, so a missing build would turn this whole file green while
 * the page it describes had never been produced.
 */
assert.ok(built, 'dist/pricing/index.html is missing; run npm run build before npm test');

const source = await readFile(new URL('../src/pages/pricing.astro', import.meta.url), 'utf8');

/** The `<li>` for one Relay plan, from its marker to the end of the row. */
function relayRow(id) {
  const start = built.indexOf(`data-relay-plan="${id}"`);
  if (start === -1) return null;
  const end = built.indexOf('<li ', start);
  return built.slice(start, end === -1 ? built.indexOf('</ul>', start) : end);
}

/** The rem value of a `text-[...]` utility, taking a clamp at its minimum. */
function textRem(classes) {
  const utility = classes.match(/text-\[(?:length:)?([^\]]+)\]/);
  if (!utility) return null;
  const value = utility[1].startsWith('clamp(') ? utility[1].slice(6).split(',')[0] : utility[1];
  const rem = value.match(/^([\d.]+)rem$/);
  return rem ? Number(rem[1]) : null;
}

test('the page leads with every Relay plan, in catalog order', () => {
  const rendered = [...built.matchAll(/data-relay-plan="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(
    rendered,
    relayPlans.map((plan) => plan.id),
    'the rendered plans are not the catalog, in catalog order',
  );

  for (const plan of relayPlans) {
    const row = relayRow(plan.id);
    assert.ok(row, `${plan.id} has no row`);
    assert.ok(row.includes(`>${plan.name}</h3>`), `${plan.id} is not headed ${plan.name}`);
    assert.ok(row.includes(`>${plan.price}</p>`), `${plan.id} does not print ${plan.price}`);
  }

  /* Rendered from the catalog, not typed. A page that lists the plans by hand
   * passes the assertions above on the day it ships and drifts from the
   * product contract at the next plan change. */
  assert.match(source, /relayTiers\.map\(/);
  assert.doesNotMatch(source, /<h3[^>]*>Starter</);
});

test('the price is larger than the name it prices', () => {
  for (const plan of relayPlans) {
    const row = relayRow(plan.id);
    /* The price is the element directly after the heading, which is also the
     * reading order the row is built to produce. */
    const pair = row.match(/<h3 class="([^"]+)">[^<]*<\/h3><p class="([^"]+)">/);
    assert.ok(pair, `${plan.id} does not print a price directly after its name`);
    const name = textRem(pair[1]);
    const price = textRem(pair[2]);

    assert.ok(name, `${plan.id} names itself at no measurable size`);
    assert.ok(price, `${plan.id} prices itself at no measurable size`);
    assert.ok(
      price > name,
      `${plan.id} prints its name at ${name}rem over its price at ${price}rem`,
    );
  }
});

test('the licensing section follows the plans, behind an anchor the top links', () => {
  const anchor = built.indexOf('href="#licensing"');
  const plans = built.indexOf('id="relay-plans"');
  const licensing = built.indexOf('id="licensing"');

  assert.ok(anchor !== -1, 'the page carries no in-page link to the licensing section');
  assert.ok(licensing !== -1, 'the page carries no licensing section to link to');
  assert.ok(anchor < plans, 'the licensing link is not at the top of the page');
  assert.ok(plans < licensing, 'the licensing section is not below the Relay plans');

  /* Every license tier still prices itself on the page it moved down within,
   * so the move did not quietly become a deletion. */
  for (const tier of tiers) {
    assert.ok(
      built.slice(licensing).includes(tier.price),
      `the licensing section does not price ${tier.name}`,
    );
  }
});

test('no two tiers on the page answer to the same name', () => {
  const headings = [...built.matchAll(/<h3 class="[^"]*">([^<]+)<\/h3>/g)].map((match) => match[1]);

  assert.equal(
    headings.length,
    relayPlans.length + tiers.length,
    `expected ${relayPlans.length + tiers.length} tier headings, found ${headings.length}`,
  );
  assert.equal(new Set(headings).size, headings.length, `a name is used twice: ${headings}`);

  /* `Growth` names a Relay plan at $299 a month and an SDK commercial license
   * at $20,000 a year. Neither name may move — the catalog is the approved
   * product contract, and the license is a Stripe product the Console bills
   * against — so the license heading carries the word that separates them. */
  assert.ok(headings.includes('Growth'), 'the Relay plan Growth is not a heading');
  assert.ok(headings.includes('Growth license'), 'the Growth license is not headed as a license');
});
