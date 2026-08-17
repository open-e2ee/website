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
import { createPlayback } from '../src/lib/demo/playback.ts';
import { startDemoRun } from '../src/lib/demo/run.ts';
import { STEPS } from '../src/lib/demo/trace.ts';

const OUTBOUND = 'Dinner at 7. I got us the table by the window.';
const REPLY = 'Acknowledged. I will hold the rotation until the deploy is green.';

/** Field names an interface declares, read out of the installed package. */
async function declaredFields(declarationPath, interfaceName) {
  const types = await readFile(
    new URL(`../node_modules/@open-e2ee/signal-protocol-sdk/${declarationPath}`, import.meta.url),
    'utf8',
  );
  const block = types.match(new RegExp(`export interface ${interfaceName} \\{[\\s\\S]*?\\n\\}`));
  assert.ok(block, `no ${interfaceName} interface in the installed type declarations`);
  return new Set(
    block[0]
      .split('\n')
      .map((line) => line.match(/^\s+(\w+)\??\s*:/))
      .filter(Boolean)
      .map((match) => match[1]),
  );
}

const declaredEnvelopeFields = await declaredFields(
  'dist/remote/relay/types.d.ts',
  'Envelope',
);
const declaredSelectionFields = await declaredFields(
  'dist/types/protocol-config.d.ts',
  'ProtocolSelectionEvent',
);

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

/**
 * Boot once per test and always tear down, subscriptions included.
 *
 * `startDemoRun()` hands back a relay and no devices: bringing one up is the
 * reader's own press, and the page has a button for each. Both presses happen
 * here, left then right, because every test below is about what a run does
 * once its devices are up. The cold start is covered on its own by the
 * activation tests, which call `startDemoRun()` directly.
 */
async function withRun(body, options) {
  const run = await startDemoRun(options);
  try {
    await run.activate('a');
    await run.activate('b');
    return await body(run);
  } finally {
    await run.stop();
  }
}

/** The steps recorded, in the order they were recorded. */
const stepsOf = (run) => run.trace.events.map((event) => event.step);

test('starts with a relay and no devices', async () => {
  const run = await startDemoRun();
  try {
    assert.deepEqual(stepsOf(run), [], 'the run recorded something before a device came up');
    for (const actor of ['a', 'b']) {
      assert.throws(
        () => run.client(actor),
        `${actor} had a client before anyone activated it`,
      );
    }
    /* The second press on a device that is already up is not a second boot.
       The button stays live on the page, and a reader who presses it twice
       must not get two registrations against one mailbox. */
    await run.activate('a');
    const client = run.client('a');
    await run.activate('a');
    assert.equal(run.client('a'), client, 'a second press rebuilt the device');
    assert.equal(
      stepsOf(run).filter((step) => step === 'devices-ready').length,
      1,
      'a second press recorded a second boot',
    );
  } finally {
    await run.stop();
  }
});

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

/*
 * Key generation is the longest thing the opening does, and until it is
 * recorded the page has nothing to draw over it but a curtain.
 *
 * What is asserted here is the shape a bar and a counter need — a per-device
 * run of reports, each carrying how many keypairs the SDK had finished at that
 * moment and how many it finished in the end — and not the figures themselves.
 * The batch sizes are the SDK's to change, and a test that pinned 201 would
 * fail the day it did, which is the day this drawing is still correct.
 */
test('records key generation as it happens, in counts a bar can be drawn from', async () => {
  await withRun((run) => {
    const generating = run.trace.events.filter((event) => event.step === 'generating-keys');
    assert.ok(
      generating.length > 0,
      'the run generated hundreds of keypairs and recorded nothing about doing it, so the ' +
        'reel has no generation step to show',
    );

    for (const actor of ['a', 'b']) {
      const reports = generating.filter((event) => event.actor === actor);
      assert.ok(reports.length > 0, `${actor} generated its keys without recording a report`);

      const counts = reports.map((event) => event.detail.keypairs);
      assert.deepEqual(
        counts,
        [...counts].sort((x, y) => x - y),
        `${actor}'s recorded keypair counts go backwards: ${counts.join(' → ')}`,
      );
      assert.ok(counts[0] > 0, `${actor}'s first report counts no keypair at all`);

      /* The denominator every one of them is drawn against. A report carrying
         a total it can exceed would draw a bar past the end of its track. */
      const totals = new Set(reports.map((event) => event.detail.total));
      assert.equal(
        totals.size,
        1,
        `${actor}'s reports disagree about how many keypairs the device generated: ` +
          `${[...totals].join(', ')}`,
      );
      const [total] = totals;
      assert.equal(
        counts[counts.length - 1],
        total,
        `${actor}'s last report stops short of its own total, so the bar never fills`,
      );

      /* Bracketed by marks around generation itself, like every other duration
         on this trace. */
      const last = reports[reports.length - 1];
      assert.ok(last.measures.keygenMs > 0, `${actor} recorded no time spent generating`);
      assert.ok(last.measures.kyberMs > 0, `${actor} recorded no time spent on post-quantum keys`);
    }

    /* And it reaches the drawing carrying the figures that were recorded, which
       is the half of this a page interpolating its own counter would fail. Held
       as whole lists, like the stored sizes further down: a report losing its
       count, an extra cue gaining one, and the counts arriving against the
       wrong device all read as failures rather than as a passing subset. */
    const cues = playThrough(sceneCuesFrom(run.trace.events)).filter(
      (cue) => cue.step === 'generating-keys',
    );
    assert.deepEqual(
      cues.map((cue) => ({ side: cue.keygen.side, count: cue.keygen.count, total: cue.keygen.total })),
      generating.map((event) => ({
        side: event.actor,
        count: event.detail.keypairs,
        total: event.detail.total,
      })),
      'the counts the drawing was given are not the counts the recording made, so the bar and ' +
        'the counter would be drawing figures no report produced',
    );
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

test('the key agreement step carries what the protocol chose, from the protocol', async () => {
  await withRun(async (run) => {
    await run.exchangeKeys();

    const { selection } = run.trace.events.find(
      (event) => event.step === 'session-established',
    ).detail;

    /* The point of the test. `onProtocolSelected` is a callback the SDK may
       stop calling, and a callback that stops firing leaves this step looking
       exactly like one that was never wired: present, measured, and silently
       carrying nothing. Nothing else in the run would go red. */
    assert.ok(selection, 'onProtocolSelected did not fire, so the step has nothing to print');

    /* It is this agreement's event, not one left over from another. */
    assert.equal(selection.remoteAddress, `bob:${run.client('b').deviceId}`);
    assert.equal(
      selection.usedPQXDH,
      true,
      'the demo agreed a key without post-quantum key exchange',
    );
    assert.equal(selection.usedClassicalFallback, false);
    assert.equal(typeof selection.usedTripleRatchet, 'boolean');

    /* Handed over whole, so every field is one the installed package declares
       rather than one this file expects to be there. */
    for (const field of Object.keys(selection)) {
      assert.ok(
        declaredSelectionFields.has(field),
        `selection field ${field} is not declared by the installed package`,
      );
    }
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
       the order this asserts is the order the module declares.
       Per actor and not across the whole recording: each device comes up on
       its own press, so the second one's ascent begins after the first has
       finished and the trace steps back down to `registered`. Protocol order
       is a property of one participant's own record, and a sort across both
       would be asserting that the presses cannot be separate. */
    for (const actor of ['a', 'b', 'relay']) {
      const own = run.trace.events.filter(
        (event) => event.actor === actor && event.step !== 'devices-ready',
      );
      const ranks = own.map((event) => STEPS.indexOf(event.step));
      assert.deepEqual(
        ranks,
        [...ranks].sort((x, y) => x - y),
        `${actor}'s recording is out of protocol order: ` +
          own.map((event) => event.step).join(' → '),
      );
    }
    const recorded = stepsOf(run).filter((step) => step !== 'devices-ready');
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

/*
 * Sealed sender is a lens, not a session setting — the demo has no trust root
 * to mint a sender certificate against — so what it does is cover the sender
 * address on the drawn envelope while the relay's real copy keeps its fields.
 * The lens is therefore a *claim* about which field a sealed send would remove,
 * and it names that field by hand: `NAMED_FIELDS.from` in `DemoConsole.astro`
 * is the one place the sender's address is spelled out.
 *
 * A name there that stops matching the envelope fails silently in the direction
 * that flatters us. The address the drawing shows falls back to nothing, the
 * lock closes over a field that was never there, and a page that has stopped
 * teaching its point looks entirely correct. Only a real envelope can catch it:
 * the SDK's declaration is a superset of what a send actually puts on the
 * object, so `demo-panel.test.mjs` checking the name against the type is
 * necessary and not sufficient.
 */
const consoleSource = await readFile(
  new URL('../src/components/demo/DemoConsole.astro', import.meta.url),
  'utf8',
);
const SEALED_FIELD = consoleSource.match(/NAMED_FIELDS = \{[^}]*?from:\s*'([^']+)'/s)?.[1];

test('sealed sender only claims to hide a field a real send produced', async () => {
  assert.ok(SEALED_FIELD, "the console's NAMED_FIELDS must name the sender field it covers");
  await withRun(async (run) => {
    const sent = await run.send('a', OUTBOUND);
    const keys = new Set(Object.keys(sent.envelope));
    assert.ok(
      keys.has(SEALED_FIELD),
      `sealed sender claims to cover "${SEALED_FIELD}", which a real envelope does not carry — ` +
        `the drawn address would be blank before the lens ever closed, and the page would look ` +
        `entirely correct while teaching nothing. The envelope has: ${[...keys].join(', ')}`,
    );
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

/**
 * The console's own projection from a `TraceEvent` to what `DemoScene.astro`
 * is shown, replicated here rather than imported.
 *
 * The real one is `toCue()` inside `DemoConsole.astro`, and it is not reachable
 * from a Node test: it is a function defined in an `.astro` component's script,
 * which only ever runs in a browser, and it closes over running counters
 * (`derived`, `published`) that are not exported either. This copy exists so
 * that the structural check below runs against cues built the same way the
 * console builds them — from a real recording, with the same running counts —
 * rather than against a shape invented for the test. Keep it in step with
 * `toCue()` if that function's shape changes; a drift here would let this test
 * pass against a cue the console no longer produces.
 */
function sceneCuesFrom(events) {
  const derived = { a: 0, b: 0 };
  const published = { a: 0, b: 0 };
  const device = (actor) => (actor === 'a' || actor === 'b' ? actor : null);

  return events.map((event) => {
    const detail = event.detail ?? {};
    const from = device(event.from);
    const to = device(event.to);

    const reports = event.braid ?? [];
    const latest = reports[reports.length - 1];
    const reporter = device(event.actor);
    const braided =
      latest && reporter
        ? {
            braid: {
              side: reporter,
              carried: latest.chunksCarried,
              required: latest.chunksRequired,
              epoch: latest.epoch,
            },
            ...(reports.some((report) => report.emittedEpochKey)
              ? { braidKeyFrom: reporter }
              : {}),
          }
        : {};

    const base = {
      step: event.step,
      actor: event.actor,
      ...(event.from === undefined ? {} : { from: event.from }),
      ...(event.to === undefined ? {} : { to: event.to }),
      ...braided,
    };

    if (event.step === 'encrypted' && from) derived[from] += 1;
    if (event.step === 'opened' && to) derived[to] += 1;
    const turned = { ratchet: { a: derived.a, b: derived.b } };

    if (event.step === 'generating-keys') {
      const side = device(event.actor);
      const keypairs = detail.keypairs;
      const total = detail.total;
      return {
        ...base,
        ...turned,
        ...(side && typeof keypairs === 'number' && typeof total === 'number'
          ? { keygen: { side, count: keypairs, total } }
          : {}),
      };
    }
    if (event.step === 'session-established') {
      const selection = detail.selection;
      const spent = detail.peer;
      const side = spent?.side === 'a' || spent?.side === 'b' ? spent.side : null;
      if (side && typeof spent?.publicKeys === 'number') published[side] = spent.publicKeys;
      return {
        ...base,
        ...turned,
        ...(typeof selection?.usedTripleRatchet === 'boolean'
          ? { ratchetKind: selection.usedTripleRatchet ? 'triple' : 'double' }
          : {}),
        ...(side && typeof spent?.publicKeys === 'number'
          ? { bundles: { a: published.a, b: published.b } }
          : {}),
      };
    }
    if (event.step === 'bundles-published') {
      const publicKeys = detail.publicKeys;
      const actor = device(event.actor);
      if (actor && typeof publicKeys === 'number') published[actor] = publicKeys;
      return {
        ...base,
        ...turned,
        bundles: { a: published.a, b: published.b },
        keys: { a: published.a, b: published.b },
      };
    }
    if (event.step === 'encrypted' && from && typeof detail.text === 'string') {
      return { ...base, ...turned, sentence: { side: from, text: detail.text } };
    }
    if (event.step === 'stored-at-relay') {
      const envelope = detail.envelope ?? {};
      return {
        ...base,
        ...turned,
        ...(typeof event.measures?.ciphertextBytes === 'number'
          ? { bytes: event.measures.ciphertextBytes }
          : {}),
        meta: {
          ...(typeof envelope.targetUserId === 'string' ? { to: envelope.targetUserId } : {}),
          ...(typeof envelope.senderUserId === 'string' ? { from: envelope.senderUserId } : {}),
        },
      };
    }
    if (event.step === 'opened' && to) {
      const text = typeof detail.decrypted?.content === 'string' ? detail.decrypted.content : '';
      return { ...base, ...turned, sentence: { side: to, text } };
    }
    return { ...base, ...turned };
  });
}

/*
 * The caption under each ratchet is the SDK's answer, not the page's.
 *
 * The reader is offered switches for the post-quantum policy and for the Braid
 * mode, and neither of them turns the post-quantum ratchet off — the SDK
 * publishes no way to. So the honest way to show the Triple Ratchet is to print
 * what the session selected, and the only place that is stated is the
 * `ProtocolSelectionEvent`. This is the check that the caption comes from there:
 * a cue captioned from the switches instead would read the same on this page
 * and would be a claim rather than a reading.
 *
 * It deliberately does not assert *which* ratchet the live run selected.
 * Pinning `triple` here would make this file a second copy of the SDK's
 * default, and the day that default moved the demo would be captioned correctly
 * and this test would be the thing that went red.
 *
 * Which leaves a trap worth naming, because the first version of this test fell
 * into it: reading `usedTripleRatchet` off the recording and comparing the cue
 * to it proves nothing at all, since both sides are the same field. It agrees
 * with itself however the caption is derived. So the property is checked by
 * putting the *other* answer on the same recording and requiring the caption to
 * follow it — a caption pinned to a constant, or read from the switches, cannot
 * survive that and a tautology cannot detect it.
 */
test('the ratchet each wheel is captioned with is the one the SDK selected', async () => {
  await withRun(async (run) => {
    await run.exchangeKeys();
    const events = run.trace.events;

    const { selection } = events.find((event) => event.step === 'session-established').detail;
    assert.equal(
      typeof selection?.usedTripleRatchet,
      'boolean',
      'the selection event said nothing about the ratchet, so there is no caption to check',
    );

    /* One caption per session, on the step that agreed the keys. A caption
       re-stated on a later cue would be a second source for one fact, and the
       two would part company the first time either was edited. */
    assert.deepEqual(
      sceneCuesFrom(events)
        .filter((cue) => cue.ratchetKind)
        .map((cue) => cue.step),
      ['session-established'],
      'the ratchet caption is set by something other than the step that agreed the keys',
    );

    /* And it follows the event. The recording is real; only the one boolean the
       caption claims to read is moved. */
    for (const usedTripleRatchet of [true, false]) {
      const swapped = events.map((event) =>
        event.step === 'session-established'
          ? {
              ...event,
              detail: { ...event.detail, selection: { ...selection, usedTripleRatchet } },
            }
          : event,
      );
      assert.equal(
        sceneCuesFrom(swapped).find((cue) => cue.step === 'session-established').ratchetKind,
        usedTripleRatchet ? 'triple' : 'double',
        `the selection said usedTripleRatchet=${usedTripleRatchet} and the caption did not follow`,
      );
    }
  });
});

/**
 * The fields on a scene cue whose number is a count of things rather than a
 * measurement: how many notches a ratchet has turned, how many key bundles the
 * relay is holding for each device, how many key shapes a device has, how many
 * chunks of a post-quantum key have travelled. Bounded by the real protocol
 * state, but not by anything small — a published-key count can run into the
 * hundreds, the same order of magnitude as a byte count — so telling a count
 * from a measurement by its size would not hold. It has to be told by which
 * field it travelled on, which is what this list is for.
 *
 * `braid` and `keygen` are on the list and are also pinned against the
 * recording separately, further down and further up. Being a count buys them
 * past the scan below; it does not buy them the right to be counts this page
 * invented.
 *
 * `keygen` was added when key generation became a step of its own. It carries
 * how many keypairs a device has made and how many it makes in all, which are
 * counts of a thing the protocol produced in the same sense the shelf counts
 * are — not durations, and not the byte count's kind of measurement either. The
 * two durations that step does measure, `keygenMs` and `kyberMs`, stay on the
 * recording and reach the reader through the readings panel, which is the path
 * every other millisecond figure on this page takes.
 */
const PRESENTATION_COUNT_FIELDS = new Set(['ratchet', 'bundles', 'keys', 'braid', 'keygen']);

/**
 * The one field on a cue that carries a measurement rather than a count: how
 * many bytes of ciphertext the relay stored for the row being shown. The scene
 * draws a bar to that size, and a size cannot be drawn to scale without it.
 *
 * Allowed here, but not on the counts' terms. A count only has to be a number;
 * this has to be *the* number, equal to the `ciphertextBytes` the recording
 * measured for the same step, which the test below checks separately. That is
 * the difference between a drawing that reports and one that decorates.
 */
const MEASURED_FIELD = 'bytes';

/**
 * Fail loudly if anything but a string (or a plain nesting of strings) is
 * found at `path`, which is the shape everything on a cue must have except the
 * fields named above.
 */
function assertNoMeasurement(value, path) {
  if (value === undefined || typeof value === 'string') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoMeasurement(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertNoMeasurement(item, `${path}.${key}`);
    return;
  }
  assert.fail(
    `cue.${path} is ${JSON.stringify(value)} (a ${typeof value}), not a string — a measurement ` +
      'reached the drawing, which a speed control could someday be asked to scale',
  );
}

/**
 * Play a reel through the real transport and collect what the drawing was shown.
 *
 * No fake clock is needed to time anything, only to keep the reel from waiting
 * out its real dwells — so the schedule fires at once. The loop is bounded
 * rather than a bare `while`, so a reel that reschedules itself without
 * advancing fails a test instead of hanging the suite, and the bound comes from
 * the reel so a longer recording does not quietly outgrow it.
 */
function playThrough(reel) {
  let pending = null;
  const shown = [];
  const playback = createPlayback({
    show: (cue) => shown.push(cue),
    schedule: (fire) => {
      pending = fire;
      return () => {
        pending = null;
      };
    },
  });
  playback.push(...reel);
  playback.play();
  for (let turn = 0; pending && turn < reel.length + 10; turn += 1) {
    const fire = pending;
    pending = null;
    fire();
  }
  return shown;
}

/*
 * The transport's whole promise, checked end to end against a real recording
 * rather than against the hand-written reel in `demo-playback.test.mjs`.
 *
 * That was checkable as "the same cues at any speed" when the transport had a
 * speed; it no longer does. What the two-clock guarantee rests on is narrower
 * and stronger: no duration reaches the drawing at all, so there is nothing on
 * a cue for a future pacing knob to move even by accident.
 *
 * That claim is not "no cue carries a number". `toCue()` puts real numbers on
 * a cue on purpose: counts, to turn a ratchet's notches, size a key list and
 * fill a braid's key, and one measurement, the stored row's byte count, which
 * the relay column draws to scale. The claim is that those five fields are all
 * of them — `ratchet`, `bundles`, `keys`, `braid`, `bytes` — and every other
 * value, at any depth, is a string. A millisecond figure arriving on any other
 * field — `sentence`, `meta`, or a sixth field nobody named yet — is exactly
 * the regression this guards, and it is checked by enumerating every value on
 * every cue rather than by naming the fields a measurement might use, because
 * naming them is a list a new one can be added to without this test noticing.
 *
 * The measurement that is allowed through is pinned rather than waved past.
 * Every stored row must arrive with the byte count the recording measured for
 * it, and the drawing must receive exactly that number, so the bar cannot be
 * sized from a constant, a running total, or anything else the page found
 * convenient. Drawing a size nothing reported is the failure this half exists
 * to catch.
 *
 * A cue built the way the console builds one (`sceneCuesFrom`, above), so the
 * payload under test is the payload that ships.
 */
test('the only measurement a cue carries is the size the recording measured', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);

    const reel = sceneCuesFrom(run.trace.events);
    assert.ok(
      reel.some((cue) => cue.step === 'stored-at-relay'),
      'the recording produced no stored row, so this test checked a reel with no relay cue in it',
    );

    const shown = playThrough(reel);
    assert.equal(shown.length, reel.length, 'not every cue on the reel reached the drawing');
    for (const [index, cue] of shown.entries()) {
      for (const [key, value] of Object.entries(cue)) {
        if (PRESENTATION_COUNT_FIELDS.has(key) || key === MEASURED_FIELD) continue;
        assertNoMeasurement(value, `${index}.${key}`);
      }
    }

    /* The one measurement, held against the recording that made it. Compared as
       whole lists so that a row losing its size, an extra row gaining one, and
       the sizes arriving against the wrong rows all read as the failures they
       are rather than as a passing subset. */
    const measured = run.trace.events
      .filter((event) => event.step === 'stored-at-relay')
      .map((event) => event.measures?.ciphertextBytes);
    const drawn = shown.filter((cue) => cue.step === 'stored-at-relay').map((cue) => cue.bytes);
    assert.ok(
      measured.every((bytes) => typeof bytes === 'number' && bytes > 0),
      `the recording stored rows without measuring them: ${JSON.stringify(measured)}`,
    );
    assert.deepEqual(
      drawn,
      measured,
      'the sizes the drawing was given are not the sizes the recording measured, so the relay ' +
        'column would draw a bar to something no event reported',
    );
  });
});

/*
 * The relay is told what each device published, and never a pooled total.
 *
 * A relay stores a bundle per user. It has to: `fetchPreKeyBundle` is asked for
 * one account's material, and the prekeys it hands out come off that account's
 * shelf and no one else's. A drawing given one number for both devices cannot
 * show that — it draws a pile, and a pile is the one thing the relay does not
 * keep. It also cannot show the next thing the reel has to say, which is that
 * sending to a peer spends the *peer's* keys and leaves the sender's alone.
 *
 * So the count arrives per device, and each side's figure is the figure that
 * device's own publish reported. Checked over a real recording in the order the
 * events arrive, because the interesting frame is the one between the two
 * publishes: one device on its shelf and the other still empty is a state the
 * pooled figure could not represent at all, and it is the frame that says the
 * shelves are separate.
 *
 * The console's own source is read at the end. `sceneCuesFrom` below is a
 * hand-maintained replica of `toCue()`, so every assertion above it is an
 * assertion about the replica; a console left summing the two counts would go on
 * shipping a pooled figure under a green replica. Reading the source for the sum
 * is what closes that, and it is a grep rather than a call because a function
 * inside an `.astro` component's script cannot be imported from Node.
 */
test('the relay is given a count per device rather than a pooled total', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);

    const cues = sceneCuesFrom(run.trace.events);
    const published = cues.filter((cue) => cue.step === 'bundles-published');
    assert.equal(
      published.length,
      2,
      'the recording did not publish twice, so there is no per-device count to check',
    );

    for (const cue of published) {
      assert.equal(
        typeof cue.bundles,
        'object',
        `the drawing was handed bundles as ${JSON.stringify(cue.bundles)} — one figure for two ` +
          'shelves, which draws the relay as a pile rather than as a shelf per account',
      );
      assert.deepEqual(
        Object.keys(cue.bundles ?? {}).sort(),
        ['a', 'b'],
        'the per-device count does not name both devices',
      );
    }

    /* Each side's figure against the publish that reported it, in order. The
       first cue must still show the second device at nothing: a shelf that
       filled before its device published would be the pooled figure wearing two
       names. */
    const reported = run.trace.events
      .filter((event) => event.step === 'bundles-published')
      .map((event) => ({ side: event.actor, keys: event.detail?.publicKeys }));
    assert.ok(
      reported.every(({ keys }) => typeof keys === 'number' && keys > 0),
      `a publish reported no key count: ${JSON.stringify(reported)}`,
    );

    const running = { a: 0, b: 0 };
    for (const [index, cue] of published.entries()) {
      running[reported[index].side] = reported[index].keys;
      assert.deepEqual(
        cue.bundles,
        { ...running },
        `after ${index + 1} of the two publishes the relay's shelves were drawn as ` +
          `${JSON.stringify(cue.bundles)} rather than ${JSON.stringify(running)}`,
      );
    }

    const consoleSource = await readFile(
      new URL('../src/components/demo/DemoConsole.astro', import.meta.url),
      'utf8',
    );
    assert.doesNotMatch(
      consoleSource,
      /published\.a\s*\+\s*published\.b/,
      'the console still sums the two devices into one figure, so the replica above is checking ' +
        'a cue the page no longer produces',
    );
  });
});

/*
 * Agreeing a key spends the peer's shelf, and the shelf is redrawn from the
 * relay rather than from arithmetic.
 *
 * `fetchPreKeyBundle` is documented to consume one EC and one KEM one-time
 * prekey atomically on every call, and `ensureSession` makes exactly that call.
 * So the frame that agrees a key is the frame in which the responder's shelf
 * really does hold less than it published — and until this existed the relay
 * column drew the published figure for the whole rest of the run, which is the
 * relay claiming to hold material it had already handed out.
 *
 * The count is read back off the relay, and this test is what keeps it that
 * way. Two consumed prekeys is not a fact about the protocol this page may
 * assume: a device out of one-time keys is served from its last-resort KEM
 * prekey and its shelf falls by less, which is a case the demo's own "run out
 * of prekeys" scenario exists to show. So nothing here asserts a difference of
 * two, and the swap at the end is what tells a re-read apart from a subtraction
 * — both agree on a healthy account, and only one of them survives the recording
 * saying something else.
 *
 * The initiator's shelf is checked as hard as the responder's. Spending the
 * wrong account is the failure a reader would misread as the protocol taking
 * the sender's keys to talk to someone else, and a drawing that decremented
 * both would still pass a test that only watched one fall.
 *
 * The device's own key row is checked for *not* moving. The public halves on
 * the relay's shelf and the private halves in the device's column stop being one
 * figure drawn twice at this step: the relay has handed a bundle out and the
 * responder, which has not yet seen a message, still holds every private key it
 * made. A cue that carried `keys` here would draw the responder losing private
 * keys to a fetch it did not take part in.
 */
test("agreeing a key redraws the peer's shelf from the relay's own count", async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);

    const events = run.trace.events;
    const established = events.find((event) => event.step === 'session-established');
    assert.ok(established, 'the recording has no key agreement in it, so nothing was spent');
    assert.deepEqual(
      { from: established.from, to: established.to },
      { from: 'a', to: 'b' },
      'the key agreement did not record who fetched whose bundle, so which shelf was spent is ' +
        'not a fact the recording carries',
    );

    const spent = established.detail?.peer;
    assert.equal(
      spent?.side,
      'b',
      `the key agreement recorded the shelf it spent as ${JSON.stringify(spent?.side)} — the ` +
        'bundle was fetched for device B, and a reading filed against the other device would ' +
        "decrement the initiator's own shelf",
    );
    assert.equal(
      typeof spent?.publicKeys,
      'number',
      'the key agreement carries no count of what the relay has left, so the shelf can only be ' +
        'drawn by subtracting a number this page chose',
    );

    const publishedBy = (side) =>
      events.find((event) => event.step === 'bundles-published' && event.actor === side)?.detail
        ?.publicKeys;
    const [wasA, wasB] = [publishedBy('a'), publishedBy('b')];
    assert.ok(
      typeof wasA === 'number' && typeof wasB === 'number',
      `a publish reported no key count (a: ${wasA}, b: ${wasB}), so there is nothing for the ` +
        'reading after the fetch to be lower than',
    );
    assert.ok(
      spent.publicKeys < wasB,
      `device B published ${wasB} public values and the relay still reported ${spent.publicKeys} ` +
        'after handing that bundle out. Either the reading was taken before the fetch or it is ' +
        'not a reading at all — the shelf would draw the relay holding keys it has given away.',
    );

    /* And the drawing is handed that reading, on that step, for that shelf. */
    const cue = sceneCuesFrom(events).find((cue) => cue.step === 'session-established');
    assert.deepEqual(
      cue.bundles,
      { a: wasA, b: spent.publicKeys },
      "the shelves drawn as the keys were agreed are not the relay's own two figures",
    );
    assert.equal(
      cue.keys,
      undefined,
      "the cue that spends the peer's shelf also moves the device key rows, which would draw a " +
        'device losing private keys to a fetch it was not part of',
    );

    /*
     * The reading is followed rather than reproduced. A page subtracting two
     * agrees with the relay on every healthy account, so the only way to tell
     * the two apart is to put a figure on the recording that no subtraction
     * would produce and require the drawing to print it.
     */
    for (const publicKeys of [wasB - 41, 7]) {
      const swapped = events.map((event) =>
        event === established
          ? { ...event, detail: { ...event.detail, peer: { side: 'b', publicKeys } } }
          : event,
      );
      assert.deepEqual(
        sceneCuesFrom(swapped).find((cue) => cue.step === 'session-established').bundles,
        { a: wasA, b: publicKeys },
        `the relay reported ${publicKeys} keys left and the shelf was drawn at something else, ` +
          'so the figure is being worked out here rather than read',
      );
    }
  });
});

/*
 * The envelope the relay stores is addressed, and the drawing is told to whom.
 *
 * A relay holds a mailbox per recipient, and which mailbox a row went into is
 * not something the scene may work out from a step name — both devices send in
 * this demo and either may be the one receiving. So the cue that stores a row
 * has to name the device it is for, and it has to name the far one.
 *
 * Pinned here rather than left to the drawing, because the drawing's version of
 * this is a `querySelector` that cannot fail loudly: a cue with no recipient on
 * it falls through to whichever mailbox the fallback picks, and the scene draws
 * a row waiting for the device that sent it while every gate stays green.
 */
test('the stored row names the device it is waiting for', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);
    await run.send('b', REPLY);

    const stored = sceneCuesFrom(run.trace.events).filter((cue) => cue.step === 'stored-at-relay');
    assert.equal(stored.length, 2, 'the recording stored a row for only one direction');
    for (const cue of stored) {
      assert.ok(
        cue.to === 'a' || cue.to === 'b',
        `a stored row was drawn for "${cue.to}" — the relay's mailboxes belong to devices, and a ` +
          'row with no device on it lands in whichever one the fallback picks',
      );
      assert.notEqual(
        cue.to,
        cue.from,
        'a stored row names its sender as its recipient, so the mailbox that lights is the one ' +
          'the message came from',
      );
    }
    assert.deepEqual(
      stored.map((cue) => cue.to),
      ['b', 'a'],
      'the two directions did not fill the two mailboxes',
    );
  });
});

/**
 * The cue fields the drawing reads, taken from the drawing's own source.
 *
 * The property below is about frames rather than about payloads: two cues that
 * differ only in a field `scene-view.ts` never looks at are two identical
 * frames, and a reader watching them sees the reel stop. So the set of fields
 * that counts is the set the scene actually reads, and reading it out of the
 * scene is what keeps this test from being a second opinion about that — a
 * hand-written list here would go stale in the direction that passes, which is
 * how the duplicated `devices-ready` frame survived in the first place.
 *
 * Comments are stripped first. A field named only in prose is a field the scene
 * does not read, and counting it would let a frame pass on a difference nothing
 * draws.
 */
async function fieldsTheSceneReads() {
  const source = await readFile(new URL('../src/lib/demo/scene-view.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  return new Set([...code.matchAll(/\bcue\.([A-Za-z]+)/g)].map(([, field]) => field));
}

/*
 * Every frame in the reel says something the frame before it did not.
 *
 * A cue is a frame, and the reel is watched rather than read: a step whose
 * drawing is identical to the one before it spends its whole dwell telling a
 * reader that nothing is happening, which is indistinguishable from a page that
 * has stopped. The reel shipped with two of them at the front — both devices
 * were stamped online by whichever `devices-ready` cue arrived first, so the
 * second one drew nothing and the demo opened on two dwells of one still
 * picture.
 *
 * Checked over a real recording rather than a hand-built reel, because the
 * duplication was a fact about which events the run records and what the
 * drawing does with them, and neither is visible in a reel written here.
 */
test('no two frames in a row draw the same thing', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);

    const read = await fieldsTheSceneReads();
    /* A scan that found nothing would pass every pair by comparing empty
       frames, so the fields the scene certainly reads are named here — not as
       the list under test, but as proof the scan reached the source. */
    for (const field of ['step', 'keys', 'bundles', 'ratchet']) {
      assert.ok(
        read.has(field),
        `the scan of scene-view.ts did not find cue.${field}, so the frames compared below are ` +
          'not the frames the scene draws',
      );
    }

    const frame = (cue) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(cue)
            .filter(([field]) => read.has(field))
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
      );

    const shown = playThrough(sceneCuesFrom(run.trace.events));
    assert.ok(shown.length > 1, 'the recording produced one frame, so nothing was compared');
    for (let index = 1; index < shown.length; index += 1) {
      assert.notEqual(
        frame(shown[index]),
        frame(shown[index - 1]),
        `frames ${index - 1} and ${index} of the reel draw the same thing — "${
          shown[index - 1].step
        }" then "${shown[index].step}", both ${frame(shown[index])} — so the scene holds a still ` +
          'picture for two dwells and the reader is given a step with nothing in it',
      );
    }
  });
});

/*
 * The braid's counts, held against the braid.
 *
 * The relay column draws how much of a post-quantum key has travelled, and
 * marks the point a device says it produced the epoch secret. Neither is
 * something this page can work out. A braid chunk is visible only inside the
 * braid's own state machine, so `onBraidProgress` is the only source, and a
 * page that counted messages, or scaled a byte count, or lit the mark on a step
 * name would draw a plausible picture of a protocol it was not reading.
 *
 * So the counts are compared as whole lists in both directions. Every report the
 * recording holds must reach the drawing, in order, with the counts unchanged
 * and against the device that made it; and the drawing must receive nothing
 * else. A subset comparison would pass a drawing that reported the first chunk
 * and then stopped, which is the failure this is for.
 *
 * The completion is checked the same way and separately, because it is an event
 * and not a level: a page could carry the counts faithfully and still light the
 * mark from somewhere else entirely.
 *
 * Then the same page with the braid switched off. Direct mode sends the key
 * whole and reports nothing, so a drawing that receives anything at all there is
 * a drawing deriving chunks from something the braid did not say — which is
 * exactly the defect the counts alone cannot catch, because a derived number can
 * agree with a reported one for a while.
 *
 * What this cannot reach is the DOM. `mountScene` needs a browser and the suite
 * has none, so what is pinned here is what the scene is handed. That the scene
 * then draws it, and that the mark survives the epoch boundary on screen, is
 * read out of the live page by `demo-smoke.mjs`.
 */
test('the chunks the drawing is given are the chunks the braid reported', async () => {
  await withRun(
    async (run) => {
      /*
       * Sent until the braid has both produced a key and moved on an epoch,
       * rather than a fixed number of times.
       *
       * A whole epoch, because the counter reset is the case the drawing has to
       * survive and it happens at the far end of one: the report announcing the
       * secret that closes an epoch already carries the counts of the epoch that
       * has begun. A run that stopped at the first completion would leave the
       * hardest thing this drawing does untested.
       *
       * How many messages that takes is the braid's business — it follows from
       * the chunk size, from the parity a sender carries beyond what its peer
       * needs, and from which side is encapsulating — so the loop watches for the
       * conditions instead of counting to a number copied out of the SDK. A
       * number here would go red about a demo that was drawing correctly the day
       * the braid was retuned. The bound is far above any epoch the braid runs
       * and is there so a braid that never completes fails rather than hangs.
       */
      const MOST_MESSAGES = 300;
      const reports = () => run.trace.events.flatMap((event) => event.braid ?? []);
      const completed = () => reports().some((report) => report.emittedEpochKey);
      const epochsSeen = () => new Set(reports().map((report) => report.epoch));
      let sent = 0;
      while (sent < MOST_MESSAGES && !(completed() && epochsSeen().size > 1)) {
        sent += 1;
        await run.send(sent % 2 === 1 ? 'a' : 'b', `${OUTBOUND} (${sent})`);
      }
      assert.ok(
        completed(),
        `${MOST_MESSAGES} messages under the braid and it never reported an epoch key, so there ` +
          'is no completion for the drawing to be held against',
      );
      /* The counters really do fall back, which is what the drawing has to
         survive. Asserted rather than assumed, so that a braid which stopped
         resetting would take this claim out of the comments here and out of
         `scene-view.ts` with it. */
      assert.ok(
        epochsSeen().size > 1,
        `${sent} messages stayed inside one braid epoch (${[...epochsSeen()].join(', ')}), so ` +
          'the drawing was never asked to survive a counter reset',
      );

      const shown = playThrough(sceneCuesFrom(run.trace.events));

      /* The last report of a step, because that is the one the drawing is
         given: the counts say where the key has got to, and the last is the
         most recent thing said about it. */
      const reported = run.trace.events
        .filter((event) => event.braid?.length)
        .map((event) => {
          const latest = event.braid[event.braid.length - 1];
          return {
            step: event.step,
            side: event.actor,
            carried: latest.chunksCarried,
            required: latest.chunksRequired,
            epoch: latest.epoch,
          };
        });
      const drawn = shown.filter((cue) => cue.braid).map((cue) => ({ step: cue.step, ...cue.braid }));

      assert.ok(
        reported.length > 0,
        'the recording carries no braid report at all, so this test compared two empty lists',
      );
      assert.deepEqual(
        drawn,
        reported,
        'the chunk counts the drawing was given are not the counts the braid reported, so the ' +
          'relay column would draw a key filling to something no report stated',
      );

      /* The whole list of reports on a step, not its last one: a completion
         dropped because a later report in the same step did not repeat it
         would be the run's one completion lost. */
      const announced = run.trace.events
        .filter((event) => event.braid?.some((report) => report.emittedEpochKey))
        .map((event) => ({ step: event.step, side: event.actor }));
      const marked = shown
        .filter((cue) => cue.braidKeyFrom)
        .map((cue) => ({ step: cue.step, side: cue.braidKeyFrom }));
      assert.deepEqual(
        marked,
        announced,
        'the completions the drawing was given are not the ones the braid announced, so the mark ' +
          'under the relay column comes from somewhere other than the report',
      );
    },
    { protocol: { postQuantum: 'required', braid: 'required' } },
  );

  await withRun(
    async (run) => {
      for (let n = 1; n <= 4; n += 1) {
        await run.send(n % 2 === 1 ? 'a' : 'b', `${OUTBOUND} (${n})`);
      }
      assert.deepEqual(
        run.trace.events.filter((event) => event.braid).map((event) => event.step),
        [],
        'the direct mode carries the key whole and reports no chunk, and the recording has chunk ' +
          'reports in it',
      );
      assert.deepEqual(
        playThrough(sceneCuesFrom(run.trace.events)).filter(
          (cue) => cue.braid || cue.braidKeyFrom,
        ),
        [],
        'a run that reported no chunk still handed the drawing chunk counts, so the relay column ' +
          'is deriving them from something other than the braid',
      );
    },
    { protocol: { postQuantum: 'required', braid: 'disabled' } },
  );
});

test('reset forgets the conversation and leaves both devices to be booted again', async () => {
  await withRun(async (run) => {
    await run.send('a', OUTBOUND);
    const firstClient = run.client('a');

    await run.reset();

    /* Back to the cold start: an empty recording and no devices. A reset that
       rebooted the pair for the reader would hand back a page it had filled in
       itself, and the presses are the demo's first teaching moment. */
    assert.deepEqual(stepsOf(run), [], 'the recording kept something from the run before the reset');
    assert.throws(
      () => run.client('a'),
      'a device survived the reset instead of waiting to be activated again',
    );

    await run.activate('a');
    await run.activate('b');
    assert.equal(
      stepsOf(run).filter((step) => step === 'devices-ready').length,
      2,
      'the devices did not come back up after the reset',
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
    await run.activate('a');
    await run.activate('b');
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
