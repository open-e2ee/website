/*
 * The commercial tiers, single-sourced.
 *
 * They lived in `pricing.astro` and nowhere else, so the landing page could
 * only refer to them in the abstract: its licence cell said "at a published
 * price" while /pricing carried $5,000, and a fresh reader called that out —
 * the word "published" promises a number the page never showed. Two surfaces
 * quoting one price from two places is the same drift the carrier panel was
 * fixed for, and a stale price is worse than a vague one.
 *
 * `startupTier` is the entry price the landing page names. Change a number
 * here and both surfaces move together, or the test fails.
 */
export const tiers = [
  {
    name: 'AGPL-3.0',
    price: 'Free',
    period: null,
    body: 'The complete SDK, for products that can meet the AGPL obligations. No feature is held back and nothing is time-limited.',
    detail:
      'You run your own infrastructure, you keep your own keys, and your source obligations are the license text rather than anything we decide later.',
    cta: { href: '/licensing', label: 'Understand AGPL use', secondary: true },
  },
  {
    name: 'Startup',
    price: '$5,000',
    period: 'per year',
    body: 'Commercial production rights for one named product owned by one legal entity, purchasable without talking to anyone.',
    detail:
      'Licensed component: @open-e2ee/signal-protocol-sdk. Includes SDK updates during the term. Self-service annual checkout.',
    cta: {
      href: 'https://console.open-e2ee.dev/licenses/new?plan=startup',
      label: 'License for closed source',
      secondary: false,
    },
  },
  {
    name: 'Growth',
    price: '$20,000',
    period: 'per year',
    body: 'Commercial rights with a configurable product scope, plus implementation support while you integrate.',
    detail:
      'Contract-defined component scope, configurable product count, integration support. Quote and signed order form.',
    cta: {
      href: 'https://console.open-e2ee.dev/contact?plan=growth',
      label: 'Schedule a meeting',
      secondary: true,
    },
  },
  {
    name: 'Enterprise / OEM',
    price: '$50,000+',
    period: 'per year',
    body: 'Negotiated portfolio or redistribution rights, security review, and service levels.',
    detail:
      'Contract-defined component scope, portfolio or OEM rights, security review and SLA. MSA or signed order form.',
    cta: {
      href: 'https://console.open-e2ee.dev/contact?plan=enterprise',
      label: 'Plan a security review',
      secondary: true,
    },
  },
];

const startup = tiers.find((tier) => tier.name === 'Startup');

/*
 * Thrown at build rather than typed as optional. The landing page prints this
 * tier's price in its licence cell, and the failure mode worth designing for
 * is someone renaming the entry tier here and the landing page quietly
 * rendering "from undefined per year" to every visitor. A build that stops is
 * the cheapest possible version of that mistake.
 */
if (!startup) throw new Error('pricing.mjs: no tier named "Startup" — the landing page quotes it.');

export const startupTier = startup;
