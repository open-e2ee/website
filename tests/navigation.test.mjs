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

/*
 * The hrefs inside one of the two navigations, in the order the page carries
 * them.
 *
 * Found by its accessible name and not by a class. Both renderings are dressed
 * in utilities now, so neither carries a name in its class attribute, and the
 * name a reader of a screen reader hears is the one thing about either that is
 * not a style. The attribute sits after `class` in the built tag, so the opening
 * tag is matched rather than prefixed.
 */
function hrefsIn(html, label) {
  const opening = new RegExp(`<nav[^>]*aria-label="${label}"[^>]*>`);
  const found = html.match(opening);
  assert.ok(found, `the page no longer renders a <nav> named "${label}"`);
  const start = found.index;
  const end = html.indexOf('</nav>', start);
  assert.ok(end > start, `the "${label}" navigation is no longer a closed element`);
  const block = html.slice(start, end);

  /* `<a [^>]*href` and not `<a href`: every link in both renderings opens with a
     class list now, and the narrower pattern matched nothing at all — which
     returned two empty sets that agreed with each other. */
  return [...block.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1]);
}

test('renders one link set at both widths on every built page', async () => {
  const pages = await builtPages();
  if (!pages) return skipUnbuilt('dist/');
  assert.ok(pages.length > 0, 'the build produced no pages');

  for (const page of pages) {
    const html = await read(`../dist/${page}`);
    const row = hrefsIn(html, 'Primary');
    const sheet = hrefsIn(html, 'Site');

    /* The sheet carries two destinations the row does not: at this width both
       console entries leave the action row, because a row of icons plus a word
       plus a filled control is what the sheet exists to absorb. They are the
       last two entries, sign in then start, and everything before them is the
       row itself, in order. */
    assert.deepEqual(
      sheet.slice(0, row.length),
      row,
      `${page} renders a different link set in the sheet than in the row`,
    );
    assert.equal(
      sheet.length,
      row.length + 2,
      `${page} adds more than the two console entries to the sheet`,
    );
    assert.deepEqual(sheet.slice(row.length), [
      'https://console.open-e2ee.dev',
      'https://console.open-e2ee.dev/products/relay/new',
    ]);
  }
});

test('marks the page being read in both renderings, and never marks a fragment', async () => {
  const pages = await builtPages();
  if (!pages) return skipUnbuilt('dist/');

  const product = await read('../dist/product/index.html');
  /* One rendering marking the current page and the other not is the drift a
     shared array does not by itself prevent: the marker is computed per link. */
  assert.equal(
    (product.match(/<a [^>]*href="\/product" aria-current="page">/g) ?? []).length,
    2,
    'the row and the sheet disagree about which page is being read',
  );

  /* The demo is a band on the homepage, so its item names a place on a page
     rather than a page. Marking it would mark it on the page it points into. */
  const home = await read('../dist/index.html');
  assert.doesNotMatch(
    home,
    /<a [^>]*href="\/#demo"[^>]*aria-current=/,
    'the demo item claims to be a page',
  );
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

  /* The panel's three attributes, read off its own opening tag rather than as a
     fixed string. The tag opens with a class list now, so a literal would be
     asserting the order the utilities happen to be written in. `hidden` is the
     closed-to-begin-with half: a sheet that ships open covers the page for every
     reader whose script has not run yet. */
  const sheet = header.match(/<nav [^>]*aria-label="Site"[^>]*>/)?.[0];
  assert.ok(sheet, 'the sheet is no longer a <nav> named "Site"');

  /* The class list comes off before the attributes are read. The sheet dresses
     itself with `[&[hidden]]:hidden`, which is the utility that makes a flex
     container honor the attribute — and a `\bhidden\b` over the whole tag reads
     that utility and passes with the attribute deleted. Mutation-tested: with
     `hidden` removed from the tag, the loose pattern still matched, inside the
     class. */
  const attributes = sheet.replace(/\sclass="[^"]*"/, ' ');
  assert.match(attributes, /\shidden[\s>]/, 'the sheet ships open');
  assert.match(
    attributes,
    /id="site-navigation-sheet"/,
    'the trigger names a panel that is not there',
  );
  assert.doesNotMatch(header, /<details/, 'the disclosure element is back');

  /* The panel spans the page, so it has to resolve against the header. The
     header is `sticky`, which is a positioned value and therefore a containing
     block. A position on the trigger's own wrapper takes that job instead, and
     the wrapper is the width of one 40px control: `left-4 right-4` inside it
     drew an 8px column with seven rows of navigation wrapped one character to
     a line. Measured at a 375px viewport, 8px wide before this rule and 343px
     after. */
  assert.match(sheet, /\btop-full\b/, 'the panel no longer hangs from the header');
  const wrapper = header.match(/<div [^>]*data-nav-sheet>/)?.[0];
  assert.ok(wrapper, 'the sheet root is no longer marked');
  assert.doesNotMatch(
    wrapper,
    /\b(relative|absolute|fixed|sticky)\b/,
    'the 40px trigger wrapper is the panel\'s containing block again',
  );

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

test('carries a start action in both header surfaces', async () => {
  /*
   * The word `Console` was the whole of account creation on this site. It sat
   * in the utility strip, 16 pixels from a theme toggle, dressed as a quiet
   * link, and no part of it said that a reader could begin there. At phone
   * width it was one row in a sheet that has to be opened first.
   *
   * A header start action is the one control on the site that is always in
   * reach, so both renderings carry it, and both draw it as a control rather
   * than as a word among words.
   */
  const startAction = await declaration('startAction');
  assert.match(startAction, /href: 'https:\/\/console\.open-e2ee\.dev\//);
  assert.match(startAction, /label: 'Start free'/);

  /* The returning reader keeps a route. Promoting the console entry to a start
     points it at the route that creates a project, which is the wrong room for
     someone who already has one, and the footer carries no console entry to
     fall back on. */
  const signIn = await declaration('consoleUrl');
  assert.match(signIn, /'https:\/\/console\.open-e2ee\.dev'/);

  const pages = await builtPages();
  if (!pages) return skipUnbuilt('dist/');

  for (const page of pages) {
    const html = await read(`../dist/${page}`);

    /* Two of it, one per rendering. A start action in the sheet alone is a
       start a laptop never sees, and one in the row alone is a start a phone
       never sees — and neither absence is visible at the other width. */
    const starts = html.match(/<a [^>]*data-start-action[^>]*>/g) ?? [];
    assert.equal(
      starts.length,
      2,
      `${page} draws ${starts.length} start actions; the row and the sheet want one each`,
    );
    for (const start of starts) {
      assert.match(start, /class="[^"]*\boe-button\b/, 'the start is drawn as a word, not a control');
      assert.match(start, /href="https:\/\/console\.open-e2ee\.dev\//);
    }

    /* Which of the two a reader sees is the wrapper's decision, never the
       control's own. `.oe-button` sets its own `display`, and the design
       stylesheet loads after the utilities, so a breakpoint utility on the
       button loses the cascade and the desktop start renders on a phone as
       well. Measured with the utility on the anchor: two starts on screen at
       375px, the row copy drawn 60x52 beside the menu trigger. */
    for (const control of [...starts, ...(html.match(/<a [^>]*data-sign-in[^>]*>/g) ?? [])]) {
      assert.doesNotMatch(
        control,
        /\b(?:max|min)-\[/,
        `${page} sets a breakpoint on a console control rather than on its wrapper`,
      );
    }

    /* Sign in stays beside it in both, and stays quiet: two filled controls
       state no order, and the one this header is drawn to state is that a
       reader with no account presses the other one. */
    const signIns = html.match(/<a [^>]*data-sign-in[^>]*>/g) ?? [];
    assert.equal(signIns.length, 2, `${page} draws ${signIns.length} sign-in links, not two`);
    for (const link of signIns) {
      assert.doesNotMatch(link, /\boe-button\b/, 'sign in is drawn as a control beside the start');
    }
  }
});
