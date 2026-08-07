import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  commercialTermsPath,
  commercialTermsUrl,
  commercialTermsVersion,
  privacyVersion,
} from '../src/lib/legal.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

test('pins the first Startup terms to an immutable canonical URL', () => {
  assert.equal(commercialTermsVersion, 'startup-2026-07-23');
  assert.equal(commercialTermsPath, '/legal/terms/2026-07-23');
  assert.equal(commercialTermsUrl, 'https://open-e2ee.dev/legal/terms/2026-07-23');
  assert.equal(privacyVersion, '2026-08-08');
});

test('publishes a legal index and canonical current, versioned, and privacy routes', async () => {
  const [legalIndex, currentTerms, versionedTerms, privacy] = await Promise.all([
    read('../src/pages/legal/index.astro'),
    read('../src/pages/legal/terms.astro'),
    read('../src/pages/legal/terms/2026-07-23.astro'),
    read('../src/pages/legal/privacy.astro'),
  ]);

  assert.match(legalIndex, /canonical="\/legal"/);
  assert.match(legalIndex, /href="\/legal\/terms"/);
  assert.match(legalIndex, /href="\/legal\/privacy"/);
  assert.match(currentTerms, /CommercialTerms/);
  assert.match(currentTerms, /canonical="\/legal\/terms"/);
  assert.match(versionedTerms, /commercialTermsPath/);
  assert.match(versionedTerms, /versioned/);
  assert.match(privacy, /Privacy Notice/);
  assert.match(privacy, /canonical="\/legal\/privacy"/);
});

test('makes privacy and terms available from the site footer', async () => {
  const footer = await read('../src/components/Footer.astro');
  assert.match(footer, /href="\/legal"/);
  assert.match(footer, /href="\/legal\/privacy"/);
  assert.match(footer, /href="\/legal\/terms"/);
  assert.match(footer, /OpenE2EE LLC and OpenE2EE contributors/);
});

test('discloses annual renewal and protects accepted versions from retroactive replacement', async () => {
  const terms = await flat('../src/components/CommercialTerms.astro');
  assert.match(terms, /automatically renews for successive one-year terms/i);
  assert.match(terms, /remains governed by the version recorded at checkout/i);
});

test('grants the licence over the package that is actually published', async () => {
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
  assert.match(
    privacy,
    /<strong>Version \{privacyVersion\}:<\/strong> an eleventh event was added/,
  );
  assert.doesNotMatch(
    privacy,
    /<strong>Version \{privacyVersion\}:<\/strong> a tenth event was added/,
  );
});

test('describes the implemented providers and the self-operated SDK boundary', async () => {
  const privacy = await flat('../src/pages/legal/privacy.astro');
  for (const provider of ['Cloudflare', 'Vercel', 'GitHub', 'Stripe', 'Google Workspace']) {
    assert.match(privacy, new RegExp(provider));
  }
  assert.match(privacy, /does not receive your application’s plaintext messages/i);
  assert.match(privacy, /We do not sell personal information/i);
});

test('reaches the terms from the pages that sell against them', async () => {
  const [pricing, licensing] = await Promise.all([
    flat('../src/pages/pricing.astro'),
    flat('../src/pages/licensing.astro'),
  ]);

  assert.match(pricing, /href="\/legal\/terms"/);
  assert.match(pricing, /renews annually until you cancel/i);
  assert.match(licensing, /href="\/legal\/terms"/);
  assert.match(licensing, /signed order form/i);
});

test('permanently redirects short and historical legal paths to one hierarchy', async () => {
  const redirects = await read('../public/_redirects');

  assert.match(redirects, /^\/terms \/legal\/terms\/ 308$/m);
  assert.match(redirects, /^\/privacy \/legal\/privacy\/ 308$/m);
  assert.match(redirects, /^\/terms\/2026-07-23 \/legal\/terms\/2026-07-23\/ 308$/m);
});
