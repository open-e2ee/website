/*
 * The driver is what the homepage panel, /demo, and the two-tab relay will all
 * run. It composes the installed package's public API and nothing else — no
 * fork, no shim, no re-typed constant (invariant 1) — so these tests do a real
 * PQXDH handshake and a real Double Ratchet round trip against real
 * `inMemoryStore()` and `inMemoryRelay()` adapters. Nothing here is stubbed:
 * the whole value of the demo is that the cryptography is the shipped
 * cryptography, and a test that mocked it would be checking a story.
 *
 * The load-bearing assertion is the envelope one. The recorded panel already
 * paid for a hand-kept field list that drifted ten fields to six "in the
 * direction that flatters us" — so invariant 4 requires the metadata pane to
 * derive from the live object. That is only worth something if the object the
 * driver hands over really is the row the relay held, so the test checks its
 * field names against the `Envelope` interface in the installed package's own
 * declarations, the same way `site-content.test.mjs` checks the recording.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { startDemoSession } from '../src/lib/demo/driver.ts';

const PROBE = 'Ship it Thursday. The staging key rotates at 09:00 UTC.';

/** Field names the installed `Envelope` declares, read rather than typed. */
const declaredEnvelopeFields = await (async () => {
  const types = await readFile(
    new URL(
      '../node_modules/@open-e2ee/signal-protocol-sdk/dist/remote/relay/types.d.ts',
      import.meta.url,
    ),
    'utf8',
  );
  const block = types.match(/export interface Envelope \{[\s\S]*?\n\}/);
  assert.ok(block, 'no Envelope interface in the installed type declarations');
  return new Set(
    block[0]
      .split('\n')
      .map((line) => line.match(/^\s+(\w+)\??\s*:/))
      .filter(Boolean)
      .map((match) => match[1]),
  );
})();

/** Boot once per test and always tear down, subscription included. */
async function withSession(run) {
  const session = await startDemoSession();
  try {
    return await run(session);
  } finally {
    await session.stop();
  }
}

test('boots two clients over the in-memory adapters and times the handshake', async () => {
  await withSession((session) => {
    assert.equal(session.sender, 'alice');
    assert.equal(session.recipient, 'bob');

    /* The handshake is the expensive half and the number LD2 prints. It is
     * read off a `performance` measure, not off a Date subtraction, so the
     * figure on the page is the one in the reader's own Performance panel. */
    assert.ok(session.bootMs > 0, 'the handshake reported no elapsed time');
    assert.equal(performance.getEntriesByName('oe-demo:boot', 'measure').length, 1);
  });
});

test('round-trips a typed sentence through the real protocol', async () => {
  await withSession(async (session) => {
    const exchange = await session.send(PROBE);

    assert.equal(exchange.decrypted.content, PROBE);
    assert.equal(exchange.decrypted.senderId, 'alice');
    assert.equal(exchange.text, PROBE);
    assert.ok(exchange.roundTripMs > 0);
    assert.ok(exchange.encryptMs > 0);
  });
});

test('hands over the live envelope the relay held, not a description of it', async () => {
  await withSession(async (session) => {
    const { envelope } = await session.send(PROBE);

    /* Every key has to be a real field of the shipped Envelope. A release that
     * renames one fails here rather than leaving LD2's metadata pane rendering
     * a label the package no longer uses. */
    for (const field of Object.keys(envelope)) {
      assert.ok(
        declaredEnvelopeFields.has(field),
        `the driver surfaced "${field}", which is not on Envelope in the installed package`,
      );
    }

    /* LD0 measured ten fields on this envelope. The pane derives from whatever
     * is there, so the floor is what matters: fewer than ten means the demo
     * quietly started showing less than the recording it replaces. */
    const populated = Object.keys(envelope).filter((field) => envelope[field] !== undefined);
    assert.ok(
      populated.length >= 10,
      `the relay row lost fields — ${populated.length} populated: ${populated.join(', ')}`,
    );
    for (const field of ['targetUserId', 'senderUserId', 'ciphertext', 'messageType', 'id']) {
      assert.ok(populated.includes(field), `the relay row is missing ${field}`);
    }

    assert.equal(envelope.targetUserId, 'bob');
    assert.equal(envelope.senderUserId, 'alice');
    assert.equal(envelope.messageType, 'prekey_bundle');
  });
});

test('gives the relay ciphertext and nothing readable', async () => {
  await withSession(async (session) => {
    const { envelope } = await session.send(PROBE);
    const ciphertext =
      typeof envelope.ciphertext === 'string'
        ? envelope.ciphertext
        : Buffer.from(envelope.ciphertext).toString('base64');

    assert.ok(ciphertext.length > 1000, 'the ciphertext is too short to be the message');
    assert.doesNotMatch(ciphertext, /Thursday/);
    assert.equal(ciphertext.includes(Buffer.from(PROBE).toString('base64')), false);

    /* The whole envelope, not just the payload: a field carrying the sentence
     * in cleartext would be the exact leak the panel invites readers to look
     * for in their own network tab. */
    assert.equal(JSON.stringify(envelope).includes('Thursday'), false);
  });
});

test('reports each stage of the pipeline as it happens', async () => {
  await withSession(async (session) => {
    const events = [];
    session.on((event) => events.push(event));

    await session.send(PROBE);

    const types = events.map((event) => event.type);
    for (const type of ['message-sent', 'envelope-stored', 'message-decrypted']) {
      assert.ok(types.includes(type), `no ${type} event — saw ${types.join(', ')}`);
    }

    /* The stored event carries the same object the caller was handed, because
     * there is one envelope and both routes must show it. */
    const stored = events.find((event) => event.type === 'envelope-stored');
    assert.equal(stored.envelope.senderUserId, 'alice');

    const decrypted = events.find((event) => event.type === 'message-decrypted');
    assert.equal(decrypted.message.content, PROBE);
    assert.ok(decrypted.roundTripMs > 0);
  });
});

test('stops delivering to a listener that unsubscribed', async () => {
  await withSession(async (session) => {
    const events = [];
    const off = session.on((event) => events.push(event));
    off();
    await session.send(PROBE);
    assert.deepEqual(events, []);
  });
});

test('carries a second message on the established session', async () => {
  await withSession(async (session) => {
    const first = await session.send(PROBE);
    const second = await session.send('And the second one, on the ratchet.');

    assert.equal(second.decrypted.content, 'And the second one, on the ratchet.');

    /* Two distinct rows, which is the thing that would break if the driver
     * only ever caught the first envelope: the receiving client is subscribed
     * for the whole session, so every send after the first has to be read from
     * a relay that is already delivering. */
    assert.notEqual(first.envelope.id, second.envelope.id);

    /* Both are still session-opening messages, and that is correct rather than
     * a bug worth hiding. The sender has no evidence the recipient processed
     * the first one until the recipient answers, so it keeps attaching the
     * prekey bundle; a reply flips the direction to `ciphertext` and the next
     * outbound message with it. Verified against the installed package by
     * sending one-two-reply-three and reading the relay:
     * prekey_bundle, prekey_bundle, ciphertext, ciphertext. */
    assert.equal(first.envelope.messageType, 'prekey_bundle');
    assert.equal(second.envelope.messageType, 'prekey_bundle');
  });
});

/*
 * The regression this exists for, in the shape it actually took.
 *
 * `exchange()` used to drain its pending-envelope queue with `shift()`, on the
 * reading that an envelope could arrive before the wait was installed. It
 * cannot. What does arrive outside a send is a *second* envelope for a send
 * that already resolved: a message that fails to decrypt makes the receiving
 * device archive the session and ask the sender to send it again, and that
 * resend lands after `onEnvelope` has been cleared. `shift()` then handed the
 * stale envelope to the next send, which reported the previous sentence's
 * ciphertext as its own.
 *
 * No scenario before `/demo` ever produced a second envelope outside a send, so
 * the whole suite stayed green with the bug in place. The corruption here is
 * deliberately blunt — a replacement ciphertext rather than a flipped byte,
 * because this test is about the driver's bookkeeping and not about which error
 * the protocol names.
 */
test('reports the envelope its own send produced, not one a retry left behind', async () => {
  const handed = [];
  let corrupted = false;

  /* A failed decryption is a loud event, and the SDK's default logger writes
     it to the console. Silencing it keeps a passing suite from printing what
     looks like a stack of failures; nothing here asserts on the log. */
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };

  const session = await startDemoSession({
    logger: { sender: quiet, recipient: quiet },
    tamper: (envelope) => {
      handed.push(envelope.ciphertext);
      if (corrupted) return envelope;
      corrupted = true;
      return { ...envelope, ciphertext: btoa(btoa('not the ciphertext you were looking for')) };
    },
  });

  try {
    await session.send(PROBE);
    const second = await session.send('And the second one, after the retry.');

    /* Three envelopes: the corrupted first, the resend the receiving device
       asked for, and this send's own. The middle one is the one that used to
       be handed back here. */
    assert.equal(handed.length, 3, `the retry did not happen: ${handed.length} envelope(s)`);
    assert.equal(second.decrypted.content, 'And the second one, after the retry.');

    /* Compared by position rather than by value: these are 3.5 KB base64
       strings, and an equality failure would print two of them where one
       number says the whole thing. */
    const reported = handed.indexOf(second.envelope.ciphertext);
    assert.equal(
      reported,
      handed.length - 1,
      `the second send reported envelope ${reported + 1} of ${handed.length} as its own. ` +
        `Envelope 2 is the resend\n  the receiving device asked for when the first message ` +
        `failed — it carries the first sentence, and\n  a send that hands it back reports the ` +
        `previous message's ciphertext as this one's.`,
    );
  } finally {
    await session.stop();
  }
});

test('marks the timeline the browser Performance panel will show', async () => {
  await withSession(async (session) => {
    const before = performance.getEntriesByType('measure').length;
    const exchange = await session.send(PROBE);

    const measures = performance.getEntriesByType('measure').slice(before);
    const named = measures.map((entry) => entry.name);
    assert.ok(named.some((name) => name.startsWith('oe-demo:encrypt:')));
    assert.ok(named.some((name) => name.startsWith('oe-demo:round-trip:')));

    const roundTrip = measures.find((entry) => entry.name.startsWith('oe-demo:round-trip:'));
    assert.equal(roundTrip.duration, exchange.roundTripMs);
  });
});

test('names the participants it was asked for', async () => {
  const session = await startDemoSession({ sender: 'you', recipient: 'your other device' });
  try {
    const { envelope, decrypted } = await session.send(PROBE);
    assert.equal(envelope.senderUserId, 'you');
    assert.equal(envelope.targetUserId, 'your other device');
    assert.equal(decrypted.content, PROBE);
  } finally {
    await session.stop();
  }
});

test('rejects an empty send rather than posting an empty row', async () => {
  await withSession(async (session) => {
    await assert.rejects(() => session.send('   '), /empty/i);
  });
});
