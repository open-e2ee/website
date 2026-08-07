/*
 * Change one byte of one ciphertext in transit, and watch the protocol refuse
 * it.
 *
 * This is the scenario the SDK's whole reason for existing rests on, so it is
 * run rather than described: the sentence goes through the shipped
 * `createSignalProtocolClient`, a single bit of the stored envelope is turned
 * over on its way into the relay, and what the page prints afterwards is the
 * receiving device's own log — not a sentence someone wrote about what a
 * receiving device would say.
 *
 * Reading it from the log is not a stylistic choice. `onDecryptionError` is
 * documented as "called when decryption fails" and would be the obvious place
 * to render from, but on the relay path it never fires: the relay subscription
 * routes a failure into its own retry machinery, and the hook is reached only
 * from the manual `decryptMessage` and `decryptMessages` calls. An earlier
 * draft of this scenario registered it, got an empty callback list, and would
 * have shipped a page that showed nothing at the moment it had the most to
 * show. The `ILogger` the SDK accepts per client is the surface that actually
 * carries this, so that is what the driver hands over and what this reads.
 *
 * Only the first delivery is corrupted, and that is what makes the scenario
 * terminate. Corrupting every delivery is also a true picture of a permanently
 * hostile network, but the receiving device answers a failure by archiving the
 * session and asking the sender to try again — so a wrapper that flips
 * everything produces an unbounded retry loop, and a reader watching a demo
 * that never settles learns less than one watching it fail and then recover.
 * One flip tells the whole story: refused, reported, re-requested, and the
 * sentence arrives intact on the second attempt.
 */

/* demo:code:start */
import type { Envelope } from '@open-e2ee/signal-protocol-sdk';
import { startDemoSession } from '../driver.ts';
/* demo:code:end */
import { captureScenarioLog, type ScenarioLogRecord } from './log.ts';

export { describePayload } from './log.ts';

/** Where the byte went over, in the envelope the relay was handed. */
export interface FlipRecord {
  /** Index into the decoded ciphertext. */
  at: number;
  /** How many decoded bytes there were. */
  of: number;
  before: number;
  after: number;
}

/** The SDK's own name for what went wrong, lifted from the record carrying it. */
export interface Refusal {
  errorCode: string;
  errorMessage: string;
}

export interface FlipAByteResult {
  sentence: string;
  flip: FlipRecord;
  /** What the *sender* was told. It is a success, which is half the point. */
  accepted: { messageId: string; recipientDeviceCount: number } | null;
  /** Named by the receiving device, or `null` if it never named one. */
  refusal: Refusal | null;
  /** Every record at info and above, from both devices, in the order logged. */
  records: ScenarioLogRecord[];
  /** How many records the SDK emitted at debug, which this does not print. */
  debugRecords: number;
  /**
   * The plaintext that reached the receiving device's `onMessageDecrypted`
   * hook, or `null` if nothing ever did.
   */
  delivered: string | null;
  /** Pressing send until the sentence arrived, across the failure and the retry. */
  roundTripMs: number | null;
}

/* A sentence with a shape a reader can check at a glance: if a single flipped
   byte could produce plausible-looking plaintext, this is where it would show. */
const SENTENCE = 'Meet me at the north gate at 21:00. Bring the second key.';

/*
 * How long the recovery is given before the scenario calls it a failure.
 *
 * The retry is the SDK's own, and the whole run measured in tens of
 * milliseconds on the machine this was written on. The wait exists because the
 * alternative to a bound is a spinner: `send()` resolves only once the
 * receiving device has decrypted something, so a change that stopped the resend
 * from succeeding would leave the page waiting for a promise that will never
 * settle, with no failure for anyone to see. Ten seconds is far past any real
 * answer and far short of a reader's patience.
 */
const RECOVERY_TIMEOUT_MS = 10000;

/*
 * The SDK names its failures in a `data` object, and does not always put it at
 * the same depth — some records pass it directly and some wrap it under a
 * `data` key beside a category. Rather than pin one shape, look for the two
 * keys wherever they are: what this is trying to print is the SDK's own words,
 * and reaching them through a hard-coded path would mean printing nothing the
 * day the wrapper changed.
 */
function findRefusal(value: unknown, depth = 0): Refusal | null {
  if (depth > 3 || typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.errorCode === 'string' && typeof record.errorMessage === 'string') {
    return { errorCode: record.errorCode, errorMessage: record.errorMessage };
  }
  for (const nested of Object.values(record)) {
    const found = findRefusal(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Base64 in, bytes out. Both devices and the relay are in this tab, so this
    is the same encoding the envelope already carries. */
function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Those bytes read as base64 text, or `null` if they are not base64 text. */
function asBase64Text(bytes: Uint8Array): string | null {
  let text = '';
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) return null;
    text += String.fromCharCode(byte);
  }
  return text.length % 4 === 0 && BASE64.test(text) ? text : null;
}

/*
 * Down to the bytes the protocol actually authenticated, and back.
 *
 * `envelope.ciphertext` is not the ciphertext: it is base64 of a string that is
 * itself base64, because the transport encodes what the protocol had already
 * encoded. Flipping a byte of the outer form therefore flips a *character* of
 * the inner one. The flip turns over the low bit, and 6 of the alphabet's 64
 * characters have their low-bit partner outside it — `+`, `/`, `A`, `Z`, `a`
 * and `z` — so 6/64 = 9.4% of the time, about one press in eleven, the flipped
 * character is not base64 at all and the inner decoder rejects the message
 * before the MAC is ever checked. The page then reports a parse error where it
 * promised an authentication failure. Both are the protocol refusing corrupt
 * input, but only one is the thing this scenario claims to show, and a demo
 * that shows a different failure on a tenth of its presses is not evidence of
 * anything.
 *
 * So peel the encoding off, corrupt the real ciphertext, and put the encoding
 * back. The depth is discovered rather than assumed, and then checked against
 * what this SDK does — because those are two different things and only the
 * second one fails loudly. `asBase64Text` recognises exactly the padded
 * standard alphabet: an inner layer that became base64url, or unpadded, would
 * not be recognised, `peel` would stop one layer short, and the scenario would
 * go straight back to flipping encoding characters with nothing to say so. The
 * discovery is what keeps this correct if the depth changes; the assertion is
 * what stops it being silently wrong if the *alphabet* does.
 */
const WRAPS = 2;

function peel(ciphertext: string): { bytes: Uint8Array; layers: number } {
  let bytes = decode(ciphertext);
  let layers = 1;
  for (;;) {
    const text = asBase64Text(bytes);
    if (text === null) break;
    bytes = decode(text);
    layers += 1;
  }
  if (layers !== WRAPS) {
    throw new Error(
      `the envelope's ciphertext unwrapped to ${layers} base64 layer(s), not ${WRAPS} — this ` +
        `scenario would be corrupting an encoding rather than the ciphertext the MAC covers, ` +
        `and would report a parse error as if it were an authentication failure`,
    );
  }
  return { bytes, layers };
}

function wrap(bytes: Uint8Array, layers: number): string {
  let encoded = encode(bytes);
  for (let layer = 1; layer < layers; layer += 1) {
    encoded = encode(Uint8Array.from(encoded, (character) => character.charCodeAt(0)));
  }
  return encoded;
}

export async function runFlipAByte(): Promise<FlipAByteResult> {
  /* One logger per device, each tagging its own records, so the printed log can
     say which of the two spoke. */
  const log = captureScenarioLog();

  let flip: FlipRecord | null = null;

  /* demo:code:start */
  const session = await startDemoSession({
    logger: { sender: log.for('sender'), recipient: log.for('recipient') },

    /* The hostile bit, and all of it. One byte of the first envelope the relay
       is handed goes over by one; every later envelope passes through
       untouched, which is what lets the SDK's own retry finish the story.

       `peel` and `wrap` take the transport's base64 off and put it back, so
       the bit that moves is a bit of the ciphertext the MAC covers rather than
       a character of its encoding. */
    tamper: (envelope: Envelope): Envelope => {
      if (flip) return envelope;
      if (typeof envelope.ciphertext !== 'string') {
        throw new Error('the envelope carried raw bytes, not base64 — this scenario flips base64');
      }
      const { bytes, layers } = peel(envelope.ciphertext);
      const at = Math.floor(bytes.length / 2);
      const before = bytes[at];
      bytes[at] ^= 0b0000_0001;
      flip = { at, of: bytes.length, before, after: bytes[at] };
      return { ...envelope, ciphertext: wrap(bytes, layers) };
    },
  });

  /* What the sender was told, taken as it happens rather than at the end. The
     acknowledgement is the scenario's other half — a corrupted message the
     sender is told went through — and it must survive a run where the
     recovery does not. */
  let accepted: FlipAByteResult['accepted'] = null;
  session.on((event) => {
    if (event.type === 'message-sent') {
      accepted = {
        messageId: event.result.messageId,
        recipientDeviceCount: event.result.recipientDeviceCount,
      };
    }
  });

  /* `send()` resolves when the receiving device has plaintext — which, on this
     run, is after it refused the first copy and asked for another. The race is
     the failure state: nothing else here would ever stop waiting. */
  const exchange = await Promise.race([
    session.send(SENTENCE),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), RECOVERY_TIMEOUT_MS)),
  ]);
  /* demo:code:end */

  try {
    if (!flip) {
      throw new Error(
        'no envelope was ever handed to the relay, so nothing was corrupted and this run ' +
          'proves nothing',
      );
    }

    /* The first record that names a failure, wherever the SDK put it. There is
       no fallback prose if none does: a scenario that invented a refusal the
       protocol did not report would be the one lie this page cannot afford. */
    let refusal: Refusal | null = null;
    for (const record of log.records) {
      for (const payload of record.payload) {
        refusal ??= findRefusal(payload);
      }
    }

    return {
      sentence: SENTENCE,
      flip,
      accepted,
      refusal,
      records: log.records,
      debugRecords: log.debugRecords,
      delivered: exchange?.decrypted.content ?? null,
      roundTripMs: exchange?.roundTripMs ?? null,
    };
  } finally {
    /* Every run boots its own pair of devices, so every run has to put them
       away. The scenario cannot reuse a session: the receiving device archives
       the one it has the moment a message fails on it, and a second run needs
       a fresh identity anyway for the log it prints to be about this run. */
    await session.stop();
  }
}
