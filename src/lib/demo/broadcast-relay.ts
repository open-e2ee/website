/*
 * One relay, in one tab, reachable from the others.
 *
 * The scenarios on /demo run both accounts in a single tab, which makes the
 * relay easy to disbelieve: a reader watching a sentence go from one variable
 * to another has been shown a data structure, not a protocol. So this module
 * puts the two accounts in two tabs and a real wire between them, and the
 * claim it exists to support is a negative one — that what crosses the wire is
 * what a server would hold, and that the sentence is not on it.
 *
 * A claim like that is only worth as much as the surface it is made about.
 * `ISignalProtocolRelayServer` declares **41** methods, counting the two
 * interfaces it extends — `IProvisioningService` and `IKeyRotationService`,
 * which is where the two prekey-metadata calls live. A session reaches the 15
 * in `CARRIED_CALLS` and `CARRIED_STREAMS` below and nothing else, measured
 * rather than guessed. Those are the only things this relay carries, and it is
 * those two lists that the honesty test asserts against.
 *
 * Every one of the other 26 throws its own name rather than returning a
 * plausible answer, and `UncoveredRelayMethod` below is what makes that
 * sentence true rather than aspirational: it fails the build naming any method
 * that is neither carried nor refused. A demo relay that quietly handed back
 * `null` for a method the SDK had started calling would keep working and stop
 * being true, which is the failure this page exists in order not to commit.
 * That is not hypothetical: the measured list was one short —
 * `subscribeRetryRequests` is called by every client at boot — and the refusal
 * is what said so, at the call, instead of the demo half-working.
 *
 * Retry requests are carried rather than dropped, and the reason is worth
 * stating: they are the SDK's answer to a message that would not decrypt, and
 * a wire between two tabs is the first place in this demo where that can
 * happen for an ordinary reason. A relay that swallowed them would make the
 * two-tab demo less reliable than the single-tab one and look like a protocol
 * fault. A `RetryRequest` carries ids, timestamps, a reason and a ratchet
 * public key — nothing a reader typed.
 *
 * Why one relay rather than one per tab. A relay's state is not replicable at
 * this layer: `fetchPreKeyBundle` *consumes* a one-time prekey, and two tabs
 * each holding their own copy would hand the same one-time prekey to two
 * handshakes and call it a server. So exactly one tab holds the
 * `inMemoryRelay()` — whichever wins an exclusive Web Lock, which is atomic
 * and needs no handshake — and every other tab calls into it. Both roles hand
 * back the same surface, so nothing downstream can tell which tab it is in,
 * and neither role can drift from the other by being written twice.
 *
 * This is demo infrastructure and is labelled as such wherever it is used
 * (D3). A real deployment has a server; this has a tab that volunteered.
 */

import { inMemoryRelay } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory';
import type { Envelope } from '@open-e2ee/signal-protocol-sdk';
import type { ISignalProtocolRelayServer } from '@open-e2ee/signal-protocol-sdk/remote/relay/types';

/**
 * Every relay method allowed to cross the channel.
 *
 * Measured from a real boot, sync, handshake and round trip rather than read
 * off the interface: the interface is what a relay may be asked for, and this
 * is what it was asked for. Two are here that the measurement did not reach —
 * `uploadEcSignedPreKey` and `uploadKemLastResortPreKey` fire only when a
 * signed prekey is due for rotation, which a fresh session's are not.
 *
 * The honesty test asserts against this list, so adding to it is a deliberate
 * act with a test to answer to, and a method missing from it fails loudly on
 * first use instead of being answered wrongly.
 */
export const CARRIED_CALLS = [
  'registerDevice',
  'provisionIdentityKey',
  'uploadPreKeys',
  'getPreKeyCount',
  'getEcSignedPreKeyMetadata',
  'getKemLastResortPreKeyMetadata',
  'uploadEcSignedPreKey',
  'uploadKemLastResortPreKey',
  'getDevices',
  'fetchPreKeyBundle',
  'send',
  'markDelivered',
  'sendRetryRequest',
] as const;

export type CarriedCall = (typeof CARRIED_CALLS)[number];

/**
 * The two subscriptions, which are not calls.
 *
 * Both hand back an unsubscribe function rather than a promise of one, so
 * neither can be a request/response over the channel. They are registrations,
 * and what comes back on them arrives as pushes.
 */
export const CARRIED_STREAMS = ['envelopes', 'retries'] as const;

export type CarriedStream = (typeof CARRIED_STREAMS)[number];

const CARRIED = new Set<string>(CARRIED_CALLS);

/** Everything this module will ever put on the channel. */
export type RelayMessage =
  /** A guest asking the host to run one of `CARRIED_CALLS`. */
  | { kind: 'call'; callId: string; method: CarriedCall; args: unknown[] }
  /** The host's answer. `value` is whatever that method returns. */
  | { kind: 'return'; callId: string; ok: true; value: unknown }
  | { kind: 'return'; callId: string; ok: false; error: string }
  /** A guest asking to be subscribed to one device's row, on one stream. */
  | { kind: 'watch'; watchId: string; stream: CarriedStream; userId: string; deviceId: number }
  | { kind: 'unwatch'; watchId: string }
  /** One stored row, on its way to the guest that asked for it. */
  | { kind: 'envelope'; watchId: string; envelope: Envelope }
  /** A receiving device asking a sender to try again. Carries no message. */
  | { kind: 'retry'; watchId: string; request: unknown };

/** The message kinds, for a test that wants to enumerate the wire. */
export const MESSAGE_KINDS = [
  'call',
  'return',
  'watch',
  'unwatch',
  'envelope',
  'retry',
] as const;

/**
 * The part of `BroadcastChannel` this uses.
 *
 * Narrowed to three members so that a test can supply a pair of linked fakes
 * and read every byte that crossed. The honesty claim is about what goes onto
 * the channel, and a claim about that is best made by a test holding the
 * channel rather than by one inspecting the page afterwards.
 */
export interface RelayChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface BroadcastRelayOptions {
  /** Channel name, so two demos on one origin cannot hear each other. */
  name?: string;
  /** Supplied by tests. Defaults to a real `BroadcastChannel`. */
  channel?: RelayChannel;
  /**
   * Which side this is. Defaults to `'elect'`, which asks for an exclusive Web
   * Lock and takes the host role if it gets it. Tests pin it, because election
   * across two fake channels in one process has no lock to arbitrate it.
   */
  role?: 'host' | 'guest' | 'elect';
  /**
   * How long a guest waits for the host to answer a call, in milliseconds.
   *
   * There is no answer to "the other tab closed" other than to say so. A call
   * that waits forever is the same defect the driver had, one layer down, and
   * it looks identical to the reader: a spinner and an empty console.
   */
  callTimeoutMs?: number;
}

const DEFAULT_CALL_TIMEOUT_MS = 10_000;

export interface DemoRelay {
  /** `'host'` holds the relay; `'guest'` calls the tab that does. */
  readonly role: 'host' | 'guest';
  /**
   * Hand to `createSignalProtocolClient({ adapters: { relay } })`.
   *
   * Typed as the full interface, which this does not implement — it carries
   * what a session reaches and refuses the rest by name. The single cast that
   * says so is at the bottom of this file, with its reasoning beside it,
   * rather than repeated at every call site.
   */
  readonly relay: ISignalProtocolRelayServer;
  /** Stop listening and, if host, drop the relay. */
  close(): void;
}

/**
 * A method the demo does not carry, which says so instead of answering.
 *
 * The alternative — returning `null`, `[]` or `undefined` to satisfy the type
 * — is how a demo goes on working while it stops being true. If the SDK ever
 * reaches for a sixteenth method, this page has to be the thing that reports
 * it, because nothing else is watching.
 */
function refuse(method: string): (...args: unknown[]) => never {
  return () => {
    throw new Error(
      `the two-tab demo relay does not carry ${method}(). It carries what a ` +
        `session was measured to reach: ${CARRIED_CALLS.join(', ')}, and the ` +
        `${CARRIED_STREAMS.join(' and ')} subscriptions. If the SDK now needs ` +
        `${method}(), add it here and to the test that enumerates the channel.`,
    );
  };
}

/**
 * Method names on the full interface that this relay answers by refusing.
 *
 * The eight provisioning methods are here for the same reason as the rest,
 * although no two-tab session can reach them: the demo links no second device.
 * They were missing from the first draft of this list, which made the header's
 * "everything else throws its own name" false — calling one gave
 * `relay.createProvisioningSession is not a function`, an error about
 * JavaScript rather than about this demo. `UncoveredRelayMethod` below now
 * fails the build on that whole class rather than leaving it to be noticed.
 */
const REFUSED = [
  'createProvisioningSession',
  'connectNewDevice',
  'sendProvisioningMessage',
  'getProvisioningMessage',
  'completeProvisioning',
  'acknowledgeProvisioning',
  'rollbackProvisioning',
  'deleteProvisioningSession',
  'removeDevice',
  'markDeviceConnected',
  'markDeviceDisconnected',
  'heartbeat',
  'rotateIdentityKey',
  'getIdentityKey',
  'clearStaleKemPreKeys',
  'getActiveDevices',
  'createGroupState',
  'getGroupState',
  'getGroupJoinInfo',
  'getGroupChanges',
  'submitGroupChange',
  'issueAuthCredential',
  'refreshGroupSendEndorsements',
  'fetchSenderCertificate',
  'sendUnidentified',
  'sendMultiRecipientUnidentified',
] as const;

/**
 * Every method of the interface is either carried or refused. Nothing is
 * absent.
 *
 * This is the guard behind the counts in the header, and it is written as an
 * `Exclude` rather than an annotation because an annotation is the weaker
 * shape: `readonly (keyof ISignalProtocolRelayServer)[]` on the arrays above
 * would accept a list that has *lost* a name as readily as one that has all of
 * them. `UncoveredRelayMethod` is the set of methods neither list mentions, and
 * the assignment below fails the build naming them — which is what happens when
 * the SDK adds one.
 *
 * `groupServer` is the interface's one property rather than a method, and
 * `subscribe`/`subscribeRetryRequests` are registrations that this relay
 * implements directly on both roles rather than through `CARRIED_CALLS`.
 */
type UncoveredRelayMethod = Exclude<
  keyof ISignalProtocolRelayServer,
  | CarriedCall
  | (typeof REFUSED)[number]
  | 'groupServer'
  | 'subscribe'
  | 'subscribeRetryRequests'
>;

const _everyRelayMethodIsCarriedOrRefused: [UncoveredRelayMethod] extends [never]
  ? true
  : ['these relay methods are neither carried nor refused', UncoveredRelayMethod] = true;
void _everyRelayMethodIsCarriedOrRefused;

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Take the host role if it is going, without waiting for it if it is not.
 *
 * `ifAvailable` makes this atomic: exactly one tab is told it got the lock, no
 * announcement round trip and no window in which two tabs both believe they
 * are the host. The callback's promise is never resolved, so the lock is held
 * until the tab goes away, at which point the browser releases it.
 */
async function winHostRole(name: string): Promise<boolean> {
  if (!('locks' in navigator)) {
    throw new Error(
      'this browser has no Web Locks API, so the two tabs cannot agree which ' +
        'of them holds the relay',
    );
  }
  return new Promise<boolean>((resolve) => {
    void navigator.locks.request(`oe-demo-relay:${name}`, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      /* Held for the life of the tab when we won it; released immediately when
         we did not, since a null lock was never taken. */
      return lock === null ? undefined : new Promise<never>(() => {});
    });
  });
}

export async function broadcastRelay(options: BroadcastRelayOptions = {}): Promise<DemoRelay> {
  const name = options.name ?? 'oe-demo';
  const callTimeoutMs = options.callTimeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  const channel = options.channel ?? new BroadcastChannel(`oe-demo-relay:${name}`);
  const role =
    options.role && options.role !== 'elect'
      ? options.role
      : (await winHostRole(name))
        ? 'host'
        : 'guest';

  const post = (message: RelayMessage) => channel.postMessage(message);

  const base: Record<string, unknown> = {};
  for (const method of REFUSED) base[method] = refuse(method);

  let relay: Record<string, unknown>;
  let stop: () => void;

  if (role === 'host') {
    const local = inMemoryRelay() as unknown as Record<string, (...args: unknown[]) => unknown>;
    /* One subscription per watching guest, so an `unwatch` — or a guest that
       reloads — takes down that guest's and nobody else's. */
    const watches = new Map<string, () => void>();

    channel.addEventListener('message', (event) => {
      const message = event.data as RelayMessage;
      if (!message || typeof message !== 'object') return;

      if (message.kind === 'call') {
        if (!CARRIED.has(message.method)) {
          post({
            kind: 'return',
            callId: message.callId,
            ok: false,
            error: `the two-tab demo relay does not carry ${String(message.method)}()`,
          });
          return;
        }
        void (async () => {
          try {
            const value = await local[message.method](...message.args);
            post({ kind: 'return', callId: message.callId, ok: true, value });
          } catch (error) {
            post({
              kind: 'return',
              callId: message.callId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })();
        return;
      }

      if (message.kind === 'watch') {
        if (watches.has(message.watchId)) return;
        const { watchId, userId, deviceId } = message;
        const unsubscribe =
          message.stream === 'envelopes'
            ? (local.subscribe(userId, deviceId, (envelope: Envelope) =>
                post({ kind: 'envelope', watchId, envelope }),
              ) as () => void)
            : (local.subscribeRetryRequests(userId, deviceId, async (request: unknown) => {
                post({ kind: 'retry', watchId, request });
              }) as () => void);
        watches.set(watchId, unsubscribe);
        return;
      }

      if (message.kind === 'unwatch') {
        watches.get(message.watchId)?.();
        watches.delete(message.watchId);
      }
    });

    relay = {
      ...base,
      ...Object.fromEntries(
        CARRIED_CALLS.map((method) => [method, (...args: unknown[]) => local[method](...args)]),
      ),
      subscribe: (userId: string, deviceId: number, onEnvelope: (envelope: Envelope) => void) =>
        local.subscribe(userId, deviceId, onEnvelope),
      subscribeRetryRequests: (
        userId: string,
        deviceId: number,
        handler: (request: unknown) => Promise<void>,
      ) => local.subscribeRetryRequests(userId, deviceId, handler),
    };

    stop = () => {
      for (const unsubscribe of watches.values()) unsubscribe();
      watches.clear();
    };
  } else {
    const waiting = new Map<
      string,
      { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
    >();
    const watchers = new Map<string, (value: unknown) => void>();

    channel.addEventListener('message', (event) => {
      const message = event.data as RelayMessage;
      if (!message || typeof message !== 'object') return;

      if (message.kind === 'return') {
        const pending = waiting.get(message.callId);
        if (!pending) return;
        waiting.delete(message.callId);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.value);
        else pending.reject(new Error(message.error));
        return;
      }

      if (message.kind === 'envelope') watchers.get(message.watchId)?.(message.envelope);
      else if (message.kind === 'retry') watchers.get(message.watchId)?.(message.request);
    });

    const call = (method: CarriedCall, args: unknown[]) =>
      new Promise<unknown>((resolve, reject) => {
        const callId = nextId('call');
        const timer = setTimeout(() => {
          waiting.delete(callId);
          reject(
            new Error(
              `the tab holding the relay did not answer ${method}() within ` +
                `${callTimeoutMs}ms. It has probably been closed; reload this tab.`,
            ),
          );
        }, callTimeoutMs);
        waiting.set(callId, { resolve, reject, timer });
        post({ kind: 'call', callId, method, args });
      });

    /*
     * Register a subscription, and hand back its unsubscribe now.
     *
     * Both subscriptions return their unsubscribe function rather than a
     * promise of one, so neither can wait for the host to confirm. A client
     * given a promise here stores it and fails much later, in `stop()`, saying
     * `this.retryUnsubscribe is not a function` — which is a long way from the
     * line that caused it.
     *
     * Nothing is missed in the gap before the host registers. The relay
     * replays a device's stored rows to each new subscriber, so an envelope
     * that arrived first is delivered on arrival of the watch instead.
     */
    const watch = (
      stream: CarriedStream,
      userId: string,
      deviceId: number,
      handler: (value: unknown) => void,
    ) => {
      const watchId = nextId('watch');
      watchers.set(watchId, handler);
      post({ kind: 'watch', watchId, stream, userId, deviceId });
      return () => {
        watchers.delete(watchId);
        post({ kind: 'unwatch', watchId });
      };
    };

    relay = {
      ...base,
      ...Object.fromEntries(
        CARRIED_CALLS.map((method) => [method, (...args: unknown[]) => call(method, args)]),
      ),
      subscribe: (userId: string, deviceId: number, onEnvelope: (envelope: Envelope) => void) =>
        watch('envelopes', userId, deviceId, onEnvelope as (value: unknown) => void),
      subscribeRetryRequests: (
        userId: string,
        deviceId: number,
        handler: (request: unknown) => Promise<void>,
      ) => watch('retries', userId, deviceId, handler as (value: unknown) => void),
    };

    stop = () => {
      for (const [callId, pending] of waiting) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`the demo relay was closed before ${callId} was answered`));
      }
      waiting.clear();
      watchers.clear();
    };
  }

  return {
    role,
    /*
     * The one cast, and why it is a cast rather than an implementation.
     *
     * `ISignalProtocolRelayServer` declares forty-one methods; a session
     * reaches the fifteen above. Writing the other twenty-six to satisfy the
     * compiler would be twenty-six places for a wrong answer to hide, and the
     * compiler cannot tell a correct implementation from a plausible one. So
     * they are present and they throw their own names, which is the honest
     * shape and the one that reports a change in the SDK instead of absorbing
     * it. The type says what the SDK requires; `refuse()` says what this is.
     */
    relay: relay as unknown as ISignalProtocolRelayServer,
    close() {
      stop();
      channel.close();
    },
  };
}
