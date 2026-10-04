/*
 * /playground is the browser example that this website owns. Its source is
 * `playground/`, and `scripts/build-playground.mjs` bundles it against the
 * installed SDK and the page relay in `src/lib/demo/relay.ts`.
 *
 * These tests hold it to two things. The exchange it runs works against the
 * installed SDK, end to end. And the page points at its own source, not at an
 * example in the SDK repository that the SDK no longer ships.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runExchange } from '../playground/src/exchange.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('runs the playground exchange against the installed SDK', async () => {
  const lines = [];
  await runExchange('hello from my browser', (line) => lines.push(line));

  /* Both directions, in order, with ciphertext the relay held in between. */
  assert.deepEqual(
    lines.filter((line) => /decrypted:/.test(line)),
    ['bob decrypted: hello from my browser', 'alice decrypted: Received: hello from my browser'],
  );
  assert.equal(lines.filter((line) => /^Relay → \w+: \d+ base64 characters of ciphertext$/.test(line)).length, 2);
  assert.equal(lines.at(-1), 'PASS: both devices decrypted the expected messages.');
});

test('refuses a message the page would not send', async () => {
  await assert.rejects(runExchange('   ', () => {}), /1 to 2000 characters/);
  await assert.rejects(runExchange('x'.repeat(2001), () => {}), /1 to 2000 characters/);
});

test('builds from its own source and links to it', async () => {
  const [build, markup, exchange] = await Promise.all([
    read('../scripts/build-playground.mjs'),
    read('../playground/index.html'),
    read('../playground/src/exchange.ts'),
  ]);

  /* The SDK package carries no browser example from 9.0.0. A build that
   * still read one from node_modules would fail on the next install. */
  assert.match(build, /resolve\(site, 'playground'\)/);
  assert.doesNotMatch(build, /examples\/browser/);

  /* The page links to the code it runs, and to nothing in the SDK repository
   * that names a version this site does not run. */
  assert.match(markup, /href="https:\/\/github\.com\/open-e2ee\/website\/blob\/main\/playground\/src\/exchange\.ts"/);
  assert.doesNotMatch(markup, /examples\/browser|stackblitz|signal-protocol-js\/tree\//i);

  /* The relay is the one this site owns. The SDK exports no relay that runs
   * in a page. */
  assert.match(exchange, /import \{ pageRelay \} from '\.\.\/\.\.\/src\/lib\/demo\/relay\.ts';/);
  assert.doesNotMatch(exchange, /remote\/relay\/memory|inMemoryRelay/);
});
