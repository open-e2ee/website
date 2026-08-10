/*
 * Two devices and a relay, in one page, recorded.
 *
 * The demo used to show one end of a conversation and borrow the other from a
 * second tab. It now shows both, side by side, which changes what the code
 * underneath has to be: not a session with a near end and a far end, but two
 * peers and a middle, instrumented the same way in both directions.
 *
 * ------------------------------------------------ why not `driver.ts` ---
 *
 * `startDemoSession` is one-directional by construction. It subscribes to the
 * recipient only, watches the recipient's devices only, and `send(text)` has no
 * place to say who is speaking. That is right for the /demo scenarios, which
 * are all about one sentence going one way, and those keep using it unchanged.
 *
 * Two of them on a shared relay does not work either, and the reason is worth
 * writing down so nobody tries it again: each call creates fresh clients *and
 * fresh stores* for both accounts. Booting a second session for the reply leg
 * would register alice twice against the same relay with a different identity
 * key, which the relay refuses — the same error the reinstall scenario exists
 * to provoke. So this module owns its own two clients, its own relay and its
 * own instrumentation. What it borrows from `driver.ts` is the parts that were
 * learned the hard way: subscribe rather than poll, hold the envelope slot
 * across the wait, bound every wait, and measure with `performance` under names
 * a reader can find in their own panel.
 *
 * ---------------------------------------------------------- the record ---
 *
 * Nothing here draws. Everything it learns goes into a `Trace`, and every
 * surface renders from that. The reason is in `trace.ts`: the protocol runs at
 * full speed and the page replays it at the reader's pace, and the only way
 * that stays honest is one recording with the measurements in it and a
 * number-free projection for the half of the page that is paced.
 *
 * Framework-free and DOM-free for the same reasons `driver.ts` is: it is pulled
 * in by a dynamic `import()` so its weight stays off first paint, and a plain
 * `<script type="module">` has to be able to consume it under
 * `script-src 'self'`.
 */

import { DEFAULT_DEVICE_ID, createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import type {
  DecryptedEnvelope,
  Envelope,
  ProtocolAddress,
  SendResult,
  SignalProtocolClient,
} from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import { inMemoryRelay } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory';
import type { InMemorySignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory';
import { ciphertextBytes } from './ciphertext.ts';
import { withDeadline } from './deadline.ts';
import { createTrace } from './trace.ts';
import type { Actor, Trace } from './trace.ts';

/**
 * The two ends. `relay` is an actor in the trace but never a correspondent.
 *
 * Subtracted from `Actor` rather than written out, so that a third column added
 * to the drawing is a type error here rather than a device that silently cannot
 * be sent to.
 */
export type DeviceActor = Exclude<Actor, 'relay'>;

export interface DemoRunOptions {
  /** Account on the left. Shown to the reader, so callers name it. */
  a?: string;
  /** Account on the right. */
  b?: string;
  /**
   * How to build the relay, instead of a bare `inMemoryRelay()`.
   *
   * A test boundary rather than a knob, for the same reason `driver.ts` has
   * one: in memory the relay delivers inside `send()`, so a test that only
   * ever sees `inMemoryRelay()` cannot reach the case where delivery is late —
   * which is the case that matters and the case that has shipped broken here
   * before.
   *
   * A factory rather than a relay because `reset()` needs a new one; see
   * `boot()`.
   */
  relay?: () => InMemorySignalProtocolRelayServer;
  /** How long any one wait on the relay may take before it is called a failure. */
  deadlineMs?: number;
}

/**
 * How long a wait on the relay may run.
 *
 * Ten seconds is far beyond a local round trip, so reaching it means something
 * is wrong rather than slow. Tests that want the failure lower it.
 */
const DELIVERY_DEADLINE_MS = 10_000;

/** What one send produced. The same facts are in the trace; this is the return. */
export interface DemoSend {
  readonly from: DeviceActor;
  readonly to: DeviceActor;
  readonly text: string;
  readonly result: SendResult;
  /** The object the relay stored. Handed over, never described. */
  readonly envelope: Envelope;
  /** The object the receiving device's hook was given. */
  readonly decrypted: DecryptedEnvelope;
  /** Handing the plaintext to the SDK until the relay accepted the envelope. */
  readonly encryptMs: number;
  /** The same start, until the far device had the plaintext back. */
  readonly roundTripMs: number;
}

export interface DemoRun {
  /** The recording. Stable across `reset()`, so subscribers survive one. */
  readonly trace: Trace;
  /** The relay both accounts are currently registered with. Replaced by a reset. */
  readonly relay: InMemorySignalProtocolRelayServer;
  /** Account name for an actor, for anything that has to print one. */
  userId(actor: DeviceActor): string;
  /** The client for an actor, for the SDK calls a surface makes by hand. */
  client(actor: DeviceActor): SignalProtocolClient;
  /**
   * Publish both bundles and give A a session with B.
   *
   * Separate from `send()` because the reader is offered it as its own step:
   * the key agreement is a thing that happens once, before any message, and a
   * demo that hides it inside the first send teaches that the first send is
   * where it happens.
   */
  exchangeKeys(): Promise<void>;
  send(from: DeviceActor, text: string): Promise<DemoSend>;
  /** Forget the conversation and boot two fresh devices. Same `trace` object. */
  reset(): Promise<void>;
  /** Put both clients and the relay observers away. */
  stop(): Promise<void>;
}

/** One end of the conversation, and the slots a send in flight writes into. */
interface Device {
  readonly actor: DeviceActor;
  readonly userId: string;
  readonly client: SignalProtocolClient;
  readonly address: ProtocolAddress;
  /** Set while a send to this device is outstanding. See the send below. */
  onEnvelope: ((arrival: { envelope: Envelope; atMs: number }) => void) | null;
  onDecrypted: ((arrival: { message: DecryptedEnvelope; atMs: number }) => void) | null;
  unsubscribeRelay: () => void;
}

/**
 * Measure between two marks and hand back the duration.
 *
 * From `performance` rather than `Date.now()` arithmetic so a reader who opens
 * their own Performance panel finds the entries this page is quoting, under the
 * names it quotes them by.
 */
function measure(name: string, from: string, to: string): number {
  return performance.measure(name, from, to).duration;
}

export async function startDemoRun(options: DemoRunOptions = {}): Promise<DemoRun> {
  const names: Record<DeviceActor, string> = {
    a: options.a ?? 'alice',
    b: options.b ?? 'bob',
  };
  const deadlineMs = options.deadlineMs ?? DELIVERY_DEADLINE_MS;
  const makeRelay = options.relay ?? inMemoryRelay;
  const trace = createTrace();

  /* Mutable because `reset()` replaces them. What survives a reset is the trace
     and the object the page is holding; the devices and the relay do not, and
     `boot()` says why. */
  let relay: InMemorySignalProtocolRelayServer;
  let devices: Record<DeviceActor, Device>;
  /* Whether this generation of devices has published its prekey bundles. Reset
     with the devices, because fresh devices have published nothing. */
  let published = false;
  /* Names the performance marks so a reset's second run does not collide with
     the first's entries under the same name. */
  let generation = 0;
  let sends = 0;

  async function makeDevice(actor: DeviceActor): Promise<Device> {
    const userId = names[actor];
    const mark = (stage: string) => `oe-demo:device:${generation}:${actor}:${stage}`;

    performance.mark(mark('start'));
    await relay.registerDevice(userId, { encryptedDeviceName: new ArrayBuffer(0) });
    const client = await createSignalProtocolClient({
      identity: { userId },
      adapters: { storage: inMemoryStore(), relay },
    });
    performance.mark(mark('end'));
    const bootMs = measure(`oe-demo:device:${generation}:${actor}`, mark('start'), mark('end'));

    const device: Device = {
      actor,
      userId,
      client,
      /* `deviceId` read off the client rather than written as 1: it is the id
         the relay gave this device, and a second copy here would be a number
         this file believed rather than the one the SDK is addressing. */
      address: { userId, deviceId: client.deviceId },
      onEnvelope: null,
      onDecrypted: null,
      unsubscribeRelay: () => {},
    };

    /*
     * Read the relay by subscribing to it, not by draining its mailbox.
     *
     * `getPendingMessages` is the published way to inspect the in-memory relay
     * but it is a race here: each client is subscribed for the whole run and
     * deletes an envelope once it has decrypted it, so a poll after the send
     * resolves is a poll against that delete. Subscribing gets the stored
     * envelope at the moment the relay accepts it, which is deterministic and
     * is also the more honest picture — this is what the relay saw.
     *
     * `DEFAULT_DEVICE_ID` comes from the package rather than being written as
     * 1. Pinning our own copy would subscribe to the wrong row the day that
     * default moved, and the symptom would be a send timing out on its
     * deadline, well away from the line that broke.
     */
    device.unsubscribeRelay = relay.subscribe(userId, DEFAULT_DEVICE_ID, (envelope) => {
      device.onEnvelope?.({ envelope, atMs: performance.now() });
    });

    client.registerHook('onMessageDecrypted', (message) => {
      device.onDecrypted?.({ message, atMs: performance.now() });
    });
    client.startRelaySubscription();

    trace.append({
      step: 'devices-ready',
      actor,
      atMs: performance.now(),
      measures: { bootMs },
      detail: { userId, deviceId: client.deviceId },
    });

    return device;
  }

  /**
   * Two fresh devices on a fresh relay.
   *
   * The relay is rebuilt, not reused, and both reasons are load-bearing.
   *
   * It is what the reader is looking at. The middle column shows what the relay
   * is holding, so a reset that kept the relay would clear the recording and
   * leave the previous run's rows and prekey bundles sitting under a column
   * captioned as a fresh start.
   *
   * And reuse does not work. `registerDevice` allocates a new device id per
   * call, while a client built on a fresh `inMemoryStore()` comes up as device
   * 1 with a new identity key — so the second registration of an account the
   * relay already knows leaves the two disagreeing, and `syncToServer` fails
   * with `INITIALIZATION_FAILED`. That is the relay refusing an identity change
   * it did not authorise, which is correct of it: it is the same refusal the
   * reinstall scenario exists to provoke.
   */
  async function boot(): Promise<void> {
    generation += 1;
    relay = makeRelay();
    /* Concurrent because they are independent, and because a reader watching
       two devices come up expects them to come up together. Each is measured on
       its own marks, so the overlap costs nothing in the numbers. */
    const [a, b] = await Promise.all([makeDevice('a'), makeDevice('b')]);
    devices = { a, b };
  }

  async function teardown(): Promise<void> {
    const current = Object.values(devices);
    for (const device of current) {
      device.unsubscribeRelay();
      device.onEnvelope = null;
      device.onDecrypted = null;
    }
    await Promise.all(current.map((device) => device.client.stop()));
  }

  /**
   * Put both accounts' prekey bundles on the relay.
   *
   * Both, because both are running in this tab: a bundle is what makes the
   * first message to a device a PQXDH handshake rather than a failure, and
   * either device may be the one spoken to first.
   */
  async function publishBundles(): Promise<void> {
    if (published) return;
    published = true;
    const mark = (actor: DeviceActor, stage: string) =>
      `oe-demo:publish:${generation}:${actor}:${stage}`;

    await Promise.all(
      (['a', 'b'] as const).map(async (actor) => {
        performance.mark(mark(actor, 'start'));
        await devices[actor].client.syncToServer();
        performance.mark(mark(actor, 'end'));
        const publishMs = measure(
          `oe-demo:publish:${generation}:${actor}`,
          mark(actor, 'start'),
          mark(actor, 'end'),
        );
        trace.append({
          step: 'bundles-published',
          actor,
          atMs: performance.now(),
          measures: { publishMs },
        });
      }),
    );
  }

  /**
   * Give `from` a session with `to`, if it has not got one.
   *
   * Asked of the SDK with `hasSession` rather than tracked in a flag here. A
   * flag would be this file's belief about the client's storage, and the two
   * can part company — a reply leg gets its session from the incoming prekey
   * message, which nothing in this module observes.
   *
   * Called from `send()` as well as from `exchangeKeys()`, so the key agreement
   * is always in the recording. A reader who skips the button still gets the
   * step; they just get it inside the send, which is where it would really be.
   */
  async function ensureSession(from: Device, to: Device): Promise<void> {
    await publishBundles();
    if (await from.client.hasSession(to.address)) return;

    const mark = (stage: string) =>
      `oe-demo:establish:${generation}:${from.actor}-${to.actor}:${stage}`;
    performance.mark(mark('start'));
    const bundle = await relay.fetchPreKeyBundle(to.userId, to.address.deviceId, from.userId);
    if (!bundle) {
      throw new Error(
        `the relay has no prekey bundle for ${to.userId}, so there is nothing to ` +
          `agree a key against`,
      );
    }
    await from.client.establishSession(to.address, bundle);
    performance.mark(mark('end'));
    const establishMs = measure(
      `oe-demo:establish:${generation}:${from.actor}-${to.actor}`,
      mark('start'),
      mark('end'),
    );

    trace.append({
      step: 'session-established',
      actor: from.actor,
      from: from.actor,
      to: to.actor,
      atMs: performance.now(),
      measures: { establishMs },
    });
  }

  async function exchange(fromActor: DeviceActor, text: string): Promise<DemoSend> {
    const from = devices[fromActor];
    const to = devices[fromActor === 'a' ? 'b' : 'a'];

    await ensureSession(from, to);

    const n = ++sends;
    const mark = (stage: string) => `oe-demo:send:${generation}:${n}:${stage}`;

    /*
     * The slots are installed before the send and held until the thing they
     * wait for is in hand.
     *
     * Both halves of that matter and both were learned from a defect.
     * Installing after the send loses an envelope to a relay that delivers
     * inside `send()`, which `inMemoryRelay()` does. Clearing at `send()`'s
     * return loses it to a relay that does not — the envelope arrives to a
     * closed slot and the wait below never resolves. Holding across the wait
     * covers both, and the deadline covers what is left: an envelope that is
     * not late but never coming.
     */
    const envelopeArrived = new Promise<{ envelope: Envelope; atMs: number }>((resolve) => {
      to.onEnvelope = resolve;
    });
    const decryptedArrived = new Promise<{ message: DecryptedEnvelope; atMs: number }>(
      (resolve) => {
        to.onDecrypted = resolve;
      },
    );

    performance.mark(mark('start'));
    let result: SendResult;
    try {
      result = await from.client.send(to.userId, text);
    } catch (error) {
      to.onEnvelope = null;
      to.onDecrypted = null;
      throw error;
    }
    performance.mark(mark('accepted'));
    const encryptMs = measure(`oe-demo:encrypt:${generation}:${n}`, mark('start'), mark('accepted'));

    const encryptedAt = performance.now();
    trace.append({
      step: 'encrypted',
      actor: from.actor,
      from: from.actor,
      to: to.actor,
      atMs: encryptedAt,
      measures: { encryptMs },
      detail: { text, result },
    });
    /* An interval, not an instant: something really is outstanding between the
       device handing the envelope over and the relay confirming it holds the
       row. It carries no measure of its own — see `stored-at-relay` below for
       why timing this one in memory would produce a number worth nothing. */
    trace.append({
      step: 'in-transit',
      actor: 'relay',
      from: from.actor,
      to: to.actor,
      atMs: encryptedAt,
    });

    let envelope: Envelope;
    let storedAtMs: number;
    let decrypted: DecryptedEnvelope;
    let decryptedAtMs: number;
    try {
      const arrival = await withDeadline(envelopeArrived, deadlineMs, 'the envelope');
      envelope = arrival.envelope;
      storedAtMs = arrival.atMs;
      const opened = await withDeadline(decryptedArrived, deadlineMs, 'the decrypted message');
      decrypted = opened.message;
      decryptedAtMs = opened.atMs;
    } finally {
      to.onEnvelope = null;
      to.onDecrypted = null;
    }

    /* `atMs` is when the relay's subscriber really fired, and in memory that is
       *before* `encrypted` above: the relay accepts the envelope inside the
       send call, so the acknowledgement we timed to is necessarily later. The
       list stays in protocol order and the timestamps stay real, which means
       the two disagree here. That is a true fact about an in-memory relay and
       `trace.ts` says why it is recorded rather than smoothed. */
    trace.append({
      step: 'stored-at-relay',
      actor: 'relay',
      from: from.actor,
      to: to.actor,
      atMs: storedAtMs,
      measures: { ciphertextBytes: ciphertextBytes(envelope.ciphertext)?.length ?? 0 },
      detail: { envelope },
    });
    trace.append({
      step: 'delivered',
      actor: 'relay',
      from: from.actor,
      to: to.actor,
      atMs: storedAtMs,
    });

    performance.mark(mark('decrypted'));
    const roundTripMs = measure(
      `oe-demo:round-trip:${generation}:${n}`,
      mark('start'),
      mark('decrypted'),
    );
    trace.append({
      step: 'opened',
      actor: to.actor,
      from: from.actor,
      to: to.actor,
      atMs: decryptedAtMs,
      measures: { roundTripMs },
      detail: { decrypted },
    });

    return {
      from: from.actor,
      to: to.actor,
      text,
      result,
      envelope,
      decrypted,
      encryptMs,
      roundTripMs,
    };
  }

  /* Sends are serialized. Two in flight would race for the same envelope and
     decryption slots, and a reader pressing send twice is ordinary. */
  let queue: Promise<unknown> = Promise.resolve();

  await boot();

  return {
    trace,

    /* A getter, because `reset()` replaces it. A caller that had read the
       property once and kept it would go on watching a relay nobody is sending
       to. */
    get relay() {
      return relay;
    },

    userId(actor) {
      return devices[actor].userId;
    },

    client(actor) {
      return devices[actor].client;
    },

    async exchangeKeys() {
      await ensureSession(devices.a, devices.b);
    },

    send(from, text) {
      if (text.trim().length === 0) {
        return Promise.reject(new Error('nothing to send: the message is empty'));
      }
      const run = queue.then(
        () => exchange(from, text),
        () => exchange(from, text),
      );
      queue = run.catch(() => {});
      return run;
    },

    async reset() {
      /* Wait for anything in flight before pulling the clients out from under
         it, or the pending send finishes against devices nobody can see and
         appends its steps to a trace the reader has been told is empty. */
      await queue.catch(() => {});
      await teardown();
      trace.clear();
      published = false;
      sends = 0;
      await boot();
    },

    async stop() {
      await queue.catch(() => {});
      await teardown();
    },
  };
}
