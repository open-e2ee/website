/*
 * One identity, one tab, and a relay in the other one.
 *
 * The scenarios on /demo run both accounts in a single tab. That is the right
 * shape for showing a protocol failure — it is deterministic and it fits in
 * one screen — but it is the wrong shape for being believed. A reader watching
 * a sentence travel between two variables in one page has been shown a data
 * structure. So this module boots exactly one account, in this tab, on storage
 * only this tab can read, and reaches the other account through
 * `./broadcast-relay`.
 *
 * Deliberately not built on `./driver`. `exchange()` there waits for the
 * recipient's devices to decrypt before it resolves, which it can do because
 * those devices are in the same tab. Here they are not, and a sender that
 * waited for them would be waiting on something it has no right to see: a real
 * sender does not observe the recipient's decryption, and a demo that pretended
 * otherwise would be teaching the wrong picture in order to reuse a function.
 *
 * So a send here resolves when the relay has the envelope, and what the other
 * tab makes of it appears in the other tab. Both tabs show the envelope pane,
 * because both tabs can legitimately see what the relay holds — that is the
 * one thing a relay is not hiding.
 *
 * Who is who is settled by which tab holds the relay, so there is nothing to
 * negotiate and no state to disagree about. The tab that holds it is `alice`;
 * the others are `bob`.
 */

import { DEFAULT_DEVICE_ID, createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import type {
  DecryptedEnvelope,
  Envelope,
  SendResult,
  SignalProtocolClient,
} from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import { broadcastRelay } from './broadcast-relay.ts';
import type { BroadcastRelayOptions } from './broadcast-relay.ts';
import { withDeadline } from './deadline.ts';

/** How long a send waits for the relay to acknowledge the envelope. */
const ENVELOPE_DEADLINE_MS = 10_000;

/** Whose message a stored row carries: one this tab sent, or one it was sent. */
export type EnvelopeDirection = 'out' | 'in';

export type TwoTabEvent =
  /** This tab's own send was accepted, and the relay is holding the row. */
  | { type: 'sent'; text: string; result: SendResult; envelope: Envelope }
  /** The other tab sent something and this device decrypted it. */
  | { type: 'received'; message: DecryptedEnvelope }
  /** A row the relay is holding, either way round. What the relay sees. */
  | { type: 'envelope-stored'; envelope: Envelope; direction: EnvelopeDirection };

export interface TwoTabSession {
  /** `'host'` holds the relay for every tab; `'guest'` calls into it. */
  readonly role: 'host' | 'guest';
  /** The account this tab is. */
  readonly me: string;
  /** The account the other tab is. */
  readonly peer: string;
  readonly client: SignalProtocolClient;
  /** Everything this device has decrypted, oldest first. */
  readonly received: readonly DecryptedEnvelope[];
  on(listener: (event: TwoTabEvent) => void): () => void;
  /** Encrypt for the peer and hand it to the relay. */
  send(text: string): Promise<{ result: SendResult; envelope: Envelope }>;
  stop(): Promise<void>;
}

export interface TwoTabOptions extends BroadcastRelayOptions {
  /** Named for the reader; the pairing still follows the relay role. */
  names?: { host: string; guest: string };
  envelopeDeadlineMs?: number;
}

export async function startTwoTabSession(options: TwoTabOptions = {}): Promise<TwoTabSession> {
  const names = options.names ?? { host: 'alice', guest: 'bob' };
  const envelopeDeadlineMs = options.envelopeDeadlineMs ?? ENVELOPE_DEADLINE_MS;

  const wire = await broadcastRelay(options);
  const relay = wire.relay;
  const me = wire.role === 'host' ? names.host : names.guest;
  const peer = wire.role === 'host' ? names.guest : names.host;

  const listeners = new Set<(event: TwoTabEvent) => void>();
  const emit = (event: TwoTabEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* a subscriber's render failure is its own to report */
      }
    }
  };

  await wire.relay.registerDevice(me, { encryptedDeviceName: new ArrayBuffer(0) });

  const client = await createSignalProtocolClient({
    identity: { userId: me },
    adapters: { storage: inMemoryStore(), relay },
  });
  await client.syncToServer();

  const received: DecryptedEnvelope[] = [];
  client.registerHook('onMessageDecrypted', (message) => {
    received.push(message);
    emit({ type: 'received', message });
  });
  client.startRelaySubscription();

  /*
   * Watch both rows the relay holds: the one addressed to the other tab, and
   * the one addressed to this one.
   *
   * This is the demo looking at the relay, not this device reading its mail —
   * the mail is the subscription above, and this watch neither consumes a row
   * nor acknowledges one. A relay genuinely does hold both, and showing them is
   * the point: it is the pane where a reader can see that what the relay has is
   * ciphertext.
   *
   * The inbound watch is what makes the pane true on a tab that has not sent
   * anything. Without it a receiving tab had a relay pane it could never fill,
   * and a figure whose byte strip either stood empty or went on showing the
   * bytes of the last message this tab *sent* — under a caption about the
   * message it had just been handed.
   *
   * Two subscribers on one address is not a race. The relay's `subscribe` is
   * fan-out: it appends to a list, replays what is pending to the arriving
   * subscriber only, and deletes nothing — removal is `markDelivered`'s, which
   * only the client calls. The client subscribes first, above, so this is never
   * the first subscriber on its own address.
   */
  const pending: Envelope[] = [];
  let onEnvelope: ((envelope: Envelope) => void) | null = null;
  const unwatchOut = wire.relay.subscribe(peer, DEFAULT_DEVICE_ID, (envelope: Envelope) => {
    if (onEnvelope) onEnvelope(envelope);
    else pending.push(envelope);
    emit({ type: 'envelope-stored', envelope, direction: 'out' });
  });
  /* Deliberately not wired to `onEnvelope`: that resolver belongs to this tab's
     own send, and a row arriving from the other tab mid-send would resolve it
     with someone else's envelope. */
  const unwatchIn = wire.relay.subscribe(me, DEFAULT_DEVICE_ID, (envelope: Envelope) => {
    emit({ type: 'envelope-stored', envelope, direction: 'in' });
  });
  const unwatch = () => {
    unwatchOut();
    unwatchIn();
  };

  let queue: Promise<unknown> = Promise.resolve();

  async function deliver(text: string) {
    /* Anything queued belongs to a send that already finished. */
    pending.length = 0;
    const envelopeArrived = new Promise<Envelope>((resolve) => {
      onEnvelope = resolve;
    });

    let result: SendResult;
    try {
      result = await client.send(peer, text);
    } catch (error) {
      onEnvelope = null;
      throw error;
    }

    /* Held open across the wait rather than closed when the send resolves.
       Over a channel the envelope has not arrived yet, and closing it here is
       the defect that hung the single-tab driver. */
    try {
      const envelope = await withDeadline(envelopeArrived, envelopeDeadlineMs, 'the envelope');
      emit({ type: 'sent', text, result, envelope });
      return { result, envelope };
    } finally {
      onEnvelope = null;
    }
  }

  return {
    role: wire.role,
    me,
    peer,
    client,
    received,

    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    send(text) {
      if (text.trim().length === 0) {
        return Promise.reject(new Error('nothing to send: the message is empty'));
      }
      const run = queue.then(
        () => deliver(text),
        () => deliver(text),
      );
      queue = run.catch(() => {});
      return run;
    },

    async stop() {
      unwatch();
      listeners.clear();
      await client.stop();
      wire.close();
    },
  };
}
