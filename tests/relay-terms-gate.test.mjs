import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { relayLimitsEffectiveAt, relayPricingAt, upcomingRelayPlans } from '../src/data/relay-pricing.mjs';

/*
 * The terms gate.
 *
 * Relay lowers the Free and Sandbox limits at 2026-11-01T00:00:00Z, and the
 * Relay catalog sells Hobby. The dated Relay terms relay-2026-10-24 state
 * neither. Two guards compare the published plans with the dated terms:
 *
 *   tests/legal-pages.test.mjs
 *     states every published price and included quantity in the Relay terms
 *   tests/relay-service-catalog.test.mjs
 *     both current and immutable terms state the exact catalog rows
 *
 * A build at or after the cut publishes the new Free and Sandbox limits, so
 * both guards fail on it until a new dated terms version states them. This
 * test runs the same two checks against the values in effect at the cut, with
 * Hobby added, and pins every value the named terms do not state. The list is
 * what the next dated terms version must state.
 *
 * When that version lands, name its component in TERMS. The expected list is
 * then empty, and Hobby moves from upcomingRelayPlans into relayPlans.
 */
const TERMS = 'src/components/SignalProtocolRelayTerms20261024.astro';
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
    states(plan.relayMau, `the ${plan.name} Relay MAU allowance`);
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
      plan.price, plan.relayMau, plan.deliveryUnits, plan.attachmentOperations, plan.storage,
      plan.overage?.relayMau ?? 'Hard cap', plan.overage?.delivery ?? 'Hard cap', plan.overage?.storage ?? 'Hard cap',
    ];
    if (JSON.stringify(stated) !== JSON.stringify(due)) mismatched.push({ plan: plan.name, due, stated });
  }
  return mismatched;
}

test('terms gate: the mirrored guard checks pass on the values the guards read before the cut', async () => {
  const terms = await read(TERMS);
  const { plans, sandboxEnvironment } = relayPricingAt(beforeCut);
  assert.deepEqual(unstatedValues(terms, plans, sandboxEnvironment), []);
  assert.deepEqual(unstatedRows(terms, plans), []);
});

test('terms gate: names every value from 2026-11-01 that the dated Relay terms do not state', async () => {
  const terms = await read(TERMS);
  const { plans, sandboxEnvironment } = relayPricingAt(relayLimitsEffectiveAt);
  const due = [plans[0], ...upcomingRelayPlans, ...plans.slice(1)];
  /* The value check finds "25" and "250 MB" elsewhere in the terms text. The
     row check names the complete Free and Hobby rows. */
  assert.deepEqual(unstatedValues(terms, due, sandboxEnvironment), [
    'the Free delivery units: 12,500',
    'the Free attachment uploads: 2,500',
    'the Hobby price: $9',
    'the Hobby delivery units: 50,000',
    'the Hobby attachment uploads: 10,000',
    'the Hobby relayMau overage rate: $0.10',
    'the Hobby delivery overage rate: $400 per million',
    'the Hobby storage overage rate: $2.00 per GB-month',
    'the Sandbox environment relayMau: 5 test accounts',
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
