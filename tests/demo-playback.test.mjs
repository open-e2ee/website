/*
 * Playback is the reading clock, and the one thing it must never be able to do
 * is touch the measuring one.
 *
 * Two tests carry that. "changing the speed changes the waits and nothing else"
 * checks it at the level of behaviour: the same reel at quarter speed and at
 * quadruple speed shows the same cues in the same order, and only the delays
 * move. "reads nothing out of a cue except its step" checks it at the level of
 * the code, by handing playback cues that report every property anyone asks
 * for. Between them, "the speed control cannot alter a measurement" is
 * something the suite knows rather than something the header claims.
 *
 * Everything here runs on an injected clock. Real timers would make a suite
 * that waits out its own animations, which is both slow and a source of flake,
 * and the delays are more useful inspected than experienced.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_DWELL_MS,
  MAX_SPEED,
  MIN_SPEED,
  STEP_DWELL_MS,
  createPlayback,
} from '../src/lib/demo/playback.ts';

/** One send's worth of cues, in the shape `trace.cues()` produces. */
const REEL = [
  { step: 'devices-ready', actor: 'a' },
  { step: 'session-established', actor: 'a', from: 'a', to: 'b' },
  { step: 'encrypted', actor: 'a', from: 'a', to: 'b' },
  { step: 'in-transit', actor: 'relay', from: 'a', to: 'b' },
  { step: 'stored-at-relay', actor: 'relay', from: 'a', to: 'b' },
  { step: 'delivered', actor: 'relay', from: 'a', to: 'b' },
  { step: 'opened', actor: 'b', from: 'a', to: 'b' },
];

/**
 * A clock that records what it was asked to wait and runs it when told.
 *
 * `drain` is bounded rather than a bare `while`: a playback that rescheduled
 * itself without advancing would otherwise hang the suite instead of failing
 * it.
 */
function fakeClock() {
  const delays = [];
  let pending = null;
  return {
    delays,
    schedule(run, ms) {
      delays.push(ms);
      pending = run;
      return () => {
        pending = null;
      };
    },
    drain(limit = 100) {
      let turns = 0;
      while (pending) {
        assert.ok(turns++ < limit, 'playback rescheduled itself without reaching the end');
        const run = pending;
        pending = null;
        run();
      }
    },
    get waiting() {
      return pending !== null;
    },
  };
}

/** Run the whole reel at a speed and report what was shown and what was waited. */
function playAll(speed) {
  const clock = fakeClock();
  const shown = [];
  const playback = createPlayback({
    show: (cue) => shown.push(cue),
    speed,
    schedule: clock.schedule,
  });
  playback.push(...REEL);
  playback.play();
  clock.drain();
  return { shown, delays: clock.delays, playback };
}

test('changing the speed changes the waits and nothing else', () => {
  const slow = playAll(MIN_SPEED);
  const normal = playAll(1);
  const fast = playAll(MAX_SPEED);

  /* The reel is the reel. Speed is not allowed to skip a step, reorder one, or
     merge two — which is what a transport that paced from the recording would
     do the moment the recording came off an in-memory relay. */
  for (const run of [slow, fast]) {
    assert.deepEqual(run.shown, normal.shown);
    assert.equal(run.delays.length, normal.delays.length);
  }

  /* And the waits move by exactly the multiplier. Checked as a ratio against
     the speed-1 run rather than against numbers typed here, so the dwell table
     can be retuned without this test needing to be told. */
  normal.delays.forEach((base, index) => {
    assert.equal(slow.delays[index], base / MIN_SPEED);
    assert.equal(fast.delays[index], base / MAX_SPEED);
  });

  /* The dwell really did come from the table, not from anything in the cue. */
  assert.deepEqual(
    normal.delays,
    REEL.map((cue) => STEP_DWELL_MS[cue.step] ?? DEFAULT_DWELL_MS),
  );
});

test('reads nothing out of a cue except its step', () => {
  const clock = fakeClock();
  const read = new Set();
  /* Cues carrying exactly what a trace event carries, including the
     measurements, so that anything playback reaches for is recorded. */
  const bugged = REEL.map((cue) =>
    new Proxy(
      { ...cue, atMs: 1234.5, measures: { encryptMs: 7 }, detail: { text: 'secret' } },
      {
        get(target, property) {
          if (typeof property === 'string') read.add(property);
          return target[property];
        },
      },
    ),
  );

  const playback = createPlayback({
    /* `show` is the boundary: what the figure does with a cue is the figure's
       business, so the reads it makes are not playback's. */
    show: () => {},
    schedule: clock.schedule,
  });
  playback.push(...bugged);
  playback.play();
  clock.drain();

  assert.deepEqual(
    [...read],
    ['step'],
    'playback reached into a cue for something other than its step name',
  );
});

test('holds the last cue for as long as any other', () => {
  const { delays, shown } = playAll(1);

  assert.equal(shown.length, REEL.length);
  /* One wait per cue, the last one included. Waiting before showing rather than
     after would leave the final step of the protocol on screen for no time at
     all — the one step a reader is most likely to have been waiting for. */
  assert.equal(delays.length, REEL.length);
  assert.equal(delays.at(-1), STEP_DWELL_MS.opened);
});

test('picks up cues that arrive after the reel has run dry', () => {
  const clock = fakeClock();
  const shown = [];
  const playback = createPlayback({ show: (cue) => shown.push(cue), schedule: clock.schedule });

  playback.push(REEL[0]);
  playback.play();
  clock.drain();
  assert.equal(playback.state, 'done');

  /* The protocol is well ahead of the reader, but not infinitely: a reel can
     empty while a send is still in flight, and the next cue has to restart it
     rather than land on a transport that has parked. */
  playback.push(REEL[1], REEL[2]);
  clock.drain();

  assert.deepEqual(
    shown.map((cue) => cue.step),
    [REEL[0].step, REEL[1].step, REEL[2].step],
  );
  assert.equal(playback.state, 'done');
});

test('pause stops the reel where it is and play resumes it', () => {
  const clock = fakeClock();
  const shown = [];
  const playback = createPlayback({ show: (cue) => shown.push(cue), schedule: clock.schedule });

  playback.push(...REEL);
  playback.play();
  assert.equal(shown.length, 1, 'play should show the first cue at once, not after a wait');

  playback.pause();
  assert.equal(playback.state, 'paused');
  assert.equal(clock.waiting, false, 'a paused transport left a timer running');

  clock.drain();
  assert.equal(shown.length, 1, 'the reel advanced while paused');

  playback.play();
  clock.drain();
  assert.deepEqual(shown, REEL);
});

test('step shows one cue and stays stopped', () => {
  const clock = fakeClock();
  const shown = [];
  const playback = createPlayback({ show: (cue) => shown.push(cue), schedule: clock.schedule });

  playback.push(...REEL);
  playback.step();
  playback.step();

  assert.deepEqual(shown, [REEL[0], REEL[1]]);
  assert.equal(playback.state, 'paused');
  assert.equal(clock.waiting, false, 'stepping armed a timer, so the reel would run on its own');
  assert.equal(playback.position, 2);
});

test('reset drops the reel and shows nothing', () => {
  const clock = fakeClock();
  const shown = [];
  const playback = createPlayback({ show: (cue) => shown.push(cue), schedule: clock.schedule });

  playback.push(...REEL);
  playback.play();
  playback.reset();

  assert.equal(playback.state, 'idle');
  assert.equal(playback.length, 0);
  assert.equal(playback.position, 0);
  assert.equal(clock.waiting, false);

  /* Reset does not put a cue on screen. What "reset" looks like is the page's
     decision — it has a run to restart and columns to empty — and a transport
     that showed an idle frame here would be making half of it. */
  const after = shown.length;
  clock.drain();
  assert.equal(shown.length, after);
});

test('the figure holds no clock of its own', async () => {
  const source = await readFile(new URL('../src/lib/demo/figure.ts', import.meta.url), 'utf8');

  /* `figure.ts` says in its header that it has no clock, and that claim is the
     whole reason this module exists. A timer growing back in there would not
     break anything visible — it would quietly give the drawing a second opinion
     about pacing, which is the defect this seam was drawn to prevent, and it
     would read as correct in review. So the claim is checked rather than
     trusted.

     Read out of the source because there is nothing to call: a clock that is
     never armed by the paths a test drives is exactly the one that gets past a
     behavioural test. */
  for (const timer of ['setTimeout', 'setInterval', 'requestAnimationFrame']) {
    assert.equal(
      source.includes(timer),
      false,
      `figure.ts reaches for ${timer}, so the pacing has two owners again`,
    );
  }
});

test('clamps the speed rather than accepting a useless one', () => {
  const playback = createPlayback({ show: () => {} });

  playback.setSpeed(1000);
  assert.equal(playback.speed, MAX_SPEED);
  playback.setSpeed(0);
  assert.equal(playback.speed, MIN_SPEED);
  playback.setSpeed(Number.NaN);
  assert.equal(playback.speed, 1, 'a speed that is not a number should fall back to real time');
});
