import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { signalRelayPricingAt, upcomingSignalProtocolRelayPlans } from '../src/data/signal-relay-pricing.mjs';
import { signalRelayServiceCatalog } from '../src/data/signal-relay-service-catalog.mjs';

/*
 * The public guards compare the qualified plans with the dated terms. A date
 * cannot activate the proposed smaller limits or Hobby. Keep the exact missing
 * values below as evidence for the next qualified catalog and terms release.
 */
const TERMS = 'src/components/SignalProtocolRelayTerms20261105.astro';
const beforeCut = new Date('2026-10-31T23:59:59.999Z');

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/* The check in "states every published price and included quantity". */
function unstatedValues(terms, plans, sandbox) {
  const flat = terms.replace(/\s+/g, ' ');
  const missing = [];
  const states = (value, where) => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(?<![\\d.,])${escaped}(?![\\d.,])`).test(flat)) missing.push(`${where}: ${value}`);
  };
  for (const plan of plans) {
    states(plan.price, `the ${plan.name} price`);
    states(plan.signalRelayMau, `the ${plan.name} Relay MAU allowance`);
    states(plan.deliveryUnits, `the ${plan.name} delivery units`);
    states(plan.attachmentOperations, `the ${plan.name} attachment uploads`);
    states(plan.storage, `the ${plan.name} storage`);
    for (const [meter, rate] of Object.entries(plan.overage ?? {})) {
      states(rate, `the ${plan.name} ${meter} overage rate`);
    }
  }
  for (const [meter, value] of Object.entries(sandbox)) {
    if (meter === 'detail') continue;
    states(value, `the Sandbox environment ${meter}`);
  }
  return missing;
}

/* The check in "both current and immutable terms state the exact catalog rows". */
function unstatedRows(terms, plans) {
  const rows = [...terms.matchAll(/<tr><th scope="row">([^<]+)<\/th>(.*?)<\/tr>/g)];
  const mismatched = [];
  for (const plan of plans.filter(({ monthlyPriceUsd }) => monthlyPriceUsd !== null)) {
    const row = rows.find(([, name]) => name === plan.name);
    const stated = row ? [...row[2].matchAll(/<td>([^<]+)<\/td>/g)].map(([, cell]) => cell) : null;
    const due = [
      plan.price, plan.signalRelayMau, plan.deliveryUnits, plan.attachmentOperations, plan.storage,
      plan.overage?.signalRelayMau ?? 'Hard cap', plan.overage?.delivery ?? 'Hard cap', plan.overage?.storage ?? 'Hard cap',
    ];
    if (JSON.stringify(stated) !== JSON.stringify(due)) mismatched.push({ plan: plan.name, due, stated });
  }
  return mismatched;
}

test('terms gate: the published catalog matches the dated terms at every build instant', async () => {
  const terms = await read(TERMS);
  for (const at of [beforeCut, new Date('2026-11-01T00:00:00Z'), new Date('2030-01-01T00:00:00Z')]) {
    const { plans, sandboxEnvironment } = signalRelayPricingAt(at);
    assert.deepEqual(unstatedValues(terms, plans, sandboxEnvironment), [], at.toISOString());
    assert.deepEqual(unstatedRows(terms, plans), [], at.toISOString());
  }
});

test('terms gate: names every proposed catalog value the dated Relay terms do not state', async () => {
  const terms = await read(TERMS);
  const { plans, sandboxEnvironment } = signalRelayPricingAt(beforeCut);
  const count = (value) => value.toLocaleString('en-US');
  const storage = (bytes) => bytes >= 1_000_000_000 ? `${bytes / 1_000_000_000} GB` : `${bytes / 1_000_000} MB`;
  const free = signalRelayServiceCatalog.plans.find(({ planId }) => planId === 'relay_free_v1');
  const proposedFree = { ...plans[0], signalRelayMau: count(free.monthlyActiveUsers), deliveryUnits: count(free.deliveryUnits),
    attachmentOperations: count(free.attachmentOperations), storage: storage(free.storageBytes) };
  const proposedSandbox = { ...sandboxEnvironment, signalRelayMau: `${count(signalRelayServiceCatalog.sandbox.monthlyActiveUsers)} test accounts`,
    deliveryUnits: count(signalRelayServiceCatalog.sandbox.deliveryUnits), attachmentOperations: count(signalRelayServiceCatalog.sandbox.attachmentOperations),
    storage: storage(signalRelayServiceCatalog.sandbox.storageBytes) };
  const due = [proposedFree, ...upcomingSignalProtocolRelayPlans, ...plans.slice(1)];
  /* The value check finds "25" and "250 MB" elsewhere in the terms text. The
     row check names the complete Free and Hobby rows. */
  assert.deepEqual(unstatedValues(terms, due, proposedSandbox), [
    'the Free delivery units: 12,500',
    'the Free attachment uploads: 2,500',
    'the Hobby price: $9',
    'the Hobby delivery units: 50,000',
    'the Hobby attachment uploads: 10,000',
    'the Hobby signalRelayMau overage rate: $0.10',
    'the Hobby delivery overage rate: $400 per million',
    'the Hobby storage overage rate: $2.00 per GB-month',
    'the Sandbox environment signalRelayMau: 5 test accounts',
    'the Sandbox environment deliveryUnits: 10,000',
    'the Sandbox environment attachmentOperations: 2,500',
    'the Sandbox environment storage: 100 MB',
  ]);
  assert.deepEqual(unstatedRows(terms, due), [
    {
      plan: 'Free',
      due: ['$0', '25', '12,500', '2,500', '250 MB', 'Hard cap', 'Hard cap', 'Hard cap'],
      stated: ['$0', '100', '100,000', '20,000', '1 GB', 'Hard cap', 'Hard cap', 'Hard cap'],
    },
    {
      plan: 'Hobby',
      due: ['$9', '100', '50,000', '10,000', '1 GB', '$0.10', '$400 per million', '$2.00 per GB-month'],
      stated: null,
    },
  ]);
});
