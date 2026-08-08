/*
 * The two-tab section's DOM, and only its DOM.
 *
 * `render.ts` beside this one prints a scenario's finished result: one run, one
 * verdict, one call. This prints a conversation that is still going, where
 * every line arrives from an event and the reader is holding the other end of
 * it in another window. Different job, different file, and the page fetches
 * whichever of the two the press needs.
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
 * will disagree about whose mail is whose. The section's prose asks for one
 * more tab rather than more tabs for that reason.
 *
 * The type imports here are types only, so this module carries no SDK. The
 * six-line element helper is a copy of `render.ts`'s rather than an import of
 * it, because importing it would pull four scenarios' worth of rendering into
 * the chunk this section fetches.
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
  for (const [key, value] of Object.entries(envelope)) {
    fields.append(el('dt', key), el('dd', preview(value)));
  }
  row.append(fields);
  return row;
}

export interface TwoTabViewOptions {
  /** The page's own status line, which owns the words outside this block. */
  setStatus: (text: string) => void;
}

/**
 * Fill `root` with this tab's half of the conversation, wired to `session`.
 *
 * Renders nothing on its own account: every line below the composer comes from
 * an event the session emitted, so a section with an empty transcript is a
 * section where nothing has been sent, not one where the rendering broke.
 */
export function mountTwoTab(
  root: HTMLElement,
  session: TwoTabSession,
  { setStatus }: TwoTabViewOptions,
): void {
  root.replaceChildren();

  /* The section's state as data rather than as prose. The smoke harness drives
     two of these at once and has to know which tab it is looking at; reading
     that out of the sentence below would make a copy edit a red run. */
  root.dataset.twoTabRole = session.role;
  root.dataset.twoTabMe = session.me;
  root.dataset.twoTabPeer = session.peer;

  const identity = el('p', undefined, 'two-tab-identity');
  identity.append(
    'This tab is ',
    el('strong', session.me),
    ', writing to ',
    el('strong', session.peer),
    session.role === 'host'
      ? '. It is holding the relay, so keep it open.'
      : '. The first tab is holding the relay.',
  );

  const form = el('form', undefined, 'two-tab-composer');
  const label = el('label', `Message to ${session.peer}`, 'two-tab-label');
  const input = el('input', undefined, 'two-tab-input');
  input.dataset.twoTabInput = '';
  input.type = 'text';
  input.id = 'two-tab-message';
  input.autocomplete = 'off';
  input.placeholder = 'Say something';
  label.htmlFor = input.id;
  const submit = el('button', 'Send', 'oe-button');
  submit.dataset.twoTabSend = '';
  submit.type = 'submit';
  /*
   * Leaving, as something the reader does rather than something that happens.
   *
   * A tab that is closed takes its device and its subscriptions with it and
   * nobody finds out whether putting them away worked. That matters more here
   * than it reads: both `subscribe()` and `subscribeRetryRequests()` hand back
   * an unsubscribe function synchronously, and a relay that returned a promise
   * from either would send, deliver and decrypt perfectly and then fail in
   * `stop()` — the one call no scenario on this page makes. So the tab has a
   * way to leave, the smoke harness presses it in both tabs, and a teardown
   * that throws says so on the status line.
   */
  const leave = el('button', 'Disconnect this tab', 'oe-button oe-button-secondary');
  leave.dataset.twoTabDisconnect = '';
  leave.type = 'button';
  form.append(label, input, submit, leave);

  const transcript = el('ul', undefined, 'scenario-device-messages two-tab-transcript');
  const mine = el('div', undefined, 'scenario-device');
  mine.append(el('h4', 'This tab'), transcript);

  const envelopes = el('div', undefined, 'two-tab-envelopes');
  const relay = el('div', undefined, 'scenario-device');
  relay.append(el('h4', `What the relay is holding for ${session.peer}`), envelopes);

  const panes = el('div', undefined, 'scenario-devices');
  panes.append(mine, relay);
  root.append(identity, form, panes);

  const line = (role: string, text: string) => {
    const item = el('li', undefined, 'two-tab-line');
    item.dataset.twoTabLine = '';
    item.append(el('span', role, 'two-tab-role'), el('span', text, 'two-tab-text'));
    transcript.append(item);
    item.scrollIntoView({ block: 'nearest' });
  };

  let stored = 0;
  session.on((event) => {
    if (event.type === 'sent') {
      line(`${session.me} →`, event.text);
    } else if (event.type === 'received') {
      /* `senderId` off the decrypted message rather than `session.peer`: the
         label should say who the SDK decided this came from, which is the
         claim being demonstrated, not who this tab was expecting. */
      line(`${event.message.senderId} →`, event.message.content);
    } else {
      stored += 1;
      envelopes.append(renderEnvelope(event.envelope, stored));
    }
  });

  form.addEventListener('submit', (submitted) => {
    submitted.preventDefault();
    const text = input.value;
    if (text.trim().length === 0) return;
    input.disabled = true;
    submit.disabled = true;
    setStatus('Encrypting, and handing the envelope to the relay…');
    void session
      .send(text)
      .then(() => {
        input.value = '';
        setStatus(`The relay is holding it for ${session.peer}.`);
      })
      .catch((error: unknown) => {
        setStatus(`The send failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .finally(() => {
        input.disabled = false;
        submit.disabled = false;
        input.focus();
      });
  });

  leave.addEventListener('click', () => {
    leave.disabled = true;
    input.disabled = true;
    submit.disabled = true;
    setStatus('Closing this tab’s device and letting go of the relay…');
    void session
      .stop()
      .then(() => {
        root.dataset.twoTabStopped = '';
        setStatus(
          session.role === 'host'
            ? `${session.me} has left and the relay went with it. Reload both tabs to start again.`
            : `${session.me} has left. The other tab is still holding the relay.`,
        );
      })
      .catch((error: unknown) => {
        /* Loud, and not only on the console. A teardown that throws is the
           failure this control exists to expose, so it goes where the reader
           and the harness both read. */
        setStatus(
          `This tab could not close cleanly: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  });
}
