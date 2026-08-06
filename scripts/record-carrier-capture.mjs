/*
 * Records `src/data/carrier-capture.json` by running the quickstart.
 *
 * The carrier panel is the one exhibit on this site that shows rather than
 * states, and its whole value is that nothing in it was typed by hand. That
 * held for the data and did not hold for the act of recording it: the capture
 * was produced once, out of band, and every claim about where it came from was
 * a sentence in a comment. A reader could check the ciphertext looked like
 * ciphertext and could not check anything else. This script is the missing
 * half — the recording path, committed, so "recorded by running the quickstart"
 * is a command someone can run rather than a thing we say.
 *
 *   node scripts/record-carrier-capture.mjs
 *
 * It runs `PROGRAM` below against the installed SDK, reads the envelope the
 * relay actually held, and writes the JSON. The same string is what /product
 * renders as the recorded file, so the code on the page cannot drift from the
 * code that produced the row beneath it — there is one copy and it is executed.
 *
 * Re-record when the program stops being true of the installed package: an
 * identifier rename (alpha.10 moved both adapters off the word "mock"), a
 * changed factory signature, a new envelope field. A bump on its own does not
 * need one, and `tests/site-content.test.mjs` is what makes that safe — it
 * checks every recorded field name against the installed `Envelope` type, so a
 * release that drops a field fails the build instead of leaving the caption
 * quietly false.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = new URL('.', import.meta.url);
const OUT = new URL('../src/data/carrier-capture.json', HERE);
const SDK = '@open-e2ee/signal-protocol-sdk';

/*
 * The quickstart, exactly as /product publishes it.
 *
 * It drives both sides of the conversation in one process, which an
 * application does not do — that difference is what `src/lib/hero-snippet.mjs`
 * exists to explain, and it is deliberate here. The panel's claim is about
 * what a relay holds, and showing the row requires a program that reads the
 * queue before anything drains it. Hence the `getPendingMessages` call sitting
 * where it does: after the send, before the subscription starts.
 */
const PROGRAM = `import { createSignalProtocolClient } from "${SDK}";
import { inMemoryStore } from "${SDK}/local/store/memory";
import { inMemoryRelay } from "${SDK}/remote/relay/memory";

const relay = inMemoryRelay();
await relay.registerDevice("alice", { encryptedDeviceName: new ArrayBuffer(0) });
await relay.registerDevice("bob", { encryptedDeviceName: new ArrayBuffer(0) });

const alice = await createSignalProtocolClient({
  identity: { userId: "alice" },
  adapters: { storage: inMemoryStore(), relay },
});
const bob = await createSignalProtocolClient({
  identity: { userId: "bob" },
  adapters: { storage: inMemoryStore(), relay },
});

await alice.syncToServer();
await bob.syncToServer();

await alice.send("bob", "Ship it Thursday. The staging key rotates at 09:00 UTC.");

// This is all the relay ever holds:
const [envelope] = relay.getPendingMessages("bob", 1);

bob.registerHook("onMessageDecrypted", async (message) => {
  console.log(message.content); // plaintext, only on Bob's device
});
bob.startRelaySubscription();`;

/** The plaintext the program sends, and the device pane's whole content. */
const PLAINTEXT = 'Ship it Thursday. The staging key rotates at 09:00 UTC.';

/*
 * What each envelope field is, in the site's own voice.
 *
 * The values are never written here — they come from the envelope — but the
 * explanation of a field is editorial and cannot be recorded. Keying them by
 * field name and failing on a field with no note is what stops the panel from
 * silently gaining an unexplained row, or from losing an explained one to a
 * rename nobody noticed.
 */
const NOTES = {
  targetUserId:
    'Recipient account the relay must route to. Protocol/relay-level: any real relay needs this to deliver.',
  targetDeviceId:
    "Which of the recipient's registered devices this copy is for. Each device gets its own separately encrypted envelope.",
  senderUserId:
    'Sender account, visible on the identified-delivery path. Sealed sender replaces this with an empty string and messageType unidentified_sender.',
  senderDeviceId: 'Sender device. Also blanked (0) under sealed sender.',
  messageType:
    'Outer envelope type only. prekey_bundle means this is the session-establishing X3DH/PQXDH message; later messages in the session carry ciphertext.',
  timestamp:
    'Client timestamp set by the sender before encryption, used for retry matching and receipt correlation. Protocol-level.',
  serverTimestamp: 'Assigned by the relay on accept. Real relays assign this too.',
  clientMessageId:
    'Sender-generated send id, a UUID, so a retry after an unknown result is recognised as the same send rather than stored twice. Set before encryption, and the relay must be able to read it to deduplicate — including under sealed sender, where it is the one field that is not anonymous.',
  id: 'Relay-assigned envelope id. The msg-N form is the in-memory relay counting sends; a production relay assigns its own id format.',
  recipientRegistrationId:
    'Recipient device registration id, sent so the relay/recipient can detect a device reinstall. Present only on prekey_bundle envelopes. Protocol-level.',
  contentHint:
    'How the recipient should behave if this message fails to decrypt — RESENDABLE means it is content worth requesting again, rather than a typing indicator to discard. It says nothing about what the content is.',
  ciphertext: (chars) =>
    `The only payload field. Opaque to the relay: ${chars} base64 characters, no plaintext, no message length in cleartext beyond the ciphertext size itself.`,
};

/*
 * Run the program and hand back the envelope it read.
 *
 * The one thing added to it is an `export`, appended rather than woven in, so
 * that what executes is the published text plus a line that cannot change what
 * the published text does. The file is written under `node_modules/.cache`
 * because the program imports the SDK by bare specifier, and Node resolves
 * those by walking up from the importing file — from anywhere outside this
 * tree the quickstart would not resolve at all.
 */
async function run() {
  const cache = fileURLToPath(new URL('../node_modules/.cache/', HERE));
  await mkdir(cache, { recursive: true });
  const dir = await mkdtemp(join(cache, 'carrier-capture-'));
  const file = join(dir, 'quickstart.mjs');
  try {
    await writeFile(file, `${PROGRAM}\n\nexport { envelope };\n`);
    const { envelope } = await import(pathToFileURL(file).href);
    if (!envelope) throw new Error('the relay held no envelope — the quickstart did not send');
    return envelope;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const manifest = JSON.parse(
  await readFile(new URL(`../node_modules/${SDK}/package.json`, HERE), 'utf8'),
);
const envelope = await run();

const ciphertext =
  typeof envelope.ciphertext === 'string'
    ? envelope.ciphertext
    : Buffer.from(envelope.ciphertext).toString('base64');

/*
 * Field order is the envelope's own, which is what makes CarrierPanel's "in
 * the order it recorded them" true rather than a description of a list someone
 * arranged. A field with no note stops the recording here: an unexplained row
 * on this panel is the failure it exists to prevent.
 *
 * An optional field the sender left unset is dropped rather than printed. The
 * envelope object carries the key with an `undefined` value — `clientMessageId`
 * and `contentHint` both arrive that way from a plain `send()` — and JSON
 * serialization drops those from `relayRecord` regardless, so keeping them
 * would put a row reading "undefined" on a panel whose claim is that it shows
 * what the relay held. It did not hold them.
 */
const metadataFields = Object.keys(envelope)
  .filter((field) => envelope[field] !== undefined)
  .map((field) => {
    const note = NOTES[field];
    if (!note) {
      throw new Error(
        `the envelope has a "${field}" field, and NOTES in this script does not explain it`,
      );
    }
    return {
      field,
      value: field === 'ciphertext' ? `${ciphertext.slice(0, 32)}...` : String(envelope[field]),
      note: typeof note === 'function' ? note(ciphertext.length) : note,
    };
  });

const capture = {
  sdkVersion: manifest.version,
  packageName: manifest.name,
  capturedAt: new Date().toISOString(),
  plaintext: PLAINTEXT,
  quickstartCode: PROGRAM,
  relayRecord: { ...envelope, ciphertext },
  ciphertext,
  ciphertextStringLength: ciphertext.length,
  ciphertextBytes: Buffer.from(ciphertext, 'base64').length,
  metadataFields,
};

await writeFile(OUT, `${JSON.stringify(capture, null, 2)}\n`);

console.log(
  `recorded ${capture.packageName}@${capture.sdkVersion}: ` +
    `${metadataFields.length} envelope fields, ${capture.ciphertextStringLength} base64 characters`,
);

/* The subscription started by the program is still running. */
process.exit(0);
