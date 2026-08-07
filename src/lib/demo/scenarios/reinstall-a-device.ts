/*
 * Throw away the receiving device and build it again from nothing, which is
 * what a reinstall is, and then keep writing to it.
 *
 * The subject of this scenario is the gap between what the protocol knows and
 * what the application is told. The protocol notices immediately: the relay
 * refuses to let a device it has never seen publish under an account identity
 * it is already holding, and the sending device refuses to build a session
 * against an identity it did not pin. The application is told none of that. The
 * send resolves, the sentence never arrives, and no hook fires.
 *
 * Four things were established by running `0.1.0-alpha.12` before this scenario
 * was written, and all four shape what it prints:
 *
 *  - There is no identity-change event. The plan this scenario came from
 *    expected to display one; the SDK has no such hook, and registering every
 *    hook it does have leaves all of them silent through the whole reinstall.
 *    Displaying an event here would have been the page's only lie.
 *  - `verify()`, the call that produces safety numbers, *throws* once the
 *    identity has changed. So the application cannot even render the changed
 *    number that a "safety number changed" banner would be built from without
 *    first deciding to accept the change.
 *  - What the SDK does say, it says at `error` on the *sending* side, and only
 *    after the receiving device's automatic retry request has forced a new
 *    session. The send itself is quiet.
 *  - The reinstalled device cannot take the account over by asking. It has to
 *    call `rotateAccountIdentity` with a commitment over the identity the relay
 *    is already serving — and that identity is public, which is why the page
 *    calls the check what it is (a guard against two devices racing) rather
 *    than something it is not (proof of who is holding the phone).
 *
 * Every number and every string this returns is read off the SDK or the relay.
 * Nothing here decides that an identity changed and then reports it: if the SDK
 * started firing a hook, `hooks.fired` would fill up on its own.
 */

/* demo:code:start */
import { createSignalProtocolClient, keys } from '@open-e2ee/signal-protocol-sdk';
import type { HookName } from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import { startDemoSession } from '../driver.ts';
/* demo:code:end */
import type { CompositeIdentityV1 } from '@open-e2ee/signal-protocol-sdk/keys';
import { captureScenarioLog, type ScenarioBreadcrumb, type ScenarioLogRecord } from './log.ts';

export { describePayload } from './log.ts';

/**
 * Every hook `SignalProtocolClientHooks` offers, written out so that "none of
 * them fired" is a claim about a list the reader can see rather than about a
 * number they have to take on trust.
 *
 * Typed as `HookName[]` on purpose: the day the SDK adds a hook, this list stops
 * type-checking against the union and has to be brought up to date, which is the
 * only way a finding of this shape can be kept honest by the compiler rather
 * than by whoever reads it next.
 */
/* demo:code:start */
const WATCHED_HOOKS: HookName[] = [
  'onSessionEstablished',
  'onSessionDeleted',
  'onSessionArchived',
  'onKeyRotated',
  'onMessageEncrypted',
  'onMessageDecrypted',
  'onDecryptionError',
  'onEncryptionError',
  'onKeysCleanedUp',
  'onDeliveryReceiptReceived',
  'onReadReceiptReceived',
  'onViewedReceiptReceived',
  'onTypingIndicatorReceived',
];
/* demo:code:end */

/** A call the scenario made, and what came back out of it. */
export type Attempt =
  | { ok: true }
  | { ok: false; name: string; code: string | null; message: string; cause: string | null };

/**
 * A safety number as the SDK produced it, split where the SDK splits it.
 *
 * The 60 digits are two 30-digit halves, one per party, concatenated in a fixed
 * order. Keeping the halves apart is the point: after the far side reinstalls,
 * only their half moves, and a page that printed one long string would be
 * asking the reader to diff sixty digits by eye — which is the failure this
 * scenario is about rather than a presentation detail.
 */
export interface SafetyNumberView {
  numeric: string;
  /** The six groups belonging to the local party, which do not move. */
  localHalf: string;
  /** The six groups belonging to the far party, which do. */
  remoteHalf: string;
  /** The SDK's own word for how far trust has got. Never promoted by reading. */
  trustState: string | null;
}

export interface ReinstallResult {
  /** The account that keeps writing. */
  sender: string;
  /** The account that reinstalls under the sender. */
  recipient: string;
  /** The sentence that got through before anything changed. */
  established: { sentence: string; delivered: string | null };
  /** The safety numbers the two of them could have compared at that point. */
  before: SafetyNumberView | null;
  /**
   * What the relay said when the rebuilt device tried to publish itself.
   *
   * A failure here is the scenario working. It is returned as the whole error —
   * name, code and the relay's own sentence — because the page quotes it, and a
   * page that quoted a remembered version of this string would go stale without
   * anything failing.
   */
  publish: Attempt;
  /** Whether the rebuilt device got back onto the account, and how it had to. */
  rotate: Attempt;
  /**
   * The send made while the sender was still pinned to the identity that no
   * longer exists. `resolved` is the sender's application being told it worked.
   */
  stranded: { sentence: string; resolved: boolean; delivered: string | null };
  /**
   * The whole hook surface, registered on every device that exists while the
   * identity is changing, and the hooks that actually fired in that window.
   *
   * `fired` being empty is the finding. It is returned as the list rather than
   * as a boolean so that the page can print what did fire the moment the SDK
   * starts firing something.
   *
   * `devices` names who was carrying the hooks, because "nothing fired" is only
   * worth anything if something was listening on the right devices. The device
   * that was destroyed is not among them: it stops before the window opens, and
   * a hook on a stopped device would prove nothing.
   */
  hooks: { registered: HookName[]; fired: string[]; devices: string[] };
  /** What `verify()` did when the application asked for the safety numbers. */
  asked: Attempt;
  /**
   * Records at `warn` or `error` from the moment the device was destroyed.
   *
   * Unlike the prekey-exhaustion scenario, this list is not empty — the SDK
   * does reach `error` here. The page prints the list, so it can say which
   * device spoke and what code it carried without any of that being written
   * down twice.
   */
  loud: ScenarioLogRecord[];
  /** Distinct error codes carried on those records, in first-seen order. */
  codes: string[];
  /** What accepting the identity change made possible, if anything. */
  accepted: Attempt;
  recovered: string | null;
  /** Whether the sentence that was stranded turned up too, rather than lost. */
  strandedArrivedLater: boolean;
  /** The safety numbers after the change was accepted. */
  after: SafetyNumberView | null;
  records: ScenarioLogRecord[];
  breadcrumbs: ScenarioBreadcrumb[];
  debugRecords: number;
}

const FIRST = 'Landing at six — I will call from the taxi.';
const STRANDED = 'Did you get my last message?';
const RECOVERED = 'Trying again now that I have accepted the change.';

/** How long delivery is given before a run calls a sentence undelivered. */
const DELIVERY_TIMEOUT_MS = 10000;

/**
 * How long the stranded send is watched before it is called undelivered.
 *
 * Longer than it needs to be, deliberately. This is the one number on the page
 * that reports an absence, and the receiving device answers a failed decryption
 * by asking the sender to try again — so the quiet has to outlast that whole
 * exchange before it means anything. Ten seconds of nothing is a finding; one
 * tick of nothing is a race.
 */
const QUIET_TIMEOUT_MS = 10000;

/** Poll a condition up to `timeoutMs`, so a slow tick is not read as a failure. */
async function settle(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (!condition() && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return condition();
}

/** Run a call and keep whatever came back, error included, without throwing. */
async function attempt(run: () => Promise<unknown>): Promise<Attempt> {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    const wrapped = error as { name?: string; code?: string; message?: string; context?: unknown };
    const context = wrapped.context as { originalError?: { message?: string } } | undefined;
    return {
      ok: false,
      name: wrapped.name ?? 'Error',
      code: typeof wrapped.code === 'string' ? wrapped.code : null,
      message: wrapped.message ?? String(error),
      cause: context?.originalError?.message ?? null,
    };
  }
}

/** The number the SDK generated, split into the two halves it is made of. */
const HALF_GROUPS = 6;

function viewSafetyNumber(safetyNumber: {
  numeric: string;
  trustState: string | null;
}): SafetyNumberView {
  const groups = safetyNumber.numeric.split(' ');
  return {
    numeric: safetyNumber.numeric,
    localHalf: groups.slice(0, HALF_GROUPS).join(' '),
    remoteHalf: groups.slice(HALF_GROUPS).join(' '),
    trustState: safetyNumber.trustState,
  };
}

/**
 * The account identity the relay is currently serving for a user.
 *
 * The relay answers `null` for a user it is holding nothing for, which is not a
 * state this scenario can carry on from — both callers need the identity in
 * order to say anything true about it. Failing here with a sentence is better
 * than passing `null` into the SDK and reporting whatever it makes of that.
 */
async function currentIdentity(
  relay: { getIdentityKey: (userId: string) => Promise<CompositeIdentityV1 | null> },
  userId: string,
): Promise<CompositeIdentityV1> {
  const identity = await relay.getIdentityKey(userId);
  if (!identity) throw new Error(`the relay is holding no account identity for ${userId}`);
  return identity;
}

/** Whatever error code a record is carrying, wherever the SDK put it. */
function codeOf(record: ScenarioLogRecord): string | null {
  for (const entry of record.payload) {
    if (typeof entry !== 'object' || entry === null) continue;
    const payload = entry as { code?: unknown; error?: { code?: unknown } };
    if (typeof payload.code === 'string') return payload.code;
    if (typeof payload.error?.code === 'string') return payload.error.code;
  }
  return null;
}

export async function reinstallADevice(): Promise<ReinstallResult> {
  const log = captureScenarioLog();
  const fired: string[] = [];
  /* Hooks are recorded from the moment they are registered, but only the ones
     that arrive after the device is destroyed are the finding. The window opens
     below, once the ordinary conversation has finished. */
  let watching = false;

  const session = await startDemoSession({
    logger: { sender: log.for('sender'), recipient: log.for('recipient') },
  });
  const { relay, sender, recipient } = session;

  /*
   * Register the whole hook surface on a device, tagged with which one it is.
   *
   * `registerHook` assigns rather than subscribes — a second call for the same
   * name replaces the first, it does not add to it. So `onDecrypted` is passed
   * in and folded into the one `onMessageDecrypted` this installs, instead of
   * being registered separately afterwards. Registering it separately is how
   * the first draft of this scenario silently unhooked the delivery tracking it
   * depended on and then waited forever for a message that had already arrived.
   */
  const watchHooks = (
    client: { registerHook: (name: never, callback: never) => void },
    role: string,
    onDecrypted?: (message: { content: string }) => void,
  ) => {
    for (const name of WATCHED_HOOKS) {
      client.registerHook(name as never, ((message: { content: string }) => {
        if (watching) fired.push(`${role}:${name}`);
        if (name === 'onMessageDecrypted') onDecrypted?.(message);
      }) as never);
    }
  };

  /* The sender carries the whole surface for the whole run: it is the device
     that is kept in the dark, so it is the device the finding is about. The
     receiving device that is about to be destroyed gets nothing — the driver
     owns its decryption hook, and it stops before the window opens. */
  const hookedDevices = [sender];
  watchHooks(session.senderClient, sender);

  let rebuilt: Awaited<ReturnType<typeof createSignalProtocolClient>> | null = null;

  try {
    /* An ordinary conversation first, so that the sender has a session and a
       pinned identity to lose. Without this the reinstall is just a first
       contact, which is the case the protocol has no complaint about. */
    const primary = session.recipientDevices[0];
    await session.send(FIRST);
    const establishedArrived = await settle(
      () => primary.received.some((message) => message.content === FIRST),
      DELIVERY_TIMEOUT_MS,
    );

    const before = viewSafetyNumber(await session.senderClient.verify(recipient));

    /* demo:code:start */
    /* The reinstall. The device is stopped and a new one is built on storage
       that has never held anything — no identity, no session, no prekeys. This
       is what the receiving account looks like after an uninstall, a new
       handset, or a restore that did not carry the keys. */
    await session.recipientClient.stop();
    watching = true;
    const loudFrom = log.records.length;

    rebuilt = await createSignalProtocolClient({
      identity: { userId: recipient },
      adapters: { storage: inMemoryStore(), relay },
      logger: log.for(`${recipient} (reinstalled)`),
    });

    /* Building the client does not throw. It syncs itself on the way up, the
       relay turns that sync down, and the client comes up anyway — offline,
       and saying so only at `warn`. The rebuilt device looks healthy to the
       code that built it.

       Asking for the sync explicitly is what surfaces the reason: the relay is
       already holding an account identity for this user, and this device is not
       it. A reinstall cannot quietly become the account. */
    const publish = await attempt(() => rebuilt!.syncToServer());

    /* The one way back on. The commitment is taken over the identity the relay
       is currently serving — which is public, and which anybody who can read
       the relay can compute. It stops two devices from rotating over each
       other; it does not establish that this device is the right one. */
    const rotate = await attempt(async () => {
      const current = await currentIdentity(relay, recipient);
      await rebuilt!.rotateAccountIdentity(keys.deriveIdentityCommitment(current));
    });
    /* demo:code:end */

    const arrived: string[] = [];
    const rebuiltRole = `${recipient} (reinstalled)`;
    watchHooks(rebuilt, rebuiltRole, (message) => arrived.push(message.content));
    hookedDevices.push(rebuiltRole);
    rebuilt.startRelaySubscription();

    /* demo:code:start */
    /* And now the sender, who has been told nothing, writes again. */
    const stranded = await attempt(() => session.senderClient.send(recipient, STRANDED));
    /* demo:code:end */

    const strandedArrived = await settle(
      () => arrived.includes(STRANDED),
      QUIET_TIMEOUT_MS,
    );

    /* The window closes here. Everything past this line is the application
       deciding to do something about the change, and hooks that fire because
       it did are not evidence that the SDK volunteered anything. */
    const firedWhileSilent = [...fired];
    watching = false;

    /* The call an application makes to show the user a safety number. */
    const asked = await attempt(() => session.senderClient.verify(recipient));

    /* demo:code:start */
    /* Accepting the identity change is an explicit, out-of-band decision. It
       discards every session bound to the identity that is gone; the SDK will
       not make it on the application's behalf. */
    const accepted = await attempt(async () => {
      const current = await currentIdentity(relay, recipient);
      await session.senderClient.acceptIdentityRotation(recipient, current);
    });
    /* demo:code:end */

    await session.senderClient.send(recipient, RECOVERED).catch(() => {});
    const recovered = await settle(() => arrived.includes(RECOVERED), DELIVERY_TIMEOUT_MS);

    const loud = log.records.slice(loudFrom).filter((record) => record.level !== 'info');
    const codes: string[] = [];
    for (const record of loud) {
      const code = codeOf(record);
      if (code && !codes.includes(code)) codes.push(code);
    }

    return {
      sender,
      recipient,
      established: { sentence: FIRST, delivered: establishedArrived ? FIRST : null },
      before,
      publish,
      rotate,
      stranded: {
        sentence: STRANDED,
        resolved: stranded.ok,
        delivered: strandedArrived ? STRANDED : null,
      },
      hooks: { registered: WATCHED_HOOKS, fired: firedWhileSilent, devices: hookedDevices },
      asked,
      loud,
      codes,
      accepted,
      recovered: recovered ? RECOVERED : null,
      strandedArrivedLater: arrived.includes(STRANDED),
      after: accepted.ok
        ? viewSafetyNumber(await session.senderClient.verify(recipient))
        : null,
      records: log.records,
      breadcrumbs: log.breadcrumbs,
      debugRecords: log.debugRecords,
    };
  } finally {
    /* The rebuilt device is this scenario's own, so this scenario stops it. The
       session stops the two accounts it booted, including the one already
       stopped above, which it tolerates. */
    if (rebuilt) await rebuilt.stop().catch(() => {});
    await session.stop();
  }
}
