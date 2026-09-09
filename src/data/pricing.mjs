/*
 * The SDK commercial license catalog, single-sourced.
 *
 * It lived in `pricing.astro` and nowhere else, so the landing page could
 * only refer to it in the abstract: its license cell said "at a published
 * price" while /pricing carried $5,000, and a fresh reader called that out —
 * the word "published" promises a number the page never showed. Two surfaces
 * quoting one price from two places is the same drift the carrier panel was
 * fixed for, and a stale price is worse than a vague one.
 *
 * `startupTier` is the entry price the marketing pages name. Change a number
 * here and every rendered surface moves together, or the test fails.
 *
 * The public catalog is three licenses, the founder's 2026-09-09 call: AGPLv3,
 * Startup, and Enterprise. Growth and Enterprise / OEM are one column here.
 * They stay two plans inside the console, which provisions and bills each,
 * and the difference is the contract's to state, not the page's. Enterprise
 * prints "Custom" in the price's place, the founder's call: a negotiated grant
 * has no figure, and the word says so at the size a reader scans for.
 *
 * Each tier states, for every row of the license table, what it carries. The
 * values come from the self-hosted agreement for Startup, from the AGPLv3
 * text for the free column, and from the negotiated grant's description for
 * Enterprise. `NOT_INCLUDED` renders as the dash a value that does not exist
 * takes, with the word a screen reader hears.
 *
 * The legal text is deliberately not one of them. /legal/terms and its frozen
 * versioned copies state the fee as executed contract language, and a contract
 * that silently re-prices itself when a marketing constant changes is a worse
 * defect than the drift this module prevents. Those figures stay hard-coded.
 * Changing the price there is not an edit to the existing terms: it is a new
 * dated terms version, with the superseded one kept as published.
 */
import { INCLUDED, NOT_INCLUDED } from '../lib/plan-values.mjs';
import { sdkLicensingBookingUrl } from './booking.mjs';

export const tiers = [
  {
    id: 'agplv3',
    name: 'AGPLv3',
    price: 'Free',
    /* The line under the price. The grant has no term: nothing is
     * time-limited, and no feature is held back. */
    note: 'no time limit',
    /* The qualification trigger, not a benefit line. What a buyer needs in the
     * free column is the specific obligation that disqualifies them, which is
     * how Qt's licensing comparison writes its own free column. positioning.md
     * §3 makes this exact friction the qualification funnel. */
    detail: 'AGPLv3 reaches applications offered over a network, not only distributed binaries.',
    closedSource: NOT_INCLUDED,
    products: 'Any, under AGPLv3',
    redistribution: 'Under AGPLv3',
    updates: 'Every release',
    support: NOT_INCLUDED,
    securityReview: NOT_INCLUDED,
    cta: { href: '/licensing', label: 'Understand AGPLv3 use', secondary: true },
  },
  {
    id: 'startup',
    name: 'Startup',
    price: '$5,000',
    note: 'per year',
    closedSource: INCLUDED,
    products: 'One named product',
    redistribution: NOT_INCLUDED,
    updates: 'During the term',
    support: 'Email, during the term',
    securityReview: NOT_INCLUDED,
    cta: {
      href: 'https://console.open-e2ee.dev/licenses/new?plan=startup',
      label: 'License for closed source',
      secondary: false,
    },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    note: 'per contract',
    closedSource: INCLUDED,
    products: 'Contract-defined',
    redistribution: 'Negotiated',
    updates: 'Contract-defined',
    support: 'Negotiated',
    securityReview: 'Negotiated',
    cta: {
      href: sdkLicensingBookingUrl,
      label: 'Schedule a meeting',
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
 * The message deliberately carries no count, because the one it used to carry
 * was stale within a single pull request — a number in a diagnostic goes out
 * of date exactly the way a number in copy does, which is what this module
 * exists to stop.
 */
if (!startup) {
  throw new Error('pricing.mjs: no tier named "Startup" — the marketing pages quote its price.');
}

export const startupTier = startup;
