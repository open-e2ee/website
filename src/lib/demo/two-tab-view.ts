/*
 * The two-tab conversation, rendered into the stage the single-tab demo built.
 *
 * This used to own a section of its own: its own composer, its own transcript,
 * its own pair of panes under a heading further down the page. The stage
 * replaced all of that. There is one panel now — one field to type in, one
 * relay pane, one far pane — and it shows either the round trip this tab made
 * with itself or the conversation this tab is having with another one. So what
 * is left here is the second of those two renderings, writing into elements the
 * panel owns rather than into a root it fills.
 *
 * The relay pane is the argument this section exists to make, so it is not a
 * summary of the envelope. It is the row itself, key by key, read off the
 * object the relay stored — a field the SDK adds turns up here without anyone
 * deciding to show it, and a ciphertext that ever stopped being ciphertext
 * would be visible in the one place a reader is already looking. A pane that
 * printed a hand-written description of the row could not fail that way, which
 * is exactly why it would be worth less.
 *
 * A third tab is a guest like the second, which means it registers the same
 * account and device the second one did on storage of its own, and the two
 * will disagree about whose mail is whose. The pairing control opens exactly
 * one, and the panel's prose asks for one more tab rather than more tabs.
 *
 * The type imports here are types only, so this module carries no SDK. The
 * six-line element helper is a copy of `render.ts`'s rather than an import of
 * it, because importing it would pull four scenarios' worth of rendering into
 * the chunk this fetches.
 */

import type { Envelope } from '@open-e2ee/signal-protocol-sdk';
import type { TwoTabSession } from './two-tab.ts';

/** How much of a value the relay pane prints before it starts counting. */
const PREVIEW_CHARS = 96;
const PREVIEW_BYTES = 16;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const count = (value: number) => value.toLocaleString('en-US');

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');

/**
 * One field of a stored row, short enough to read and honest about the rest.
 *
 * The ciphertext is the field this exists for: a few thousand characters that
 * say nothing, where the length is the informative part and the first line of
 * it is the evidence. Everything else is short already and prints whole.
 */
function preview(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > PREVIEW_CHARS
      ? `${value.slice(0, PREVIEW_CHARS)}… (${count(value.length)} characters)`
      : value;
  }
  if (value instanceof Uint8Array) {
    const head = hex(value.subarray(0, PREVIEW_BYTES));
    return value.length > PREVIEW_BYTES
      ? `${head}… (${count(value.length)} bytes)`
      : `${head} (${count(value.length)} bytes)`;
  }
  if (value === null || typeof value !== 'object') return String(value);
  return JSON.stringify(value);
}

/** The row the relay is holding, printed as the relay holds it. */
function renderEnvelope(envelope: Envelope, nth: number): HTMLElement {
  const row = el('div', undefined, 'two-tab-envelope');
  row.dataset.twoTabRow = '';
  row.append(el('h5', `Row ${count(nth)}`));
  const fields = el('dl', undefined, 'two-tab-fields');
  for (const [field, value] of Object.entries(envelope)) {
    fields.append(el('dt', field), el('dd', preview(value)));
  }
  row.append(fields);
  return row;
}

export interface TwoTabViewOptions {
  /**
   * The block that says who this tab is. Carries the roles as data, because
   * the smoke harness drives two of these at once and has to know which tab it
   * is looking at; reading that out of a sentence would make a copy edit a red
   * run.
   */
  identity: HTMLElement;
  /** This tab's own sends. */
  sent: HTMLElement;
  /** What arrived from the other tab and decrypted here. */
  received: HTMLElement;
  /** The rows the relay is holding, printed field by field. */
  rows: HTMLElement;
  /** The page's own status line, which owns the words outside these panes. */
  setStatus: (text: string) => void;
  /** Handed every stored row, for the figure beside the panel. */
  onEnvelope?: (envelope: Envelope) => void;
  /** Called when a line from the other tab lands here. */
  onReceived?: () => void;
}

/**
 * Wire `session` to the stage's panes.
 *
 * Renders nothing on its own account: every line below the composer comes from
 * an event the session emitted, so an empty transcript is a stage where nothing
 * has been sent, not one where the rendering broke.
 *
 * Returns the unsubscribe the session handed back, so the panel can let go of
 * the panes when the reader disconnects.
 */
export function mountTwoTab(session: TwoTabSession, options: TwoTabViewOptions): () => void {
  const { identity, sent, received, rows, setStatus } = options;

  identity.dataset.twoTabRole = session.role;
  identity.dataset.twoTabMe = session.me;
  identity.dataset.twoTabPeer = session.peer;

  setStatus(
    session.role === 'host'
      ? `Connected as ${session.me}. This tab is holding the relay, so keep it open.`
      : `Connected as ${session.me}, through the relay in the other tab.`,
  );

  const line = (into: HTMLElement, role: string, text: string) => {
    const item = el('li', undefined, 'two-tab-line');
    item.dataset.twoTabLine = '';
    item.append(el('span', role, 'two-tab-role'), el('span', text, 'two-tab-text'));
    into.append(item);
    item.scrollIntoView({ block: 'nearest' });
  };

  let stored = 0;
  return session.on((event) => {
    if (event.type === 'sent') {
      line(sent, `${session.me} →`, event.text);
    } else if (event.type === 'received') {
      /* `senderId` off the decrypted message rather than `session.peer`: the
         label should say who the SDK decided this came from, which is the
         claim being demonstrated, not who this tab was expecting. */
      line(received, `${event.message.senderId} →`, event.message.content);
      options.onReceived?.();
    } else {
      stored += 1;
      rows.append(renderEnvelope(event.envelope, stored));
      options.onEnvelope?.(event.envelope);
    }
  });
}
