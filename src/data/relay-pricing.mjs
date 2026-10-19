import { formatRelayRate, relayServiceCatalog } from './relay-service-catalog.mjs';

const count = (value) => value.toLocaleString('en-US');
const storage = (bytes) => bytes >= 1_000_000_000 ? `${bytes / 1_000_000_000} GB` : `${bytes / 1_000_000} MB`;

export const relaySandboxEnvironment = {
  relayMau: `${count(relayServiceCatalog.sandbox.monthlyActiveUsers)} test accounts`,
  deliveryUnits: count(relayServiceCatalog.sandbox.deliveryUnits),
  attachmentOperations: count(relayServiceCatalog.sandbox.attachmentOperations),
  storage: storage(relayServiceCatalog.sandbox.storageBytes),
  detail: 'Created automatically for each project. It uses isolated state and credentials, 24-hour default retention, a seven-day retention maximum, and suspension after 30 inactive days.',
};

/* Production ciphertext retention on every production plan. */
export const relayProductionRetention = 'Up to 30 days';

const planNames = ['Free', 'Starter', 'Growth', 'Business'];
export const relayPlans = [
  ...relayServiceCatalog.plans.map((plan, index) => ({
    id: plan.planId,
    name: planNames[index],
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
    detail: index === 0 ? 'Production roots, hard capacity caps, and no automatic charge.'
      : 'Per month. Optional overage needs explicit acceptance and a spend limit.',
  })),
  {
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
  },
];


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
