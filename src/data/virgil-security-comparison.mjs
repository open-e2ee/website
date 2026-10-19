import { relayPlans } from './relay-pricing.mjs';
import { formatRelayRate, relayServiceCatalog } from './relay-service-catalog.mjs';

const price = (id) => relayPlans.find((plan) => plan.id === id).price;
const starter = relayServiceCatalog.plans.find((plan) => plan.planId === 'relay_starter_v1');
const starterAt5000 = formatRelayRate({
  numerator: String(BigInt(starter.monthlyPriceMicrounits) * BigInt(starter.overageRates.relay_mau.denominator)
    + BigInt(5000 - starter.monthlyActiveUsers) * BigInt(starter.overageRates.relay_mau.numerator)),
  denominator: starter.overageRates.relay_mau.denominator,
}, 1n, 0);

export const virgilSecurityComparison = {
  verifiedAt: '2026-08-26',
  reviewOwner: 'OpenE2EE market-fact review',
  sources: [
    {
      label: 'Virgil Security pricing',
      href: 'https://virgilsecurity.com/pricing/',
    },
    {
      label: 'Virgil E3Kit application architecture',
      href: 'https://developer.virgilsecurity.com/docs/e3kit/fundamentals/application-architecture/',
    },
    {
      label: 'Virgil E3Kit Firebase integration',
      href: 'https://developer.virgilsecurity.com/docs/e3kit/integrations/firebase/',
    },
  ],
  virgilBands: [
    ['Up to 250 registered users', 'Free'],
    ['251–5,000 registered users', '$99 per month'],
    ['5,000–100,000 registered users', '$0.019 per registered user per month'],
    ['More than 100,000 registered users', 'Custom'],
  ],
  stickerPrices: [
    ['100', 'Free', 'Free', 'Virgil counts registered users; OpenE2EE counts monthly active accounts.'],
    ['250', 'Free', price('relay_starter_v1'), 'OpenE2EE Free ends at 100 Relay MAU because Relay also supplies delivery infrastructure.'],
    ['1,000', '$99', price('relay_starter_v1'), 'The sticker price matches, but the products include different infrastructure.'],
    ['5,000', 'About $95–$99', price('relay_growth_v1'), `Virgil lists two bands that both include 5,000 users. OpenE2EE Growth includes this activity. Starter plus accepted MAU overage is ${starterAt5000} if its other allowances fit.`],
    ['25,000', 'About $475', price('relay_business_v1'), 'Compare the complete application stack, not only vendor fees.'],
  ],
};
