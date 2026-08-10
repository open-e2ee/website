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
 * negotiate and no state to disagree about. The tab that holds it is an
 * `alice`; the others are a `bob`.
 *
 * An `alice`, not `alice`, and the difference is what makes a reloaded tab
 * able to come back. A session's keys live in `inMemoryStore()`, so a reload
 * destroys them and the tab that returns is holding a new identity under the
 * old name — which the relay refuses, correctly and by design, with
 * "Account identity already exists with a different composite tuple". The
 * /demo scenario `reinstall-a-device` exists to teach that this refusal is the
 * right answer, so the fix cannot be to defeat it. It is to stop lying about
 * who this is: new keys are a new identity, so each session takes a fresh
 * account name and the refusal never arises.
 *
 * That has a consequence worth stating, because it is the honest one: a tab
 * cannot know its correspondent's address until the correspondent tells it.
 * `peer` is therefore empty until `meet()`, and `send()` refuses until then.
 * `./presence` is what carries the name, and it already carried it.
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
  /** The other tab named itself, so this one now has somewhere to write. */
  | { type: 'met'; peer: string }
  /** The other tab sent something and this device decrypted it. */
  | { type: 'received'; message: DecryptedEnvelope }
  /** A row the relay is holding, either way round. What the relay sees. */
  | { type: 'envelope-stored'; envelope: Envelope; direction: EnvelopeDirection };

export interface TwoTabSession {
  /** `'host'` holds the relay for every tab; `'guest'` calls into it. */
  readonly role: 'host' | 'guest';
  /** The account this tab is, unique to this session. */
  readonly me: string;
  /** The account the other tab is, or `null` until one has said so. */
  readonly peer: string | null;
  readonly client: SignalProtocolClient;
  /** Everything this device has decrypted, oldest first. */
  readonly received: readonly DecryptedEnvelope[];
  on(listener: (event: TwoTabEvent) => void): () => void;
  /**
   * Name the account in the other tab, and start watching its row.
   *
   * Idempotent for a name already met. Called again with a different one —
   * which is what a reloaded tab coming back as a new identity looks like —
   * it lets go of the old row and follows the new one.
   */
  meet(peer: string): void;
  /** Encrypt for the peer and hand it to the relay. Refuses before `meet()`. */
  send(text: string): Promise<{ result: SendResult; envelope: Envelope }>;
  stop(): Promise<void>;
}

export interface TwoTabOptions extends BroadcastRelayOptions {
  /** Stems, not addresses: each session suffixes the one its role picks. */
  names?: { host: string; guest: string };
  envelopeDeadlineMs?: number;
}

/**
 * A name no other session on this origin is holding.
 *
 * Short on purpose. It is printed twice on screen — beside the device in the
 * near pane, and as `senderId` in the envelope's own field list — and the
 * panes are read on a 320-unit-wide phone. Four base-36 characters is a name
 * a reader can take in and still 1.7 million to one against a collision
 * between the only two sessions that can exist at once.
 */
const freshName = (stem: string) => `${stem}-${Math.random().toString(36).slice(2, 6)}`;

export async function startTwoTabSession(options: TwoTabOptions = {}): Promise<TwoTabSession> {
  const names = options.names ?? { host: 'alice', guest: 'bob' };
  const envelopeDeadlineMs = options.envelopeDeadlineMs ?? ENVELOPE_DEADLINE_MS;

  const wire = await broadcastRelay(options);
  const relay = wire.relay;
  const me = freshName(wire.role === 'host' ? names.host : names.guest);

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
  /* Deliberately not wired to `onEnvelope`: that resolver belongs to this tab's
     own send, and a row arriving from the other tab mid-send would resolve it
     with someone else's envelope. */
  const unwatchIn = wire.relay.subscribe(me, DEFAULT_DEVICE_ID, (envelope: Envelope) => {
    emit({ type: 'envelope-stored', envelope, direction: 'in' });
  });

  /* The outbound half cannot be installed at boot any more: there is no
     address to watch until the other tab has said what it is called. */
  let peer: string | null = null;
  let unwatchOut: (() => void) | null = null;

  const meet = (name: string) => {
    if (name === me) {
      throw new Error(`this tab is already ${me}, so the other tab cannot be it too`);
    }
    if (name === peer) return;
    unwatchOut?.();
    peer = name;
    unwatchOut = wire.relay.subscribe(name, DEFAULT_DEVICE_ID, (envelope: Envelope) => {
      if (onEnvelope) onEnvelope(envelope);
      else pending.push(envelope);
      emit({ type: 'envelope-stored', envelope, direction: 'out' });
    });
    emit({ type: 'met', peer: name });
  };

  const unwatch = () => {
    unwatchOut?.();
    unwatchOut = null;
    unwatchIn();
  };

  let queue: Promise<unknown> = Promise.resolve();

  async function deliver(text: string) {
    const recipient = peer;
    if (recipient === null) {
      throw new Error('there is no second tab yet, so there is nobody to encrypt this for');
    }
    /* Anything queued belongs to a send that already finished. */
    pending.length = 0;
    const envelopeArrived = new Promise<Envelope>((resolve) => {
      onEnvelope = resolve;
    });

    let result: SendResult;
    try {
      result = await client.send(recipient, text);
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
    /* A getter, not a field: `meet()` can land after the panel has taken this
       object, and a snapshot taken at boot would say `null` for the rest of
       the session. */
    get peer() {
      return peer;
    },
    client,
    received,

    meet,

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
