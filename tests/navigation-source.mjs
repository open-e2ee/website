/*
 * Read one declaration out of src/lib/site-navigation.ts.
 *
 * The module is TypeScript, so `node --test` cannot import it and a guard has
 * to read the source. Reading the whole file is what makes a guard wrong:
 * `/href: '\/compare'/` is a true negative about the header and a false one
 * about the file, because the footer names /compare/virgil-security three
 * declarations below. Every question this suite asks is about one array, so
 * every read is bounded to one array.
 *
 * Comments are stripped first. Each array in that module carries the argument
 * for what is in it and what is not, and those paragraphs name the very
 * destinations the negatives forbid.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SOURCE = new URL('../src/lib/site-navigation.ts', import.meta.url);

/** The whole module, comments removed, whitespace collapsed. */
export async function navigationSource() {
  const text = await readFile(SOURCE, 'utf8');
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
}

/**
 * One exported array, from its name to the `]` that closes it. Fails when the
 * declaration is gone, so a renamed export cannot leave a guard reading nothing
 * and reporting a pass.
 */
export async function declaration(name) {
  const source = await navigationSource();
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `site-navigation.ts no longer exports ${name}`);
  const end = source.indexOf('];', start);
  assert.ok(end > start, `${name} is no longer an array`);
  return source.slice(start, end);
}
