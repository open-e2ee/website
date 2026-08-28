import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  commercialTermsPath,
  commercialTermsUrl,
  commercialTermsVersion,
  privacyEffectiveDate,
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
  assert.equal(privacyVersion, '2026-08-26');
  assert.equal(relayTermsVersion, 'relay-2026-08-26');
  assert.equal(relayTermsPath, '/legal/relay-terms/2026-08-26');
  assert.equal(relayTermsUrl, 'https://open-e2ee.dev/legal/relay-terms/2026-08-26');
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

test('reaches each agreement from the pages that sell against it', async () => {
  const [pricing, relayPricing, relay, licensing] = await Promise.all([
    flat('../src/pages/pricing.astro'),
    flat('../src/pages/relay/pricing.astro'),
    flat('../src/pages/relay/index.astro'),
    flat('../src/pages/licensing.astro'),
  ]);

  assert.match(pricing, /href="\/legal\/terms"/);
  assert.match(pricing, /href="\/legal\/relay-terms"/);
  assert.match(relayPricing, /href="\/legal\/relay-terms"/);
  assert.match(relay, /href="\/legal\/relay-terms"/);
  assert.match(pricing, /renews annually until you cancel/i);
  assert.match(licensing, /href="\/legal\/terms"/);
  /* Was /signed order form/. Which instrument closes which tier is a purchase
   * step, so /pricing's "How buying works" owns it and /licensing stopped
   * printing it a third time. What this page still owes is a description of
   * the negotiated path, which is what the pin follows. */
  assert.match(licensing, /separately negotiated production grant/i);
});

test('permanently redirects short and historical legal paths to one hierarchy', async () => {
  const redirects = await read('../public/_redirects');

  assert.match(redirects, /^\/terms \/legal\/terms\/ 308$/m);
  assert.match(redirects, /^\/privacy \/legal\/privacy\/ 308$/m);
  assert.match(redirects, /^\/terms\/2026-07-23 \/legal\/terms\/2026-07-23\/ 308$/m);
});
