import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { relayDevelopmentEnvironment, relayPlans } from '../src/data/relay-pricing.mjs';
import {
  commercialTermsPath,
  commercialTermsUrl,
  commercialTermsVersion,
  dpaEffectiveDate,
  dpaPath,
  dpaUrl,
  dpaVersion,
  privacyEffectiveDate,
  privacyPath,
  privacyUrl,
  privacyVersion,
  relayTermsPath,
  relayTermsUrl,
  relayTermsVersion,
} from '../src/lib/legal.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

test('pins the first Startup terms to an immutable canonical URL', () => {
  assert.equal(commercialTermsVersion, 'startup-2026-07-23');
  assert.equal(commercialTermsPath, '/legal/terms/2026-07-23');
  assert.equal(commercialTermsUrl, 'https://open-e2ee.dev/legal/terms/2026-07-23');
  assert.equal(privacyVersion, '2026-09-10');
  assert.equal(privacyPath, '/legal/privacy/2026-09-10');
  assert.equal(privacyUrl, 'https://open-e2ee.dev/legal/privacy/2026-09-10');
  assert.equal(relayTermsVersion, 'relay-2026-08-26');
  assert.equal(relayTermsPath, '/legal/relay-terms/2026-08-26');
  assert.equal(relayTermsUrl, 'https://open-e2ee.dev/legal/relay-terms/2026-08-26');
  assert.equal(dpaVersion, '2026-09-10');
  assert.equal(dpaEffectiveDate, 'September 10, 2026');
  assert.equal(dpaPath, '/legal/dpa/2026-09-10');
  assert.equal(dpaUrl, 'https://open-e2ee.dev/legal/dpa/2026-09-10');
});

/*
 * A version may be published more than once a day, and the suffix is how two
 * notices are told apart. The effective date may not drift away from it: it is
 * a representation about when these terms apply, and the site begins collecting
 * under a new notice the moment it deploys. A second change on one day dated
 * itself forward once, which would have had the page tell a reader the notice
 * took effect tomorrow while the event it describes was already being
 * collected.
 */
test('keeps the privacy effective date on the day its version names', () => {
  const day = /^(\d{4})-(\d{2})-(\d{2})(\.\d+)?$/.exec(privacyVersion);
  assert.ok(day, `privacy version ${privacyVersion} is not a date with an optional suffix`);

  const [, year, month, date] = day;
  const named = new Date(`${year}-${month}-${date}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.equal(privacyEffectiveDate, named);
});

test('publishes canonical current, versioned, privacy, and Relay policy routes', async () => {
  const [legalIndex, currentTerms, versionedTerms, relayTerms, relayVersion, privacy] = await Promise.all([
    read('../src/pages/legal/index.astro'),
    read('../src/pages/legal/terms.astro'),
    read('../src/pages/legal/terms/2026-07-23.astro'),
    read('../src/pages/legal/relay-terms.astro'),
    read('../src/pages/legal/relay-terms/2026-08-26.astro'),
    read('../src/pages/legal/privacy.astro'),
  ]);

  assert.match(legalIndex, /canonical="\/legal"/);
  assert.match(legalIndex, /href="\/legal\/terms"/);
  assert.match(legalIndex, /href="\/legal\/privacy"/);
  assert.match(currentTerms, /CommercialTerms/);
  assert.match(currentTerms, /canonical="\/legal\/terms"/);
  assert.match(versionedTerms, /canonical="\/legal\/terms\/2026-07-23"/);
  assert.match(legalIndex, /href="\/legal\/relay-terms"/);
  assert.match(legalIndex, /href="\/legal\/acceptable-use"/);
  assert.match(legalIndex, /href="\/legal\/subprocessors"/);
  assert.match(legalIndex, /href="\/legal\/relay-retention"/);
  assert.match(legalIndex, /href="\/legal\/relay-beta-limits"/);
  assert.match(relayTerms, /ManagedRelayTerms/);
  assert.match(relayTerms, /canonical="\/legal\/relay-terms"/);
  assert.match(relayVersion, /canonical="\/legal\/relay-terms\/2026-08-26"/);
  assert.match(privacy, /Privacy Notice/);
  assert.match(privacy, /canonical="\/legal\/privacy"/);
  assert.match(legalIndex, /href="\/legal\/dpa"/);
});

/*
 * The agreement binds on acceptance of the Relay terms and is never signed, so
 * the dated URL is the only record of which processor terms an organization is
 * under. The live route renders the component; the dated route may not.
 */
test('publishes the data processing agreement at a current and a dated route', async () => {
  const [live, dated] = await Promise.all([
    read('../src/pages/legal/dpa.astro'),
    read(`../src/pages/legal/dpa/${dpaVersion}.astro`),
  ]);

  assert.match(live, /DataProcessingAgreement/);
  assert.match(live, /canonical="\/legal\/dpa"/);
  assert.match(dated, new RegExp(`canonical="${dpaPath}"`));
});

const frozenDpaVersions = [
  { version: '2026-09-10', effective: 'September 10, 2026' },
];

test('keeps every dated DPA page frozen: it never reads the live agreement', async () => {
  for (const { version, effective } of frozenDpaVersions) {
    const page = await read(`../src/pages/legal/dpa/${version}.astro`);

    /* Path forms, as on the other two dated documents: the component name may
     * appear in this file's own comment explaining the freeze, and an import
     * resolves a path, so the paths are what is banned. */
    assert.doesNotMatch(page, /lib\/legal(\.mjs)?/, `${version} reads the live version constants`);
    assert.doesNotMatch(
      page,
      /components\/DataProcessingAgreement/,
      `${version} renders the live agreement`,
    );

    assert.match(
      page,
      new RegExp(`<span>Version ${version}</span>`),
      `${version} does not head itself as version ${version}`,
    );
    assert.match(
      page,
      new RegExp(`<span>Effective ${effective}</span>`),
      `${version} does not head itself as effective ${effective}`,
    );
    assert.match(
      page,
      new RegExp(`canonical="/legal/dpa/${version}"`),
      `${version} is not canonical at its own path`,
    );
  }
});

test('freezes the DPA version the site currently publishes', () => {
  const frozen = frozenDpaVersions.map(({ version }) => version);
  assert.ok(
    frozen.includes(dpaVersion),
    `DPA version ${dpaVersion} has no frozen page; frozen: ${frozen.join(', ')}`,
  );
});

/*
 * Article 28(3) is a list of things a processor contract must contain, and a
 * DPA that drops one of them is not a DPA. The anchors are the contract's own
 * table of contents, and a procurement reviewer follows them, so the section
 * has to exist on the live agreement and on every frozen copy of it.
 */
const DPA_SECTIONS = [
  'parties',
  'definitions',
  'roles',
  'instructions',
  'personnel',
  'security',
  'subprocessors',
  'requests',
  'breach',
  'assistance',
  'deletion',
  'transfers',
  'annex-i',
  'annex-ii',
];

test('carries every Article 28 section, on the live agreement and every frozen copy', async () => {
  const pages = [
    '../src/components/DataProcessingAgreement20260910.astro',
    ...frozenDpaVersions.map(({ version }) => `../src/pages/legal/dpa/${version}.astro`),
  ];

  for (const path of pages) {
    const page = await read(path);
    for (const id of DPA_SECTIONS) {
      assert.match(page, new RegExp(`<h[23] id="${id}">`), `${path} has no section #${id}`);
      assert.match(page, new RegExp(`<a href="#${id}">`), `${path} does not list #${id} in contents`);
    }
  }
});

/*
 * The dated page is the copy an order recorded at checkout stays bound to, so
 * its wording may never move when the live document does. Until 2026-08-09 it
 * rendered the shared CommercialTerms component, and the entity-name
 * correction of 2026-08-03 silently rewrote the "immutable" page — the exact
 * drift the URL exists to rule out. The text is now inlined in the dated page,
 * and this guard asserts non-coupling: the frozen source never reads the live
 * component or the live version constants, rather than asserting it equals
 * them, which would re-couple it to every future edit.
 */
test('keeps the dated terms page frozen: it never reads the live document', async () => {
  const versionedTerms = await read('../src/pages/legal/terms/2026-07-23.astro');

  /* Matched as names, not as import statements, so a re-render through any
   * future spelling — import, dynamic import, re-export — still reds. The
   * component name may appear in this file's own comment explaining the
   * freeze; imports resolve a path, so the path forms are what is banned. */
  assert.doesNotMatch(versionedTerms, /components\/CommercialTerms/);
  assert.doesNotMatch(versionedTerms, /lib\/legal(\.mjs)?/);

  /* And it carries its version identity as literals, so the constants moving
   * to a new version cannot move this page with them. */
  assert.match(versionedTerms, /Version startup-2026-07-23/);
  assert.match(versionedTerms, /Effective July 23, 2026/);
});

/*
 * The Relay page carries the same promise: the console records this URL when
 * an organization accepts the terms. It rendered the shared component until
 * 2026-09-10, so the guard the commercial page earned applies to it too.
 */
test('keeps the dated Relay terms page frozen: it never reads the live document', async () => {
  const versionedRelayTerms = await read('../src/pages/legal/relay-terms/2026-08-26.astro');

  assert.doesNotMatch(versionedRelayTerms, /components\/ManagedRelayTerms/);
  assert.doesNotMatch(versionedRelayTerms, /lib\/legal(\.mjs)?/);
  assert.match(versionedRelayTerms, /Version relay-2026-08-26/);
  assert.match(versionedRelayTerms, /Effective August 26, 2026/);
});

/*
 * The privacy notice earned the same treatment on 2026-09-10. Its Section 9
 * listed five superseded versions with nothing archived behind any of them, so
 * a correction to the live page rewrote what every one of those entries claims
 * to describe. Only versions published as their own frozen page are listed
 * here; the four before 2026-08-26 have no archived text and Section 9 says so.
 *
 * The list is written out rather than derived, because deriving it from the
 * live constant is the coupling the freeze exists to prevent: it would name
 * only the current version and go quiet about every earlier one the moment the
 * constant moves.
 */
const frozenPrivacyVersions = [
  { version: '2026-08-26', effective: 'August 26, 2026' },
  { version: '2026-09-10', effective: 'September 10, 2026' },
];

test('keeps every dated privacy page frozen: it never reads the live notice', async () => {
  for (const { version, effective } of frozenPrivacyVersions) {
    const page = await read(`../src/pages/legal/privacy/${version}.astro`);

    /* Path forms, as on the terms pages: a re-render through any future
     * spelling still reds, and the page's own comment may name what it froze. */
    assert.doesNotMatch(page, /lib\/legal(\.mjs)?/, `${version} reads the live version constants`);
    assert.doesNotMatch(page, /legal\/privacy\.astro/, `${version} renders the live notice`);

    /* The header spans, not the bare strings. Section 9 restates every version
     * number in its changelog, so a looser match was satisfied by the history
     * even after the header itself had been re-dated. */
    assert.match(
      page,
      new RegExp(`<span>Version ${version}</span>`),
      `${version} does not head itself as version ${version}`,
    );
    assert.match(
      page,
      new RegExp(`<span>Effective ${effective}</span>`),
      `${version} does not head itself as effective ${effective}`,
    );
    assert.match(
      page,
      new RegExp(`canonical="/legal/privacy/${version}"`),
      `${version} is not canonical at its own path`,
    );
  }
});

/*
 * And the version the site publishes today is one of them. This is the ratchet:
 * bumping privacyVersion without freezing the text it replaces leaves the new
 * Section 9 entry pointing at nothing, which is the state the freeze was
 * introduced to end.
 */
test('freezes the privacy version the notice currently publishes', () => {
  const frozen = frozenPrivacyVersions.map(({ version }) => version);
  assert.ok(
    frozen.includes(privacyVersion),
    `privacy version ${privacyVersion} has no frozen page; frozen: ${frozen.join(', ')}`,
  );
});

/*
 * Invariant 4 of the legal-terms-2026-09 plan: the fee table lives in the terms,
 * and /pricing is a summary of it. A price that appears on the pricing page and
 * not in the current Relay terms is a price no accepted document states.
 *
 * SKIPPED UNTIL LG7. Section 3 of relay-2026-08-26 incorporates /pricing by
 * reference instead of carrying the table, so this reads red against the
 * published version, and that version may not be edited. LG7 writes the table
 * into relay-2026-09-10 and removes this skip. The fail-before output is in
 * proof/legal-terms-2026-09/LG0.md.
 */
test('states every published price and included quantity in the Relay terms', { skip: 'LG7 pending' }, async () => {
  const terms = await flat('../src/components/ManagedRelayTerms20260826.astro');

  /* Bounded on both sides so a shorter figure cannot be satisfied by a longer
   * one containing it: "100" must not pass on "100,000", and "$0" must not
   * pass on "$0.50". */
  const states = (value, where) => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      terms,
      new RegExp(`(?<![\\d.,])${escaped}(?![\\d.,])`),
      `the Relay terms do not state ${where}: ${value}`,
    );
  };

  for (const plan of relayPlans) {
    states(plan.price, `the ${plan.name} price`);
    states(plan.relayMau, `the ${plan.name} Relay MAU allowance`);
    states(plan.deliveryUnits, `the ${plan.name} delivery units`);
    states(plan.attachmentOperations, `the ${plan.name} attachment uploads`);
    states(plan.storage, `the ${plan.name} storage`);
    for (const [meter, rate] of Object.entries(plan.overage ?? {})) {
      states(rate, `the ${plan.name} ${meter} overage rate`);
    }
  }

  for (const [meter, value] of Object.entries(relayDevelopmentEnvironment)) {
    if (meter === 'detail') continue;
    states(value, `the Development environment ${meter}`);
  }
});

test('makes privacy and terms available from the site footer', async () => {
  const footer = await read('../src/components/Footer.astro');
  assert.match(footer, /href="\/legal"/);
  assert.match(footer, /href="\/legal\/privacy"/);
  assert.match(footer, /href="\/legal\/terms"/);
  assert.match(footer, /href="\/legal\/relay-terms"/);
  assert.match(footer, /OpenE2EE LLC and OpenE2EE contributors/);
});

test('discloses annual renewal and protects accepted versions from retroactive replacement', async () => {
  const terms = await flat('../src/components/CommercialTerms.astro');
  assert.match(terms, /automatically renews for successive one-year terms/i);
  assert.match(terms, /remains governed by the version recorded at checkout/i);
});

test('grants the license over the package that is actually published', async () => {
  const terms = await flat('../src/components/CommercialTerms.astro');
  assert.match(terms, /@open-e2ee\/signal-protocol-sdk/);
  /* The pre-launch draft named a package that was never published. */
  assert.doesNotMatch(terms, /@open-e2ee\/sdk\b/);
});

/*
 * Section 9 promises a new effective date whenever the notice changes, so the
 * version constant moves with the text. The history then has to say which
 * version each change arrived in — and the way that silently stops being true
 * is interpolating the *current* version into a sentence about a past one,
 * which is what the tenth event's arrival did to the nine before it.
 */
test('keeps the privacy version history truthful about when each event arrived', async () => {
  const privacy = await flat('../src/pages/legal/privacy.astro');
  assert.match(privacy, /<strong>Version 2026-07-28:<\/strong>/);
  assert.match(privacy, /nine of them at that date/i);
  /* Every version but the newest is written out, because interpolating the
     constant into an older entry re-dates a change that already happened. */
  assert.match(privacy, /<strong>Version 2026-08-07:<\/strong> a tenth event was added/);
  assert.match(privacy, /<strong>Version 2026-08-07\.2:<\/strong>[^<]{0,240}eleventh event/);
  assert.match(privacy, /<strong>Version 2026-08-09:<\/strong> no new event/);

  /*
   * Exactly one entry may interpolate the constant, and this is the whole rule.
   *
   * It replaces a pair of doesNotMatch assertions keyed to each old entry's
   * prose ("a tenth event was added", "eleventh event"). Those were correct for
   * the history they were written against and self-defeating after it: catching
   * the next bump needed a new hand-written assertion, and nothing forced anyone
   * to write it. Simulate a 2026-08-10 bump where the maintainer forgets to
   * literalise 2026-08-09 and two entries interpolate — the prose-keyed version
   * passes, because neither of its two sentences is the one left interpolated.
   * Counting does not care which entry it is, so it never needs rewriting.
   *
   * The three literal matches above are not redundant to this. Counting sees
   * only how many entries interpolate, not whether a past entry still exists:
   * delete the .2 entry outright and the count is still 1. They also do the
   * other half of the work here — with all three older entries pinned to their
   * own literal dates, "exactly one interpolates" can only be satisfied by the
   * newest, so the pair together says what a per-entry assertion used to say
   * and stays true across every future bump.
   */
  const interpolated = privacy.match(/<strong>Version \{privacyVersion\}:<\/strong>/g) ?? [];
  assert.equal(
    interpolated.length,
    1,
    `${interpolated.length} changelog entries interpolate the constant; exactly one may`,
  );
});

test('describes the implemented providers and managed Relay boundary', async () => {
  const privacy = await flat('../src/pages/legal/privacy.astro');
  for (const provider of ['Cloudflare', 'Vercel', 'WorkOS', 'Stripe', 'Better Stack', 'Google Workspace']) {
    assert.match(privacy, new RegExp(provider));
  }
  assert.match(privacy, /does not receive message plaintext/i);
  assert.match(privacy, /customer-encrypted envelopes/i);
  assert.match(privacy, /We do not sell personal information/i);
});

test('publishes the exact Relay legal and lifecycle boundary', async () => {
  const [terms, acceptableUse, subprocessors, retention, beta] = await Promise.all([
    flat('../src/components/ManagedRelayTerms20260826.astro'),
    flat('../src/pages/legal/acceptable-use.astro'),
    flat('../src/pages/legal/subprocessors.astro'),
    flat('../src/pages/legal/relay-retention.astro'),
    flat('../src/pages/legal/relay-beta-limits.astro'),
  ]);

  assert.match(terms, /limited, non-exclusive, non-transferable, non-sublicensable commercial license/i);
  assert.match(terms, /grants no self-hosting right/i);
  assert.match(terms, /ends when the project is deleted or 30 days after/i);
  assert.match(acceptableUse, /spam, malware, phishing/i);
  for (const provider of ['Cloudflare', 'Vercel', 'WorkOS', 'Stripe', 'Better Stack']) {
    assert.match(subprocessors, new RegExp(provider));
  }
  assert.match(retention, /24-hour retention by default/i);
  assert.match(retention, /30-day maximum retention/i);
  assert.match(beta, /Direct encrypted envelope: 256 KiB maximum/i);
  assert.match(beta, /Group encrypted body: 96 KiB plus a 512-byte prefix/i);
});

/*
 * Section 7 of the data processing agreement makes this page the subprocessor
 * list the agreement refers to, and tells the reader it carries each provider's
 * purpose, data boundary, and processing location. A column dropped here makes
 * that sentence false for every provider; a row added without a location makes
 * it false for one, which is the harder version to notice.
 *
 * The row count is exact rather than a lower bound. A subprocessor added
 * without the notice this page promises is the failure the count is for, and a
 * lower bound cannot see it. Adding a provider means updating this number in
 * the same commit, which is the point.
 */
test('publishes the subprocessor list the agreement points at', async () => {
  const page = await read('../src/pages/legal/subprocessors.astro');
  /* Prose is read flattened: a sentence that wraps is the same promise, and a
   * guard that reads otherwise fails on a reflow instead of on a broken one. */
  const prose = page.replace(/\s+/g, ' ');
  const body = page.slice(page.indexOf('<tbody>'), page.indexOf('</tbody>'));
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell.trim()),
  );

  assert.equal(rows.length, 8, `the list publishes ${rows.length} providers`);
  assert.match(page, /<th>Location<\/th>/, 'the list publishes no location column');
  for (const cells of rows) {
    assert.equal(
      cells.length,
      4,
      `"${cells[0]}" has ${cells.length} cells, not provider, purpose, boundary, and location`,
    );
    assert.ok(cells[3], `"${cells[0]}" publishes no location`);
  }
  assert.ok(
    rows.some(([provider]) => provider === 'Neon'),
    'the console database provider is not on the list',
  );

  assert.match(
    prose,
    /at least 30 days’ notice by email to the project owner’s console address/,
    'the list does not state the notice period the agreement promises',
  );
  assert.match(
    prose,
    /urgently for security or service continuity/,
    'the notice promise carries no urgent carve-out, so it promises what an incident cannot keep',
  );
  assert.match(prose, /href="\/legal\/dpa"/, 'the list does not reach the agreement that cites it');
  assert.match(prose, /privacy@open-e2ee\.dev/, 'the list publishes no address to object to');
});

test('reaches each agreement from the pages that sell against it', async () => {
  const [pricing, relay, licensing, footer] = await Promise.all([
    flat('../src/pages/pricing.astro'),
    flat('../src/pages/relay/index.astro'),
    flat('../src/pages/licensing.astro'),
    flat('../src/components/Footer.astro'),
  ]);

  assert.match(pricing, /href="\/legal\/terms"/);
  /* The Relay plans sell against the Relay service terms. /pricing carries no
   * prose about them since the founder cut its How buying works band on
   * 2026-09-08, so the footer on every page, /pricing included, is the route,
   * and the console binds the terms at checkout. */
  assert.match(footer, /href="\/legal\/relay-terms"/);
  assert.match(relay, /href="\/legal\/relay-terms"/);
  assert.match(pricing, /renews annually until you cancel/i);
  assert.match(licensing, /href="\/legal\/terms"/);
  /* Was /signed order form/. Which instrument closes which tier is a purchase
   * step the agreement owns, so /licensing does not print it. What this page
   * still owes is a description of the negotiated path, which is what the pin
   * follows. */
  assert.match(licensing, /separately negotiated production grant/i);
});

test('permanently redirects short and historical legal paths to one hierarchy', async () => {
  const redirects = await read('../public/_redirects');

  assert.match(redirects, /^\/terms \/legal\/terms\/ 308$/m);
  assert.match(redirects, /^\/privacy \/legal\/privacy\/ 308$/m);
  assert.match(redirects, /^\/terms\/2026-07-23 \/legal\/terms\/2026-07-23\/ 308$/m);
});
