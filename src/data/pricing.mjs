/*
 * The commercial tiers, single-sourced.
 *
 * They lived in `pricing.astro` and nowhere else, so the landing page could
 * only refer to them in the abstract: its license cell said "at a published
 * price" while /pricing carried $5,000, and a fresh reader called that out —
 * the word "published" promises a number the page never showed. Two surfaces
 * quoting one price from two places is the same drift the carrier panel was
 * fixed for, and a stale price is worse than a vague one.
 *
 * `startupTier` is the entry price the marketing pages name. Change a number
 * here and every rendered surface moves together, or the test fails.
 *
 * The legal text is deliberately not one of them. /legal/terms and its frozen
 * versioned copies state the fee as executed contract language, and a contract
 * that silently re-prices itself when a marketing constant changes is a worse
 * defect than the drift this module prevents. Those figures stay hard-coded.
 * Changing the price there is not an edit to the existing terms: it is a new
 * dated terms version, with the superseded one kept as published.
 */
export const tiers = [
  {
    name: 'AGPLv3',
    price: 'Free',
    period: null,
    body: 'The complete SDK, for products that can meet the AGPLv3 obligations. No feature is held back and nothing is time-limited.',
    /* The qualification trigger, not a benefit line. This read "You run your
     * own infrastructure, you keep your own keys...", which /index and /product
     * already say and which reads on a pricing page as a cost the buyer did not
     * ask about. What a buyer needs in the free column is the specific
     * obligation that disqualifies them, which is how Qt's licensing comparison
     * writes its own free column. positioning.md §3 makes this exact friction
     * the qualification funnel, and /licensing carried the sentence alone. */
    detail: 'AGPLv3 reaches applications offered over a network, not only distributed binaries.',
    cta: { href: '/licensing', label: 'Understand AGPLv3 use', secondary: true },
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
    /* "integration support" is the body sentence one line above. */
    detail:
      'Contract-defined component scope. Configurable product count. Quote and signed order form.',
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
    /* "security review" and "portfolio or OEM rights" are both the body
     * sentence one line above. */
    detail: 'Contract-defined component scope. MSA or signed order form.',
    cta: {
      href: 'https://console.open-e2ee.dev/contact?plan=enterprise',
      label: 'Plan a security review',
      secondary: true,
    },
  },
];

const startup = tiers.find((tier) => tier.name === 'Startup');

/*
 * Thrown at build rather than typed as optional. Three surfaces print this
 * tier's price — the landing page's license cell, /product's licensing band,
 * and /pricing's own meta description — and the failure mode worth designing
 * for is someone renaming the entry tier here and every one of them quietly
 * rendering "from undefined per year" to visitors. A build that stops is the
 * cheapest possible version of that mistake.
 *
 * There were four until /evaluate folded into /security; its license answer
 * was one of the near-verbatim restatements that died with the page. The
 * message deliberately carries no count, because the one it used to carry was
 * stale within a single pull request — a number in a diagnostic goes out of
 * date exactly the way a number in copy does, which is what this module exists
 * to stop. The comment above can be checked against the imports; a string
 * thrown on a path nothing reaches cannot.
 */
if (!startup) {
  throw new Error('pricing.mjs: no tier named "Startup" — the marketing pages quote its price.');
}

export const startupTier = startup;
