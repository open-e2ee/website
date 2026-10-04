/*
 * Records `src/data/carrier-capture.json` by running two SDK clients.
 *
 * The carrier panel is the one exhibit on this site that shows rather than
 * states, and its whole value is that nothing in it was typed by hand. This
 * script is the recording path, committed, so "recorded by running the SDK"
 * is a command someone can run rather than a thing we say.
 *
 *   node scripts/record-carrier-capture.mjs
 *
 * It runs `PROGRAM` below against the installed SDK and the page relay in
 * `src/lib/demo/relay.ts`, reads the envelope the relay held, and writes the
 * JSON with the program text in it.
 *
 * Re-record when the program stops being true of the installed package: a
 * renamed identifier, a changed factory signature, a new envelope field. A
 * bump on its own does not need one, and `tests/site-content.test.mjs` is what
 * makes that safe — it checks every recorded field name against the installed
 * `Envelope` type, so a release that drops a field fails the build instead of
 * leaving the caption quietly false.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = new URL('.', import.meta.url);
const OUT = new URL('../src/data/carrier-capture.json', HERE);
const SDK = '@open-e2ee/signal-protocol-sdk';

/*
 * The recorded program.
 *
 * It drives both sides of the conversation in one process, against the
 * relay that also runs the live demo on the homepage. The SDK ships no relay
 * that runs offline, and the OpenE2EE Signal Protocol Relay needs a project
 * and an identity provider, so this site's relay is the one a committed
 * script can run. The client calls are the SDK's own; only the relay is the
 * site's.
 *
 * The panel's claim is about what a relay holds, and showing the row requires
 * a program that reads the queue before anything drains it. Hence the
 * `getPendingMessages` call where it is: after the send, before the
 * subscription starts.
 */
const PROGRAM = `import { createSignalProtocolClient } from "${SDK}";
import { inMemoryStore } from "${SDK}/local/store/memory";
import { pageRelay } from "../src/lib/demo/relay.ts";

const relay = pageRelay();
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

await alice.send("bob", "Dinner at 7. I got us the table by the window.");

// This is all the relay ever holds:
const [envelope] = relay.getPendingMessages("bob", 1);

bob.registerHook("onMessageDecrypted", async (message) => {
  console.log(message.content); // plaintext, only on Bob's device
});
bob.startRelaySubscription();`;

/** The plaintext the program sends, and the device pane's whole content. */
const PLAINTEXT = 'Dinner at 7. I got us the table by the window.';

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
  deliveryClass:
    'How the relay stores the envelope and whether it wakes the device. The SDK sets it from the kind of content: user-visible, background-sync, or ephemeral. It is in the clear, so the relay learns which of the three each envelope is.',
  timestamp:
    'Client timestamp set by the sender before encryption, used for retry matching and receipt correlation. Protocol-level.',
  serverTimestamp: 'Assigned by the relay on accept. Real relays assign this too.',
  clientMessageId:
    'Sender-generated send id, a UUID, so a retry after an unknown result is recognized as the same send rather than stored twice. Set before encryption. The relay reads it to deduplicate, so it stays visible under sealed sender.',
  id: "Relay-assigned envelope id. The msg-N form is this site's relay counting sends; a production relay assigns its own id format.",
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
 * that what executes is the recorded text plus a line that cannot change what
 * the recorded text does. The file is written to a temporary directory at the
 * repository root for two reasons: Node resolves the SDK's bare specifier by
 * walking up from the importing file, and Node strips the types of the site's
 * `relay.ts` only outside `node_modules`.
 */
async function run() {
  const repo = fileURLToPath(new URL('../', HERE));
  const dir = await mkdtemp(join(repo, '.carrier-capture-'));
  const file = join(dir, 'quickstart.mjs');
  try {
    await writeFile(file, `${PROGRAM}\n\nexport { envelope };\n`);
    const { envelope } = await import(pathToFileURL(file).href);
    if (!envelope) throw new Error('the relay held no envelope — the program did not send');
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
 * envelope object can carry the key with an `undefined` value, and JSON
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
