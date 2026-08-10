/*
 * The stage drawing, driven from the recording.
 *
 * Every part of the drawing is already in the HTML the build shipped. This
 * module decides which parts are on screen and fills in the four things that
 * could not be known at build time: the sentence at each device, the metadata
 * beside the row the relay is holding, how far each session has advanced, and
 * which step the reader is looking at.
 *
 * It holds no timer and reads no measurement. The pace comes from `playback.ts`
 * and arrives here as a `Cue`, which is the recording with every number taken
 * out — so nothing in this file could scale a figure by the speed control even
 * if it wanted to. `trace.ts` explains why that is a fact about the types rather
 * than a rule someone has to keep.
 *
 * -------------------------------------------------- two of everything ---
 *
 * The stage renders two compositions, wide and stacked, and the stylesheet shows
 * one of them. Both are in the DOM at all times, which makes `querySelector` the
 * wrong call everywhere in this file: it would write the sentence into the
 * desktop drawing and leave the phone's blank, and the failure would be
 * invisible to whoever was looking at a desktop. Every write here goes to every
 * matching node, and `mountStage` refuses to start if the two compositions do
 * not offer the same slots to write into.
 *
 * The state attributes are the exception and they are safe: they live on the
 * one `<figure>` that wraps both compositions, so there is a single node to set
 * and no way for the two drawings to disagree about which step it is.
 */

import type { Actor, Cue, Step } from './trace.ts';

/** The two ends of the conversation. The relay is not one of them. */
type Side = Exclude<Actor, 'relay'>;

/**
 * What each step says, in plain words, for the caption under the drawing.
 *
 * Both SVGs are `aria-hidden`, so this is not a description of the picture — it
 * is the picture, for every reader who does not get one. That is why each line
 * says what became true rather than what moved.
 *
 * `{from}` and `{to}` are filled with the account names the run is really using,
 * so a caption cannot claim a direction the trace did not record. The steps that
 * carry no direction have no placeholder, and that is not an oversight: nobody
 * is sending anything while the devices are booting.
 *
 * The relay's line says `never needs`, which is the fixed formula, and not
 * `cannot read`, which would be false — the relay could be given plaintext by
 * software that chose to hand it over. The site asserts the difference in
 * `tests/site-content.test.mjs`.
 */
export const STEP_CAPTIONS: Readonly<Record<Step, string>> = {
  idle: 'Nothing has run yet: two devices with empty stores, and a relay holding nothing.',
  'devices-ready': 'Both devices are up. Each generated its own identity key, into its own store.',
  'bundles-published':
    'Each device published its public prekey bundle. The private halves never left the devices.',
  'session-established':
    'The devices derived a shared session key from those bundles. The relay carried the public halves and holds no session.',
  encrypted: '{from} encrypted the sentence. The plaintext stays on {from}’s device.',
  'in-transit': 'The envelope is on its way, with its metadata readable on the outside.',
  'stored-at-relay':
    'The relay is holding the row: who it is from, who it is for, when, and how big. It never needs the plaintext.',
  delivered: 'The relay handed the envelope to {to}’s device.',
  opened: '{to} opened the envelope. The sentence is readable again, on {to}’s device.',
};

/**
 * The envelope fields the drawing prints, by name.
 *
 * Read off the envelope rather than described, and a test in
 * `tests/demo-run.test.mjs` fails if any name here is not a key of an envelope a
 * real send produced. A renamed field goes red rather than blank, which is the
 * whole reason this list is exported instead of being four string literals in
 * the function below.
 *
 * Four of twelve, chosen for the postal argument the drawing is making: who it
 * is from, who it is for, when, and how big. `ciphertext` earns its place as the
 * fourth by its length rather than its value — the byte count is the honest
 * answer to "how big", and printing the bytes themselves is the column's job a
 * few centimetres away, not the drawing's.
 */
export const FIELD_NAMES = ['senderUserId', 'targetUserId', 'timestamp', 'ciphertext'] as const;

/**
 * A step, plus whatever that step put on the drawing.
 *
 * This is a `Cue` — the recording with every number removed — carrying text the
 * drawing cannot know at build time. Everything added here is a string, and
 * every string was formatted from the recording *before* it entered the pace
 * layer. That ordering is the point, and it is what keeps §3 of the brief true
 * once the drawing needs a byte count on it: no code downstream of the speed
 * control ever holds a number, so there is nothing there for a speed to scale.
 * Slow the animation to a crawl and the same characters arrive later.
 *
 * The payload fields are optional because most steps carry none, and what a step
 * puts on the drawing stays there — nothing repeats a previous step's payload,
 * and the drawing accumulates until `clear()`.
 */
export interface StageCue extends Cue {
  /** A sentence that became readable at a device on this step. */
  readonly sentence?: { readonly side: Side; readonly text: string };
  /** The metadata beside the stored row, already formatted from the envelope. */
  readonly fields?: readonly string[];
  /** How many session steps each device has taken, once this step is reached. */
  readonly ratchet?: Readonly<Record<Side, number>>;
}

export interface StageView {
  /**
   * Put a step on screen, with whatever it carries.
   *
   * The only call the pace layer makes, and the drawing is a function of the
   * cues it has been given rather than of anything this module remembers. That
   * is what will let a reset be a state the stage can be put into rather than a
   * sequence of steps to be undone.
   */
  show(cue: StageCue): void;
  /** The caption for a cue, in the run's own account names. */
  caption(cue: Cue): string;
  /** Back to a page that has run nothing. */
  clear(): void;
}

export interface StageNames {
  readonly a: string;
  readonly b: string;
}

/** Everything this module writes into, found once and checked once. */
interface Slots {
  readonly content: Readonly<Record<Side, readonly SVGTextElement[]>>;
  readonly fields: readonly SVGTextElement[];
  readonly caption: HTMLElement;
}

const SIDES: readonly Side[] = ['a', 'b'];

/**
 * The lines inside one text block, and how wide the drawing says they are.
 *
 * The width is read from the drawing rather than imported from the geometry,
 * and the line count is however many lines the drawing actually offers. Both
 * numbers are computed in `stage-geometry.ts` from the real device width and the
 * real advance of the mono face; importing them here would put a thirty-kilobyte
 * build-time module into a chunk that needs two integers out of it, and copying
 * them would create a second opinion about a width there can only be one of.
 */
function block(node: SVGTextElement): { lines: SVGTSpanElement[]; columns: number } {
  const lines = [...node.querySelectorAll<SVGTSpanElement>('[data-stage-content-line], [data-stage-field-line]')];
  const columns = Number(node.dataset.stageColumns);
  if (lines.length === 0 || !Number.isFinite(columns) || columns <= 0) {
    throw new Error('demo stage: a text block arrived with no lines or no width');
  }
  return { lines, columns };
}

/**
 * A sentence broken over the lines a device has for it.
 *
 * Greedy, on words, and a word longer than the line is cut rather than allowed
 * to run out of the box — the box is the point of the drawing. Anything past the
 * last line ends in an ellipsis, so a reader can tell a clipped sentence from a
 * short one; a silent truncation would make the drawing quietly disagree with
 * the conversation column printing the same sentence in full.
 */
function wrap(text: string, columns: number, lines: number): string[] {
  /* A word too long for a line is broken across lines before anything is
     wrapped, so the loop below only ever sees words that fit. Doing it here
     rather than inside the loop is what keeps the wrap a wrap: the alternative
     needs the loop to both consume and produce words, which is where the first
     draft of this went wrong. */
  const words: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let at = 0; at < word.length; at += columns) words.push(word.slice(at, at + columns));
  }

  const out: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (candidate.length <= columns) {
      line = candidate;
      continue;
    }
    out.push(line);
    line = word;
  }
  if (line !== '') out.push(line);

  if (out.length <= lines) return out;
  const shown = out.slice(0, lines);
  shown[lines - 1] = `${shown[lines - 1].slice(0, Math.max(0, columns - 1))}…`;
  return shown;
}

/**
 * Fill a text block, blanking the lines the value does not reach.
 *
 * The clip to `columns` is here rather than in each caller because how wide a
 * line may be is the drawing's business and the drawing is what this function
 * holds. A caller that formats a line too long for the box gets it cut by the
 * width that is really there, which is what `stage-geometry.ts` computes those
 * two numbers for.
 */
function fill(
  nodes: readonly SVGTextElement[],
  value: (columns: number, lines: number) => readonly string[],
) {
  for (const node of nodes) {
    const { lines, columns } = block(node);
    const text = value(columns, lines.length);
    lines.forEach((line, index) => {
      line.textContent = (text[index] ?? '').slice(0, columns);
    });
  }
}

/**
 * The four printed fields, from the object the relay stored.
 *
 * Pure, and called before the lines enter the pace layer — see `StageCue`. Every
 * value is fetched by a name in `FIELD_NAMES`, so the drift check covers the
 * whole of what this function reads: there is no fifth field hidden in the
 * formatting. `timestamp` is a moment and is printed as one; the byte count is
 * passed in because it is measured from the ciphertext rather than read off the
 * envelope, and measuring it here would give this module a second job.
 */
export function envelopeFields(
  envelope: Readonly<Record<string, unknown>>,
  bytes: number,
): string[] {
  const at = new Date(Number(envelope.timestamp));
  const time = Number.isFinite(at.getTime())
    ? at.toISOString().slice(11, 19)
    : String(envelope.timestamp);
  return [
    `senderUserId ${String(envelope.senderUserId)}`,
    `targetUserId ${String(envelope.targetUserId)}`,
    `timestamp ${time}`,
    `ciphertext ${bytes.toLocaleString('en-US')} B`,
  ];
}

export function mountStage(root: HTMLElement, names: StageNames): StageView {
  const all = <E extends Element>(selector: string) => [...root.querySelectorAll<E>(selector)];

  const content = Object.fromEntries(
    SIDES.map((side) => [side, all<SVGTextElement>(`[data-stage-content="${side}"]`)]),
  ) as Record<Side, SVGTextElement[]>;
  const caption = root.querySelector<HTMLElement>('[data-stage-caption]');

  /*
   * Mounting fails loudly on a drawing that cannot be written into.
   *
   * A view that quietly writes nowhere is the failure this whole file is
   * arranged against: the page would come up, the transport would run, every
   * step would light, and the sentence would never appear — with no error
   * anywhere to say why. Two compositions are expected because the stylesheet
   * switches between two, and a count of one means a composition lost its slots
   * while the media query kept switching to it.
   */
  const fields = all<SVGTextElement>('[data-stage-fields]');
  /* Checked with an `if` rather than counted with the rest, so the narrowing is
     the compiler's own and the object below needs no assertion to be built. */
  if (!caption) {
    throw new Error('demo stage: the drawing has no caption to write the step into');
  }
  for (const [what, found] of [
    ['device a’s sentence', content.a.length],
    ['device b’s sentence', content.b.length],
    ['the relay’s metadata', fields.length],
  ] as const) {
    if (found !== 2) {
      throw new Error(
        `demo stage: expected both compositions to offer ${what} and found ${found} — the ` +
          'drawing and the module driving it disagree',
      );
    }
  }
  const slots: Slots = { content, fields, caption };

  const named = (actor: Actor | undefined): string =>
    actor === 'a' ? names.a : actor === 'b' ? names.b : 'the relay';

  const view: StageView = {
    caption(cue) {
      return STEP_CAPTIONS[cue.step]
        .replace(/\{from\}/g, named(cue.from))
        .replace(/\{to\}/g, named(cue.to));
    },

    show(cue) {
      root.dataset.stageState = cue.step;
      slots.caption.textContent = view.caption(cue);

      if (cue.sentence) {
        const { side, text } = cue.sentence;
        fill(slots.content[side], (columns, lines) => wrap(text, columns, lines));
      }
      if (cue.fields) {
        const lines = cue.fields;
        fill(slots.fields, () => [...lines]);
      }
      if (cue.ratchet) {
        for (const side of SIDES) {
          const taken = Math.max(0, cue.ratchet[side]);
          const steps = Array.from({ length: taken }, (_, index) => String(index + 1));
          root.dataset[side === 'a' ? 'stageRatchetA' : 'stageRatchetB'] = steps.join(' ');
        }
      }
    },

    clear() {
      root.dataset.stageState = 'idle';
      root.dataset.stageRatchetA = '';
      root.dataset.stageRatchetB = '';
      slots.caption.textContent = STEP_CAPTIONS.idle;
      for (const side of SIDES) fill(slots.content[side], () => []);
      fill(slots.fields, () => []);
    },
  };

  return view;
}
