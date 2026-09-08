/*
 * /pricing leads with the Relay, and the Relay reads as a table.
 *
 * The page sold four SDK commercial licenses and named no Relay plan. Its
 * first rebuild put five plan columns on the page as prose lists, so a reader
 * comparing one meter across plans read five places, and the meters a buyer
 * does arithmetic on sat on another route.
 *
 * This file asserts the shape the page keeps now: the self-service plans are
 * the columns of one table and the meters are its rows, in catalog order,
 * priced larger than they are named; one plan is marked and carries the filled
 * action; Enterprise is one outlined band under them; the same rows render
 * again as one block per plan for narrow viewports; and the licensing section
 * follows, raised once the plans are read.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { relayPlans, relayProductionRetention } from '../src/data/relay-pricing.mjs';
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

const selfServe = relayPlans.filter((plan) => plan.monthlyPriceUsd !== null);
const enterprise = relayPlans.find((plan) => plan.monthlyPriceUsd === null);

/* The founder's 2026-09-07 call in docs/decisions.md: Starter carries the label. */
const HIGHLIGHT = 'relay_starter_v1';
const HIGHLIGHT_LABEL = 'Most popular';

/** The Enterprise band, from its marker to the section after the plans. */
function enterpriseBand() {
  const start = built.indexOf(`data-relay-plan="${enterprise.id}"`);
  assert.ok(start !== -1, 'Enterprise has no band');
  return built.slice(start, built.indexOf('id="development"', start));
}

/** The plan table, from its opening tag to its close. */
const table = (() => {
  const start = built.indexOf('<table');
  const end = built.indexOf('</table>', start);
  assert.ok(start !== -1 && end !== -1, 'the page carries no table');
  return built.slice(start, end);
})();

/** The column head for one plan, from its marker to the next head or the body. */
function columnHead(id) {
  const start = table.indexOf(`data-relay-plan="${id}"`);
  if (start === -1) return null;
  const next = table.indexOf('<th scope="col"', start + 1);
  const body = table.indexOf('<tbody', start);
  return table.slice(start, next === -1 ? body : Math.min(next, body));
}

/** The compact block for one plan, from its marker to the next block or the list's end. */
function compactBlock(id) {
  const start = built.indexOf(`data-relay-plan-compact="${id}"`);
  if (start === -1) return null;
  const next = built.indexOf('<li ', start + 1);
  const end = built.indexOf('</ul>', start);
  return built.slice(start, next === -1 ? end : Math.min(next, end));
}

/** The rem value of a `text-[...]` utility, taking a clamp at its minimum. */
function textRem(classes) {
  const utility = classes.match(/text-\[(?:length:)?([^\]]+)\]/);
  if (!utility) return null;
  const value = utility[1].startsWith('clamp(') ? utility[1].slice(6).split(',')[0] : utility[1];
  const rem = value.match(/^([\d.]+)rem$/);
  return rem ? Number(rem[1]) : null;
}

/** The cells of one table row, by its row heading. */
function cells(label) {
  const row = table.match(new RegExp(`<th scope="row">${label}</th>((?:<td>[^<]*</td>)+)</tr>`));
  assert.ok(row, `the table has no row headed ${label}`);
  return [...row[1].matchAll(/<td>([^<]*)<\/td>/g)].map((match) => match[1]);
}

test('the self-service plans are the columns of one table, in catalog order', () => {
  /* The head's class carries a `>` (a child-combinator variant), so the
   * markers are read from the head as a whole rather than tag by tag. */
  const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
  const columns = [...head.matchAll(/data-relay-plan="([^"]+)"/g)].map((m) => m[1]);
  assert.equal((head.match(/<th scope="col"/g) ?? []).length, columns.length, 'a column head is not a th');
  assert.deepEqual(
    columns,
    selfServe.map((plan) => plan.id),
    'the table columns are not the self-service catalog, in catalog order',
  );

  for (const plan of selfServe) {
    const head = columnHead(plan.id);
    assert.ok(head.includes(`>${plan.name}</h3>`), `${plan.id} is not headed ${plan.name}`);
    assert.ok(head.includes(`>${plan.price}</p>`), `${plan.id} does not print ${plan.price}`);
    assert.match(head, /<a class="oe-button[^"]*" href="https:\/\/console\.open-e2ee\.dev\/relay\/new/);
  }

  /* Rendered from the catalog, not typed. A page that lists the plans by hand
   * passes the assertions above on the day it ships and drifts from the
   * product contract at the next plan change. */
  assert.match(source, /selfServe\.map\(/);
  assert.doesNotMatch(source, /<h3[^>]*>Starter</);
});

test('the meters are the rows, and every cell comes from the catalog', () => {
  assert.deepEqual(cells('Relay MAU'), selfServe.map((plan) => plan.relayMau));
  assert.deepEqual(cells('Delivery units'), selfServe.map((plan) => plan.deliveryUnits));
  assert.deepEqual(cells('Attachment uploads'), selfServe.map((plan) => plan.attachmentOperations));
  assert.deepEqual(cells('Storage'), selfServe.map((plan) => plan.storage));

  /* The overage a buyer does arithmetic on sits under the plan it prices. Free
   * has none: its caps are hard, and the cell says so rather than printing a
   * dash a reader has to interpret. */
  assert.deepEqual(cells('Additional MAU'), selfServe.map((plan) => plan.overage?.relayMau ?? 'Hard cap'));
  assert.deepEqual(cells('Additional delivery units'), selfServe.map((plan) => plan.overage?.delivery ?? 'Hard cap'));
  assert.deepEqual(cells('Additional storage'), selfServe.map((plan) => plan.overage?.storage ?? 'Hard cap'));
  assert.deepEqual(cells('Ciphertext retention'), selfServe.map(() => relayProductionRetention));

  /* The price under every name already reads "per month", and the note under
   * the table says the allowances are monthly once. A row label that says it
   * again is the explainer this page shed. */
  const labels = [...table.matchAll(/<th scope="row">([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.equal(labels.length, 8, `the table has ${labels.length} rows, not eight`);
  for (const label of labels) assert.doesNotMatch(label, /per month|[Ee]xact|[Ee]xcess|operations/, `row label "${label}"`);
  assert.match(built.slice(built.indexOf('</table>'), built.indexOf('id="development"')), /allowances are monthly/);
});

test('one plan is marked, and it alone carries the filled action', () => {
  const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
  assert.equal(head.split(`>${HIGHLIGHT_LABEL}<`).length - 1, 1, `the head does not carry "${HIGHLIGHT_LABEL}" exactly once`);
  assert.ok(columnHead(HIGHLIGHT).includes(`>${HIGHLIGHT_LABEL}<`), `${HIGHLIGHT} is not the marked column`);
  assert.equal((head.match(/<col class="bg-ground-panel">/g) ?? []).length, 0, 'the tint is on a head cell, not a column');
  const colgroup = table.slice(table.indexOf('<colgroup'), table.indexOf('</colgroup>'));
  assert.equal((colgroup.match(/<col class="bg-ground-panel">/g) ?? []).length, 1, 'exactly one column is tinted');
  assert.equal((colgroup.match(/<col[ >]/g) ?? []).length, selfServe.length + 1);
  assert.equal(
    [...colgroup.matchAll(/<col(?: class="([^"]*)")?>/g)].findIndex((m) => m[1] === 'bg-ground-panel') - 1,
    selfServe.findIndex((plan) => plan.id === HIGHLIGHT),
    'the tinted column is not the marked plan',
  );

  for (const plan of selfServe) {
    for (const rendering of [columnHead(plan.id), compactBlock(plan.id)]) {
      const classes = rendering.match(/<a class="(oe-button[^"]*)" href=/)[1];
      if (plan.id === HIGHLIGHT) assert.doesNotMatch(classes, /oe-button-secondary/, `${plan.id} is marked but not filled`);
      else assert.match(classes, /oe-button-secondary/, `${plan.id} is filled but not marked`);
      /* The lines under each button said what the note under the table and
       * "How buying works" already say. */
      assert.doesNotMatch(rendering, /Verified card|Billed monthly|Overage off|Start here/);
    }
  }
});

test('a paid plan names itself to the console, and the free plan needs no query', () => {
  for (const plan of selfServe) {
    const head = columnHead(plan.id);
    const href = head.match(/<a class="oe-button[^"]*" href="([^"]+)"/)[1];
    if (plan.id === 'relay_free_v1') {
      assert.equal(href, 'https://console.open-e2ee.dev/relay/new');
    } else {
      assert.equal(href, `https://console.open-e2ee.dev/relay/new?plan=${plan.id}`);
    }
    /* The console is the same product: the reader is leaving on purpose, and a
     * second tab holding the page they just read is litter. */
    assert.doesNotMatch(head, /target="_blank"/);
  }
});

test('the price is larger than the name it prices', () => {
  const heads = [
    ...selfServe.map((plan) => [plan.id, columnHead(plan.id)]),
    [enterprise.id, enterpriseBand()],
  ];
  for (const [id, head] of heads) {
    /* The price is the element directly after the heading, which is also the
     * reading order the column is built to produce. */
    const pair = head.match(/<h3 class="([^"]+)"[^>]*>[^<]*<\/h3><p class="([^"]+)">/);
    assert.ok(pair, `${id} does not print a price directly after its name`);
    const name = textRem(pair[1]);
    const price = textRem(pair[2]);
    assert.ok(name, `${id} names itself at no measurable size`);
    assert.ok(price, `${id} prices itself at no measurable size`);
    assert.ok(price > name, `${id} prints its name at ${name}rem over its price at ${price}rem`);
  }
});

test('the narrow rendering carries the same plans, rows, and actions', () => {
  const compact = [...built.matchAll(/data-relay-plan-compact="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(compact, selfServe.map((plan) => plan.id));

  for (const plan of selfServe) {
    const block = compactBlock(plan.id);
    const head = columnHead(plan.id);
    assert.ok(block.includes(`>${plan.name}</h3>`), `${plan.id} compact block is not headed ${plan.name}`);
    assert.ok(block.includes(`>${plan.price}</p>`), `${plan.id} compact block does not print ${plan.price}`);
    assert.equal(
      block.match(/<a class="oe-button[^"]*" href="([^"]+)"/)[1],
      head.match(/<a class="oe-button[^"]*" href="([^"]+)"/)[1],
      `${plan.id} opens two different routes in its two renderings`,
    );
    for (const label of ['Relay MAU', 'Additional MAU', 'Ciphertext retention']) {
      assert.ok(block.includes(`<dt>${label}</dt>`), `${plan.id} compact block has no ${label} row`);
    }
  }

  /* One rendering is in the document at a time: the table above 62rem, the
   * blocks below it. Both classes are written where the two are declared. */
  assert.match(source, /const PLAN_TABLE_AT = 'max-\[62rem\]:hidden'/);
  assert.match(source, /const COMPACT = '[^']*\bmin-\[62rem\]:hidden\b/);
});

test('Enterprise is one outlined band under the table, with its own action', () => {
  const start = built.indexOf(`data-relay-plan="${enterprise.id}"`);
  assert.ok(start > built.indexOf('</table>'), 'Enterprise is not below the table');
  assert.ok(start > built.indexOf('data-relay-plan-compact='), 'Enterprise is not below the compact blocks');

  /* The band is outlined on every side with the house hairline and sits on the
   * panel ground, so it reads as the table's last row and not as a footnote. */
  const opening = built.slice(built.lastIndexOf('<div', start), start);
  const classes = opening.match(/class="([^"]+)"/)[1];
  assert.match(classes, /\brule\b/, `the Enterprise band has no hairline: ${classes}`);
  assert.match(classes, /\bbg-ground-panel\b/, `the Enterprise band has no ground: ${classes}`);
  assert.doesNotMatch(classes, /rule-t/);

  const band = enterpriseBand();
  assert.ok(band.includes(`>${enterprise.name}</h3>`));
  assert.ok(band.includes(`>${enterprise.price}</p>`));
  assert.match(band, /<a class="oe-button oe-button-secondary" href="mailto:licensing@open-e2ee\.dev/);
});

test('the licensing section follows the plans, raised in context above it', () => {
  const anchor = built.indexOf('href="#licensing"');
  const plans = built.indexOf('id="relay-plans"');
  const lastPlan = built.indexOf(`data-relay-plan="${enterprise.id}"`);
  const licensing = built.indexOf('id="licensing"');

  assert.ok(anchor !== -1, 'the page carries no in-page link to the licensing section');
  assert.ok(licensing !== -1, 'the page carries no licensing section to link to');
  assert.ok(plans < licensing, 'the licensing section is not below the Relay plans');

  /* The link is raised where a reader has just read the plans and can weigh
   * the other way of running the code, not in the hero ahead of them. */
  assert.ok(lastPlan < anchor, 'the licensing link is raised before the Relay plans are read');
  assert.ok(anchor < licensing, 'the licensing link is not above the section it points at');

  /* Every license tier still prices itself on the page it moved down within,
   * so the move did not quietly become a deletion. */
  for (const tier of tiers) {
    assert.ok(
      built.slice(licensing).includes(tier.price),
      `the licensing section does not price ${tier.name}`,
    );
  }
});

test('the meters and the Development environment are on this page', () => {
  const meters = built.indexOf('id="meters"');
  const development = built.indexOf('id="development"');
  const licensing = built.indexOf('id="licensing"');
  assert.ok(development !== -1 && meters !== -1, 'the page dropped a section the limits page carried');
  assert.ok(development < meters && meters < licensing, 'the sections are out of the order the page argues');
  for (const meter of ['Relay MAU', 'Delivery unit', 'Attachment upload', 'Storage']) {
    assert.ok(built.slice(meters, licensing).includes(`<dt>${meter}</dt>`), `${meter} is not defined`);
  }
  assert.match(built.slice(development, meters), />Development environment<\/h3>/);
});

test('no two tiers on the page answer to the same name', () => {
  /* The compact rendering repeats each self-service heading by design, so the
   * names are read once from the table and once from the ruled rows. */
  const headings = [...built.matchAll(/<h3 class="[^"]*"(?: itemprop="name")?>([^<]+)<\/h3>/g)].map((m) => m[1]);
  const names = new Set(headings);

  assert.equal(
    names.size,
    relayPlans.length + tiers.length + 1,
    `expected ${relayPlans.length + tiers.length + 1} tier names, found ${[...names]}`,
  );

  /* `Growth` names a Relay plan at $299 a month and an SDK commercial license
   * at $20,000 a year. Neither name may move — the catalog is the approved
   * product contract, and the license is a Stripe product the Console bills
   * against — so the license heading carries the word that separates them. */
  assert.ok(names.has('Growth'), 'the Relay plan Growth is not a heading');
  assert.ok(names.has('Growth license'), 'the Growth license is not headed as a license');
});

test('the page names no differentiator the product contract does not define', () => {
  for (const phrase of [
    'approved operational controls',
    'evidence-backed',
    'Plans differ by capacity, support, service terms',
  ]) {
    assert.ok(!built.includes(phrase), `the page still says "${phrase}"`);
  }
});
