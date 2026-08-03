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

test('says the release is alpha on the page that sells it', async () => {
  const index = await flat('../src/pages/index.astro');

  /* messaging.md §4 fixes "alpha" as the word — not beta, not early access,
   * not preview — and §1.2 puts the limit in the same breath as the claim.
   * This sentence moved once for placement, which is exactly the edit that
   * loses a line like it. It may move again; it may not leave. */
  assert.match(index, /0\.1\.x alpha/);
  assert.match(index, /public APIs and persisted formats may change before 1\.0/);
  assert.doesNotMatch(index, /\b(?:beta|early access|preview)\b/i);
});

test('answers the runtime question on the homepage', async () => {
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

test('keeps the recorded carrier row on the page, wherever it sits', async () => {
  const index = await flat('../src/pages/index.astro');

  /* The panel left the hero for the band whose copy raises the question it
   * answers. Moving it is a layout decision; dropping it is not, because it
   * is the only thing on the site that shows rather than states what the
   * relay holds. A homepage that only asserts it has given up the argument. */
  assert.match(index, /<CarrierPanel \/>/);
  assert.match(index, /Not a mock-up/);
  assert.match(index, /captured by running the documented quickstart/);
});

test('gives the install command a control, and measures the one it declared', async () => {
  const [snippet, script] = await Promise.all([
    flat('../src/components/HeroSnippet.astro'),
    read('../public/measure.js'),
  ]);

  /* `install_copy` was in the declared nine before anything could send it
   * deliberately — the copy listener could only infer it from a selection.
   * The button is the deliberate path, and the hook the collector watches for
   * is the attribute, so renaming it silently stops the event. */
  assert.match(snippet, /data-install-copy/);
  assert.match(snippet, /navigator\.clipboard\.writeText/);
  assert.match(script, /\[data-install-copy\]'\)\) return send\('install_copy'\)/);
});

test('names every icon-only control it puts in the header', async () => {
  const [header, toggle, icon] = await Promise.all([
    flat('../src/components/Header.astro'),
    flat('../src/components/ThemeToggle.astro'),
    flat('../src/components/Icon.astro'),
  ]);

  /* DESIGN.md's accessibility baseline: a non-text control still needs a
   * name. Three of these became icons in one change, and an icon with no
   * name is a button that only sighted mouse users can identify. */
  assert.match(header, /aria-label="The SDK on GitHub"/);
  assert.match(toggle, /Colour theme: <span data-theme-label>/);
  /* Decorative inside a named control: the name must not be read twice. */
  assert.match(icon, /aria-hidden="true"/);
  assert.match(icon, /focusable="false"/);
});

test('sends the reader to the console rather than to a doorway', async () => {
  const header = await flat('../src/components/Header.astro');

  /* "Sign in" named the step, not the destination, and it was the only nav
   * item that described work rather than a place. */
  assert.match(header, />Console</);
  /* Link text only — the comment above the constant has to be free to say
   * what the label used to be and why it stopped being that. */
  assert.doesNotMatch(header, />\s*Sign in\s*</i);
});

test('ships the license for the icon set it copied', async () => {
  const [notices, license, icon] = await Promise.all([
    read('../THIRD_PARTY_NOTICES.md'),
    read('../third-party/Octicons-MIT.txt'),
    read('../src/components/Icon.astro'),
  ]);

  /* The MIT license asks for the notice to travel with the copy, and the
   * design system's own rule is that naming a license without shipping it
   * does not satisfy it. The paths are vendored, so this repository owes the
   * text — not a link to it. */
  assert.match(license, /Copyright \(c\) \d{4} GitHub Inc\./);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.match(notices, /third-party\/Octicons-MIT\.txt/);
  assert.match(icon, /THIRD_PARTY_NOTICES\.md/);
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

  /* Both build their links from a data array now, so the path is quoted
   * rather than written as an attribute. On the homepage it belongs in the
   * "Check the work" band with the rest of the evidence, not in a third row
   * of hero links competing with the one action the hero is for. */
  assert.match(index, /href: '\/evaluate'/);
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

test('names what the relay cannot read, in the drawings as well as the prose', async () => {
  const [signature, plaintext] = await Promise.all([
    flat('../src/components/SignatureDiagram.astro'),
    flat('../src/components/diagrams/WhoHoldsPlaintext.astro'),
  ]);

  /* A diagram is the part of a page that gets screenshotted and quoted with
   * none of the sentences around it. `cannot read` on its own reads as the
   * relay being blind, which is the wording messaging.md names as wrong; the
   * relay sees every routing field. The object is what makes it true. */
  for (const diagram of [signature, plaintext]) {
    assert.match(diagram, /cannot read plaintext<\/text>/);
    assert.doesNotMatch(diagram, /cannot read<\/text>/);
  }
});

test('gives the security page something to do at the end of it', async () => {
  const security = await flat('../src/pages/security.astro');

  /* The reader who finishes this page is usually reading it for someone else,
   * and used to arrive at two links weighted the same as the sentences above
   * them. The close has to carry an action of button weight. */
  const close = security.slice(security.lastIndexOf('Read the primary sources'));
  assert.match(close, /<a class="button" href="\/evaluate">/);
  assert.match(close, /class="button button-secondary"/);
});

test('keeps a narrowed container on the same left edge as everything else', async () => {
  const css = await read('../src/styles/global.css');

  /* `.container` centres its box and `.measure` narrows it, so composing them
   * centred a narrow box: five page heroes started a quarter of the way across
   * the page while the wordmark above and the bands below started at the
   * gutter. The container has to keep the left edge it would have had. */
  assert.match(
    css,
    /\.container\.measure \{\s*margin-inline: max\(0px, \(100% - var\(--oe-content-wide\)\) \/ 2\) auto;\s*\}/,
  );
  /* The cap is in `ch`, which resolves against the font of whatever carries it.
   * Moving it to the children stops it capping a 60px heading at all. */
  assert.doesNotMatch(css, /\.container\.measure > \*/);
});
