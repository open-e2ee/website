/*
 * The header renders its links twice: a row of words at desktop width, and a
 * sheet a phone opens. Two renderings of one set is a set that can drift, and
 * the drift is invisible at either width alone — a reader on a phone never sees
 * the row, and a reader on a laptop never opens the sheet.
 *
 * The guards below read the built pages, because the question is what shipped.
 * The source-side ones hold the shape that makes drift impossible rather than
 * merely absent today, and they run whether or not dist/ exists.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { declaration, navigationSource } from './navigation-source.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

/*
 * Comments removed. Every argument this component carries names the thing it
 * rejected — the disclosure element it replaced, the destinations it does not
 * hold — so a negative asserted against the raw file forbids the file from
 * explaining itself.
 */
const code = async (path) =>
  (await read(path)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

/*
 * dist/ is absent on a clean checkout and present in CI, which builds before it
 * tests. A bare skip would let a dist-reading guard report a pass in the one
 * place it is the only guard there is.
 */
const skipUnbuilt = (page) => {
  assert.ok(
    !process.env.CI,
    `${page} is missing — CI builds before it tests, so a dist-reading assertion must never skip here`,
  );
};

/** Every built page, so the header is read where a reader meets it. */
async function builtPages() {
  const dist = new URL('../dist/', import.meta.url);
  const entries = await readdir(dist, { recursive: true }).catch(() => null);
  if (!entries) return null;
  return entries.filter((entry) => entry.endsWith('index.html')).sort();
}

/** The hrefs inside one element, in the order the page carries them. */
function hrefsIn(html, opening) {
  const start = html.indexOf(opening);
  assert.ok(start >= 0, `the page no longer renders ${opening}`);
  const end = html.indexOf('</nav>', start);
  assert.ok(end > start, `${opening} is no longer a closed element`);
  const block = html.slice(start, end);
  return [...block.matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
}

test('renders one link set at both widths on every built page', async () => {
  const pages = await builtPages();
  if (!pages) return skipUnbuilt('dist/');
  assert.ok(pages.length > 0, 'the build produced no pages');

  for (const page of pages) {
    const html = await read(`../dist/${page}`);
    const row = hrefsIn(html, '<nav class="site-nav"');
    const sheet = hrefsIn(html, '<nav aria-label="Site"');

    /* The sheet carries one destination the row does not: at this width the
       console link leaves the action row, because a row of icons plus a word
       is the odd thing the sheet exists to absorb. It is the last entry, and
       everything before it is the row itself, in order. */
    assert.deepEqual(
      sheet.slice(0, row.length),
      row,
      `${page} renders a different link set in the sheet than in the row`,
    );
    assert.equal(
      sheet.length,
      row.length + 1,
      `${page} adds more than the console link to the sheet`,
    );
    assert.equal(sheet.at(-1), 'https://console.open-e2ee.dev');
  }
});

test('marks the page being read in both renderings, and never marks a fragment', async () => {
  const pages = await builtPages();
  if (!pages) return skipUnbuilt('dist/');

  const product = await read('../dist/product/index.html');
  /* One rendering marking the current page and the other not is the drift a
     shared array does not by itself prevent: the marker is computed per link. */
  assert.equal(
    (product.match(/<a href="\/product" aria-current="page">/g) ?? []).length,
    2,
    'the row and the sheet disagree about which page is being read',
  );

  /* The demo is a band on the homepage, so its item names a place on a page
     rather than a page. Marking it would mark it on the page it points into. */
  const home = await read('../dist/index.html');
  assert.ok(!home.includes('<a href="/#demo" aria-current='), 'the demo item claims to be a page');
});

test('builds both renderings from the one array', async () => {
  const flat = await code('../src/components/Header.astro');

  /* Two maps over one array. A second literal list is the shape that drifts,
     and it is the shape this component had before UIR5.2. */
  assert.equal(
    (flat.match(/headerNavigation\.map\(/g) ?? []).length,
    2,
    'the header no longer renders both surfaces from headerNavigation',
  );
  /* No destination is written in the component. A link added to the markup is
     a link one of the two surfaces has and the other does not. */
  assert.doesNotMatch(flat, /<a href="\//, 'the header writes a destination of its own');
});

test('gives the sheet the console pattern: a named panel, closed to begin with', async () => {
  const header = await code('../src/components/Header.astro');

  /* The console's sheet is a button that owns its state and a panel the button
     names. `<details>` stood here and expressed neither, so no assistive
     technology could be told what the control operates. */
  assert.match(header, /aria-controls="site-navigation-sheet"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(header, /<nav aria-label="Site" hidden id="site-navigation-sheet">/);
  assert.doesNotMatch(header, /<details/, 'the disclosure element is back');

  /* Escape closes and returns focus to the trigger, and a press outside closes
     without stealing the press. Both are behaviors the element it replaced had
     for free, and a sheet that drops them is a worse control than the one it
     replaced. */
  assert.match(header, /event\.key !== 'Escape'/);
  assert.match(header, /trigger\.focus\(\)/);
  assert.match(header, /!root\.contains\(event\.target\)/);
});

test('offers the two products the site sells and the one thing it teaches', async () => {
  const header = await declaration('headerNavigation');

  /* The site sells two products. The header named one of them and reached the
     other through the first one's pricing page. */
  assert.match(header, /\{ href: '\/product', label: 'SDK' \}/);
  assert.match(header, /\{ href: '\/relay', label: 'Relay' \}/);
  assert.match(header, /\{ href: '\/blog', label: 'Blog' \}/);

  /* "Product" was a category label for a company with one product. Keeping it
     beside a second product's name is the state this replaced. */
  assert.doesNotMatch(header, /label: 'Product'/);
});

test('declares every header and footer destination in one module', async () => {
  const [source, footer] = await Promise.all([
    navigationSource(),
    code('../src/components/Footer.astro'),
  ]);

  assert.match(source, /export const headerNavigation/);
  assert.match(source, /export const footerGroups/);

  /* The footer's groups are the array's groups. A group written into the
     component is a group the module cannot be asked about. */
  assert.match(footer, /footerGroups\.map\(/);
  assert.doesNotMatch(footer, /heading: '/, 'the footer declares a group of its own');
});
