import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  relayLimitsChange,
  relayLimitsEffectiveAt,
  relayMeterDefinitions,
  relayPlans,
  relayPricingAt,
  relayPricingInstant,
  relayProductionRetention,
  relaySandboxEnvironment,
  upcomingRelayPlans,
} from '../src/data/relay-pricing.mjs';
import { virgilSecurityComparison, virgilSecurityComparisonAt } from '../src/data/virgil-security-comparison.mjs';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/*
 * Relay catalog relay_managed_2026_11_01_v1 lowers the Free and Sandbox limits
 * from 2026-11-01T00:00:00Z. Before that instant Relay enforces the Free and
 * Sandbox limits of relay_managed_2026_10_18_v1. The paid plans are the same
 * at every instant. Hobby waits outside the published plans until a dated
 * Relay terms version states it. Each assertion names its instant, so no
 * result depends on the day the suite runs.
 */
const beforeCut = new Date('2026-10-31T23:59:59.999Z');
const atCut = new Date('2026-11-01T00:00:00.000Z');

const figures = ({ id, price, relayMau, deliveryUnits, attachmentOperations, storage, overage }) => ({
  id,
  price,
  relayMau,
  deliveryUnits,
  attachmentOperations,
  storage,
  overage,
});

const earlierFree = { id: 'relay_free_v1', price: '$0', relayMau: '100', deliveryUnits: '100,000', attachmentOperations: '20,000', storage: '1 GB', overage: null };
const currentFree = { id: 'relay_free_v1', price: '$0', relayMau: '25', deliveryUnits: '12,500', attachmentOperations: '2,500', storage: '250 MB', overage: null };
const hobby = { id: 'relay_hobby_v1', price: '$9', relayMau: '100', deliveryUnits: '50,000', attachmentOperations: '10,000', storage: '1 GB', overage: { relayMau: '$0.10', delivery: '$400 per million', storage: '$2.00 per GB-month' } };
const paidAndEnterprise = [
  { id: 'relay_starter_v1', price: '$99', relayMau: '1,000', deliveryUnits: '500,000', attachmentOperations: '100,000', storage: '10 GB', overage: { relayMau: '$0.05', delivery: '$200 per million', storage: '$1.00 per GB-month' } },
  { id: 'relay_growth_v1', price: '$499', relayMau: '5,000', deliveryUnits: '2,500,000', attachmentOperations: '500,000', storage: '50 GB', overage: { relayMau: '$0.03', delivery: '$100 per million', storage: '$0.75 per GB-month' } },
  { id: 'relay_business_v1', price: '$999', relayMau: '25,000', deliveryUnits: '12,500,000', attachmentOperations: '2,500,000', storage: '250 GB', overage: { relayMau: '$0.02', delivery: '$60 per million', storage: '$0.55 per GB-month' } },
  { id: 'relay_enterprise_v1', price: 'Custom', relayMau: 'Negotiated', deliveryUnits: 'Negotiated', attachmentOperations: 'Negotiated', storage: 'Negotiated', overage: null },
];

const sandboxDetail = 'Created automatically for each project. It uses isolated state and credentials, 24-hour default retention, a seven-day retention maximum, and suspension after 30 inactive days.';
const earlierSandbox = { relayMau: '25 test accounts', deliveryUnits: '25,000', attachmentOperations: '25,000', storage: '250 MB', detail: sandboxDetail };
const currentSandbox = { relayMau: '5 test accounts', deliveryUnits: '10,000', attachmentOperations: '2,500', storage: '100 MB', detail: sandboxDetail };

test('publishes the exact approved Relay catalog from one data module', () => {
  assert.deepEqual(relayPricingAt(beforeCut).plans.map(figures), [earlierFree, ...paidAndEnterprise]);
  assert.deepEqual(relayPricingAt(atCut).plans.map(figures), [currentFree, ...paidAndEnterprise]);
  assert.deepEqual(upcomingRelayPlans.map(figures), [hobby]);
  assert.deepEqual(relayPricingAt(beforeCut).sandboxEnvironment, earlierSandbox);
  assert.deepEqual(relayPricingAt(atCut).sandboxEnvironment, currentSandbox);
  assert.equal(relayMeterDefinitions.length, 4);
  assert.equal(relayProductionRetention, 'Up to 30 days');
});

test('the module exports are the catalog at the build instant', () => {
  assert.ok(relayPricingInstant instanceof Date && !Number.isNaN(relayPricingInstant.getTime()));
  const atBuild = relayPricingAt(relayPricingInstant);
  assert.deepEqual(relayPlans, atBuild.plans);
  assert.deepEqual(relaySandboxEnvironment, atBuild.sandboxEnvironment);
  assert.deepEqual(relayLimitsChange, atBuild.limitsChange);
});

test('orders the plans Free, Starter, Growth, Business, then Enterprise at every instant', () => {
  for (const at of [new Date('2026-10-23T00:00:00Z'), beforeCut, atCut, new Date('2027-01-01T00:00:00Z')]) {
    const { plans } = relayPricingAt(at);
    assert.deepEqual(plans.map(({ name }) => name), ['Free', 'Starter', 'Growth', 'Business', 'Enterprise'], at.toISOString());
    assert.deepEqual(plans.map(({ id }) => id), ['relay_free_v1', 'relay_starter_v1', 'relay_growth_v1', 'relay_business_v1', 'relay_enterprise_v1'], at.toISOString());
  }
});

/*
 * The Relay catalog sells Hobby, but the dated Relay terms relay-2026-10-18
 * do not state it. Hobby waits in its own export until a dated terms version
 * states it. The pull request that adds that version moves Hobby into the
 * published plans between Free and Starter.
 */
test('holds Hobby at 9 USD per month out of the published plans until a dated terms version states it', () => {
  assert.equal(upcomingRelayPlans.length, 1);
  const [plan] = upcomingRelayPlans;
  assert.deepEqual(figures(plan), hobby);
  assert.equal(plan.name, 'Hobby');
  assert.equal(plan.monthlyPriceUsd, 9);
  assert.equal(plan.detail, 'Per month. Optional overage needs explicit acceptance and a spend limit.');
  /* No dated terms version states Hobby yet. */
  assert.equal(plan.termsVersion, null);
  for (const at of [beforeCut, atCut, new Date('2027-01-01T00:00:00Z')]) {
    assert.ok(!relayPricingAt(at).plans.some(({ id }) => id === plan.id), at.toISOString());
  }
  assert.ok(!relayPlans.some(({ id }) => id === plan.id));
});

/*
 * The two terms guards compare the published plans with the dated terms. They
 * must read relayPlans and relaySandboxEnvironment, and never the plans that
 * wait for terms. A guard that read upcomingRelayPlans would block every build
 * until the new terms exist. A guard that read neither would pass on no plans.
 */
test('the terms guards scan the published plans only', async () => {
  const guards = {
    'tests/legal-pages.test.mjs': 'states every published price and included quantity in the Relay terms',
    'tests/relay-service-catalog.test.mjs': 'both current and immutable terms state the exact catalog rows',
  };
  for (const [path, name] of Object.entries(guards)) {
    const file = await source(path);
    const start = file.indexOf(`test('${name}'`);
    assert.ok(start >= 0, `${path} lost the guard "${name}"`);
    const body = file.slice(start, file.indexOf('\n});', start));
    assert.match(body, /\bof relayPlans\b/, `${path} does not scan relayPlans`);
    assert.doesNotMatch(file, /upcomingRelayPlans/, `${path} reads the plans that wait for terms`);
  }
});

test('Free and Sandbox change their limits at 2026-11-01T00:00:00Z and at no other instant', () => {
  assert.equal(relayLimitsEffectiveAt.toISOString(), '2026-11-01T00:00:00.000Z');
  const free = (at) => figures(relayPricingAt(at).plans[0]);
  for (const at of [new Date('2026-10-18T00:00:00Z'), new Date('2026-10-23T12:00:00Z'), beforeCut]) {
    assert.deepEqual(free(at), earlierFree, at.toISOString());
    assert.deepEqual(relayPricingAt(at).sandboxEnvironment, earlierSandbox, at.toISOString());
  }
  for (const at of [atCut, new Date('2026-11-01T00:00:00.001Z'), new Date('2027-06-01T00:00:00Z')]) {
    assert.deepEqual(free(at), currentFree, at.toISOString());
    assert.deepEqual(relayPricingAt(at).sandboxEnvironment, currentSandbox, at.toISOString());
  }
  /* The paid plans do not move at the cut. */
  assert.deepEqual(relayPricingAt(beforeCut).plans.slice(1), relayPricingAt(atCut).plans.slice(1));
  assert.equal(relayPricingAt(beforeCut).plans[0].detail, relayPricingAt(atCut).plans[0].detail);
});

test('names the new Free and Sandbox limits and their date only before the cut', () => {
  assert.deepEqual(relayPricingAt(beforeCut).limitsChange, {
    effectiveAt: '2026-11-01T00:00:00.000Z',
    date: 'November 1, 2026',
    free: { relayMau: '25', deliveryUnits: '12,500', attachmentOperations: '2,500', storage: '250 MB' },
    sandbox: { relayMau: '5 test accounts', deliveryUnits: '10,000', attachmentOperations: '2,500', storage: '100 MB' },
    note: 'Free and Sandbox limits change on November 1, 2026 UTC. '
      + 'Free then includes 25 Relay MAU, 12,500 delivery units, 2,500 attachment uploads, and 250 MB storage. '
      + 'Sandbox then includes 5 test accounts, 10,000 delivery units, 2,500 attachment uploads, and 100 MB storage.',
  });
  assert.equal(relayPricingAt(atCut).limitsChange, null);
  assert.equal(relayPricingAt(new Date('2027-01-01T00:00:00Z')).limitsChange, null);
});

test('prices the comparison rows from the plans in effect at each instant', () => {
  assert.deepEqual(virgilSecurityComparison, virgilSecurityComparisonAt(relayPricingInstant));
  const before = virgilSecurityComparisonAt(beforeCut).stickerPrices;
  const after = virgilSecurityComparisonAt(atCut).stickerPrices;
  /* 100 Relay MAU fit Free before the cut. From the cut the lowest published
     plan that includes them is Starter, because Hobby is not published. */
  assert.deepEqual(before[0], ['100', 'Free', 'Free', 'Virgil counts registered users; OpenE2EE counts monthly active accounts.']);
  assert.deepEqual(after[0], ['100', 'Free', '$99', 'Virgil counts registered users; OpenE2EE counts monthly active accounts.']);
  assert.deepEqual(before[1], ['250', 'Free', '$99', 'OpenE2EE Free ends at 100 Relay MAU because Relay also supplies delivery infrastructure.']);
  assert.deepEqual(after[1], ['250', 'Free', '$99', 'OpenE2EE Free ends at 25 Relay MAU because Relay also supplies delivery infrastructure.']);
  for (const rows of [before, after]) {
    assert.deepEqual(rows.slice(2).map((row) => row[2]), ['$99', '$499', '$999']);
  }
  assert.deepEqual(before.slice(2), after.slice(2));
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
  /* BaseLayout derives the canonical from the served path, and
     tests/index-hygiene.test.mjs checks it on the built page. */
  for (const page of [relay, pricing, comparison]) assert.doesNotMatch(page, /\bcanonical=/);
  assert.match(relay, /OPEN_E2EE_RELAY_URL/);
  assert.match(relay, /public configuration, not a credential/i);
  assert.match(relay, /do not select a Relay hostname or pair/i);
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
