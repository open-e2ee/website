/*
 * The loader is the only demo code that ships before a reader touches anything,
 * so it owns one job: decide when the 713 KB behind `driver.ts` is allowed to
 * arrive, and say out loud which of loading, ready, and failed the page is in.
 *
 * The failed state is the one worth testing hardest. Invariant 6 says a broken
 * live demo must never render as a broken page — the recorded capture panel
 * stays put. A page can only honour that if the loader tells it the truth about
 * a chunk that never came, which means a rejected import has to end somewhere
 * observable rather than in an unhandled rejection.
 *
 * These tests inject the import function. The specifier itself is not a claim a
 * node test can check — there is no chunk in node — so it is proven in a real
 * browser by `scripts/demo-smoke.mjs`, which blocks the chunk over the wire and
 * watches the same state machine land on `failed` with the recorded capture
 * still on the homepage.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoLoader } from '../src/lib/demo/loader.ts';

/** Stands in for the driver module; the loader only ever reads its shape. */
const MODULE = { startDemoSession: async () => ({}) };

test('starts idle, and says so to a listener that arrives first', () => {
  const loader = createDemoLoader(async () => MODULE);
  assert.deepEqual(loader.state, { status: 'idle' });

  /* A subscriber gets the current state immediately rather than waiting for a
   * change it may have already missed: LD2 subscribes after the panel is in the
   * DOM, which for a visibility trigger can be after loading has begun. */
  const seen = [];
  loader.subscribe((state) => seen.push(state.status));
  assert.deepEqual(seen, ['idle']);
});

test('walks idle to loading to ready, and hands back the module', async () => {
  const loader = createDemoLoader(async () => MODULE);
  const seen = [];
  loader.subscribe((state) => seen.push(state.status));

  const module = await loader.load();

  assert.equal(module, MODULE);
  assert.deepEqual(seen, ['idle', 'loading', 'ready']);
  assert.equal(loader.state.status, 'ready');
  assert.equal(loader.state.module, MODULE);
});

test('imports once however many times it is asked', async () => {
  let calls = 0;
  const loader = createDemoLoader(async () => {
    calls += 1;
    return MODULE;
  });

  /* Both triggers can fire: the panel scrolls into view and the reader clicks
   * send in the same frame. Two imports of a half-megabyte chunk is the bug
   * this dedup exists to prevent. */
  const [a, b] = await Promise.all([loader.load(), loader.load()]);
  await loader.load();

  assert.equal(calls, 1);
  assert.equal(a, MODULE);
  assert.equal(b, MODULE);
});

test('ends a rejected import in the failed state, not in an unhandled rejection', async () => {
  const boom = new Error('Failed to fetch dynamically imported module');
  const loader = createDemoLoader(async () => {
    throw boom;
  });
  const seen = [];
  loader.subscribe((state) => seen.push(state.status));

  await assert.rejects(() => loader.load(), /dynamically imported module/);

  assert.deepEqual(seen, ['idle', 'loading', 'failed']);
  assert.equal(loader.state.status, 'failed');
  assert.equal(loader.state.error, boom);
});

test('carries a non-Error rejection through as an Error', async () => {
  /* A blocked or aborted import does not always reject with an Error, and the
   * failed state is read by code that wants a message to log. */
  const loader = createDemoLoader(async () => {
    throw 'blocked';
  });

  await assert.rejects(() => loader.load());
  assert.ok(loader.state.error instanceof Error);
  assert.match(loader.state.error.message, /blocked/);
});

test('retries after a failure instead of staying broken forever', async () => {
  /* A chunk that failed on a flaky connection is worth asking for again. The
   * memoization above must not outlive the failure that produced it. */
  let calls = 0;
  const loader = createDemoLoader(async () => {
    calls += 1;
    if (calls === 1) throw new Error('offline');
    return MODULE;
  });

  await assert.rejects(() => loader.load());
  assert.equal(loader.state.status, 'failed');

  assert.equal(await loader.load(), MODULE);
  assert.equal(calls, 2);
  assert.equal(loader.state.status, 'ready');
});

test('stops delivering to an unsubscribed listener', async () => {
  const loader = createDemoLoader(async () => MODULE);
  const seen = [];
  const off = loader.subscribe((state) => seen.push(state.status));
  off();

  await loader.load();

  assert.deepEqual(seen, ['idle']);
});

test('keeps one listener throwing from stopping the others', async () => {
  /* LD2 renders from these callbacks. A render that throws must not take the
   * loader's state with it, or the panel is stuck mid-transition. */
  const loader = createDemoLoader(async () => MODULE);
  const seen = [];
  loader.subscribe(() => {
    throw new Error('render failed');
  });
  loader.subscribe((state) => seen.push(state.status));

  await loader.load();

  assert.deepEqual(seen, ['idle', 'loading', 'ready']);
  assert.equal(loader.state.status, 'ready');
});
