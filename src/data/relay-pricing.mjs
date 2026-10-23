import { formatRelayRate, relayEarlierServiceCatalog, relayServiceCatalog } from './relay-service-catalog.mjs';

const count = (value) => value.toLocaleString('en-US');
const storage = (bytes) => bytes >= 1_000_000_000 ? `${bytes / 1_000_000_000} GB` : `${bytes / 1_000_000} MB`;

/*
 * Relay catalog relay_managed_2026_11_01_v1 lowers the Free and Sandbox limits
 * from this instant. Relay's catalog-effective-targets.ts holds the same
 * instant. Before it, Relay enforces the Free and Sandbox limits of the earlier
 * catalog. Every paid plan is the same at every instant.
 */
export const relayLimitsEffectiveAt = new Date(Date.UTC(2026, 10, 1));

/* Production ciphertext retention on every production plan. */
export const relayProductionRetention = 'Up to 30 days';

const sandboxEnvironment = (sandbox) => ({
  relayMau: `${count(sandbox.monthlyActiveUsers)} test accounts`,
  deliveryUnits: count(sandbox.deliveryUnits),
  attachmentOperations: count(sandbox.attachmentOperations),
  storage: storage(sandbox.storageBytes),
  detail: 'Created automatically for each project. It uses isolated state and credentials, 24-hour default retention, a seven-day retention maximum, and suspension after 30 inactive days.',
});

const planNames = {
  relay_free_v1: 'Free',
  relay_hobby_v1: 'Hobby',
  relay_starter_v1: 'Starter',
  relay_growth_v1: 'Growth',
  relay_business_v1: 'Business',
};

const relayPlan = (plan) => ({
  id: plan.planId,
  name: planNames[plan.planId],
  monthlyPriceUsd: Number(BigInt(plan.monthlyPriceMicrounits) / 1_000_000n),
  price: formatRelayRate({ numerator: plan.monthlyPriceMicrounits, denominator: '1' }, 1n, 0),
  relayMau: count(plan.monthlyActiveUsers),
  deliveryUnits: count(plan.deliveryUnits),
  attachmentOperations: count(plan.attachmentOperations),
  storage: storage(plan.storageBytes),
  overage: plan.overageRates ? {
    relayMau: formatRelayRate(plan.overageRates.relay_mau),
    delivery: `${formatRelayRate(plan.overageRates.delivery_units, 1_000_000n, 0)} per million`,
    storage: `${formatRelayRate(plan.overageRates.storage_byte_month, 1_000_000_000n)} per GB-month`,
  } : null,
  detail: plan.overageRates ? 'Per month. Optional overage needs explicit acceptance and a spend limit.'
    : 'Production roots, hard capacity caps, and no automatic charge.',
});

const enterprise = {
  id: 'relay_enterprise_v1',
  name: 'Enterprise',
  monthlyPriceUsd: null,
  price: 'Custom',
  relayMau: 'Negotiated',
  deliveryUnits: 'Negotiated',
  attachmentOperations: 'Negotiated',
  storage: 'Negotiated',
  overage: null,
  detail: 'Negotiated capacity, support, and service level.',
};

/*
 * A catalog plan that no dated Relay terms version states yet, with the terms
 * version it waits for. The site does not publish it. The pull request that
 * adds the dated terms version removes the plan from this map, and the plan
 * then takes its catalog place in relayPlans.
 */
const awaitingTerms = new Map([['relay_hobby_v1', null]]);

export const upcomingRelayPlans = relayServiceCatalog.plans
  .filter(({ planId }) => awaitingTerms.has(planId))
  .map((plan) => ({ ...relayPlan(plan), termsVersion: awaitingTerms.get(plan.planId) }));

const freePlanId = 'relay_free_v1';
const currentFree = relayPlan(relayServiceCatalog.plans.find(({ planId }) => planId === freePlanId));
const currentSandbox = sandboxEnvironment(relayServiceCatalog.sandbox);
const limitsDate = relayLimitsEffectiveAt.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const limits = ({ relayMau, deliveryUnits, attachmentOperations, storage }) => ({ relayMau, deliveryUnits, attachmentOperations, storage });

const limitsChange = {
  effectiveAt: relayLimitsEffectiveAt.toISOString(),
  date: limitsDate,
  free: limits(currentFree),
  sandbox: limits(currentSandbox),
  note: `Free and Sandbox limits change on ${limitsDate} UTC. `
    + `Free then includes ${currentFree.relayMau} Relay MAU, ${currentFree.deliveryUnits} delivery units, `
    + `${currentFree.attachmentOperations} attachment uploads, and ${currentFree.storage} storage. `
    + `Sandbox then includes ${currentSandbox.relayMau}, ${currentSandbox.deliveryUnits} delivery units, `
    + `${currentSandbox.attachmentOperations} attachment uploads, and ${currentSandbox.storage} storage.`,
};

/*
 * The published plans, the Sandbox limits, and the pending limits change in
 * effect at one instant. Before the cut, Free and Sandbox come from the
 * earlier catalog.
 */
export function relayPricingAt(at) {
  const earlier = at.getTime() < relayLimitsEffectiveAt.getTime();
  const free = earlier
    ? relayPlan(relayEarlierServiceCatalog.plans.find(({ planId }) => planId === freePlanId)) : currentFree;
  return {
    plans: [
      ...relayServiceCatalog.plans
        .filter(({ planId }) => !awaitingTerms.has(planId))
        .map((plan) => plan.planId === freePlanId ? free : relayPlan(plan)),
      enterprise,
    ],
    sandboxEnvironment: earlier ? sandboxEnvironment(relayEarlierServiceCatalog.sandbox) : currentSandbox,
    limitsChange: earlier ? limitsChange : null,
  };
}

/*
 * The site has no runtime: each build prints the prices in effect when it
 * runs. A build before the cut names the new limits and their date. Production
 * needs a new build at or after the cut to drop that note.
 */
export const relayPricingInstant = new Date();

const atBuild = relayPricingAt(relayPricingInstant);
export const relayPlans = atBuild.plans;
export const relaySandboxEnvironment = atBuild.sandboxEnvironment;
export const relayLimitsChange = atBuild.limitsChange;

export const relayMeterDefinitions = [
  {
    name: 'Relay MAU',
    definition: 'One canonical account with qualifying authenticated production activity during one UTC calendar month. Multiple devices for one account count once.',
  },
  {
    name: 'Delivery unit',
    definition: 'One accepted encrypted envelope or shared-body reference for one destination device, or one stored Relay delivery receipt for one sender device. While Relay stores the message, an exact retry with the same stable operation identifier does not charge again.',
  },
  {
    name: 'Attachment upload',
    definition: 'One accepted upload authorization for one stable SDK request identifier. Exact retries do not count again.'
  },
  {
    name: 'Storage',
    definition: 'Live customer ciphertext plus attachment bytes, integrated from exact byte changes over time. Internal identifiers, indexes, and bookkeeping are not billable bytes. One GB is 1,000,000,000 bytes. One GB-month uses the actual UTC calendar month.'
  },
];
