/*
 * The new-tab rule, tested on the function rather than on a build.
 *
 * The build audit proves the rule ran over the pages that exist today. These
 * cover the cases the site does not currently contain but will: a link that
 * already carries a target, a rel that must not be clobbered, and the two
 * different ways an anchor gets an accessible name.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { rewrite } from '../scripts/external-links.mjs';

const anchor = (html) => rewrite(html);

test('sends off-site links to a new tab, and leaves our own pages alone', () => {
  assert.match(anchor('<a href="https://github.com/open-e2ee">SDK</a>'), /target="_blank"/);
  /* Different host, same organisation: the reader still keeps the page they
   * were reading, which is the whole point of the rule. */
  assert.match(anchor('<a href="https://docs.open-e2ee.dev">Docs</a>'), /target="_blank"/);
  assert.match(anchor('<a href="https://console.open-e2ee.dev">Console</a>'), /target="_blank"/);

  for (const same of [
    '<a href="/pricing">Pricing</a>',
    '<a href="#cookies">Cookies</a>',
    '<a href="https://open-e2ee.dev/security">Security</a>',
  ]) {
    assert.equal(anchor(same), same);
  }
});

test('leaves a hand-off protocol where it is', () => {
  /* A mail client or dialler takes over; the blank tab left behind is litter. */
  for (const handoff of [
    '<a href="mailto:security@open-e2ee.dev">Report</a>',
    '<a href="tel:+15551234567">Call</a>',
  ]) {
    assert.equal(anchor(handoff), handoff);
  }
});

test('says that the link opens a new tab, in whichever way the link is named', () => {
  /* An icon-only link's `aria-label` is its entire accessible name, so text
   * appended inside it is never announced. The label has to carry the hint. */
  const labelled = anchor('<a href="https://github.com/x" aria-label="The SDK on GitHub"><svg/></a>');
  assert.match(labelled, /aria-label="The SDK on GitHub \(opens in a new tab\)"/);
  assert.doesNotMatch(labelled, /visually-hidden/);

  const worded = anchor('<a href="https://github.com/x">Read the source</a>');
  assert.match(worded, /Read the source<span class="oe-visually-hidden"> \(opens in a new tab\)<\/span>/);
});

test('hides the hint with a class something actually defines', async () => {
  /* The hint is the one piece of markup this site emits after the stylesheet
   * has been written, so a rename in CSS cannot fail its build — it just puts
   * "(opens in a new tab)" on the page in full size next to twenty links.
   * That is exactly what happened when the controls moved to the design
   * package and `.visually-hidden` became `.oe-visually-hidden`. */
  const emitted = anchor('<a href="https://github.com/x">Read the source</a>')
    .match(/<span class="([^"]+)"/)?.[1];
  assert.ok(emitted, 'the hint should be wrapped in a span with a class');

  const { readFile } = await import('node:fs/promises');
  const components = await readFile(
    new URL(
      '../node_modules/@open-e2ee/design/packages/design/dist/css/components.css',
      import.meta.url,
    ),
    'utf8',
  );
  assert.match(components, new RegExp(`\\.${emitted}\\s*\\{`));
});

test('does not overrule a target the source set deliberately', () => {
  const framed = '<a href="https://github.com/x" target="_self">Same tab</a>';
  assert.equal(anchor(framed), framed);
});

test('adds to an existing rel rather than replacing it', () => {
  const out = anchor('<a href="https://example.com" rel="nofollow">Rival</a>');
  assert.match(out, /rel="nofollow noopener"/);
  /* Twice through the rewrite must not stack the token. */
  assert.match(rewrite(anchor('<a href="https://example.com" rel="noopener">x</a>')), /rel="noopener"/);
});

test('protects the opener on every tab it opens', () => {
  const out = anchor('<a href="https://example.com">Rival</a>');
  assert.match(out, /rel="[^"]*\bnoopener\b/);
});
