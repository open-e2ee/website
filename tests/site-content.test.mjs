/*
 * Claims on this site that are correct today and have no other guard.
 *
 * The build audit checks rendered output for banned claims, dead links, and
 * invented SDK symbols. These are the things it cannot see: a required
 * annotation quietly deleted, two pages drifting apart on a number, a promise
 * worded three different ways.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import tokens from '@open-e2ee/design/tokens' with { type: 'json' };
import capture from '../src/data/carrier-capture.json' with { type: 'json' };
import { checks, dependencies, reporting, specifications } from '../src/lib/assurance.mjs';
import { codeSurfaces, codeThemes } from '../src/lib/code-theme.mjs';
import { ELISION, heroCode, installCommand } from '../src/lib/hero-snippet.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

test('annotates the taglines as proposed, as the design contract requires', async () => {
  /*
   * This used to pin three exact strings in Footer.astro. That guard was
   * right about the risk and wrong about the mechanism: it proved the footer
   * had not changed, not that the site kept its promise. When the founder
   * dropped the footer tagline on 2026-08-04 it failed for the correct edit,
   * and it would have passed happily if a tagline had appeared unannotated on
   * any of the other sixteen pages.
   *
   * So it now runs the design package's own checker over every built page.
   * `findTaglines` looks for the three proposed strings in the rendered text;
   * `checkTaglineAnnotation` passes a page that contains none, or one that
   * contains some and also matches ANNOTATION_PATTERN. That is the contract
   * verbatim, applied to what visitors actually receive.
   *
   * It is also the whole enforcement chain on this site. `npm run build` runs
   * brand:check and audit-build.mjs, and neither greps for taglines, so the
   * design repo's `oe-design taglines dist` gate never runs here. This test is
   * that gate.
   */
  const { checkTaglineAnnotation, findTaglines } = await import('@open-e2ee/design/taglines');

  const distDir = new URL('../dist/', import.meta.url);
  let pages;
  try {
    pages = (await readdir(distDir, { recursive: true })).filter((name) => name.endsWith('.html'));
  } catch {
    return; // dist/ absent — the build-output tests in this file all skip together.
  }
  assert.ok(pages.length >= 17, `expected the full site in dist/, found ${pages.length} pages`);

  const failures = [];
  const usingTagline = [];
  for (const page of pages) {
    const html = await readFile(new URL(page, distDir), 'utf8');
    const found = findTaglines(html);
    if (found.length > 0) usingTagline.push(page);
    if (!checkTaglineAnnotation(html, { source: page }).ok) failures.push(page);
  }

  assert.deepEqual(failures, [], `pages using a proposed tagline with no annotation: ${failures}`);

  /* The footer is global, so a tagline there put one on every page. Now
   * exactly one surface uses one — the /product h1 — and it annotates itself.
   * If this list grows, the annotation decision is being made again by
   * accident somewhere, and `docs/decisions.md` §1 is still open. */
  assert.deepEqual(usingTagline, ['product/index.html']);
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

test('shows every metadata field the relay was recorded holding', async () => {
  /* The panel is captioned "the row in your database" and used to render a
   * hand-written six of the recorded ten. The two it dropped —
   * `senderDeviceId` and `serverTimestamp` — are both genuinely relay-held;
   * the capture annotates the second "Real relays assign this too." Nobody
   * chose that. A copy of recorded data drifted from the recording, and it
   * drifted towards a relay that looks like it knows less than it does.
   *
   * So this asserts against the capture rather than against a list of names:
   * a re-recording that surfaces a new field fails here until the page shows
   * it. Held-back fields are enumerated, and each one has to be accounted for
   * in visible text — the reader is not asked to trust an omission. */
  const [panel, dist] = await Promise.all([
    flat('../src/components/CarrierPanel.astro'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(() => null),
  ]);

  const held = new Set(['ciphertext', 'id']);
  assert.match(panel, /const HELD_BACK = new Set\(\['ciphertext', 'id'\]\)/);
  assert.match(panel, /capture\.metadataFields\.filter/);

  const recorded = capture.metadataFields.map((entry) => entry.field);
  assert.ok(recorded.length >= 10, `capture recorded only ${recorded.length} metadata fields`);

  /* Every recorded key reaches metadataFields — otherwise the panel could be
   * faithful to an annotation list that is itself short of the real row. */
  for (const key of Object.keys(capture.relayRecord)) {
    assert.ok(recorded.includes(key), `relayRecord.${key} is absent from metadataFields`);
  }

  if (!dist) return; /* `npm test` before a build checks the source contract only. */

  for (const field of recorded) {
    if (held.has(field)) {
      assert.doesNotMatch(dist, new RegExp(`<dt>${field}</dt>`), `${field} is held back`);
      continue;
    }
    assert.match(dist, new RegExp(`<dt>${field}</dt>`), `${field} was recorded but is not shown`);
  }

  /* The held-back id is disclosed in prose, not merely absent. */
  assert.match(dist, /a relay-assigned envelope id, in whatever format your relay assigns/);
  assert.match(dist, /base64 characters, [\d,]+ bytes decoded, excerpt shown/);
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

test('announces the copy result somewhere a screen reader will hear it', async () => {
  const snippet = await flat('../src/components/HeroSnippet.astro');

  /* The success text used to be written into the visually hidden span that
   * gives the button its accessible name, and nothing else on the page
   * carried it. Two failures in one: NVDA and JAWS do not reliably re-announce
   * a focused control whose name mutates in place, so the only channel was
   * one that does not deliver; and the button's name is meant to say what it
   * does, not report what it did. The region has to exist at load and be
   * empty, because a live region inserted together with its text is not
   * announced either. */
  assert.match(snippet, /<span class="oe-visually-hidden" role="status" data-copy-status><\/span>/);
  assert.match(snippet, /status\.textContent = 'Install command copied'/);
  assert.doesNotMatch(snippet, /data-copy-label/);

  /* The failure branch returns before writing, so a refused clipboard stays
   * silent rather than claiming success. */
  const handler = snippet.slice(snippet.indexOf('addEventListener'));
  assert.ok(
    handler.indexOf('return;') < handler.indexOf("status.textContent = 'Install"),
    'the catch branch must return before anything announces success',
  );
});

test('never makes a control its own announcer', async () => {
  /* The copy button's comment argued this rule and the theme toggle two
   * elements away broke it, which is how a fresh reader found it: the page
   * stated the standard and then contradicted it in the same header. A live
   * region wrapped around the control that owns it fails in exactly the case
   * it was added for, because NVDA and JAWS do not reliably re-announce a
   * focused control whose name mutates. The announcement belongs to a sibling.
   *
   * Written against every component rather than the two known ones — the rule
   * is about controls, not about these controls. */
  const dir = new URL('../src/components/', import.meta.url);
  const names = (await readdir(dir)).filter((name) => name.endsWith('.astro'));
  assert.ok(names.length > 2, 'expected to be scanning a real component directory');

  for (const name of names) {
    const source = await flat(`../src/components/${name}`);
    for (const tag of source.match(/<(?:button|a|input|select|textarea)\b[^>]*>/g) ?? []) {
      assert.doesNotMatch(tag, /aria-live=/, `${name} announces from inside a control: ${tag}`);
    }
  }

  /* And the toggle in particular still announces somewhere, silently on load. */
  const toggle = await flat('../src/components/ThemeToggle.astro');
  assert.match(toggle, /<span class="oe-visually-hidden" role="status" data-theme-status><\/span>/);
  assert.match(toggle, /status\.textContent = `Colour theme set to \$\{next\}\.`/);
  const render = toggle.slice(toggle.indexOf('function render'), toggle.indexOf('render(getStoredTheme'));
  assert.doesNotMatch(render, /status/, 'restoring a stored preference must not announce a change');
});

test('does not name a code block after an affordance it does not have', async () => {
  /* Measured at 1440, 390 and 320 on both pages that carry one: scrollWidth
   * equals clientWidth every time. Narrow widths switch to `pre-wrap`, where
   * scrolling is impossible by construction, and the comment justifying the
   * old name had it backwards — it claimed the narrow screen was the scrolling
   * one. A name is for identifying the region; behaviour that depends on the
   * viewport and the recorded snippet's longest line does not belong in it. */
  for (const source of ['../src/components/HeroSnippet.astro', '../src/pages/product.astro']) {
    const text = await flat(source);
    assert.doesNotMatch(text, /aria-label="[^"]*scrollable/i, `${source} still promises scrolling`);
  }
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

test('renders a phone at the phone’s own width, so overflow is visible', async () => {
  const layout = await flat('../src/layouts/BaseLayout.astro');

  /* `width=device-width` alone lets a browser shrink the page to fit its widest
   * element. That turns a horizontal-overflow defect into a silently zoomed-out
   * page: the reader gets small text instead of a scrollbar, and a check that
   * compares scrollWidth against innerWidth sees nothing, because innerWidth
   * grew to match. It happened here — a 512 px diagram made a 390 px phone
   * report a 528 px viewport, and the overflow probe passed. */
  const viewport = layout.match(/name="viewport" content="([^"]+)"/)?.[1];
  assert.equal(viewport, 'width=device-width, initial-scale=1');

  /* Read off the attribute, not the file: the comment above this meta tag has
   * to name the two things that take pinch zoom away in order to say it does
   * not use them, and a scan of the whole file would find them there. WCAG
   * 1.4.4 needs zoom left alone, and pinning the *initial* scale does not
   * touch it. */
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*no|maximum-scale/);
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

test('does not let the experimental stores inherit the complete stores’ coverage', async () => {
  const [product, index] = await Promise.all([
    flat('../src/pages/product.astro'),
    flat('../src/pages/index.astro'),
  ]);

  /* This test used to pin the opposite fact. Through alpha.7,
   * `NodeSignalProtocolStore` carried no sender keys, message records or
   * device state and did not declare `implements ISignalProtocolLocalStore`,
   * so the risk was a reader promoting Node to the Expo store's coverage.
   * alpha.9 completed it — `adapter.d.ts` now declares the interface and ships
   * the sender-key, device-record and message-record surfaces — and the
   * sentence guarding the old shortfall became the false claim.
   *
   * The failure mode is unchanged, so the guard moves to the boundary that is
   * still real: `ADAPTERS.md` marks the browser and bare React Native stores
   * experimental, and nothing else. Both pages must keep saying so, and
   * neither may describe all four stores as equals. */
  assert.match(product, /Browser and bare React Native stores are experimental/);
  assert.match(product, /both implement <code>ISignalProtocolLocalStore<\/code> in full/);
  assert.match(index, /browser and bare\s+React Native stores are experimental/);

  for (const [name, source] of [
    ['product.astro', product],
    ['index.astro', index],
  ]) {
    assert.doesNotMatch(
      source,
      /all four stores|every store implements|any store you like/i,
      `${name} flattens the experimental boundary`,
    );
    /* The superseded claim must not survive in either page. */
    assert.doesNotMatch(source, /does not yet (?:cover|carry) sender keys/, name);
    assert.doesNotMatch(source, /groups and multi-device need the Expo store/, name);
  }
});

test('gives every article its own share card, falling back to the site card', async () => {
  const [config, layout] = await Promise.all([
    flat('../src/content.config.ts'),
    flat('../src/layouts/BlogPostLayout.astro'),
  ]);

  assert.match(config, /image: z\.string\(\)\.optional\(\)/);
  assert.match(layout, /image=\{image\}/);
});

test('keeps the signature diagram off the page that carries the plate', async () => {
  const [index, security, product] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/pages/security.astro'),
    flat('../src/pages/product.astro'),
  ]);

  /* The brief's test for the figure is whether a fresh reader reaches the
   * central boundary faster *with* it. Measured, they do not: its vocabulary
   * is the caption above it drawn, while the plate 100 px below names the
   * eight fields the relay actually held, with real values. Same boundary,
   * proof instead of assertion — and ~770 px of it on a 664 px phone.
   *
   * Three structural reasons hold it off this page specifically. Its content
   * bars are the sole encoding of "readable" and clear only 1.93:1 light and
   * 2.26:1 dark against WCAG 1.4.11's 3:1, and the token belongs to
   * @open-e2ee/design, so this page can stop depending on it but cannot fix
   * it. The design contract caps a screen at one signature device, naming
   * "the mark, a manifest plate, and the signature diagram in one screen" as
   * the failure — and this is the only page carrying the plate. The relay is
   * drawn as the OpenE2EE mark, so the node the reader must host wore the
   * vendor's logo directly under the header's.
   *
   * It is good work and it keeps two homes, where it is the only signature
   * device on the screen. This asserts the split, not the deletion: a future
   * round that fixes the ratio in the design package and wants it back has to
   * come here and say so. */
  assert.match(index, /<CarrierPanel \/>/);
  assert.doesNotMatch(index, /<SignatureDiagram \/>/);
  assert.doesNotMatch(index, /import SignatureDiagram/);

  for (const [name, page] of [
    ['security', security],
    ['product', product],
  ]) {
    assert.match(page, /<SignatureDiagram \/>/, `${name} lost the diagram`);
    assert.doesNotMatch(page, /<CarrierPanel \/>/, `${name} now shares a screen with the plate`);
  }

  /* The caption used to point at the drawing — "inside a device outline" —
   * and would have been left pointing at nothing. */
  assert.doesNotMatch(index, /device outline/);
  assert.match(index, /exist only on the devices at each end/);
});

test('keeps the relay formula out of the absolute, in the drawings too', async () => {
  const [signature, plaintext] = await Promise.all([
    flat('../src/components/SignatureDiagram.astro'),
    flat('../src/components/diagrams/WhoHoldsPlaintext.astro'),
  ]);

  /* A diagram is the part of a page that gets screenshotted and quoted with
   * none of the sentences around it, so its label has to survive alone.
   *
   * This used to require the object — `cannot read plaintext` rather than bare
   * `cannot read` — on the grounds that the relay sees every routing field and
   * "cannot read" alone reads as blindness. The object fixed the scope and left
   * the verb, and the verb is the part DESIGN.md rules on: "the relay formula
   * is fixed: 'the relay never needs message plaintext or device private keys.'
   * Do not paraphrase it into an absolute." `cannot` is that absolute. It is
   * also not true of a hostile relay, which /security states plainly: one can
   * substitute an identity before any trust is pinned, and a safety-number
   * comparison is what closes the gap. `never needs` is the defensible form and
   * the one the prose already uses. */
  for (const diagram of [signature, plaintext]) {
    assert.match(diagram, /never needs plaintext/);
    assert.doesNotMatch(diagram, /cannot read/);
  }

  /* The signature diagram draws two compositions — wide and stacked — and the
   * label above used to be pinned by the literal `…</text>` that followed it.
   * Both now render one constant, so the guard is that they still render the
   * same one: a hardcoded string in either composition is how the phone and
   * the desktop end up making different promises about the relay. */
  assert.match(signature, /relay: 'relay · never needs plaintext'/);
  assert.equal(signature.match(/\{LABELS\.relay\}/g)?.length, 2);
});

test('keeps the relay formula out of the absolute, in prose as well as in drawings', async () => {
  /* The test above ran on two files. The rule it enforces is not about
   * drawings — design/DESIGN.md fixes the formula for the site — and while it
   * watched the two SVGs, three instances of the absolute shipped in page
   * prose. /security asserted "it cannot read message plaintext or long-term
   * private keys" and then refuted itself sixteen lines below, in the callout
   * explaining that a relay hostile from the first message substitutes an
   * identity before any trust is pinned. /evaluate carried the same sentence
   * with no adjacent paragraph to qualify it at all.
   *
   * So this walks everything, and the file list is derived rather than
   * written down: a guard that names its own inputs stops covering the page
   * added after it. */
  const sources = [];
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(`${dir}${entry.name}/`);
      else if (/\.(astro|mdx|mjs|ts)$/.test(entry.name)) sources.push(`${dir}${entry.name}`);
    }
  };
  await walk('../src/');
  assert.ok(sources.length > 30, `expected to walk the whole tree, found ${sources.length} files`);

  /* Comments come out first. Explaining why a phrase is banned means writing
   * the phrase, and both files corrected here now quote the old sentence in a
   * comment above the new one. The rendered page is what the reader gets and
   * what the build audit greps; a comment is neither. */
  const prose = (text) =>
    text
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ');

  /* Both shapes, kept in step with BANNED in scripts/audit-build.mjs. That
   * one greps rendered HTML and so cannot see a string the page builds at
   * runtime or a component nothing routes to yet; this one reads the source
   * and cannot see wording assembled from parts. Neither subsumes the other. */
  const absolutes = [
    /\b(?:cannot|can't|can not|never)\s+(?:read|see|access|obtain|decrypt|recover)\b[^.]{0,40}\b(?:plaintext|private keys)\b/i,
    /\brelay\s+(?:cannot|can't|can not)\s+(?:read|see|access|decrypt)\b/i,
  ];

  for (const source of sources) {
    const text = prose(await read(source));
    for (const absolute of absolutes) {
      assert.doesNotMatch(text, absolute, `${source} paraphrases the relay formula into an absolute`);
    }
  }
});

test('keeps the relay formula intact in the strings that travel alone', async () => {
  /* A meta description is the one sentence that appears with none of the page
   * around it: a search result, a Slack unfurl, a link preview. This one said
   * the relay "carries sealed envelopes it cannot read", which the page's own
   * CarrierPanel disproves six fields later — and it was served four times, as
   * description, og:description, og:image:alt and twitter:description. The
   * diagram guard above covers the drawings; nothing covered this. */
  const pages = [
    'index',
    'product',
    'security',
    'learn',
    'compare',
    'evaluate',
    'pricing',
    'licensing',
  ];
  const descriptions = await Promise.all(
    pages.map(async (page) => [page, await flat(`../src/pages/${page}.astro`)]),
  );

  for (const [page, source] of descriptions) {
    const described = source.match(/description="([^"]+)"/)?.[1] ?? '';
    assert.notEqual(described, '', `${page} has no meta description`);
    assert.doesNotMatch(
      described,
      /(?:relay|server|envelopes?)[^"]*\bcannot read\b/i,
      `${page} description paraphrases the relay formula into an absolute`,
    );
    assert.doesNotMatch(
      described,
      /\b(?:sees nothing|zero[- ]knowledge|blind)\b/i,
      `${page} description claims the relay is blind`,
    );
  }
});

test('gives the security page something to do at the end of it', async () => {
  const security = await flat('../src/pages/security.astro');

  /* The reader who finishes this page is usually reading it for someone else,
   * and used to arrive at two links weighted the same as the sentences above
   * them. The close has to carry an action of button weight. */
  const close = security.slice(security.lastIndexOf('Read the primary sources'));
  assert.match(close, /<a class="oe-button" href="\/evaluate">/);
  assert.match(close, /class="oe-button oe-button-secondary"/);
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

test('lets the diagram switch compositions outrank the rule that sizes them', async () => {
  /* Comments stripped first: the one below quotes the selector it forbids. */
  const css = (await read('../src/styles/global.css')).replace(/\/\*[\s\S]*?\*\//g, '');

  /* `.diagram svg { display: block }` is (0,1,1). A media query adds no
   * specificity, so `.signature-diagram { display: none }` at (0,1,0) lost the
   * cascade and the page drew the wide and the stacked composition at every
   * width — a 512px drawing scrolling sideways inside a 356px column, with the
   * phone drawing underneath it. Both selectors have to keep `.diagram`. */
  for (const composition of ['signature-diagram', 'signature-diagram-stacked']) {
    const rules = [...css.matchAll(new RegExp(`^\\s*([^\\n{]*\\.${composition})\\s*\\{`, 'gm'))];
    assert.ok(rules.length > 0, `no rule targets .${composition}`);
    for (const [, selector] of rules) {
      assert.match(selector, /\.diagram\s/, `${selector.trim()} does not outrank .diagram svg`);
    }
  }
});

test('steps the headline down and the headings with it, at one breakpoint', async () => {
  const css = (await read('../src/styles/global.css')).replace(/\/\*[\s\S]*?\*\//g, '');

  /* Two declarations that are only correct together. Above 74rem the hero
   * headline is deliberately pulled to 2.375rem so it stops setting four lines
   * in a 5/12 column; the global h2 clamp keeps climbing to 2.25rem regardless,
   * and the two land 38px against 36px — the display headline and every section
   * heading at one size. The same pair is 1.30 apart at 390px, so it is a defect
   * of width, and it appeared the moment the h1 override was added.
   *
   * They therefore have to live in the same block: if the headline moves again,
   * or the breakpoint does, the ramp under it must move in the same edit. */
  /* The file opens more than one block at this breakpoint — the hero grid takes
   * its two columns at the same width — so this finds the one that sizes the
   * headline rather than the first one. */
  const blocks = [...css.matchAll(/@media \(min-width: 74rem\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const block = blocks.find((body) => /\.hero h1\s*\{/.test(body));
  assert.ok(block, 'no 74rem block sizes the hero headline any more');
  assert.match(block, /\.hero h1 \{\s*font-size: 2\.375rem;/);
  assert.match(block, /\.hero ~ \.band h2 \{\s*font-size: 1\.75rem;/);

  /* Scoped, and it stays scoped. Measured at 1440px every other page runs its
   * 60px h1 against the same 36px h2 for a ratio of 1.67, which is right;
   * re-capping the global clamp would flatten six healthy pages to correct one.
   * The bare `h2` rule keeps its ceiling. */
  assert.match(css, /\nh2 \{\s*font-size: clamp\(1\.625rem, 1\.25rem \+ 1\.6vw, 2\.25rem\);/);
});

test('never sets text in the border colour', async () => {
  const css = await read('../src/styles/global.css');

  /* `--oe-subtle` is `--oe-border-control` under another name, and the design
   * system holds it to 3:1 — a line's threshold, not a word's. It reaches
   * 3.41–4.60 across the six surfaces, so it fails 4.5:1 on six of the eight
   * surface-and-mode pairs. Sixteen rules had it as `color`, among them the
   * alpha caveat and the terms under the primary button: the two places the
   * page states its own limits were the two hardest on it to read. */
  assert.doesNotMatch(css, /color: var\(--oe-subtle\)/);
});

/* Relative luminance, then the WCAG ratio. Small enough to inline, and the
 * point of the test is that nothing between the palette and the page gets to
 * decide the answer. */
const luminance = (hex) => {
  const channels = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};

const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('keeps every syntax colour readable on the surface it is printed on', () => {
  /* The theme takes its colours from the pinned design package rather than
   * copying them, which is what makes an upstream palette edit reach the page
   * — and what makes it able to reach the page unnoticed. Code is body text at
   * 13.5px and below, so every role owes 4.5:1, comments included: the one
   * comment in the hero snippet is the page's central claim.
   *
   * A role that stops clearing the bar should fail here rather than ship. */
  for (const [mode, theme] of Object.entries(codeThemes)) {
    const surface = codeSurfaces[mode];
    assert.equal(theme.bg, surface.background);

    const roles = [['base', theme.fg], ...theme.settings.map((s, i) => [`role ${i}`, s.settings.foreground])];
    for (const [name, colour] of roles) {
      const measured = ratio(colour, surface.background);
      assert.ok(
        measured >= 4.5,
        `${mode} ${name} (${colour}) measures ${measured.toFixed(2)}:1 on ${surface.background}`,
      );
    }
  }
});

test('does not colour code with the action colour', () => {
  /* DESIGN.md reserves `ultra` for links, focus, and the accent, one per view,
   * and the hero already spends it on the primary button. Link-coloured text
   * inside a panel where nothing is clickable competes with the one control
   * the fold exists for, so the theme uses the brass primitive instead. */
  const ultra = Object.values(tokens.primitives.color.ultra).map((v) => v.toLowerCase());
  for (const theme of Object.values(codeThemes)) {
    const used = [theme.fg, ...theme.settings.map((s) => s.settings.foreground)];
    for (const colour of used) assert.ok(!ultra.includes(colour.toLowerCase()), `${colour} is an ultra step`);
  }
});

test('shows the receive side in the hero, not only the send', () => {
  /* `onMessageDecrypted` is the half a reader cannot infer from `send` — a
   * hook rather than a return value, because the message arrives when the
   * relay delivers it — and the recorded comment beside it is the page's
   * central claim in code that ran rather than in a sentence about code.
   * Trimming the snippet back to the send call gives both of those up. */
  assert.match(heroCode, /bob\.registerHook\("onMessageDecrypted"/);
  assert.match(heroCode, /plaintext, only on Bob's device/);
});

test('declares what the excerpt uses, and discloses what it still leaves out', async () => {
  const index = await flat('../src/pages/index.astro');

  /* Four fresh readers sized up the shorter excerpt and every one of them
   * found an identifier it used without declaring. `relay` was the expensive
   * one: a bare shorthand property in `adapters`, which each of them correctly
   * decoded as a server they would have to run — the largest line item in the
   * estimate, left to inference. The capture already contained the answer, so
   * the snippet now carries lines 1-5 verbatim and the specifiers disclose
   * themselves: `/local/store/mock` and `/remote/relay/mock`. */
  assert.match(heroCode, /import \{ mockStore \} from "@open-e2ee\/signal-protocol-sdk\/local\/store\/mock";/);
  assert.match(heroCode, /import \{ mockRelay \} from "@open-e2ee\/signal-protocol-sdk\/remote\/relay\/mock";/);
  assert.match(heroCode, /const relay = mockRelay\(\);/);

  /* No elision mark may stand between the imports and the relay: the only
   * thing between them in the recording is a blank line, and `…` claims code
   * was removed. */
  const opening = heroCode.slice(0, heroCode.indexOf('const relay = mockRelay();'));
  assert.doesNotMatch(opening, new RegExp(ELISION));

  /* The caption used to admit two of the four gaps and stay silent about the
   * two that cost real money. Partial candour about a sample reads worse than
   * none, because the reader who finds the omission stops trusting the
   * admission. */
  assert.match(index, /Not in this excerpt, and yours to supply/);
  assert.match(index, /a real store in place of <code>mockStore\(\)<\/code>/);
  assert.match(index, /the relay <code>mockRelay\(\)<\/code> stands in for/);
});

test('backs the durability claim it prints under the recorded row', async () => {
  const [capture, manifest, types, panel] = await Promise.all([
    readFile(new URL('../src/data/carrier-capture.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(
      new URL('../node_modules/@open-e2ee/signal-protocol-sdk/package.json', import.meta.url),
      'utf8',
    ).then(JSON.parse),
    readFile(
      new URL(
        '../node_modules/@open-e2ee/signal-protocol-sdk/dist/remote/relay/types.d.ts',
        import.meta.url,
      ),
      'utf8',
    ),
    flat('../src/components/CarrierPanel.astro'),
  ]);

  /* The panel is stamped with the version it was recorded at, which is older
   * than the version the install command fetches. Two fresh critics read that
   * gap as the page's one unverifiable exhibit. The caption answers it by
   * claiming the envelope did not move — and a claim like that is worth
   * exactly as much as the check behind it, on this panel more than anywhere
   * else on the site.
   *
   * So the claim is derived, not typed: every field name in the recording is
   * checked against the `Envelope` interface in the installed package's own
   * type declarations. A release that drops a field fails here rather than
   * shipping a caption that has quietly become false. */
  const envelope = types.match(/export interface Envelope \{[\s\S]*?\n\}/);
  assert.ok(envelope, 'no Envelope interface in the installed type declarations');
  const declared = new Set(
    envelope[0]
      .split('\n')
      .map((line) => line.match(/^\s+(\w+)\??\s*:/))
      .filter(Boolean)
      .map((m) => m[1]),
  );

  assert.ok(capture.metadataFields.length >= 10, 'the recording lost fields');
  for (const { field } of capture.metadataFields) {
    assert.ok(
      declared.has(field),
      `the caption claims every recorded field is still in the envelope, but "${field}" is not on Envelope in ${manifest.version}`,
    );
  }

  /* And the caption names the installed version rather than a string someone
   * typed, so it cannot say "unchanged at X" while the site builds against Y. */
  assert.match(panel, /every field shown is still in the envelope at \{installedVersion\}/);
  assert.match(panel, /const installedVersion = sdkManifest\.version;/);
});

test('shows the price it calls published, and cannot drift from /pricing', async () => {
  const { startupTier, tiers } = await import('../src/data/pricing.mjs');
  const [index, dist, pricingPage] = await Promise.all([
    flat('../src/pages/index.astro'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(() => null),
    readFile(new URL('../dist/pricing/index.html', import.meta.url), 'utf8').catch(() => null),
  ]);

  /* The landing page said "at a published price" and printed no price, while
   * /pricing had carried $5,000 the whole time. A fresh reader listed it as
   * one of two go/no-go inputs the page would not give them: "the word
   * 'published' promises a number that is not on the page and not linked".
   * Both surfaces now read the same module, so the only way to make them
   * disagree is to edit the module, which moves both. */
  assert.equal(startupTier.name, 'Startup');
  assert.match(startupTier.price, /^\$[\d,]+$/);
  assert.match(index, /from \$\{startupTier\.price\}/);
  assert.match(index, /href: '\/pricing'/);

  if (!dist) return;
  assert.doesNotMatch(dist, /at a published price/);
  assert.ok(
    dist.includes(startupTier.price),
    `landing page does not print the entry price ${startupTier.price}`,
  );
  assert.match(dist, /href="\/pricing"/);

  /* And the page it links to still renders every tier, so the link does not
   * lead somewhere that lost the number the cell just promised. */
  if (!pricingPage) return;
  for (const tier of tiers) {
    assert.ok(
      pricingPage.includes(tier.price),
      `/pricing does not render ${tier.name} at ${tier.price}`,
    );
  }
});

test('does not read the ciphertext blob aloud, and does not eat spaces', async () => {
  const [panel, dist] = await Promise.all([
    flat('../src/components/CarrierPanel.astro'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(() => null),
  ]);

  /* The excerpt is decoration for the eye and a wall for the ear. Hidden from
   * assistive technology, with the byte-count note left audible because it
   * says everything the blob says and in less than a second. */
  assert.match(panel, /<p class="carrier-cipher" aria-hidden="true">/);
  assert.match(panel, /base64 characters, \$\{/);
  if (!dist) return;

  /* Astro collapses the whitespace between a text node and a following inline
   * element, which silently joined "archived in 2021." to the package name
   * next to it. The guard is general because the failure is invisible in the
   * source — the source looks correctly spaced, and only the build is wrong. */
  const joins = [
    ...dist.matchAll(/([A-Za-z0-9.,;:!?)])<(code|a|strong|em)\b/g),
    ...dist.matchAll(/<\/(code|a|strong|em)>([A-Za-z0-9(])/g),
  ].map((m) => dist.slice(Math.max(0, m.index - 50), m.index + 40).replace(/\s+/g, ' '));
  assert.deepEqual(joins, [], `inline element joined to adjacent word:\n${joins.join('\n')}`);
});

test('quotes no number it did not measure', async () => {
  const dist = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!dist) return;

  /* Every number this page prints is one it can show its working for: the
   * ciphertext lengths are read off the recording, the version comes from the
   * capture, the date is stamped by the build, and "ten minutes · two clients"
   * describes the quickstart it links to. One clause broke the rule — "the
   * work teams usually discover three months in" — and two fresh readers
   * caught it independently in the same wave, one calling it an unsourced
   * vendor line and one "a made-up number in a page that is otherwise
   * scrupulous about sourcing". There are no teams to have measured it on:
   * this is a pre-launch alpha with no users, so the sentence was borrowing
   * the authority of a study that cannot exist.
   *
   * The guard is on the shape rather than the phrase, because the failure is
   * a habit and not a typo. A page with no customers cannot report what other
   * people's projects typically do, in any wording. */
  assert.doesNotMatch(dist, /three months in/);
  assert.doesNotMatch(
    dist,
    /\b(usually|typically|on average|nine out of|most teams|most developers)\b/i,
  );
});

test('does not overstate the one artefact that exists to not be overstated', async () => {
  const [panel, index, dist] = await Promise.all([
    flat('../src/components/CarrierPanel.astro'),
    flat('../src/pages/index.astro'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(() => null),
  ]);

  /* The caption read "recorded from a real round trip" while the disclosure
   * five lines under it read "captured by running the documented quickstart
   * against the mock relay". A fresh reader put the two together and was
   * right: the cryptography is real, the transport is a mock, and only the
   * first of those is what "a real round trip" claims. The panel's whole
   * function is that this page does not inflate its evidence, so an inflated
   * adjective costs more here than anywhere else on the site. */
  assert.match(panel, /recorded by running the quickstart/);
  assert.match(index, /against the mock relay/);
  /* Absence is asserted against the rendered page, not the source: the comment
   * recording *why* the adjective went has to be free to quote it. */
  if (dist) {
    assert.doesNotMatch(dist, /real round trip/);
    assert.match(dist, /recorded by running the quickstart/);
  }

  /* And the runtime cell no longer denies a build step in the sentence that
   * requires one. "No native crypto module to link" is scoped to the protocol
   * code, which is the scope docs/messaging.md §5 uses for the same claim;
   * SQLCipher needs a development build however it is generated, and
   * local/store/expo/README.md says so outright. */
  assert.match(index, /protocol code is pure TypeScript with no native crypto module/);
  assert.match(index, /needs a development build rather than Expo Go/);
  if (dist) assert.doesNotMatch(dist, /no prebuild step/);
});

test('names the cost of E2EE in the band whose title promises one', async () => {
  const index = await flat('../src/pages/index.astro');

  /* Nine fresh readers, and the two who reached the same omission reached it
   * from opposite directions: one asked how disputes and fraud review work
   * once the backend cannot read anything, the other that support messages
   * under E2EE cannot be produced under subpoena or supervised — "the page
   * never names the tradeoff, not to solve it, not even to acknowledge it
   * exists." The band has been titled "and what it costs you to find out"
   * since round 1 while listing six benefits, which is the kind of gap that
   * reads as concealment on a page whose whole argument is inspectability. */
  assert.match(index, /title: 'What you give up'/);
  assert.match(index, /nothing on your backend can search message contents/);
  assert.match(index, /produce them for a legal request/);

  /* The heading has to keep counting the cells, including the one that argues
   * against the product. A seventh cell under a heading that says six is the
   * same species of drift the carrier panel already paid for. */
  const cells = index.match(/title: '/g) ?? [];
  assert.equal(cells.length, 7, `differentiator count changed to ${cells.length}`);
  assert.match(index, /Seven things that decide/);

  /* Sending the wrong reader away is the point, not a hedge to be softened
   * later: the objective is qualified starts, and a team that needs
   * server-side moderation costs more to disappoint after the quickstart. */
  assert.match(index, /encrypt in transit and at rest instead/);

  /* Verified against the installed package rather than asserted: dist/device
   * exports createDeviceBackup, encryptBackup and restoreDeviceBackup over a
   * BackupStorage interface the application implements, and the transfer flow
   * pairs two devices by QR. So transfer ships and total-loss recovery does
   * not, and the sentence must not flatten either half — the first draft said
   * a user who loses every device loses their history, which is false for an
   * application that built the backup this cell says is theirs to build. */
  assert.match(index, /ships encrypted device-to-device transfer/);
  assert.match(index, /lost every device is a backup you design/);

  /* The disqualification is scoped to the server, because that is where the
   * constraint actually bites. "If your product needs any of that" turned
   * away products the SDK fits — a reader building a marketplace showed that
   * client-side reporting is a solved pattern, and this sentence is the last
   * one such a reader sees before leaving. It stays silent about that pattern
   * on purpose: the SDK ships no reporting API, and naming one here would
   * trade an over-disqualification for an invented feature. */
  assert.match(index, /If any of that has to happen on your server/);

  /* And the fold names the alternative the reader would actually take. Three
   * of four in the last wave wrote it out unprompted: ship on TLS and at-rest
   * encryption, revisit E2EE later. "more than TLS" is the first clause on
   * this page that speaks to them. */
  assert.match(index, /Not a\s+hosted chat service, and more than TLS/);

  /* Naming it is not arguing against it. Three readers in the next wave, all
   * three unprompted, returned the same verdict on those four words — "an
   * assertion, not an argument", "no threat named" — so the page states the
   * failure mode too, in the objection block where the libsignal argument
   * already lives. The hedge is load-bearing and reproduced from
   * docs/positioning.md §5: "can limit", not prevents, and about a breached
   * relay rather than about compliance. A stronger verb here would be the
   * exact overclaim that section exists to stop. */
  assert.match(index, /Why not just TLS\?/);
  assert.match(index, /can limit\s+the readable content a breached relay gives up/);
  assert.doesNotMatch(index, /(prevents|stops|eliminates) (a )?breach/i);

  /* The disqualifier is signposted rather than teased: the deck used to say
   * "including the one that decides it against" and decline to say which, so
   * the reader who should leave had to read all seven cards to find out. */
  assert.match(index, /Read <a href="#what-you-give-up">What you give up<\/a> first/);
  assert.match(index, /id: 'what-you-give-up'/);
  assert.match(index, /<li id=\{item\.id\}>/);

  /* docs/messaging.md §3 bans "the relay can't read your messages" by name.
   * The lead therefore claims what the envelope is, which the recorded row
   * below proves, and not what the relay is unable to do. */
  assert.match(index, /your own relay carries them as ciphertext/);
  assert.doesNotMatch(index, /relay (can'|cannot|can not)t? read/i);

  /* And it says "ciphertext" rather than "sealed", because "sealed sender" is
   * a feature this SDK actually has and the recorded relay row prints
   * `senderUserId` in the clear. For one round the lead read "carries them
   * sealed"; all three fresh readers of that round stopped on the word, one
   * asking "is that sealed sender? just encrypted?" and one naming it the
   * single place the page felt handled. A hero must not appear to promise a
   * named feature that the page's own evidence then shows switched off. The
   * assertion is on the built page rather than the source because the comment
   * above the lead quotes the rejected phrase. */
  const dist = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (dist) {
    assert.doesNotMatch(dist, /carries them sealed/);
    assert.match(dist, /carries them as ciphertext/);
    /* The carrier band's caption had the same collision and the worse
     * placement — it stands directly over the recorded row. */
    assert.doesNotMatch(dist, /Everything in between is\s+sealed/);
    assert.match(dist, /Everything in between is\s+ciphertext/);
    /* The feature band still names the real one, which is the whole reason
     * the loose sense had to go. "sealed" may appear on this page only as
     * part of "sealed sender". */
    assert.match(dist, /sealed sender/);
    for (const m of dist.matchAll(/sealed(?!\s+sender)/g)) {
      assert.fail(`"sealed" used loosely at index ${m.index}: ${dist.slice(m.index - 60, m.index + 40)}`);
    }
  }
});

test('says whether the adapters ship, wherever it says they are yours', async () => {
  const index = await flat('../src/pages/index.astro');

  /* The lead said "the SDK ships adapters for both" and the disclosure list
   * said "yours to supply", 450 px apart in the same viewport. Both true, the
   * pair not: a fresh reader could not tell whether they configure an adapter
   * or stand up a network service, which is the difference between an
   * afternoon and a sprint. The obligation and the shipped code have to be
   * named in the same breath or the page reads as two answers. */
  assert.match(index, /SDK ships adapters\s+for both/);
  for (const name of ['expoStore', 'nodeStore', 'indexedDbStore', 'convexRelay']) {
    assert.match(index, new RegExp(`<code\\s*>?${name}\\(\\)</code\\s*>?`), `${name} is not named`);
  }

  /* And the relay is defined where it is first demanded of the reader. Three
   * fresh readers in one wave, independently, called it the load-bearing noun
   * the page never explains. */
  assert.match(index, /the server that holds public keys\s+and device lists and delivers the encrypted envelopes/);

  /* Every identifier above must be a real export. The build audit resolves
   * them against the installed package, so this asserts that the resolver is
   * still pointed at a real installation — the four names are only evidence
   * for anything while something is checking them. */
  const surface = await readFile(new URL('../scripts/sdk-surface.mjs', import.meta.url), 'utf8');
  assert.match(surface, /SDK_PACKAGE = '@open-e2ee\/signal-protocol-sdk'/);
  assert.match(surface, /node_modules/);
});

test('names the other side of the experimental line', async () => {
  const [index, product] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/pages/product.astro'),
  ]);

  /* Five fresh readers split two ways on the unqualified sentence. One kind
   * read "Browser and bare React Native stores are experimental" as *browsers
   * are experimental*, which is harsher than the facts. The other kind reached
   * the right answer by elimination and then reported having constructed it
   * rather than read it — on the one question an Expo developer opens the page
   * with. ADAPTERS.md marks the web and react-native stores `(experimental)`
   * and puts no marker on the Expo or Node ones.
   *
   * "are not" rather than "are complete": an absent marker is evidence for the
   * absence of a marker, not for a capability grade, and the alpha clause in
   * front of it already governs all four. A test pins the weaker word so the
   * stronger one cannot drift in later. */
  assert.match(index, /Browser and bare\s+React Native stores are experimental; Expo and Node are not\./);
  assert.doesNotMatch(index, /stores are (complete|production-ready|stable|ready)/i);
  /* The sibling page still carries the fact it is tested for elsewhere. */
  assert.match(product, /Browser and bare React Native stores are experimental/);
});

test('says what Pricing sells, on the page that shows the nav item', async () => {
  const [index, pricing] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/pages/pricing.astro'),
  ]);

  /* Four fresh readers read "Pricing" and "Console" in the nav against
   * "nothing phones home" and "no account" in the body, and every one of them
   * concluded a hosted service was being hidden. It is a licence, not hosting,
   * and /pricing says so — but a reader forms the judgement in the first
   * viewport and never gets there. The claim has to hold on both pages or the
   * landing page is inventing a commercial model. */
  assert.match(index, /Free under AGPL-3\.0; <a href="\/pricing">commercial licence for closed source/);
  assert.match(pricing, /Free under AGPL\./i);

  /* The tier copy and the prices moved out of this page and into
   * src/data/pricing.mjs, so that the landing page could quote the entry
   * price from the same source instead of describing it. The assertions
   * follow the data rather than the file it used to live in. */
  const { tiers } = await import('../src/data/pricing.mjs');
  assert.ok(
    tiers.some((tier) => /You run your own infrastructure/i.test(tier.detail)),
    'the AGPL tier no longer says who runs the infrastructure',
  );

  /* The sentence that creates the debt now links to the page that prices it.
   * Three readers were told three times that a closed-source product owes a
   * licence fee and never once what it costs; one made it their largest gap on
   * the page, because "at a published price" asserts the price is public in
   * the same breath as not showing it. The numbers exist — this asserts they
   * do, so the link cannot come to point at a page that stopped saying them. */
  assert.ok(
    tiers.filter((tier) => /^\$[\d,]+\+?$/.test(tier.price)).length >= 3,
    'fewer than three tiers carry a concrete price',
  );
});

test('points at the documentation it says it has', async () => {
  const index = await flat('../src/pages/index.astro');

  /* "we document exactly what" is the hero's answer to the one question a
   * sceptic asks about a relay they own, and it linked to nothing — a promise
   * of evidence in the paragraph where the reader most wants to check it.
   * /security is where pricing, learn and product already send them. */
  assert.match(index, /<a href="\/security">we document exactly what<\/a>/);
});
