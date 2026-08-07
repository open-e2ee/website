/*
 * One conversation, driven by the shipped SDK, for every demo surface to reuse.
 *
 * The homepage panel, the /demo scenarios and the two-tab relay all need the
 * same three things — boot the two accounts, send a sentence, read what each
 * stage produced — and the site has already paid once for that being written
 * by hand:
 * the recorded carrier panel's metadata list was maintained separately from the
 * envelope and drifted from ten fields to six. So this module hands over the
 * live `Envelope` object rather than a description of it (invariant 4), and the
 * cryptography is the shipped cryptography (invariant 1): real
 * `createSignalProtocolClient`, real PQXDH, real Double Ratchet. What is
 * simulated is the infrastructure around it — `inMemoryStore()` for the device
 * and `inMemoryRelay()` for the server — which is what the disclosure beside
 * the demo has to say out loud (invariant 5).
 *
 * Nothing in here touches the DOM. It is imported dynamically by `./loader`,
 * which is what keeps the 713 KB it pulls off the homepage's first paint, and
 * it stays framework-free so that a plain `<script type="module">` can consume
 * it under `script-src 'self'` — the only shape LD0 found that runs, since
 * Astro emits island hydration as inline script that this CSP refuses.
 *
 * The barrel import is deliberate. LD0 measured subpath imports saving 4,208 B
 * of 730,280 B (0.58%), because 71.4% of the payload is one chunk of SPQR
 * Reed-Solomon tables that every route to `createSignalProtocolClient` pulls.
 * The adapters have no barrel export and come from their own subpaths, exactly
 * as the published quickstart writes them.
 */

import { DEFAULT_DEVICE_ID, createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import type {
  DecryptedEnvelope,
  Envelope,
  ILogger,
  SendResult,
  SignalProtocolClient,
} from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import type { InMemorySignalProtocolStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import { inMemoryRelay } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory';
import type { InMemorySignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory';

export interface DemoSessionOptions {
  /** Account that types. Shown to the reader, so callers name it. */
  sender?: string;
  /** Account that receives and decrypts. */
  recipient?: string;
  /**
   * Where each device's own log goes.
   *
   * The SDK takes an `ILogger` per client and reports through it. That is the
   * only surface on which a relay-path decryption failure is visible at all:
   * `onDecryptionError` is documented as "called when decryption fails", but
   * the relay subscription handles a failure through its own retry machinery
   * and never invokes the hook — it is reached only from the manual
   * `decryptMessage`/`decryptMessages` calls. A scenario that wants to show
   * what the SDK said when it refused a message has to read it from here.
   *
   * Kept per role rather than as one logger for both, because a scenario that
   * prints these has to be able to say which device spoke.
   */
  logger?: { sender?: ILogger; recipient?: ILogger };
  /**
   * A hostile network, in the one place a hostile network sits.
   *
   * Called with each envelope on its way into the relay, and its return value
   * is what the relay stores. Typed synchronous because every scenario that
   * uses it corrupts bytes rather than delays them, and because the shape of
   * the transform is the shape of the thing being demonstrated. Delivery
   * arriving after `send()` resolves is no longer a hazard either way —
   * `exchange()` bounds its waits — but a transform that returns a promise
   * would hand the relay a promise where it expects an envelope.
   */
  tamper?: (envelope: Envelope) => Envelope;
  /**
   * The relay to run the session on, instead of a fresh `inMemoryRelay()`.
   *
   * This exists as a test boundary rather than as a configuration knob. The
   * whole of `exchange()` below is a set of waits on things a relay delivers,
   * and in-memory the relay delivers all of them inside `send()` — so a test
   * that only ever sees `inMemoryRelay()` cannot reach the case where it does
   * not, which is the case that matters and the case that shipped broken.
   * Passing a wrapper that defers delivery is how that case gets tested.
   */
  relay?: InMemorySignalProtocolRelayServer;
  /**
   * How long a send waits for the relay before giving up, in milliseconds.
   *
   * Generous by default, because the failure it guards against is rare and a
   * false one would abort a send that was merely slow. Lowered by tests that
   * want the failure itself rather than the wait.
   */
  deadlineMs?: number;
}

/**
 * How long `exchange()` waits for anything the relay has to hand back.
 *
 * Ten seconds is far longer than a local round trip — the whole boot,
 * handshake included, is a fraction of it — and is chosen so that the deadline
 * can only be reached by something actually being wrong.
 */
const DELIVERY_DEADLINE_MS = 10_000;

/**
 * What one send produced, at each stage a reader can be shown.
 *
 * `envelope` is the object the relay stored, and `decrypted` is the object the
 * receiving device's `onMessageDecrypted` hook was handed. Neither is copied,
 * reshaped or filtered: a pane that renders from these cannot drift from what
 * the protocol did.
 */
export interface DemoExchange {
  text: string;
  result: SendResult;
  envelope: Envelope;
  decrypted: DecryptedEnvelope;
  /**
   * What each recipient device got back, in the order the devices were linked.
   * With one device this is `[decrypted]`; the entries are the same objects.
   */
  deliveries: { deviceId: number; message: DecryptedEnvelope }[];
  /** Handing the plaintext to the SDK until the relay accepted the envelope. */
  encryptMs: number;
  /** The same start, until every recipient device had the plaintext back. */
  roundTripMs: number;
}

/**
 * One device of the receiving account, and everything it has decrypted.
 *
 * `received` is the device's scroll-back and grows for as long as the session
 * runs. A device linked part-way through a conversation starts empty and stays
 * empty about everything sent before it existed — which is a fact about the
 * protocol rather than about this demo, and is the whole subject of the
 * second-device scenario.
 */
export interface DemoRecipientDevice {
  readonly deviceId: number;
  readonly received: DecryptedEnvelope[];
}

export type DemoEvent =
  /** The SDK accepted the sentence and the relay acknowledged the envelope. */
  | { type: 'message-sent'; text: string; result: SendResult; encryptMs: number }
  /**
   * The relay stored a row. This can arrive before `message-sent`: the relay
   * accepts the envelope inside the send call, so the acknowledgement it
   * returns is necessarily later. The order is reported as it happens rather
   * than rearranged into the tidier story.
   */
  | { type: 'envelope-stored'; envelope: Envelope }
  /** The receiving device decrypted it, on the device, after the relay. */
  | { type: 'message-decrypted'; message: DecryptedEnvelope; roundTripMs: number };

export interface DemoSession {
  readonly sender: string;
  readonly recipient: string;
  /** Handshake cost, from the `oe-demo:boot` performance measure. */
  readonly bootMs: number;
  /**
   * The relay both accounts are registered with.
   *
   * Handed over because some of what a scenario has to show is a conversation
   * with the server rather than with a client: linking a device is a
   * provisioning session on the relay, and fetching a prekey bundle for a
   * device the sender has never written to is a relay call the application
   * makes by hand.
   */
  readonly relay: InMemorySignalProtocolRelayServer;
  /** The sending device, for the SDK calls a scenario has to make itself. */
  readonly senderClient: SignalProtocolClient;
  /** The receiving account's primary device, and its storage. */
  readonly recipientClient: SignalProtocolClient;
  readonly recipientStorage: InMemorySignalProtocolStore;
  /** Every device of the receiving account, primary first, in link order. */
  readonly recipientDevices: readonly DemoRecipientDevice[];
  /**
   * Take a further device of the receiving account into the session: record
   * what it decrypts, and make `send()` wait for it as well as for the
   * primary.
   *
   * The client is built by the caller, because building it is the point of the
   * scenario that does this — a linked device is created against storage
   * provisioning has already written the account identity into, and hiding
   * that call in here would hide the thing worth showing. Once handed over,
   * the session stops it with the rest.
   */
  watchRecipientDevice(client: SignalProtocolClient): DemoRecipientDevice;
  /** Watch the pipeline. Returns a function that stops delivery. */
  on(listener: (event: DemoEvent) => void): () => void;
  send(text: string): Promise<DemoExchange>;
  /** Tear down every client and the relay observer. */
  stop(): Promise<void>;
}

/**
 * Measure between two marks and hand back the duration.
 *
 * The numbers a demo surface prints come from `performance` rather than from
 * `Date.now()` arithmetic so that a reader who opens their own Performance
 * panel sees the same entries the page is quoting, under the same names.
 */
function measure(name: string, from: string, to: string): number {
  return performance.measure(name, from, to).duration;
}

/**
 * Wait for something the relay owes us, or fail saying what never came.
 *
 * `inMemoryRelay()` hands the envelope to its subscriber inside `send()`, so
 * in this tab every one of these values has already arrived before it is
 * awaited. No relay that crosses anything — a BroadcastChannel, a socket, a
 * network — can promise that, and one that never delivers turns a bare
 * `await` into the worst failure a demo has available: no error, no rejection,
 * no console line, a spinner that runs until the reader closes the tab.
 *
 * So the wait is bounded, and reaching the bound is an ordinary rejection that
 * the surface above renders as a failure like any other. Loud and wrong beats
 * silent and stuck: a deadline that fires early costs a reader one confusing
 * error message, and one that never fires costs them the page.
 */
function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`the relay never delivered ${what} (waited ${ms}ms)`)), ms);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

export async function startDemoSession(options: DemoSessionOptions = {}): Promise<DemoSession> {
  const sender = options.sender ?? 'alice';
  const recipient = options.recipient ?? 'bob';

  performance.mark('oe-demo:boot:start');

  const deadlineMs = options.deadlineMs ?? DELIVERY_DEADLINE_MS;

  const relay = options.relay ?? inMemoryRelay();
  await relay.registerDevice(sender, { encryptedDeviceName: new ArrayBuffer(0) });
  await relay.registerDevice(recipient, { encryptedDeviceName: new ArrayBuffer(0) });

  const senderStorage = inMemoryStore();
  const recipientStorage = inMemoryStore();

  /* The transform goes on the relay rather than on the client, because that is
   * where the corresponding real thing is: a relay that stores what it was
   * handed, or a network between the two. Nothing about the sending client
   * changes, which is the point of the scenarios that use it — the sender is
   * behaving correctly and is still told the send succeeded. */
  if (options.tamper) {
    const store = relay.send.bind(relay);
    const tamper = options.tamper;
    relay.send = (envelope) => store(tamper(envelope));
  }

  const [from, to] = await Promise.all([
    createSignalProtocolClient({
      identity: { userId: sender },
      adapters: { storage: senderStorage, relay },
      logger: options.logger?.sender,
    }),
    createSignalProtocolClient({
      identity: { userId: recipient },
      adapters: { storage: recipientStorage, relay },
      logger: options.logger?.recipient,
    }),
  ]);

  /* Publishing prekey bundles is what makes the first send an X3DH/PQXDH
   * handshake rather than a failure; both sides do it because both sides are
   * running in this tab. */
  await Promise.all([from.syncToServer(), to.syncToServer()]);

  const listeners = new Set<(event: DemoEvent) => void>();
  const emit = (event: DemoEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* a subscriber's render failure is its own to report */
      }
    }
  };

  /*
   * Read the relay by subscribing to it, not by draining its mailbox.
   *
   * `getPendingMessages` is the published way to inspect the in-memory relay,
   * and it is what `scripts/record-carrier-capture.mjs` uses — but that script
   * reads the queue in the gap before any subscription starts. Here the
   * receiving client is subscribed for the whole session and deletes each
   * envelope once it has decrypted it, so a poll after `send()` resolves is a
   * race against that delete. Subscribing gets the stored envelope handed over
   * at the moment the relay accepts it, which is both deterministic and the
   * more honest picture: this is what the server saw.
   */
  const pending: Envelope[] = [];
  let onEnvelope: ((envelope: Envelope) => void) | null = null;
  /* `DEFAULT_DEVICE_ID` comes from the package rather than being written as 1:
   * the client registers itself under the SDK's default, so a demo that pinned
   * its own copy would subscribe to the wrong device the day that default
   * moved — and the symptom would be `envelope-stored` never firing, and the
   * send failing on its deadline well away from the line that broke.
   *
   * This is the demo watching the server, and it watches the primary device's
   * row. A send to an account with a second device linked stores one envelope
   * per device; the ones addressed to the other devices are not seen here, and
   * `recipientDeviceCount` on the send result is what says how many there
   * were. What each device then made of its own copy is on that device, in
   * `recipientDevices`. */
  const unsubscribeRelay = relay.subscribe(recipient, DEFAULT_DEVICE_ID, (envelope) => {
    if (onEnvelope) onEnvelope(envelope);
    else pending.push(envelope);
    emit({ type: 'envelope-stored', envelope });
  });

  /*
   * The receiving account's devices, each keeping what it decrypted.
   *
   * A device is a row here rather than a variable because the account can grow
   * one: provisioning gives the recipient a second device part-way through a
   * conversation, and everything downstream — what `send()` waits for, what
   * `stop()` puts away, what a scenario prints as a scroll-back — has to
   * follow the account rather than a pair fixed at boot.
   */
  interface WatchedDevice extends DemoRecipientDevice {
    client: SignalProtocolClient;
    received: DecryptedEnvelope[];
    onDecrypted: ((message: DecryptedEnvelope) => void) | null;
  }

  const recipientDevices: WatchedDevice[] = [];

  function watch(client: SignalProtocolClient): WatchedDevice {
    const device: WatchedDevice = {
      /* Read off the client rather than passed in: the device id came from the
         relay when it linked the device, and a second copy of it here would be
         a number this file believed rather than the one the SDK is using. */
      deviceId: client.deviceId,
      client,
      received: [],
      onDecrypted: null,
    };
    client.registerHook('onMessageDecrypted', (message) => {
      device.received.push(message);
      device.onDecrypted?.(message);
    });
    client.startRelaySubscription();
    recipientDevices.push(device);
    return device;
  }

  watch(to);

  performance.mark('oe-demo:boot:end');
  const bootMs = measure('oe-demo:boot', 'oe-demo:boot:start', 'oe-demo:boot:end');

  let exchanges = 0;
  /* Sends are serialized: two in flight would race for the same envelope and
   * decryption callbacks, and a reader pressing send twice is ordinary. */
  let queue: Promise<unknown> = Promise.resolve();

  async function exchange(text: string): Promise<DemoExchange> {
    const n = ++exchanges;
    const mark = (stage: string) => `oe-demo:send:${n}:${stage}`;

    /*
     * Anything already queued belongs to a send that has finished, so this
     * one must not be handed it.
     *
     * The queue used to be drained with a `shift()`, on the reading that an
     * envelope could arrive before the wait was set up. It cannot: envelopes
     * only appear in response to a send, and the wait is installed before the
     * send starts. What does arrive outside a send is a *second* envelope for
     * a send that already resolved — the receiving device asks the sender to
     * try again when a message fails to decrypt, and the resend lands once
     * `onEnvelope` has been cleared below. `shift()` would then hand that
     * stale envelope to the next send, which would report the previous
     * sentence's ciphertext as this one's and never notice.
     */
    pending.length = 0;
    const envelopeArrived = new Promise<Envelope>((resolve) => {
      onEnvelope = resolve;
    });
    /* Every device linked at the moment of the send, and only those: a device
       linked while this one is in flight was not a recipient of it, and
       waiting for it would wait forever. */
    const waiting = [...recipientDevices];
    const deliveriesArrived = waiting.map(
      (device) =>
        new Promise<{ deviceId: number; message: DecryptedEnvelope }>((resolve) => {
          device.onDecrypted = (message) => resolve({ deviceId: device.deviceId, message });
        }),
    );

    performance.mark(mark('start'));
    let result: SendResult;
    try {
      result = await from.send(recipient, text);
    } catch (error) {
      onEnvelope = null;
      for (const device of waiting) device.onDecrypted = null;
      throw error;
    }
    performance.mark(mark('accepted'));
    const encryptMs = measure(`oe-demo:encrypt:${n}`, mark('start'), mark('accepted'));
    emit({ type: 'message-sent', text, result, encryptMs });

    /*
     * The slot stays open until the envelope is in hand, not until the send
     * resolves.
     *
     * It used to be cleared the moment `from.send()` returned, which was safe
     * for exactly one reason: `inMemoryRelay()` delivers to its subscriber
     * inside `send()`, so the envelope had always landed before the slot
     * closed. Against any relay that delivers later the envelope arrived to a
     * closed slot, went into `pending`, and this line waited on a promise
     * nothing could resolve. Holding the slot across the wait removes the
     * race, and the deadline covers what is left — an envelope that is not
     * merely late but never coming.
     */
    let envelope: Envelope;
    let deliveries: { deviceId: number; message: DecryptedEnvelope }[];
    try {
      envelope = await withDeadline(envelopeArrived, deadlineMs, 'the envelope');
      deliveries = await withDeadline(
        Promise.all(deliveriesArrived),
        deadlineMs,
        'the decrypted message',
      );
    } finally {
      onEnvelope = null;
      for (const device of waiting) device.onDecrypted = null;
    }
    const decrypted = deliveries[0].message;

    performance.mark(mark('decrypted'));
    const roundTripMs = measure(`oe-demo:round-trip:${n}`, mark('start'), mark('decrypted'));
    emit({ type: 'message-decrypted', message: decrypted, roundTripMs });

    return { text, result, envelope, decrypted, deliveries, encryptMs, roundTripMs };
  }

  return {
    sender,
    recipient,
    bootMs,
    relay,
    senderClient: from,
    recipientClient: to,
    recipientStorage,
    recipientDevices,

    watchRecipientDevice(client) {
      return watch(client);
    },

    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    send(text) {
      if (text.trim().length === 0) {
        return Promise.reject(new Error('nothing to send: the message is empty'));
      }
      const run = queue.then(
        () => exchange(text),
        () => exchange(text),
      );
      queue = run.catch(() => {});
      return run;
    },

    async stop() {
      unsubscribeRelay();
      listeners.clear();
      await Promise.all([from.stop(), ...recipientDevices.map((device) => device.client.stop())]);
    },
  };
}
