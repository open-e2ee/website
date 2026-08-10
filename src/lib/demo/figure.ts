/*
 * The stage's right-hand figure, driven by what the left-hand panel actually did.
 *
 * `DemoFigure.astro` draws every part of this diagram at build time and hands
 * the browser one SVG with nothing hidden behind a fetch. This module does one
 * thing to it: it names the state the run is in, on the SVG element, and CSS
 * decides which parts of the already-drawn diagram that state shows. No shape
 * is constructed here, so there is no second copy of the drawing to drift from
 * the first one.
 *
 * Every state below is entered from something the SDK reported. Nothing is on a
 * timer. Two of them need saying out loud, because they look like animation
 * frames and are not:
 *
 *   `in-transit` is the interval between the client returning an envelope and
 *   the relay confirming it holds the row. Something really is outstanding for
 *   the whole of it.
 *
 *   `delivered` is the interval between the relay holding the row and the
 *   receiving device reporting a decryption. Same shape, other side.
 *
 * `session-established` and `encrypted` become true at the same instant — the
 * first `send()` runs PQXDH and returns ciphertext in one call — and the figure
 * shows them in sequence rather than at once. That is presentation of two facts
 * that arrived together, not a claim that one preceded the other, and it is the
 * only ordering here that the events do not themselves impose. With motion
 * turned down it collapses to the second one.
 *
 * The state is `encrypted` and not `sealed`, and that is a page rule rather
 * than a preference. "Sealed sender" is a real feature of this SDK, switched
 * off in the configuration this demo runs, and the homepage's own relay row
 * prints a sender field in the clear a few inches away — so the homepage may
 * use "sealed" only as part of "sealed sender", and `tests/site-content.test.mjs`
 * fails the build over any other use of it. The caption below is read by every
 * reader who runs this, which makes it the worst place on the page to be loose
 * about the word: it is the line standing over the evidence that contradicts
 * it. The state name follows the caption so that the name in the markup and the
 * word on the screen stay the same word.
 *
 * ------------------------------------------------------------- perspective ---
 *
 * The near device is always this tab. When the tab is the sender the sentence
 * travels left to right, and when it is the receiver the same drawing is
 * mirrored so that the envelope arrives from the relay into the near device
 * instead. `direction()` sets which, and it changes both the geometry — one CSS
 * transform on the whole composition, so there is still one drawing — and the
 * caption, because "encrypted on this device" is false in a tab that did not
 * encrypt it.
 *
 * A receiving tab reaches exactly two states, `delivered` and `opened`, and
 * that is the honest ceiling rather than an unfinished sequence. `two-tab.ts`
 * publishes three events and none of them is a receipt: a tab watches the relay
 * for rows addressed to its peer, which are its own outgoing ones. The other
 * tab's encryption and the other tab's storage are things this tab is told
 * nothing about, so the figure does not draw them.
 */

import { hexStrip } from './ciphertext.ts';

export type StageState =
  | 'idle'
  | 'sdk-loading'
  | 'devices-ready'
  | 'peer-connected'
  | 'session-established'
  | 'encrypted'
  | 'in-transit'
  | 'stored-at-relay'
  | 'delivered'
  | 'opened';

/** Which way the sentence is travelling. `out` is this tab sending. */
export type StageDirection = 'out' | 'in';

/**
 * The caption under the figure, one line per state.
 *
 * Read by `DemoFigure.astro` at build time for the state the page ships in, so
 * the first caption a reader sees and the ones the script writes come from one
 * list. Kept short on purpose: this is a line a screen reader announces every
 * time the state changes, and the panel beside it carries the detail.
 */
export const CAPTIONS: Readonly<Record<StageState, string>> = {
  idle: 'Nothing has run yet. Type a sentence in the panel to start.',
  'sdk-loading': 'Fetching the SDK. None of it was downloaded until you asked.',
  'devices-ready': 'Two devices are up, each with its own store and published key bundle.',
  'peer-connected': 'A second tab announced itself. The far device is another window now, not this one.',
  'session-established':
    'Session established with PQXDH and ML-KEM. Both devices hold the derived key.',
  encrypted: 'Encrypted on this device. The plaintext and the private keys stay here.',
  'in-transit': 'On its way to the relay, with the metadata riding outside the envelope.',
  'stored-at-relay': 'This is the row your relay stores. Those bytes are the ciphertext.',
  delivered: 'Handed to the second device, still ciphertext. The relay keeps its copy.',
  opened: 'Opened on the second device. Same sentence, decrypted with the session key.',
};

/**
 * What the same states mean in a tab that is receiving rather than sending.
 *
 * Only the states a receiving tab can reach are here. A state with no entry
 * keeps the caption above, which is the correct one for every state whose
 * subject is the session or the relay rather than an end of the trip.
 */
export const INCOMING_CAPTIONS: Readonly<Partial<Record<StageState, string>>> = {
  delivered: 'Arriving from the relay, still ciphertext. Another tab encrypted this one.',
  opened: 'Opened in this tab. The other tab’s sentence, decrypted with the session key.',
};

/**
 * How long a state stays on screen before the next one may replace it.
 *
 * `--oe-duration-normal`, in milliseconds. A local relay answers in single
 * digits, so without a floor the seal, the transit and the storage would land
 * inside one frame and a reader would see the last of the three.
 */
const MIN_DWELL_MS = 180;

/**
 * How many steps the ratchet run is drawn with.
 *
 * `RATCHET_STEPS` from the diagram grammar, repeated here as the ceiling the
 * counter is clamped to rather than imported: this module draws nothing, and a
 * dependency on the drawing package for one integer would put geometry in the
 * one file that deliberately has none. `DemoFigure.astro` emits exactly this
 * many steps and `tests/site-content.test.mjs` holds the two numbers together.
 *
 * The clamp is a real limit and not a rounding: a session that has carried more
 * than four messages shows a full run, because the run says the ratchet has
 * advanced rather than how many times.
 */
const RATCHET_STEPS = 4;

export interface StageFigure {
  /** Queue a state, holding each one long enough to be seen. */
  advance(state: StageState): void;
  /** Show a state now, dropping anything queued behind it. */
  jump(state: StageState): void;
  /** Which way the next states are travelling, and whose captions they get. */
  direction(value: StageDirection): void;
  /** Print the real ciphertext in the relay lane. */
  cipher(value: unknown): void;
  /** Name the two ends. `far` is what the second device is called here. */
  label(near: string, far: string): void;
  /** How many messages this session has carried, drawn as a ratchet run. */
  ratchet(messages: number): void;
}

export function mountStageFigure(root: HTMLElement): StageFigure {
  const svg = root.querySelector<SVGSVGElement>('[data-figure-stage]');
  const caption = root.querySelector<HTMLElement>('[data-demo-figure-caption]');
  const hex = [...root.querySelectorAll<SVGTSpanElement>('[data-figure-hex-line]')];
  const near = root.querySelector<SVGTextElement>('[data-figure-near-label]');
  const far = root.querySelector<SVGTextElement>('[data-figure-far-label]');

  let facing: StageDirection = 'out';

  const show = (state: StageState) => {
    if (svg) svg.dataset.stageState = state;
    if (caption) {
      caption.textContent =
        (facing === 'in' ? INCOMING_CAPTIONS[state] : undefined) ?? CAPTIONS[state];
    }
  };

  /* Read per call rather than once: a reader who turns motion down mid-page
     gets the next state immediately rather than at the next reload. */
  const settle = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const queue: StageState[] = [];
  let timer: number | null = null;

  const pump = () => {
    const next = queue.shift();
    if (next === undefined) {
      timer = null;
      return;
    }
    show(next);
    timer = window.setTimeout(pump, MIN_DWELL_MS);
  };

  const clear = () => {
    queue.length = 0;
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  return {
    advance(state) {
      if (settle()) {
        clear();
        show(state);
        return;
      }
      queue.push(state);
      if (timer === null) pump();
    },

    jump(state) {
      clear();
      show(state);
    },

    direction(value) {
      facing = value;
      if (svg) svg.dataset.figureDirection = value;
    },

    cipher(value) {
      const lines = hexStrip(value);
      hex.forEach((line, index) => {
        line.textContent = lines[index] ?? '';
      });
    },

    label(nearName, farName) {
      if (near) near.textContent = nearName;
      if (far) far.textContent = farName;
    },

    ratchet(messages) {
      if (!svg) return;
      /* The steps that are lit, listed rather than counted, so the CSS reads
         one step per rule with `~=` — the same idiom the parts use, and the
         only one an attribute selector can express without ten selectors. */
      const lit = Math.max(0, Math.min(RATCHET_STEPS, Math.floor(messages)));
      svg.dataset.figureRatchet = Array.from({ length: lit }, (_, step) => step + 1).join(' ');
    },
  };
}
