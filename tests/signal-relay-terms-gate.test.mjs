import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { signalRelayPricingAt, upcomingSignalProtocolRelayPlans } from '../src/data/signal-relay-pricing.mjs';
import { signalRelayServiceCatalog } from '../src/data/signal-relay-service-catalog.mjs';

/*
 * The public guards compare the published plans with the dated terms. The
 * signal-relay-2026-11-08 terms state every catalog plan, including Hobby, and
 * the current Free and Sandbox limits. A date cannot select different values.
 */
const TERMS = 'src/components/SignalProtocolRelayTerms20261108.astro';
const FROZEN = 'src/pages/legal/signal-relay-terms/2026-11-08.astro';
const PREVIOUS = 'src/pages/legal/signal-relay-terms/2026-11-05.astro';
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

test('terms gate: publishes every catalog plan and the current Sandbox limits, and the dated terms state them', async () => {
  const [terms, frozen, previous] = await Promise.all([read(TERMS), read(FROZEN), read(PREVIOUS)]);
  const count = (value) => value.toLocaleString('en-US');
  const storage = (bytes) => bytes >= 1_000_000_000 ? `${bytes / 1_000_000_000} GB` : `${bytes / 1_000_000} MB`;
  const catalogFree = signalRelayServiceCatalog.plans.find(({ planId }) => planId === 'relay_free_v1');
  const catalogSandbox = signalRelayServiceCatalog.sandbox;
  assert.deepEqual(upcomingSignalProtocolRelayPlans, []);
  for (const at of [beforeCut, new Date('2026-11-08T00:00:00Z'), new Date('2030-01-01T00:00:00Z')]) {
    const { plans, sandboxEnvironment } = signalRelayPricingAt(at);
    const negotiated = plans.at(-1);
    assert.deepEqual([negotiated.name, negotiated.monthlyPriceUsd], ['Enterprise', null], at.toISOString());
    assert.deepEqual(plans.map(({ id }) => id), [
      ...signalRelayServiceCatalog.plans.map(({ planId }) => planId), negotiated.id,
    ], at.toISOString());
    const free = plans.find(({ id }) => id === 'relay_free_v1');
    assert.deepEqual(
      [free.signalRelayMau, free.deliveryUnits, free.attachmentOperations, free.storage],
      [count(catalogFree.monthlyActiveUsers), count(catalogFree.deliveryUnits), count(catalogFree.attachmentOperations), storage(catalogFree.storageBytes)],
      at.toISOString(),
    );
    const hobby = plans.find(({ name }) => name === 'Hobby');
    assert.ok(hobby, `Hobby is not published at ${at.toISOString()}`);
    const catalogHobby = signalRelayServiceCatalog.plans.find(({ planId }) => planId === hobby.id);
    assert.ok(catalogHobby, 'the published Hobby plan is not a catalog plan');
    assert.deepEqual(
      [hobby.name, hobby.monthlyPriceUsd, hobby.signalRelayMau, hobby.deliveryUnits, hobby.attachmentOperations, hobby.storage],
      ['Hobby', Number(BigInt(catalogHobby.monthlyPriceMicrounits) / 1_000_000n), count(catalogHobby.monthlyActiveUsers),
        count(catalogHobby.deliveryUnits), count(catalogHobby.attachmentOperations), storage(catalogHobby.storageBytes)],
      at.toISOString(),
    );
    assert.deepEqual(
      [sandboxEnvironment.signalRelayMau, sandboxEnvironment.deliveryUnits, sandboxEnvironment.attachmentOperations, sandboxEnvironment.storage],
      [`${count(catalogSandbox.monthlyActiveUsers)} test accounts`, count(catalogSandbox.deliveryUnits),
        count(catalogSandbox.attachmentOperations), storage(catalogSandbox.storageBytes)],
      at.toISOString(),
    );
    for (const [path, text] of [[TERMS, terms], [FROZEN, frozen]]) {
      assert.deepEqual(unstatedValues(text, plans, sandboxEnvironment), [], `${path} ${at.toISOString()}`);
      assert.deepEqual(unstatedRows(text, plans), [], `${path} ${at.toISOString()}`);
    }
  }
  /* The superseded 2026-11-05 terms do not state the Hobby row or the current
     Free row, so the published catalog needs the 2026-11-08 version. */
  const { plans } = signalRelayPricingAt(beforeCut);
  assert.deepEqual(unstatedRows(previous, plans).map(({ plan, stated }) => [plan, stated]), [
    ['Free', ['$0', '100', '100,000', '20,000', '1 GB', 'Hard cap', 'Hard cap', 'Hard cap']],
    ['Hobby', null],
  ]);
});
