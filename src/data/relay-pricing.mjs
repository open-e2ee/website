/**
 * The public OpenE2EE Relay catalog.
 *
 * Keep this module byte-for-byte aligned with the authoritative product
 * contract and Relay's `managedRelayPlanTargets`. Prices are owner-approved;
 * publication still belongs to REL1.
 */
export const relayPlans = [
  {
    id: 'relay_development_v1',
    name: 'Managed Development',
    monthlyPriceUsd: 0,
    price: '$0',
    relayMau: '25 test accounts',
    deliveryUnits: '25,000',
    attachmentOperations: '25,000',
    storage: '250 MB',
    detail: 'One sandbox per project. 24-hour default retention, seven-day maximum retention, and suspension after 30 inactive days.',
  },
  {
    id: 'relay_free_v1',
    name: 'Free production',
    monthlyPriceUsd: 0,
    price: '$0',
    relayMau: '100',
    deliveryUnits: '100,000',
    attachmentOperations: '100,000',
    storage: '1 GB',
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
    detail: 'Per month. Evidence-backed operating controls and Business capacity.',
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
    detail: 'Negotiated capacity, support, service terms, and approved operational controls.',
  },
];

export const relayOverages = {
  delivery: '$55 per million delivery units',
  storage: '$0.50 per GB-month of exact live encrypted storage',
  relayMau: 'Starter $0.05, Growth $0.03, Business $0.02 for each excess Relay MAU',
  attachmentOperations: 'Hard cap; no overage',
};

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
    name: 'Attachment operation',
    definition: 'One accepted upload authorization for one stable SDK request identifier. Exact retries do not count again.',
  },
  {
    name: 'Exact live storage',
    definition: 'Customer ciphertext plus attachment bytes, integrated from exact byte changes over time. Internal identifiers, indexes, and bookkeeping are not billable bytes.',
  },
];
