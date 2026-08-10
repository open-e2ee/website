/*
 * `run.ts` is the two-device demo's engine: two clients, one relay, one
 * recording. Like `driver.ts` it composes the installed package and nothing
 * else — real PQXDH, real Double Ratchet, real `inMemoryStore()` and
 * `inMemoryRelay()` — so nothing here is stubbed. A test that mocked the
 * cryptography would be checking a story, and the whole value of the demo is
 * that it is not one.
 *
 * Three things are load-bearing here and none of them are "it round-trips".
 *
 * The first is that the key agreement is a step of its own. The old figure's
 * caption claimed the first `send()` ran PQXDH and returned ciphertext in one
 * call, which is what a demo that never calls `establishSession` is forced to
 * say. `exchangeKeys()` makes it a real call against a real fetched bundle, and
 * these tests check the session exists before any message does.
 *
 * The second is the two clocks. `trace.cues()` is what the paced half of the
 * page reads, and it must carry no measurement — not by convention but because
 * there is none in it to read. Checked structurally below rather than trusted.
 *
 * The third is symmetry. The reply leg is a real send from the other device
 * with its own measurements, not the first leg drawn backwards.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { inMemoryRelay } from '@open-e2ee/signal-protocol-sdk/remote/relay/memory';
import { startDemoRun } from '../src/lib/demo/run.ts';
import { STEPS } from '../src/lib/demo/trace.ts';

const OUTBOUND = 'Ship it Thursday. The staging key rotates at 09:00 UTC.';
const REPLY = 'Acknowledged. I will hold the rotation until the deploy is green.';

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

/**
 * The real in-memory relay, made to behave like one that has to cross something.
 *
 * `inMemoryRelay()` hands each envelope to its subscriber inside `send()`, a
 * property no relay over a socket or a network has. Everything real stays —
 * real storage, real prekey consumption — and only the moment of delivery moves
 * to after the send resolves. That one difference is the whole of what the
 * envelope slot below has to survive, and it is exactly what a run against the
 * plain relay cannot reach.
 *
 * `subscribe` is wrapped rather than replaced, and its unsubscribe function is
 * returned synchronously: `subscribe` and `subscribeRetryRequests` both hand
 * back a function rather than a promise of one, and a client given a promise
 * instead fails much later, inside `stop()`.
 */
function relayThatDeliversLate({ deliverAfterMs = 50 } = {}) {
  const relay = inMemoryRelay();
  const subscribe = relay.subscribe.bind(relay);
  relay.subscribe = (userId, deviceId, onEnvelope, options) =>
    subscribe(
      userId,
      deviceId,
      (envelope) => {
        setTimeout(() => onEnvelope(envelope), deliverAfterMs).unref?.();
      },
      options,
    );
  return relay;
}

/**
 * Turn a hang into a failure, so a regression reports itself.
 *
 * A closed envelope slot produces no error and no rejection — the send simply
 * never resolves. Without a tripwire that shows up as a test run that stops,
 * ten seconds later, with nothing saying which line stopped it.
 */
function failsIfSlow(promise, ms, message) {
  let timer;
  const tripwire = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, tripwire]).finally(() => clearTimeout(timer));
}

/** Boot once per test and always tear down, subscriptions included. */
async function withRun(body, options) {
  const run = await startDemoRun(options);
  try {
    return await body(run);
  } finally {
    await run.stop();
  }
}

/** The steps recorded, in the order they were recorded. */
const stepsOf = (run) => run.trace.events.map((event) => event.step);

test('boots two devices and records each one coming up', async () => {
  await withRun((run) => {
    assert.equal(run.userId('a'), 'alice');
    assert.equal(run.userId('b'), 'bob');

    const ready = run.trace.events.filter((event) => event.step === 'devices-ready');
    assert.deepEqual(
      ready.map((event) => event.actor),
      ['a', 'b'],
      'both devices should report themselves ready, left then right',
    );
    /* Measured per device rather than once for the pair, because the metrics
       sit under each column and a shared number under both would be one
       number pretending to be two. */
    for (const event of ready) {
      assert.ok(event.measures.bootMs > 0, `${event.actor} reported no boot time`);
    }
  });
});

test('exchangeKeys publishes both bundles and establishes a real session', async () => {
  await withRun(async (run) => {
    const before = await run.client('a').hasSession({ userId: 'bob', deviceId: 1 });
    assert.equal(before, false, 'a session existed before any key agreement');

    await run.exchangeKeys();

    const after = await run.client('a').hasSession({ userId: 'bob', deviceId: 1 });
    assert.equal(after, true, 'establishSession left no session behind');

    const published = run.trace.events.filter((event) => event.step === 'bundles-published');
    assert.deepEqual(
      new Set(published.map((event) => event.actor)),
      new Set(['a', 'b']),
      'both accounts must publish, because either may be spoken to first',
    );

    const established = run.trace.events.filter((event) => event.step === 'session-established');
    assert.equal(established.length, 1, 'the key agreement happened once');
    assert.equal(established[0].from, 'a');
    assert.equal(established[0].to, 'b');
    assert.ok(established[0].measures.establishMs >= 0);

    /* The whole point of the explicit step: no message has been sent, and the
       session is already there. A demo that cannot show this is the demo that
       had to claim the first send does the handshake. */
    assert.equal(
      stepsOf(run).includes('encrypted'),
      false,
      'a message was sent during key agreement',
    );
  });
});

test('sends without exchangeKeys still record the key agreement', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);

    const steps = stepsOf(run);
    assert.ok(
      steps.indexOf('session-established') < steps.indexOf('encrypted'),
      'the session must be agreed before the first ciphertext exists, whether or not ' +
        'the reader pressed the button',
    );
  });
});

test('round-trips a sentence and records every step in protocol order', async () => {
  await withRun(async (run) => {
    const sent = await run.send('a', OUTBOUND);

    assert.equal(sent.decrypted.content, OUTBOUND);
    assert.equal(sent.decrypted.senderId, 'alice');
    assert.equal(sent.from, 'a');
    assert.equal(sent.to, 'b');
    assert.ok(sent.encryptMs > 0);
    assert.ok(sent.roundTripMs > 0);

    /* Checked against `STEPS` rather than against a list typed out here, so
       the order this asserts is the order the module declares. */
    const recorded = stepsOf(run).filter((step) => step !== 'devices-ready');
    const ranks = recorded.map((step) => STEPS.indexOf(step));
    assert.deepEqual(
      ranks,
      [...ranks].sort((x, y) => x - y),
      `the recording is out of protocol order: ${recorded.join(' → ')}`,
    );
    for (const step of ['bundles-published', 'session-established', 'encrypted', 'in-transit',
      'stored-at-relay', 'delivered', 'opened']) {
      assert.ok(recorded.includes(step), `no ${step} step was recorded`);
    }
  });
});

test('hands over the live envelope the relay held, not a description of it', async () => {
  await withRun(async (run) => {
    const sent = await run.send('a', OUTBOUND);
    const stored = run.trace.events.find((event) => event.step === 'stored-at-relay');

    assert.equal(stored.detail.envelope, sent.envelope, 'the trace copied the envelope');
    for (const field of Object.keys(sent.envelope)) {
      assert.ok(
        declaredEnvelopeFields.has(field),
        `envelope field ${field} is not declared by the installed package`,
      );
    }
    /* Measured off the real bytes rather than off the base64 the field holds:
       `ciphertext.ts` peels the double encoding, and the number under the
       relay column is what the relay is actually storing. */
    assert.ok(stored.measures.ciphertextBytes > 0);
  });
});

test('the reply is a real send from the other device, not the first drawn backwards', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);
    const reply = await run.send('b', REPLY);

    assert.equal(reply.decrypted.content, REPLY);
    assert.equal(reply.decrypted.senderId, 'bob');
    assert.equal(reply.from, 'b');
    assert.equal(reply.to, 'a');

    const opened = run.trace.events.filter((event) => event.step === 'opened');
    assert.deepEqual(
      opened.map((event) => [event.from, event.to]),
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
      'the two legs must travel in opposite directions',
    );
    /* Two envelopes, each with its own bytes. One envelope reused would show
       up as the same object twice. */
    const stored = run.trace.events.filter((event) => event.step === 'stored-at-relay');
    assert.equal(stored.length, 2);
    assert.notEqual(stored[0].detail.envelope, stored[1].detail.envelope);

    /* Bob never called `establishSession`: the reply leg's session came out of
       the incoming prekey message, which is how the protocol really works and
       is why `ensureSession` asks the SDK instead of keeping a flag. */
    const established = run.trace.events.filter((event) => event.step === 'session-established');
    assert.equal(
      established.length,
      1,
      'the reply leg agreed a second key, so it did not use the session it was given',
    );
  });
});

test('cues carry no measurement at all', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);

    const cues = run.trace.cues();
    assert.equal(cues.length, run.trace.events.length, 'a step went missing on the way to playback');

    /* Structural, not a spot check. The playback layer is typed against these,
       so if a number can reach it at all then "playback cannot alter a
       measurement" is a promise rather than a fact. */
    for (const cue of cues) {
      assert.deepEqual(
        Object.keys(cue).filter((key) => !['step', 'actor', 'from', 'to'].includes(key)),
        [],
        `a cue carried ${JSON.stringify(cue)}`,
      );
      for (const value of Object.values(cue)) {
        assert.equal(typeof value, 'string', 'a cue carried a non-string field');
      }
    }
  });
});

test('reset forgets the conversation and boots fresh devices', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);
    const firstClient = run.client('a');

    await run.reset();

    assert.deepEqual(
      stepsOf(run),
      ['devices-ready', 'devices-ready'],
      'the recording kept something from the run before the reset',
    );
    assert.notEqual(run.client('a'), firstClient, 'reset reused the old client');
    assert.equal(
      await run.client('a').hasSession({ userId: 'bob', deviceId: 1 }),
      false,
      'the fresh device inherited the old session',
    );

    /* And it still works afterwards, which is the failure mode a reset that
       tore down more than it rebuilt would have. */
    const sent = await run.send('a', OUTBOUND);
    assert.equal(sent.decrypted.content, OUTBOUND);
  });
});

test('subscribers on the trace survive a reset', async () => {
  await withRun(async (run) => {
    const seen = [];
    run.trace.on((event) => seen.push(event.step));

    await run.reset();
    await run.send('a', OUTBOUND);

    assert.ok(
      seen.includes('opened'),
      'the page stopped hearing about the run when the reader pressed reset',
    );
  });
});

test('survives a relay that delivers after the send has resolved', async () => {
  await withRun(
    async (run) => {
      const sent = await failsIfSlow(
        run.send('a', OUTBOUND),
        4_000,
        'the send never resolved: the envelope arrived to a slot that had already been cleared',
      );
      assert.equal(sent.decrypted.content, OUTBOUND);

      /* And the recording is still complete. A late envelope that was merely
         waited out would leave the relay's own step missing. */
      const stored = run.trace.events.filter((event) => event.step === 'stored-at-relay');
      assert.equal(stored.length, 1);
    },
    { relay: () => relayThatDeliversLate() },
  );
});

test('refuses an empty message rather than sending one', async () => {
  await withRun(async (run) => {
    await assert.rejects(() => run.send('a', '   '), /nothing to send/);
  });
});
