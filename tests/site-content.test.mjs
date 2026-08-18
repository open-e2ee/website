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
import { maturityLine, sdkLine, sdkVersion } from '../src/lib/sdk.mjs';
import { cssRules, ruleFor } from './css-rules.mjs';
import {
  buildSnippet,
  defaultVariant,
  heroCode,
  installCommand,
  relayComment,
  relayOptions,
  snippetComments,
  snippetVariants,
  storageOptions,
} from '../src/lib/hero-snippet.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

/*
 * Build-output assertions skip when dist/ is absent, so `npm test` still runs
 * on an unbuilt tree locally. In CI the workflow builds before it tests, so an
 * absent page there means the ordering regressed — and a plain skip would hide
 * exactly that. Every dist-reading guard in this file calls this instead of
 * returning bare: locally it is a no-op, in CI it fails the test.
 */
const skipUnbuilt = (page) => {
  assert.ok(
    !process.env.CI,
    `${page} is missing — CI builds before it tests, so a dist-reading assertion must never skip here`,
  );
};

test('keeps the tagline contract: proposed lines annotated, approved lines free', async () => {
  /*
   * This used to pin three exact strings in Footer.astro. That guard was
   * right about the risk and wrong about the mechanism: it proved the footer
   * had not changed, not that the site kept its promise. When the founder
   * dropped the footer tagline on 2026-08-04 it failed for the correct edit,
   * and it would have passed happily if a tagline had appeared unannotated on
   * any of the site's other pages.
   *
   * So it now runs the design package's own checker over every built page.
   * `findTaglines` looks for the registered tagline strings in the rendered
   * text; `checkTaglineAnnotation` passes a page that contains none or only
   * approved ones, and requires ANNOTATION_PATTERN wherever a *proposed*
   * tagline appears. Since the founder review of 2026-08-09 the /product h1
   * is approved and needs no annotation; the contract still bites if a
   * proposed line (today: the primary) ever ships here unannotated.
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
    // dist/ absent — the build-output tests in this file all skip together.
    skipUnbuilt('dist/');
    return;
  }
  /* 14 since /learn folded into the architecture blog post, which followed
   * /compare folding into /product and /demo folding into the homepage. This
   * is a floor on the walk finding the site, not a count anyone maintains for
   * its own sake — but it is exactly met, so it reds the moment a route is
   * dropped without being accounted for here. That is the intended behaviour
   * and the reason it is not slack. */
  assert.ok(pages.length >= 14, `expected the full site in dist/, found ${pages.length} pages`);

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
   * exactly one surface uses one — the /product h1, approved 2026-08-09.
   * If this list grows, a tagline shipped somewhere new without anyone
   * deciding it should. */
  assert.deepEqual(usingTagline, ['product/index.html']);
});

test('makes the same ten-minute promise everywhere it makes one', async () => {
  const [product, footer] = await Promise.all([
    flat('../src/pages/product.astro'),
    flat('../src/components/Footer.astro'),
  ]);

  assert.match(product, /ten minutes · two clients · no account/);
  assert.match(footer, /Ten-minute quickstart/);

  /* The homepage makes it nowhere. The promise argues for spending the ten
   * minutes, so it belongs under a button a reader reaches after the evidence;
   * the landing page's own closing ask was cut by the founder, and it now ends
   * on the licence with no second offer, so the reader who has decided meets
   * the promise on /product. Under the hero button it would be a
   * third line of small grey type between the offer and the proof.
   *
   * Read off the built page and not the source: `flat()` keeps comments, and
   * the comment over the hero actions quotes this exact sublabel in order to
   * rule it out there. A source-side negative would fail on its own tombstone.
   * The count is asserted because the failure is additive — a sublabel is the
   * obvious thing to paste onto a new call to action. */
  const dist = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!dist) return skipUnbuilt('dist/index.html');
  assert.equal((dist.match(/ten minutes · two clients · no account/g) ?? []).length, 0);
  assert.doesNotMatch(dist, /cta-sublabel/);
});

test('states maturity as the version plus the before-1.0 caveat, with no stage adjective', async () => {
  /* messaging.md §4: the maturity claim is the version number itself plus the
   * before-1.0 caveat. No stage adjective may stand in for it. The pages that
   * grade the release — /product and /security — carry the canonical line;
   * the homepage carries no maturity line at all, but the negative binds it
   * too, so one cannot reappear there unstated. */
  const [index, product, security] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/pages/product.astro'),
    flat('../src/pages/security.astro'),
  ]);

  /* The source is checked for the composition and the built page for its
   * value, because those are two different defects. A page that types the
   * sentence is stale at the next minor and nothing notices; a page that
   * composes it from a module the build does not reach renders nothing at all.
   * Asserting a literal here could only ever catch the second. */
  for (const page of [product, security]) {
    assert.match(page, /<p class="maturity">\{maturityLine\}<\/p>/);
    assert.match(page, /import \{ maturityLine \} from '\.\.\/lib\/sdk\.mjs';/);
  }
  /* The lookahead exempts version identifiers: a prerelease suffix inside a
   * version — `0.1.0-alpha.14` — names a release, not a maturity stage. */
  for (const page of [index, product, security]) {
    assert.doesNotMatch(page, /\b(?:alpha|beta|early access|preview)\b(?![.-]?\d)/i);
  }

  /* Asserted on the built pages too, because `flat()` keeps comments and a
   * source pin can pass on a paragraph's own tombstone. The built homepage
   * must NOT carry the maturity line the founder cut, and the built pages
   * that grade the release must. */
  const [builtIndex, builtProduct, builtSecurity] = await Promise.all(
    ['index.html', 'product/index.html', 'security/index.html'].map((page) =>
      readFile(new URL(`../dist/${page}`, import.meta.url), 'utf8').catch(() => null),
    ),
  );
  if (!builtIndex || !builtProduct || !builtSecurity) return skipUnbuilt('dist/');
  assert.doesNotMatch(builtIndex, /\d+\.\d+\.x — public APIs/);
  /* The wording is pinned separately from its presence. `maturityLine` is
   * composed, so asserting only that the built page contains it would pass on
   * any sentence the module happened to build — including one that had lost the
   * caveat and kept the number. */
  assert.equal(
    maturityLine,
    `${sdkLine} — public APIs and persisted formats may change before 1.0.`,
  );
  for (const page of [builtProduct, builtSecurity]) {
    assert.ok(page.includes(maturityLine), `built page does not state "${maturityLine}"`);
  }
});

test('no page states a release line or an SDK version as a literal', async () => {
  /* The defect this replaced: /product, /security, the comparison matrix, and
   * two journal posts each typed `0.1.x` while the installed SDK was 0.2.3.
   * They went stale together at 0.2.0 and nothing could fail, because a typed
   * number is indistinguishable from a correct one. `src/lib/sdk.mjs` is the
   * one place allowed to know a version, and `src/data/carrier-capture.json`
   * records the version it was measured against — restamping that by hand
   * would be fabricating provenance, so it is read, never written. */
  const allowed = new Set(['src/lib/sdk.mjs', 'src/data/carrier-capture.json']);
  const root = new URL('../', import.meta.url);
  const offenders = [];

  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, root), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`;
      if (entry.isDirectory()) {
        await walk(`${path}/`);
        continue;
      }
      if (allowed.has(path)) continue;
      if (!/\.(astro|mdx|mjs|ts|json)$/.test(entry.name)) continue;

      const text = await readFile(new URL(path, root), 'utf8');
      for (const match of text.matchAll(/\d+\.\d+\.x/g)) {
        offenders.push(`${path}: states ${match[0]}, compose it from src/lib/sdk.mjs`);
      }
      for (const match of text.matchAll(new RegExp(`(?<![-\\d.])${sdkVersion.replaceAll('.', '\\.')}(?![\\d.])`, 'g'))) {
        offenders.push(`${path}: states the installed version ${match[0]} as a literal`);
      }
    }
  };

  await walk('src/');
  assert.deepEqual(offenders, []);
});

test('the design profile names the release package.json installs', async () => {
  /* The prose pin said v0.2.2 against a v0.8.0 dependency — six minors of
   * drift in the one place a reader looks to find out which contract the
   * surfaces follow. Same class as the version literals above, so it gets the
   * same treatment rather than another convention. */
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const installed = /refs\/tags\/(v\d+\.\d+\.\d+)\.tar\.gz$/.exec(
    manifest.dependencies['@open-e2ee/design'],
  );
  assert.ok(installed, 'cannot read a tag out of the design dependency');

  const profile = await readFile(new URL('../DESIGN.md', import.meta.url), 'utf8');
  const stated = /`@open-e2ee\/design` (v\d+\.\d+\.\d+)/.exec(profile);
  assert.ok(stated, 'DESIGN.md names no shared release to check');
  assert.equal(
    stated[1],
    installed[1],
    `DESIGN.md says ${stated[1]} but package.json installs ${installed[1]}`,
  );
});

test('answers the runtime question on the homepage', async () => {
  const index = await flat('../src/pages/index.astro');

  for (const runtime of ['expo', 'browser', 'node']) {
    assert.match(index, new RegExp(`docs\\.open-e2ee\\.dev/start/${runtime}`));
  }
});

/**
 * Cut one rendered snippet line into the code the recording proves and the
 * comment the module declares.
 *
 * The scan is quote-aware rather than an `indexOf('//')`, because a `//` is
 * only a comment outside a string and the panel is a file full of module
 * specifiers. None of them contains one today — `"@open-e2ee/…"` is a bare
 * path — but the day a variant needs a URL, an index-of split would quietly
 * feed half a string literal to the capture lookup and blame the editor for a
 * line they wrote correctly.
 *
 * Returns the code trimmed of the space that separated the two, so the lookup
 * sees the line as the recording has it, and the comment trimmed of nothing
 * else, so the declared-comment check compares what the reader sees.
 */
function splitComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') {
      quote = char;
    } else if (char === '/' && line[index + 1] === '/') {
      return { code: line.slice(0, index).trimEnd(), comment: line.slice(index).trim() };
    }
  }
  return { code: line.trimEnd(), comment: null };
}

test('keeps the hero snippet traceable to the recording', () => {
  /* The carrier panel's rule applies to the snippet beside it: nothing on
   * this page is drawn, mocked up, or hand-typed. A hero example written to
   * read well is a claim about the API surface, and it is the one claim this
   * brand cannot afford to get wrong.
   *
   * The rule is "every code line appears in the capture", with no licensed
   * edit. It was weaker for a while: the panel showed one client called
   * `signal` where the recording drives an `alice` and a `bob`, so this test
   * had to undo that rename before it could look a line up, and a `.replace()`
   * chain sitting in front of an assertion is a hole the next editor widens.
   * Showing both devices closed it. An editor who pastes a "small fix" into
   * the rendered string fails here, and there is nothing left to fix it
   * through. */
  /* Comments are the page's own voice and are cut off each line before it is
   * looked up, then held to their own rule in the test below. Splitting the
   * two is what keeps this assertion meaningful: the recording proves the API,
   * and a comment makes no API claim, so requiring it to appear in a capture
   * of a program that has almost no comments would only mean the panel could
   * not have any.
   *
   * The split is by position rather than by line, which it was not before the
   * panel put five of its six comments on the end of a line of code to save
   * the reader five lines of scrolling. `splitComment` is what makes that
   * cheap: the code half of every line is still matched whole, so a "small
   * fix" pasted into the program fails here whether or not a comment follows
   * it on the same line. */
  const all = heroCode.split('\n').filter((line) => line.trim());
  const split = all.map(splitComment);
  assert.ok(split.some((line) => line.code));
  assert.ok(
    split.filter((line) => line.comment).length >= 5,
    'the panel lost the comments that explain it',
  );

  for (const { code } of split) {
    if (!code) continue;
    assert.ok(
      capture.quickstartCode.includes(code),
      `hero line is not in the recorded capture: ${code}`,
    );
  }

  /* Both devices are constructed, and they are the recording's own two. This
   * is what the removed rename guard used to enforce in the negative, and it
   * is the shape the founder asked the panel for: a reader sees a conversation
   * rather than a client sending to a string. */
  assert.match(heroCode, /const alice = await createSignalProtocolClient\(\{/);
  assert.match(heroCode, /const bob = await createSignalProtocolClient\(\{/);
  assert.match(heroCode, /identity: \{ userId: "alice" \},/);
  assert.match(heroCode, /identity: \{ userId: "bob" \},/);

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
    /* Line by line rather than as one block, because the two are no longer
       always adjacent: the relay's comment takes the trailing position on the
       construction's last line where that line has room, and the line above it
       where it does not, which is Convex. What must hold is that every line of
       the construction ships — a variant that lost one would not run — and
       that the comment ships with it, whichever of the two places it took. */
    for (const line of relay.setup.split('\n')) {
      assert.ok(
        variant.code.includes(line),
        `${variant.storage}/${variant.relay} does not construct its relay: ${line}`,
      );
    }
    assert.ok(
      variant.code.includes(relayComment),
      `${variant.storage}/${variant.relay} lost the comment that says what a relay does`,
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
  /* The installed ADAPTERS.md marks no store experimental, so every selector
   * flag must be false. The marker machinery stays wired in HeroSnippet.astro
   * so the next store that ships experimental gets the label from its flag
   * alone, and the maturity test further down holds these flags to the
   * installed ADAPTERS.md. */
  const experimental = storageOptions.filter((option) => option.experimental).map((o) => o.id);
  assert.deepEqual(experimental.sort(), []);
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

  /* Every comment in every variant is one the module declares, wherever on the
   * line it sits. The panel is a place the page can say things in its own
   * voice, and this is the boundary on that: a claim smuggled into the program
   * has to be added to `snippetComments` first, where the absolutes guard and
   * the build audit both already read it.
   *
   * This used to read comment-only lines and would now miss five of the six —
   * the ones that moved onto the end of a line of code — which is the shape of
   * a guard that goes dark without failing. The adapters' own disclosures are
   * declared through `snippetComments` too, so a store that explains itself in
   * a new sentence is still caught. */
  const declared = new Set(snippetComments);
  for (const variant of snippetVariants) {
    for (const line of variant.code.split('\n')) {
      const { comment } = splitComment(line);
      if (!comment) continue;
      assert.ok(
        declared.has(comment),
        `${variant.storage}/${variant.relay} carries an undeclared comment: ${comment}`,
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
    flat('../src/components/demo/DemoConsole.astro'),
  ]);

  /* The panel left the hero for the band whose copy raises the question it
   * answers. Moving it is a layout decision; dropping it is not, because it
   * is the only thing on the site that shows rather than states what the
   * relay holds. A homepage that only asserts it has given up the argument.
   *
   * It moved once more when the live demo landed, and again when the demo
   * became three columns: the page renders `DemoConsole`, which renders the
   * recording under the live console. That is why this checks two files. The
   * recording is not decoration underneath the live one — it is what a reader
   * with no JavaScript, an unsupported browser or a chunk that never arrived
   * sees, so a refactor that "simplified" it away would take the fallback with
   * it.
   *
   * The lead's own provenance line went at the same time, and correctly: the
   * sentence above the panel now describes a round trip in the reader's tab,
   * which is not a thing that was captured. The recording's caption states
   * where it came from, one line under the recording, which is the assertion
   * in "does not overstate the one artefact that exists to not be
   * overstated". */
  assert.match(index, /<DemoConsole>/);
  assert.match(live, /<CarrierPanel \/>/);

  /* And the band still states what it is, positively. It used to reach the
     same claim as a denial — "Not a mock-up" — which hands a reader the doubt
     it then asks them to drop. Both halves are checked, because either one
     alone is weaker than the pair: the heading claims the demo is live, and
     the paragraph names the package that makes it so. */
  assert.match(index, /<h2>Live demo, in your browser<\/h2>/);
  assert.match(index, /the installed SDK encrypts it/);
});

test('stands the demo’s settings in the band’s corner, on the heading’s line', async () => {
  const console_ = await read('../src/components/demo/DemoConsole.astro');
  const index = await read('../src/pages/index.astro');
  const raw = await read('../src/styles/global.css');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  /* "Demo Settings" and not "Settings". The control used to stand over the
     scene, where the scene said what it settled; in the band's own corner the
     bare word could be read as the site's settings. */
  assert.match(console_, /<\/svg>\s*Demo Settings\s*<\/summary>/);

  /* The head is inside the console's root, which is what lets one absolute
     corner serve both. Placed beside it, the distance from the heading to the
     control is however tall the paragraph happened to wrap, and no offset can
     be written for that. */
  assert.match(index, /<DemoConsole>\s*<Fragment slot="head">\s*<h2>/);
  assert.ok(
    console_.indexOf('<slot name="head" />') <
      console_.indexOf('<details class="demo-console-settings"'),
    'the settings control is no longer in the head it is meant to sit in',
  );
  assert.ok(
    console_.indexOf('<details class="demo-console-settings"') <
      console_.indexOf('<div class="demo-console-stage">'),
    'the settings control is back inside the stage, which is a different corner',
  );

  /* Two rows, three boxes: the heading and the control share the first, the
     paragraph takes the second across both columns. The control is pinned to
     row one, because auto-placement would put it wherever the source order
     landed it. */
  const head = ruleFor(css, '.demo-console-head');
  assert.match(head, /display:\s*grid/);
  assert.match(head, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  /* Two rules carry this selector — the cell, and the narrow-width removal
     below — so it is filtered rather than `ruleFor`ed, which throws on the
     pair. */
  const cells = cssRules(css).filter(
    (rule) =>
      rule.selector === '.demo-console-head > .demo-console-settings' &&
      /grid-column:/.test(rule.body),
  );
  assert.equal(cells.length, 1, `${cells.length} rules place the control in the head`);
  assert.match(cells[0].body, /grid-column:\s*2/);
  assert.match(cells[0].body, /grid-row:\s*1/);
  assert.match(cells[0].body, /justify-self:\s*end/);

  /* And it goes where the stage goes. Below 60rem the mobile reel plays on its
     own and there is no run whose terms this could change — it used to inherit
     that from the stage it lived in, and in the head it has to be stated. */
  const hidden = cssRules(css).some(
    (rule) =>
      rule.selector === '.demo-console-head > .demo-console-settings' &&
      /display:\s*none/.test(rule.body),
  );
  assert.ok(hidden, 'the phone is offered settings for an exhibit it cannot see');
  assert.match(raw, /@media \(max-width: 60rem\) \{\s*\.demo-console-head > \.demo-console-settings \{/);
});

test('lands the demo fragment on the exhibit, not on the paragraph above it', async () => {
  const console_ = await read('../src/components/demo/DemoConsole.astro');
  const index = await read('../src/pages/index.astro');
  const raw = await read('../src/styles/global.css');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  /* The fragment names the running thing. On the band it landed the reader on
     the heading with the animation below the fold at every width measured —
     328px down a 664px screen at 390 wide, and still 38px short at 1440x900 —
     and the offset that would fix it is the height of a paragraph that wraps
     differently at every width. */
  assert.match(console_, /<div id="demo" class="demo-console-exhibit">/);
  assert.doesNotMatch(
    index,
    /<section id="demo"/,
    'the band has taken the fragment back, so Demo lands on the heading again',
  );

  /* Both exhibits inside it, because which one is drawn depends on the width
     and the fragment has to land on whichever it is. A wrapper around only the
     wide stage would be `display: none` on a phone, and a fragment pointing at
     a hidden element scrolls nowhere. */
  const open = console_.indexOf('<div id="demo" class="demo-console-exhibit">');
  const close = console_.indexOf('<p class="demo-console-status"');
  assert.ok(open > 0 && close > open, 'the exhibit box is not where the console renders');
  const exhibit = console_.slice(open, close);
  assert.match(exhibit, /<div class="demo-console-stage">/);
  assert.match(exhibit, /<DemoMobile /);

  /* The links that lead there. Both are the reader asking for the exhibit. */
  assert.match(index, /<a class="cta-primary" href="#demo">/);
  const header = await read('../src/components/Header.astro');
  assert.match(header, /href: '\/#demo'/);

  /* And the one rule that stands it clear of the sticky header. This is not a
     legal-page detail: scoping it away would park the scene under the header
     on every press of Demo, with nothing else in the stylesheet to catch it. */
  assert.match(ruleFor(css, ':target'), /scroll-margin-top:\s*calc\(4rem \+ var\(--oe-space-6\)\)/);
});

test('says what the phone’s first reading measured, and breaks its row cleanly', async () => {
  const mobile = await read('../src/components/demo/DemoMobile.astro');

  /* Each label has to answer "what was measured" on its own. The other two do:
     a figure in milliseconds beside "encryption" is the cost of encrypting.
     "generation" beside one does not, whatever the key store above it says,
     because the row is read as a row. */
  assert.match(mobile, /\{ key: 'keygen', label: 'key generation' \}/);
  assert.match(mobile, /\{ key: 'encrypt', label: 'encryption' \}/);
  assert.match(mobile, /\{ key: 'decrypt', label: 'decryption' \}/);

  /* The name costs a line on a phone: 83.3px of the 133 this row has at 390 and
     the 98 it has at 320, so a filled figure cannot share the line. Three rules
     decide where it breaks, and without all three it broke through the name —
     "key" beside the figure and "generation" under it, which reads as two
     readings rather than one. `nowrap` on the name moves the break to the gap;
     `flex-wrap` lets the figure take the second line at all rather than
     overflow; and the auto margin holds it at the right edge, because
     `space-between` puts a lone item on a wrapped line at the start. */
  const styles = mobile.slice(mobile.indexOf('<style>'), mobile.indexOf('</style>'));
  assert.ok(styles.length > 0, 'the component has no style block to read');
  assert.match(ruleFor(styles, '.demo-mobile-reading'), /flex-wrap:\s*wrap/);
  assert.match(ruleFor(styles, '.demo-mobile-reading-name'), /white-space:\s*nowrap/);

  const value = ruleFor(styles, '.demo-mobile-reading-value');
  assert.match(value, /margin-inline-start:\s*auto/);
  assert.match(value, /white-space:\s*nowrap/);
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

  /* `npm test` before a build checks the source contract only. */
  if (!dist) return skipUnbuilt('dist/index.html');

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

  /* And its length comes from that same string. The row solves for a font size
     that fits the panel, and the solution needs the character count — so a
     count typed as a number here, or a constant in the stylesheet, would keep
     the old length through a package rename and either wrap the line again or
     leave it smaller than it has to be, with nothing failing. */
  assert.match(snippet, /--terminal-command-chars: \$\{installCommand\.length\}/);
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
  /* Comments stripped before the check. The rule is about what `render` does,
     and the word appears in prose for an unrelated reason — the phone's status
     bar, which this function also keeps in step. A guard that reads comments
     fails on a note about a different subject and says nothing true. */
  const render = toggle
    .slice(toggle.indexOf('function render'), toggle.indexOf('render(getStoredTheme'))
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
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
   * this breakpoint for measured reasons — the toolbar grew to 152px at 320
   * with them back, while the row still stacked — and the founder's call is
   * that the demonstration is worth the chrome. It costs none now: the row
   * shortens its writing instead of taking a second line, which the test below
   * this one owns.
   *
   * Every rule carrying the selector, because the failure to catch is a second
   * one turning them off again — inside a query or not. Writing this exposed a
   * blind spot in the helper: its regex could not see the first rule inside a
   * media block, so an override written at the top of one counted as zero.
   * `./css-rules.mjs` is a brace walker now, and the mutation that proves this
   * assertion — the rule put back where it was — fails here either way, because
   * the ordering assertion above sees it too. */
  const adapterRules = cssRules(css).filter((rule) => rule.selector === '.code-adapters');
  assert.ok(adapterRules.length >= 1, 'the select group has no rule at all');
  for (const rule of adapterRules) {
    assert.doesNotMatch(rule.body, /display:\s*none/, 'the adapter selects are hidden on a phone again');
  }
  assert.match(adapterRules[0].body, /display:\s*flex/);

  /* The copy button is not on this row at any width, so nothing may push it
   * along one. `margin-inline-start: auto` on `.code-copy` was how it reached
   * the far edge while it lived in the toolbar; the corner it stands in now is
   * absolute, and an auto margin left behind would fight the offsets. */
  const copyMargins = cssRules(css).filter(
    (rule) => rule.selector === '.code-copy' && /margin-inline-start:\s*auto/.test(rule.body),
  );
  assert.equal(
    copyMargins.length,
    0,
    `${copyMargins.length} rules still push the copy button along a flex row it has left`,
  );

  /* And the two comboboxes divide the row rather than keeping their natural
     width, which is what lets them share one line with their names instead of
     wrapping. `flex: 1 1 0` with `min-width: 0` is both halves — the basis is
     what makes the split even, and without the minimum a flex item will not
     shrink below its content at all. Each half is 121px at 320 and 156px at
     390. These are the base rules: the panel drops back to them below the rung
     that gives the selects their natural width, which is the narrow case this
     test is about. */
  const selectRule = cssRules(css).filter((rule) => rule.selector === '.code-select')[0];
  assert.match(selectRule.body, /flex:\s*1 1 0/);
  assert.match(selectRule.body, /min-width:\s*0/);
  assert.match(cssRules(css).filter((rule) => rule.selector === '.code-select select')[0].body, /width:\s*100%/);

  /* The label stays beside its combobox at every width; what gives way is the
     name. Each one is a qualifier plus the word that carries the choice, and a
     panel under 34.5rem drops the qualifier, so "Device Store" reads "Store"
     and "Relay Server" reads "Relay" — 37.2px each, whole, at every width down
     to 320. `nowrap` is the guard on the other way a name can give way: without
     it a squeezed label takes a second line instead of shortening. Which rung
     drops it, and at what measured width, is owned by the test below. */
  const labelRules = cssRules(css).filter((rule) => rule.selector === '.code-select-label');
  assert.equal(labelRules.length, 1, `${labelRules.length} rules style the label`);
  assert.match(labelRules[0].body, /white-space:\s*nowrap/);
  const dropsQualifier = cssRules(css).some(
    (rule) => rule.selector === '.code-select-qualifier' && /display:\s*none/.test(rule.body),
  );
  assert.ok(dropsQualifier, 'nothing drops the qualifier, so the full name has to fit at 320 or wrap');

  /* To the end of the line: each label is written on one, and the nesting means
     a non-greedy match for `</span>` would stop inside it. */
  const labels = (await read('../src/components/HeroSnippet.astro')).match(
    /<span class="code-select-label">.*/g,
  );
  assert.deepEqual(labels, [
    '<span class="code-select-label"><span class="code-select-qualifier">Device </span>Store</span>',
    '<span class="code-select-label">Relay<span class="code-select-qualifier"> Server</span></span>',
  ]);
});

test('puts the example’s copy control in the code’s corner, not among the settings', async () => {
  const component = await read('../src/components/HeroSnippet.astro');
  const raw = await read('../src/styles/global.css');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  /* The toolbar configures the example; the copy button does not configure
     anything. Standing at the end of that row it was the third control a reader
     had to read past to find the two that change the program. */
  const toolbar = component.slice(
    component.indexOf('<div class="code-toolbar">'),
    component.indexOf('<div class="code-body">'),
  );
  assert.ok(toolbar.includes('code-select'), 'the toolbar slice missed the comboboxes');
  assert.doesNotMatch(toolbar, /data-code-copy\b/, 'the copy button is back on the toolbar row');

  /* And it is inside the box that holds still. The `<pre>` is the scroll
     container, so a control positioned against that one rides off the panel
     with the first long line a reader drags sideways. */
  const body = component.slice(component.indexOf('<div class="code-body">'));
  assert.match(body, /<button type="button" class="copy-button code-copy" data-code-copy>/);
  assert.match(cssRules(css).find((rule) => rule.selector === '.code-body').body, /position:\s*relative/);

  const corner = cssRules(css).find((rule) => rule.selector === '.code-body > .code-copy');
  assert.ok(corner, 'nothing puts the copy button in the corner, so it sits in the flow of the code');
  assert.match(corner.body, /position:\s*absolute/);
  assert.match(corner.body, /top:\s*var\(--oe-space-3\)/);
  assert.match(corner.body, /right:\s*var\(--oe-space-3\)/);

  /* Opaque, because it is over the program rather than over a toolbar.
     `.copy-button` is transparent and below 48rem the code scrolls under this
     one, where a transparent chip is a glyph with a border round it. */
  assert.match(corner.body, /background:\s*var\(--oe-editor\)/);

  /* And nothing gives it room. The narrow panel used to push line one down by
     the button's height, which bought a 28px band of empty editor above the
     program on the screens with the least room. Measured with the line flush at
     320, 390 and 430: the control covers four of line one's glyphs at rest, and
     the panel scrolls sideways, so a reader moves them out from under it on the
     drag a 76-character import in a 356px column already costs. A padding-top
     here is that band coming back. */
  const clearances = cssRules(css).filter(
    (rule) => rule.selector === '.hero-snippet .code-body pre' && /padding-top:/.test(rule.body),
  );
  assert.equal(
    clearances.length,
    0,
    `${clearances.length} rules push the program down to clear the button; it floats over the code at every width`,
  );
});

test('keeps the example’s settings on one row, and shortens the writing to hold it', async () => {
  const raw = await read('../src/styles/global.css');
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  /* The row never becomes two. It used to stack the comboboxes under the
     filename below 48rem — 720px of panel, and nothing had stopped fitting:
     measured against the previous rules replayed over this markup, the second
     line gave the comboboxes not one pixel more (75.8 at 320, 95.8 at 360,
     100.8 from 375, in both layouts) and cost 31.2px of height. */
  assert.match(ruleFor(css, '.code-toolbar'), /flex-wrap:\s*nowrap/);
  const stacked = cssRules(css).filter(
    (rule) => rule.selector === '.code-adapters' && /flex-basis:\s*100%/.test(rule.body),
  );
  assert.equal(stacked.length, 0, 'a rule puts the comboboxes on a line of their own again');

  /* Both rungs ask the panel, not the viewport. The toolbar has to fit the box
     it is drawn in, and `.hero-demo` is a container, so a `@media` rule here
     would be measuring the wrong thing — it is right only while the hero's own
     padding and track never move. */
  assert.match(ruleFor(css, '.hero-demo'), /container-type:\s*inline-size/);

  /* Rung one: the qualifiers. "Device Store" and "Relay Server" cost the row
     104.2px over "Store" and "Relay", which the panel has from 34.5rem up. */
  const qualifier = cssRules(css).filter((rule) => rule.selector === '.code-select-qualifier');
  assert.equal(qualifier.length, 2, 'the qualifier is not a hidden default plus one rung');
  assert.match(qualifier[0].body, /display:\s*none/);
  assert.match(raw, /@container \(min-width: [\d.]+rem\) \{\s*\.code-select-qualifier \{\s*display: inline/);

  /* Rung two: the filename, and only inside the toolbar. /product writes
     `.code-filename` on its own, outside any container, where a container query
     never matches — a hidden default on the bare class would leave it hidden
     there for good. */
  assert.doesNotMatch(ruleFor(css, '.code-filename'), /display:/);
  const filename = cssRules(css).filter((rule) => rule.selector === '.code-toolbar .code-filename');
  assert.equal(filename.length, 2, 'the filename is not a hidden default plus one rung');
  assert.match(filename[0].body, /display:\s*none/);
  assert.match(raw, /@container \(min-width: [\d.]+rem\) \{\s*\.code-toolbar \.code-filename \{\s*display: block/);

  /* Both rungs, at the widths they were measured at, and in that order. The
     numbers are read out of the source rather than written into two regexes
     above, so this is the one assertion that fails when either moves. A row
     holding the filename and both short labels needs 444.7px of panel and one
     holding the qualifiers as well needs 548.9px, so a lower rung overflows and
     a higher one gives up writing the panel had room for. The writing goes
     first: a panel narrow enough to drop "quickstart.ts" has already spent the
     cheaper rung. */
  const rung = (selector) => Number(raw.match(new RegExp(`@container \\(min-width: ([\\d.]+)rem\\) \\{\\s*\\${selector}`))[1]);
  assert.equal(rung('.code-toolbar .code-filename'), 28, 'the filename rung moved off its measured width');
  assert.equal(rung('.code-select-qualifier'), 34.5, 'the qualifier rung moved off its measured width');
  assert.ok(
    rung('.code-select-qualifier') > rung('.code-toolbar .code-filename'),
    'the filename goes before the qualifiers do, so the name is dropped while there is still writing to shorten',
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
  assert.match(header, /aria-label="SDK on GitHub"/);
  assert.match(toggle, /Colour theme: <span data-theme-label>/);
  /* The menu's trigger became a drawing too. Its name is a real element and
   * not an `aria-label`, the way the toggle carries its own: the word is the
   * summary's own content, so a reader who turns styles off gets the control
   * back rather than an empty box. */
  assert.match(header, /<span class="oe-visually-hidden">Menu<\/span>/);
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
  const [notices, license, icon, deckIcon, boxMark] = await Promise.all([
    read('../THIRD_PARTY_NOTICES.md'),
    read('../third-party/Octicons-MIT.txt'),
    read('../src/components/Icon.astro'),
    read('../src/components/DeckIcon.astro'),
    read('../src/components/BoxMark.astro'),
  ]);

  /* The MIT license asks for the notice to travel with the copy, and the
   * design system's own rule is that naming a license without shipping it
   * does not satisfy it. The paths are vendored, so this repository owes the
   * text — not a link to it. */
  assert.match(license, /Copyright \(c\) \d{4} GitHub Inc\./);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.match(notices, /third-party\/Octicons-MIT\.txt/);
  assert.match(icon, /THIRD_PARTY_NOTICES\.md/);
  assert.match(deckIcon, /THIRD_PARTY_NOTICES\.md/);

  /* The third copy is one path in one heading, which is exactly the kind of
   * copy that gets deleted, renamed, or swapped for another Octicon without
   * anyone opening the notice file. It is named here rather than derived,
   * because a single-icon component has no list to derive from. */
  assert.match(boxMark, /THIRD_PARTY_NOTICES\.md/);
  assert.match(notices, /`src\/components\/BoxMark\.astro` renders one more, `package`,/);

  /* The second copy is the one that will drift. `Icon.astro` draws a fixed set
   * of chrome and has not changed in months; the deck icons are on a page
   * under revision, and an eighth cell arrives with an eighth icon and no
   * reason for anyone to remember a licence file. So the list is derived from
   * the component rather than written out here: a name the union declares and
   * the notice does not name fails this test at the name that is missing. */
  const declared = [...deckIcon.matchAll(/^ {2}\| '([a-z-]+)';?$/gm)].map((m) => m[1]);
  assert.equal(declared.length, 7, `DeckIconName declares ${declared.length} names`);
  const noticed = notices.slice(notices.indexOf('DeckIcon.astro'));
  for (const name of declared) {
    assert.ok(
      noticed.includes(`\`${name}\``),
      `THIRD_PARTY_NOTICES.md does not name the copied Octicon "${name}"`,
    );
  }
});

test('answers “what does the relay see” in the fixed wording', async () => {
  const [index, security] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/pages/security.astro'),
  ]);

  /* messaging.md §3 fixes one sentence for this question and forbids
   * paraphrasing it into something stronger. The formula and the metadata
   * caveat travel together, or the claim is only half stated. The homepage
   * carried both in its hero until the founder cut that paragraph on
   * 2026-08-09; /security is the page that answers the question now, in its
   * own lead, and this pins it there. The homepage keeps the negative: its
   * hero once answered with "your relay can't read it", which is the exact
   * paraphrase the rule names. */
  assert.match(security, /The relay never needs message plaintext or device private keys\./);
  assert.match(security, /It does need routing\s+metadata/);
  assert.doesNotMatch(index, /relay can(?:’|')t read/i);
});

test('reaches the security review pack from the product page and the footer', async () => {
  const [product, footer] = await Promise.all([
    flat('../src/pages/product.astro'),
    flat('../src/components/Footer.astro'),
  ]);

  /* Both build their links from a data array now, so the path is quoted
   * rather than written as an attribute. The "Check the work" band holding
   * them spent time at the foot of the homepage and moved to /product when the
   * landing page was cut back to the demo, the feature deck, and the licence;
   * it answers "prove it" for a reader who has just read a page of capability
   * claims, which is the page it is on.
   *
   * The destination is /security. It was /evaluate, which asked the questions
   * /security answers and rendered the same pinned specifications from the
   * same module; both surfaces linked to both, so a reader met one body of
   * content under two names. What has to stay true is that the pack is
   * reachable from each surface exactly once — a second entry pointing at the
   * same page under the other name is the defect this replaced. */
  assert.match(product, /href: '\/security'/);
  assert.match(footer, /href: '\/security'/);
  assert.match(footer, /label: 'Security model'/);

  /* Absence is asserted against the link data, not the raw source. Both files
   * carry a comment naming /evaluate to record why the second entry went, and
   * a guard that forbade the word outright would forbid explaining itself —
   * the same reason the relay-formula guards on this page read the rendered
   * output rather than the file. */
  for (const source of [product, footer]) {
    const hrefs = [...source.matchAll(/href: '([^']+)'/g)].map((match) => match[1]);
    assert.ok(!hrefs.includes('/evaluate'), 'a link still points at the folded page');
    assert.equal(
      hrefs.filter((href) => href === '/security').length,
      1,
      'the review pack is reachable more than once under more than one name',
    );
  }
});

test('permanently redirects the folded route to the page that absorbed it', async () => {
  const redirects = await read('../public/_redirects');

  /* The sitemap published https://open-e2ee.dev/evaluate/ to crawlers for as
   * long as the page existed, so deleting the route without a redirect strands
   * a URL search engines already hold. "Pre-launch, no customers" was the first
   * answer here and it was wrong on the facts: a published sitemap entry is an
   * inbound link whether or not a human ever followed it.
   *
   * Both slash forms, because the sitemap used the trailing one and a hand-
   * written link uses whichever it was typed with. The legal folds above set
   * that convention and this follows it rather than inventing a second shape. */
  assert.match(redirects, /^\/evaluate \/security\/ 308$/m);
  assert.match(redirects, /^\/evaluate\/ \/security\/ 308$/m);

  /* And the destination is a route this repo actually has. A 308 to a 404 is
   * worse than the dead route it replaced, because it also tells the crawler
   * the move is permanent.
   *
   * Checked against the page source rather than dist: the source file is the
   * thing that decides whether the route exists, and a source-side guard also
   * holds on an unbuilt tree, where a redirect guard that quietly skips is
   * worth nothing. */
  const destination = await read('../src/pages/security.astro').catch(() => null);
  assert.ok(destination, 'the redirect points at a page this repo does not have');
});

test('sends the folded demo route at a section the homepage still has', async () => {
  const redirects = await read('../public/_redirects');

  /* Same reasoning as /evaluate above, with one difference that needs its own
   * check: this destination carries a fragment. `/security/` is a route, and a
   * route either exists or 404s loudly. `/#demo` is a route plus an anchor, and
   * an anchor that has gone missing fails silently — the homepage serves 200,
   * the browser finds nothing to scroll to, and every reader who followed a
   * /demo link lands at the top of the page instead of the thing they asked
   * for. Nothing else on the site would notice.
   *
   * The route first pointed at the scenarios, which were what the folded /demo
   * page had been. They were cut from the homepage, and this rule is exactly
   * the kind of reference that survives such a cut pointing at nothing. */
  assert.match(redirects, /^\/demo \/#demo 308$/m);
  assert.match(redirects, /^\/demo\/ \/#demo 308$/m);

  /* So the anchor is read out of the rule rather than typed here a second time,
   * and then looked for on the page. A rename that updates one and not the
   * other is the failure this exists for, and hard-coding the id in the
   * assertion would make this guard agree with whichever half was edited last.
   *
   * The id is not on the homepage itself: it is on the exhibit inside the
   * component the homepage renders, argued where it is written. So the search
   * covers the page plus every local component it imports, which is also what
   * keeps this from naming `DemoConsole.astro` and becoming a second place to
   * edit on a move.
   *
   * Comments come out first. The component's own comment opens by quoting
   * `id="demo"` to explain why the id is on the exhibit, and with comments left
   * in, renaming the real attribute passed this guard on that sentence alone —
   * a tombstone standing in for the thing it is a tombstone for.
   *
   * Source rather than dist, so the guard also holds on an unbuilt tree —
   * a redirect guard that skips without a build is worth nothing. */
  const fragment = /^\/demo \/#([a-z-]+) 308$/m.exec(redirects)?.[1];
  assert.ok(fragment, 'the /demo rule no longer targets a fragment');

  const home = await read('../src/pages/index.astro');
  const imports = [...home.matchAll(/from '(\.\.\/components\/[^']+\.astro)'/g)].map(
    (match) => match[1],
  );
  assert.ok(imports.length > 0, 'expected to be scanning the homepage components, found none');
  const rendered = [
    home,
    ...(await Promise.all(imports.map((path) => read(`../src/pages/${path}`)))),
  ]
    .join('\n')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(
    rendered,
    new RegExp(`id="${fragment}"`),
    `_redirects sends /demo to #${fragment}, and nothing the homepage renders has that id`,
  );
});

test('leaves the reviewer a path to the licence the review is for', async () => {
  /* /evaluate linked /licensing and /legal/terms inline. Folding it left this
   * page closing on an enterprise meeting and a quickstart, both of which
   * assume the licence question is already settled — and the reader who gets
   * to the end of the threat model is usually the person it is not settled for.
   *
   * /licensing rather than /pricing: the question at that point is which
   * licence governs, not what a tier costs, and /licensing carries the
   * /legal/terms link itself, so one link restores the whole path.
   *
   * Matched as a whole anchor, label included, rather than on the href alone.
   * The first version of this guard asserted `href="/licensing"` and passed
   * while the close band pointed at /pricing, because the footer links
   * Licensing from every page on the site — it was measuring the layout, not
   * the change.
   *
   * That full-anchor form is also what makes reading the source safe here. The
   * link carries a comment naming both /licensing and /pricing to record the
   * choice between them, and a guard on the bare href would be satisfied by
   * its own explanation; no comment on this page contains the rendered anchor.
   * Source rather than dist, so the guard also runs on an unbuilt tree. */
  const source = await read('../src/pages/security.astro');
  assert.match(source, /<a href="\/licensing">Which licence your product needs<\/a>/);
});

test('states the same assurance figures on every page that states them', async () => {
  /* This walked /security and /evaluate. /evaluate is gone — it rendered the
   * same `specifications` array from the same module, which is what made the
   * two pages a duplicate rather than a pair. The guard is kept rather than
   * folded into the page's other tests because the property it protects is
   * about any page that states a figure, and the next such page has to inherit
   * it: read from assurance.mjs, or do not state the number. */
  const pages = [await flat('../src/pages/security.astro')];

  for (const page of pages) {
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
   * Both figures move with the dependency tree, so neither may be asserted as
   * a hand-typed constant: an assertion that only relates them to each other —
   * "resolved is larger" — is true of the arithmetic and proves nothing about
   * the package. A figure this cheap to check should not be maintained by
   * hand. */
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
  const pages = [await flat('../src/pages/security.astro')];

  for (const page of pages) {
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
  for (const page of pages) {
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

test('paints the phone’s status bar the colour of the page under it', async () => {
  const [layout, init, tokens] = await Promise.all([
    flat('../src/layouts/BaseLayout.astro'),
    read('../public/theme-init.js'),
    read('../node_modules/@open-e2ee/design/packages/design/dist/css/tokens.css'),
  ]);

  /* The canvas as the installed package defines it, light then dark. Both are
     `--oe-canvas`; the second one is the redefinition inside the dark block. */
  const canvases = [...tokens.matchAll(/--oe-canvas:\s*(#[0-9a-f]{6})/gi)].map((m) =>
    m[1].toLowerCase(),
  );
  assert.equal(canvases.length, 2, 'tokens.css no longer defines --oe-canvas twice');
  const [light, dark] = canvases;

  /* Two files restate those hexes and neither can read the token: the metas
     are markup, and `theme-init.js` runs before the stylesheet resolves. So
     the copies are held to the source here. The dark one was `#090806` — the
     light theme's *foreground*, near enough to black to look deliberate and
     5% off the surface it was meant to match. */
  assert.match(
    layout,
    new RegExp(`content="${light}" media="\\(prefers-color-scheme: light\\)"`),
    'the light theme-color meta is not the light canvas',
  );
  assert.match(
    layout,
    new RegExp(`content="${dark}" media="\\(prefers-color-scheme: dark\\)"`),
    'the dark theme-color meta is not the dark canvas',
  );
  assert.match(init, new RegExp(`light: '${light}'`));
  assert.match(init, new RegExp(`dark: '${dark}'`));

  /* The metas answer the *system* preference and this site has its own switch,
     so a reader who chooses dark under a light system would get a cream strip
     above a dark header — which on an iPhone reads as a gap at the top of the
     page rather than as a colour. Both writers exist to close that: the
     resolver rewrites the tags before first paint, and the switch rewrites
     them again on every press. Either one alone leaves a case wrong. */
  assert.match(init, /meta\[name="theme-color"\]/);
  const toggle = await read('../src/components/ThemeToggle.astro');
  assert.match(toggle, /meta\[name="theme-color"\]/);
  /* And the switch reads the live token rather than restating the hexes a
     third time — by the time it runs, the stylesheet has resolved. */
  assert.match(toggle, /getPropertyValue\('--oe-canvas'\)/);
  assert.doesNotMatch(toggle, /#[0-9a-f]{6}/i);

  /* The resolver rewrites tags the parser must already have seen. A blocking
     script in the head runs where it stands, so above the metas its
     `querySelectorAll` would return nothing — and nothing would fail. */
  assert.ok(
    layout.indexOf('src="/theme-init.js"') > layout.lastIndexOf('name="theme-color"'),
    'theme-init.js runs before the theme-color metas it rewrites exist',
  );
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

test('keeps the store-maturity claims matched to the shipped release', async () => {
  const [product, index] = await Promise.all([
    flat('../src/pages/product.astro'),
    flat('../src/pages/index.astro'),
  ]);

  /* The grade a page prints must be the grade the installed release carries.
   * All four stores implement the interface in full and the installed
   * ADAPTERS.md marks none of them experimental, so both pages must say so
   * and no superseded grade may survive anywhere on either page. The
   * positive and the negatives are asserted together because a page that
   * gains the current sentence while keeping an old one still misgrades the
   * release. */
  /* `{' '}` sits between "implement" and the inline <code> element because
   * Astro collapses the newline there; the regex admits it. */
  assert.match(
    product,
    /The Expo, Node, browser, and bare React Native stores implement(?:\{' '\})? <code>ISignalProtocolLocalStore<\/code> in full/,
  );
  assert.match(
    index,
    /The Expo, Node, browser, and bare React Native stores implement the storage interface in full\./,
  );

  for (const [name, source] of [
    ['product.astro', product],
    ['index.astro', index],
  ]) {
    /* The superseded grades must not survive in either page. */
    assert.doesNotMatch(source, /stores? (?:is|are) experimental/, name);
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

test('closes the page on what the licence hands over, not on forking it', async () => {
  const [graph, index, css] = await Promise.all([
    read('../src/components/CommitLine.astro'),
    read('../src/pages/index.astro'),
    read('../src/styles/global.css'),
  ]);

  /* Four commits, and every verb a use. The free-software definition says
   * "change it", which is accurate as a right and wrong as copy here: beside a
   * 0.x version number it reads as an invitation to fix something, and a landing
   * page that asks for repairs is selling a different product. The heading spends
   * the same four verbs, so both move together or this fails. */
  const grants = graph.match(/^const GRANTS = \[(.+)\];$/m);
  assert.ok(grants, 'the graph no longer declares its commits as one list');
  assert.deepEqual(
    grants[1].split(',').map((word) => word.trim().replace(/^'|'$/g, '')),
    ['read it', 'run it', 'share it', 'build on it'],
  );
  assert.match(index, /<h2>Open Source — read, run, share, and build on<\/h2>/);

  /* The shape carries the claim, and two shapes available to a commit graph say
   * something this band must not. A branch peeling off makes taking your own copy
   * the point of the licence; a branch merging back draws a contributor base the
   * project does not have and implies it is waiting on help. Neither the drawing
   * nor its stylesheet may grow one.
   *
   * The comments are stripped first: the component's own comment names both
   * shapes in order to rule them out, and a check that cannot tell a drawing from
   * the reasoning for it fires on the reasoning. */
  const drawing = graph
    .replace(/^---[\s\S]*?^---$/m, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(drawing, /fork|branch|merge|elbow|contribut|patch|change it/i);

  /* The stylesheet block, bounded by its first rule and the next unrelated one.
   * Everything asserted below is about this block and nothing else. */
  const block = css
    .slice(css.indexOf('.commitline {'), css.indexOf('.definition-rows {'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(block.length > 0, 'the commit graph no longer has a block in the stylesheet');
  assert.doesNotMatch(block, /elbow|branch|fork/i);

  /*
   * DESIGN.md's motion contract, which is the part of this a future edit breaks
   * silently. `--oe-duration-*` are transition durations and collapse to 0.01ms
   * under reduced motion; a dwell derived from one plays the whole teaching
   * sequence inside a single frame, with every step technically present and none
   * of them legible. The dwell is therefore a local constant with a literal
   * value, and this is the assertion that keeps it one.
   */
  assert.match(block, /--commitline-beat:\s*[\d.]+m?s;/);
  assert.doesNotMatch(block, /--oe-duration/);

  /*
   * And every animation is gated. Under reduced motion the sequence keeps its
   * steps and drops the transitions between them, which works only while the
   * `animation` declarations are all inside the `no-preference` query — an
   * ungated one would be added next to the rules it belongs with, which is the
   * text before the query opens.
   */
  const gate = block.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.notEqual(gate, -1, 'the graph animates without asking whether motion is wanted');
  assert.doesNotMatch(block.slice(0, gate), /animation/);

  /*
   * The empty state belongs to the script, never to the markup. Authoring the
   * graph hidden and revealing it is the arrangement that ships a blank band to
   * every reader whose JavaScript did not run — which is also every reader whose
   * page threw three components earlier.
   */
  assert.doesNotMatch(drawing, /data-armed|data-playing/);
  assert.match(graph, /root\.dataset\.armed = ''/);
  assert.match(graph, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);

  /* `Icon.astro` and every glyph on this page render `aria-hidden`, and so does
   * the whole graph — its words are the heading's words, so a screen reader that
   * walked it would hear the claim twice, the second time as a list of dots. */
  assert.match(drawing, /<div class="commitline" data-commitline aria-hidden="true">/);

  /* The band states neither licence's terms and routes to the page that owns
   * them, so the route has to survive. `/licensing` carries what AGPLv3 asks
   * of the reader's own application; a band that hands over four things and
   * links nowhere would leave a developer to learn it from a lawyer. */
  assert.match(index, /<a href="\/licensing">Understand AGPLv3 use<\/a>/);
  assert.match(index, /<a href="https:\/\/github\.com\/open-e2ee\/signal-protocol-js">/);

  /* `docs/messaging.md` §4: the tier vocabulary is banned as a rendering of
   * "commercial license", and a band that names both licences is where it would
   * turn up. Comments are stripped for the same reason as above — the one over
   * this band's lead names the banned phrase in order to rule it out. */
  const band = index
    .slice(index.indexOf('Open Source — read, run, share, and build on'))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  assert.doesNotMatch(band, /paid tier|enterprise edition|pro version/i);

  /* The graph makes no claim about encryption, so it carries none of the diagram
   * grammar. A slab or a carrier bracket turning up here would be a licence
   * statement drifting into saying something about the protocol. */
  assert.doesNotMatch(drawing, /--oe-diagram-|class="diagram/);

  /* Order: the graph, the field beside it, then the route to the licence terms.
   * One ordered match rather than compared offsets — `indexOf` returns -1 for a
   * part that is gone, and -1 is less than every real offset, so a deleted link
   * would satisfy a comparison that reads as an order check.
   *
   * This ran to a fourth part, `class="closing"`, a repeat of the hero's action
   * under a rule. The founder cut it, so the licence is the last thing on the
   * page and there is no second ask after it. That is asserted rather than
   * assumed: a restored closing block would land inside this band. */
  assert.match(
    band,
    /<CommitLine \/>[\s\S]+<StarfieldMark \/>[\s\S]+Understand AGPLv3 use/,
    'the graph, the mark and the licence link are no longer in that order',
  );
  assert.doesNotMatch(
    index,
    /class="closing"/,
    'the page ends on a second action again rather than on the licence',
  );

  /* The two figures share a row, and the graph is the one that leads. Source
   * order is what a phone gets — the columns collapse and the figures stack in
   * the order they are written — so the graph coming second here would put the
   * decoration above the claim on every narrow screen. The ordered match above
   * is the pin; this is the arrangement it relies on. */
  const pairRules = cssRules(css).filter((rule) => rule.selector === '.commitline-pair');
  assert.ok(pairRules.length >= 1, 'the two figures no longer share an arrangement');
  assert.match(pairRules[0].body, /display: grid;/);
  assert.doesNotMatch(
    pairRules[0].body,
    /grid-template-columns/,
    'the columns are the wide case and belong behind a query, not in the base rule',
  );

  /* The wrapper around both is still only spacing. The columns live on the pair,
   * so a width step appearing here would be a second arrangement to keep true. */
  const bandRules = cssRules(css).filter((rule) => rule.selector === '.commitline-band');
  assert.equal(bandRules.length, 1, 'the band grew a second arrangement at some width');
  assert.doesNotMatch(bandRules[0].body, /grid|flex|columns/);
});

test('draws three marks from the real artwork and puts every light back', async () => {
  const [mark, marks, css] = await Promise.all([
    read('../src/components/StarfieldMark.astro'),
    read('../src/lib/starfield-marks.mjs'),
    read('../src/styles/global.css'),
  ]);
  const source = mark.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const composition = marks.replace(/\/\*[\s\S]*?\*\//g, '');

  /*
   * The geometry is imported, never transcribed — in the module that owns the
   * composition, and therefore nowhere else. A path pasted into either file is a
   * copy that stops tracking its package the moment either moves, and a
   * hand-drawn approximation of another company's trademark is worse than no
   * mark at all, which is the call `Icon.astro` already makes for the same
   * glyph. Our own lockup is read off disk for a further reason: rebuilding it
   * from `carrierBracketPaths` would mean choosing the parameters, and a wrong
   * arm is a wrong logo that still draws.
   *
   * The literal check is the one that bites: an inlined path is a long run of
   * coordinates, and nothing else in either file looks like one.
   */
  assert.match(composition, /from '@open-e2ee\/design\/icons';/);
  assert.match(composition, /const \[githubPath\] = iconPaths\.github;/);
  assert.match(composition, /open-e2ee-lockup-horizontal-mono\.svg/);
  assert.doesNotMatch(composition, /"M[\d.\-\s,a-zA-Z]{60,}"/, 'a path is transcribed rather than imported');
  assert.doesNotMatch(source, /"M[\d.\-\s,a-zA-Z]{60,}"/, 'a path is transcribed rather than imported');

  /*
   * A silently partial lockup is the failure this composition cannot see for
   * itself: two brackets and no payload, or a mark with no name beside it, still
   * draws. The module therefore parses the shipped file into its three symbol
   * paths and two wordmark runs and throws when it stops being that, which turns
   * a package change into a red build rather than into a wrong logo.
   */
  assert.match(composition, /symbolPaths\.length !== 3 \|\| runs\.length !== 2/);
  assert.match(composition, /throw new Error\(/);

  /*
   * The composition is one lockup over two sources, and it is the lockup that
   * has to read as the larger drawing. It spans the field, so it is wider by
   * construction — but the eye compares one glyph with another, and our symbol
   * losing to the two marks below it would make the band's own logo the smallest
   * thing in it. Measured rather than asserted from the numbers in the file: the
   * symbol is scaled twice, once into the lockup and once into the field.
   */
  const { FIELD_HEIGHT, FIELD_WIDTH, marks: placed, placement } = await import('../src/lib/starfield-marks.mjs');
  assert.deepEqual(
    placed.map((entry) => entry.id),
    ['lockup', 'osi', 'github'],
    'the composition is no longer our lockup over the two sources',
  );
  const lockup = placed[0];
  const symbol = lockup.pieces.find((piece) => piece.kind === 'paths');
  const glyph = 512 * symbol.scale * placement(lockup).scale;
  for (const other of placed.slice(1)) {
    assert.ok(
      glyph > other.width,
      `our symbol draws at ${glyph} units, smaller than ${other.id} at ${other.width}`,
    );
  }

  /*
   * The element's box is the composition's own shape. The marks are laid out
   * from that box rather than drawn into it, so a box of another ratio does not
   * crop the composition — it squashes it, and the lights settle into a lockup
   * that is not the lockup.
   */
  const fieldRule = cssRules(css).find((rule) => rule.selector === '.starfield');
  assert.ok(fieldRule, 'the field lost the box its lights are measured against');
  assert.match(
    fieldRule.body,
    new RegExp(`aspect-ratio: ${FIELD_WIDTH} / ${FIELD_HEIGHT};`),
    `the field's box is not the composition's ${FIELD_WIDTH} by ${FIELD_HEIGHT}`,
  );

  /*
   * `design/DESIGN.md` grants this band one exception to a mark that does not
   * move, and clear space is a condition of it. The lockup's own bottom edge is
   * the floor; the module throws when a source rises above it, so the check here
   * is that the check exists and that the composition currently clears it.
   */
  assert.match(composition, /enters the lockup's clear space/);
  const floor = lockup.y + placement(lockup).height;
  for (const other of placed.slice(1)) {
    assert.ok(other.y >= floor, `${other.id} sits at ${other.y}, inside the clear space above ${floor}`);
  }

  /*
   * The order the field replaces the drawing in is the whole fallback. The mark
   * is authored complete, the script rasterises it to find out where its lights
   * go, and only then sets `starlit` to hide it. Any other order ships an empty
   * box to every reader whose JavaScript did not run, and leaves the field with
   * nothing to measure for the readers whose did.
   *
   * Pinned three ways: the markup carries no state, the stylesheet hides the
   * drawing on `starlit` alone, and `starlit` is set after the sampling pass.
   */
  assert.doesNotMatch(source, /data-starlit=/);
  assert.match(css, /\.starfield\[data-starlit\] \.starfield-mark \{\s*visibility: hidden;/);
  const sampled = mark.indexOf('getImageData');
  const starlit = mark.indexOf("root.dataset.starlit = ''");
  assert.notEqual(sampled, -1, 'the field no longer measures the drawing it replaces');
  assert.ok(starlit > sampled, 'the drawing is hidden before the field has sampled it');

  /*
   * DESIGN.md asks motion to be short and reversible, and a star field is the
   * shape of thing that quietly becomes neither: a loop redrawing an idle field
   * forever keeps a phone's compositor awake for a decoration. The loop asks
   * whether anything is still moving and stops on the frame nothing is, so the
   * only `requestAnimationFrame` that continues it sits inside that decision.
   */
  assert.match(mark, /frame = moving \|\| pointerNear \? requestAnimationFrame\(tick\) : 0;/);

  /* And reversible means the lights land back on the path rather than near it.
   * A light inside the settled threshold is snapped home, so the shape the field
   * comes to rest in is the mark, not a blur of it. */
  assert.match(mark, /light\.x = light\.homeX;\s*light\.y = light\.homeY;/);

  /* Reduced motion drops the whole field and leaves the mark. This figure
   * teaches nothing by moving, so a reader who asked for less movement loses
   * only movement. */
  assert.match(mark, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(mark, /if \(!still\.matches\) \{/);

  /*
   * Its dwell is local. `--oe-duration-*` are transition durations and collapse
   * to 0.01ms under reduced motion, so a constant derived from one would run the
   * entrance inside a single frame. The same reason the graph beside it states
   * its beat as a literal.
   *
   * Against the comment-stripped source: the constants above are commented with
   * the reason they are not tokens, and a check that cannot tell a declaration
   * from the reasoning for it fires on the reasoning.
   */
  assert.doesNotMatch(source, /--oe-duration/);

  /*
   * Neither colour is baked into a light. Both resolve differently in the two
   * themes and the switch in the header can flip with this band on screen, so a
   * light carries only whether it is an accent one and the colours are re-read
   * when the theme attribute changes. A `colour` on the light would paint the
   * field in the old palette until the next resize.
   *
   * All three marks light in the page's own ink, which is also the condition
   * DESIGN.md's exception states: payload, carrier and wordmark alike. OSI's
   * mark keeps its published palette in the page's lead, where it is the
   * licence condition `OsiMark.astro` sets out; here it does not, which that
   * file records as a breach rather than as a policy.
   */
  assert.match(mark, /const readColours = \(\) => \{/);
  assert.match(mark, /attributeFilter: \['class'\]/);
  assert.match(mark, /context\.fillStyle = light\.accent \? accent : ink;/);
  assert.doesNotMatch(composition, /OSI_BODY|OSI_EDGE\b/, 'a mark in the field carries a palette of its own');
  assert.doesNotMatch(source, /fill="#|fillStyle = '#/, 'a light is painted from a literal rather than the page');

  /*
   * The wordmark ships as live text — `DESIGN.md` has a standing TODO to outline
   * it — so the field rasterises text, and text drawn before its family arrives
   * settles the lights into a fallback face and leaves them there. The artwork
   * stays on screen until then, which is the same arrangement as above for the
   * same reason.
   */
  assert.match(mark, /document\.fonts\.load\(face\)/);
  assert.match(mark, /facesReady\(\)\.then\(\(\) => \{/);

  /* The mark is decorative: the band links to the repository in words directly
   * below it, and a second route to one place is a reader wondering what the
   * difference is. */
  assert.match(source, /data-starfield\n\s+data-starfield-field=\{JSON\.stringify\(/);
  assert.match(source, /aria-hidden="true"/);

  /* It says nothing about encryption, so it carries none of the diagram grammar.
   * A slab or a carrier bracket here would be a licence band drifting into a
   * claim about the protocol. */
  assert.doesNotMatch(source, /--oe-diagram-|class="diagram/);
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
  /* The plate reaches this page through `DemoConsole`, which renders it as the
   * live demo's fallback. Every spelling is checked on the other two pages: any
   * one of them puts a plate on a screen that already has a signature device.
   *
   * The demo's own three-column figure is not a second signature device. It
   * draws the relay as an outlined container rather than as the mark, which is
   * the discrimination that keeps this page inside the one-device cap. */
  assert.match(index, /<DemoConsole>/);
  assert.doesNotMatch(index, /<SignatureDiagram \/>/);
  assert.doesNotMatch(index, /import SignatureDiagram/);

  for (const [name, page] of [
    ['security', security],
    ['product', product],
  ]) {
    assert.match(page, /<SignatureDiagram \/>/, `${name} lost the diagram`);
    assert.doesNotMatch(
      page,
      /<(Live)?CarrierPanel \/>|<DemoConsole \/>/,
      `${name} now shares a screen with the plate`,
    );
  }

  /* The caption used to point at the drawing — "inside a device outline" —
   * and would have been left pointing at nothing. */
  assert.doesNotMatch(index, /device outline/);
  assert.match(index, /Keys stay on the devices/);
  /* And the exclusivity claim is made about plaintext, never about ciphertext.
     An "only sees ciphertext" formulation is false on this page's own
     evidence: the panel below prints senderUserId, senderDeviceId and
     serverTimestamp in the clear, so the page would be contradicted by the
     thing it scrolls to. Checked against the source rather than dist, because
     CI runs the tests before it builds and a dist-only guard would never
     run there. */
  assert.doesNotMatch(index, /relay\s+only\s+(?:ever\s+)?sees/i);
});

test('keeps the relay formula out of the absolute, in the drawings too', async () => {
  const [signature, plaintext, scene] = await Promise.all([
    flat('../src/components/SignatureDiagram.astro'),
    flat('../src/components/diagrams/WhoHoldsPlaintext.astro'),
    flat('../src/components/demo/DemoScene.astro'),
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
  for (const diagram of [signature, plaintext, scene]) {
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

  /* The scene is HTML rather than an SVG with two coordinate tables, so it has
   * one relay header and the guarantee is that there is still only one. The
   * failure this is aimed at is a *copy* of the correct string — a responsive
   * variant of the rack, or a second header for the narrow layout — which is
   * how one composition ends up making a promise the other has stopped making.
   * A count, not a `doesNotMatch` on a wrong literal, for that reason. */
  assert.equal(scene.match(/never needs plaintext/g)?.length, 1);

  /* The carrier brackets are the mark. `design/scripts/test.mjs` asserts that
   * `carrierBracketPaths` reproduces the logo path for path, so a bracket that
   * turns up inside a drawing is the wordmark used as an illustration of a
   * device or an envelope. The scene draws both a device and an envelope, which
   * makes it the likeliest place on the site for that to happen. */
  assert.doesNotMatch(scene, /carrierBracket/);
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
  const pages = ['index', 'product', 'security', 'pricing', 'licensing'];
  const descriptions = await Promise.all(
    pages.map(async (page) => {
      const built = await readFile(
        new URL(`../dist/${page === 'index' ? '' : `${page}/`}index.html`, import.meta.url),
        'utf8',
      ).catch(() => null);
      if (!built) skipUnbuilt(`dist/${page === 'index' ? '' : `${page}/`}index.html`);
      return [page, await flat(`../src/pages/${page}.astro`), built];
    }),
  );

  for (const [page, source, built] of descriptions) {
    /* Read the rendered string in preference to the source. A description that
     * interpolates — /pricing quotes the entry price from pricing.mjs rather
     * than typing it — is a prop expression, not a quoted literal, and the
     * source regex saw an empty description where the page ships a correct
     * one. The rendered page is also the more faithful subject: this test is
     * about the sentence that travels alone, and that sentence is the one in
     * the built <meta>, not the expression that produced it. */
    const described =
      built?.match(/<meta name="description" content="([^"]+)"/)?.[1] ??
      source.match(/description=\{?[`"]([^`"]+)[`"]\}?/)?.[1] ??
      '';
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
  assert.match(close, /<a class="oe-button" href="https:\/\/console\.open-e2ee\.dev\/contact\?plan=enterprise">/);
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
   * really guarding against.
   *
   * `100cqi` is excluded from that census and counted on its own below. It is
   * not a rate competing for the same width — it *is* the width, the whole of
   * the container, read so the terminal row can subtract its chrome and solve
   * for a size that fits. Leaving it in the list would mean re-deriving the
   * 1.89 ceiling every time the row's fit term is touched, which is a false
   * coupling: nothing about the code panel's arithmetic changes. */
  assert.deepEqual(
    [...css.replace(/100cqi/g, '').matchAll(/([\d.]+)cqi/g)].map((m) => Number(m[1])),
    [1.8, 2],
    'a cqi length moved or a third appeared; re-derive against the 1.89 ceiling before changing this',
  );

  /* And the two that were excluded are the two the exclusion was written for:
   * the terminal row's fit term, and its restatement inside the phone query. */
  assert.equal(
    [...css.matchAll(/100cqi/g)].length,
    2,
    'a `100cqi` appeared outside the terminal row’s fit term, or one of the two is gone',
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
   * fold, as the since-cut `.hero-objections` was, the missing gap is not
   * visible from any screenshot the loop takes by default. It shipped for
   * exactly one build and ran the hero's two citation rules end to end on a
   * phone.
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
   * maturity caveat and the terms under the primary button: the two places
   * the page states its own limits were the two hardest on it to read. */
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

  /* The clamp is the *preference* term now, not the whole declaration: the
     command's size is `min(preference, fit)`, where the second term solves the
     row against the panel it has to fit inside. The sweep below is about the
     first term, which is what carries the hierarchy — so it is read through the
     wrapper rather than around it, and the fit term is asserted separately. */
  const sizeOf = (selector) => {
    const body = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
    const clamp = body?.match(/font-size:\s*(?:min\(\s*)?clamp\(([\d.]+)rem,\s*([\d.]+)cqi,\s*([\d.]+)rem\)/);
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
   * So the property asserted is the one that actually matters: wherever these
   * two clamps are what run, the command is larger. Evaluating both across the
   * range costs nothing and cannot be fooled by a plausible-looking pair of
   * declarations.
   *
   * "Wherever they run" is doing work in that sentence. Below 48rem the code
   * takes a chosen size and the command takes whichever is smaller of its
   * preference and the width it has to fit — and there the command is the
   * smaller of the two, because at a phone's width it cannot be both one line
   * and the larger type. The block at the end of this test is where that is
   * measured and argued. */
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

  const ruleIn = (body, selector) => body.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1];
  const sizeIn = (body, selector) => {
    const rule = ruleIn(body, selector);
    const rem = rule?.match(/font-size:\s*(?:min\(\s*)?([\d.]+)rem\s*[;,]/);
    return rem ? +rem[1] * 16 : null;
  };

  /* The fit term, which is the same shape of override bug as the one above and
     was found the same way. `min(preference, fit)` written as a bare preference
     drops the fit silently: the row goes back to 403px of command in 270px of
     panel and wraps, and no declaration in the block looks wrong. So every
     place that sets this size has to carry both halves. */
  const fit = /calc\(\(100cqi - var\(--terminal-chrome\)\) \/ \(var\(--terminal-command-chars\) \* 0\.6 \+ 0\.6\)\)/;
  assert.match(ruleIn(stripped, '\\.terminal-line'), fit);

  let paired = 0;
  for (const { condition, body } of blocks) {
    const codeHere = sizeIn(body, '\\.hero-snippet\\.code-block pre');
    const commandHere = sizeIn(body, '\\.terminal-line');
    if (commandHere !== null) {
      assert.match(
        ruleIn(body, '\\.terminal-line'),
        fit,
        `@media ${condition} sets the command's size without the term that fits it to the panel`,
      );
    }
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

  /* And the rendered size, which below the breakpoint is the fit term rather
   * than the preference the loop above compared.
   *
   * This is where the rule this test is named for stops being satisfiable, and
   * saying so is the point of the block. The command is 42 characters of a
   * 0.6em face: one line at 15px needs 378px of text, and a 390px phone offers
   * a 358px panel. "Fits on one line" and "larger than the code under it" are
   * mutually exclusive below about a 500px viewport, at any padding — so the
   * founder's call is that the command fits, and the step it holds above the
   * code is the one it holds everywhere the two can both be had.
   *
   * What is asserted is the arithmetic, against a browser measurement. Chrome
   * is read from the installed tokens rather than restated, so a spacing step
   * that moves fails here instead of quietly re-wrapping the row. */
  const tokens = await read('../node_modules/@open-e2ee/design/packages/design/dist/css/tokens.css');
  const step = (name) => {
    const rem = tokens.match(new RegExp(`--oe-space-${name}:\\s*([\\d.]+)rem`))?.[1];
    assert.ok(rem, `--oe-space-${name} is gone from the installed tokens`);
    return +rem * 16;
  };
  const chrome = 2 + step(3) * 3 + step(4) + 24;
  const chars = 'npm install @open-e2ee/signal-protocol-sdk'.length;
  const fitAt = (container) => (container - chrome) / (chars * 0.6 + 0.6);

  assert.equal(chrome, 78, `the terminal row spends ${chrome}px on chrome; the fit below was solved at 78`);
  assert.ok(
    Math.abs(fitAt(358) - 10.85) < 0.05,
    `the model says ${fitAt(358).toFixed(2)}px at a 390px phone and Chrome measured 10.85px — ` +
      'one of the two moved, so the row may be wrapping again',
  );
  assert.ok(
    fitAt(358) < 15,
    'the command now fits *and* outranks the code at 390 — if that is real the trade above is ' +
      'obsolete and this whole block should be re-derived rather than adjusted',
  );

  /* The other half of solving the size: a row that is taller than its own text
   * has to say where the slack goes. `align-items: baseline` put all of it
   * under the command, because the copy button is 24px of drawing whose
   * baseline the browser synthesises at its bottom edge — measured at 320, 0px
   * above the command and 10.6px below it in a 24px content box, and the gap
   * closes as the fit term grows: 8px at 360, 6.1px at 390, 3.5px at 430, none
   * at desktop where the text is the tallest item. The smaller the command, the
   * further it rode from the middle of the panel it is the only thing in.
   *
   * Asserted as "not baseline" as well as "centre", because this row keeps a
   * flex rule either way and the failure is a value, not a missing property. */
  const terminalRow = ruleIn(stripped, '\\.terminal-line');
  assert.match(
    terminalRow,
    /align-items:\s*center/,
    'the terminal row does not centre its items; at a phone’s font size the command sits at the top of the panel',
  );
  assert.doesNotMatch(
    terminalRow,
    /align-items:\s*baseline/,
    'the copy button has no text, so its synthesised baseline hangs the command off the bottom of a 24px box',
  );

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
  assert.match(heroCode, /bob\.registerHook\("onMessageDecrypted"/);
  assert.match(heroCode, /plaintext, only on Bob's device/);

  /* Registering a hook after `create()` means the subscription has to be
   * started by hand — `client.d.ts` starts it automatically only when a hook
   * was already configured. A snippet that registers and never subscribes
   * shows a receive path that never fires. */
  assert.match(heroCode, /bob\.startRelaySubscription\(\);/);

  /* The receiving client is the one the sender addresses. Two devices in the
   * panel make that checkable where one client and a `"bob"` string could not:
   * a panel that subscribed on `alice` and sent to `"bob"` would print
   * nothing, and would still have passed every assertion above. */
  assert.match(heroCode, /await alice\.send\("bob", /);
});

test('declares what the example uses', async () => {
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

  /* The "Not in this example, and yours to supply" disclosure list that stood
   * under the panel was cut by founder decision on 2026-08-09, with the
   * caption above it. The self-disclosing import specifiers pinned above are
   * what remains of the estimate the list existed to make honest. */
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

test('promises no price it does not show, and links to one that shows them all', async () => {
  const { startupTier, tiers } = await import('../src/data/pricing.mjs');
  const [index, dist, pricingPage] = await Promise.all([
    flat('../src/pages/index.astro'),
    readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(() => null),
    readFile(new URL('../dist/pricing/index.html', import.meta.url), 'utf8').catch(() => null),
  ]);

  /* The landing page names no figure. It once said "at a published price" and
   * printed none, while /pricing had carried the number the whole time, and a
   * fresh reader listed that as one of two go/no-go inputs the page would not
   * give them: "the word 'published' promises a number that is not on the page
   * and not linked". Either half closes it — show the number, or make no
   * promise and link to where the numbers are. The cell does the second, so
   * what has to hold is that the promise stays gone and the link stays good. */
  assert.equal(startupTier.name, 'Startup');
  assert.match(startupTier.price, /^\$[\d,]+$/);
  assert.match(index, /href: '\/pricing'/);

  if (!dist) return skipUnbuilt('dist/index.html');
  assert.doesNotMatch(dist, /at a published price/);
  assert.match(dist, /href="\/pricing"/);

  /* And the page it links to renders every tier, so the link does not lead
   * somewhere that lost the numbers the landing page declines to state. That
   * is what makes the silence safe rather than evasive. */
  if (!pricingPage) return skipUnbuilt('dist/pricing/index.html');
  for (const tier of tiers) {
    assert.ok(
      pricingPage.includes(tier.price),
      `/pricing does not render ${tier.name} at ${tier.price}`,
    );
  }
});

test('quotes the entry price from the module on every marketing page', async () => {
  const { tiers } = await import('../src/data/pricing.mjs');

  /* The landing page was single-sourced and four other surfaces were not, so
   * the module prevented drift on exactly one of the five places the number
   * appeared. /product, /evaluate and /pricing's own meta description each
   * carried their own typed copy, all of them correct, all of them free to go
   * stale independently at the next price change. /evaluate has since folded
   * into /security, which is why the list below names two pages and not three;
   * the sweep further down is what covers the ones nobody thought to list.
   *
   * Reading from the module is asserted on the source rather than the built
   * page because a hard-coded "$5,000" and a rendered `startupTier.price` are
   * byte-identical in `dist` today. That is the whole problem: the defect is
   * invisible in the output until the day someone changes the price. */
  const quoting = ['product', 'pricing'];
  for (const page of quoting) {
    const source = await flat(`../src/pages/${page}.astro`);
    assert.match(
      source,
      /startupTier\.price/,
      `/${page} does not read the entry price from pricing.mjs`,
    );
  }

  /* And no page reintroduces a typed figure. Comments are stripped first: a
   * comment does not render, so a figure inside one cannot drift on the page,
   * and a guard that fired on the prose explaining the rule would be deleted
   * by the next person who hit it. */
  const strip = (text) => text.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ');

  /* Recursive, with the exemption named rather than implied. The first version
   * called `readdir` without recursion and so covered the top level only, which
   * happened to exclude src/pages/legal/ — the one directory that must be
   * excluded. A guard that gets the right answer because it never looked is
   * indistinguishable from one that looked and decided, right up until someone
   * adds src/pages/solutions/ and it silently stops covering that too. */
  const marketingPages = [];
  const walk = async (dir) => {
    for (const entry of await readdir(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (`${dir}${entry.name}/` === '../src/pages/legal/') continue;
        await walk(`${dir}${entry.name}/`);
      } else if (entry.name.endsWith('.astro')) {
        marketingPages.push(`${dir}${entry.name}`);
      }
    }
  };
  await walk('../src/pages/');
  assert.ok(marketingPages.length > 5, `expected to walk the pages, found ${marketingPages.length}`);

  for (const page of marketingPages) {
    const body = strip(await read(page));
    for (const tier of tiers) {
      if (tier.price === 'Free') continue;
      assert.ok(
        !body.includes(tier.price),
        `${page} hard-codes ${tier.price}; read it from pricing.mjs instead`,
      );
    }
  }

  /* And the exemption is real: a sweep that reported nothing in the legal tree
   * would mean the walk had missed the figure rather than that it was clean.
   * The page itself is a two-line delegation — src/pages/legal/terms.astro
   * renders <CommercialTerms canonical="/legal/terms" /> — so the figure lives
   * in the component, and that is what has to still carry it. */
  assert.match(await read('../src/pages/legal/terms.astro'), /CommercialTerms/);
  assert.match(await read('../src/components/CommercialTerms.astro'), /\$[\d,]+ per year/);

  /* The legal pages are deliberately outside that sweep. /legal/terms and its
   * frozen versioned copies state the fee as executed contract language, and a
   * contract that re-prices itself when a marketing constant moves is a worse
   * defect than the drift this module exists to stop.
   *
   * So the assertion here is the opposite of the one above, and it is
   * deliberately not `terms.includes(startupTier.price)`. Tying the contract
   * to the live constant would mean the next price rise turns this green test
   * red until someone edits executed terms to match a marketing number — the
   * precise coupling the exemption exists to prevent. What has to stay true is
   * that the terms state a fee of their own and never read this module. */
  const terms = await read('../src/components/CommercialTerms.astro');
  assert.match(terms, /\$[\d,]+ per year/);
  assert.doesNotMatch(terms, /startupTier|pricing\.mjs/);
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
  if (!dist) return skipUnbuilt('dist/index.html');

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
  if (!dist) return skipUnbuilt('dist/index.html');

  /* Every number this page prints is one it can show its working for: the
   * ciphertext lengths are read off the recording, the version comes from the
   * capture, the date is stamped by the build, and "ten minutes · two clients"
   * describes the quickstart it links to. One clause broke the rule — "the
   * work teams usually discover three months in" — and two fresh readers
   * caught it independently in the same wave, one calling it an unsourced
   * vendor line and one "a made-up number in a page that is otherwise
   * scrupulous about sourcing". There are no teams to have measured it on:
   * this is a pre-launch 0.1.x with no users, so the sentence was borrowing
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
   * both the approved vocabulary (`messaging.md` §4) and the more precise of
   * the two: nothing in that relay is a test double, and a reader who
   * discounts the exhibit as mocked has discounted real ciphertext. What it
   * simulates is the infrastructure, and that is the part the sentence has to
   * keep admitting. */
  assert.match(panel, /recorded by running the quickstart/);
  assert.match(index, /against the in-memory relay/);
  /* Absence is asserted against the rendered page, not the source: the comment
   * recording *why* the adjective went has to be free to quote it. */
  if (!dist) skipUnbuilt('dist/index.html');
  if (dist) {
    assert.doesNotMatch(dist, /real round trip/);
    assert.match(dist, /recorded by running the quickstart/);
  }

  /* And the runtime cell no longer denies a build step in the sentence that
   * requires one. "No native crypto module to link" is scoped to the protocol
   * code, which is the scope docs/messaging.md §5 uses for the same claim;
   * SQLCipher needs a development build however it is generated, and
   * local/store/expo/README.md says so outright.
   *
   * The scoping is what this pins. The cell also stated the SQLCipher limit
   * for several rounds and the founder cut it; the denial is what the guard
   * was built against, and a page that never claims "no prebuild step" is not
   * denying anything. /product states the limit and pins it there. */
  assert.match(index, /protocol code is pure TypeScript with no native crypto module/);
  if (dist) assert.doesNotMatch(dist, /no prebuild step/);
});

test('does not deny a build step in the /product lead the page later explains', async () => {
  const [source, dist] = await Promise.all([
    flat('../src/pages/product.astro'),
    readFile(new URL('../dist/product/index.html', import.meta.url), 'utf8').catch(() => null),
  ]);

  /* The landing page was scoped and /product was not, so the site contradicted
   * itself across two pages and /product contradicted itself within one: the
   * lead promised "No native modules. No prebuild step." and the storage
   * section 100 lines below documented expo-sqlite with SQLCipher, which Expo
   * Go does not carry. The lead now borrows the landing page's approved
   * scoping instead of a third phrasing, because appending the limit to the
   * unqualified claim was tried twice and read as a contradiction both times.
   *
   * The reconciliation stays where it was. This asserts the lead stops
   * denying it, not that the explanation moved up. */
  assert.match(source, /protocol code is\s*pure TypeScript with no native crypto module/);
  assert.match(source, /needs a development build rather than Expo Go/);
  assert.match(source, /SQLCipher requires a development build/);

  if (!dist) return skipUnbuilt('dist/product/index.html');
  assert.doesNotMatch(dist, /No native modules\. No\s*prebuild step\./);
  assert.match(dist, /needs a development build rather than Expo Go/);
});

test('names the cost of E2EE in the deck that lists the benefits', async () => {
  const index = await flat('../src/pages/index.astro');

  /* Nine fresh readers, and the two who reached the same omission reached it
   * from opposite directions: one asked how disputes and fraud review work
   * once the backend cannot read anything, the other that support messages
   * under E2EE cannot be produced under subpoena or supervised — "the page
   * never names the tradeoff, not to solve it, not even to acknowledge it
   * exists." A deck of benefits that omits the one cost every evaluator finds
   * in the first meeting reads as concealment on a page whose whole argument
   * is inspectability.
   *
   * The band was titled "and what it costs you to find out" and its lead sent
   * the reader to the cost before anything else. Both are gone: a deck states
   * what the product does, and a title that bills the reader for reading it
   * frames seven capabilities as a charge. What the guard protects is the
   * cost itself, which is still here, written as the property it follows
   * from rather than as a loss — so the pins move to the new wording and the
   * count of them does not drop.
   *
   * The cell then took a second job on the founder's call: it leads with the
   * relay that ships, and the cost follows from what that relay holds. The
   * title is no longer where the cost lives, so the pin on it is gone rather
   * than repointed — a title pin here would fail on the next founder edit
   * without protecting anything. What is pinned is the sentence, which is the
   * thing docs/messaging.md §1.2 requires to travel with the offer. */
  assert.match(index, /all your backend can leak and all it can produce for a legal request/);
  /* The list opens a sentence in one draft and closes one in the next, so the
   * first letter is the one character of this pin that carries no meaning. */
  assert.match(
    index,
    /[Ss]earch, moderation, and restoring a user who has lost every device stay yours to design/,
  );

  /* The lead has to keep counting the cells, including the one that argues
   * against the product. A seventh cell under a lead that says six is the
   * same species of drift the carrier panel already paid for. The heading is
   * pinned alongside it because both were rewritten in one pass, and a count
   * pinned on its own would survive the band losing its name. The mark is in
   * the same pin because it is positional: a box reads as this heading's last
   * word, and one moved to the front of the line is a bullet. */
  const cells = index.match(/title: '/g) ?? [];
  assert.equal(cells.length, 7, `differentiator count changed to ${cells.length}`);
  assert.match(index, /Seven things that are true the first time you install it/);
  assert.match(index, /<h2>What ships in the box<BoxMark \/><\/h2>/);

  /* Sending the wrong reader away is the point, not a hedge to be softened
   * later: the objective is qualified starts, and a team that needs
   * server-side moderation costs more to disappoint after the quickstart. What
   * carries that now is the sentence pinned above and nothing else. The cell
   * used to close on what to do instead — encrypt in transit and at rest — and
   * on the device-to-device transfer the recovery case is built from, and both
   * are gone from the page rather than moved to another one. Neither is
   * pinned here as an absence: they are candidates for the architecture post,
   * and a
   * `doesNotMatch` would make putting one back a test failure. */
  /* Every cell carries an icon, and the type is what makes that true at build
   * time — `icon` is required on `Differentiator`, so a cell added without one
   * does not compile. What a type cannot say is that the icon column exists at
   * all: the field could be declared, populated seven times, and never
   * rendered, which is a whole column of drawings the page never asks for. So
   * the binding is pinned, and the count of icons is checked against the count
   * of cells above rather than against a literal seven, which would need
   * editing in two places for the same change. */
  const icons = index.match(/icon: '[a-z-]+',/g) ?? [];
  assert.equal(icons.length, cells.length, `${icons.length} icons for ${cells.length} cells`);
  assert.match(index, /<DeckIcon name=\{item\.icon\} \/>/);
  assert.match(index, /<ul class="rows rows-iconed">/);

  /* The cost cell spans both columns, which is the only reason its body has
   * room to lead with the relay and still carry the limit. Three things have
   * to hold together for that and each can be lost on its own: the flag on
   * the cell, the binding that turns it into a class, and the rule that makes
   * the class mean something. A flag with no rule is a plain row that reads as
   * a narrow strip of text beside half an empty grid line, and nothing else on
   * the page would fail. */
  assert.match(index, /wide: true,/);
  assert.match(index, /class=\{item\.wide \? 'row-wide' : undefined\}/);
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');
  assert.match(css, /\.rows > \.row-wide \{\n {2}grid-column: 1 \/ -1;/);

  /* An assertion here pinned the lead sentence "Not a hosted chat service,
   * and more than TLS". The lead stopped carrying that sentence when it became
   * the three marks, and the pin kept passing against a comment in the
   * hero-objections block that quoted it — the vacuous-gate failure this suite
   * documents twice. Cutting that block on 2026-08-09 exposed the vacancy, so
   * the pin is gone rather than repointed: the copy it protected had already
   * left the page. */

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
  const leadPage = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8').catch(
    () => null,
  );
  if (!leadPage) skipUnbuilt('dist/index.html');
  const leadSource = leadPage?.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1];
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
     * may use the short form only while the page names the subject the
     * adjective is approved of. That is a condition on the phrase, not a
     * requirement to use it: a lead that drops the phrase owes nothing, and
     * this used to pin one exact sentence and would have failed the next two
     * times the lead was rewritten while the claim it guards stayed true.
     *
     * What the condition is has moved once. It was the storage exception —
     * "needs a development build rather than Expo Go" — for as long as the
     * runtime cell carried that clause, and the founder cut the clause on
     * 2026-08-16. The scoping is the part §5 actually approves and the part
     * that survived, so the guard follows it rather than following a sentence
     * off the page; the exception itself is on /product and pinned there.
     *
     * The scoping is checked on the built page, in the block below. */
    if (/pure TypeScript/i.test(lead)) {
      const built = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
      assert.match(
        built,
        /protocol code is pure TypeScript with no native crypto module/,
        'the lead claims pure TypeScript and the page no longer scopes the claim',
      );
    }
  }

  /* The hero's "Why not just TLS?" paragraph was cut by founder decision on
   * 2026-08-09. The lead still names the alternative — "more than TLS",
   * pinned above — and the negative below survives the cut: whatever the page
   * says about a breached relay, docs/positioning.md §5's hedge is "can
   * limit", and a stronger verb is the exact overclaim that section exists to
   * stop. */
  assert.doesNotMatch(index, /(prevents|stops|eliminates) (a )?breach/i);

  /* The lead used to signpost the disqualifier — "Read What you give up
   * first" — because the round before that had teased it without naming it.
   * The lead no longer opens on it at all: a deck of seven capabilities that
   * starts by sending the reader to the one thing the product cannot do reads
   * as a warning. What has to survive is the anchor, because the cell is the
   * one deep link on this page that a reader is given by someone else. Every
   * cell is addressable through the same `item.id`, so the pin is on the id
   * and on the binding that renders it, not on a sentence pointing at it. */
  assert.match(index, /id: 'your-relay-holds-ciphertext'/);
  assert.match(index, /<li id=\{item\.id\}/);

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
  if (!dist) skipUnbuilt('dist/index.html');
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
    /* The subject that scopes "pure TypeScript" in the lead. Asserted here
     * rather than only beside the runtime cell, because the two are one claim
     * split across a screen: the lead is allowed its short form precisely
     * while this is on the same page. It named the storage exception until the
     * founder cut that clause from the cell; the scoping is what §5 approves
     * and what the page still carries, and /product holds the exception. */
    assert.match(dist, /protocol code is pure TypeScript with no native crypto module/);
    /* The demo caption had the same collision and the worse placement — it
     * stands directly over the recorded row. Two assertions here pinned the
     * sentence that fixed it, "Everything in between is ciphertext"; the
     * founder rewrote the caption and it says the same thing in other words,
     * so pinning the wording again would only buy the next rewrite a red. The
     * rule survives as the sweep below, which is what actually holds: on the
     * whole visible page, "sealed" may only appear as "sealed sender". */
    /* The feature band still names the real one, which is the whole reason
     * the loose sense had to go. "sealed" may reach a reader on this page only
     * as part of "sealed sender".
     *
     * Read against the text a reader sees rather than against the whole
     * document. The rule is about a word landing on someone's eye — three
     * readers stopped on it — and the demo's markup carries `data-sealed`,
     * `demo-toggle-sealed-sender` and a `sealedSender` key in its script, none
     * of which any reader will ever read. Scanning the raw HTML would put this
     * guard in the position of forbidding attribute names, which would end
     * either in a pile of exemptions or in someone renaming a data attribute
     * to satisfy a copy rule. Tags, scripts and styles come out; what is left
     * is the claim. */
    const visible = dist
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    assert.match(visible, /sealed sender/);
    for (const m of visible.matchAll(/sealed(?!\s+sender)/g)) {
      assert.fail(
        `"sealed" used loosely at index ${m.index}: ${visible.slice(m.index - 60, m.index + 40)}`,
      );
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
  if (!built) return skipUnbuilt('dist/index.html');
  if (!/class="osi-mark"/.test(built)) return;

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

  /* The permission itself. The GNU Affero General Public License version 3 is
   * on OSI's approved list; the mark is allowed here because the page says the
   * SDK is under it. Matched on the licence rather than on any one sentence,
   * because four different sentences on this page have carried it and any of
   * them discharges this. Both renderings satisfy the condition and both are
   * matched: `docs/messaging.md` §4 makes AGPLv3 the prose form and leaves the
   * SPDX identifier in place where a licence field or a legal clause names it,
   * and OSI's condition is about the licence, not about its spelling. */
  assert.match(
    built,
    /AGPLv3|AGPL-3\.0/,
    'the OSI mark is permitted only on a page that promotes an OSI-approved licence',
  );

  /* The palette is a condition — "never stray from the color palette" — so the
   * mark's own colours are literals rather than tokens, and this is the guard
   * against a well-meant sweep replacing them with `currentColor` or
   * `--oe-muted` the way every other mark on this site is drawn. The closing
   * band's star field draws this same artwork and does exactly that, at the
   * founder's direction, so the lead is now the only instance that honours the
   * condition and the only one this guard can hold. It reads the module the
   * artwork moved to, and then that the component draws from it — either half
   * alone would pass with the mark painted from something else. */
  const [artwork, mark] = await Promise.all([
    readFile(new URL('../src/lib/osi-artwork.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/OsiMark.astro', import.meta.url), 'utf8'),
  ]);
  assert.match(artwork, /OSI_BODY = '#3DA639'/i, 'the OSI mark must be drawn in an OSI palette colour');
  assert.match(artwork, /OSI_EDGE = '#1E531D'/i, 'the OSI mark must keep its palette outline');
  assert.match(mark, /fill=\{OSI_BODY\}/, 'the mark in the lead no longer takes the OSI palette');
  assert.match(mark, /stroke=\{OSI_EDGE\}/, 'the mark in the lead no longer takes the OSI outline');
  assert.match(
    built,
    /fill="#3DA639"/i,
    'the built page draws the OSI mark in something other than its palette',
  );

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
  if (!built) return skipUnbuilt('dist/index.html');
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
  if (!built) return skipUnbuilt('dist/index.html');
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

/* A test here — "says whether the adapters ship, wherever it says they are
 * yours" — pinned the hero's disclosure list: "yours to supply", the four
 * shipped adapter names, and the relay definition. The founder cut that list
 * on 2026-08-09, so the pins went with the copy they protected; the dist-side
 * rewrite of the same test that landed in parallel (the build-before-test
 * change) asserted the same cut copy on the rendered page, and was deleted in
 * the merge for the same reason, its skipUnbuilt call with it. The four
 * adapter names are still on the built homepage inside the hero program, and
 * the identifier resolver the test also asserted is still exercised by the
 * build audit itself (`scripts/audit-build.mjs` resolves page identifiers
 * against the installed package on every build). */

test('states store maturity as an implementation fact, not a grade', async () => {
  const [index, product] = await Promise.all([
    flat('../src/pages/index.astro'),
    flat('../src/pages/product.astro'),
  ]);

  /* When the page carried an experimental split, five fresh readers split
   * two ways on the unqualified sentence — some read "experimental" as a
   * grade on the runtime itself, others reconstructed the right answer by
   * elimination — so the caveat learned to name both sides in checkable
   * implementation terms. No store is experimental now, and the caveat keeps
   * the same discipline with one side: it states what the stores implement,
   * which is a checkable fact about the installed package rather than a grade
   * a reader has to interpret. The negatives keep a grade word from drifting
   * in anywhere on the page. */
  assert.match(
    index,
    /The Expo, Node, browser, and bare React Native stores implement the storage interface in full\./,
  );
  assert.doesNotMatch(index, /stores are (complete|production-ready|stable|ready)/i);
  assert.doesNotMatch(index, /stores? (?:is|are) experimental/);
  /* The sibling page carries the same fact in interface terms. */
  assert.match(product, /The Expo, Node, browser, and bare React Native stores implement/);
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
   * landing page is inventing a commercial model.
   *
   * The hero maturity line's "Free under AGPL-3.0; commercial licence" clause
   * was cut with the rest of that line on 2026-08-09. The licence cell in the
   * feature band is the homepage's statement now, and it is the fuller one —
   * it quotes the entry price from the same module /pricing renders. */
  assert.match(index, /The complete SDK is free under AGPLv3/);
  assert.match(index, /link: \{ href: '\/pricing', label: 'See the tiers' \}/);
  assert.match(pricing, /Free under AGPLv3\./i);

  /* The tier copy and the prices moved out of this page and into
   * src/data/pricing.mjs, so that the landing page could quote the entry
   * price from the same source instead of describing it. The assertions
   * follow the data rather than the file it used to live in. */
  const { tiers } = await import('../src/data/pricing.mjs');
  /* Was /You run your own infrastructure/. The free column states the
   * obligation that disqualifies a reader from it rather than a benefit, so
   * this follows the trigger sentence. positioning.md §3 makes that friction
   * the qualification funnel, and it is the one fact the tier owes. */
  assert.ok(
    tiers.some((tier) => /applications offered over a network/i.test(tier.detail)),
    'the AGPLv3 tier no longer states the network-use trigger',
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

test('names the licence AGPLv3 wherever the site is not quoting an identifier', async () => {
  /* `docs/messaging.md` §4: AGPLv3 is the prose rendering. The bare word is
   * what the rule is against — it names a licence family rather than a version,
   * and the family has three versions with different obligations.
   *
   * The SPDX identifier is not prose and passes: `AGPL-3.0-or-later` is what
   * `package.json` declares, and `AGPL-3.0-only` is libsignal's grant on the
   * comparison table, where the difference from ours is the point of the row.
   * So this matches the word with no version after it, in either rendering.
   *
   * /legal is excluded because a contract defines its own terms. The commercial
   * terms name the licence in full — "Affero General Public License, version 3
   * or later (AGPL-3.0-or-later)" — and then use the short form the way a
   * defined term is used. Rewriting a defined term to match a marketing rule is
   * an edit to an instrument, and this project keeps executed instruments as
   * they were executed.
   *
   * On the built pages rather than the sources, because the sources carry
   * comments — this one included — that quote the banned form in order to rule
   * it out, and a source-side sweep would fail on its own reasoning. */
  const distDir = new URL('../dist/', import.meta.url);
  let pages;
  try {
    pages = (await readdir(distDir, { recursive: true })).filter((name) => name.endsWith('.html'));
  } catch {
    skipUnbuilt('dist/');
    return;
  }

  const offenders = [];
  for (const page of pages) {
    if (page.startsWith('legal/')) continue;
    const text = (await readFile(new URL(page, distDir), 'utf8'))
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ');
    for (const hit of text.matchAll(/.{0,40}\bAGPL\b(?!-3\.0).{0,40}/g)) {
      offenders.push(`${page}: …${hit[0]}…`);
    }
  }

  assert.deepEqual(offenders, [], `the licence is named without its version:\n${offenders.join('\n')}`);
});

/* A test here — "points at the documentation it says it has" — pinned the
 * hero's "we document exactly what" link to /security. The founder cut that
 * paragraph on 2026-08-09, so the pin went with the copy. The trust-links band
 * that reached /security is on /product now, and the guard for it is "reaches
 * the security review pack from the product page and the footer" above. */

/*
 * The platform strip claims a support matrix. These check it against the
 * installed package rather than against the sentence someone remembered.
 *
 * Both tests below exist because two claims about this strip shipped wrong in
 * the round that added it. The caveat under it said "Expo and Node are the
 * complete ones" — the phrasing the since-cut maturity line explicitly
 * rejected — and it got past the guard on that sentence because the guard
 * pinned a literal string rather than the fact. A claim about what ships
 * should be checked against what ships.
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
  /* An empty `marked` is a legitimate state — the SDK currently marks no
     store experimental — so emptiness cannot double as drift detection. The
     anchor-integrity check is separate: every graded store's module path must
     still appear in ADAPTERS.md, or the document has been restructured out
     from under the path regex and `marked` could be silently empty for the
     wrong reason. */
  for (const path of ['local/store/expo', 'local/store/node', 'local/store/web', 'local/store/react-native']) {
    assert.ok(doc.includes(path), `${path} is missing from ADAPTERS.md — the anchor has drifted`);
  }

  /* This checked the platform strip's inline `(experimental)` qualifiers until
   * the founder removed them, then the hero maturity line until the founder
   * cut that too (2026-08-09). The quickstart caveat under the feature band is
   * the sentence that grades the stores now, and the Store selector labels
   * any experimental store at the moment a reader picks one — so the gate
   * moved to that sentence rather than dying with the markup it happened to be
   * pointing at. What it is really for is unchanged: no test read ADAPTERS.md
   * before this one, so "which stores are experimental" was pinned only to a
   * string someone had copied by hand.
   *
   * `store → the word the page uses`, written out because this is the only
   * place the two vocabularies meet: `web` is the site's "browser" (lower-case,
   * because the word now sits mid-sentence on the cleared side), and
   * `react-native` is the bare one, which is why Expo is separate rather than a
   * flavour of it. `mock` is a development adapter and is not a platform the
   * page grades at all. */
  const pageWord = { expo: 'Expo', node: 'Node', web: 'browser', 'react-native': 'React Native' };
  const graded = Object.keys(pageWord);
  for (const store of marked) {
    assert.ok(pageWord[store], `ADAPTERS.md marks ${store}, which the page has no word for`);
  }

  /* The sentence that grades them: the side that implements the storage
     interface in full, then — only while a store carries the marker — the
     side that is experimental. The experimental clause is optional in the
     regex because no store carries the marker now and the caveat has one
     side; each subject may be singular or plural, so a graduation or a new
     marker does not break the anchor. Matching is case-insensitive because
     the caveat says "browser" mid-sentence where the strip says "Browser". */
  const line = index.match(
    /The ([^.]*?) stores? implements? the storage interface in full\.(?: The ([^.]*?) stores? (?:is|are) experimental\.)?/,
  );
  assert.ok(line, 'the quickstart caveat no longer states store maturity in the expected shape');
  const [, complete, experimental = ''] = line;
  assert.ok(
    marked.size === 0 || experimental !== '',
    'ADAPTERS.md marks a store experimental but the caveat has no experimental clause',
  );
  const carries = (side, word) => side.toLowerCase().includes(word.toLowerCase());

  for (const store of graded) {
    const word = pageWord[store];
    const side = marked.has(store) ? experimental : complete;
    const wrongSide = marked.has(store) ? complete : experimental;
    assert.ok(carries(side, word), `${word} is not on the ${marked.has(store) ? 'experimental' : 'stable'} side`);
    assert.ok(!carries(wrongSide, word), `${word} is on both sides of the experimental split`);
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
     row headed "Built for" is the API; the same word under "Integrations",
     "Powered by", or "Partners" — or under no heading at all — is a vendor
     claim. So the heading is held to an allowlist of compatibility framings
     rather than to one string: rewording within the list is free, and adding to
     the list is the moment to re-decide whether the bare name still reads as a
     protocol.

     "Built for" is on the list because it is a claim about this SDK and not
     about the other party: it says what the adapters were written against,
     where "Works with" said something about the two of them together. */
  const strip = await read('../src/components/PlatformStrip.astro');
  const heading = strip.match(/class="platform-label">([^<]*)</)?.[1];
  assert.ok(heading, 'the strip no longer has a heading over the marks');
  assert.match(
    heading,
    /^(Works with|Compatible with|Built for)$/,
    `"${heading}" over an entry named "S3" reads as an integration the SDK does not have`,
  );

  /* And that the export the entry stands for is really there. */
  assert.ok(manifest.exports['./remote/object-store/s3'], 's3 object store export is gone');
});

test('takes the platform row down to two rows on a phone by sizing it, not by hiding it', async () => {
  const css = (await read('../src/styles/global.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const strip = ruleFor(css, '.platform-strip');

  /* Seven entries at the desktop's mark and name sizes need 413px for the four
     runtimes alone, against 358px of page at 390 — a wrap inside the first
     cluster and a third row under it. The four values below are what make the
     same seven fit two rows down to 320, measured at 320, 360, 390 and 430.

     Asserted as a range each rather than as a number, because the numbers are
     a ladder someone will re-walk. What must not come back is a fixed size:
     that is the shape the defect had. */
  for (const property of [
    '--platform-mark-size',
    '--platform-name-size',
    '--platform-gap',
    '--platform-entry-gap',
  ]) {
    assert.match(
      strip,
      new RegExp(`${property}:\\s*clamp\\([^;]*vw[^;]*\\)`),
      `${property} no longer scales with the viewport, so the row is one size at every width again`,
    );
  }

  /* And the three places that spend them. A declaration that goes back to a
     literal is the whole failure: nothing breaks, the row just wraps again on
     the devices the clamps were added for. */
  assert.match(ruleFor(css, '.platform-marks svg'), /width: var\(--platform-mark-size\)/);
  assert.match(ruleFor(css, '.platform-marks svg'), /height: var\(--platform-mark-size\)/);
  const entry = ruleFor(css, '.platform-cluster > ul > li');
  assert.match(entry, /font-size: var\(--platform-name-size\)/);
  assert.match(entry, /gap: var\(--platform-entry-gap\)/);
  assert.match(
    ruleFor(css, '.platform-marks, .platform-cluster > ul'),
    /gap: var\(--oe-space-2\) var\(--platform-gap\)/,
  );

  /* The names stay. Dropping them is the other way to make the row fit and it
     turns a compatibility list into a partner wall — the labels are what carry
     the precision the marks cannot, and the test above this one holds the
     heading over them to the same standard. */
  assert.doesNotMatch(css, /\.platform-cluster > ul > li span \{[^}]*display:\s*none/);
});

/*
 * Every handwritten file of the demo, for the vocabulary rules below.
 *
 * The two roots are the whole demo. `index.astro` is deliberately not swept: it
 * holds one paragraph of lead, and sweeping it would bring the demo's
 * vocabulary rules to the whole marketing page, which is a different decision
 * than these tests make.
 */
async function demoSources() {
  const roots = ['../src/lib/demo/', '../src/components/demo/'];
  const sources = [];
  for (const root of roots) {
    const dir = new URL(root, import.meta.url);
    for (const name of await readdir(dir, { recursive: true })) {
      if (/\.(?:ts|astro|mjs)$/.test(name)) sources.push([root + name, new URL(name, dir)]);
    }
  }

  /* A glob that quietly matched nothing would pass every caller forever. The
     floor is the tree's measured size — 20 files on 2026-08-16, after the
     failure scenarios and their renderer left — rather than a loose lower
     bound. Adding a file keeps this passing; losing one is what it is for. */
  assert.ok(
    sources.length >= 20,
    `expected the whole demo source tree, found ${sources.length} files`,
  );
  return sources;
}

/** Every line of `sources` a pattern matches, labelled for the failure message. */
async function linesMatching(sources, pattern, keep = () => true) {
  const found = [];
  for (const [label, url] of sources) {
    const text = await readFile(url, 'utf8');
    for (const hit of text.matchAll(pattern)) {
      if (!keep(hit, text)) continue;
      const line = text.slice(0, hit.index).split('\n').length;
      found.push(`${label}:${line}: ${text.split('\n')[line - 1].trim()}`);
    }
  }
  return found;
}

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
   * TLS article, the architecture post, and its diagrams all discuss servers on
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
   * it. So a reader does still meet the word in a scenario. Fixing that means
   * changing the SDK's message, not this site's copy, and it belongs to the
   * vocabulary pass over the SDK's API surface and its rendered errors.
   */
  const sources = await demoSources();

  /*
   * Bare "server" only. A match touching an identifier character on either side
   * is part of a name the SDK ships and this repository does not get to rename
   * — those are queued as a deliberate API vocabulary pass. "server-rendered"
   * is Astro's meaning, not the E2EE role, and is left alone.
   */
  const BARE_SERVER = /(?<![\w$])servers?(?![\w$])/gi;
  const found = await linesMatching(
    sources,
    BARE_SERVER,
    (hit, text) => !/^-rendered/i.test(text.slice(hit.index + hit[0].length)),
  );

  assert.deepEqual(
    found,
    [],
    `the demo names the relay a "server" here — messaging.md §4 says relay:\n${found.join('\n')}`,
  );
});

test("the demo's own source never makes a tab into a party", async () => {
  /*
   * The other half of the same vocabulary. A device is a device; the browser
   * tab is where all of them happen to be running, and the two are not
   * interchangeable words for the same thing. The demo said they were for a
   * long time, because it was once built out of two real tabs talking over a
   * `BroadcastChannel` and every name followed from that — "the other tab" was
   * literally the second participant. That implementation is gone and the
   * founder's brief was explicit about the wording that outlived it: say
   * devices, device A, device B.
   *
   * The word itself stays legal, and that is the whole difficulty. "This relay
   * runs in the reader's tab" is true, load-bearing, and printed on the page
   * under the latency figures — it is what stops a reader reading sub-millisecond
   * timings as a network measurement. A bare ban would delete the honest
   * sentences along with the metaphor.
   *
   * So the rule is a whitelist of what may sit in front of a singular "tab":
   * the article-and-possessive forms that describe *where the code is running*.
   * Anything else — a plural, an ordinal, a side, a role — is the metaphor
   * coming back, and a phrasing nobody anticipated fails closed rather than
   * slipping through a blacklist of the ones we happened to think of.
   */
  const sources = await demoSources();

  /* No identifier character either side, which is what keeps `tabindex`,
     `data-tab`, `table` and `DwellTable` out of a rule about English. */
  const BARE_TAB = /(?<![\w$-])(tabs?)(?![\w$-])/gi;

  /* Where the code runs, never who is talking. `browser` is optional so that
     "a browser tab" reads as one phrase rather than needing its own entry. */
  const PLACE = /(?:\b(?:this|that|the|a|an|one|each|its|their|reader's|user's)\s+)(?:browser\s+)?$/i;

  const found = await linesMatching(sources, BARE_TAB, (hit, text) => {
    if (hit[1].toLowerCase() === 'tabs') return true;
    /* "tab A" and "tab B" name participants from the other side of the word,
       where nothing in front of it has to change. */
    if (/^\s+[AB]\b/.test(text.slice(hit.index + hit[0].length))) return true;
    /* Read the words in front of it, not the layout. A comment that wraps
       between "the" and "tab" puts a newline and a ` * ` leader between them,
       and the phrase is the same phrase either way. */
    const before = text
      .slice(Math.max(0, hit.index - 60), hit.index)
      .replace(/\n\s*\*?[ \t]*/g, ' ');
    return !PLACE.test(before);
  });

  assert.deepEqual(
    found,
    [],
    `the demo makes a tab into a participant here — devices are devices:\n${found.join('\n')}`,
  );
});

/*
 * Every page is a stack of `band` sections that alternate with `band band-surface`,
 * which is what puts a visible edge between one section and the next. Two in a
 * row on the same surface read as one long section: nothing overlaps, nothing
 * warns, and the page just quietly loses a division it was written to have.
 *
 * There was no guard on this until a section was inserted into the middle of the
 * homepage and the two below it had to be flipped by hand to keep the sequence.
 * That reconstruction happened to be correct, which is the problem — it was
 * checked by eye against a convention nothing enforced, and being right that time
 * is not a property of the process.
 *
 * Read from `src/pages`, not from `dist`, so the guard also runs on an unbuilt
 * tree rather than skipping without a build.
 */
test('alternates the band surface down every page', async () => {
  const dir = new URL('../src/pages/', import.meta.url);
  const names = (await readdir(dir, { recursive: true })).filter((name) =>
    name.endsWith('.astro'),
  );
  assert.ok(names.length > 10, `expected the whole page tree, found ${names.length}`);

  let checked = 0;
  for (const name of names) {
    const source = await readFile(new URL(name, dir), 'utf8');

    /* Any attribute order: the homepage's folded-demo section carries an `id`
       before its class. `band-head` is an inner heading, not a band, and is
       excluded by matching the class as a whole token. */
    const bands = [...source.matchAll(/<section\b[^>]*?\bclass="([^"]*)"/g)]
      .map((match) => match[1].split(/\s+/))
      .filter((classes) => classes.includes('band'))
      .map((classes) => classes.includes('band-surface'));

    for (let i = 1; i < bands.length; i += 1) {
      assert.notEqual(
        bands[i],
        bands[i - 1],
        `src/pages/${name} puts two ${bands[i] ? 'band-surface' : 'plain band'} ` +
          `sections in a row at positions ${i} and ${i + 1}`,
      );
    }
    checked += bands.length;
  }

  /* A regex that stopped matching would make every page trivially alternating.
   * Re-measured after the copy prune: /learn took its seven bands off the tree
   * and the surviving pages lost bands of their own. */
  assert.ok(checked > 20, `expected to be checking real bands, counted ${checked}`);
});

test('keeps the space on both sides of every inline code span', async () => {
  /*
   * Astro drops a newline that falls between a text node and an inline element,
   * in both directions. A paragraph broken for line length renders as
   * "the Expo store is`expo-sqlite`", or as "`scenario_opened /`followed by the
   * name" — one word, no space, in the middle of body copy. Nothing else
   * catches it: the page builds, the audit passes, and the only symptom is on
   * screen.
   *
   * It has now happened five times in three files. The homepage band that
   * summarises the alternatives carries a comment about the first, /product
   * shipped two in its storage paragraph, the comparison fold wrote a fourth on
   * its way in, and the privacy notice shipped the fifth. `{' '}` at the end of
   * the line is the fix in both directions.
   *
   * That fifth one is why this checks both. An earlier version of this comment
   * claimed the closing tag was safe and cited privacy.astro as the proof. The
   * file has both forms: one span sits inline with a literal space around it,
   * the other ends its line, and only the second collapses. Reading the first
   * and generalising from it declared a defect impossible while the site served
   * it.
   *
   * Source-based on purpose. `.github/workflows/ci.yml` runs the suite before
   * the build, so a guard that reads dist/ never runs there.
   *
   * A word character on the far side is what makes it a defect. A line opening
   * with `)` closes a JSX branch and never wanted a space, and one opening with
   * a full stop wants the punctuation tight against the span.
   */
  const dir = new URL('../src/', import.meta.url);
  const names = (await readdir(dir, { recursive: true })).filter((name) => name.endsWith('.astro'));
  assert.ok(names.length > 20, `expected the whole component tree, found ${names.length}`);

  let spans = 0;
  for (const name of names) {
    const source = (await readFile(new URL(name, dir), 'utf8'))
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ');
    spans += (source.match(/<code>/g) ?? []).length;

    const before = source.match(/[\w,).]\n\s*<code>/);
    assert.equal(
      before,
      null,
      `src/${name} ends a line with "${before?.[0].split('\n')[0].slice(-24)}" and opens the ` +
        `next with <code>, which renders with no space between them — end the line with {' '}`,
    );

    const after = source.match(/<\/code>\n\s*(\w[^\n]{0,23})/);
    assert.equal(
      after,
      null,
      `src/${name} ends a line with </code> and opens the next with "${after?.[1]}", which ` +
        `renders with no space between them — end the line with {' '}`,
    );
  }

  /* A regex that stopped matching would pass on every file in the tree. The
   * floor is the tree's measured count: 32 spans on 2026-08-18, down from 33
   * when /learn left the tree.
   *
   * Re-measure and record the reason when this moves. The number is a tripwire
   * for a regex that has stopped matching, so it is only worth what its last
   * measurement was worth. */
  assert.ok(spans >= 32, `expected to be scanning real code spans, counted ${spans}`);
});

test('the scene places the envelope at every step the run records', async () => {
  /*
   * The scene's one hand-written step table, held to the step order.
   *
   * `ENVELOPE_AT` in `scene-view.ts` says where the envelope rests at each
   * step, and what makes it safe is its *type*: a total `Record<Step, …>`. A
   * step added to `trace.ts` and forgotten there does not compile, and an
   * extra key that names no step does not compile either — both were checked
   * against `astro check` rather than assumed. So the table itself is not what
   * needs a runtime guard.
   *
   * What needs one is the declaration. Widen it to `Partial<Record<Step, …>>`
   * and every one of those errors goes away in silence: the missing step falls
   * through to `null`, the envelope is hidden, and a reader gets an empty lane
   * at the new step with the CSS valid, the markup valid, and nothing left in
   * the type system with an opinion. That single word is the whole guarantee,
   * so it is what is asserted, and the key comparison below is the backstop
   * that still holds if it is ever weakened.
   *
   * `null` is a permitted value and is not an omission: before anything has
   * happened, and while a session is being agreed, there is no envelope, and a
   * scene that drew one would be claiming a message the run has not sent.
   */
  const source = await read('../src/lib/demo/scene-view.ts');
  assert.match(
    source,
    /export const ENVELOPE_AT: Record<Step,/,
    'ENVELOPE_AT is no longer declared as a total Record<Step, …> — a partial map silently ' +
      'hides the envelope at any step it omits, which is how the drawing goes blank with ' +
      'every gate green',
  );

  const [{ STEPS }, { ENVELOPE_AT }] = await Promise.all([
    import('../src/lib/demo/trace.ts'),
    import('../src/lib/demo/scene-view.ts'),
  ]);
  assert.ok(STEPS.length >= 8, `expected the STEPS array, found ${JSON.stringify(STEPS)}`);
  assert.equal(STEPS[0], 'idle', 'the step order no longer starts at idle');
  assert.deepEqual(
    Object.keys(ENVELOPE_AT).sort(),
    [...STEPS].sort(),
    'ENVELOPE_AT and STEPS disagree about what the steps are — the scene is placing the ' +
      'envelope at a step the run never records, or has been left a key for one that is gone',
  );

  /* And the places it names are places the scene has. A typo here does not
     throw: `anchorFor` would be handed a string it does not know and the
     envelope would land wherever the fallback put it. */
  const PLACES = new Set(['sender', 'relay', 'receiver', null]);
  for (const [step, place] of Object.entries(ENVELOPE_AT)) {
    assert.ok(PLACES.has(place), `${step} puts the envelope at "${place}", which is not a place`);
  }
});

test('the spent key carries its transition on the flying state, never at rest', async () => {
  /*
   * The key that leaves the shelf when a session is agreed is placed and
   * released inside one cue: the script writes the shelf it starts from, forces
   * that placement out with a reflow, then writes the device it ends at. That
   * only draws a crossing while the resting state has no transition of its own.
   *
   * Give `.demo-spent-key` a `transition: transform …` and the first of those
   * two writes becomes an animation as well — from wherever the element last
   * was, which at mount is the scene's top-left corner — and the second write
   * retargets it from mid-flight. The key then sets off from the corner instead
   * of from the shelf. Every gate stays green: the element is displayed, the
   * counts are right, the arrival is right, and the only wrong thing is the
   * half-second nobody asserts on.
   *
   * That is not hypothetical — it is what shipped in the first commit of this
   * feature and it was found by sampling the live transform in a browser, not
   * by any check here. The envelope never meets it because it is placed on one
   * cue and flown on the next, so the arrangement this asserts is the published
   * keys' rather than the envelope's.
   *
   * `cssRules` rather than `ruleFor`, because the selector legitimately carries
   * two rules — the base one and the `display: none` that collapses it in the
   * stacked layout — and `ruleFor` throws on a second. Every rule under the bare
   * selector is checked, which is the point: a transition added inside the media
   * block would be just as wrong.
   */
  const scene = await read('../src/components/demo/DemoScene.astro');
  const rules = cssRules(scene);

  const resting = rules.filter((rule) => rule.selector === '.demo-spent-key');
  assert.ok(resting.length > 0, 'the scene no longer styles .demo-spent-key at all');
  for (const rule of resting) {
    assert.doesNotMatch(
      rule.body,
      /transition/,
      'the spent key declares a transition on its resting state, so the placement write ' +
        'animates too and the crossing starts from wherever the key last was',
    );
  }

  const flying = rules.filter((rule) => rule.selector === ".demo-spent-key[data-flying='true']");
  assert.equal(flying.length, 1, 'the flying state is no longer one rule');
  /* The property is the one the placement writes. The key rides a motion path
     — the rack, the wire, the wheel — so what animates is `offset-distance`,
     and a rule that transitioned `transform` instead would leave the crossing
     to happen in a single frame. The clock is still the shared one: the
     crossing is a multiple of `--demo-flight-ms` rather than a number of its
     own, which is what keeps it inside the step's dwell when that dwell
     moves. */
  assert.match(
    flying[0].body,
    /transition:\s*offset-distance\s+calc\(var\(--demo-flight-ms/,
    'the flying state no longer flies on --demo-flight-ms, so the key crosses the gap at a ' +
      'speed unrelated to the step holding it',
  );
});
