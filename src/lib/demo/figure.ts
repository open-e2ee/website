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
 */

export type StageState =
  | 'idle'
  | 'sdk-loading'
  | 'devices-ready'
  | 'session-established'
  | 'encrypted'
  | 'in-transit'
  | 'stored-at-relay'
  | 'delivered'
  | 'opened';

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
  'session-established':
    'Session established with PQXDH and ML-KEM. Both devices hold the derived key.',
  encrypted: 'Encrypted on this device. The plaintext and the private keys stay here.',
  'in-transit': 'On its way to the relay, with the metadata riding outside the envelope.',
  'stored-at-relay': 'This is the row your relay stores. Those bytes are the ciphertext.',
  delivered: 'Handed to the second device, still ciphertext. The relay keeps its copy.',
  opened: 'Opened on the second device. Same sentence, decrypted with the session key.',
};

/**
 * How long a state stays on screen before the next one may replace it.
 *
 * `--oe-duration-normal`, in milliseconds. A local relay answers in single
 * digits, so without a floor the seal, the transit and the storage would land
 * inside one frame and a reader would see the last of the three.
 */
const MIN_DWELL_MS = 180;

/*
 * The ciphertext the relay lane prints, and how the strip wraps it.
 *
 * Eighteen bytes is what the lane holds at a legible size — `DemoFigure.astro`
 * ships three `tspan`s and explains the arithmetic. Anything this produces
 * beyond that is dropped, because the extra lines have nowhere to go.
 */
const HEX_BYTES = 18;
const HEX_PER_LINE = 6;

export interface StageFigure {
  /** Queue a state, holding each one long enough to be seen. */
  advance(state: StageState): void;
  /** Show a state now, dropping anything queued behind it. */
  jump(state: StageState): void;
  /** Print the real ciphertext in the relay lane. */
  cipher(value: unknown): void;
  /** Name the two ends. `far` is what the second device is called here. */
  label(near: string, far: string): void;
}

const bytesOf = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    /* Not base64. The panel prints the field itself either way; the strip is
       the one place that has to decode, so it is the one place that declines. */
    return null;
  }
};

const hexLines = (bytes: Uint8Array): string[] => {
  const head = [...bytes.subarray(0, HEX_BYTES)].map((byte) =>
    byte.toString(16).padStart(2, '0'),
  );
  const lines: string[] = [];
  for (let at = 0; at < head.length; at += HEX_PER_LINE) {
    lines.push(head.slice(at, at + HEX_PER_LINE).join(' '));
  }
  return lines;
};

export function mountStageFigure(root: HTMLElement): StageFigure {
  const svg = root.querySelector<SVGSVGElement>('[data-figure-stage]');
  const caption = root.querySelector<HTMLElement>('[data-demo-figure-caption]');
  const hex = [...root.querySelectorAll<SVGTSpanElement>('[data-figure-hex-line]')];
  const near = root.querySelector<SVGTextElement>('[data-figure-near-label]');
  const far = root.querySelector<SVGTextElement>('[data-figure-far-label]');

  const show = (state: StageState) => {
    if (svg) svg.dataset.stageState = state;
    if (caption) caption.textContent = CAPTIONS[state];
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

    cipher(value) {
      const bytes = bytesOf(value);
      const lines = bytes ? hexLines(bytes) : [];
      hex.forEach((line, index) => {
        line.textContent = lines[index] ?? '';
      });
    },

    label(nearName, farName) {
      if (near) near.textContent = nearName;
      if (far) far.textContent = farName;
    },
  };
}
