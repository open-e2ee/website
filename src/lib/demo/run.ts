/*
 * Two devices and a relay, in one page, recorded.
 *
 * Both ends of the conversation are on screen at once, side by side, and that
 * is what decides the shape of the code underneath: not a session with a near
 * end and a far end, but two peers and a middle, instrumented the same way in
 * both directions.
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

import {
  DEFAULT_DEVICE_ID,
  SignalProtocolClient,
  createSignalProtocolClientConfig,
} from '@open-e2ee/signal-protocol-sdk';
import type {
  DecryptedEnvelope,
  Envelope,
  ProtocolAddress,
  SendResult,
  SignalProtocolConfig,
} from '@open-e2ee/signal-protocol-sdk';
import type {
  ProgressCallback,
  ProtocolSelectionEvent,
} from '@open-e2ee/signal-protocol-sdk/client/config';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import { inMemoryRelay } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory';
import type { InMemorySignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory';
import { ciphertextBytes } from './ciphertext.ts';
import { withDeadline } from './deadline.ts';
import { createTrace } from './trace.ts';
import type { Actor, BraidReport, Trace } from './trace.ts';

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
   * The post-quantum and ML-KEM-braid policy both devices agree keys under.
   *
   * Both, not one each: the two ends of a demo conversation running different
   * policies is not a scenario this run models, and the SDK requires the
   * initiator and the responder to agree before it will call it a session.
   * Omitted, this is the SDK's own default — strict post-quantum with the
   * Braid — so a caller who never mentions policy sees exactly what shipped
   * before this option existed.
   */
  protocol?: SignalProtocolConfig;
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
   * Put both accounts' public prekey bundles on the relay.
   *
   * What a real device does when it comes online, before anyone has written
   * anything: the bundle has to be on the relay for the first message to be a
   * PQXDH handshake rather than a failure. Offered on its own because the demo
   * starts here — the reader watches the shelves fill and the private halves
   * stay behind before any conversation exists to explain it with.
   *
   * Idempotent, and the same call `send()` makes on its way past, so a caller
   * that skips it loses nothing but the order.
   */
  publishBundles(): Promise<void>;
  /**
   * Publish both bundles and give A a session with B.
   *
   * The key agreement without a message wrapped around it. `send()` does this
   * itself for a device with no session, which is where a reader normally meets
   * it; this is the same call reachable on its own, so a test can hold the
   * agreement against a real fetched bundle without a sentence in the way.
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
  /** What the SDK last reported about a key agreement this device took part in. */
  selection(): ProtocolSelectionEvent | null;
  /**
   * Every braid report this device has raised since the last time one was
   * taken, taken and cleared in one call.
   *
   * Drained rather than read, so each report lands on exactly one step. A read
   * that left the buffer standing would put a send's reports on the send and
   * then on everything after it, and the drawing would go on showing a count
   * from a message that had already been delivered.
   */
  takeBraid(): readonly BraidReport[];
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

/**
 * Take a device's braid reports, in the shape a `TraceEvent` carries them.
 *
 * Absent rather than empty when there were none, so the fields an event has are
 * the facts it holds — the rule `cues()` keeps for `from`/`to` in `trace.ts`. A
 * direct-mode run raises no report and its recording then says nothing about a
 * braid, rather than saying a braid carried zero chunks.
 *
 * This drains. Call it once per step, on the device whose work the step is.
 */
function braidOf(device: Device): { braid?: readonly BraidReport[] } {
  const reports = device.takeBraid();
  return reports.length === 0 ? {} : { braid: reports };
}

/**
 * Record what the SDK says while it is making a device's keys.
 *
 * Key generation is the longest thing the opening does — hundreds of X25519 and
 * ML-KEM keypairs, half a second of it — and it happens inside
 * `SignalProtocolClient.create()`, where this module has nothing to mark. The
 * one window into it is `onProgress`, which the SDK calls at batch boundaries,
 * and this turns those calls into recording.
 *
 * ------------------------------------------------------------ the counting ---
 *
 * A report counts only when it says a batch is finished — `current === total`,
 * which is how `prekeys.ts` reports a batch it has just generated and stored.
 * The half-reports (`{current: 0, total: 1}` opening the last-resort ML-KEM
 * key) move nothing. So the running count only ever goes up, by whole batches,
 * and no keypair is counted twice.
 *
 * That count is smaller than the number the relay later reports published: the
 * identity keys and the signed prekey are made inside `generatePreKeyBundle()`
 * with no report of any kind, and what is not reported is not counted. The
 * figure this records is what the SDK said it generated, which is the only
 * thing anything here can honestly say.
 *
 * --------------------------------------------------------------- the times ---
 *
 * `keygenMs` and `kyberMs` are sums of measured windows, not one span each.
 * Every report is marked, and a window is the gap between a report and the one
 * before it; a window counts toward `keygenMs` when it ends in a batch, and
 * toward `kyberMs` when that batch was ML-KEM. The windows the SDK spends
 * uploading and checking the relay's inventory end in no batch and are in
 * neither figure.
 *
 * Sums rather than one bracket because the SDK interleaves: it generates the
 * ML-KEM last-resort key, then uploads, then generates the EC batch, then the
 * ML-KEM batch. A single pair of marks around all of that would be a duration
 * called generation with two relay round trips inside it. These windows still
 * hold the odd store or inventory query alongside the generation that dominates
 * them — a window is bounded by reports, and reports are all there is.
 *
 * And they are wall-clock windows on a single-threaded page where the other
 * device is generating its own keys at the same time — `start()` boots the pair
 * together. So this is the span across which the device made its keys and not
 * the processor time it had to itself, which is the same thing `bootMs` beside
 * it has always been. The two devices' figures therefore differ from run to
 * run, and neither is the cost of generating a bundle on an idle machine.
 *
 * The SDK's own `percent` is not used for anything. It runs 20, 50, 60, 75, 30,
 * 65 through a normal boot, so it is a stage label wearing a fraction's
 * clothes, and a bar drawn from it would run backwards twice.
 *
 * ------------------------------------------------------------ the appending ---
 *
 * Nothing is appended until `commit()`, after the call being watched has
 * returned. A bar needs a denominator, and how many keypairs a device generates
 * in total is not knowable until it has stopped generating them — so the
 * reports are held, and each goes into the recording carrying the count at the
 * moment it was made and the total the device reached. `atMs` is still the
 * moment the SDK reported, taken then rather than at commit.
 *
 * A device that generated nothing appends nothing. Publishing an already-synced
 * account is exactly that case, and a run of reports saying "0 of 0" would be
 * the reel drawing a bar over work that did not happen.
 */
function recordGeneration(
  trace: Trace,
  actor: DeviceActor,
  mark: (stage: string) => string,
): { onProgress: ProgressCallback; commit: () => void } {
  const reports: { atMs: number; keypairs: number }[] = [];
  let keypairs = 0;
  let previous: string | null = null;
  let marks = 0;
  let keygenMs = 0;
  let kyberMs = 0;

  return {
    onProgress: (progress) => {
      const here = mark(`progress:${marks}`);
      performance.mark(here);
      marks += 1;

      const detail = progress.detail;
      const done =
        detail !== undefined && detail.total > 0 && detail.current === detail.total
          ? detail.total
          : 0;

      if (done > 0) {
        keypairs += done;
        reports.push({ atMs: performance.now(), keypairs });
        /* The first report of a run has no window before it. It opens the
           generation rather than closing a batch in practice, and a duration
           measured from a mark that does not exist would be a made-up one. */
        if (previous !== null) {
          const window = measure(mark(`window:${marks}`), previous, here);
          keygenMs += window;
          if (progress.stage === 'generating-kyber') kyberMs += window;
        }
      }
      previous = here;
    },

    commit: () => {
      const total = keypairs;
      for (const [index, report] of reports.entries()) {
        const last = index === reports.length - 1;
        trace.append({
          step: 'generating-keys',
          actor,
          atMs: report.atMs,
          /* Only on the last, because these are the whole run's figures and a
             copy on every report would be the same duration printed as though
             it had been measured four times. */
          ...(last ? { measures: { keygenMs, kyberMs } } : {}),
          detail: { keypairs: report.keypairs, total },
        });
      }
    },
  };
}

/**
 * How many public keys the relay is holding for one device, right after a
 * publish.
 *
 * Read through the account's key-rotation queries — `getIdentityKey`,
 * `getEcSignedPreKeyMetadata`, `getKemLastResortPreKeyMetadata`, and
 * `getPreKeyCount` for both key types — rather than `fetchPreKeyBundle()`,
 * the call `ensureSession` uses to agree a real session. That call is
 * documented to atomically consume one EC and one KEM one-time prekey on
 * every fetch: real material the reader's own key agreement would otherwise
 * spend. Calling it here to produce a number for the page would silently
 * take one for a reading, which is not a reading at all. The four queries
 * above exist for exactly this — inspecting what a device has published
 * without taking any of it.
 *
 * An identity contributes two: the X25519 key X3DH/PQXDH uses and the
 * Ed25519 key that signs prekeys. `registrationId` and `deviceId`, which a
 * fetched bundle also carries, are identifiers rather than keys and are not
 * counted, so a number captioned "public keys" only ever counts keys.
 *
 * `null` when the relay has nothing at all for this device — an absent
 * reading, which `publishBundles` keeps out of the trace rather than
 * reporting as a zero it never observed.
 */
async function countPublishedKeys(
  relay: InMemorySignalProtocolRelayServer,
  userId: string,
  deviceId: number,
): Promise<number | null> {
  const [identity, ecSignedPreKey, kemLastResortPreKey, ecOneTimeCount, kemOneTimeCount] =
    await Promise.all([
      relay.getIdentityKey(userId),
      relay.getEcSignedPreKeyMetadata(userId, deviceId),
      relay.getKemLastResortPreKeyMetadata(userId, deviceId),
      relay.getPreKeyCount(userId, deviceId, 'ec'),
      relay.getPreKeyCount(userId, deviceId, 'kem'),
    ]);
  if (
    !identity &&
    !ecSignedPreKey &&
    !kemLastResortPreKey &&
    ecOneTimeCount === 0 &&
    kemOneTimeCount === 0
  ) {
    return null;
  }
  return (
    (identity ? 2 : 0) +
    (ecSignedPreKey ? 1 : 0) +
    (kemLastResortPreKey ? 1 : 0) +
    ecOneTimeCount +
    kemOneTimeCount
  );
}

export async function startDemoRun(options: DemoRunOptions = {}): Promise<DemoRun> {
  const names: Record<DeviceActor, string> = {
    a: options.a ?? 'alice',
    b: options.b ?? 'bob',
  };
  const deadlineMs = options.deadlineMs ?? DELIVERY_DEADLINE_MS;
  const makeRelay = options.relay ?? inMemoryRelay;
  const protocol = options.protocol;
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

    /*
     * What the SDK chose, from the SDK, rather than a claim this page makes.
     *
     * `onProtocolSelected` is the only place the choice is stated: it fires once
     * key agreement completes and before anything is encrypted, and it carries
     * whether PQXDH ran, whether the Triple Ratchet is on, and whether the
     * classical fallback was taken and why. Nothing else on the client says. The
     * nearest candidate, `getSessionHealth`, reports that a session exists and
     * how many messages have crossed it, and knows nothing about either.
     *
     * So the "Exchange keys" step prints an event the protocol raised. The
     * alternative — captioning it from what this file believes the defaults are
     * — would keep reading correct through exactly the change worth showing.
     *
     * A box rather than a field because the callback is installed while the
     * client is being built, so it has to have somewhere to write that already
     * exists. It also fires for a key agreement this device *answered*, not only
     * ones it started; both are this device's, so both land here.
     */
    let selection: ProtocolSelectionEvent | null = null;

    /*
     * What the braid reported, from the braid.
     *
     * `onBraidProgress` fires inside the send or the receive that moved a
     * chunk, which is well before the call it fired from has returned and long
     * before this module has a step to record. So the reports collect here and
     * the step that caused them takes them on its way into the recording.
     *
     * A box for the same reason `selection` above is one: the callback is
     * installed while the client is being built, so it needs somewhere to write
     * that already exists. Direct-mode sessions raise nothing and this stays
     * empty, which is what keeps a direct run's recording free of a braid it
     * never ran.
     */
    let braid: BraidReport[] = [];

    /* `create()` generates and publishes this device's prekeys on its way up,
       so the reports arrive during the call below and the recording of them is
       committed after it returns. */
    const generating = recordGeneration(trace, actor, mark);

    performance.mark(mark('start'));
    await relay.registerDevice(userId, { encryptedDeviceName: new ArrayBuffer(0) });
    /*
     * Composed and then constructed, rather than `createSignalProtocolClient`.
     *
     * `protocolStrategy` is the seam the callback lives on, and the composition
     * shape deliberately omits it: it is documented as advanced, for diagnostics
     * and telemetry, which is exactly what this is. `createSignalProtocolClient`
     * is a two-line wrapper over these same two calls, so this is that path with
     * one extra key and not a way around anything. Both functions are root
     * exports and the SDK's own example for `onProtocolSelected` is written
     * against `SignalProtocolClient.create`.
     */
    const config = createSignalProtocolClientConfig({
      identity: { userId },
      adapters: { storage: inMemoryStore(), relay },
      protocol,
    });
    /*
     * Spread rather than assigned, so a `protocolStrategy` this file sets
     * later can never be the whole reason a policy field goes missing.
     *
     * It is not load-bearing today: `createSignalProtocolClientConfig` never
     * populates `protocolStrategy` itself, so `config.protocolStrategy` is
     * always empty here regardless of `protocol` above, and `{...undefined,
     * onProtocolSelected}` is just `{onProtocolSelected}`. The real merge of
     * policy and callback happens one call later, inside
     * `SignalProtocolClient.create()`: it folds whatever `protocolStrategy`
     * it is handed together with the `allowClassicalFallback`/`sckaMode`
     * `resolveSignalProtocolStrategy()` derives from `protocol`, callback
     * included, which is why `onProtocolSelected` keeps firing with a
     * `protocol` policy set. The spread stays anyway, as the cheap guard
     * against `config` starting to carry a `protocolStrategy` of its own on
     * some future version of the package.
     */
    const client = await SignalProtocolClient.create(userId, {
      ...config,
      onProgress: generating.onProgress,
      protocolStrategy: {
        ...config.protocolStrategy,
        onProtocolSelected: (event) => {
          selection = event;
        },
        /* `epoch` is printed here rather than downstream: it is a `bigint`, and
           this is the boundary between the SDK's shape and the recording's. */
        onBraidProgress: (event) => {
          braid.push({
            chunksCarried: event.chunksCarried,
            chunksRequired: event.chunksRequired,
            epoch: String(event.epoch),
            emittedEpochKey: event.emittedEpochKey,
          });
        },
      },
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
      selection: () => selection,
      takeBraid: () => {
        const taken = braid;
        braid = [];
        return taken;
      },
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

    /* Before the device reports itself ready, because that is the order it
       happened in: the keys were made on the way up. */
    generating.commit();

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
        /* A device that came up on a fresh relay published on the way up, so
           this sync normally finds the account in order and generates nothing —
           and records nothing, which is the point of watching it. The day it
           does have to replenish, the reel shows that rather than a still
           relay column with half a second missing from it. */
        const generating = recordGeneration(trace, actor, (stage) => mark(actor, stage));

        performance.mark(mark(actor, 'start'));
        await devices[actor].client.syncToServer(generating.onProgress);
        performance.mark(mark(actor, 'end'));
        generating.commit();
        const publishMs = measure(
          `oe-demo:publish:${generation}:${actor}`,
          mark(actor, 'start'),
          mark(actor, 'end'),
        );
        /* Outside the marks above on purpose: this reads the relay back, and
           a reader watching `publishMs` should see how long the publish took,
           not that plus a diagnostic query the publish itself never made. */
        const publicKeys = await countPublishedKeys(
          relay,
          devices[actor].userId,
          devices[actor].address.deviceId,
        );
        trace.append({
          step: 'bundles-published',
          actor,
          atMs: performance.now(),
          measures: { publishMs },
          ...(publicKeys === null ? {} : { detail: { publicKeys } }),
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

    /* `establishSession` resolves to nothing, so what the agreement produced is
       read from the event it raised on the way past. Nullable, and left
       nullable: a surface that has no selection to show should show none. What
       keeps that from quietly becoming the normal case is a test asserting this
       step arrives with a real event on it — a callback that stops firing is
       otherwise indistinguishable here from one that was never registered. */
    trace.append({
      step: 'session-established',
      actor: from.actor,
      from: from.actor,
      to: to.actor,
      atMs: performance.now(),
      measures: { establishMs },
      ...braidOf(from),
      detail: { selection: from.selection() },
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
    /* Each side's reports are taken on the step that is that side's own work:
       the sender's here, the receiver's on `opened` below. In memory the relay
       delivers inside the send, so both sides have reported by this line — a
       single shared buffer would put the receiver's chunk counts on the sender's
       step, and the drawing would credit a device for work the other one did. */
    trace.append({
      step: 'encrypted',
      actor: from.actor,
      from: from.actor,
      to: to.actor,
      atMs: encryptedAt,
      measures: { encryptMs },
      ...braidOf(from),
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
      ...braidOf(to),
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

    async publishBundles() {
      await publishBundles();
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
