/*
 * Claims on this site that are correct today and have no other guard.
 *
 * The build audit checks rendered output for banned claims, dead links, and
 * invented SDK symbols. These are the things it cannot see: a required
 * annotation quietly deleted, two pages drifting apart on a number, a promise
 * worded three different ways.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import tokens from '@open-e2ee/design/tokens' with { type: 'json' };
import capture from '../src/data/carrier-capture.json' with { type: 'json' };
import { checks, dependencies, reporting, specifications } from '../src/lib/assurance.mjs';
import { codeSurfaces, codeThemes, shellSurface } from '../src/lib/code-theme.mjs';
import { cssRules, ruleFor } from './css-rules.mjs';
import {
  buildSnippet,
  defaultVariant,
  heroCode,
  installCommand,
  relayOptions,
  snippetComments,
  snippetVariants,
  storageOptions,
} from '../src/lib/hero-snippet.mjs';

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

  /* The homepage makes the promise twice and not three times, and never in
   * the hero. It is an argument for spending the ten minutes, so it belongs
   * under the two buttons a reader reaches after the evidence — not under the
   * first one, where it was a third line of small grey type standing between
   * the offer and the proof. The count is asserted because the failure mode
   * is additive: a sublabel is the obvious thing to paste onto a new CTA. */
  const dist = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!dist) return;
  assert.equal((dist.match(/ten minutes · two clients · no account/g) ?? []).length, 2);
  const heroStart = dist.indexOf('<section class="hero">');
  assert.notEqual(heroStart, -1, 'the hero section is not on the built page');
  const hero = dist.slice(heroStart, dist.indexOf('</section>', heroStart));
  assert.doesNotMatch(hero, /cta-sublabel/);
});

test('says the release is alpha on the page that sells it', async () => {
  const index = await flat('../src/pages/index.astro');

  /* messaging.md §4 fixes "alpha" as the word — not beta, not early access,
   * not preview — and §1.2 puts the limit in the same breath as the claim.
   * This sentence has now moved twice for placement, which is exactly the edit
   * that loses a line like it. It may move again; it may not leave. */
  assert.match(index, /0\.1\.x alpha/);
  assert.match(index, /public APIs and persisted formats may change before 1\.0/);
  assert.doesNotMatch(index, /\b(?:beta|early access|preview)\b/i);

  /* Asserted on the built page too, and specifically out of `.hero-copy`: the
   * second move took it off the opening block, where it was the third grey
   * line under the lead, and put it at the foot of the objections it belongs
   * with. Source-side matching cannot tell the two apart, and it cannot tell
   * either of them from the comment above the paragraph explaining the move. */
  const dist = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!dist) return;
  const copy = dist.slice(dist.indexOf('<div class="hero-copy">'), dist.indexOf('<div class="hero-demo">'));
  assert.doesNotMatch(copy, /0\.1\.x alpha/);
  assert.match(dist, /0\.1\.x alpha/);
  assert.match(dist, /public APIs and persisted formats may change before 1\.0/);
  assert.match(dist, /Free under AGPL-3\.0/);
});

test('answers the runtime question on the homepage', async () => {
  const index = await flat('../src/pages/index.astro');

  for (const runtime of ['expo', 'browser', 'node']) {
    assert.match(index, new RegExp(`docs\\.open-e2ee\\.dev/start/${runtime}`));
  }
});

test('keeps the hero snippet traceable to the recording, rename apart', () => {
  /* The carrier panel's rule applies to the snippet beside it: nothing on
   * this page is drawn, mocked up, or hand-typed. A hero example written to
   * read well is a claim about the API surface, and it is the one claim this
   * brand cannot afford to get wrong.
   *
   * The rule used to be "every line appears in the capture", which the
   * selector broke honestly: the recording drives an `alice` and a `bob` in
   * one process, and an application has one client. So the test now allows
   * exactly one transformation — that rename — and nothing else. Undo the
   * rename and every line must be back in the recording verbatim. An editor
   * who pastes a "small fix" into the rendered string still fails here,
   * because a fix is not a rename. */
  /* Comment-only lines are the page's own voice and are excluded here, then
   * held to their own rule in the test below. Splitting the two is what keeps
   * this assertion meaningful: the recording proves the API, and a comment
   * makes no API claim, so requiring it to appear in a capture of a program
   * that has no comments would only mean the panel could not have any.
   *
   * Trailing comments are not excluded and must not be. `// plaintext, only on
   * this device` rides on a code line, is in the recording as "only on Bob's
   * device", and the rename above is what carries it — so it is still proved
   * by the capture like the code it annotates. */
  const all = heroCode.split('\n').filter((line) => line.trim());
  const rendered = all.filter((line) => !line.trim().startsWith('//'));
  assert.ok(rendered.length > 0);
  assert.ok(all.length > rendered.length, 'the panel lost the comments that explain it');

  const unrename = (line) =>
    line
      .replace(/\bconst signal\b/, 'const alice')
      .replace(/\bawait signal\.send\b/, 'await alice.send')
      .replace(/\bsignal\./g, 'bob.')
      .replace('only on this device', "only on Bob's device");

  for (const line of rendered) {
    assert.ok(
      capture.quickstartCode.includes(unrename(line)),
      `hero line is not in the recorded capture, even after the rename: ${line}`,
    );
  }

  /* The rename is the only licensed edit, so `alice` and `bob` must not
   * survive as identifiers in the example. The message string still names
   * `"bob"` as a recipient, which is data rather than a client. */
  assert.doesNotMatch(heroCode, /\b(?:alice|bob)\s*\./);
  assert.doesNotMatch(heroCode, /\bconst (?:alice|bob)\b/);

  assert.equal(installCommand, `npm install ${capture.packageName}`);
});

test('offers every adapter as a real, complete, copyable program', () => {
  /* Ten variants, five stores by two relays, and the reason they are all
   * pre-rendered is in HeroSnippet.astro: `script-src 'self'` leaves no room
   * for a runtime highlighter, so a combination that did not exist at build
   * time could never be coloured. This test is what stops that fan-out
   * becoming ten chances to ship a wrong import. */
  assert.equal(snippetVariants.length, storageOptions.length * relayOptions.length);
  assert.equal(snippetVariants.length, 10);

  for (const variant of snippetVariants) {
    const store = storageOptions.find((option) => option.id === variant.storage);
    const relay = relayOptions.find((option) => option.id === variant.relay);

    /* Each variant imports its own two adapters, plus whatever else an adapter
     * needs to be constructible — the Convex relay needs a client class and a
     * generated API module, and a variant that dropped either would still look
     * like a program. */
    for (const line of [...(store.imports ?? []), ...(relay.imports ?? [])]) {
      assert.ok(
        variant.code.includes(line),
        `${variant.storage}/${variant.relay} is missing an import its adapter needs: ${line}`,
      );
    }
    assert.match(
      variant.code,
      new RegExp(
        `import \\{ ${store.symbol} \\} from "${capture.packageName}/${store.subpath}";`.replace(
          /[/]/g,
          '\\/',
        ),
      ),
      `${variant.storage}/${variant.relay} does not import its store`,
    );
    assert.ok(
      variant.code.includes(relay.setup),
      `${variant.storage}/${variant.relay} does not construct its relay`,
    );

    /* No elision may reappear. The panel has a copy button on it, and a
     * program with a hole in it is not a program. */
    assert.doesNotMatch(variant.code, /…|\.\.\./);

    /* An async factory that lost its `await` hands the client a pending
     * promise where a store belongs — a defect that type-checks in the
     * reader's head and fails at runtime. */
    if (store.expr.startsWith('await ')) {
      assert.ok(
        variant.code.includes(`storage: await ${store.symbol}(`),
        `${variant.storage} store is async and must be awaited`,
      );
    }
  }

  /* The default is the combination the capture was recorded with, so the
   * provenance test above is testing the snippet a reader sees first. */
  assert.equal(heroCode, buildSnippet(defaultVariant.storage, defaultVariant.relay));
  assert.equal(defaultVariant.storage, 'memory');
  assert.equal(defaultVariant.relay, 'memory');

  assert.throws(() => buildSnippet('nope', 'memory'), /Unknown storage adapter/);
  assert.throws(() => buildSnippet('memory', 'nope'), /Unknown relay adapter/);
});

test('keeps the nine unselected variants out of the page and out of the tab order', async () => {
  const [component, css] = await Promise.all([
    flat('../src/components/HeroSnippet.astro'),
    readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8'),
  ]);

  /* Ten programs are in the document and nine are `hidden`. The attribute is
   * the mechanism, because it takes them out of the accessibility tree as
   * well as off the page — and shiki puts `tabindex="0"` on every `<pre>` for
   * scrollability, so nine unreachable-by-mouse scroll containers would
   * otherwise sit in the tab order. Verified in a browser: 13 focusable
   * candidates, 4 actually reachable. This is the rule that makes that true,
   * and a later `display` declaration on `.code-variant` could quietly undo
   * it. */
  assert.match(component, /hidden=\{!variant\.isDefault\}/);
  assert.match(css, /\.code-variant\[hidden\]\s*\{\s*display:\s*none;/);
});

test('gives the panel a focus ring the design system does not supply', async () => {
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

  /* `components.css` scopes its ring to `:where(a, button, summary, input,
   * [tabindex])`. `select` is not in that list, so the adapter controls fell
   * back to the browser's own ring — a different colour, width and offset
   * from every other focusable thing on the page. Measured before the fix:
   * `auto 1px rgb(153, 200, 255)`. */
  const rule = css.match(/\.code-select select:focus-visible \{[^}]*\}/)?.[0];
  assert.ok(rule, 'the adapter select must restate the focus ring');
  assert.match(rule, /outline:\s*var\(--oe-control-focus-width\) solid var\(--oe-focus\)/);
});

test('lets the panel copy control outrank the shell one it shares a class with', async () => {
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

  /* Both buttons carry `.copy-button`; only one is in a terminal. `.code-copy`
   * re-colours the other for the editor surface, and both selectors are
   * (0,1,0) — so the cascade decides on source order alone, and written in
   * the wrong order every declaration is dropped without warning.
   *
   * That is exactly what shipped for one build: `--oe-shell-prompt` at 2.48
   * on white, on the panel's only control, while `tests/contrast.test.mjs`
   * passed the whole time. It was measuring whether the intended pair clears
   * AA, which it does, and nothing was measuring whether the stylesheet
   * reaches the element. This assertion is the missing half. */
  assert.ok(
    css.indexOf('.code-copy {') > css.lastIndexOf('.copy-button:hover'),
    '.code-copy must come after .copy-button, or its colours are silently dropped',
  );
});

test('says the program changed, to a reader who cannot see it change', async () => {
  const component = await flat('../src/components/HeroSnippet.astro');

  /* Focus stays on the combobox across a change, so the only thing announced
   * is the option name. Without this the swap of ten blocks is silent. */
  assert.match(component, /role="status" data-variant-status/);
  assert.match(component, /variantStatus\.textContent = label/);

  /* Read from the shown block's own accessible name rather than rebuilt, so
   * the announcement and the label cannot drift. */
  assert.match(component, /shown\?\.getAttribute\('aria-label'\)/);
});

test('does not expand measurement to the control this round added', async () => {
  const component = await flat('../src/components/HeroSnippet.astro');

  /* The install command's copy fires `install_copy`, and the collector, the
   * tests and the privacy contract all know about it. The example's copy
   * button fires nothing, and that is deliberate: a fourth event would need
   * all three updated in the same change, and the brief forbids expanding
   * measurement without it. */
  const codeCopyHandler = component.slice(component.indexOf('codeButton?.addEventListener'));
  assert.doesNotMatch(codeCopyHandler, /measure|beacon|sendBeacon|\/e\b/i);
});

test('marks the experimental stores in the selector, and only those', async () => {
  /* index.astro and /product both carry "Browser and bare React Native stores
   * are experimental; Expo and Node are not", and two tests below hold them
   * to it. A dropdown that offered all five as peers would be the one place
   * on the page where that sentence is contradicted by the control it
   * describes — and the control is where the reader actually commits. */
  const experimental = storageOptions.filter((option) => option.experimental).map((o) => o.id);
  assert.deepEqual(experimental.sort(), ['react-native', 'web']);
  assert.deepEqual(
    relayOptions.filter((option) => option.experimental),
    [],
  );

  const component = await flat('../src/components/HeroSnippet.astro');
  assert.match(component, /\(experimental\)/);
});

test('binds the names the reader brings, or says whose they are', async () => {
  /* Some options need a value the SDK does not export. Left unaccounted for,
   * those identifiers read as SDK exports — and this is the one class of false
   * claim the build audit cannot catch, because the symbol would not be ours
   * to check.
   *
   * There are two honest ways to account for one, and which applies is a fact
   * about the value rather than a matter of taste. If something importable
   * produces it, the program imports it and needs no caption. If nothing does,
   * a comment has to say whose it is. This test holds each option to whichever
   * one its value admits, and it exists because the page did the weaker thing
   * in both cases for a while: `convex` and `api` were described in a comment
   * when they could simply have been bound. */
  const binds = (line, name) => {
    const imported = line.match(/^import \{([^}]+)\} from /);
    if (imported) {
      const specifiers = imported[1].split(',').map((part) => part.trim().split(/\s+as\s+/).pop());
      if (specifiers.includes(name)) return true;
    }
    return new RegExp(`^\\s*const ${name}\\b`).test(line);
  };

  /* `storage` is the one that cannot be bound: `ReactNativeKeyValueStorage` is
   * an interface the reader implements, and naming a package that satisfies it
   * would be invented usage of somebody else's API. */
  const rn = storageOptions.find((option) => option.id === 'react-native');
  assert.match(rn.comment, /your own ReactNativeKeyValueStorage/);
  assert.ok(rn.expr.includes('storage'));

  /* `convex` and `api` can be, and so must be. The comment that stood here is
   * asserted gone rather than merely not asserted present — a disclosure left
   * beside the binding that replaced it is the state this change was made to
   * leave behind. */
  const convex = relayOptions.find((option) => option.id === 'convex');
  assert.equal(convex.comment, undefined, 'the Convex relay still captions what it now imports');
  assert.ok(
    convex.imports.some((line) => line.includes('convex/react')),
    'the Convex relay does not import a client',
  );
  assert.ok(
    convex.imports.some((line) => line.includes('_generated/api')),
    'the Convex relay does not import a generated API',
  );
  assert.match(convex.setup, /const convex = new ConvexReactClient\(/);

  for (const variant of snippetVariants) {
    const lines = variant.code.split('\n');

    /* Every name the program uses and did not get from the SDK is bound before
     * the line that uses it. Two exclusions from the search for a use, and both
     * are about not letting a line count as its own reader: an `import` line
     * mentions a name inside a string — `"convex/react"` contains `convex` and
     * is not a reference to it — and the line that binds a name mentions it by
     * definition. */
    for (const name of ['convex', 'api']) {
      const mentions = new RegExp(`\\b${name}\\b`);
      const bound = lines.findIndex((line) => binds(line, name));
      const used = lines.findIndex(
        (line) => !line.startsWith('import ') && !binds(line, name) && mentions.test(line),
      );
      if (bound === -1 && used === -1) continue;
      /* Both directions. A binding with no use is an import a reader deletes,
       * which is the same class of waste as a use with no binding is of error. */
      assert.ok(used !== -1, `${variant.storage}/${variant.relay} binds ${name} and never uses it`);
      assert.ok(bound !== -1, `${variant.storage}/${variant.relay} uses ${name} unbound`);
      assert.ok(bound < used, `${name} is used before it is bound`);
    }

    /* And the one that is disclosed instead is disclosed exactly where it is
     * needed. Matched on the interface name rather than on a phrase like "is
     * your", which a narrative comment could also satisfy: a marker a passing
     * comment can meet would let the real disclosure go missing without
     * failing. */
    const bringsOwn = variant.storage === 'react-native';
    assert.equal(
      /ReactNativeKeyValueStorage/.test(variant.code),
      bringsOwn,
      `${variant.storage}/${variant.relay} disclosure does not match its store`,
    );
    if (bringsOwn) {
      const said = lines.findIndex((line) => line.includes('ReactNativeKeyValueStorage'));
      const used = lines.findIndex((line) => line.includes('reactNativeStore({ storage })'));
      assert.ok(said !== -1 && said < used, 'the store is used before its object is explained');
    }
  }

  /* Every comment-only line in every variant is one the module declares. The
   * panel is now a place the page can say things in its own voice, and this is
   * the boundary on that: a claim smuggled into the program has to be added to
   * `snippetComments` first, where the absolutes guard and the build audit both
   * already read it. */
  const declared = new Set(snippetComments);
  for (const variant of snippetVariants) {
    for (const line of variant.code.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('//')) continue;
      assert.ok(
        declared.has(trimmed),
        `${variant.storage}/${variant.relay} carries an undeclared comment: ${trimmed}`,
      );
    }
  }

  /* The old mechanism is gone rather than orphaned — an unused class and a
   * dead `.code-note` rule would both read as something still in use. */
  const [raw, css] = await Promise.all([
    flat('../src/components/HeroSnippet.astro'),
    read('../src/styles/global.css'),
  ]);
  /* Comments out first, for the reason the absolutes guard strips them: the
   * comment that records this removal has to name what it removed. */
  const component = raw.replace(/\{\/\*.*?\*\/\}/g, ' ');
  assert.doesNotMatch(component, /class="code-note"/);
  assert.doesNotMatch(component, /variant\.notes/);
  assert.equal(cssRules(css).filter((rule) => rule.selector === '.code-note').length, 0);
});

test('keeps the recorded carrier row on the page, wherever it sits', async () => {
  const [index, live] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/components/demo/LiveCarrierPanel.astro'),
  ]);

  /* The panel left the hero for the band whose copy raises the question it
   * answers. Moving it is a layout decision; dropping it is not, because it
   * is the only thing on the site that shows rather than states what the
   * relay holds. A homepage that only asserts it has given up the argument.
   *
   * It moved once more when the live demo landed: the page now renders
   * `LiveCarrierPanel`, which renders the recording and puts a live panel in
   * front of it. That is why this checks two files. The recording is not
   * decoration underneath the live one — it is what a reader with no
   * JavaScript, an unsupported browser or a chunk that never arrived sees, so
   * a refactor that "simplified" it away would take the fallback with it.
   *
   * The lead's own provenance line went at the same time, and correctly: the
   * sentence above the panel now describes a round trip in the reader's tab,
   * which is not a thing that was captured. The recording's caption states
   * where it came from, one line under the recording, which is the assertion
   * in "does not overstate the one artefact that exists to not be
   * overstated". */
  assert.match(index, /<LiveCarrierPanel \/>/);
  assert.match(live, /<CarrierPanel \/>/);
  assert.match(index, /Not a mock-up/);
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

test('keeps the prompt glyph out of what the reader pastes', async () => {
  const [snippet, css] = await Promise.all([
    flat('../src/components/HeroSnippet.astro'),
    read('../src/styles/global.css'),
  ]);

  /* The `$` earns the terminal its look and carries nothing a reader needs, so
   * the one way it can cost anyone anything is by ending up in a pasted
   * command. The component claims three independent paths to that guarantee
   * and, until this test, proved none of them — each is one attribute away
   * from silently going missing, and the failure is invisible on the page.
   *
   * The button copies `data-copy`. This is the path that matters, because it
   * is the one the affordance exists for: a handler that read the element's
   * text would ship `$ npm install …` to the clipboard, and `npm` would try
   * to install a package called `$`. */
  assert.match(snippet, /data-copy=\{installCommand\}/);
  assert.match(snippet, /const command = button\.dataset\.copy;/);
  assert.doesNotMatch(snippet, /writeText\((?:button|el)?\.?(?:textContent|innerText)/);

  /* A drag-select skips it, which is the path for the reader who never finds
   * the button. Both properties, because Safari still wants the prefix.
   *
   * Anchored to the start of a declaration rather than matched loosely:
   * `user-select` is a substring of `-webkit-user-select`, so the obvious
   * pattern is satisfied by the prefixed line alone and passes happily after
   * the standard property is deleted. Caught by mutating the rule. */
  assert.match(css, /\.terminal-prompt \{[^}]*\n\s+user-select: none;/);
  assert.match(css, /\.terminal-prompt \{[^}]*\n\s+-webkit-user-select: none;/);

  /* And a screen reader never reads it, which is the path for someone who
   * cannot see that it is decoration. */
  assert.match(snippet, /<span class="terminal-prompt" aria-hidden="true">\$<\/span>/);

  /* The command itself is the real string, not a retyped copy of it. */
  assert.match(snippet, /<span class="terminal-command">\{installCommand\}<\/span>/);
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

test('shows the example on a phone rather than offering it', async () => {
  const [snippet, raw] = await Promise.all([
    flat('../src/components/HeroSnippet.astro'),
    read('../src/styles/global.css'),
  ]);
  /* Comments stripped, because the prose below still names the retired element
   * on purpose — a source-side match would otherwise pass on the paragraph
   * saying it is gone. */
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  /* The panel is in the document unconditionally. It was behind a `<details>`
   * that a script closed below 48rem, and the whole of that — the element, the
   * summary, its styling and the media query that hid the control above the
   * breakpoint — is retired. This asserts the retirement rather than the CSS
   * that used to implement it, because the failure this guards is the panel
   * quietly going back behind an affordance. */
  assert.doesNotMatch(snippet, /<details/, 'the example is behind a disclosure again');
  assert.doesNotMatch(snippet, /<summary/, 'the example is behind a disclosure again');
  assert.doesNotMatch(snippet, /demo-disclosure/);
  assert.doesNotMatch(css, /demo-disclosure/);
  assert.match(snippet, /<div class="code-block hero-snippet">/);

  /* Nothing script-driven decides whether the panel shows, so nothing in the
   * component asks the breakpoint. The size rules do, in CSS, where a page
   * whose script never ran gets the same answer. */
  assert.doesNotMatch(snippet, /matchMedia/, 'the panel is script-gated again');

  /* The install command still comes first. That ordering outlived the
   * disclosure and is its own decision: a reader on a phone meets the one line
   * they can act on before the ten they cannot. */
  assert.ok(
    snippet.indexOf('class="terminal"') < snippet.indexOf('class="code-block hero-snippet"'),
    'the install command no longer comes before the example',
  );

  /* One breakpoint, written exactly.
   *
   * `not all and (min-width: 48rem)`, not `max-width: 48rem` and not
   * `max-width: 47.99rem`. The clamp on the panel derives its 13px floor at
   * exactly 48rem, so 48rem has to be a width where the clamp is what runs:
   * `max-width: 48rem` takes it away, and `47.99rem` leaves 0.16px between the
   * two — unreachable at integer widths and perfectly reachable under zoom,
   * which computes fractional viewport widths. */
  assert.match(css, /@media not all and \(min-width: 48rem\) \{\s*\.hero-snippet\.code-block pre \{/);
  assert.doesNotMatch(css, /47\.99rem/);

  /* The adapter selects are operable on a phone too, and that is the second
   * half of the same decision: a panel a reader can see but not drive is the
   * page's central claim shown as a picture. They were `display: none` below
   * this breakpoint for measured reasons — the toolbar is four stacked rows at
   * 320 with them back — and the founder's call is that the demonstration is
   * worth the chrome.
   *
   * `ruleFor` rather than a `doesNotMatch` on the whole file, because the
   * failure to catch is a second rule turning them off again, and this throws
   * on two. Writing it exposed a blind spot in the helper: its regex could not
   * see the first rule inside a media block, so an override written at the top
   * of one counted as zero. `./css-rules.mjs` is a brace walker now, and the
   * mutation that proves this assertion — the rule put back where it was —
   * fails here either way, because the ordering assertion above sees it too. */
  const adapters = ruleFor(css, '.code-adapters');
  assert.doesNotMatch(adapters, /display:\s*none/, 'the adapter selects are hidden on a phone again');
  assert.match(adapters, /display:\s*flex/);

  /* And the copy button takes its position from the select group, as it does
   * at every other width. The `margin-inline-start: auto` that stood in for the
   * group's own auto margin has to go with the rule that made it necessary, or
   * two auto margins compete for the same free space. */
  assert.equal(
    cssRules(css).filter((rule) => rule.selector === '.code-toolbar .code-copy').length,
    0,
    'the copy button is being pushed by a margin the select group already owns',
  );
});

test('centres the hero at the phone’s width as well as the desktop’s', async () => {
  const raw = await read('../src/styles/global.css');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  /* `ruleFor` rather than a match on the file, and it is the whole gate: it
   * throws on two rules with this selector, and re-introducing the breakpoint
   * means a second `.hero-copy` declaring `align-items` inside a query. The
   * mutation that proves it is the rule this round deleted, put back. */
  const copy = ruleFor(css, '.hero-copy');
  assert.match(copy, /text-align:\s*center/, 'the hero copy is left-aligned again');
  assert.match(copy, /align-items:\s*center/);

  /* The children do not inherit `text-align` — `.actions` and `.cta-primary`
   * are flex containers and the strip is a grid sibling — so each is asserted
   * rather than assumed. Centred copy above flush-left buttons is the failure
   * this catches, and it looks like a bug rather than a choice. */
  assert.match(ruleFor(css, '.hero-copy .actions'), /justify-content:\s*center/);
  assert.match(ruleFor(css, '.hero-copy .cta-primary'), /align-items:\s*center/);

  /* Not `ruleFor`: this selector carries two rules on purpose — the margin that
     pulls the strip toward the panel it captions is a separate concern with its
     own gate below. Picked by what it declares, as that gate does. */
  const strip = cssRules(css).filter(
    (rule) => rule.selector === '.hero-grid > .platform-strip' && /align-items:/.test(rule.body),
  );
  assert.equal(strip.length, 1, `${strip.length} rules align the strip; it is decided once`);
  assert.match(strip[0].body, /align-items:\s*center/);

  /* Both levels of the strip's nested list. The inner one is only visible on a
   * phone, where each cluster wraps and the leftover name would otherwise start
   * a flush-left row under a centred one. */
  assert.match(
    ruleFor(css, '.hero-grid .platform-marks, .hero-grid .platform-cluster > ul'),
    /justify-content:\s*center/,
  );

  /* Nothing may turn it off further down. Each of these appears exactly once,
   * so a later override — inside a query or not — fails here. */
  for (const selector of ['.hero-copy', '.hero-copy .actions', '.hero-grid > .platform-strip']) {
    const carrying = cssRules(css).filter(
      (rule) => rule.selector === selector && /align-items:|justify-content:|text-align:/.test(rule.body),
    );
    assert.equal(carrying.length, 1, `${carrying.length} rules align \`${selector}\`; it is decided once`);
  }
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
  /* SECURITY.md in signal-protocol-js commits to an acknowledgment window and
   * an initial assessment within 7 days. A site that promises anything faster
   * is writing a cheque the policy does not cover — which is why the window
   * widened here on 2026-08-09 rather than narrowed. */
  assert.equal(reporting.acknowledgment, '72 hours');
  assert.equal(reporting.assessment, '7 days');
  assert.equal(reporting.address, 'security@open-e2ee.dev');
});

test('dates every assurance figure it publishes', () => {
  assert.match(checks.measuredOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(checks.failed, 0);
  assert.equal(dependencies.direct, dependencies.names.length);
  assert.ok(dependencies.resolved >= dependencies.direct);
  assert.ok(specifications.length > 0);
  for (const spec of specifications) {
    assert.ok(spec.name && spec.revision, `${spec.name} needs a pinned revision`);
  }
});

test('counts the dependency footprint from the installed tree, not from memory', async () => {
  /* Two pages publish this as a proof point, and it is the one assurance
   * figure a reader can check in a second — `npm install` and look. So it is
   * derived here rather than trusted: `names` must be exactly the SDK's
   * declared production dependencies, and `resolved` must be the size of the
   * closure over them.
   *
   * The count moved in alpha.10, when `protobufjs` left the production tree
   * and took `long` with it. Before that the resolved figure was one larger
   * than the direct one, and the assertion guarding it said only "resolved is
   * larger" — which was true of the arithmetic and proved nothing about the
   * package. A figure this cheap to check should not be maintained by hand. */
  const manifestOf = async (name) =>
    JSON.parse(
      await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'),
    );

  const sdk = await manifestOf('@open-e2ee/signal-protocol-sdk');
  const declared = Object.keys(sdk.dependencies ?? {}).sort();
  assert.deepEqual(
    declared,
    [...dependencies.names].sort(),
    'the SDK production dependencies are not the ones the site lists',
  );

  /* Optional and peer dependencies are deliberately out of the closure: an
   * adapter's runtime requirement is installed by the reader who picks that
   * adapter, and counting them would inflate a number whose whole claim is
   * what a bare install pulls in. */
  const closure = new Set();
  const walk = async (name) => {
    if (closure.has(name)) return;
    closure.add(name);
    const manifest = await manifestOf(name);
    for (const child of Object.keys(manifest.dependencies ?? {})) await walk(child);
  };
  for (const name of declared) await walk(name);

  assert.equal(
    closure.size,
    dependencies.resolved,
    `a bare install resolves to ${closure.size} packages, and the site says ${dependencies.resolved}`,
  );
});

test('states the validation and audit position rather than omitting it', async () => {
  const [security, evaluate] = await Promise.all([
    flat('../src/pages/security.astro'),
    flat('../src/pages/evaluate.astro'),
  ]);

  for (const page of [security, evaluate]) {
    assert.match(page, /not FIPS 140-validated/);
  }

  /* docs/messaging.md §7 fixes one sentence for audit status and binds its two
   * halves together: the AI review, and the absence of a firm audit. Either
   * half alone is a defect — the first overclaims, the second understates what
   * actually runs — so both are asserted, on every page that raises the
   * question at all.
   *
   * scripts/audit-build.mjs enforces the same pairing over rendered output and
   * does not subsume this: it can only require the limit once some trigger
   * word appears, so a page that drops the subject entirely satisfies it and
   * says nothing. These pages are the ones that must not go quiet. */
  for (const page of [security, evaluate]) {
    assert.match(page, /Reviewed continuously by adversarial AI agents/);
    assert.match(page, /not audited by any independent firm/);
    assert.match(page, /No independent firm has audited the SDK, and none is engaged/);
  }

});

test('does not revive the retired promise of an independent review, anywhere', async () => {
  /* The promise was retired on 2026-08-09 (docs/messaging.md §2, §7) and it
   * had shipped in five places by then: the landing page, /security,
   * /evaluate, a blog post, and the comparison data. A guard on the two trust
   * pages would have caught three of them.
   *
   * So this walks the tree the same way the relay-formula guard above does,
   * and for the same reason: a list written by hand stops covering the page
   * added after it. Comments come out first — the landing page explains what
   * was retired, and explaining it means naming it. */
  const sources = [];
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(`${dir}${entry.name}/`);
      else if (/\.(astro|mdx|mjs|ts)$/.test(entry.name)) sources.push(`${dir}${entry.name}`);
    }
  };
  await walk('../src/');
  assert.ok(sources.length > 30, `expected to walk the whole tree, found ${sources.length} files`);

  const prose = (text) =>
    text
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ');

  /* "Planned" is the word that shipped. The rest are the near misses a later
   * edit reaches for, and "not yet audited" is the retired promise compressed
   * into one adverb — it dates the absence of an audit against a future that
   * was never committed to. */
  const retired = [
    /independent (?:security )?review is planned/i,
    /plans? an independent (?:security )?review/i,
    /\bnot yet audited\b/i,
    /\bindependently audited\b/i,
    /\bthird[- ]party audited\b/i,
  ];

  for (const source of sources) {
    const text = prose(await read(source));
    for (const promise of retired) {
      assert.doesNotMatch(text, promise, `${source} revives a promise retired on 2026-08-09`);
    }
  }
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
  /* The plate reaches this page through `LiveCarrierPanel`, which renders it
   * as the live demo's fallback. Both spellings are checked on the other two
   * pages: either one of them puts a plate on a screen that already has a
   * signature device. */
  assert.match(index, /<LiveCarrierPanel \/>/);
  assert.doesNotMatch(index, /<SignatureDiagram \/>/);
  assert.doesNotMatch(index, /import SignatureDiagram/);

  for (const [name, page] of [
    ['security', security],
    ['product', product],
  ]) {
    assert.match(page, /<SignatureDiagram \/>/, `${name} lost the diagram`);
    assert.doesNotMatch(
      page,
      /<(Live)?CarrierPanel \/>/,
      `${name} now shares a screen with the plate`,
    );
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

test('steps the headings down under a headline that cannot climb', async () => {
  const css = (await read('../src/styles/global.css')).replace(/\/\*[\s\S]*?\*\//g, '');

  /* Two declarations that are only correct together. The hero headline stops at
   * 2.625rem — it has to, or a 57-character sentence sets three lines — while
   * the global h2 clamp keeps climbing to 2.25rem, so above 74rem, where both
   * are pinned, the display headline and every section heading under it arrive
   * 42px against 36px. That is a ratio of 1.17: one voice, at two sizes nobody
   * can tell apart. The same pair is 1.30 apart at 390px, so it is a defect of
   * width.
   *
   * They therefore have to move together: raise the hero's h1 ceiling and this
   * step-down is over-correction, drop the ceiling further and it is not enough.
   *
   * This used to also pin `.hero h1` to 2.375rem inside the same block, because
   * the headline shared a row with the demo and 42px set four lines in the
   * 470px column it had. The hero is one centred column now and the cap is
   * gone; the compensation is not, because 42-against-36 was the smaller half
   * of the problem and it survived the cap's removal. */
  assert.match(css, /\n\.hero h1 \{\s*font-size: clamp\(2\.0625rem, 1\.15rem \+ 3\.1vw, 2\.625rem\);/);
  const blocks = [...css.matchAll(/@media \(min-width: 74rem\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
  const block = blocks.find((body) => /\.hero ~ \.band h2\s*\{/.test(body));
  assert.ok(block, 'no 74rem block steps the section headings down any more');
  assert.match(block, /\.hero ~ \.band h2 \{\s*font-size: 1\.75rem;/);

  /* And that nothing re-caps the headline somewhere else at the same width.
   * The assertion above would still pass with a second rule overriding it. */
  assert.doesNotMatch(css, /\.hero h1 \{\s*font-size: 2\./);

  /* Scoped, and it stays scoped. Measured at 1440px every other page runs its
   * 60px h1 against the same 36px h2 for a ratio of 1.67, which is right;
   * re-capping the global clamp would flatten six healthy pages to correct one.
   * The bare `h2` rule keeps its ceiling. */
  assert.match(css, /\nh2 \{\s*font-size: clamp\(1\.625rem, 1\.25rem \+ 1\.6vw, 2\.25rem\);/);
});

test('enlarges the hero code without enlarging code that has no room', async () => {
  const css = (await read('../src/styles/global.css')).replace(/\/\*[\s\S]*?\*\//g, '');

  /* The hero panel is the page's primary evidence and is read rather than
   * skimmed, so it sets its own size. Every other panel keeps the token.
   *
   * The scoping is not a preference. /product's recorded file was measured at
   * 13.50px maximum for the column it sits in — its 83-character longest line
   * against a 671px client — so raising `--oe-code-size` itself trades one
   * legible panel for a scrollbar in another. The failure would be invisible
   * from the homepage, which is where anyone changing this is looking. */
  assert.match(
    css,
    /\.hero-snippet\.code-block pre \{\s*font-size: clamp\(0\.8125rem, 1\.8cqi, 1\.125rem\);\s*\}/,
  );
  assert.doesNotMatch(css, /--oe-code-size:/);

  const tokenCss = await read('../node_modules/@open-e2ee/design/packages/design/dist/css/tokens.css');
  assert.match(tokenCss, /--oe-code-size: 0\.84375rem;/);

  /* The container the middle term resolves against, which is the part of this
   * that fails silently. `cqi` with no query container above it does not throw
   * and does not fall back to the clamp floor — it resolves against the small
   * viewport, so 1.8cqi would become 1.8vw and the panel would be sized by the
   * window rather than by itself. At 1440 that is 25.9px against a 1132px panel:
   * every line overruns, at every width, and the declaration above still reads
   * exactly as it does now. So the container is asserted next to the unit that
   * needs it. */
  assert.match(css, /\.hero-demo \{[^}]*container-type: inline-size;/);

  /* 1.8 is a fit constraint rather than a taste, and the margin in it is thin
   * enough to be worth writing down. The longest of the ten variants is 91
   * characters, the painted advance of this face is 0.552px per px of size, the
   * gutter is 4.75ch at 0.5576px per px, and the panel spends 30px on padding
   * and borders — so the code fits while size <= (panel - 30) / 52.876, which is
   * 1.89cqi less about half a pixel. 1.8 clears that at every width; 1.9 does
   * not. Measured at 1440/1180/1024/900/800/768 with no overrun on any variant.
   *
   * The floor and ceiling are the ends of that line rather than independent
   * choices: 18px is where the ceiling stops the code outgrowing the 20px lead
   * beside it, and 13px is where 1.8cqi lands on the narrowest viewport that
   * still shows the panel at all. Below 48rem the disclosure closes it.
   *
   * Every `cqi` in the file rather than this one, because a container-relative
   * size that appears without being argued for is the way this arithmetic goes
   * wrong: the ceiling above is thin, and a second length competing for the
   * same width would eat the margin silently.
   *
   * There are two now. The 2 is the terminal row above this panel, and it is
   * admitted here rather than the list being widened to fit it, because the
   * question this assertion asks — does the new length compete with the code's
   * fit? — has an answer and it is no. They are separate stacked panels, not
   * two claims on one line box, and the terminal row's own fit ceiling is about
   * 25px at 48rem against a 19px cap. What the shared unit buys is the
   * relationship: 2/1.8 is a constant 1.111x at every width, so the command
   * stays a step above the code instead of the gap between them opening and
   * closing across the range. A flat size on either side is what this list is
   * really guarding against. */
  assert.deepEqual(
    [...css.matchAll(/([\d.]+)cqi/g)].map((m) => Number(m[1])),
    [1.8, 2],
    'a cqi length moved or a third appeared; re-derive against the 1.89 ceiling before changing this',
  );

  /* The gutter term of that constraint, pinned here so the two cannot drift.
   * Widening it lowers the ceiling, and the ceiling is what the 1.8 above is
   * held back from — so a gutter change with no matching re-derivation is the
   * way this arithmetic goes quietly stale. */
  assert.match(css, /\.code-block \.astro-code \.line \{[^}]*padding-left: 4\.75ch;/);

  /* And no width band left behind. Both hero wrap queries existed because a
   * fixed size met a variable panel and lost through a range of viewports — one
   * of them painted nothing for two builds through a specificity tie while
   * reading correctly. A size solved against the panel's own width has no band,
   * so the queries are gone; this is what stops one coming back instead of the
   * next size being solved. */
  assert.doesNotMatch(css, /@media \(max-width: 5[26]rem\)/);
});

test('spends only spacing steps the scale actually has', async () => {
  /* The spacing scale is 1, 2, 3, 4, 6, 8, 12, 16, 24 — it skips 5, and asking
   * for the step that is not there fails in the quietest way CSS has.
   * `var(--oe-space-5)` resolves to nothing, `gap: ` with nothing after it is
   * an invalid declaration, and the property keeps its initial value: for a
   * grid, `normal`, which is zero. No warning, no fallback, no visual clue
   * except a gap that is missing — and if the element it governs is below the
   * fold, as `.hero-objections` is, the missing gap is not visible from any
   * screenshot the loop takes by default. It shipped for exactly one build and
   * ran the hero's two citation rules end to end on a phone.
   *
   * Checked against the package rather than a list written here, so a scale
   * that gains or loses a step arrives as a failure instead of as a stale
   * duplicate of itself. */
  /* Comments stripped first, or this fails on the comment above the fix that
   * quotes the broken declaration. A token named in prose paints nothing. */
  const css = (await read('../src/styles/global.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const declared = new Set(
    [...(await read('../node_modules/@open-e2ee/design/packages/design/dist/css/tokens.css'))
      .matchAll(/(--oe-space-\d+):/g)].map((m) => m[1]),
  );
  assert.ok(declared.size >= 8, 'found almost no spacing tokens — the token file has moved');

  const used = new Set([...css.matchAll(/var\((--oe-space-\d+)\)/g)].map((m) => m[1]));
  assert.ok(used.size > 0, 'the stylesheet names no spacing token — this test is measuring nothing');
  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, [], `spacing steps that do not exist: ${missing.join(', ')}`);
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

/*
 * Every colour the two shipped snippets actually emit, per theme.
 *
 * The old version of this measured the theme's declared roles, which was the
 * right shape for a theme we wrote: it had five, we chose all five, and
 * checking them checked the page. It is the wrong shape for a stock theme.
 * Dark+ declares hundreds of rules for languages this site never prints, and
 * no stock theme clears AA across all of them on any background — a whole-
 * theme sweep bottoms out around 1.04 and would fail every candidate,
 * including the one VS Code ships. What the page owes AA on is the tokens it
 * puts in front of a reader, so this asks the highlighter what those are
 * rather than asking the theme what it could produce.
 *
 * It runs the real highlighter over the real snippets, which is also what
 * makes it catch a theme swap, a shiki upgrade that restyles a scope, and a
 * change to the recorded capture that introduces a token type the page has
 * not shown before.
 */
const emittedColours = async (code, themeId) => {
  const { createHighlighter } = await import('shiki');
  const highlighter = await createHighlighter({ themes: [themeId], langs: ['ts'] });
  const { tokens: lines } = highlighter.codeToTokens(code, { lang: 'ts', theme: themeId });
  const seen = new Map();
  for (const line of lines) {
    for (const token of line) {
      if (token.color) seen.set(token.color.toLowerCase(), token.content.trim().slice(0, 24));
    }
  }
  return seen;
};

/* The two blocks of TypeScript the site renders through `<Code>`. Blog posts
   go through the same themes by way of `astro.config.mjs`, and are covered by
   the config check below rather than here: their content is prose files that
   change, so pinning their tokens would be pinning the wrong thing. */
const shippedSnippets = [
  ['hero', heroCode],
  ['product', capture.quickstartCode],
];

test('uses the editor themes the reader already has, at their own values', async () => {
  /* Named rather than inlined, so shiki owns the colours and an upgrade
   * carries VS Code's own corrections in. `light-plus` and `dark-plus` are
   * the originals — the thing a decade of screenshots and tutorials has meant
   * by "the default". */
  assert.deepEqual(codeThemes, { light: 'light-plus', dark: 'dark-plus' });

  /* `codeSurfaces` is the one place this repository restates a value the
   * theme owns, because CSS cannot import it. Re-derived here so a shiki
   * upgrade that repaints the editor fails the suite instead of leaving the
   * panel a shade off the code inside it. */
  const { bundledThemes } = await import('shiki');
  for (const [mode, id] of Object.entries(codeThemes)) {
    const theme = (await bundledThemes[id]()).default;
    assert.equal(codeSurfaces[mode].background, theme.colors['editor.background'].toLowerCase());
    assert.equal(codeSurfaces[mode].foreground, theme.colors['editor.foreground'].toLowerCase());
  }

  /* And the stylesheet carries the same two pairs. Four literals now rather
   * than two-plus-two: the dark pair is named `--oe-editor-dark` on its own
   * because two rules want it — `:root.dark`, where a snippet inside an article
   * follows the page, and `.code-block`, where the quoted panel keeps one
   * appearance in both modes. `:root.dark` and `.code-block` both point at the
   * names, so the hexes appear exactly once each and in this order. */
  const css = await read('../src/styles/global.css');
  const declared = [...css.matchAll(/--oe-editor(?:-dark)?(?:-foreground)?:\s*(#[0-9a-f]{6});/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(declared, [
    codeSurfaces.light.background,
    codeSurfaces.light.foreground,
    codeSurfaces.dark.background,
    codeSurfaces.dark.foreground,
  ]);
});

test('pins the quoted panel to one appearance, palette included', async () => {
  const css = await read('../src/styles/global.css');
  const block = css.slice(css.indexOf('.code-block {'), css.indexOf('\n}', css.indexOf('.code-block {')));
  assert.ok(block.startsWith('.code-block {'), '.code-block rule not found — the anchor has drifted');

  /* The panel wears Dark+ in both page modes, so it is not enough to pin the
   * paper: every site-owned colour printed on it has to stop tracking the page
   * or go unreadable — light `--oe-muted` is #615d57 and measures 1.6 here.
   * `tests/contrast.test.mjs` measures those pairs against the dark palette;
   * this is the half that proves the stylesheet actually uses the dark palette,
   * because that file reads tokens and this one reads CSS and neither alone
   * connects the two.
   *
   * Written as literals in the stylesheet because the design package exposes no
   * mode-independent alias to point at, and re-derived from `tokens.semantic.dark`
   * here so a palette move upstream fails the suite rather than dimming a
   * control on the page. `focus` is in the list and it is the one that would
   * have been missed: the ring is drawn with an offset, so it lands on the
   * panel, and light `--oe-focus` is #4454cc at 2.69 against this paper. */
  for (const name of ['muted', 'foreground', 'border', 'focus']) {
    assert.match(
      block,
      new RegExp(`--oe-${name}: ${tokens.semantic.dark[name]};`),
      `.code-block does not pin --oe-${name} to the dark palette's ${tokens.semantic.dark[name]}`,
    );
  }

  /* And the paper. Only the paper — the syntax colours are pinned by a selector
   * further down, and the version of this assertion that expected to find them
   * here is what shipped a hero panel with no highlighting in it at all. Shiki
   * writes its palette onto the spans, so `--oe-shiki: var(--shiki-dark)` on
   * this element was reading a property that does not exist at this element,
   * and resolved to the guaranteed-invalid value. Asserting their absence is
   * the point: this is where the mistake looks natural. */
  assert.match(block, /--oe-editor: var\(--oe-editor-dark\);/);
  assert.match(block, /--oe-editor-foreground: var\(--oe-editor-dark-foreground\);/);
  assert.doesNotMatch(
    block,
    /--shiki-/,
    '.code-block reads a shiki property, which is only defined on the spans below it',
  );

  /* The switch itself: three rules of strictly increasing weight, site-wide
   * default, then the dark page, then the pin. The `:root` on the last one
   * selects nothing extra and is load-bearing anyway — it takes the pin to
   * (0,3,2) against the dark rule's (0,3,1), so it wins by weight rather than
   * by the two rules happening to name the same colour today. */
  assert.match(css, /\n\.astro-code,\n\.astro-code span \{\n  color: var\(--shiki-light\);\n\}/);
  assert.match(
    css,
    /\n:root\.dark \.astro-code,\n:root\.dark \.astro-code span \{\n  color: var\(--shiki-dark\);\n\}/,
  );
  assert.match(
    css,
    /\n:root \.code-block pre\.astro-code,\n:root \.code-block pre\.astro-code span \{\n  color: var\(--shiki-dark\);\n\}/,
  );

  /* The split this is scoped against. A snippet in a blog post is evidence
   * inside body text, read at the page's own brightness, not a quoted editor
   * window — so `.prose pre` still follows the theme, and the pin must not have
   * been written somewhere that catches it. */
  assert.doesNotMatch(css, /\.prose pre \{[^}]*--oe-editor:/);
});

test('never reads a shiki colour anywhere but the element shiki wrote it on', async () => {
  /*
   * The general form of the defect above, guarded once for the whole file.
   *
   * Every other custom property here can be indirected freely — `.code-block`
   * sets `--oe-editor: var(--oe-editor-dark)` and that resolves, because
   * `--oe-editor-dark` is declared on `:root`, an ancestor. Shiki's are the
   * exception in the one direction that matters: they are inline on the `<pre>`
   * and on each `<span>`, which is *below* every rule that wants to choose
   * between them. A `var()` inside a custom property is substituted at
   * computed-value time on the element that declares it, so any `--x:
   * var(--shiki-*)` written on an ancestor resolves against an element where
   * the property is not defined and computes to the guaranteed-invalid value.
   * That value inherits and it is silent — the stylesheet parses, the rule
   * matches, `astro check` is clean, the build audit passes, and the page
   * paints one flat foreground where the syntax colours should be.
   *
   * It cost a full round to find, and nothing in the 119 tests around this one
   * could see it: the theme test checks `@shikijs/themes`, the contrast test
   * checks the token maths, and both were measuring values that were correct
   * and never reached a pixel. So the assertion is on the shape rather than on
   * any particular rule — put a shiki colour in a custom property again, in any
   * selector, and this fails.
   */
  const css = (await read('../src/styles/global.css')).replace(/\/\*[\s\S]*?\*\//g, '');

  const offenders = [...css.matchAll(/([\w-]+)\s*:\s*([^;{}]*var\(\s*--shiki-[^;{}]*)/g)]
    .filter((m) => m[1].startsWith('--'))
    .map((m) => `${m[1]}: ${m[2].trim()}`);

  assert.deepEqual(
    offenders,
    [],
    'a shiki colour is being read into a custom property, which resolves where it is declared, ' +
      'not where it is used — it will compute to the invalid value and paint nothing',
  );

  /* And the positive half, because "no custom property reads them" is also
   * satisfied by a stylesheet that stopped reading them at all — which is
   * exactly what the broken version degraded to on the page. */
  const direct = [...css.matchAll(/\bcolor:\s*var\(--shiki-(light|dark)\)/g)].map((m) => m[1]);
  assert.deepEqual(
    direct,
    ['light', 'dark', 'dark'],
    'the three color declarations that carry the syntax palette have changed shape',
  );
});

test('keeps every syntax colour readable on the surface it is printed on', async () => {
  /* Code is body text at 13.5px and below, so every token owes 4.5:1,
   * comments included: the one comment in the hero snippet is the page's
   * central claim.
   *
   * This is a floor, not the argument for the theme. Measured on their own
   * backgrounds the alternatives clear it too, so this would have passed
   * `github-light-default` as happily; `src/lib/code-theme.mjs` says why the
   * choice went the way it did. What the floor is actually holding is the
   * pairing — Light+ bottoms at 4.08 on the warm surface this panel used to
   * wear and 4.60 on the one it wears now, so a later edit that puts the
   * theme back on `--oe-code` to tidy the palette fails here. */
  for (const [label, code] of shippedSnippets) {
    for (const [mode, id] of Object.entries(codeThemes)) {
      const background = codeSurfaces[mode].background;
      const colours = await emittedColours(code, id);

      /* A snippet that stopped being highlighted would emit nothing and pass
       * an empty loop silently. Six is the count both snippets clear today. */
      assert.ok(colours.size >= 6, `${label}/${mode}: only ${colours.size} colours emitted`);

      for (const [colour, sample] of colours) {
        const measured = ratio(colour, background);
        assert.ok(
          measured >= 4.5,
          `${label}/${mode}: ${colour} (${sample}) measures ${measured.toFixed(2)}:1 on ${background}`,
        );
      }
    }
  }
});

test('does not colour code with the action colour', async () => {
  /* DESIGN.md reserves `ultra` for links, focus, and the accent, one per view,
   * and the hero already spends it on the primary button. Link-coloured text
   * inside a panel where nothing is clickable competes with the one control
   * the fold exists for.
   *
   * Both themes do print a saturated blue on keywords — `#0000ff` in Light+,
   * `#569cd6` in Dark+ — and that is the acknowledged cost of looking like
   * the reader's editor. Neither is a step on the ramp, so the palette's
   * actual rule holds: no code token is ever the same colour as a link. */
  const ultra = Object.values(tokens.primitives.color.ultra).map((v) => v.toLowerCase());
  for (const [label, code] of shippedSnippets) {
    for (const [mode, id] of Object.entries(codeThemes)) {
      for (const colour of (await emittedColours(code, id)).keys()) {
        assert.ok(!ultra.includes(colour), `${label}/${mode}: ${colour} is an ultra step`);
      }
    }
  }
});

test('dresses the install command as a terminal, in both modes', async () => {
  const css = await read('../src/styles/global.css');

  /* Ghostty's defaults, from `src/config/Config.zig`. The point of the panel
   * is that a reader recognises the application, so a value invented here
   * would defeat it. `prompt` and `control` are ours and documented as ours in
   * `src/lib/code-theme.mjs`; they are checked for the same reason, which is
   * that the comments quoting their contrast ratios have to stay true. */
  for (const [role, value] of Object.entries(shellSurface)) {
    const property = role === 'background' ? '--oe-shell' : `--oe-shell-${role}`;
    assert.match(css, new RegExp(`${property}:\\s*${value};`), `${property} is not ${value}`);
  }

  /* One declaration each, in `:root`, and none of them repeated under
   * `:root.dark`. Ghostty ships `theme: ?Theme = null` and has no light
   * variant, so a shell that changed with the page would be a shell nobody
   * runs — and the light-mode reader is exactly who needs the surface change
   * to tell the terminal from the editor. */
  const darkBlocks = [...css.matchAll(/:root\.dark\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(darkBlocks.length > 0, 'expected a :root.dark block to search');
  for (const block of darkBlocks) assert.doesNotMatch(block, /--oe-shell/);

  /* A titlebar strip and a block cursor were both drawn here for one round and
   * both removed. Ghostty draws neither, so their absence is the more faithful
   * quotation and not a regression — what carries the panel is the fill, the
   * prompt and the mono face, all of which are asserted above and below. */

  /* DESIGN.md holds default controls to 44px and this one is drawn at 24, so
   * the hit area is expanded to 44 with an overlay rather than the ring being
   * grown to a size no terminal has. -10px on each side of 24 is 44. */
  assert.match(css, /\.copy-button::after \{[^}]*inset: -10px;/);
});

/*
 * The command outranks the code under it, and it has to do so at every width.
 *
 * This is a hierarchy bug that shipped for several rounds while a comment said
 * it had been fixed. The install line was moved out of the metadata style and
 * onto the shell surface, the note in `HeroSnippet.astro` recorded it as "the
 * same size as code", and the sizes were never equal: a flat 13.5px command
 * against a panel that solves for its own width and renders at 17.2px. The
 * page's one takeaway was a third smaller than its supporting evidence.
 *
 * A single measured pair would not hold that. The code's size is a function of
 * the panel's width, so any fixed number for the command is correct at one
 * viewport and wrong at the rest — which is the same failure the code panel's
 * own comment describes and solved for itself. So what is asserted is the
 * relationship: both sizes written in the same container unit, the command's
 * coefficient above the code's, and its ends no lower than the code's ends.
 * That survives either side being re-derived and fails the moment one of them
 * goes flat.
 */
test('sets the install command a step above the code it sits over', async () => {
  const css = (await read('../src/styles/global.css')).replace(/\/\*[\s\S]*?\*\//g, '');

  const sizeOf = (selector) => {
    const body = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
    const clamp = body?.match(/font-size:\s*clamp\(([\d.]+)rem,\s*([\d.]+)cqi,\s*([\d.]+)rem\)/);
    return clamp && { floor: +clamp[1] * 16, rate: +clamp[2], ceiling: +clamp[3] * 16 };
  };

  const code = sizeOf('\\.hero-snippet\\.code-block pre');
  const command = sizeOf('\\.terminal-line');
  assert.ok(code, 'the hero code no longer solves for its panel width');
  assert.ok(
    command,
    'the install command is not solved in the same unit as the code — a flat size ' +
      'is only ever right at one viewport, which is how it was a third too small before',
  );

  /* Swept rather than compared term by term, because the two clamps have
   * different corners and a term-by-term check misses what that does. The
   * command reaches its ceiling at a 950px container and the code reaches its
   * at 1000px, so through that band one is capped while the other is still
   * growing and the ratio is not what either declaration looks like it says. My
   * first note here claimed a constant 1.111x on exactly that reasoning and the
   * real range is 1.056 to 1.111.
   *
   * So the property asserted is the one that actually matters and is true: at
   * every width the panel can be, the command is larger. Evaluating both clamps
   * across the range costs nothing and cannot be fooled by a plausible-looking
   * pair of declarations. */
  const evaluate = ({ floor, rate, ceiling }, width) =>
    Math.min(ceiling, Math.max(floor, (rate * width) / 100));

  const ratios = [];
  for (let width = 320; width <= 1600; width += 1) {
    const codePx = evaluate(code, width);
    const commandPx = evaluate(command, width);
    assert.ok(
      commandPx > codePx,
      `at a ${width}px panel the command is ${commandPx.toFixed(2)}px and the code is ` +
        `${codePx.toFixed(2)}px — the command stops outranking the code somewhere in the range`,
    );
    ratios.push(commandPx / codePx);
  }

  /* And the step stays a step. A pair that satisfied the sweep by a hundredth
   * of a pixel would pass the assertion above and read as identical type. */
  assert.ok(
    Math.min(...ratios) >= 1.05,
    `the smallest step across the range is ${Math.min(...ratios).toFixed(4)}x — too close to read as deliberate`,
  );

  /* And it stays under the lead, which is the sentence that frames the whole
   * offer. The code's ceiling was set at 18px for this reason and the command's
   * 19px inherits it: a command larger than the line explaining what to install
   * is the same inversion this test exists for, pointed the other way. */
  assert.ok(
    command.ceiling < 20,
    `the command reaches ${command.ceiling}px and the lead is 20px — it now outweighs its own explanation`,
  );

  /* Then everywhere the cascade overrides either side, which the sweep above
   * cannot see and which is where this shipped broken.
   *
   * The sweep evaluates two clamp declarations. It is a model of two rules, not
   * of the stylesheet, and below 48rem the stylesheet stops running those
   * rules: the code panel takes a chosen 15px there, because at that width
   * nothing fits and a fit-derived size has nothing left to solve. The command
   * kept clamping, hit its 14px floor, and rendered *smaller* than the code at
   * 360 and 390 — found by measuring the page, while every assertion above this
   * one passed.
   *
   * So the pairing is checked directly rather than by teaching the model to
   * evaluate media conditions, which would only be a larger model with the same
   * failure mode. The rule is short and total: any query that sets a size on one
   * of these two must set one on the other, and the command must be larger there
   * as well. Both values are flat inside these blocks, so the comparison needs
   * no arithmetic and takes nothing on trust. */
  const source = await read('../src/styles/global.css');
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [...stripped.matchAll(/@media([^{]+)\{/g)].map((match) => {
    /* Brace-counted rather than `[^}]*`, because these blocks contain rules and
     * a non-greedy body match would stop at the first nested `}`. */
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    while (index < stripped.length && depth > 0) {
      if (stripped[index] === '{') depth += 1;
      if (stripped[index] === '}') depth -= 1;
      index += 1;
    }
    return { condition: match[1].trim(), body: stripped.slice(start, index - 1) };
  });

  const sizeIn = (body, selector) => {
    const rule = body.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
    const rem = rule?.match(/font-size:\s*([\d.]+)rem\s*;/);
    return rem ? +rem[1] * 16 : null;
  };

  let paired = 0;
  for (const { condition, body } of blocks) {
    const codeHere = sizeIn(body, '\\.hero-snippet\\.code-block pre');
    const commandHere = sizeIn(body, '\\.terminal-line');
    if (codeHere === null && commandHere === null) continue;
    assert.ok(
      codeHere !== null && commandHere !== null,
      `@media ${condition} resizes only one of the pair — code ${codeHere ?? 'unset'}px, ` +
        `command ${commandHere ?? 'unset'}px — so the step there is whatever the other side ` +
        'happens to be left at. That is the exact shape of the bug that shipped at 360 and 390.',
    );
    assert.ok(
      commandHere > codeHere,
      `@media ${condition} puts the command at ${commandHere}px under ${codeHere}px of code`,
    );
    paired += 1;
  }

  /* And a count, because "no block resized either" and "every block agreed" are
   * otherwise the same passing run, and the first of those means this loop has
   * stopped looking at the thing it is named for. */
  assert.equal(
    paired,
    1,
    'the narrow-viewport override of this pair is gone, or a second one appeared unreviewed',
  );

  /* The second signal, and the one with no layout cost. Colour had nowhere left
   * to go — the command is already #ffffff on Ghostty's #282c34 — so emphasis
   * is size plus weight. The face is monospace, so 500 measured 453.59px
   * against 400's 453.61px on the same string: no width, wrap point or fit
   * calculation on this row moves. */
  const command_rule = css.match(/\.terminal-command \{([^}]*)\}/)?.[1];
  const weight = Number(command_rule?.match(/font-weight:\s*(\d+)/)?.[1]);
  assert.ok(
    weight > 400 && weight < 600,
    `the install command is weight ${weight || 'unset'}; 500 is the step that reads as typed ` +
      'rather than as a heading, and 400 is what made it recede in the first place',
  );
});

test('shows the receive side in the hero, not only the send', () => {
  /* `onMessageDecrypted` is the half a reader cannot infer from `send` — a
   * hook rather than a return value, because the message arrives when the
   * relay delivers it — and the recorded comment beside it is the page's
   * central claim in code that ran rather than in a sentence about code.
   * Trimming the snippet back to the send call gives both of those up. */
  assert.match(heroCode, /signal\.registerHook\("onMessageDecrypted"/);
  assert.match(heroCode, /plaintext, only on this device/);

  /* Registering a hook after `create()` means the subscription has to be
   * started by hand — `client.d.ts` starts it automatically only when a hook
   * was already configured. A snippet that registers and never subscribes
   * shows a receive path that never fires. */
  assert.match(heroCode, /signal\.startRelaySubscription\(\);/);
});

test('declares what the example uses, and discloses what it still leaves out', async () => {
  const index = await flat('../src/pages/index.astro');

  /* Four fresh readers sized up the shorter excerpt and every one of them
   * found an identifier it used without declaring. `relay` was the expensive
   * one: a bare shorthand property in `adapters`, which each of them correctly
   * decoded as a server they would have to run — the largest line item in the
   * estimate, left to inference. The capture already contained the answer, so
   * the snippet now carries lines 1-5 verbatim and the specifiers disclose
   * themselves: `/local/store/memory` and `/remote/relay/memory`. */
  assert.match(
    heroCode,
    /import \{ inMemoryStore \} from "@open-e2ee\/signal-protocol-sdk\/local\/store\/memory";/,
  );
  assert.match(
    heroCode,
    /import \{ inMemoryRelay \} from "@open-e2ee\/signal-protocol-sdk\/remote\/relay\/memory";/,
  );
  assert.match(heroCode, /const relay = inMemoryRelay\(\);/);

  /* No elision mark anywhere. This used to guard only the opening, because
   * the snippet was an excerpt and `…` was legitimate further down. Now the
   * panel has a copy button and the marks are gone from all ten variants, so
   * the guard covers the whole program: a reader who pastes this gets
   * something that runs, or the omission is disclosed in prose below rather
   * than punched out of the code. */
  assert.doesNotMatch(heroCode, /…|\.\.\./);

  /* The caption used to admit two of the four gaps and stay silent about the
   * two that cost real money. Partial candour about a sample reads worse than
   * none, because the reader who finds the omission stops trusting the
   * admission. */
  assert.match(index, /Not in this example, and yours to supply/);
  assert.match(index, /a real store in place of <code>inMemoryStore\(\)<\/code>/);
  assert.match(index, /the relay <code>inMemoryRelay\(\)<\/code> stands in for/);
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
   * against the in-memory relay". A fresh reader put the two together and was
   * right: the cryptography is real, the infrastructure is simulated, and only
   * the first of those is what "a real round trip" claims. The panel's whole
   * function is that this page does not inflate its evidence, so an inflated
   * adjective costs more here than anywhere else on the site.
   *
   * The disclosure names the adapter rather than calling it a mock, which is
   * the alpha.10 vocabulary and is also the more precise of the two: nothing
   * in that relay is a test double, and a reader who discounts the exhibit as
   * mocked has discounted real ciphertext. What it simulates is the
   * infrastructure, and that is the part the sentence has to keep admitting. */
  assert.match(panel, /recorded by running the quickstart/);
  assert.match(index, /against the in-memory relay/);
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

  /* And it stays short enough to be read standing up. The lead used to open by
   * listing four runtimes and close by naming who owns the store and the
   * relay; both are still on the page, in the runtime links and the drops
   * list, where a reader who wants them is already looking for them. In the
   * lead they cost the two clauses that do the positioning work — the
   * alternative the reader would otherwise take, and the boundary — a screen
   * before either was earned. The cap is a guard against the paragraph growing
   * back, not a style rule, so it is set a little above whatever the lead
   * currently is rather than at it: 292 characters, then 175 under a cap of
   * 220, now 144 under this one. Tightening it with each cut is what stops the
   * guard from becoming decorative.
   *
   * The count is taken on the text and not on the source, which is a change
   * from the numbers above: they were markup, and so was the cap. That worked
   * only while the markup was three `<span>` wrappers, and it has failed twice
   * for the same reason. Written `&rsquo;` an apostrophe is six characters of
   * source and one character of reading, which checked a 175-character lead as
   * 181 and left the number in this comment disagreeing with the number the
   * assertion used. Then an inline SVG arrived — the OSI keyhole is one path of
   * about 1.5kB — and the source length went to 1605 for a paragraph that takes
   * under four seconds to read. A guard that fires on a glyph is not measuring
   * the thing this comment says it measures.
   *
   * So markup comes out first, the same way `scripts/audit-build.mjs` does it
   * for the banned-phrase scan, and the cap is re-set in the new unit: 55
   * characters of reading under a cap of 90. The old figures are not comparable
   * and are left above as history rather than as a series.
   *
   * The paragraph now carries three inline SVGs and 2895 characters of source
   * for those 55 of reading, which is the case for the unit change stated as a
   * ratio: any wrapper this paragraph is given counts against a source-length
   * cap and none of it counts against a reader. It was 2414 two rounds ago and
   * 2857 one round ago; the 443 came from a logo being drawn correctly and the
   * 38 from a battery growing a charge bolt. Both are visible at 19px and
   * neither is a word.
   *
   * The entity check stays on the decoded text for the reason it was added,
   * and the runtime-name check moves to the source instead: a runtime named in
   * an `alt` or an `aria-label` is still the lead naming a runtime, and
   * stripping tags is exactly what would hide it. */
  const leadSource = (await readFile(new URL('../dist/index.html', import.meta.url), 'utf8')
    .catch(() => null))
    ?.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1];
  const lead = leadSource
    ?.replace(/<[^>]+>/g, '')
    .replace(/&rsquo;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
  if (lead) {
    assert.doesNotMatch(lead, /&[a-z]+;/, 'an entity the length check would count as its source');
    assert.ok(lead.length <= 90, `the lead is ${lead.length} characters:\n${lead}`);
    assert.doesNotMatch(leadSource, /Expo|React Native|browsers|Node/);

    /* A word with no space between it and the glyph after it is what a dropped
     * newline looks like on the page. Astro collapses whitespace between two
     * text runs and deletes it between a text run and an inline element, so
     * wrapping this paragraph at a tag boundary silently joins a sentence to
     * the mark that follows. It rendered "Pure TypeScript.🔋" once.
     *
     * There is no emoji left in the lead — all three marks are drawings now —
     * so this one guards the next emoji rather than anything currently here.
     * The check below is the one that covers the marks that are. */
    assert.doesNotMatch(
      lead,
      /[.\w][\p{Extended_Pictographic}]/u,
      'a mark is jammed against the word before it — an explicit {\' \'} is missing',
    );

    /* The same bug where the check above cannot see it, and where the check
     * that used to be here could only half see it.
     *
     * All three marks are inline SVG, and stripping tags deletes the mark and
     * the missing space together. That leaves one visible seam in the text —
     * "Source.Pure", a sentence ending against the next one — and the previous
     * assertion matched on exactly that. Mutation testing showed what it buys:
     * dropping the separator *before* a mark is caught, and dropping the one
     * *after* it is not, because "Fully Open Source. Pure TypeScript." is what
     * the text says either way while the page renders the mark welded to the
     * word. Half a guard under a comment claiming a whole one.
     *
     * So this runs on the source with each mark replaced by a sentinel, which
     * keeps the position the stripping threw away and checks both of its edges.
     * The count is asserted first: if a class name changes, the replacements
     * stop firing and every adjacency check below silently passes. */
    const SENTINEL = '';
    const marked = leadSource
      .replace(/<a class="osi-mark"[\s\S]*?<\/a>/g, SENTINEL)
      .replace(/<span class="ts-mark"[\s\S]*?<\/span>/g, SENTINEL)
      .replace(/<span class="battery-mark"[\s\S]*?<\/span>/g, SENTINEL)
      .replace(/\s+/g, ' ');
    assert.equal(
      marked.split(SENTINEL).length - 1,
      3,
      'the lead should carry three marks — a class name changed and this check went blind',
    );
    assert.doesNotMatch(
      marked,
      new RegExp(`\\S${SENTINEL}|${SENTINEL}\\S`),
      `a mark is welded to the text beside it — an explicit {' '} is missing:\n${marked}`,
    );

    /* "pure TypeScript" is a scoped claim, and this is the coupling rather
     * than the wording.
     *
     * docs/messaging.md §5 approves "pure TypeScript protocol code". The
     * unqualified form is false one level down — the encrypted Expo store is
     * expo-sqlite with SQLCipher and needs a development build — so the lead
     * may use the short form only while the page states the storage exception
     * somewhere a reader reaches. That is a condition on the phrase, not a
     * requirement to use it: a lead that drops the phrase owes nothing, and
     * this used to pin one exact sentence and would have failed the next two
     * times the lead was rewritten while the claim it guards stayed true.
     *
     * The exception is checked on the built page, in the block below. */
    if (/pure TypeScript/i.test(lead)) {
      const built = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
      assert.match(
        built,
        /needs a development build rather than Expo Go/,
        'the lead claims pure TypeScript and the page no longer states the storage exception',
      );
    }
  }

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
   * below proves, and not what the relay is unable to do. Only the negative
   * belongs on the source: the positive is asserted against the built page in
   * the block below, because the comment over the lead quotes its own earlier
   * drafts and a source-side match would pass on one of those. */
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
    /* The boundary claim itself is asserted below against the carrier band's
     * caption, which is where it lives. It used to be pinned in the lead as
     * well; the lead no longer makes it, so the page states the boundary
     * further down rather than above the fold. Keeping the lead-shaped
     * assertion would have meant either failing on a founder edit or being
     * quietly rewritten to match whatever the lead said next, and neither of
     * those is a gate. What is left is the fact and the place it is provable:
     * the caption stands directly over the recorded relay row. */
    /* The storage exception that scopes "pure TypeScript" in the lead.
     * Asserted here rather than only beside the runtime cell, because the two
     * are one claim split across a screen: the lead is allowed its short form
     * precisely while this is on the same page. */
    assert.match(dist, /needs a development build rather than Expo Go/);
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

/*
 * The OSI keyhole is drawn under a trademark licence with conditions, and this
 * is the half of the licence that lives outside the component drawing it.
 *
 * `src/components/OsiMark.astro` keeps the mark, its link, and its artwork
 * decision together. Three obligations it cannot hold on its own: the
 * attribution statement is in the shared footer, the condition that makes the
 * whole use permitted — "the use must promote OSI-approved software licenses"
 * — is satisfied by a sentence a screen away from the mark in a band that has
 * been rewritten four times, and the size that keeps it a glyph rather than a
 * certification badge is in the stylesheet.
 *
 * Nothing in the build would notice any of them leaving. A footer edit that
 * tidies a legal paragraph, or a band edit that drops the licence name for
 * length, turns a licensed use into an unlicensed one and every page still
 * renders. So the test runs the other way round: it is conditional on the mark
 * being present, and it fails the build for the page that carries the mark
 * rather than for the file that was edited.
 */
test('carries what the OSI mark is licensed on, wherever the mark is', async () => {
  const built = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!built || !/class="osi-mark"/.test(built)) return;

  /* Not "somewhere on the page": the anchor is the mark's own parent. A link
   * beside it, or a footer link to opensource.org, is not the logo being
   * hyperlinked. */
  assert.match(
    built,
    /<a class="osi-mark"[^>]*href="https:\/\/opensource\.org"/,
    'the OSI logo must be hyperlinked to opensource.org',
  );

  /* An icon-only link whose only child is aria-hidden announces nothing. The
   * build rewrite appends "(opens in a new tab)" to this label, so the match is
   * on the opening rather than the whole string. */
  assert.match(
    built,
    /<a class="osi-mark"[^>]*aria-label="Open Source Initiative/,
    'the OSI mark is a link with no accessible name',
  );

  /* Quoted from the guidelines, which give the sentence verbatim. */
  assert.match(
    built,
    /The OSI logo trademark is the trademark of Open Source Initiative\./,
    'the OSI mark is on the page without its required attribution statement',
  );

  /* The permission itself. AGPL-3.0 is on OSI's approved list; the mark is
   * allowed here because the page says the SDK is under it. Matched on the
   * licence identifier rather than on any one sentence, because four different
   * sentences on this page have carried it and any of them discharges this. */
  assert.match(
    built,
    /AGPL-3\.0/,
    'the OSI mark is permitted only on a page that promotes an OSI-approved licence',
  );

  /* The palette is a condition — "never stray from the color palette" — so the
   * mark's own colours are literals rather than tokens, and this is the guard
   * against a well-meant sweep replacing them with `currentColor` or
   * `--oe-muted` the way every other mark on this site is drawn. */
  const mark = await readFile(new URL('../src/components/OsiMark.astro', import.meta.url), 'utf8');
  assert.match(mark, /fill="#3DA639"/i, 'the OSI mark must be drawn in an OSI palette colour');
  assert.match(mark, /stroke="#1E531D"/i, 'the OSI mark must keep its palette outline');

  /* The outline variant of this mark has a 0.8-unit wall on a 24 viewBox and
   * renders 0.65px wide at the lead's text size; it shipped for one round and
   * read as a smudge. The solid mark is a body with the keyhole knocked out of
   * it, and the two are told apart by whether the path is filled. A `fill` of
   * `none`, or a swap back to the simple-icons path, is the regression. */
  assert.doesNotMatch(mark, /fill="none"/i, 'the outline variant is illegible at text size');

  /* "Do not imply sponsorship or endorsement by OSI." The mark is one glyph at
   * text size; at badge scale it would read as certification, and OSI certifies
   * licences rather than products. The rule is the sizing in `global.css`, and
   * this is the tripwire on it. */
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  /* `[^}]*` and not `[\s\S]*?`, which is what this was written as first and
   * which does not stop at the closing brace: switch this rule to `32px` and
   * the lazy version walks on into the stylesheet, finds some other rule's
   * `1em`, and reports a pass for a mark it never looked at.
   *
   * The number moved out of `.osi-mark svg` when the three marks were set
   * against each other and started sharing one sizing rule; it is the custom
   * property on the wrapper now. `\.osi-mark \{` cannot match the grouped
   * selector the three share, which reads `.osi-mark,` there. */
  const size = css.match(/\.osi-mark \{[^}]*--oe-mark-size:\s*([\d.]+)em/)?.[1];
  assert.ok(size, 'the OSI mark should be sized in em, against the text it sits in');
  assert.ok(
    Number(size) <= 1.5,
    `the OSI mark is ${size}em — at badge scale it reads as certification`,
  );
});

/*
 * The TypeScript logo, held to the two lines on its branding page that this
 * repository can actually break.
 *
 * <https://www.typescriptlang.org/branding/> publishes guidelines rather than a
 * licence, and most of what they ask is about naming and lockups — a build
 * cannot check that a product name does not imply endorsement. Two of them it
 * can. "The 'TS' in the logo is white, not transparent by default" tells the
 * primary mark apart from the single-colour alternative that has the letters cut
 * out, and "modify the shape of the logos when used" is on the Please Don't
 * list.
 *
 * Both were broken here, in the way that is hard to see: the first version drew
 * simple-icons' path, which is a faithful copy of the cut-out alternative, and
 * filled it with the primary blue. The letters were holes. On the light canvas
 * they took the cream background and looked white enough to pass; on the dark
 * canvas they came out #0f0e0b. A wrong logo that renders correctly in the theme
 * the author happens to be working in is exactly the defect no reviewer catches
 * by looking once.
 *
 * So the shape is pinned by hash rather than by eye. Sizing is not: `.ts-mark`
 * scales the whole thing and scaling is not modifying.
 */
test('draws the TypeScript logo the way its branding page publishes it', async () => {
  const mark = await read('../src/components/TypeScriptMark.astro');

  /* The letterform, byte for byte out of `ts-logo-128.svg` in the official asset
   * pack. A hash and not a substring: a substring check passes on a path that
   * has had one coordinate nudged, and "modify the shape" is precisely the thing
   * a nudged coordinate does. If this fires for a deliberate change, the change
   * has to come from a newer official file, and the new hash is taken from that
   * file rather than from what the component happens to contain. */
  const d = mark.match(/\sd="([^"]+)"/)?.[1];
  assert.ok(d, 'the TypeScript mark should draw the official letterform path');
  assert.equal(
    createHash('sha256').update(d).digest('hex'),
    '78c8f0a5f1fc1655db2d930ee86a973f5c0a60dd69517e1e30706f34b1786160',
    'the TypeScript letterform has been altered — the branding page forbids modifying the shape',
  );

  /* White letters on the blue tile, which is the whole of the primary-versus-
   * alternative distinction. `fill-rule` is load-bearing: the letterform is one
   * path with the counters of the "S" as subpaths, and under `nonzero` they fill
   * in. */
  assert.match(mark, /viewBox="0 0 128 128"/, 'the 128 rendition is the one drawn at text size');
  assert.match(mark, /<rect[^>]*rx="6"/, 'the tile keeps the corner radius of the 128 file');
  assert.match(mark, /fill="#3178c6"/i, 'the tile must be the official blue');
  assert.match(mark, /fill="#fff"/i, 'the "TS" is white, not transparent');
  assert.match(mark, /fill-rule="evenodd"/, 'the letterform fills solid without evenodd');

  /* The regression this site invites: every other mark it draws is monochrome in
   * `currentColor` or `--oe-muted`, and a sweep that makes this one match would
   * both recolour a logo and put the letters back to transparent. */
  assert.doesNotMatch(
    mark,
    /fill="(currentColor|var\([^)]*\)|none)"/,
    'the TypeScript logo may not be recoloured to a token or hollowed out',
  );

  /* And the same, one layer up, where a stylesheet could undo it without
   * touching the component. */
  const css = await read('../src/styles/global.css');
  assert.doesNotMatch(
    css,
    /\.ts-mark[^{]*\{[^}]*fill:/,
    'a stylesheet is overriding the TypeScript logo’s fills',
  );

  /* Rendered, because the two assertions above are on source and the point of
   * all of this is what reaches a reader in dark mode. */
  const built = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!built) return;
  const rendered = built.match(/<span class="ts-mark">[\s\S]*?<\/span>/)?.[0];
  assert.ok(rendered, 'the TypeScript mark is not on the built page');
  assert.match(rendered, /fill="#fff"/i, 'the built page draws the "TS" as a hole');
  assert.match(rendered, /fill="#3178c6"/i, 'the built page lost the official blue');
});

/*
 * The battery is green, and green here is a claim rather than a decoration: it
 * is the colour this site uses where something is settled rather than promised,
 * which is what "batteries included" asserts.
 *
 * Both canvases have to be checked, because the two are supplied differently.
 * Light takes `--oe-verified` directly. Dark steps off the token to `verify-500`
 * — the token's own dark value is `verify-300`, tuned for a run of small text at
 * 10.98:1, and a whole glyph filled with it reads as mint rather than green. An
 * exception like that is exactly the kind a later sweep "corrects" back to the
 * token, so it is pinned here with the reason next to it.
 */
test('keeps the battery green on both canvases', async () => {
  const mark = await read('../src/components/BatteryMark.astro');
  assert.match(mark, /fill="currentColor"/, 'the battery must inherit its colour to stay theme-aware');
  assert.doesNotMatch(mark, /fill="#/, 'a literal colour in the battery breaks one of the two themes');

  const css = await read('../src/styles/global.css');

  /* Both canvases name a step on the verify ramp, and neither takes
   * `--oe-verified`. The semantic token is tuned for a run of small text and
   * this is a filled glyph: too pale on dark at its `verify-300`, heavier than
   * it needs to be on light at its `verify-700`. Matching the ramp shape rather
   * than one exact step is deliberate — which step is a judgement that has
   * already moved once per canvas, and pinning it here would make this test the
   * thing that has to be edited to record a decision it does not own. What it
   * owns is that the colour stays on the ramp, which is what keeps it a green
   * this palette contains rather than one somebody picked.
   *
   * Both sides go through `ruleFor`, and that is not tidying. Written as
   * `/\.battery-mark \{[^}]*color: var\(--oe-color-verify-\d+\)/` the light
   * assertion is satisfied by the *dark* rule, because that selector ends in
   * ".battery-mark {" as well. Mutation-tested: with the light rule reverted to
   * `--oe-verified` outright, that regex still matched — on
   * `:root.dark .battery-mark`. The gate below fails on the same mutation. */
  assert.match(
    ruleFor(css, '.battery-mark'),
    /color:\s*var\(--oe-color-verify-\d+\)/,
    'the light-canvas battery should take a step on the verify ramp',
  );
  assert.match(
    ruleFor(css, ':root.dark .battery-mark'),
    /color:\s*var\(--oe-color-verify-\d+\)/,
    'the battery needs its own dark-canvas green — the token’s dark value reads as mint',
  );

  /* The ratio the two greens have to clear is asserted in
   * `tests/contrast.test.mjs`, where the luminance helper lives. It is named
   * here because the exception above is only defensible if it stays legible,
   * and a reader of this test should not have to guess where that is checked. */
});

/*
 * One margin for all three marks, which is a fix for a bug that looked like a
 * typography problem and was a geometry problem.
 *
 * The gap either side of a mark used to depend on which mark it was: measured on
 * the page, 4.9px before the keyhole, 4.9px before the TypeScript tile and
 * 11.2px before the battery, from markup that separates all three the same way.
 * The battery was drawn on a 24-unit square and is 12 units wide, so half its
 * box was empty and rendering as padding, while the other two paint to all four
 * edges of theirs. Nobody would find that by reading the stylesheet.
 *
 * So there are two halves to hold: every mark's viewBox is cropped to its ink,
 * and the spacing comes from one shared declaration rather than three. This
 * checks the second half and the first, because either one alone restores the
 * bug.
 */
test('spaces the three marks in the lead identically', async () => {
  const css = await read('../src/styles/global.css');

  /* Parsed into rules rather than matched by name — see `./css-rules.mjs`,
   * which owns why. This test is where that trap was first found: the grouped
   * selector ends ".battery-mark {" too, so the per-mark check below read the
   * very declaration it was meant to be independent of, and passed. */
  const rules = cssRules(css);

  const shared = rules.find((r) => r.selector === '.osi-mark, .ts-mark, .battery-mark');
  assert.ok(shared, 'the three marks should still share one rule — the grouped selector is gone');
  assert.match(shared.body, /margin-inline:/, 'the marks’ spacing should be set once, for all three');

  /* And not quietly re-split per mark afterwards. A `margin` on one of them is
   * how "uniform" decays back into three numbers. */
  for (const name of ['osi', 'ts', 'battery']) {
    const own = rules.filter((r) => r.selector === `.${name}-mark`);
    assert.equal(own.length, 1, `.${name}-mark should have exactly one rule of its own`);
    assert.doesNotMatch(
      own[0].body,
      /margin/,
      `.${name}-mark sets its own margin — the three have drifted apart`,
    );
  }

  /* The geometry half. A mark whose viewBox is wider than its drawing carries
   * padding no margin rule can see, which is the state this test exists because
   * of. Checked on the built page, where the viewBox and the drawing are both
   * visible, rather than on three component sources. */
  const built = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!built) return;
  const battery = built.match(/<span class="battery-mark">[\s\S]*?<\/span>/)?.[0];
  assert.ok(battery, 'the battery mark is not on the built page');
  const view = battery.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number);
  assert.ok(view, 'the battery needs a viewBox');
  assert.equal(view[2] / view[3], 0.6, 'the battery viewBox is no longer cropped to its drawing');
});

/*
 * The strip is the panel's caption, and equidistance is how that gets lost.
 *
 * The hero grid is one `gap`, so every boundary in it is the same distance by
 * default and the four children read as four unrelated blocks. Measured before
 * this: 61.9px above the strip and 61.9px below it, to the tenth. The fix is a
 * negative margin that cancels part of the gap, which is the kind of
 * declaration a later reader deletes as a leftover — so what it buys is
 * asserted here rather than left to the comment beside it.
 *
 * Asserted as arithmetic on the two declarations, not as a pixel: both sides
 * name `--hero-grid-gap`, and the point is that they cannot drift apart.
 */
test('binds the platform strip to the panel it captions', async () => {
  const css = await read('../src/styles/global.css');

  const grid = ruleFor(css, '.hero-grid');
  const gap = grid.match(/--hero-grid-gap:\s*([^;]+);/)?.[1].trim();
  assert.ok(gap, 'the hero grid gap is no longer named, so nothing can subtract it');
  assert.match(
    grid,
    /gap:\s*var\(--hero-grid-gap\)/,
    'the grid stopped using the variable it declares — the strip now cancels a gap that is not there',
  );

  /* Two rules carry this selector — this one, and the strip's centring a few
   * lines above it — so it is picked by what it declares rather than by
   * `ruleFor`, which
   * refuses an ambiguous selector on purpose. Exactly one of them may set the
   * pull: a second would mean the distance is being decided in two places. */
  const strips = cssRules(css).filter(
    (rule) => rule.selector === '.hero-grid > .platform-strip' && /margin-bottom:/.test(rule.body),
  );
  assert.equal(
    strips.length,
    1,
    `${strips.length} rules pull the strip toward the panel; it should be decided once`,
  );

  const pull = strips[0].body.match(/margin-bottom:\s*calc\(([^;]+)\);/)?.[1];
  assert.ok(
    pull,
    'the strip no longer pulls itself toward the demo — it sits equidistant between the ' +
      'buttons and the panel again, which reads as a section of its own rather than a caption',
  );

  /* The subtraction has to be of the same variable the grid spaces by. A
   * literal copy of the clamp here would pass a looser check and silently stop
   * cancelling the moment the grid's rhythm changed. */
  assert.match(
    pull,
    /-\s*var\(--hero-grid-gap\)/,
    `the strip's pull is \`${pull.trim()}\` — it does not subtract the gap it is cancelling, ` +
      'so the two can drift apart',
  );

  /* And what is left has to be smaller than the gap, or the strip is no longer
   * closer to the panel than to the buttons. `--oe-space-4` is 16px against a
   * grid rhythm that floors at 2rem, so this holds at every width; the check is
   * that the remainder is a fixed token rather than another clamp that could
   * overtake it. */
  const remainder = pull.match(/^\s*var\(--oe-space-(\d+)\)/)?.[1];
  assert.ok(
    remainder,
    `the strip's remaining gap is \`${pull.trim()}\` — it should be one spacing token, so it ` +
      'can be compared against the grid rhythm by reading it',
  );
  assert.ok(
    Number(remainder) <= 8,
    `--oe-space-${remainder} is 2rem or more, which is the grid rhythm's own floor — at the ` +
      'narrow end the strip would be equidistant again',
  );
});

test('says whether the adapters ship, wherever it says they are yours', async () => {
  const index = await flat('../src/pages/index.astro');

  /* The lead said "the SDK ships adapters for both" and the disclosure list
   * said "yours to supply", 450 px apart in the same viewport. Both true, the
   * pair not: a fresh reader could not tell whether they configure an adapter
   * or stand up a network service, which is the difference between an
   * afternoon and a sprint. The obligation and the shipped code have to be
   * named in the same breath or the page reads as two answers.
   *
   * The lead no longer carries its half — it was cut for length, and the
   * bullets were always the fuller statement, since each one names the export
   * next to the obligation. So the pairing is asserted where it now lives, on
   * the rendered page rather than on this source: the phrase survives in a
   * comment in index.astro explaining why it went, and `flat()` strips
   * whitespace but not comments, so a source-side assertion for it passes on
   * the explanation for its own removal. That is the vacuous-gate failure this
   * suite has already had twice. */
  const dist = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!dist) return;

  assert.doesNotMatch(dist, /SDK ships adapters for both/);
  assert.match(dist, /yours to supply/);
  for (const name of ['expoStore', 'nodeStore', 'indexedDbStore', 'convexRelay']) {
    assert.match(index, new RegExp(`<code\\s*>?${name}\\(\\)</code\\s*>?`), `${name} is not named`);
    assert.match(dist, new RegExp(`${name}\\(\\)`), `${name} is not on the built page`);
  }

  /* And the relay is defined where it is first demanded of the reader. Three
   * fresh readers in one wave, independently, called it the load-bearing noun
   * the page never explains.
   *
   * The definition used to open "the server that holds public keys", which is
   * the one word `docs/messaging.md` §4 reserves against for this exact role.
   * It now defines the relay as itself rather than by a banned synonym, so the
   * assertion moved onto the part that carries the meaning. Asserting the
   * words and not the dash keeps this from failing over punctuation. */
  assert.match(
    dist,
    /it holds public keys\s+and\s+device lists\s+and\s+delivers the encrypted envelopes/,
  );
  assert.doesNotMatch(dist, /the server that holds public keys/);

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

/*
 * The platform strip claims a support matrix. These check it against the
 * installed package rather than against the sentence someone remembered.
 *
 * Both tests below exist because two claims about this strip shipped wrong in
 * the round that added it. The caveat under it said "Expo and Node are the
 * complete ones" — the phrasing the maturity line explicitly rejects — and it
 * got past the guard on that sentence because the guard pinned a literal
 * string rather than the fact. A claim about what ships should be checked
 * against what ships.
 */

/* Which store modules the SDK itself marks. Read from the copy in
   node_modules, so it is the version the site is built against. */
const adapterDoc = () =>
  readFile(
    new URL('../node_modules/@open-e2ee/signal-protocol-sdk/ADAPTERS.md', import.meta.url),
    'utf8',
  );

test('grades exactly the runtimes the SDK marks experimental, and no others', async () => {
  const [doc, index] = await Promise.all([adapterDoc(), flat('../src/pages/index.astro')]);

  /* `local/store/<name>` on a line that also carries `(experimental)`. Anchored
     on the module path because that is the stable identifier — the prose around
     it has been reworded twice, and the export names once. */
  const marked = new Set(
    doc
      .split('\n')
      .filter((line) => line.includes('(experimental'))
      .map((line) => line.match(/local\/store\/([a-z-]+)/)?.[1])
      .filter(Boolean),
  );
  assert.ok(marked.size > 0, 'no experimental store found in ADAPTERS.md — the anchor has drifted');

  /* This checked the platform strip's inline `(experimental)` qualifiers until
   * the founder removed them. The strip is not where the fact has to live — the
   * maturity line states it in the canonical wording and the Store selector
   * labels both stores at the moment a reader picks one — so the gate moved to
   * the sentence rather than dying with the markup it happened to be pointing
   * at. What it is really for is unchanged: no test read ADAPTERS.md before this
   * one, so "which stores are experimental" was pinned only to a string someone
   * had copied by hand.
   *
   * `store → the word the page uses`, written out because this is the only
   * place the two vocabularies meet: `web` is the site's "Browser", and
   * `react-native` is the bare one, which is why Expo is separate rather than a
   * flavour of it. `mock` is a development adapter and is not a platform the
   * page grades at all. */
  const pageWord = { expo: 'Expo', node: 'Node', web: 'Browser', 'react-native': 'React Native' };
  const graded = Object.keys(pageWord);
  for (const store of marked) {
    assert.ok(pageWord[store], `ADAPTERS.md marks ${store}, which the page has no word for`);
  }

  /* The one sentence that grades them, split at the semicolon into the side
     that is experimental and the side that is not. */
  const line = index.match(/([^.]*) stores are experimental; ([^.]*) are not\./);
  assert.ok(line, 'the maturity line no longer states the experimental split in the expected shape');
  const [, experimental, complete] = line;

  for (const store of graded) {
    const word = pageWord[store];
    const side = marked.has(store) ? experimental : complete;
    const wrongSide = marked.has(store) ? complete : experimental;
    assert.ok(side.includes(word), `${word} is not on the ${marked.has(store) ? 'experimental' : 'stable'} side`);
    assert.ok(!wrongSide.includes(word), `${word} is on both sides of the experimental split`);
  }
});

test('shows a generic bucket for S3 only while there is no AWS client to name', async () => {
  const marks = await read('../src/lib/platform-marks.mjs');
  const manifest = JSON.parse(
    await readFile(
      new URL('../node_modules/@open-e2ee/signal-protocol-sdk/package.json', import.meta.url),
      'utf8',
    ),
  );

  /* The strip draws its own bucket for S3 rather than showing a vendor mark,
     and the entry is named for the API rather than for a company. Both rest on
     one fact: the SDK has no AWS client anywhere, in any dependency class.
     `./remote/object-store/s3` is a client for presigned URLs that a broker the
     application implements mints, so AWS credentials live in that backend and
     never in this package. If an `@aws-sdk` dependency ever appears, the
     reasoning in platform-marks.mjs for drawing a generic bucket stops holding
     and the entry should become a real mark. */
  const declared = Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  });
  assert.deepEqual(
    declared.filter((name) => name.startsWith('@aws-sdk') || name === 'aws-sdk'),
    [],
    'the SDK now depends on an AWS client — the generic-bucket rationale needs revisiting',
  );

  /* Naming a company is the line, not naming the protocol. "Amazon S3" or
     "AWS S3" would assert the integration the dependency check above says does
     not exist. */
  assert.match(marks, /label: 'S3'/);
  assert.doesNotMatch(marks, /label: '(Amazon[^']*|AWS[^']*)'/);

  /* The bare word only stays honest because of the heading over it. "S3" in a
     row headed "Works with" is the API; the same word under "Integrations",
     "Powered by", or "Partners" — or under no heading at all — is a vendor
     claim. So the heading is held to an allowlist of compatibility framings
     rather than to one string: rewording within the list is free, and adding to
     the list is the moment to re-decide whether the bare name still reads as a
     protocol. */
  const strip = await read('../src/components/PlatformStrip.astro');
  const heading = strip.match(/class="platform-label">([^<]*)</)?.[1];
  assert.ok(heading, 'the strip no longer has a heading over the marks');
  assert.match(
    heading,
    /^(Works|Compatible) with$/,
    `"${heading}" over an entry named "S3" reads as an integration the SDK does not have`,
  );

  /* And that the export the entry stands for is really there. */
  assert.ok(manifest.exports['./remote/object-store/s3'], 's3 object store export is gone');
});

test("the demo's own source calls the relay a relay", async () => {
  /*
   * `docs/messaging.md` §4 fixes the vocabulary: the E2EE role is the **relay**,
   * and "server" is the word avoided for it. The demo is where that slips,
   * because its prose is written inches from SDK calls that legitimately carry
   * "Server" in their names — `syncToServer`, `ISignalProtocolRelayServer` —
   * and the eye stops seeing it. Two sentences shipped that way and reached the
   * live site: the run-out-of-prekeys card, and the health-check line that
   * managed to say "the relay held" and "the server is the side that runs out"
   * in one breath.
   *
   * Why this is a source test and not another `audit-build.mjs` pattern. That
   * audit is not blind to compiled demo copy — it scans built `.js` as well as
   * `.html`, and has since the gap was demonstrated. The reason "server" is not
   * one of its patterns is that it cannot be: the audit matches against whole
   * chunks, and the word is *correct* nearly everywhere else on this site. The
   * TLS article, `/learn`, and the architecture diagrams all discuss servers on
   * purpose. A pattern there would have to be right about the whole site; this
   * rule only has to be right about the demo, and scoping it to the demo's own
   * source is what buys that.
   *
   * The scan reads source rather than `dist/`, so it runs without a build and
   * points at the line to fix instead of at a hashed chunk.
   *
   * What this does NOT cover, and the title is narrow on purpose. Strings that
   * originate in the SDK reach the page and this test cannot see them: the
   * reinstall scenario prints `EncryptionError`'s own wrapper, "Failed to sync
   * with server", quoted rather than paraphrased because the point of that
   * card is what came back — `scripts/demo-smoke.mjs` asserts the page renders
   * it. So a reader does still meet the word on `/demo`. Fixing that means
   * changing the SDK's message, not this site's copy, and it belongs to the
   * vocabulary pass over the SDK's API surface and its rendered errors.
   */
  const roots = ['../src/lib/demo/', '../src/components/demo/'];
  const sources = [];
  for (const root of roots) {
    const dir = new URL(root, import.meta.url);
    for (const name of await readdir(dir, { recursive: true })) {
      if (/\.(?:ts|astro|mjs)$/.test(name)) sources.push([root + name, new URL(name, dir)]);
    }
  }
  sources.push(['../src/pages/demo.astro', new URL('../src/pages/demo.astro', import.meta.url)]);

  /* A glob that quietly matched nothing would pass this test forever. */
  assert.ok(
    sources.length >= 15,
    `expected the whole demo source tree, found ${sources.length} files`,
  );

  /*
   * Bare "server" only. A match touching an identifier character on either side
   * is part of a name the SDK ships and this repository does not get to rename
   * — those are queued as a deliberate API vocabulary pass. "server-rendered"
   * is Astro's meaning, not the E2EE role, and is left alone.
   */
  const BARE_SERVER = /(?<![\w$])servers?(?![\w$])/gi;
  const found = [];
  for (const [label, url] of sources) {
    const text = await readFile(url, 'utf8');
    for (const hit of text.matchAll(BARE_SERVER)) {
      if (/^-rendered/i.test(text.slice(hit.index + hit[0].length))) continue;
      const line = text.slice(0, hit.index).split('\n').length;
      found.push(`${label}:${line}: ${text.split('\n')[line - 1].trim()}`);
    }
  }

  assert.deepEqual(
    found,
    [],
    `the demo names the relay a "server" here — messaging.md §4 says relay:\n${found.join('\n')}`,
  );
});
