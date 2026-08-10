/*
 * The recording. One list of what really happened, read by everything.
 *
 * The demo runs the protocol at full speed and then replays it at the reader's
 * pace. That split only stays honest if there is exactly one record of the run
 * and every surface reads it: the figure, the metrics, the log and the code
 * pane all render from this list, which is what stops the four of them from
 * disagreeing about a run they all watched.
 *
 * ------------------------------------------------------------- two clocks ---
 *
 * The animation clock and the measurement clock are different clocks and must
 * never become the same variable. This module is where that is enforced rather
 * than promised.
 *
 * A `TraceEvent` carries real measurements. A `Cue` does not: it is the same
 * event with every number removed, and `cues()` is the only projection the
 * playback layer is given. So "playback cannot alter a measurement" is a fact
 * about the types rather than a rule someone has to keep remembering — there is
 * no measurement in scope for it to touch. Slowing the animation down cannot
 * move a printed figure because the paced half of the page has never been able
 * to see one.
 *
 * ---------------------------------------------------- order and timestamps ---
 *
 * `events` is in protocol order: encrypted, then in transit, then stored, then
 * delivered, then opened. `atMs` is real, from `performance.now()`, taken when
 * the fact became true.
 *
 * Those two can disagree, and the disagreement is recorded rather than tidied
 * away. `inMemoryRelay()` accepts an envelope *inside* the send call, so the
 * relay has stored the row before `send()` has returned to us — an envelope
 * whose `stored-at-relay` timestamp precedes its `encrypted` one. That is a
 * true fact about an in-memory relay and a reader who opens their Performance
 * panel will see it. Sorting the list by time would hide it and would also put
 * the storage before the encryption in the explanation, which is worse.
 *
 * Nothing downstream depends on `atMs` being monotonic. The metrics read named
 * measures, and playback reads no numbers at all.
 */

/**
 * Who a step belongs to.
 *
 * Three actors, because the drawing has three columns and the log has a
 * three-way filter. `a` and `b` are the two devices; `relay` is the middle.
 */
export type Actor = 'a' | 'relay' | 'b';

/**
 * The steps a run can pass through, in the order a complete run reaches them.
 *
 * The order of this union is the protocol's order and is load-bearing: it is
 * what the figure's suffix lists and the stage's CSS are checked against, the
 * same contract `figure.ts` has always held.
 *
 * Two of these are intervals rather than instants, and they are honest ones.
 * `in-transit` is the gap between this device handing over an envelope and the
 * relay confirming it holds the row; `delivered` is the gap between the relay
 * holding it and the far device reporting a decryption. Something really is
 * outstanding for the whole of each, which is why they are steps and not
 * animation frames.
 */
export type Step =
  | 'idle'
  | 'devices-ready'
  | 'bundles-published'
  | 'session-established'
  | 'encrypted'
  | 'in-transit'
  | 'stored-at-relay'
  | 'delivered'
  | 'opened';

/** Every step, in protocol order. Derived from nothing — this is the source. */
export const STEPS: readonly Step[] = [
  'idle',
  'devices-ready',
  'bundles-published',
  'session-established',
  'encrypted',
  'in-transit',
  'stored-at-relay',
  'delivered',
  'opened',
];

/**
 * What a step measured, by name.
 *
 * Every value here came from a `performance` measure around a real call or from
 * the byte length of a real object. There is no field for a number this demo
 * chose, and that is deliberate: a presentation duration is not a measurement
 * and may not travel in the same envelope as one. If transit is ever given an
 * artificial duration so it can be watched, it belongs to the playback layer
 * and is labelled a prop where it is shown.
 */
export type Measures = Readonly<Record<string, number>>;

/**
 * One thing that really happened.
 *
 * `detail` holds live objects — the `Envelope` the relay stored, the text a
 * device typed — handed over rather than described. The demo has already paid
 * once for a hand-maintained description of an envelope drifting from ten
 * fields to six, so a surface that renders from these renders from the object
 * the protocol produced.
 */
export interface TraceEvent {
  readonly step: Step;
  readonly actor: Actor;
  /** Which device sent, when a step is about something travelling. */
  readonly from?: Actor;
  /** Which device it is travelling to. */
  readonly to?: Actor;
  /** `performance.now()` when this became true. Real, and possibly unordered. */
  readonly atMs: number;
  readonly measures?: Measures;
  readonly detail?: unknown;
}

/**
 * A step, with every number taken out.
 *
 * This is the whole of what the playback layer is allowed to know. It carries
 * what the drawing needs — which step, whose it is, and which way anything is
 * travelling — and nothing that could be mistaken for a measurement or scaled
 * by a speed control.
 *
 * `from`/`to` are what became of the old figure's `direction()`. That was a
 * mirror transform on the whole composition, and it existed because the reader
 * could only see one end of the conversation. With both devices drawn there is
 * no near end to mirror. Which way an envelope travels is still real, so it
 * stays — as a property of the step it belongs to, which is what it always was.
 */
export interface Cue {
  readonly step: Step;
  readonly actor: Actor;
  readonly from?: Actor;
  readonly to?: Actor;
}

export interface Trace {
  /** Everything recorded, in protocol order. */
  readonly events: readonly TraceEvent[];
  /** The same list with every measurement removed. What playback may see. */
  cues(): readonly Cue[];
  /** Record something that happened. */
  append(event: TraceEvent): void;
  /** Forget the run. Used by reset, which starts a new one. */
  clear(): void;
  /** Watch the recording grow. Returns a function that stops watching. */
  on(listener: (event: TraceEvent) => void): () => void;
}

export function createTrace(): Trace {
  const events: TraceEvent[] = [];
  const listeners = new Set<(event: TraceEvent) => void>();

  return {
    events,

    cues() {
      /* Rebuilt rather than stored alongside. Two lists kept in step is two
         lists that can fall out of step, and this one is cheap: a complete run
         is a handful of events.
         `from`/`to` are omitted rather than set to `undefined` when a step is
         not about something travelling, so that the keys a cue has are the
         facts it carries — which is what makes "a cue holds no number" a thing
         a test can check by enumeration. */
      return events.map(({ step, actor, from, to }) => ({
        step,
        actor,
        ...(from === undefined ? {} : { from }),
        ...(to === undefined ? {} : { to }),
      }));
    },

    append(event) {
      events.push(event);
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch {
          /* a subscriber's render failure is its own to report */
        }
      }
    },

    clear() {
      events.length = 0;
    },

    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
