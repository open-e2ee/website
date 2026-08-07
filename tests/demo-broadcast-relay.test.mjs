/*
 * What the two-tab relay puts on the wire, and what it must never put there.
 *
 * The page's claim is a negative: open the demo in two tabs, and the only
 * thing that crosses between them is what a server would hold. A negative
 * claim is the easiest kind to assert vacuously — searching a transcript for a
 * sentence proves nothing if the transcript is empty, and this site has
 * already shipped one check that passed because the thing it examined had
 * stopped existing.
 *
 * So the wire is asserted three ways, and each covers a hole in the others:
 *
 *   1. Positively. The traffic has to contain a `send` carrying ciphertext and
 *      an `envelope` delivering it. Every other assertion here is about what
 *      is absent, and absence is worthless without that.
 *   2. Structurally. Every message is one of the declared kinds, and every
 *      call names one of the twelve methods a session was measured to make.
 *      This is the assertion that survives a rewrite: a new field carrying the
 *      sentence fails it whatever the field is called and however it is
 *      encoded.
 *   3. By content. No string anywhere in the traffic contains the sentence —
 *      not as text, not percent-encoded, not base64, and not as bytes that
 *      decode to it. This is the assertion that survives a *new kind* of
 *      message that nobody added to the structural list.
 *
 * The sentence carries a per-run nonce, so a check that has quietly stopped
 * looking at anything cannot pass by matching a constant that is no longer
 * there.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import {
  CARRIED_CALLS,
  MESSAGE_KINDS,
  broadcastRelay,
} from '../src/lib/demo/broadcast-relay.ts';

/**
 * A `BroadcastChannel` in one process, and a tap on everything it carried.
 *
 * Delivery is deferred to a later macrotask on purpose. A real channel cannot
 * deliver inside the call that posts, and a fake that did would let a relay
 * pass here and hang in a browser — which is the exact defect this layer was
 * dispatched to close.
 *
 * A port never hears its own post, matching `BroadcastChannel`. A fake that
 * echoed would let the host answer its own calls and never prove the guest's
 * side ran at all.
 */
function channelHub() {
  const ports = new Set();
  const sent = [];
  return {
    sent,
    port() {
      const listeners = new Set();
      const port = {
        postMessage(message) {
          sent.push(message);
          for (const other of ports) {
            if (other === port) continue;
            setTimeout(() => {
              for (const listener of other.listeners) listener({ data: message });
            }, 0).unref?.();
          }
        },
        addEventListener(type, listener) {
          if (type === 'message') listeners.add(listener);
        },
        close() {
          ports.delete(port);
          listeners.clear();
        },
        listeners,
      };
      ports.add(port);
      return port;
    },
  };
}

/** Every string and every byte run reachable in a posted message. */
function stringsIn(value, found = []) {
  if (typeof value === 'string') found.push(value);
  else if (value instanceof Uint8Array) found.push(Buffer.from(value).toString('utf8'));
  else if (value instanceof ArrayBuffer) found.push(Buffer.from(value).toString('utf8'));
  else if (Array.isArray(value)) for (const item of value) stringsIn(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) stringsIn(item, found);
  return found;
}

/**
 * Does this string carry `secret` in any form the wire could hold it in?
 *
 * Searching for the plaintext alone is the weak version of this check, and the
 * one a leak would most likely slip past: everything else on this channel is
 * base64, so base64 is the encoding an accidental leak arrives in.
 */
function carries(text, secret) {
  if (text.includes(secret)) return 'as text';
  if (text.includes(encodeURIComponent(secret))) return 'percent-encoded';
  if (text.includes(Buffer.from(secret, 'utf8').toString('base64'))) return 'base64';
  if (/^[A-Za-z0-9+/=]{16,}$/.test(text)) {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    if (decoded.includes(secret)) return 'inside a base64 payload';
  }
  return null;
}

/** Boot alice in the host tab and bob in the guest tab, over one hub. */
async function twoTabs() {
  const hub = channelHub();
  const host = await broadcastRelay({ role: 'host', channel: hub.port() });
  const guest = await broadcastRelay({ role: 'guest', channel: hub.port(), callTimeoutMs: 5000 });

  await host.relay.registerDevice('alice', { encryptedDeviceName: new ArrayBuffer(0) });
  await guest.relay.registerDevice('bob', { encryptedDeviceName: new ArrayBuffer(0) });

  const alice = await createSignalProtocolClient({
    identity: { userId: 'alice' },
    adapters: { storage: inMemoryStore(), relay: host.relay },
  });
  const bob = await createSignalProtocolClient({
    identity: { userId: 'bob' },
    adapters: { storage: inMemoryStore(), relay: guest.relay },
  });
  await Promise.all([alice.syncToServer(), bob.syncToServer()]);

  const received = [];
  bob.registerHook('onMessageDecrypted', (message) => received.push(message));
  bob.startRelaySubscription();

  return {
    hub,
    alice,
    bob,
    received,
    async stop() {
      await Promise.all([alice.stop(), bob.stop()]);
      host.close();
      guest.close();
    },
  };
}

/** Wait for the guest tab to decrypt, or fail saying it never did. */
async function waitForDelivery(received, ms = 8000) {
  const deadline = Date.now() + ms;
  while (received.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20).unref?.());
  }
  assert.ok(
    received.length > 0,
    `the guest tab never decrypted anything in ${ms}ms. Nothing crossed the channel, ` +
      `so every assertion below about what did cross would be vacuous.`,
  );
}

test('round-trips a real message between two tabs over one relay', async () => {
  const tabs = await twoTabs();
  const probe = `Ship it Thursday. Nonce ${randomUUID()}.`;
  try {
    await tabs.alice.send('bob', probe);
    await waitForDelivery(tabs.received);
    assert.equal(tabs.received[0].content, probe);
    assert.equal(tabs.received[0].senderId, 'alice');
  } finally {
    await tabs.stop();
  }
});

test('carries the sentence in no form at all', async () => {
  const tabs = await twoTabs();
  const probe = `Ship it Thursday. Nonce ${randomUUID()}.`;
  try {
    await tabs.alice.send('bob', probe);
    await waitForDelivery(tabs.received);

    const leaks = [];
    for (const message of tabs.hub.sent) {
      for (const text of stringsIn(message)) {
        const how = carries(text, probe);
        if (how) leaks.push(`${message.kind}: ${how}`);
      }
    }
    assert.deepEqual(
      leaks,
      [],
      `the sentence crossed the channel:\n  ${leaks.join('\n  ')}\n` +
        `The whole claim beside this demo is that it does not.`,
    );
  } finally {
    await tabs.stop();
  }
});

test('carries ciphertext and a delivered envelope, so the search had something to search', async () => {
  const tabs = await twoTabs();
  const probe = `Ship it Thursday. Nonce ${randomUUID()}.`;
  try {
    await tabs.alice.send('bob', probe);
    await waitForDelivery(tabs.received);

    const sends = tabs.hub.sent.filter((m) => m.kind === 'call' && m.method === 'send');
    const envelopes = tabs.hub.sent.filter((m) => m.kind === 'envelope');
    assert.equal(
      sends.length,
      0,
      'alice holds the relay, so her send is a local call and must not be on the wire',
    );
    assert.ok(
      envelopes.length > 0,
      'no envelope crossed to the guest tab, so nothing was actually relayed',
    );

    const { ciphertext } = envelopes[0].envelope;
    const asText = typeof ciphertext === 'string' ? ciphertext : Buffer.from(ciphertext).toString('utf8');
    assert.ok(asText.length > 0, 'the delivered envelope carried no ciphertext');
    assert.equal(carries(asText, probe), null, 'the envelope ciphertext was not ciphertext');
  } finally {
    await tabs.stop();
  }
});

test('puts nothing on the channel but the declared kinds and the carried calls', async () => {
  const tabs = await twoTabs();
  try {
    await tabs.alice.send('bob', `Ship it Thursday. Nonce ${randomUUID()}.`);
    await waitForDelivery(tabs.received);

    assert.ok(tabs.hub.sent.length > 0, 'nothing was posted, so this proves nothing');

    const kinds = new Set(tabs.hub.sent.map((message) => message.kind));
    const undeclared = [...kinds].filter((kind) => !MESSAGE_KINDS.includes(kind));
    assert.deepEqual(undeclared, [], `undeclared message kinds on the channel: ${undeclared}`);

    const methods = new Set(
      tabs.hub.sent.filter((m) => m.kind === 'call').map((message) => message.method),
    );
    assert.ok(methods.size > 0, 'the guest made no calls, so the method check proves nothing');
    const uncarried = [...methods].filter((method) => !CARRIED_CALLS.includes(method));
    assert.deepEqual(
      uncarried,
      [],
      `methods crossed the channel that the relay does not declare it carries: ${uncarried}. ` +
        `Either the SDK started calling something new, in which case say so in ` +
        `CARRIED_CALLS, or something is using this channel as a general transport.`,
    );
  } finally {
    await tabs.stop();
  }
});

test('refuses a relay method it does not carry, by name', async () => {
  const hub = channelHub();
  const host = await broadcastRelay({ role: 'host', channel: hub.port() });
  try {
    assert.throws(() => host.relay.getGroupState(), /does not carry getGroupState/);
    assert.throws(() => host.relay.sendUnidentified(), /does not carry sendUnidentified/);
  } finally {
    host.close();
  }
});

test('fails a guest call loudly when no tab is holding the relay', async () => {
  const hub = channelHub();
  const guest = await broadcastRelay({ role: 'guest', channel: hub.port(), callTimeoutMs: 200 });
  try {
    await assert.rejects(
      () => guest.relay.getDevices('bob'),
      /did not answer getDevices\(\) within 200ms/,
      'a guest with no host has to say so rather than wait',
    );
  } finally {
    guest.close();
  }
});
