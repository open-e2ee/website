/*
 * The privacy notice makes specific promises about what the marketing site
 * measures. These tests hold the code to them: that the nine events the client
 * can send are the nine the server accepts and the nine the notice describes,
 * and that nothing in the path identifies a visitor.
 *
 * The collector itself is exercised through its exported `collect`, with a
 * stub dataset standing in for the Analytics Engine binding.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collect } from '../src/workers/site.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

const EVENTS = [
  'quickstart_open',
  'runtime_select',
  'install_copy',
  'guide_finish',
  'github_open',
  'security_view',
  'pricing_view',
  'signup_start',
  'enterprise_contact',
];

/** A dataset binding that records what would have been written. */
function stubEnv() {
  const written = [];
  return {
    written,
    ASSETS: { fetch: async () => new Response('asset') },
    MEASUREMENTS: { writeDataPoint: (point) => written.push(point) },
  };
}

const beacon = (body) =>
  new Request('https://open-e2ee.dev/e', {
    method: 'POST',
    body,
    headers: { origin: 'https://open-e2ee.dev' },
  });

test('records each of the nine events and nothing else', async () => {
  for (const event of EVENTS) {
    const env = stubEnv();
    await collect(beacon(`${event} /pricing`), env);
    assert.equal(env.written.length, 1, `${event} should be recorded`);
    assert.equal(env.written[0].blobs[0], event);
  }

  const env = stubEnv();
  await collect(beacon('page_view /pricing'), env);
  await collect(beacon('../../etc/passwd /'), env);
  await collect(beacon(''), env);
  assert.deepEqual(env.written, [], 'unknown event names must be dropped');
});

test('stores only a label the site actually chooses between', async () => {
  const env = stubEnv();
  await collect(beacon('runtime_select /  expo'), env);
  await collect(beacon('runtime_select / node'), env);
  await collect(beacon('runtime_select / user@example.com'), env);
  assert.deepEqual(
    env.written.map((point) => point.blobs[2]),
    ['', 'node', ''],
  );
});

test('refuses to store a path that could carry a payload', async () => {
  const env = stubEnv();
  const paths = [
    ['/pricing', '/pricing'],
    ['/blog/tls-is-not-end-to-end-encryption', '/blog/tls-is-not-end-to-end-encryption'],
    /* A path is the one field a caller controls freely, so it is reduced to
     * the shape our own routes have. Anything else becomes a single bucket
     * rather than a place to hide an email address or a visitor id. */
    ['/pricing?email=someone@example.com', '/pricing'],
    ['/pricing#Someone', '/pricing'],
    ['https://elsewhere.example/pricing', '/other'],
    ['/A0B1C2D3-E4F5', '/other'],
    [`/${'x'.repeat(200)}`, '/other'],
  ];
  for (const [sent] of paths) {
    await collect(beacon(`pricing_view ${sent}`), env);
  }
  assert.deepEqual(
    env.written.map((point) => point.blobs[1]),
    paths.map(([, stored]) => stored),
  );
});

test('answers identically whether or not the event was recorded', async () => {
  const env = stubEnv();
  const accepted = await collect(beacon('pricing_view /pricing'), env);
  const rejected = await collect(beacon('made_up /pricing'), env);

  for (const response of [accepted, rejected]) {
    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('keeps working when the dataset is not bound', async () => {
  const response = await collect(beacon('pricing_view /pricing'), {
    ASSETS: { fetch: async () => new Response('asset') },
  });
  assert.equal(response.status, 204);
});

test('rejects a beacon from another origin and any method but POST', async () => {
  const env = stubEnv();
  const crossOrigin = new Request('https://open-e2ee.dev/e', {
    method: 'POST',
    body: 'pricing_view /pricing',
    headers: { origin: 'https://elsewhere.example' },
  });
  assert.equal((await collect(crossOrigin, env)).status, 403);
  assert.equal((await collect(new Request('https://open-e2ee.dev/e'), env)).status, 405);
  assert.deepEqual(env.written, []);
});

test('sets nothing on the device and reads nothing from it', async () => {
  const script = await read('../public/measure.js');

  /* The privacy notice says no cookie, no storage, no fingerprint, no
   * identifier. The script is small enough that saying so is checkable. */
  for (const forbidden of [
    'cookie',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'randomUUID',
    'canvas',
    'userAgent',
    'Date.now',
    'referrer',
  ]) {
    assert.doesNotMatch(script, new RegExp(forbidden), `measure.js must not touch ${forbidden}`);
  }

  assert.match(script, /navigator\.sendBeacon\('\/e'/);
  assert.match(script, /fetch\('\/e'/);
  /* Same-origin only: an absolute URL here would be a third-party collector. */
  assert.doesNotMatch(script, /https?:\/\//);
});

test('stays small enough to be beneath notice', async () => {
  const script = await read('../public/measure.js');
  assert.ok(
    Buffer.byteLength(script) < 2048,
    `measure.js is ${Buffer.byteLength(script)} bytes; marketing JS should stay negligible`,
  );
});

test('sends only the events the collector accepts', async () => {
  const script = await read('../public/measure.js');
  /* Event names reach `send` three ways — directly, through a ternary, and
   * through the view lookup — so match on the shape of the name itself and
   * check the set both ways round. */
  const named = new Set(
    [...script.matchAll(/'([a-z]+_[a-z]+)'/g)]
      .map((match) => match[1])
      .filter((name) => !name.startsWith('signal_')),
  );

  for (const event of named) {
    assert.ok(EVENTS.includes(event), `${event} is sent but the collector would drop it`);
  }
  for (const event of EVENTS) {
    assert.ok(named.has(event), `${event} is accepted but nothing on the site sends it`);
  }
});

test('describes the measurement in the privacy notice it points at', async () => {
  const [privacy, script] = await Promise.all([
    flat('../src/pages/legal/privacy.astro'),
    read('../public/measure.js'),
  ]);

  assert.match(script, /\/legal\/privacy/);
  assert.match(privacy, /sets no cookie/i);
  assert.match(privacy, /nine things/i);
  assert.match(privacy, /IP address is not recorded/i);
  assert.match(privacy, /no third-party analytics service receives it/i);
  /* The old text claimed the site measured nothing at all. */
  assert.doesNotMatch(privacy, /does not currently use advertising cookies/i);
});
