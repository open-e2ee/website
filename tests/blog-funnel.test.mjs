/*
 * The journal as part of the funnel.
 *
 * A post is the widest part of this site: someone searching for `signal
 * protocol expo` lands on one without meeting the homepage, the product page,
 * or the pricing. Three posts ended on the older and newer links and the
 * standing disclosure. Both send the reader further into the journal, so the
 * page a stranger arrives on was the page they left from.
 *
 * `scripts/check-blog-funnel.mjs` reads the built pages and is what SR-V32
 * runs. These guards hold the shape that makes the built pages come out right:
 * one declaration of the destination, one component rendering it, and a
 * position in the footer that puts the offer before the way back into the
 * journal.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import { readingMinutes } from '../src/lib/article.mjs';
import { declaration } from './navigation-source.mjs';

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

/** The inside of an article, so the site header and site footer cannot answer. */
function articleOf(html) {
  const start = html.indexOf('<article');
  const end = html.indexOf('</article>');
  assert.ok(start >= 0 && end > start, 'the page renders no closed <article>');
  return html.slice(html.indexOf('>', start) + 1, end);
}

async function builtPosts() {
  const blog = new URL('../dist/blog/', import.meta.url);
  const entries = await readdir(blog, { recursive: true }).catch(() => null);
  if (!entries) return null;
  return entries.filter((entry) => entry.endsWith('index.html') && entry !== 'index.html').sort();
}

test('names the destination once, and never in the component', async () => {
  const component = await read('../src/components/NextStep.astro');

  /* The header, the sheet, the relay page, and now the end of every post all
     open the same route. A URL typed into this file is a fifth answer that
     nothing keeps in step with the other four. */
  assert.match(component, /import \{ startAction \}/);
  assert.doesNotMatch(
    component.replace(/\/\*[\s\S]*?\*\//g, ''),
    /href=\{?['"]https:\/\/console\./,
    'the offer writes a console URL of its own',
  );

  const startAction = await declaration('startAction');
  assert.match(startAction, /href: 'https:\/\/console\.open-e2ee\.dev\/relay\/new'/);
});

test('puts the offer before the way back into the journal', async () => {
  const layout = await read('../src/layouts/BlogPostLayout.astro');
  const offer = layout.indexOf('<NextStep />');
  const neighbors = layout.indexOf('oe-article-neighbors');
  const maturity = layout.indexOf('class={MATURITY}');

  assert.ok(offer > 0, 'the post layout renders no offer');
  /* Both of the things below it lead somewhere else on this site. An offer
     under them is the third thing at the bottom of a long page. */
  assert.ok(offer < neighbors, 'the offer sits under the older and newer links');
  assert.ok(offer < maturity, 'the offer sits under the standing disclosure');

  /* Inside the article, not after it. Outside, the site footer and the offer
     become one block of chrome, and the check that reads `<article>` on the
     built page would have nothing to find. */
  const footer = layout.indexOf('<footer class="oe-article-footer">');
  const articleEnd = layout.indexOf('</article>');
  assert.ok(footer < offer && offer < articleEnd, 'the offer left the article');
});

test('gives every index row the length and the subject of the post', async () => {
  const index = await read('../src/pages/blog/index.astro');

  /* The figure comes from the same function the post page prints, so the row
     and the page it opens never disagree about how long the post is. */
  assert.match(index, /import \{ byPublication, readingMinutes \}/);
  assert.match(index, /readingMinutes\(post\.body \?\? ''\)/);
  assert.match(index, /post\.data\.tags\[0\]/, 'the row names no subject');

  /* A second `<p>` in the row arrives dressed as the description: `POST_LINK`
     styles every `p` inside it. */
  const opening = index.indexOf('<a class={POST_LINK}');
  const row = index.slice(opening, index.indexOf('</a>', opening));
  assert.match(row, /<span class=\{POST_META\}>/, 'the row metadata is not a span');
});

test('ships posts that carry the action, and an index that carries the times', async () => {
  const posts = await builtPosts();
  if (!posts) return skipUnbuilt('dist/blog/');
  assert.ok(posts.length >= 3, `the build produced ${posts.length} posts`);

  for (const post of posts) {
    const article = articleOf(await read(`../dist/blog/${post}`));
    const actions = article.match(/<a [^>]*data-next-step[^>]*>/g) ?? [];
    assert.equal(actions.length, 1, `${post} carries ${actions.length} end-of-post actions`);
    assert.match(actions[0], /href="https:\/\/console\.open-e2ee\.dev\/relay\/new"/);
  }

  const index = await read('../dist/blog/index.html');
  const list = index.slice(index.indexOf('<ul'), index.indexOf('</ul>'));
  const rows = list.split('<li').length - 1;
  assert.equal(rows, posts.length, `the index lists ${rows} rows for ${posts.length} posts`);
  assert.equal(
    (list.match(/\d+ min read/g) ?? []).length,
    rows,
    'a row on the index carries no reading time',
  );
  assert.match(index, /data-next-step/, 'the index ends on the site footer');
});

test('prints the same reading time the post page prints', async () => {
  const posts = await builtPosts();
  if (!posts) return skipUnbuilt('dist/blog/');

  const index = await read('../dist/blog/index.html');
  const onIndex = [...index.matchAll(/(\d+) min read/g)].map((match) => Number(match[1]));
  const onPosts = [];
  for (const post of posts) {
    const article = articleOf(await read(`../dist/blog/${post}`));
    const found = /(\d+) min read/.exec(article);
    assert.ok(found, `${post} prints no reading time`);
    onPosts.push(Number(found[1]));
  }

  /* Sorted, because the index is newest first and `readdir` is alphabetical.
     The question is whether the two surfaces agree on the set, not on the
     order, which `tests/article-layout.test.mjs` already owns. */
  assert.deepEqual([...onIndex].sort(), [...onPosts].sort(), 'the index and the posts disagree');

  /* And the figure is the function's, not a number that happens to match.
     The frontmatter comes off first: the loader hands `readingMinutes` the body
     alone, and a file read counts the title, the description, and the tags as
     prose — which on this journal is a whole minute on two of the three. */
  const bodies = await readdir(new URL('../src/content/blog/', import.meta.url));
  const expected = [];
  for (const file of bodies) {
    const source = await read(`../src/content/blog/${file}`);
    expected.push(readingMinutes(source.replace(/^---\n[\s\S]*?\n---\n/, '')));
  }
  assert.deepEqual([...onPosts].sort(), expected.sort(), 'the printed time is not the computed one');
});
