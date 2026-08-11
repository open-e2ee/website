/*
 * Playback is the reading clock, and the one thing it must never be able to do
 * is touch the measuring one.
 *
 * One test carries that at the level of the code: "reads nothing out of a cue
 * except its step" hands playback cues that report every property anyone asks
 * for, so "playback cannot alter a measurement" is something the suite knows
 * rather than something the header claims — there is no measurement in scope
 * for it to reach.
 *
 * Everything here runs on an injected clock. Real timers would make a suite
 * that waits out its own animations, which is both slow and a source of flake,
 * and the delays are more useful inspected than experienced.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEFAULT_DWELL_MS, STEP_DWELL_MS, createPlayback } from '../src/lib/demo/playback.ts';

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

/** Run the whole reel and report what was shown and what was waited. */
function playAll() {
  const clock = fakeClock();
  const shown = [];
  const playback = createPlayback({
    show: (cue) => shown.push(cue),
    schedule: clock.schedule,
  });
  playback.push(...REEL);
  playback.play();
  clock.drain();
  return { shown, delays: clock.delays, playback };
}

test('each wait is the dwell the table gives that step, not anything else on the cue', () => {
  const { delays } = playAll();

  /* Checked against the table by step name rather than against numbers typed
     here, so the dwell table can be retuned without this test needing to be
     told. The cues on `REEL` carry `actor`, `from`, and `to` alongside `step`,
     so this is also the check that none of those reached the wait. */
  assert.deepEqual(
    delays,
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
  const { delays, shown } = playAll();

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

/*
 * The transport is reached for after the protocol has finished, not during it.
 *
 * A run pushes its cues as fast as the trace records them and the reel plays
 * them straight through, so by the time a reader presses Play or Step the
 * cursor is already spent. The version of this that shipped left both controls
 * enabled and incapable of showing a frame, which reads as a broken page rather
 * than as an empty reel — so these two tests are about the state the reader
 * actually arrives in, not about a reel caught mid-flight.
 */
test('a reel that has played through plays again rather than sitting spent', () => {
  const { playback, shown } = playAll();
  assert.equal(playback.state, 'done');
  assert.equal(shown.length, REEL.length, 'the reel should have run dry before this is a test of replay');

  const clock = fakeClock();
  const replayed = [];
  const again = createPlayback({ show: (cue) => replayed.push(cue), schedule: clock.schedule });
  again.push(...REEL);
  again.play();
  clock.drain();
  assert.equal(again.state, 'done');

  again.play();
  clock.drain();
  assert.deepEqual(
    replayed.map((cue) => cue.step),
    [...REEL, ...REEL].map((cue) => cue.step),
    'pressing play on a spent reel showed nothing, so the recording cannot be re-watched',
  );
});

test('a reel that has played through steps from the top', () => {
  const clock = fakeClock();
  const shown = [];
  const playback = createPlayback({ show: (cue) => shown.push(cue), schedule: clock.schedule });
  playback.push(...REEL);
  playback.play();
  clock.drain();
  assert.equal(playback.state, 'done');
  const afterRun = shown.length;

  playback.step();
  assert.equal(shown.length, afterRun + 1, 'step on a spent reel showed no frame at all');
  assert.equal(shown.at(-1).step, REEL[0].step, 'step should have gone back to the first cue');
  assert.equal(playback.state, 'paused', 'a step that showed a frame should park paused');

  playback.step();
  assert.equal(shown.at(-1).step, REEL[1].step, 'a second step should advance rather than rewind again');
});

test('a replay says so before it shows its first frame again', () => {
  const clock = fakeClock();
  const shown = [];
  /* What each rewind saw of the reel at the moment it fired. The scene clears
     itself here, so a rewind announced after the first cue had already been
     shown would wipe the frame it was announcing. */
  const rewoundAfter = [];
  const playback = createPlayback({
    show: (cue) => shown.push(cue.step),
    rewind: () => rewoundAfter.push(shown.length),
    schedule: clock.schedule,
  });

  playback.push(...REEL);
  playback.play();
  clock.drain();
  assert.equal(playback.state, 'done');
  assert.deepEqual(rewoundAfter, [], 'the first watch is not a replay and must not announce one');
  const afterFirstWatch = shown.length;

  playback.play();
  clock.drain();
  assert.deepEqual(
    rewoundAfter,
    [afterFirstWatch],
    'a second watch of a spent reel announced no rewind, so it drew on top of the first',
  );

  /* Only where the cursor actually moves. A push that resumes a dry reel and a
     step that is not at the end both continue rather than start over. */
  playback.push(REEL[0]);
  clock.drain();
  playback.step();
  assert.equal(rewoundAfter.length, 2, 'a step from the end is a replay and had to announce one');
  playback.step();
  assert.equal(rewoundAfter.length, 2, 'a step that merely advanced announced a replay');
});

test('an empty reel has no first frame to go back to', () => {
  let rewinds = 0;
  const playback = createPlayback({
    show: () => {},
    rewind: () => (rewinds += 1),
    schedule: fakeClock().schedule,
  });
  playback.play();
  playback.step();
  assert.equal(rewinds, 0, 'a reel with nothing on it announced a replay of nothing');
});

test('a cue arriving mid-run extends the reel instead of rewinding it', () => {
  const clock = fakeClock();
  const shown = [];
  const playback = createPlayback({ show: (cue) => shown.push(cue), schedule: clock.schedule });
  playback.push(REEL[0]);
  playback.play();
  clock.drain();
  assert.equal(playback.state, 'done', 'the reel should have run dry with one cue shown');

  /* The protocol is still going, and a reader watching it must not be thrown
     back to the beginning because the transport happened to catch up. */
  playback.push(REEL[1]);
  clock.drain();
  assert.deepEqual(
    shown.map((cue) => cue.step),
    [REEL[0].step, REEL[1].step],
    'a push after the reel ran dry replayed the recording instead of continuing it',
  );
});
