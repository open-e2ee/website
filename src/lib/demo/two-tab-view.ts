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
 * The relay pane is the argument this section exists to make, and it is printed
 * by the panel rather than here. This file used to print it too, which meant
 * the page had two printers for one envelope and showed whichever the reader
 * had reached — one of them summarising fields the other printed whole, one of
 * them writing the literal `undefined` into a cell on the pane whose subject is
 * what a relay can read. What is left here are the transcripts, and the rows go
 * out through `onEnvelope` to the printer that owns them.
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
import type { EnvelopeDirection, TwoTabSession } from './two-tab.ts';

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
  /** The page's own status line, which owns the words outside these panes. */
  setStatus: (text: string) => void;
  /**
   * Handed every row the relay takes, either way round.
   *
   * The row itself is printed by the panel, not here. There used to be a second
   * printer in this file, and it was the worse of the two: it stringified an
   * absent field to the literal `undefined`, it summarised where the panel's
   * prints, and it drifted a field behind. One envelope, one printer.
   */
  onEnvelope?: (envelope: Envelope, direction: EnvelopeDirection) => void;
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
  const { identity, sent, received, setStatus } = options;

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
      options.onEnvelope?.(event.envelope, event.direction);
    }
  });
}
