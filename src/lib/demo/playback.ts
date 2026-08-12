/*
 * The reading pace. One clock, and it is not the one the protocol ran on.
 *
 * The demo runs at full speed — a local relay answers in single digits — and
 * then shows what happened at a pace a person can read. Those are two clocks,
 * and the whole honesty of the page rests on them never becoming one variable.
 * This module owns the reading clock. It knows nothing about the other.
 *
 * ------------------------------------------------------- what it may see ---
 *
 * A cue, and a cue is a step name and who it belongs to. Nothing else reaches
 * here: `trace.cues()` is a projection with every number stripped out, so
 * there is no figure in scope for this module to move even by accident. That
 * is a fact about the types rather than a rule to remember, and `trace.ts`
 * explains why it was made one.
 *
 * The implementation reads exactly one property of a cue, `step`, and only to
 * look up a dwell. It is parametric in the rest so that nothing can be read out
 * of a cue here even by accident.
 *
 * ------------------------------------------------------------ the pacing ---
 *
 * Dwell comes from the table below and never from the recording. The recorded
 * intervals are microseconds over an in-memory relay: pacing from them would
 * play the whole protocol inside one frame, and pacing from them *scaled* would
 * be a presentation number wearing a measurement's clothes. So the numbers here
 * are declared to be choices, and the numbers on the page are declared to be
 * measurements, and neither is ever derived from the other.
 *
 * There is one dwell per step and nothing left in this file that can scale it —
 * no speed control, no multiplier, no per-reader setting. A reader moves
 * through the table below at the pace it sets and at no other pace, which makes
 * the two-clock guarantee stronger than it was when a control still lived here:
 * it is not just that this module cannot see a measurement, it is that nothing
 * in the playback path can scale anything at all.
 *
 * ------------------------------------------------------- reduced motion ---
 *
 * There is no reduced-motion branch here, and its absence is the design.
 *
 * Dwell is information pacing, not motion. A reader who asks for less motion is
 * asking not to be moved at; they are not asking to be shown less of the
 * protocol. The old figure collapsed its whole queue to the terminal state when
 * `prefers-reduced-motion` was set, which dropped eight steps of the
 * explanation along with the sliding — it lost the information, not the motion.
 *
 * So reduced motion keeps every dwell in this table and drops only the tween,
 * which lives in CSS and is switched off by the duration tokens on their own.
 * Note what that means, because it will look like a bug to anyone who assumes
 * reduced motion means faster: **reduced motion is now the slower path.** The
 * steps arrive at the same pace and simply do not slide between positions.
 * Speeding it up would be answering a request about vestibular comfort with a
 * change to how long someone is given to read.
 */

/** The least a cue must be for this module to pace it. */
export interface Cued {
  readonly step: string;
}

/** How long each step is held before the next may replace it, in milliseconds. */
export type DwellTable = Readonly<Record<string, number>>;

/**
 * The pace, per step.
 *
 * Chosen, not measured — see the header. A dwell is how long the scene holds a
 * state before the next may replace it, and what sets it is how much *changes*
 * at that step: a step that lights one shelf needs less time than one that
 * agrees a session, turns two wheels and renames both of them.
 *
 * These were more than twice as long, because they were derived from per-step
 * captions the scene carried at the time — each one sized to its own sentence at
 * about four words a second. The captions are gone: the scene now shows the
 * state itself, in devices and shelves and a wheel, and prose about a step is no
 * longer on screen to be read. Dwell sized for absent text is dwell spent on
 * still frames, and the whole reel spent twenty-eight and a half seconds to move
 * something for one and seven tenths of them.
 *
 * So the rule that replaces the old one: **size a dwell to the change it holds,
 * and let flight take the rest of it.** `DemoConsole.astro` derives each
 * journey's flight time from the dwell of the step it belongs to, which keeps
 * the envelope moving for most of the step rather than arriving early and
 * waiting.
 *
 * A step with no entry gets `DEFAULT_DWELL_MS`, so an added step paces sensibly
 * before anyone has decided what it is worth.
 */
export const STEP_DWELL_MS: DwellTable = {
  idle: 0,
  /* One device coming online, and there are two of these. The pair used to be
     drawn on the first of them and the second held a frame identical to it, so
     the reel opened on two dwells of one still picture; each now stamps its own
     device, and one word changing is the smallest change in the reel. */
  'devices-ready': 1000,
  'bundles-published': 1500,
  'session-established': 1900,
  encrypted: 1000,
  'in-transit': 1200,
  'stored-at-relay': 1500,
  delivered: 900,
  /* The longest of the message steps: the envelope opens, is readable, and then
     folds into the conversation, and `scene-view.ts` holds it open for part of
     that. A shorter dwell here cuts the fold off midway. */
  opened: 1600,
};

/** What an unlisted step is held for. Long enough to see a state change. */
export const DEFAULT_DWELL_MS = 1400;

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'done';

/**
 * How the reel waits.
 *
 * Injected so a test can run a whole reel without waiting for it, and can
 * inspect the delays it was given rather than time them. Returns the cancel
 * for what it scheduled.
 */
export type Schedule = (run: () => void, ms: number) => () => void;

export interface PlaybackOptions<C extends Cued> {
  /** Put a cue on screen. The only thing playback does to the outside world. */
  show(cue: C): void;
  /**
   * The reel is about to be shown again from its first cue.
   *
   * Playback owns the cursor, so playback is the only thing that knows a replay
   * has begun. Without the signal a second watch draws on top of the first: the
   * cues are idempotent about state they set, but not about state they append,
   * and the chats append. What shipped was three copies of the same sentence in
   * one conversation after two replays.
   */
  rewind?(): void;
  /** Per-step dwell. Defaults to `STEP_DWELL_MS`. */
  dwellMs?: DwellTable;
  /** How to wait. Defaults to `setTimeout`. */
  schedule?: Schedule;
}

export interface Playback<C extends Cued> {
  /**
   * Add cues to the end of the reel.
   *
   * Cues arrive while the run is still going — the protocol is well ahead of
   * the reader — so the reel grows under a transport that is already playing.
   * A reel that had run dry starts again on the next push if it was playing
   * when it ran out.
   */
  push(...cues: C[]): void;
  /** Run the reel. A reel already played through starts again from the top. */
  play(): void;
  pause(): void;
  /**
   * Show the next cue and stay stopped. The transport's step button.
   *
   * A reel already played through steps from the top, so this stays useful
   * after the protocol has finished — which is when it is reached for.
   */
  step(): void;
  /** Drop the reel and go back to the beginning. Shows nothing. */
  reset(): void;
  readonly state: PlaybackState;
  /** How many cues have been shown, and how many are on the reel. */
  readonly position: number;
  readonly length: number;
  /** Watch the transport. Returns a function that stops watching. */
  on(listener: (state: PlaybackState) => void): () => void;
}

const defaultSchedule: Schedule = (run, ms) => {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
};

export function createPlayback<C extends Cued>(options: PlaybackOptions<C>): Playback<C> {
  const dwellMs = options.dwellMs ?? STEP_DWELL_MS;
  const schedule = options.schedule ?? defaultSchedule;

  const reel: C[] = [];
  let cursor = 0;
  let state: PlaybackState = 'idle';
  let cancel: (() => void) | null = null;
  const listeners = new Set<(state: PlaybackState) => void>();

  function moveTo(next: PlaybackState): void {
    if (state === next) return;
    state = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        /* a subscriber's render failure is its own to report */
      }
    }
  }

  function stopWaiting(): void {
    cancel?.();
    cancel = null;
  }

  /**
   * Send the cursor back to the start when the reel has already been spent.
   *
   * The reel is a recording, not a queue that is consumed by being watched, and
   * this is the difference between the two. A run pushes its cues as the trace
   * records them and the transport plays them straight through, so by the time
   * anyone reaches for Play or Step the cursor is already at the end. Without
   * this, both controls are live, enabled, and incapable of showing a frame —
   * which is what shipped, and it is the one affordance a reader needs to take
   * the protocol at their own pace.
   *
   * Only `play` and `step` rewind. `push` deliberately does not: a cue arriving
   * from a still-running protocol extends the recording and must never throw the
   * reader back to the beginning of it.
   */
  function rewindIfSpent(): void {
    if (cursor < reel.length) return;
    cursor = 0;
    /* Only when the cursor actually moved, and only when there is something to
       replay: an empty reel has no first frame to go back to. */
    if (reel.length > 0) options.rewind?.();
  }

  /** Show the cue under the cursor and move past it. */
  function showNext(): C | null {
    const cue = reel[cursor];
    if (cue === undefined) return null;
    cursor += 1;
    options.show(cue);
    return cue;
  }

  /**
   * Show one cue, then wait out its dwell and come back for the next.
   *
   * The wait belongs to the cue just shown rather than to the one coming, which
   * is what makes the last cue of a reel stay on screen for as long as any
   * other. Waiting before showing would leave the final step visible for no
   * time at all.
   */
  function tick(): void {
    const cue = showNext();
    if (cue === null) {
      moveTo('done');
      return;
    }
    const dwell = dwellMs[cue.step] ?? DEFAULT_DWELL_MS;
    cancel = schedule(() => {
      cancel = null;
      if (state === 'playing') tick();
    }, dwell);
  }

  return {
    push(...cues) {
      reel.push(...cues);
      /* A reel that ran dry while playing picks up where it stopped. `done` is
         where it parked, and a push is the thing that undoes it. */
      if (state === 'done') {
        moveTo('playing');
        tick();
      }
    },

    play() {
      if (state === 'playing') return;
      rewindIfSpent();
      moveTo('playing');
      tick();
    },

    pause() {
      if (state !== 'playing') return;
      stopWaiting();
      moveTo('paused');
    },

    step() {
      stopWaiting();
      rewindIfSpent();
      const cue = showNext();
      moveTo(cue === null ? 'done' : 'paused');
    },

    reset() {
      stopWaiting();
      reel.length = 0;
      cursor = 0;
      moveTo('idle');
    },

    get state() {
      return state;
    },

    get position() {
      return cursor;
    },

    get length() {
      return reel.length;
    },

    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
