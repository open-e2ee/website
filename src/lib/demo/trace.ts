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
 * what the scene's step table and the console's own step list are checked
 * against.
 *
 * Two of these are intervals rather than instants, and they are honest ones.
 * `in-transit` is the gap between this device handing over an envelope and the
 * relay confirming it holds the row; `delivered` is the gap between the relay
 * holding it and the far device reporting a decryption. Something really is
 * outstanding for the whole of each, which is why they are steps and not
 * animation frames.
 *
 * `generating-keys` is the one step a device records more than once. It is the
 * SDK's own progress reports during `create()`, one event per report, because
 * a single event at the end would carry a finished count and nothing to draw
 * growing.
 *
 * `registered` is the relay accepting a device: the registration call is the
 * first thing to cross the wire, and the relay builds the device's mailbox in
 * answering it. It precedes `generating-keys` because a device registers on
 * its way up, before its client has made a single key.
 */
export type Step =
  | 'idle'
  | 'registered'
  | 'generating-keys'
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
  'registered',
  'generating-keys',
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
 * and is labeled a prop where it is shown.
 */
export type Measures = Readonly<Record<string, number>>;

/**
 * What the ML-KEM braid reported about one send or one receive.
 *
 * The braid spreads a key agreement across many messages: each message carries
 * one erasure-coded chunk, and an epoch closes once enough chunks have traveled
 * both ways. Nothing outside the braid's own state machine can observe that, so
 * `onBraidProgress` is the only source for these counts and this is a record of
 * what it said rather than anything this page worked out.
 *
 * A separate field rather than a `Measures` entry, because a chunk count is
 * neither a `performance` measure nor the length of an object — see the note on
 * `Measures` above.
 *
 * `epoch` is the SDK's `bigint` printed. A recording is read by surfaces that
 * serialize it, and a `bigint` does not survive that.
 */
export interface BraidReport {
  /** Chunks this device emitted plus accepted in `epoch`. */
  readonly chunksCarried: number;
  /**
   * Chunks the transfers open in `epoch` account for.
   *
   * Not a target `chunksCarried` settles on. Sending capacity carries parity
   * beyond what a peer needs to reconstruct, and transfers open as the epoch
   * advances rather than all at once, so the two counts converge only loosely.
   */
  readonly chunksRequired: number;
  /** The braid epoch the two counts belong to. */
  readonly epoch: string;
  /**
   * Whether the send or receive that raised this produced the epoch secret.
   *
   * When that secret also ends the epoch, the state machine has already reset
   * its counters, so the counts above describe the epoch that has just begun
   * rather than the one the secret closed. Anything drawing from them has to
   * survive the two counts falling back to near nothing on this report.
   */
  readonly emittedEpochKey: boolean;
}

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
  /** Which device sent, when a step is about something traveling. */
  readonly from?: Actor;
  /** Which device it is traveling to. */
  readonly to?: Actor;
  /** `performance.now()` when this became true. Real, and possibly unordered. */
  readonly atMs: number;
  readonly measures?: Measures;
  /**
   * Every braid report the device raised while this step ran, in the order it
   * raised them.
   *
   * On the step rather than on a step of its own. A report is raised inside a
   * send or a receive, so it belongs to the send or the receive that raised it;
   * a step of its own would have to sit somewhere in `STEPS`, and there is no
   * position in a protocol order that a report arriving mid-send and a report
   * arriving mid-receive can both hold.
   *
   * A list, because one operation can raise more than one and a recording that
   * kept the last of them would be a recording with a report missing from it.
   * Absent in direct mode, which carries no chunks and raises nothing.
   */
  readonly braid?: readonly BraidReport[];
  readonly detail?: unknown;
}

/**
 * A step, with every number taken out.
 *
 * This is the whole of what the playback layer is allowed to know. It carries
 * what the drawing needs — which step, whose it is, and which way anything is
 * traveling — and nothing that could be mistaken for a measurement or scaled
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
         not about something traveling, so that the keys a cue has are the
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
