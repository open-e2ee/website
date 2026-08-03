/*
 * Claims on this site that are correct today and have no other guard.
 *
 * The build audit checks rendered output for banned claims, dead links, and
 * invented SDK symbols. These are the things it cannot see: a required
 * annotation quietly deleted, two pages drifting apart on a number, a promise
 * worded three different ways.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import capture from '../src/data/carrier-capture.json' with { type: 'json' };
import { checks, dependencies, reporting, specifications } from '../src/lib/assurance.mjs';
import { ELISION, heroCode, installCommand } from '../src/lib/hero-snippet.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

test('annotates the taglines as proposed, as the design contract requires', async () => {
  const footer = await flat('../src/components/Footer.astro');

  /* Founder sign-off has not landed. Until it does, every surface using the
   * taglines has to say so, and the footer is the surface that carries the
   * primary one on every page. Deleting the annotation without the sign-off
   * is the failure this test exists to catch. */
  assert.match(footer, /Opaque to the relay\. Open to inspection\./);
  assert.match(footer, /Brand language is provisional/i);
  assert.match(footer, /taglines are proposed, pending sign-off/i);
});

test('makes the same ten-minute promise everywhere it makes one', async () => {
  const [index, product, learn, footer] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/pages/product.astro'),
    flat('../src/pages/learn.astro'),
    flat('../src/components/Footer.astro'),
  ]);

  for (const page of [index, product, learn]) {
    assert.match(page, /ten minutes · two clients · no account/);
  }
  assert.match(learn, /takes about ten minutes/i);
  assert.match(footer, /Ten-minute quickstart/);
});

test('answers the runtime question from the hero', async () => {
  const index = await flat('../src/pages/index.astro');

  for (const runtime of ['expo', 'browser', 'node']) {
    assert.match(index, new RegExp(`docs\\.open-e2ee\\.dev/start/${runtime}`));
  }
});

test('shows only recorded code in the hero snippet', () => {
  /* The carrier panel's rule applies to the snippet beside it: nothing on
   * this page is drawn, mocked up, or hand-typed. A hero example written to
   * read well is a claim about the API surface, and it is the one claim this
   * brand cannot afford to get wrong. Anchors already throw at build time if
   * a re-recorded capture moves them; this catches an editor who pastes a
   * "small fix" into the rendered string instead. */
  const rendered = heroCode.split('\n').filter((line) => line && line !== ELISION);

  assert.ok(rendered.length > 0);
  for (const line of rendered) {
    assert.ok(
      capture.quickstartCode.includes(line),
      `hero line is not in the recorded capture: ${line}`,
    );
  }

  assert.equal(installCommand, `npm install ${capture.packageName}`);
});

test('answers “what does the relay see” in the fixed wording', async () => {
  const index = await flat('../src/pages/index.astro');

  /* messaging.md §3 fixes one sentence for this question and forbids
   * paraphrasing it into something stronger. The hero used to answer with
   * "your relay can't read it", which is the paraphrase the rule names, and
   * the page carried no instance of the formula itself. The formula and the
   * metadata caveat travel together, or the claim is only half stated. */
  assert.match(index, /The relay never needs message plaintext or device private keys\./);
  assert.match(index, /It still sees metadata/);
  assert.doesNotMatch(index, /relay can(?:’|')t read/i);
});

test('reaches the security review pack from the homepage and the footer', async () => {
  const [index, footer] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/components/Footer.astro'),
  ]);

  /* The homepage links it inline; the footer builds its columns from a data
   * array, so the path is quoted rather than written as an attribute. */
  assert.match(index, /href="\/evaluate"/);
  assert.match(footer, /href: '\/evaluate'/);
  assert.match(footer, /Security review pack/);
});

test('states the same assurance figures on every page that states them', async () => {
  const [security, evaluate] = await Promise.all([
    flat('../src/pages/security.astro'),
    flat('../src/pages/evaluate.astro'),
  ]);

  /* Both pages read the figures from src/lib/assurance.mjs rather than
   * writing them out, which is the only reason they cannot disagree. A page
   * that hardcodes one has opted out of that guarantee. */
  for (const page of [security, evaluate]) {
    assert.match(page, /from '\.\.\/lib\/assurance\.mjs'/);
    assert.doesNotMatch(page, new RegExp(checks.assertions));
    assert.doesNotMatch(page, /\b351 modules\b/);
  }
});

test('publishes a response window that matches the SDK security policy', () => {
  /* SECURITY.md in signal-protocol-js commits to acknowledgment within 48
   * hours and an initial assessment within 7 days. A site that promises
   * anything faster is writing a cheque the policy does not cover. */
  assert.equal(reporting.acknowledgment, '48 hours');
  assert.equal(reporting.assessment, '7 days');
  assert.equal(reporting.address, 'security@open-e2ee.dev');
});

test('dates every assurance figure it publishes', () => {
  assert.match(checks.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(checks.failed, 0);
  assert.equal(dependencies.direct, dependencies.names.length);
  assert.ok(dependencies.resolved > dependencies.direct);
  assert.ok(specifications.length > 0);
  for (const spec of specifications) {
    assert.ok(spec.name && spec.revision, `${spec.name} needs a pinned revision`);
  }
});

test('states the validation and audit position rather than omitting it', async () => {
  const [security, evaluate] = await Promise.all([
    flat('../src/pages/security.astro'),
    flat('../src/pages/evaluate.astro'),
  ]);

  for (const page of [security, evaluate]) {
    assert.match(page, /not FIPS 140-validated/);
  }
  assert.match(security, /No third-party security audit has been performed/i);
  assert.match(evaluate, /No third-party security audit has been performed/i);
});

test('offers the journal by feed as well as by page', async () => {
  const [layout, blogIndex, feed] = await Promise.all([
    flat('../src/layouts/BaseLayout.astro'),
    flat('../src/pages/blog/index.astro'),
    flat('../src/pages/rss.xml.ts'),
  ]);

  assert.match(layout, /rel="alternate" type="application\/rss\+xml"/);
  assert.match(blogIndex, /href="\/rss\.xml"/);
  /* Drafts are withheld from /blog; a feed that shipped them would be a way
   * around that rather than a second view of it. */
  assert.match(feed, /!data\.draft/);
});

test('does not let the Node store inherit the Expo store’s coverage', async () => {
  const product = await flat('../src/pages/product.astro');

  /* The SDK does multi-device and groups, and the site says so. It does them
   * through the Expo store: NodeSignalProtocolStore carries no sender keys,
   * message records, or device state, and does not declare `implements
   * ISignalProtocolLocalStore`. Listing the two stores as equals let a reader
   * combine two true sentences into a false one, which is the failure mode
   * this page is most exposed to. */
  assert.match(product, /does not yet cover sender keys, message records, or multi-device state/);
  assert.match(product, /groups and multi-device need the Expo store today/);
  assert.doesNotMatch(product, /the Expo and Node stores are the\s*well-trodden paths/);
});

test('gives every article its own share card, falling back to the site card', async () => {
  const [config, layout] = await Promise.all([
    flat('../src/content.config.ts'),
    flat('../src/layouts/BlogPostLayout.astro'),
  ]);

  assert.match(config, /image: z\.string\(\)\.optional\(\)/);
  assert.match(layout, /image=\{image\}/);
});
