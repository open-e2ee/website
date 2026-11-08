import { formatSignalProtocolRelayRate, signalRelayServiceCatalog } from './signal-relay-service-catalog.mjs';

const count = (value) => value.toLocaleString('en-US');
const storage = (bytes) => bytes >= 1_000_000_000 ? `${bytes / 1_000_000_000} GB` : `${bytes / 1_000_000} MB`;

/*
 * Every plan and the Sandbox environment take the pinned catalog values. The
 * signal-relay-2026-11-08 terms state the current Free and Sandbox limits, so
 * the site publishes them from the same catalog as the paid plans. A build date
 * cannot select different values.
 */

/* Production ciphertext retention on every production plan. */
export const signalRelayProductionRetention = 'Up to 30 days';

const sandboxEnvironment = (sandbox) => ({
  signalRelayMau: `${count(sandbox.monthlyActiveUsers)} test accounts`,
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

const signalRelayPlan = (plan) => ({
  id: plan.planId,
  name: planNames[plan.planId],
  monthlyPriceUsd: Number(BigInt(plan.monthlyPriceMicrounits) / 1_000_000n),
  price: formatSignalProtocolRelayRate({ numerator: plan.monthlyPriceMicrounits, denominator: '1' }, 1n, 0),
  signalRelayMau: count(plan.monthlyActiveUsers),
  deliveryUnits: count(plan.deliveryUnits),
  attachmentOperations: count(plan.attachmentOperations),
  storage: storage(plan.storageBytes),
  overage: plan.overageRates ? {
    signalRelayMau: formatSignalProtocolRelayRate(plan.overageRates.relay_mau),
    delivery: `${formatSignalProtocolRelayRate(plan.overageRates.delivery_units, 1_000_000n, 0)} per million`,
    storage: `${formatSignalProtocolRelayRate(plan.overageRates.storage_byte_month, 1_000_000_000n)} per GB-month`,
  } : null,
  detail: plan.overageRates ? 'Per month. Optional overage needs explicit acceptance and a spend limit.'
    : 'Production roots, hard capacity caps, and no automatic charge.',
});

const enterprise = {
  id: 'relay_enterprise_v1',
  name: 'Enterprise',
  monthlyPriceUsd: null,
  price: 'Custom',
  signalRelayMau: 'Negotiated',
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
 * then takes its catalog place in signalRelayPlans.
 */
const awaitingTerms = new Map();

export const upcomingSignalProtocolRelayPlans = signalRelayServiceCatalog.plans
  .filter(({ planId }) => awaitingTerms.has(planId))
  .map((plan) => ({ ...signalRelayPlan(plan), termsVersion: awaitingTerms.get(plan.planId) }));

const publishedSandbox = sandboxEnvironment(signalRelayServiceCatalog.sandbox);

/*
 * Keep the date parameter for the comparison caller. Dates do not select
 * different plans or limits. This matches Relay's unqualified catalog selection.
 */
export function signalRelayPricingAt(at) {
  void at;
  return {
    plans: [
      ...signalRelayServiceCatalog.plans
        .filter(({ planId }) => !awaitingTerms.has(planId))
        .map(signalRelayPlan),
      enterprise,
    ],
    sandboxEnvironment: publishedSandbox,
    limitsChange: null,
  };
}

/* Record the build instant without using it as catalog authority. */
export const signalRelayPricingInstant = new Date();

const atBuild = signalRelayPricingAt(signalRelayPricingInstant);
export const signalRelayPlans = atBuild.plans;
export const signalRelaySandboxEnvironment = atBuild.sandboxEnvironment;
export const signalRelayLimitsChange = atBuild.limitsChange;

export const signalRelayMeterDefinitions = [
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
