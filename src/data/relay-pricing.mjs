/**
 * The public OpenE2EE Relay catalog.
 *
 * Keep this module byte-for-byte aligned with the authoritative product
 * contract and Relay's `managedRelayPlanTargets`. Prices are owner-approved;
 * publication still belongs to REL1.
 */
export const relayDevelopmentEnvironment = {
  relayMau: '25 test accounts',
  deliveryUnits: '25,000',
  attachmentOperations: '25,000',
  storage: '250 MB',
  detail: 'Created automatically for each project. It uses isolated state and credentials, 24-hour default retention, a seven-day retention maximum, and suspension after 30 inactive days.',
};

/*
 * The launch overage rates the 2026-08-26 COGS gate approved. Delivery and
 * storage price the same on every paid plan; the additional MAU rate falls
 * with the plan. Free has no overage: its caps are hard, and attachment
 * uploads are a hard cap on every plan.
 */
const paidOverage = {
  delivery: '$55 per million',
  storage: '$0.50 per GB-month',
};

/* Production ciphertext retention on every production plan. */
export const relayProductionRetention = 'Up to 30 days';

export const relayPlans = [
  {
    id: 'relay_free_v1',
    name: 'Free',
    monthlyPriceUsd: 0,
    price: '$0',
    relayMau: '100',
    deliveryUnits: '100,000',
    attachmentOperations: '100,000',
    storage: '1 GB',
    overage: null,
    detail: 'Production roots, hard capacity caps, and no automatic charge.',
  },
  {
    id: 'relay_starter_v1',
    name: 'Starter',
    monthlyPriceUsd: 99,
    price: '$99',
    relayMau: '1,000',
    deliveryUnits: '500,000',
    attachmentOperations: '500,000',
    storage: '10 GB',
    overage: { relayMau: '$0.05', ...paidOverage },
    detail: 'Per month. Optional overage needs explicit acceptance and a spend limit.',
  },
  {
    id: 'relay_growth_v1',
    name: 'Growth',
    monthlyPriceUsd: 299,
    price: '$299',
    relayMau: '5,000',
    deliveryUnits: '2,500,000',
    attachmentOperations: '2,500,000',
    storage: '50 GB',
    overage: { relayMau: '$0.03', ...paidOverage },
    detail: 'Per month. Higher capacity with the same protocol features.',
  },
  {
    id: 'relay_business_v1',
    name: 'Business',
    monthlyPriceUsd: 899,
    price: '$899',
    relayMau: '25,000',
    deliveryUnits: '12,500,000',
    attachmentOperations: '12,500,000',
    storage: '250 GB',
    overage: { relayMau: '$0.02', ...paidOverage },
    detail: 'Per month. Business capacity with the same protocol features.',
  },
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
    definition: 'One accepted encrypted envelope or shared-body reference for one destination device. An exact retry with the same stable operation identifier does not charge twice.',
  },
  {
    name: 'Attachment upload',
    definition: 'One accepted upload authorization for one stable SDK request identifier. Exact retries do not count again.'
  },
  {
    name: 'Storage',
    definition: 'Live customer ciphertext plus attachment bytes, integrated from exact byte changes over time. Internal identifiers, indexes, and bookkeeping are not billable bytes.'
  },
];
