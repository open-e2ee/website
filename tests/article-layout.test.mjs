/*
 * The article column.
 *
 * An article is drawn by four files that have to agree: src/styles/article.css
 * places the column, src/styles/prose.css dresses the sentences inside it,
 * src/layouts/BlogPostLayout.astro puts the markup on the grid, and
 * src/lib/article.mjs answers how long the article is and what comes next.
 *
 * The defect these tests exist for is a column that reads a width from a
 * number. The measure is `--oe-prose-measure`, the design package states it in
 * `ch`, and `ch` is a measurement of the font of the element that reads it. A
 * grid track written in the token but set in the wrong face is a column of 68
 * characters of a font nothing on the page is printed in: measured, that was
 * 616 px against a token of 732 px, and the rule read correct.
 *
 * So these assertions are about which element resolves which token, not about
 * whether a token is mentioned.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { byPublication, neighbors, readingMinutes } from '../src/lib/article.mjs';
import { cssRules, ruleFor } from './css-rules.mjs';

const read = (path) => readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const article = await read('../src/styles/article.css');
const prose = await read('../src/styles/prose.css');
const base = await read('../src/layouts/BaseLayout.astro');
const layout = await read('../src/layouts/BlogPostLayout.astro');
const toc = await read('../src/components/ArticleToc.astro');

/* ── The column ──────────────────────────────────────────────────────────── */

test('the text track is the design package’s measure rather than a number', () => {
  const grid = ruleFor(article, '.oe-article');
  const columns = /grid-template-columns:([^;]*);/.exec(grid);
  assert.ok(columns, '.oe-article should state its own tracks');

  const tracks = columns[1];
  assert.match(tracks, /\[text-start\]\s*minmax\(0,\s*var\(--oe-prose-measure\)\)\s*\[text-end\]/);
  for (const line of ['full-start', 'text-start', 'text-end', 'full-end']) {
    assert.match(tracks, new RegExp(`\\[${line}\\]`), `the grid should name \`${line}\``);
  }
  assert.doesNotMatch(
    tracks,
    /\d+(\.\d+)?(rem|px|em|ch)/,
    'a track written as a length is a second answer to the measure',
  );
  assert.doesNotMatch(
    article,
    /max-width:\s*calc\(/,
    'the column was a calc() on a wrapper once, and read 512 px against a 732 px token',
  );
});

test('the article is set in the reading face at the reading size', () => {
  /* The grid track is `68ch`. It resolves on this element, so this element has
     to be the font the sentences are printed in, at their size. */
  const grid = ruleFor(article, '.oe-article');
  assert.match(grid, /font-family:\s*var\(--oe-prose-font-family\)/);
  assert.match(grid, /font-size:\s*var\(--oe-prose-size\)/);

  /* The other half: the sentences read the same size token, from one place. */
  assert.match(ruleFor(prose, ':root'), /--oe-prose-size:\s*[\d.]+rem/);
  assert.match(ruleFor(prose, '.prose'), /font-size:\s*var\(--oe-prose-size\)/);
});

test('the breakout width is a registered length, so it is one width', () => {
  /* Unregistered, a custom property is substituted as text, and a measure
     written in `ch` re-resolves at every element that reads it. Measured, the
     same expression was 732 px on a paragraph and 679 px on a `<pre>`. */
  const registration = ruleFor(article, '@property --oe-article-wide');
  assert.match(registration, /syntax:\s*'<length>'/);
  assert.match(registration, /inherits:\s*true/);
  assert.match(ruleFor(article, '.oe-article'), /--oe-article-wide:\s*calc\(var\(--oe-prose-measure\)/);
});

test('a figure, a code block, and a table take the wide track together', () => {
  const wide = cssRules(article).filter((rule) => /var\(--oe-article-wide\)/.test(rule.body));

  /*
   * Two placements, not one: the breakout centers on the column, and where a
   * contents rail is drawn it starts at the column instead, because the rail
   * and the centered breakout are drawn from the same gutter. Both are the
   * same four children. A rule that placed three of them is the drift this
   * guard was written for, and there is now one more rule for it to happen in.
   */
  assert.equal(wide.length, 2, 'the breakout is placed by a rule that names no set of children');

  for (const rule of wide) {
    for (const child of ['figure', 'pre', 'table', '.oe-article-wide']) {
      assert.ok(
        rule.selector.includes(`> .prose > ${child}`),
        `\`${child}\` should take the wide track with the others in \`${rule.selector}\``,
      );
    }
  }

  const centered = wide.find((rule) => !rule.selector.includes(':has('));
  const railed = wide.find((rule) => rule.selector.includes(':has(> .oe-article-toc)'));
  assert.ok(centered, 'nothing centers the breakout on an article with no rail');
  assert.ok(railed, 'nothing moves the breakout clear of the rail');

  assert.match(centered.body, /grid-column:\s*full\b/);
  /* The gutter is subtracted rather than crossed: a code block that runs to
     both edges of a phone draws its border against the side of the screen. */
  assert.match(
    centered.body,
    /inline-size:\s*min\(100% - var\(--oe-article-gutter\) \* 2, var\(--oe-article-wide\)\)/,
  );

  /* The railed one gives up its leading step and keeps its trailing one, so it
     subtracts one gutter where the centered rule subtracts two. */
  assert.match(railed.body, /grid-column:\s*text-start\s*\/\s*full-end/);
  assert.match(
    railed.body,
    /inline-size:\s*min\(100% - var\(--oe-article-gutter\), var\(--oe-article-wide\)\)/,
  );
});

test('the prose lays its own children on the article’s tracks', () => {
  const wrapper = ruleFor(article, '.oe-article > .prose');
  assert.match(wrapper, /grid-column:\s*full/);
  assert.match(wrapper, /grid-template-columns:\s*subgrid/);
  assert.match(wrapper, /max-width:\s*none/, 'a width here would re-narrow the column');
  assert.match(ruleFor(article, '.oe-article > .prose > *'), /grid-column:\s*text/);
  assert.match(ruleFor(article, '.oe-article > *'), /grid-column:\s*text/);
});

/* ── The furniture ───────────────────────────────────────────────────────── */

test('nothing outside the prose borrows the reading face or the reading size', () => {
  const furniture = cssRules(article).filter(
    (rule) => /^\.oe-article-/.test(rule.selector) || /\s\.oe-article-/.test(rule.selector),
  );
  assert.ok(furniture.length > 0, 'the stylesheet should hold furniture rules to check');
  for (const rule of furniture) {
    assert.doesNotMatch(
      rule.body,
      /--oe-prose-font-family|--oe-prose-size/,
      `\`${rule.selector}\` should not read the prose face`,
    );
  }

  assert.match(ruleFor(article, '.oe-article-header, .oe-article-footer'), /font-family:\s*var\(--oe-font-sans\)/);
  assert.match(ruleFor(article, '.oe-article-toc'), /font-family:\s*var\(--oe-font-sans\)/);
  /* The one furniture element with no size of its own inherited the article’s
     reading size and rendered a link title at 19 px. */
  assert.match(ruleFor(article, '.oe-article-neighbor-title'), /font-size:\s*[\d.]+rem/);
});

test('the contents take the rail only where the leading gutter holds it', () => {
  assert.match(
    article,
    /@media \(min-width: 80rem\) \{\s*\.oe-article > \.oe-article-toc \{/,
    'the rail should be the wide-width rule, not the default one',
  );
  const rail = ruleFor(article, '.oe-article > .oe-article-toc');
  assert.match(rail, /grid-column:\s*full-start \/ text-start/);
  assert.match(rail, /position:\s*sticky/);
  assert.match(rail, /inline-size:\s*var\(--oe-article-rail\)/);
  /* A contents list longer than the viewport has to be reachable. */
  assert.match(rail, /overflow-y:\s*auto/);
});

test('the newer article keeps its side until the cells stack', () => {
  const next = cssRules(article).filter((rule) => rule.selector === '.oe-article-neighbor-next');
  assert.equal(next.length, 2, 'the next cell should be placed twice: side by side and stacked');
  assert.ok(
    next.some((rule) => /grid-column:\s*2/.test(rule.body) && /text-align:\s*end/.test(rule.body)),
    'beside the older article, the newer one sits on the right',
  );
  assert.ok(
    next.some((rule) => /grid-column:\s*1/.test(rule.body) && /text-align:\s*start/.test(rule.body)),
    'stacked, it takes the one column rather than an empty second one',
  );
  assert.match(article, /@media \(max-width: 34rem\) \{/);
});

/* ── What the column has to hold ─────────────────────────────────────────── */

test('a table scrolls inside the column instead of widening the page', () => {
  /* `overflow` on a table box does not clip it; `display: block` is what makes
     the box scrollable. Undressed, the subprocessor table scrolled the page
     sideways at a 320 px viewport; scripts/measure-overflow.mjs is the check. */
  const table = ruleFor(prose, '.prose table');
  assert.match(table, /display:\s*block/);
  assert.match(table, /overflow-x:\s*auto/);
});

test('a long identifier breaks instead of pushing the page sideways', () => {
  assert.match(ruleFor(prose, '.prose code'), /overflow-wrap:\s*break-word/);
});

/* ── The markup on the grid ──────────────────────────────────────────────── */

test('the layout puts the whole article on one grid', () => {
  assert.match(base, /import '\.\.\/styles\/article\.css';/, 'the stylesheet has to reach the page');
  assert.match(layout, /<article class="oe-article">/);
  assert.match(layout, /<div class="prose">/, 'the prose is a grid child, not a wrapper of one');
  assert.match(layout, /<ArticleToc headings=\{headings\} \/>/);
  assert.match(layout, /\{readingMinutes\} min read/);
  assert.doesNotMatch(
    layout,
    /ARTICLE_COLUMN|max-w-\[calc\(/,
    'the recipe column is the 512 px wrapper this grid replaced',
  );
});

test('the contents list is one element and carries the reading position', () => {
  const navs = toc.match(/<nav\b/g) ?? [];
  assert.equal(navs.length, 1, 'a second copy would list the same links twice in the accessibility tree');
  assert.match(toc, /heading\.depth === 2/);
  assert.match(toc, /aria-label="On this page"/);
  assert.match(toc, /setAttribute\('aria-current', 'true'\)/);
  assert.match(
    ruleFor(article, ".oe-article-toc a[aria-current='true']"),
    /color:\s*var\(--oe-foreground\)/,
    'the state a screen reader announces should be the state a reader sees',
  );
});

/* ── How long, and what comes next ───────────────────────────────────────── */

test('reading time rounds up and never reads zero', () => {
  assert.equal(readingMinutes(''), 1);
  assert.equal(readingMinutes('word '.repeat(200)), 1);
  assert.equal(readingMinutes('word '.repeat(201)), 2);
});

test('reading time counts sentences rather than code blocks', () => {
  const fenced = ['```ts', 'word '.repeat(400), '```', 'a real sentence'].join('\n');
  assert.equal(readingMinutes(fenced), 1);
  assert.equal(readingMinutes(`import Thing from './thing';\n${'word '.repeat(400)}`), 2);
});

test('the index and the article agree on which post is older', () => {
  /* Every post on this journal shares a publication date, so the tie-break is
     the ordering. A sort on the date alone leaves it to the loader, and the
     link under an article then sends the reader back to the page they left. */
  const day = new Date('2026-07-25T00:00:00Z');
  const posts = [
    { id: 'b', data: { publishedAt: day } },
    { id: 'a', data: { publishedAt: day } },
    { id: 'c', data: { publishedAt: new Date('2026-08-01T00:00:00Z') } },
  ];

  assert.deepEqual([...posts].sort(byPublication).map((post) => post.id), ['c', 'a', 'b']);

  const middle = neighbors(posts, 'a');
  assert.equal(middle.next.id, 'c', 'next is the newer article');
  assert.equal(middle.previous.id, 'b', 'previous is the older one');

  assert.equal(neighbors(posts, 'c').next, undefined);
  assert.equal(neighbors(posts, 'b').previous, undefined);
});
