/*
 * Every destination the site header and the site footer offer, declared once.
 *
 * Two surfaces render the header set: the row of words at desktop width, and
 * the sheet a phone opens. One array is what keeps them the same set, and
 * tests/navigation.test.mjs holds them to it.
 */

export type NavigationLink = {
  readonly href: string;
  readonly label: string;
};

export type FooterGroup = {
  readonly heading: string;
  readonly links: readonly NavigationLink[];
};

/*
 * Six items: SDK, Relay, Demo, Docs, Pricing, Blog.
 *
 * The five it replaces — Product, Demo, Docs, Pricing, Blog — were measured
 * against a 35-site developer-infrastructure corpus, where five is the mode and
 * every label is one the category already uses: Pricing on 33 of 35, Product on
 * 20, Docs on 20, Blog on 7 among single-product pre-scale companies. Docs,
 * Pricing, and Blog are unchanged and carry that evidence forward.
 *
 * Product is gone because the site sells two products. The word was a category
 * label for a company with one, and the corpus that supplied it is a corpus of
 * such companies. SDK and Relay are the products' own short names, fixed by
 * docs/identity.md §4, so neither is vocabulary a reader has to learn here.
 * Relay had no header entry at all: it was reachable from /pricing and from the
 * footer, which is how the second product a visitor can buy sat behind the
 * first one's page.
 *
 * Demo is a fragment and not a route. The running thing belongs directly under
 * the code that describes it, so it is a homepage band rather than a page of
 * its own — but a reader who arrives on /security or /pricing has no way back
 * to the one piece of evidence that executes, and "scroll the homepage" is not
 * a route. The item points at the band, which is why `currentNavigation` never
 * marks it: it names a place on a page, and the page it is on may be any of
 * them. `public/_redirects` keeps the retired `/demo` route pointing at the
 * scenarios, one band below.
 *
 * Learn and Security are not here, and no site in that corpus carries either
 * word at top level — not even the eleven whose whole product is security. That
 * reader arrives on a sent link or lands on /product; the header is not how
 * they get there. /security keeps its footer entry and its in-body link from
 * /product. /learn is gone as a route: the architecture argument it made is the
 * blog post it was competing with for the same phrase, and `public/_redirects`
 * sends the URL there.
 *
 * There is no Compare slot. It held one, directly after Product, because "why
 * not libsignal" is the first question anyone asks. The question is real; the
 * route was not. A reader asks it while they are weighing this package, which
 * is what /product is for, so the nav item interrupted the one comparison it
 * existed to serve — and one product's claims split across two routes is two
 * surfaces to keep true. The table and the five project notes are now the two
 * bands under "How it compares" on /product, and `public/_redirects` keeps
 * `/compare` pointing at them.
 */
export const headerNavigation: readonly NavigationLink[] = [
  { href: '/product', label: 'SDK' },
  { href: '/relay', label: 'Relay' },
  { href: '/#demo', label: 'Demo' },
  { href: 'https://docs.open-e2ee.dev', label: 'Docs' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
];

/*
 * The repository is a nav item on eight of the 35 sites in the corpus and the
 * mark is how it is recognized, so it is an action rather than a word — at
 * every width. Seven of those eight render the star count as the label rather
 * than a bare icon, which is a change this header has not made yet.
 */
export const repositoryUrl = 'https://github.com/open-e2ee/signal-protocol-js';

/*
 * The start, and the one control this site keeps in reach at every width.
 *
 * Account creation was the word `Console`, set as a quiet link in the utility
 * strip 16 pixels from a theme toggle, and at phone width it was one row in a
 * sheet a reader has to open first. Nothing about either said a reader could
 * begin there.
 *
 * The destination is the route that creates a project, because a Relay plan is
 * activated inside a project and the project is what the route makes. The
 * homepage hero and every self-service column on /pricing open the same route.
 */
export const startAction: NavigationLink = {
  href: 'https://console.open-e2ee.dev/relay/new',
  label: 'Start free',
};

/*
 * The returning reader's route, and it stays a word beside the control above.
 *
 * This entry was the only way into the console, and calling it "Sign in"
 * described the doorway rather than the room. With a start beside it the room
 * is named twice, so the doorway is the useful half: the start opens project
 * creation, which is the wrong room for a reader who already has a project,
 * and no footer group carries a console entry to fall back on.
 *
 * Quiet rather than filled. Two filled controls state no order, and the order
 * this row exists to state is that a reader with no account presses the other
 * one.
 */
export const consoleUrl = 'https://console.open-e2ee.dev';

/*
 * Three groups, and the heading is the only one that moved. The footer already
 * listed both products; it called the column that holds them Product, which is
 * the same singular the header carried.
 */
export const footerGroups: readonly FooterGroup[] = [
  {
    heading: 'Products',
    links: [
      { href: '/product', label: 'Signal Protocol SDK' },
      { href: '/relay', label: 'OpenE2EE Relay' },
      /* "Demo in your browser" pointed at /demo and is gone with the route.
         The scenarios are a homepage section now, and a footer link to a
         fragment of the page the logo above already links to is the kind of
         entry a footer accumulates rather than earns. */
      /* One entry, not two. This sat above a "Security review pack" link to
         /evaluate until that page folded into this one, and a footer column
         listing the same destination twice under two names is worse than the
         split it replaced. */
      { href: '/security', label: 'Security model' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/compare/virgil-security', label: 'Compare with Virgil Security' },
      { href: '/licensing', label: 'Licensing' },
      { href: 'mailto:licensing@open-e2ee.dev', label: 'Ask a licensing question' },
    ],
  },
  {
    heading: 'Build',
    links: [
      { href: 'https://docs.open-e2ee.dev/start/quickstart', label: 'Ten-minute quickstart' },
      { href: 'https://docs.open-e2ee.dev', label: 'Docs' },
      { href: repositoryUrl, label: 'SDK on GitHub' },
      {
        href: 'https://github.com/open-e2ee/signal-protocol-js/blob/main/docs/SECURITY.md',
        label: 'Threat model',
      },
    ],
  },
  {
    heading: 'Learn',
    links: [
      {
        href: '/blog/e2ee-changes-your-application-architecture/',
        label: 'E2EE changes your application architecture',
      },
      { href: '/blog', label: 'Blog' },
    ],
  },
];

/**
 * Whether a header destination is the page being read. An off-site link and a
 * fragment never match: neither names a page this site renders.
 */
export function currentNavigation(href: string, path: string): 'page' | undefined {
  if (!href.startsWith('/') || href.includes('#')) return undefined;
  return path === href || path.startsWith(`${href}/`) ? 'page' : undefined;
}
