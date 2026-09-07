/*
 * The flagship's own page.
 *
 * It was the shortest page in the funnel and it sold the largest product. The
 * headline made the Relay a property of the SDK, the one action named a
 * doorway, and the page carried no drawing at all — four bands of prose in a
 * measure-wide column with the right half of every one of them empty.
 *
 * These guards read the built page, because the question is what shipped.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/*
 * The page, and a named failure when the build has not produced it. A skip
 * here would turn the whole file green against a page that does not exist,
 * and every assertion below reads rendered markup.
 */
async function builtPage() {
  const html = await read('../dist/relay/index.html').catch(() => null);
  assert.ok(html, 'dist/relay/index.html is missing — build before reading what shipped');

  /* The page without the chrome around it. The site header carries a start
     action on every page since FR4, so a check for one anywhere in the file
     reads the header and reports that this page offers a route it does not.
     Everything below asks what this page says. */
  const start = html.indexOf('<main');
  const end = html.indexOf('</main>');
  assert.ok(start >= 0 && end > start, 'the page renders no main landmark');
  return html.slice(start, end);
}

test('opens with the Relay as the subject, not as a property of the SDK', async () => {
  const html = await builtPage();
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1];
  assert.ok(heading, 'the page renders no h1');
  const words = heading.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

  /* The old headline read "The managed delivery path for the OpenE2EE Signal
     Protocol SDK." Its subject was a path and its object was the other
     product, so the page that sells the Relay opened by naming the SDK. */
  assert.match(words, /^OpenE2EE Relay\b/, `the headline opens "${words}"`);
  assert.doesNotMatch(
    words.slice('OpenE2EE Relay'.length),
    /Signal Protocol SDK/,
    `the headline still hands the sentence to the SDK: "${words}"`,
  );
});

test('carries a free start, and names the price of starting', async () => {
  const html = await builtPage();

  /* The action was "Open the Console", which named a doorway. The route that
     creates a project is what the homepage hero and every self-service column
     on /pricing already open, so this page opens it too. */
  const actions = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>/g)].map((match) => match[1]);
  assert.ok(
    actions.some((href) => href.startsWith('https://console.open-e2ee.dev/products/relay/new')),
    'the page offers no route that creates a project',
  );

  const hero = html.slice(0, html.indexOf('</header>'));
  assert.ok(hero.length < html.length, 'the page hero is no longer a header element');
  assert.match(hero, /\boe-button\b/, 'the hero offers no control, only words');
  assert.match(hero, /Start free/, 'the hero names no free start');
});

test('draws the product', async () => {
  const html = await builtPage();

  /* Four bands of prose in a measure-wide column, and nothing to look at. A
     product page for delivery infrastructure that never shows the path a
     message takes is asking the reader to assemble the picture themselves. */
  const figures = html.match(/<figure\b/g) ?? [];
  assert.ok(figures.length >= 1, `the page draws ${figures.length} figures`);

  /* A drawing with no caption is decoration, and a drawing with no accessible
     name is absent for a reader who cannot see it. */
  assert.match(html, /<figcaption\b/, 'the figure carries no caption');
  const svg = html.match(/<svg [^>]*>/)?.[0];
  assert.ok(svg, 'the figure holds no drawing');
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-labelledby="/);
});

test('draws it with the published grammar, and never with alpha', async () => {
  const html = await builtPage();
  const svg = html.match(/<svg [\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg, 'the page holds no drawing');

  /* The two rules `@open-e2ee/design/diagram` enforces rather than documents.
     Nothing emits an opacity, because "partly readable" is not a thing
     encryption does; and every sealed slab carries metadata ticks, because a
     sealed envelope drawn without them claims the relay sees nothing, which is
     the one thing this product must never claim. */
  for (const alpha of [/\bopacity=/, /fill-opacity=/, /stroke-opacity=/, /rgba\(/, /Gradient/]) {
    assert.doesNotMatch(svg, alpha, `the drawing renders something partly readable: ${alpha}`);
  }

  const ticks = svg.match(/<rect [^>]*width="2" height="10"[^>]*\/>/g) ?? [];
  assert.ok(ticks.length >= 3, `the drawing carries ${ticks.length} metadata ticks`);

  /* The carrier is a pair. One bracket is a different mark, and this repository
     shipped that bug on its own social card for two releases. */
  const source = await read('../src/components/diagrams/RelayMailboxes.astro');
  assert.match(source, /from '@open-e2ee\/design\/diagram'/);
  assert.doesNotMatch(
    source,
    /carrierBracketPaths\(/,
    'the component places one bracket at a time rather than the pair',
  );

  /* No private copy of a primitive. Six components in this repository each
     carried their own `slabPath` and `metadataTicks` once, and they were not
     identical. */
  assert.doesNotMatch(
    source,
    /^\s*(?:function|const)\s+(?:slabPath|metadataTicks|carrierBrackets|deviceOutline)\b/m,
    'the component re-implements a primitive the grammar publishes',
  );
});

test('holds the wide drawing to a legible floor', async () => {
  /*
   * `.diagram svg` is `width: 100%`, so a figure with no floor shrinks rather
   * than scrolling. Measured before this rule: at a 320px viewport the drawing
   * rendered 288 CSS pixels wide, which set its 13px labels at about 3.6 real
   * pixels. It has no stacked composition to fall back to, so the floor and the
   * scroll are what make it readable there.
   */
  const html = await builtPage();
  assert.match(html, /<figure class="[^"]*\bdiagram-wide\b/, 'the figure claims no floor');

  const css = await read('../src/styles/demo.css');
  assert.match(css, /\.diagram-wide svg \{\s*min-width:/);

  /* And the floor survives the width it exists for. The narrow-viewport rule
     turns the scroll off for the signature pair, whose stacked composition
     needs none, and that would take the scroll away from the one figure that
     depends on it. The wide rule stands after it and hands it back. */
  const narrow = css.slice(css.indexOf('@media (max-width: 48rem)'));
  const off = narrow.search(/\.diagram \{\s*overflow-x: visible/);
  const back = narrow.search(/\.diagram-wide \{\s*overflow-x: auto/);
  assert.ok(off >= 0, 'the narrow-viewport rule no longer turns the scroll off');
  assert.ok(back > off, 'the wide figure never gets its scroll back at narrow widths');
});
