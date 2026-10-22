/*
 * Support that a reader without an account can reach.
 *
 * The console `/contact` page sends an anonymous visitor to sign-in, so a link
 * to it from this site offers support only to a reader who already has an
 * account. The support address is the one that the Relay terms and the
 * Commercial Terms name, and the contact page links it directly.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

/*
 * A comment may name the console page. A line of code or prose may not. Only
 * a block comment and a `//` line comment are removed: a Markdown paragraph
 * can start with `**`, so a line that starts with `*` is not a comment.
 */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no page links the console contact page', async () => {
  const root = new URL('../src/', import.meta.url);
  const offenders = [];
  for (const entry of await readdir(root, { recursive: true })) {
    if (!/\.(astro|mdx?|mjs|ts|tsx)$/.test(entry)) continue;
    const text = code(await readFile(new URL(entry, root), 'utf8'));
    if (/console\.open-e2ee\.dev\/contact\b/.test(text)) offenders.push(`src/${entry}`);
  }
  assert.deepEqual(offenders, [], `${offenders.join(', ')} links the console contact page, which requires sign-in`);
});

test('current contact pages route each request to its role address', async () => {
  const contact = code(await read('src/pages/contact.astro'));
  assert.match(contact, /<a href="mailto:support@open-e2ee\.dev">Customer support<\/a>/);
  assert.match(contact, /mailto:privacy@open-e2ee\.dev\?subject=Privacy%20request/);
  assert.match(contact, /mailto:legal@open-e2ee\.dev\?subject=Legal%20question/);
  assert.match(contact, /mailto:sales@open-e2ee\.dev\?subject=Relay%20plans/);
  for (const path of ['src/pages/contact.astro', 'src/pages/licensing.astro', 'src/pages/legal/index.astro']) {
    const current = code(await read(path));
    assert.match(current, /mailto:legal@open-e2ee\.dev/);
    assert.doesNotMatch(current, /licensing@open-e2ee\.dev/);
  }
});
