/*
 * The comparison makes claims about other people's projects, which is the one
 * place on this site where being wrong costs somebody else something.
 *
 * These tests hold the shape that keeps it honest: one source for the data, a
 * measurement date beside the table, an axis this SDK loses, and a verdict that
 * sends the reader elsewhere. None of them can check that a figure is true —
 * only re-measuring does that, and src/lib/comparison.mjs records how.
 *
 * The subject was /compare until that page folded into /product. Every
 * assertion below names the page it reads, so the fold moved the file names and
 * left the contract alone.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { MEASURED_ON, axes, libsignalReadme, notes, projects } from '../src/lib/comparison.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

/* Copy only. An Astro page's comments are not served, and /product's carry
 * dates for their own decisions — the founder review of the h1, most of all.
 * A guard that reads them cannot tell a rendered claim from a note about one. */
const copy = async (path) =>
  (await read(path))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ');

test('dates the measurement and prints the date where the table is', async () => {
  assert.match(MEASURED_ON, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(MEASURED_ON)), `${MEASURED_ON} is not a date`);

  /* messaging.md §1.3: a comparison with no date is a claim that quietly
   * becomes false. Rendering MEASURED_ON is what makes the page checkable, so
   * the page has to import it rather than restate a date in prose. */
  const product = await copy('../src/pages/product.astro');
  assert.match(product, /MEASURED_ON/);
  assert.doesNotMatch(
    product,
    /\b20\d\d-\d\d-\d\d\b/,
    'dates in the copy belong in comparison.mjs, where they are measured',
  );
});

test('keeps every row the same width as the header', async () => {
  for (const row of axes) {
    assert.equal(
      row.cells.length,
      projects.length,
      `"${row.axis}" has ${row.cells.length} cells for ${projects.length} projects`,
    );
  }
});

test('writes one note per project and marks exactly one as ours', async () => {
  assert.deepEqual(
    notes.map((note) => note.key).sort(),
    projects.map((project) => project.key).sort(),
  );
  assert.equal(projects.filter((project) => project.ours).length, 1);

  for (const project of projects) {
    assert.match(project.href, /^https:\/\//, `${project.name} must link somewhere`);
  }
  for (const note of notes) {
    assert.ok(note.heading && note.body && note.verdict, `${note.key} is missing prose`);
  }
});

test('states an axis this SDK loses', async () => {
  /* messaging.md §1.2: the limit goes in the same breath as the capability. A
   * matrix whose own column is "Yes" all the way down is read as marketing,
   * and would be — ts-mls ships post-quantum signatures and this SDK does not.
   * If that changes, the fix is a different losing axis, not deleting this. */
  const ourColumn = projects.findIndex((project) => project.ours);
  const lost = axes.filter((row) => /^No\b/.test(row.cells[ourColumn]));
  assert.ok(lost.length > 0, 'every axis favours us, which no honest comparison does');
});

test('sends the reader to somebody else where that is the right answer', async () => {
  const elsewhere = notes.filter((note) => !projects.find((p) => p.key === note.key)?.ours);
  const recommending = elsewhere.filter((note) => /\buse\b|\breach for\b/i.test(note.verdict));
  assert.ok(
    recommending.length >= 2,
    'no verdict recommends an alternative; a page that only ever concludes "use ours" is an ad',
  );
});

test('quotes libsignal accurately and attributes it', async () => {
  assert.match(libsignalReadme.quote, /Use outside of Signal is unsupported\./);
  assert.match(libsignalReadme.attribution, /signalapp\/libsignal/);
  assert.match(libsignalReadme.href, /^https:\/\/github\.com\/signalapp\/libsignal/);

  /* messaging.md §5 names this the strongest single quote available, and a
   * quotation is evidence for the table rather than a footnote to it: it goes
   * above the rows it explains. It spent a release two thirds of the way down
   * the homepage, and a release on a route of its own.
   *
   * Both sentences ship together here. The second is the one about APIs
   * changing without notice, which is what "unsupported" costs a reader who is
   * planning a roadmap, and quoting only the famous half loses it. */
  const product = await flat('../src/pages/product.astro');
  assert.match(product, /\{libsignalReadme\.quote\}\s*\{libsignalReadme\.continuation\}/);
  assert.ok(
    product.indexOf('libsignalReadme.quote') < product.indexOf('axes.map'),
    'the table is above the quotation that justifies it',
  );
});

test('keeps the matrix in one place', async () => {
  const pages = await readdir(new URL('../src/pages', import.meta.url));
  const others = pages.filter((page) => page.endsWith('.astro') && page !== 'product.astro');

  for (const page of others) {
    const source = await read(`../src/pages/${page}`);
    const imported = source.match(/import\s*\{([^}]*)\}\s*from\s*'[^']*comparison\.mjs'/)?.[1] ?? '';
    assert.doesNotMatch(
      imported,
      /\baxes\b/,
      `${page} renders the matrix; /product owns it so the two cannot drift`,
    );
  }
});

test('keeps the comparison reachable now that it has no route of its own', async () => {
  const [header, index, product, redirects] = await Promise.all([
    flat('../src/components/Header.astro'),
    flat('../src/pages/index.astro'),
    flat('../src/pages/product.astro'),
    read('../public/_redirects'),
  ]);

  /* The section id is the whole reachability story: it is the redirect target
   * for the retired route and the anchor the homepage summary points at. */
  assert.match(product, /id="how-it-compares"/);
  assert.match(index, /href="\/product#how-it-compares"/);
  /* The homepage summarises the matrix in prose. Importing the date means the
   * summary ages with the measurement instead of outliving it. */
  assert.match(index, /MEASURED_ON/);

  /* Not a nav item, and not a route. Both were true of /compare for eleven
   * releases, so both are the shapes an edit would restore by habit. */
  assert.doesNotMatch(header, /href: '\/compare'/);
  const pages = await readdir(new URL('../src/pages', import.meta.url), { recursive: true });
  assert.ok(!pages.includes('compare.astro'), '/compare is a page again');

  for (const path of ['/compare', '/compare/']) {
    assert.ok(
      redirects.split('\n').some((line) => line.startsWith(`${path} /product/#how-it-compares `)),
      `${path} does not redirect to the section that replaced it`,
    );
  }
});
