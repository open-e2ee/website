/*
 * Does the journal offer a way into the product?
 *
 * A post that names no next step ends the funnel. Three posts ended on the
 * older and newer links and the standing disclosure, both of which send the
 * reader further into the journal, and the index rows offered a date, a title,
 * and a sentence.
 *
 *   node scripts/check-blog-funnel.mjs dist
 *
 * The check reads the built pages, because the question is what shipped. The
 * site header and the site footer carry a console link on every page of the
 * site, so a page-wide search answers for the chrome rather than for the page:
 * every assertion below reads inside `<article>` or inside the index list.
 *
 * Exit 0 when the journal carries the path, 1 when it does not, 2 when the
 * build is not there to read.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The console route that creates a Relay project, declared in one place. */
const PROJECT_ROUTE = 'https://console.open-e2ee.dev/products/relay/new';

class Missing extends Error {}

/** The inside of the first element of a kind, without its own opening tag. */
function inside(html, open, close) {
  const start = html.indexOf(open);
  if (start === -1) return null;
  const from = html.indexOf('>', start);
  const to = html.indexOf(close, from);
  if (from === -1 || to === -1) return null;
  return html.slice(from + 1, to);
}

function postPages(dist) {
  const blog = join(dist, 'blog');
  if (!existsSync(blog)) throw new Missing(`${blog} is not there`);
  return readdirSync(blog)
    .sort()
    .map((entry) => join(blog, entry, 'index.html'))
    .filter((path) => existsSync(path) && statSync(path).isFile());
}

function main() {
  const dist = process.argv[2];
  if (!dist) throw new Missing('pass the built directory, for example dist');
  if (!existsSync(dist)) throw new Missing(`${dist} is not there; run npm run build first`);

  const failures = [];
  const posts = postPages(dist);

  /*
   * An empty journal passes every assertion below it. The count is the guard
   * against a loop that never ran, and three is what ships today.
   */
  if (posts.length < 3) {
    throw new Missing(`the build holds ${posts.length} post pages; the journal has three`);
  }

  for (const path of posts) {
    const html = readFileSync(path, 'utf8');
    const article = inside(html, '<article', '</article>');
    if (!article) {
      failures.push(`${path} renders no <article>`);
      continue;
    }

    /* The action itself, not a mention of the console. `data-next-step` is what
       the component marks it with, so a band that loses its action fails here
       rather than passing on a word in the prose. */
    const actions = [...article.matchAll(/<a [^>]*data-next-step[^>]*>/g)].map((match) => match[0]);
    if (actions.length !== 1) {
      failures.push(`${path} carries ${actions.length} end-of-post actions, not one`);
      continue;
    }
    if (!actions[0].includes(`href="${PROJECT_ROUTE}"`)) {
      failures.push(`${path} points its end-of-post action somewhere other than ${PROJECT_ROUTE}`);
    }

    /* Before the neighbors. After them the offer is the last of three things
       that all look like the end of the page, and the two above it both lead
       back into the journal. */
    const neighbors = article.indexOf('oe-article-neighbors');
    if (neighbors !== -1 && article.indexOf('data-next-step') > neighbors) {
      failures.push(`${path} puts the offer after the older and newer links`);
    }
  }

  /* The index: every row says how long the post is. A reader choosing between
     three long essays had no length to choose on. */
  const indexPath = join(dist, 'blog', 'index.html');
  if (!existsSync(indexPath)) throw new Missing(`${indexPath} is not there`);
  const index = readFileSync(indexPath, 'utf8');
  const list = inside(index, '<ul', '</ul>');
  if (!list) {
    failures.push(`${indexPath} renders no list of posts`);
  } else {
    const rows = list.split('<li').length - 1;
    const times = [...list.matchAll(/\d+ min read/g)].length;
    if (rows !== posts.length) {
      failures.push(`${indexPath} lists ${rows} rows for ${posts.length} posts`);
    }
    if (times !== rows) {
      failures.push(`${indexPath} gives a reading time to ${times} of its ${rows} rows`);
    }
    if (!index.includes('data-next-step')) {
      failures.push(`${indexPath} ends on the site footer rather than on an offer`);
    }
  }

  if (failures.length > 0) {
    console.error(`blog funnel: FAIL\n${failures.map((line) => `  ${line}`).join('\n')}`);
    process.exit(1);
  }

  console.log(
    `blog funnel: PASS — ${posts.length} posts carry an end-of-post action, ` +
      `and the index gives every row a reading time.`,
  );
}

try {
  main();
} catch (error) {
  if (error instanceof Missing) {
    console.error(`blog funnel: INFRASTRUCTURE FAILURE — ${error.message}`);
    process.exit(2);
  }
  throw error;
}
