/*
 * The Relay connection variable, as the site names it.
 *
 * `oe new` and `oe config push` write the connection URL to the variable that
 * the app's framework exposes to client code: `NEXT_PUBLIC_`, `EXPO_PUBLIC_`,
 * or `VITE_` before `OPEN_E2EE_RELAY_URL`, and the bare name only when
 * package.json names none of those frameworks. The OpenE2EE CLI owns that
 * table (`internal/envfile` in open-e2ee/oe). A page that names only the bare
 * variable tells a Next.js, Expo, or Vite reader to read a name the CLI never
 * wrote, and a framework app that reads it gets `undefined` in client code.
 */

import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const PREFIXES = ['NEXT_PUBLIC_', 'EXPO_PUBLIC_', 'VITE_'];

test('the Relay page names the framework prefix on the connection variable', async () => {
  const relay = await read('src/pages/relay/index.astro');
  const row = relay.match(/<dt>One variable<\/dt><dd>([\s\S]*?)<\/dd>/)?.[1];
  assert.ok(row, 'the Relay page has no "One variable" row');
  assert.match(row, /<code>OPEN_E2EE_RELAY_URL<\/code>/);
  for (const prefix of PREFIXES) {
    assert.ok(row.includes(`<code>${prefix}</code>`), `the "One variable" row does not name ${prefix}`);
  }
});

/*
 * Expo inlines only `EXPO_PUBLIC_` variables into the app bundle, so an Expo
 * sample that reads the bare name runs with an undefined connection URL. A
 * post is an Expo sample when it imports the SDK's Expo store.
 */
test('an Expo code sample reads the connection variable that Expo inlines', async () => {
  const directory = 'src/content/blog/';
  const posts = (await readdir(new URL(`../${directory}`, import.meta.url))).filter((name) =>
    name.endsWith('.mdx'),
  );
  let checked = 0;
  for (const name of posts) {
    const post = await read(`${directory}${name}`);
    if (!post.includes('@open-e2ee/signal-protocol-sdk/local/store/expo')) continue;
    const reads = [...post.matchAll(/process\.env\.([A-Z_]*OPEN_E2EE_RELAY_URL)\b/g)].map((match) => match[1]);
    for (const variable of reads) {
      assert.equal(variable, 'EXPO_PUBLIC_OPEN_E2EE_RELAY_URL', `${name} reads ${variable} in an Expo app`);
    }
    checked += reads.length;
  }
  assert.ok(checked > 0, 'no Expo sample reads the Relay connection variable, so this guard checks nothing');
});
