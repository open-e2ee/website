/*
 * The privacy notice makes specific promises about what the marketing site
 * measures. These tests hold the code to them: that the events the client can
 * send are the ones the server accepts and the ones the notice describes, and
 * that nothing in the path identifies a visitor. All three legs are read from
 * the code — the collector's own `EVENTS`, the files that send, and the notice
 * itself — because a list retyped in this file agrees with the collector until
 * the moment someone changes one of them.
 *
 * The collector itself is exercised through its exported `collect`, with a
 * stub dataset standing in for the Analytics Engine binding.
 */

import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { EVENTS, LABELS, collect } from '../src/workers/site.ts';
import { SCENARIOS } from '../src/lib/demo/scenarios/catalog.ts';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

/*
 * Every file on the site that names an event. `measure.js` covers everything a
 * link or a copy can express; a page script with an event of its own calls the
 * `oeMeasure` that file publishes, and the demo panel is the first to do it.
 * A sender that is not on this list is invisible to the set check below, so a
 * new one belongs here in the same commit that writes it.
 */
const SENDERS = [
  '../public/measure.js',
  '../src/components/demo/LiveCarrierPanel.astro',
  '../src/components/demo/ScenarioList.astro',
];

/*
 * How the privacy notice counts the events, so the sentence a reader is asked
 * to trust is checked against the collector rather than against a number typed
 * beside it. Only the counts this site has plausibly reached are here; an
 * eleventh event should fail loudly here and be added deliberately.
 */
const NUMBER_WORDS = { 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };

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

test('records each event the collector accepts and nothing else', async () => {
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

/*
 * Compressed, because that is what a reader downloads — Cloudflare serves this
 * file gzipped and the budget is about their connection, not our disk. Counting
 * raw bytes taxed the comments at the same rate as the code, in the one file
 * whose comments are the documentation of a privacy claim; the budget is the
 * same promise measured where it lands. For scale: 1,222 B today, against a
 * page that ships several hundred kilobytes of type. Node's default level and
 * level 9 both give that figure for this file, so the budget does not depend
 * on which one a reader reaches for.
 */
test('stays small enough to be beneath notice', async () => {
  const bytes = gzipSync(await read('../public/measure.js')).byteLength;
  assert.ok(bytes < 1536, `measure.js is ${bytes} bytes gzipped; marketing JS should stay negligible`);
});

test('sends only the events the collector accepts', async () => {
  /* Event names reach a beacon several ways — directly, through a ternary,
   * through the view lookup, and from a page script calling `oeMeasure` — so
   * match on the shape of the name itself and check the set both ways round. */
  const named = new Set();
  for (const sender of SENDERS) {
    for (const match of (await read(sender)).matchAll(/'([a-z]+_[a-z]+)'/g)) {
      if (!match[1].startsWith('signal_')) named.add(match[1]);
    }
  }

  for (const event of named) {
    assert.ok(EVENTS.has(event), `${event} is sent but the collector would drop it`);
  }
  for (const event of EVENTS) {
    assert.ok(named.has(event), `${event} is accepted but nothing on the site sends it`);
  }
});

/*
 * The demo is the only measured thing on the site that has a reader's own words
 * in front of it, so the shape of its call is worth pinning rather than trusting
 * to review. One argument means one dimension — the event name — and no room
 * for the sentence, its length, or any of the counts the panel prints beside it.
 * `demo-smoke.mjs` proves the same thing from the other end, by reading the
 * beacon off the wire in a browser.
 */
test('measures the demo without measuring what was typed into it', async () => {
  const panel = await read('../src/components/demo/LiveCarrierPanel.astro');
  assert.match(panel, /window\.oeMeasure\?\.\('demo_run'\)/);
  assert.equal([...panel.matchAll(/oeMeasure/g)].length, 1, 'the panel measures at one place');
});

/*
 * The same pinning for the scenario list, whose label is the one dimension any
 * event on this site carries beyond its own name. One argument past the event
 * name, and that argument is the slug the section already puts in its fragment
 * — never a count of records, a timing, or anything the scenario printed.
 */
test('measures which scenario was opened, and nothing about what it did', async () => {
  const list = await read('../src/components/demo/ScenarioList.astro');
  assert.match(list, /window\.oeMeasure\?\.\('scenario_opened', slug\)/);
  assert.equal([...list.matchAll(/oeMeasure/g)].length, 1, 'the list measures at one place');
});

/*
 * A label the collector accepts for a scenario nobody can open is worse than
 * no label: an unopened scenario and an unbuilt one become the same row in the
 * dataset, which is the exact question this event was added to answer. So the
 * accepted set and the shipped set have to match in both directions, less the
 * three runtime labels that belong to `runtime_select`.
 */
test('accepts a scenario label only for a scenario the site actually ships', () => {
  const runtimes = new Set(['expo', 'browser', 'node']);
  const slugs = new Set(SCENARIOS.map((scenario) => scenario.slug));

  for (const slug of slugs) {
    assert.ok(LABELS.has(slug), `the site ships ${slug} but the collector would drop its label`);
  }
  for (const label of LABELS) {
    if (runtimes.has(label)) continue;
    assert.ok(slugs.has(label), `${label} is an accepted label but no scenario ships it`);
  }
});

test('describes the measurement in the privacy notice it points at', async () => {
  const [privacy, script] = await Promise.all([
    flat('../src/pages/legal/privacy.astro'),
    read('../public/measure.js'),
  ]);

  assert.match(script, /\/legal\/privacy/);
  assert.match(privacy, /sets no cookie/i);
  assert.match(privacy, new RegExp(`${NUMBER_WORDS[EVENTS.size]} things`, 'i'));
  /* The demo's own paragraph, which is the only measurement claim on the site
   * made in front of something a reader typed. */
  assert.match(privacy, /neither the sentence nor anything derived from it/i);
  assert.match(privacy, /one is sent per page, not per sentence/i);
  assert.match(privacy, /IP address is not recorded/i);
  assert.match(privacy, /no third-party analytics service receives it/i);
  /* The old text claimed the site measured nothing at all. */
  assert.doesNotMatch(privacy, /does not currently use advertising cookies/i);
});
