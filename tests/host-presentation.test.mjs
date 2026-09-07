/*
 * The website draws at the shared density.
 *
 * The website, the console, and the documentation host each answered five
 * questions on their own: the size of interface text, the leading under it,
 * the weight of a hairline, and the height and the corner of a control. Three
 * surfaces answering the same question separately is three products, and the
 * answers had already drifted before the measures moved.
 *
 * @open-e2ee/design owns the answers. This file asserts that the website reads
 * them rather than writing a number of its own, and that the names it writes
 * are the names the package publishes.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const read = (path) => readFile(resolve(process.cwd(), path), 'utf8');

async function* sources(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(?:astro|ts|mjs|css)$/.test(entry.name)) yield path;
  }
}

const ROLES = 'node_modules/@open-e2ee/design/packages/design/dist/css/roles.css';

const CHROME = [
  'src/components/Header.astro',
  'src/components/Footer.astro',
  'src/lib/recipes.ts',
];

test('the interface text reads the shared size and leading', async () => {
  const css = await read('src/styles/global.css');
  const start = css.indexOf('\n  body {');
  const block = css.slice(start, css.indexOf('}', start));

  assert.match(block, /font-size: var\(--oe-body-size\);/);
  assert.match(block, /line-height: var\(--oe-body-leading\);/);
  // A literal beside the measure is a second answer that wins by order.
  assert.doesNotMatch(block, /font-size: [^v]/);
  assert.doesNotMatch(block, /line-height: [^v]/);
});

test('the page chrome draws every hairline at the shared rule weight', async () => {
  const [header, footer, recipes] = await Promise.all(CHROME.map(read));

  assert.match(header, /<header class="sticky top-0 z-10 rule-b /);
  assert.match(footer, /class="rule-t bg-ground-panel /);
  assert.match(recipes, /export const BAND = 'rule-t /);
  assert.match(recipes, /export const ARTICLE_META = `mt-6 [^`]*\brule-t\b/);
  // A rule between two records is the measure's own example.
  assert.match(recipes, /\[&_th\]:rule-b/);
  assert.match(recipes, /\[&_td\]:rule-b/);
  assert.match(recipes, /\[&>li\]:rule-t/);
});

test('the callout is the only hairline the rule utility cannot draw', async () => {
  const remaining = [];
  for await (const path of sources('src')) {
    const source = await read(path);
    for (const line of source.split('\n')) {
      if (line.includes('border-border-1')) remaining.push(`${path}: ${line.trim()}`);
    }
  }

  assert.equal(remaining.length, 1, remaining.join('\n'));
  /*
   * Tailwind emits an arbitrary-value utility before a custom one, so the rule
   * shorthand would land after border-l-[3px] and erase the leading edge that
   * carries this callout's meaning.
   */
  assert.match(remaining[0], /border-l-\[3px\] border-l-\[var\(--oe-sealed\)\]/);
});

test('every class the website writes is a class the package publishes', async () => {
  const roles = await read(ROLES);

  for (const [key, token] of [
    ['--text-body', '--oe-body-size'],
    ['--leading-body', '--oe-body-leading'],
    ['--radius-control', '--oe-control-radius'],
    ['--spacing-control', '--oe-control-height'],
  ]) {
    assert.match(
      roles,
      new RegExp(`  ${key}: var\\(${token}\\);`),
      `The role layer does not publish ${token} as ${key}`,
    );
  }

  for (const [utility, property] of [
    ['rule', 'border'],
    ['rule-t', 'border-top'],
    ['rule-b', 'border-bottom'],
    ['rule-y', 'border-block'],
  ]) {
    assert.match(
      roles,
      new RegExp(
        `@utility ${utility} \\{\\n  ${property}: var\\(--oe-rule-weight\\) solid var\\(--oe-border-1\\);`,
      ),
      `The role layer does not publish ${utility}`,
    );
  }
});
