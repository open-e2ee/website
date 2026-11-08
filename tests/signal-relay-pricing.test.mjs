import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  signalRelayLimitsChange,
  signalRelayMeterDefinitions,
  signalRelayPlans,
  signalRelayPricingAt,
  signalRelayPricingInstant,
  signalRelayProductionRetention,
  signalRelaySandboxEnvironment,
  upcomingSignalProtocolRelayPlans,
} from '../src/data/signal-relay-pricing.mjs';
import { virgilSecurityComparison, virgilSecurityComparisonAt } from '../src/data/virgil-security-comparison.mjs';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/*
 * Free and Sandbox retain their qualified targets before and after the former
 * November 1 cut. Date changes do not qualify a new public catalog or terms.
 */
const beforeCut = new Date('2026-10-31T23:59:59.999Z');
const atCut = new Date('2026-11-01T00:00:00.000Z');
const afterCut = new Date('2026-11-01T00:00:00.001Z');
const futureBuild = new Date('2030-01-01T00:00:00Z');
const buildInstants = [new Date('2026-10-18T00:00:00Z'), beforeCut, atCut, afterCut, futureBuild];

const figures = ({ id, price, signalRelayMau, deliveryUnits, attachmentOperations, storage, overage }) => ({
  id,
  price,
  signalRelayMau,
  deliveryUnits,
  attachmentOperations,
  storage,
  overage,
});

const earlierFree = { id: 'relay_free_v1', price: '$0', signalRelayMau: '100', deliveryUnits: '100,000', attachmentOperations: '20,000', storage: '1 GB', overage: null };
const hobby = { id: 'relay_hobby_v1', price: '$9', signalRelayMau: '100', deliveryUnits: '50,000', attachmentOperations: '10,000', storage: '1 GB', overage: { signalRelayMau: '$0.10', delivery: '$400 per million', storage: '$2.00 per GB-month' } };
const paidAndEnterprise = [
  { id: 'relay_starter_v1', price: '$99', signalRelayMau: '1,000', deliveryUnits: '500,000', attachmentOperations: '100,000', storage: '10 GB', overage: { signalRelayMau: '$0.05', delivery: '$200 per million', storage: '$1.00 per GB-month' } },
  { id: 'relay_growth_v1', price: '$499', signalRelayMau: '5,000', deliveryUnits: '2,500,000', attachmentOperations: '500,000', storage: '50 GB', overage: { signalRelayMau: '$0.03', delivery: '$100 per million', storage: '$0.75 per GB-month' } },
  { id: 'relay_business_v1', price: '$999', signalRelayMau: '25,000', deliveryUnits: '12,500,000', attachmentOperations: '2,500,000', storage: '250 GB', overage: { signalRelayMau: '$0.02', delivery: '$60 per million', storage: '$0.55 per GB-month' } },
  { id: 'relay_enterprise_v1', price: 'Custom', signalRelayMau: 'Negotiated', deliveryUnits: 'Negotiated', attachmentOperations: 'Negotiated', storage: 'Negotiated', overage: null },
];

const sandboxDetail = 'Created automatically for each project. It uses isolated state and credentials, 24-hour default retention, a seven-day retention maximum, and suspension after 30 inactive days.';
const earlierSandbox = { signalRelayMau: '25 test accounts', deliveryUnits: '25,000', attachmentOperations: '25,000', storage: '250 MB', detail: sandboxDetail };

test('publishes the exact approved Relay catalog from one data module', () => {
  assert.deepEqual(signalRelayPricingAt(beforeCut).plans.map(figures), [earlierFree, ...paidAndEnterprise]);
  assert.deepEqual(signalRelayPricingAt(atCut).plans.map(figures), [earlierFree, ...paidAndEnterprise]);
  assert.deepEqual(upcomingSignalProtocolRelayPlans.map(figures), [hobby]);
  assert.deepEqual(signalRelayPricingAt(beforeCut).sandboxEnvironment, earlierSandbox);
  assert.deepEqual(signalRelayPricingAt(atCut).sandboxEnvironment, earlierSandbox);
  assert.equal(signalRelayMeterDefinitions.length, 4);
  assert.equal(signalRelayProductionRetention, 'Up to 30 days');
});

test('the module exports are the catalog at the build instant', () => {
  assert.ok(signalRelayPricingInstant instanceof Date && !Number.isNaN(signalRelayPricingInstant.getTime()));
  const atBuild = signalRelayPricingAt(signalRelayPricingInstant);
  assert.deepEqual(signalRelayPlans, atBuild.plans);
  assert.deepEqual(signalRelaySandboxEnvironment, atBuild.sandboxEnvironment);
  assert.deepEqual(signalRelayLimitsChange, atBuild.limitsChange);
});

test('orders the plans Free, Starter, Growth, Business, then Enterprise at every instant', () => {
  for (const at of [new Date('2026-10-23T00:00:00Z'), beforeCut, atCut, new Date('2027-01-01T00:00:00Z')]) {
    const { plans } = signalRelayPricingAt(at);
    assert.deepEqual(plans.map(({ name }) => name), ['Free', 'Starter', 'Growth', 'Business', 'Enterprise'], at.toISOString());
    assert.deepEqual(plans.map(({ id }) => id), ['relay_free_v1', 'relay_starter_v1', 'relay_growth_v1', 'relay_business_v1', 'relay_enterprise_v1'], at.toISOString());
  }
});

/*
 * The Relay catalog sells Hobby, but the dated Relay terms relay-2026-10-24
 * do not state it. Hobby waits in its own export until a dated terms version
 * states it. The pull request that adds that version moves Hobby into the
 * published plans between Free and Starter.
 */
test('holds Hobby at 9 USD per month out of the published plans until a dated terms version states it', () => {
  assert.equal(upcomingSignalProtocolRelayPlans.length, 1);
  const [plan] = upcomingSignalProtocolRelayPlans;
  assert.deepEqual(figures(plan), hobby);
  assert.equal(plan.name, 'Hobby');
  assert.equal(plan.monthlyPriceUsd, 9);
  assert.equal(plan.detail, 'Per month. Optional overage needs explicit acceptance and a spend limit.');
  /* No dated terms version states Hobby yet. */
  assert.equal(plan.termsVersion, null);
  for (const at of [beforeCut, atCut, new Date('2027-01-01T00:00:00Z')]) {
    assert.ok(!signalRelayPricingAt(at).plans.some(({ id }) => id === plan.id), at.toISOString());
  }
  assert.ok(!signalRelayPlans.some(({ id }) => id === plan.id));
});

/*
 * The two terms guards compare the published plans with the dated terms. They
 * must read signalRelayPlans and signalRelaySandboxEnvironment, and never the plans that
 * wait for terms. A guard that read upcomingSignalProtocolRelayPlans would block every build
 * until the new terms exist. A guard that read neither would pass on no plans.
 */
test('the terms guards scan the published plans only', async () => {
  const guards = {
    'tests/legal-pages.test.mjs': 'states every published price and included quantity in the Relay terms',
    'tests/signal-relay-service-catalog.test.mjs': 'both current and immutable terms state the exact catalog rows',
  };
  for (const [path, name] of Object.entries(guards)) {
    const file = await source(path);
    const start = file.indexOf(`test('${name}'`);
    assert.ok(start >= 0, `${path} lost the guard "${name}"`);
    const body = file.slice(start, file.indexOf('\n});', start));
    assert.match(body, /\bof signalRelayPlans\b/, `${path} does not scan signalRelayPlans`);
    assert.doesNotMatch(file, /upcomingSignalProtocolRelayPlans/, `${path} reads the plans that wait for terms`);
  }
});

test('a build date cannot qualify smaller Free or Sandbox limits', () => {
  for (const at of buildInstants) {
    assert.deepEqual(signalRelayPricingAt(at).plans.map(figures), [earlierFree, ...paidAndEnterprise], at.toISOString());
    assert.deepEqual(signalRelayPricingAt(at).sandboxEnvironment, earlierSandbox, at.toISOString());
  }
});

test('publishes no date-only limits announcement before or after the withdrawn cut', () => {
  for (const at of buildInstants) assert.equal(signalRelayPricingAt(at).limitsChange, null, at.toISOString());
  assert.equal(signalRelayLimitsChange, null);
});

test('prices the comparison rows from the qualified plans at every build instant', () => {
  assert.deepEqual(virgilSecurityComparison, virgilSecurityComparisonAt(signalRelayPricingInstant));
  const expected = virgilSecurityComparisonAt(beforeCut).stickerPrices;
  assert.deepEqual(expected[0], ['100', 'Free', 'Free', 'Virgil counts registered users; OpenE2EE counts monthly active accounts.']);
  assert.deepEqual(expected[1], ['250', 'Free', '$99', 'OpenE2EE Free ends at 100 Relay MAU because Relay also supplies delivery infrastructure.']);
  assert.deepEqual(expected.slice(2).map((row) => row[2]), ['$99', '$499', '$999']);
  for (const at of buildInstants) assert.deepEqual(virgilSecurityComparisonAt(at).stickerPrices, expected, at.toISOString());
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
  const signalRelay = await source('src/pages/signal-relay/index.astro');
  const pricing = await source('src/pages/pricing.astro');
  const comparison = await source('src/pages/compare/virgil-security.astro');
  /* BaseLayout derives the canonical from the served path, and
     tests/index-hygiene.test.mjs checks it on the built page. */
  for (const page of [signalRelay, pricing, comparison]) assert.doesNotMatch(page, /\bcanonical=/);
  assert.match(signalRelay, /OPEN_E2EE_RELAY_URL/);
  assert.match(signalRelay, /public configuration, not a credential/i);
  assert.match(signalRelay, /do not select a Relay hostname or pair/i);
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
  assert.match(box[2], /\sdata-table-scroll\b/, 'scripts/signal-relay-pages-visual.mjs measures no region');
});
