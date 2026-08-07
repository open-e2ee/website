/*
 * Take the one-time prekeys away from the server and open a new conversation
 * anyway.
 *
 * The point of this scenario is what does *not* happen. The handshake succeeds,
 * the message arrives, and the SDK says nothing at `warn` or `error` — the
 * session simply falls back to the last-resort prekey, which is a weaker
 * position for the first messages of the conversation and is reported nowhere a
 * careless application would look. That is the industry's failure mode rather
 * than this SDK's invention: a 2025 measurement of WhatsApp found the same
 * exhausted state on 13% of companion devices in the wild.
 *
 * Everything the page prints about the fallback is read off the SDK: the prekey
 * bundle the relay actually published, the counts the relay actually holds, and
 * the SDK's own breadcrumb naming which KEM prekey it used. Nothing here
 * decides that a fallback happened and then says so — if the SDK stopped
 * falling back, the fields this returns would go empty rather than go stale.
 *
 * Two things were established by running the shipped package before this
 * scenario was written, and both shape it:
 *
 *  - Exhaustion never reaches `warn` or `error`. An earlier sketch of this
 *    scenario planned to print "the warning the SDK gives you". There is no
 *    such warning. Printing one would have been the page's only lie.
 *  - `checkPreKeyStatus()`, the SDK's documented prekey-health call, counts the
 *    prekeys in *local* storage rather than the ones left on the server. The
 *    server is the side that runs out. So the call returns a healthy-looking
 *    number at the exact moment the server has none, which is why this scenario
 *    prints what it returns instead of leaving the reader to assume it helps.
 *
 * The relay's pool is emptied part-way through rather than at boot so that the
 * counts have a before as well as an after. That also matches the measured
 * cause: the WhatsApp study reads the exhausted companion devices as ones that
 * were offline long enough to spend their stash without replenishing it.
 */

/* demo:code:start */
import { ProtocolAddress, createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import { startDemoSession } from '../driver.ts';
/* demo:code:end */
import { captureScenarioLog, type ScenarioBreadcrumb, type ScenarioLogRecord } from './log.ts';

export { describePayload } from './log.ts';

/** What the relay is still holding for the receiving device, by key type. */
export interface PreKeyCounts {
  ec: number;
  kem: number;
}

/**
 * The keys in one published bundle, by id, with `null` meaning the relay
 * published no such key. The ids are the SDK's own; they are printed because a
 * reader comparing two runs can see the one-time id move and the last-resort id
 * stay put.
 */
export interface BundleKeys {
  ecOneTimePreKey: number | null;
  kemOneTimePreKey: number | null;
  kemLastResortPreKey: number | null;
  /**
   * The head of the last-resort prekey's public key, base64 exactly as the
   * relay published it.
   *
   * Shown because it is the scenario's argument made concrete: while the stash
   * is empty this one key is what every arriving sender is handed, and a reader
   * who runs the scenario twice gets two different keys — which is also how the
   * page can be told apart from a recording of it.
   */
  kemLastResortFingerprint: string | null;
}

/** Enough of the key to be unmistakable, short enough to read in a sentence. */
const FINGERPRINT_LENGTH = 16;

/**
 * What the SDK said it did, taken from the breadcrumb it drops when initiator
 * key agreement completes. `null` for either field means the SDK did not report
 * it on this run, and the page says so rather than guessing.
 */
export interface Agreement {
  usedOneTimePreKey: boolean | null;
  usedKemPreKeyType: string | null;
}

export interface RunOutOfPreKeysResult {
  /** The account whose prekeys run out. */
  recipient: string;
  /** The account opening the new conversation after they have run out. */
  contact: string;
  /** Relay-side counts before anything was sent. */
  before: PreKeyCounts;
  /** After one ordinary conversation — one one-time prekey spent. */
  afterFirstConversation: PreKeyCounts;
  /** What the relay had left to give at the moment it published the bundle. */
  exhausted: PreKeyCounts;
  /** How the ordinary conversation's handshake went, in the SDK's words. */
  healthy: Agreement;
  /** What the relay published once the stash was gone. */
  bundle: BundleKeys | null;
  /** How the handshake against that bundle went, in the SDK's words. */
  fallback: Agreement;
  /**
   * The sentence of the ordinary conversation that spends the first prekey.
   *
   * Not printed on the page — the ordinary conversation is scaffolding here,
   * not the subject. It is returned because it is plaintext this run
   * encrypted, and the smoke harness checks that neither sentence leaves the
   * tab in a request.
   */
  firstSentence: string;
  /** The sentence the new contact sent, and whether it arrived. */
  sentence: string;
  delivered: string | null;
  /**
   * Every record at `warn` or `error` logged by any device while the stash was
   * empty. This being empty is the scenario's finding, so it is returned as the
   * list rather than as a count someone has to trust.
   */
  warnings: ScenarioLogRecord[];
  /**
   * What the SDK did log while the stash was empty, which is the other half of
   * the finding and the half that keeps it from being vacuous.
   *
   * "No warning" read off an empty `warnings` array says nothing on its own: an
   * SDK that logged nothing whatsoever would satisfy it, and so would a filter
   * that was quietly broken. It is worth saying only beside what the SDK did
   * do. Measured against `0.1.0-alpha.12`, the exhausted handshake produces no
   * record at all at `info` or above and a long trail of breadcrumbs, several
   * naming the fallback outright — so the SDK is not silent, it is talking
   * somewhere an application is not listening. All three are counted here and
   * printed, rather than asserted in a sentence.
   */
  whileEmpty: {
    /** Records at `info` or above, of which `warnings` are the loud ones. */
    records: number;
    breadcrumbs: number;
    /** Breadcrumbs whose message names the last-resort fallback. */
    namingFallback: number;
  };
  /**
   * What `checkPreKeyStatus()` reported while the relay held none. The SDK
   * throttles the call and returns `-1` when it declines to answer, so the
   * page has to be able to tell a real count from a refusal.
   */
  health: { oneTimePreKeysRemaining: number; needsReplenishment: boolean } | null;
  records: ScenarioLogRecord[];
  breadcrumbs: ScenarioBreadcrumb[];
  debugRecords: number;
}

const CONTACT = 'carol';
const FIRST = 'Morning — everything still on for Thursday?';
const SENTENCE = 'First message of a brand new conversation.';

/*
 * How long delivery is given before the run is called a failure.
 *
 * The relay hands an envelope to its subscriber inside `send()`, so in practice
 * the sentence is already decrypted by the time the send resolves. The wait
 * exists because depending on that ordering silently is how a page ends up
 * printing "not delivered" for a message that arrived a tick later.
 */
const DELIVERY_TIMEOUT_MS = 10000;

/**
 * The SDK reports key agreement in a breadcrumb whose payload is nested a
 * level or two deep depending on the wrapper. Look for the fields wherever they
 * are, for the same reason `flip-a-byte` does: what this prints is the SDK's
 * own account of the handshake, and a hard-coded path would print nothing at
 * all the day the wrapper changed.
 */
function findAgreement(value: unknown, depth = 0): Agreement | null {
  if (depth > 4 || typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.usedKemPreKeyType === 'string') {
    return {
      usedKemPreKeyType: record.usedKemPreKeyType,
      usedOneTimePreKey: typeof record.usedOneTimePreKey === 'boolean' ? record.usedOneTimePreKey : null,
    };
  }
  for (const nested of Object.values(record)) {
    const found = findAgreement(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The last agreement reported from `from` onwards, or an empty one. */
function agreementSince(breadcrumbs: ScenarioBreadcrumb[], from: number): Agreement {
  let agreement: Agreement | null = null;
  for (const crumb of breadcrumbs.slice(from)) {
    agreement = findAgreement(crumb.data) ?? agreement;
  }
  return agreement ?? { usedOneTimePreKey: null, usedKemPreKeyType: null };
}

/** Poll a condition up to `timeoutMs`, so a slow tick is not read as a failure. */
async function settle(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (!condition() && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return condition();
}

export async function runOutOfPreKeys(): Promise<RunOutOfPreKeysResult> {
  const log = captureScenarioLog();

  /* demo:code:start */
  const session = await startDemoSession({
    logger: { sender: log.for('sender'), recipient: log.for('recipient') },
  });
  const { relay, recipient } = session;
  const deviceId = session.recipientClient.deviceId;

  /* How many one-time prekeys the relay is holding for the receiving device,
     asked of the relay rather than counted here. */
  const counts = async (): Promise<PreKeyCounts> => ({
    ec: await relay.getPreKeyCount(recipient, deviceId, 'ec'),
    kem: await relay.getPreKeyCount(recipient, deviceId, 'kem'),
  });

  const before = await counts();

  /* One ordinary conversation, which spends one one-time prekey of each type. */
  const primary = session.recipientDevices[0];
  const healthyFrom = log.breadcrumbs.length;
  await session.send(FIRST);

  /* Wait for that conversation to finish before anything starts watching for
     complaints about the next one. The recipient decrypts after `send()` has
     resolved, so a record belonging to this conversation can otherwise land
     after the mark below and be counted against the exhausted handshake — the
     page then prints a number that changes from press to press for a reason
     that has nothing to do with prekeys. */
  await settle(() => primary.received.some((message) => message.content === FIRST), DELIVERY_TIMEOUT_MS);

  const healthy = agreementSince(log.breadcrumbs, healthyFrom);
  const afterFirstConversation = await counts();

  /* Now the stash is gone: the device has been offline too long to replenish
     what it spent, so the relay has one-time prekeys for nobody. The signed and
     last-resort keys stay, which is exactly the state the WhatsApp measurement
     found on 13% of companion devices. */
  relay.failures.configure({ exhaustOneTimePreKeys: true });

  /* Somebody who has never written to this account before opens a conversation
     with it. This is the case that matters: the first messages of a new
     session are the ones a one-time prekey protects. */
  await relay.registerDevice(CONTACT, { encryptedDeviceName: new ArrayBuffer(0) });
  const contact = await createSignalProtocolClient({
    identity: { userId: CONTACT },
    adapters: { storage: inMemoryStore(), relay },
    logger: log.for(CONTACT),
  });
  await contact.syncToServer();

  const warningsFrom = log.records.length;
  const fallbackFrom = log.breadcrumbs.length;

  /* The bundle the relay publishes with nothing one-time left in it. The count
     is read after the fetch, because the count is what the relay has left to
     give and the fetch is the moment it gives it. */
  const published = await relay.fetchPreKeyBundle(recipient, deviceId, CONTACT);
  const exhausted = await counts();
  await contact.establishSession(ProtocolAddress.create(recipient, deviceId), published!);
  await contact.send(recipient, SENTENCE);

  /* And the call an application would make to find out whether any of this had
     happened. */
  const health = await session.recipientClient.checkPreKeyStatus();
  /* demo:code:end */

  try {
    if (!published) {
      throw new Error(
        `the relay published no prekey bundle for ${recipient}, so the run never reached a ` +
          `handshake and shows nothing about prekey exhaustion`,
      );
    }

    const arrived = await settle(
      () => primary.received.some((message) => message.content === SENTENCE),
      DELIVERY_TIMEOUT_MS,
    );

    return {
      recipient,
      contact: CONTACT,
      before,
      afterFirstConversation,
      exhausted,
      healthy,
      bundle: {
        ecOneTimePreKey: published.ecOneTimePreKey?.keyId ?? null,
        kemOneTimePreKey: published.kemOneTimePreKey?.keyId ?? null,
        kemLastResortPreKey: published.kemLastResortPreKey?.keyId ?? null,
        kemLastResortFingerprint:
          published.kemLastResortPreKey?.publicKey.slice(0, FINGERPRINT_LENGTH) ?? null,
      },
      fallback: agreementSince(log.breadcrumbs, fallbackFrom),
      firstSentence: FIRST,
      sentence: SENTENCE,
      delivered: arrived ? SENTENCE : null,
      warnings: log.records.slice(warningsFrom).filter((record) => record.level !== 'info'),
      whileEmpty: {
        records: log.records.length - warningsFrom,
        breadcrumbs: log.breadcrumbs.length - fallbackFrom,
        namingFallback: log.breadcrumbs
          .slice(fallbackFrom)
          .filter((crumb) => crumb.message.includes('last-resort')).length,
      },
      health,
      records: log.records,
      breadcrumbs: log.breadcrumbs,
      debugRecords: log.debugRecords,
    };
  } finally {
    /* The extra contact is this scenario's own, so this scenario stops it; the
       session puts its own two accounts away. */
    await contact.stop();
    await session.stop();
  }
}
