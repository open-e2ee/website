/*
 * The contents rail and the things a blog post puts beside it.
 *
 * Above 80rem the table of contents leaves the column and becomes a sticky rail
 * in the leading gutter. A figure, a code block, and a table leave the column in
 * the other direction: `wide` is the measure plus one step of token space on
 * each side. Both reach into the same gutter, so the rail and the drawing beside
 * it drew over each other by 32 pixels at 1280, 1440, and 1680.
 *
 * `scripts/measure-rail-clearance.mjs` is what proves the pixels. It needs a
 * build and a browser. These guards need neither, and they hold the shape the
 * measurement depends on: that the leading edge of a breakout moves only where a
 * rail is drawn, and that it moves at the width the rail is drawn at.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/*
 * dist/ is absent on a clean checkout and present in CI, which builds before it
 * tests. A bare skip would let a dist-reading assertion report a pass in the one
 * place it is the only guard there is.
 */
const skipUnbuilt = (page) => {
  assert.ok(
    !process.env.CI,
    `${page} is missing — CI builds before it tests, so a dist-reading assertion must never skip here`,
  );
};

/*
 * The `@media` rule that encloses a position, brace by brace.
 *
 * Comments come off first. A rule's prelude is what stands between the previous
 * closing brace and its own opening one, and this file writes a paragraph of
 * comment above nearly every rule in it, so the prelude of the width query read
 * as the note above it rather than as `@media`.
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function enclosingAtRule(css, at) {
  let depth = 0;
  for (let index = at; index >= 0; index -= 1) {
    if (css[index] === '}') depth += 1;
    else if (css[index] === '{') {
      if (depth > 0) depth -= 1;
      else {
        const prelude = css.slice(css.lastIndexOf('}', index) + 1, index).trim();
        return prelude.startsWith('@') ? prelude : null;
      }
    }
  }
  return null;
}

/** The block of a rule, found by a selector it carries. */
function ruleFor(css, selector) {
  const at = css.indexOf(selector);
  assert.ok(at >= 0, `no rule in src/styles/article.css selects ${selector}`);
  const open = css.indexOf('{', at);
  const close = css.indexOf('}', open);
  assert.ok(open > at && close > open, `the rule for ${selector} is not a closed block`);
  return css.slice(open + 1, close);
}

test('starts a breakout at the text column wherever a rail is drawn', async () => {
  const css = await read('../src/styles/article.css');
  const scoped = '.oe-article:has(> .oe-article-toc) > .prose > figure';
  const block = ruleFor(css, scoped);

  /* The leading edge moves to the column and the trailing edge keeps the far
     gutter. `full` on both sides is the state that overlapped: the rail sits in
     the leading gutter, and `full` spans it. */
  assert.match(block, /grid-column:\s*text-start\s*\/\s*full-end/, 'the breakout still starts at full-start');
  /* Centering inside a track that starts at the column would take back half of
     what the line change just gave. */
  assert.match(block, /margin-inline:\s*0\s+auto/, 'the breakout centers itself back over the rail');

  /* All four wide elements, not the figure alone. A code block is the element
     that overlapped on two of the three posts. */
  for (const element of ['figure', 'pre', 'table', '.oe-article-wide']) {
    assert.ok(
      css.includes(`.oe-article:has(> .oe-article-toc) > .prose > ${element}`),
      `${element} keeps the leading gutter that the rail stands in`,
    );
  }
});

test('leaves the breakout centered on an article that draws no rail', async () => {
  const css = await read('../src/styles/article.css');

  /* `ArticleToc.astro` renders nothing when a post has no `h2`, so the width
     alone does not say whether a rail is there. A rule scoped to the width and
     not to the rail would move every breakout on every wide screen, including
     the posts that have the whole gutter to themselves. */
  const base = ruleFor(css, '.oe-article > .prose > figure');
  assert.match(base, /grid-column:\s*full\b/, 'an article with no rail lost its centered breakout');
  assert.match(base, /min\(100% - var\(--oe-article-gutter\) \* 2/, 'the unrailed breakout changed width');

  const override = css.indexOf('.oe-article:has(> .oe-article-toc) > .prose > figure');
  assert.ok(
    override > css.indexOf('.oe-article > .prose > figure'),
    'the rail case is written before the case it overrides',
  );
});

test('moves the breakout at the width the rail appears at', async () => {
  const css = await read('../src/styles/article.css');

  /* Two breakpoints for one condition is a band of widths where one of them has
     happened and the other has not: either a rail over a figure, or a figure
     indented beside no rail. The rail's own query is the definition. */
  const flat = stripComments(css);
  const rail = enclosingAtRule(flat, flat.indexOf('.oe-article > .oe-article-toc'));
  const breakout = enclosingAtRule(
    flat,
    flat.indexOf('.oe-article:has(> .oe-article-toc) > .prose > figure'),
  );

  /* Inside a query rather than beside one. A breakout that starts at the column
     below 80rem gives up its leading step of space to a rail that is not
     drawn, and the two posts that carry no rail at all would be indented for
     nothing. */
  assert.ok(breakout, 'the scoped breakout sits outside every width query');
  assert.match(breakout, /^@media \(min-width:/, `the breakout is conditioned on ${breakout}`);
  assert.equal(breakout, rail, `the rail appears at ${rail} and the breakout moves at ${breakout}`);
});

test('ships posts that draw a rail and a breakout on the same page', async () => {
  const dist = new URL('../dist/blog/', import.meta.url);
  const entries = await readdir(dist, { recursive: true }).catch(() => null);
  if (!entries) return skipUnbuilt('dist/blog/');

  const posts = entries.filter((entry) => entry.endsWith('index.html')).sort();
  assert.ok(posts.length > 0, 'the build produced no blog pages');

  /* The measurement fails an empty sweep, and this is the same question asked
     without a browser: a stylesheet that no page exercises is a rule that
     nothing proves. */
  let both = 0;
  for (const post of posts) {
    const html = await read(`../dist/blog/${post}`);
    const article = html.slice(html.indexOf('<article'), html.indexOf('</article>'));
    if (!article.includes('oe-article-toc')) continue;
    if (!/<figure|<pre|<table/.test(article)) continue;
    both += 1;
  }
  assert.ok(both >= 3, `${both} posts draw a rail beside a breakout; the rule wants at least 3`);
});
