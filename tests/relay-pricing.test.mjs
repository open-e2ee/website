import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { relayDevelopmentEnvironment, relayMeterDefinitions, relayPlans, relayProductionRetention } from '../src/data/relay-pricing.mjs';
import { virgilSecurityComparison } from '../src/data/virgil-security-comparison.mjs';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('publishes the exact approved Relay catalog from one data module', () => {
  assert.deepEqual(
    relayPlans.map(({ id, price, relayMau, deliveryUnits, attachmentOperations, storage, overage }) => ({
      id,
      price,
      relayMau,
      deliveryUnits,
      attachmentOperations,
      storage,
      overage,
    })),
    [
      { id: 'relay_free_v1', price: '$0', relayMau: '100', deliveryUnits: '100,000', attachmentOperations: '100,000', storage: '1 GB', overage: null },
      { id: 'relay_starter_v1', price: '$99', relayMau: '1,000', deliveryUnits: '500,000', attachmentOperations: '500,000', storage: '10 GB', overage: { relayMau: '$0.05', delivery: '$55 per million', storage: '$0.50 per GB-month' } },
      { id: 'relay_growth_v1', price: '$299', relayMau: '5,000', deliveryUnits: '2,500,000', attachmentOperations: '2,500,000', storage: '50 GB', overage: { relayMau: '$0.03', delivery: '$55 per million', storage: '$0.50 per GB-month' } },
      { id: 'relay_business_v1', price: '$899', relayMau: '25,000', deliveryUnits: '12,500,000', attachmentOperations: '12,500,000', storage: '250 GB', overage: { relayMau: '$0.02', delivery: '$55 per million', storage: '$0.50 per GB-month' } },
      { id: 'relay_enterprise_v1', price: 'Custom', relayMau: 'Negotiated', deliveryUnits: 'Negotiated', attachmentOperations: 'Negotiated', storage: 'Negotiated', overage: null },
    ],
  );
  assert.deepEqual(relayDevelopmentEnvironment, {
    relayMau: '25 test accounts',
    deliveryUnits: '25,000',
    attachmentOperations: '25,000',
    storage: '250 MB',
    detail: 'Created automatically for each project. It uses isolated state and credentials, 24-hour default retention, a seven-day retention maximum, and suspension after 30 inactive days.',
  });
  assert.equal(relayMeterDefinitions.length, 4);
  assert.equal(relayProductionRetention, 'Up to 30 days');
});

test('keeps the comparison factual, dated, sourced, and explicit about the 5,000-user ambiguity', async () => {
  const page = await source('src/pages/compare/virgil-security.astro');
  assert.equal(virgilSecurityComparison.verifiedAt, '2026-08-26');
  assert.equal(virgilSecurityComparison.sources.length, 3);
  assert.deepEqual(virgilSecurityComparison.virgilBands[1], ['251–5,000 registered users', '$99 per month']);
  assert.deepEqual(virgilSecurityComparison.virgilBands[2], ['5,000–100,000 registered users', '$0.019 per registered user per month']);
  assert.match(page, /different parts of an encrypted application/i);
  assert.match(page, /about \$95 to \$99 unless Virgil clarifies/i);
  assert.match(page, /Fairness note:/);
  assert.match(page, /Virgil vendor fee \+ customer messaging backend/);
  assert.doesNotMatch(page, /Virgil (?:is )?(?:cheaper|more expensive|equivalent)/i);
});

test('publishes canonical Relay routes with accessible responsive tables', async () => {
  const relay = await source('src/pages/relay/index.astro');
  const pricing = await source('src/pages/pricing.astro');
  const comparison = await source('src/pages/compare/virgil-security.astro');
  assert.match(relay, /canonical="\/relay"/);
  assert.match(relay, /OPEN_E2EE_RELAY_URL/);
  assert.match(relay, /public configuration, not a credential/i);
  assert.match(relay, /do not select a Relay hostname or pair/i);
  assert.match(pricing, /canonical="\/pricing"/);
  assert.match(comparison, /canonical="\/compare\/virgil-security"/);
  /* Every wide table goes through the one component that carries the
     accessibility contract, and each one names what it holds. Written out at
     the table, two of the five call sites carried the scroll recipe and
     neither of the attributes that let a keyboard reader reach what scrolls
     past the right edge. */
  assert.match(comparison, /<TableScroll label="[^"]+">/);
  /* The plan table is not wide: full width and fixed layout in its container,
     and out of the document below 62rem, it can never overflow its column. A
     scroll box around it is a tab stop that does nothing, and the one that
     stood there clipped the row tooltips and scrolled against the page. */
  assert.doesNotMatch(pricing, /TableScroll|overflow-x-auto|data-table-scroll/, 'the plan table has a scroll box it cannot use');
  for (const page of [pricing, comparison]) {
    assert.doesNotMatch(page, /<div class=\{TABLE_SCROLL\}/, 'a table dresses its own scroll box');
    assert.match(page, /<th scope="col"/);
    assert.match(page, /<th scope="row"[ >]/);
  }

  /* And that the component is the whole contract. A focusable box that cannot
     overflow is a tab stop that does nothing, and a region with no name is one
     a reader enters without being told what it is, so the four are asserted
     together in the file that writes them together. */
  const region = await source('src/components/TableScroll.astro');
  const box = region.match(/<div class="([^"]*)"([^>]*)>/);
  assert.ok(box, 'the region no longer dresses one box');
  assert.match(box[1], /\boverflow-x-auto\b/, 'the region has nothing to scroll');
  assert.match(box[2], /\stabindex="0"/, 'a keyboard cannot reach what scrolls');
  assert.match(box[2], /\srole="region"/);
  assert.match(box[2], /\saria-label=\{label\}/);
  assert.match(box[2], /\sdata-table-scroll\b/, 'scripts/relay-pages-visual.mjs measures no region');
});
