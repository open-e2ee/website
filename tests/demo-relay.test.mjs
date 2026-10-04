/*
 * `relay.ts` is the relay inside this page: the demo, the playground, and the
 * carrier capture all run the installed SDK against it. It implements the
 * SDK's `SignalProtocolRelayServer` contract for one-to-one messages only, so
 * these tests hold it to three things.
 *
 * What it carries works the way the contract says: delivery, the mailbox,
 * the device registry, identity, and prekeys.
 *
 * What it does not carry fails loudly. A group, credential, or provisioning
 * call rejects with an error that names the member, rather than resolving
 * with nothing.
 *
 * And the split between the two is not a guess. The last tests wrap the relay
 * in a recorder and drive both demo engines through every path the page has,
 * the retry included, and check that the SDK called only what the relay
 * carries.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { startDemoSession } from '../src/lib/demo/driver.ts';
import { PageRelay, PageRelayUnsupportedError, pageRelay } from '../src/lib/demo/relay.ts';
import { startDemoRun } from '../src/lib/demo/run.ts';

function envelope(overrides = {}) {
  return {
    targetUserId: 'bob',
    targetDeviceId: 1,
    senderUserId: 'alice',
    senderDeviceId: 1,
    ciphertext: 'c2VhbGVk',
    messageType: 'ciphertext',
    deliveryClass: 'user-visible',
    timestamp: 1,
    ...overrides,
  };
}

/** The members a client may call on this relay, and that work. */
const CARRIED = new Set([
  'send',
  'subscribe',
  'relayConnectionState',
  'subscribeRelayConnectionState',
  'markDelivered',
  'getDevices',
  'registerDevice',
  'removeDevice',
  'getActiveDevices',
  'provisionIdentityKey',
  'rotateIdentityKey',
  'getIdentityKey',
  'uploadPreKeys',
  'fetchPreKeyBundle',
  'getPreKeyInventory',
  'getPreKeyCount',
  'clearStaleKemPreKeys',
  'publishPlannedPreKeys',
  'getEcSignedPreKeyMetadata',
  'getKemLastResortPreKeyMetadata',
  'sendRetryRequest',
  'subscribeRetryRequests',
]);

/** The contract members this relay refuses. */
const REFUSED = [
  'createGroupState',
  'getGroupState',
  'getGroupJoinInfo',
  'getGroupChanges',
  'submitGroupChange',
  'issueAuthCredential',
  'createProvisioningSession',
  'connectNewDevice',
  'sendProvisioningMessage',
  'getProvisioningMessage',
  'completeProvisioning',
  'acknowledgeProvisioning',
  'rollbackProvisioning',
  'deleteProvisioningSession',
];

/** The optional members of the contract that this relay leaves out. */
const ABSENT = [
  'groupServer',
  'refreshGroupSendEndorsements',
  'fetchSenderCertificate',
  'sendMultiRecipientUnidentified',
];

test('a sent envelope waits in the mailbox and goes to a later subscriber', async () => {
  const relay = pageRelay();
  const receipt = await relay.send(envelope());
  assert.equal(receipt.messageId, 'msg-1');
  assert.equal(typeof receipt.serverTimestamp, 'number');

  const queued = relay.getPendingMessages('bob', 1);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].id, 'msg-1');
  assert.equal(queued[0].ciphertext, 'c2VhbGVk');

  const received = [];
  const unsubscribe = relay.subscribe('bob', 1, (delivered) => received.push(delivered));
  assert.equal(typeof unsubscribe, 'function', 'subscribe must return its unsubscribe synchronously');
  assert.deepEqual(
    received.map((delivered) => delivered.id),
    ['msg-1'],
  );

  /* Delivery to a live subscriber happens inside `send()`. */
  await relay.send(envelope({ ciphertext: 'c2Vjb25k' }));
  assert.deepEqual(
    received.map((delivered) => delivered.id),
    ['msg-1', 'msg-2'],
  );

  await relay.markDelivered('msg-1');
  assert.deepEqual(
    relay.getPendingMessages('bob', 1).map((pending) => pending.id),
    ['msg-2'],
  );
  unsubscribe();
});

test('the relay keeps no reference to what it was handed or what it handed out', async () => {
  const relay = pageRelay();
  const sent = envelope({ ciphertext: new Uint8Array([1, 2, 3]) });
  await relay.send(sent);
  sent.ciphertext[0] = 9;
  const [held] = relay.getPendingMessages('bob', 1);
  assert.deepEqual([...held.ciphertext], [1, 2, 3]);
  held.ciphertext[1] = 9;
  assert.deepEqual([...relay.getPendingMessages('bob', 1)[0].ciphertext], [1, 2, 3]);
});

test('a resend with the same client message id gets the first receipt', async () => {
  const relay = pageRelay();
  const first = await relay.send(envelope({ clientMessageId: 'c-1' }));
  const again = await relay.send(envelope({ clientMessageId: 'c-1' }));
  assert.deepEqual(again, first);
  assert.equal(relay.getPendingMessages('bob', 1).length, 1);

  /* The id is scoped to its sender. */
  const other = await relay.send(envelope({ clientMessageId: 'c-1', senderUserId: 'carol' }));
  assert.notEqual(other.messageId, first.messageId);
});

test('an ephemeral envelope reaches a live subscriber and is never queued', async () => {
  const relay = pageRelay();
  await relay.send(envelope({ deliveryClass: 'ephemeral' }));
  assert.equal(relay.getPendingMessages('bob', 1).length, 0);

  const received = [];
  const unsubscribe = relay.subscribe('bob', 1, (delivered) => received.push(delivered));
  await relay.send(envelope({ deliveryClass: 'ephemeral' }));
  assert.equal(received.length, 1);
  assert.equal(relay.getPendingMessages('bob', 1).length, 0);
  unsubscribe();
});

test('the device registry allocates, lists, and removes devices', async () => {
  const relay = pageRelay();
  assert.equal(await relay.registerDevice('bob', {}), 1);
  assert.equal(await relay.registerDevice('bob', { deviceType: 'desktop' }), 2);
  await assert.rejects(relay.registerDevice('bob', { deviceId: 0 }), /Device ID must be between 1 and/);

  assert.deepEqual(await relay.getActiveDevices('bob'), [
    { userId: 'bob', deviceId: 1 },
    { userId: 'bob', deviceId: 2 },
  ]);
  const [primary, linked] = await relay.getDevices('bob');
  assert.equal(primary.linked, false);
  assert.equal(linked.linked, true);

  await relay.send(envelope({ targetDeviceId: 2 }));
  await relay.removeDevice('bob', 2);
  assert.deepEqual(await relay.getActiveDevices('bob'), [{ userId: 'bob', deviceId: 1 }]);
  assert.equal(relay.getPendingMessages('bob', 2).length, 0);

  /* A removed id is free again. */
  assert.equal(await relay.registerDevice('bob', {}), 2);
});

test('a prekey bundle spends one one-time key of each kind', async () => {
  const relay = pageRelay();
  assert.equal(await relay.fetchPreKeyBundle('bob', 1), null, 'no identity, so no bundle');

  const identity = { version: 1, x25519: new Uint8Array(32).fill(1), ed25519: new Uint8Array(32).fill(2) };
  await relay.provisionIdentityKey({ userId: 'bob', deviceId: 1, identity, registrationId: 7 });
  await relay.uploadPreKeys('bob', 1, [
    { type: 'ecSignedPreKey', keyId: 1, publicKey: 'c3Br', signature: 'c2ln' },
    { type: 'kemLastResortPreKey', keyId: 2, publicKey: 'bHJr', signature: 'c2ln' },
    { type: 'ecPreKey', keyId: 10, publicKey: 'ZWMx' },
    { type: 'kemOneTimePreKey', keyId: 20, publicKey: 'a2Vt', signature: 'c2ln' },
  ]);
  assert.equal(await relay.getPreKeyCount('bob', 1, 'ec'), 1);

  const bundle = await relay.fetchPreKeyBundle('bob', 1, 'alice');
  assert.equal(bundle.registrationId, 7);
  assert.equal(bundle.ecOneTimePreKey.keyId, 10);
  assert.equal(bundle.kemOneTimePreKey.keyId, 20);
  assert.equal(bundle.kemLastResortPreKey.keyId, 2);

  const after = await relay.fetchPreKeyBundle('bob', 1, 'alice');
  assert.equal(after.ecOneTimePreKey, null);
  assert.equal(after.kemOneTimePreKey, null);

  /* A spent key that comes back in an upload is not served again. */
  await relay.uploadPreKeys('bob', 1, [{ type: 'ecPreKey', keyId: 10, publicKey: 'ZWMx' }]);
  assert.equal(await relay.getPreKeyCount('bob', 1, 'ec'), 0);

  const inventory = await relay.getPreKeyInventory('bob', 1);
  assert.equal(inventory.ecSignedPreKey.keyId, 1);
  assert.equal((await relay.getEcSignedPreKeyMetadata('bob', 1)).keyId, 1);
});

test('a group, credential, or provisioning call rejects and names the member', async () => {
  const relay = pageRelay();
  for (const member of REFUSED) {
    await assert.rejects(
      relay[member](),
      (error) =>
        error instanceof PageRelayUnsupportedError &&
        error.member === member &&
        error.message.startsWith(`${member} is not supported by the page relay`),
      `${member} did not reject with a named error`,
    );
  }
  for (const member of ABSENT) {
    assert.equal(relay[member], undefined, `${member} should be absent, so the client never reaches for it`);
  }
});

test('the connection state follows the live subscriptions and tells each listener once', () => {
  const relay = pageRelay();
  assert.equal(relay.relayConnectionState.state, 'stopped');

  const seen = [];
  const stopListening = relay.subscribeRelayConnectionState((state) => seen.push(state.state));

  const first = relay.subscribe('alice', 1, () => {});
  const second = relay.subscribe('bob', 1, () => {});
  assert.equal(relay.relayConnectionState.state, 'connected');
  assert.deepEqual(seen, ['connected'], 'a second subscription is not a transition');

  first();
  first();
  assert.equal(relay.relayConnectionState.state, 'connected', 'one subscription is still live');
  second();
  assert.equal(relay.relayConnectionState.state, 'stopped');
  assert.deepEqual(seen, ['connected', 'stopped']);

  stopListening();
  relay.subscribe('alice', 1, () => {})();
  assert.deepEqual(seen, ['connected', 'stopped'], 'an unsubscribed listener hears nothing');
});

test('a listener that throws does not stop the others, and its error is not lost', () => {
  const relay = pageRelay();
  const rethrown = [];
  const queue = globalThis.queueMicrotask;
  globalThis.queueMicrotask = (task) => rethrown.push(task);
  try {
    const seen = [];
    relay.subscribeRelayConnectionState(() => {
      throw new Error('listener failed');
    });
    relay.subscribeRelayConnectionState((state) => seen.push(state.state));
    relay.subscribe('alice', 1, () => {});
    assert.deepEqual(seen, ['connected']);
  } finally {
    globalThis.queueMicrotask = queue;
  }
  assert.equal(rethrown.length, 1);
  assert.throws(rethrown[0], /listener failed/);
});

test('a retry request reaches the original sender, now or when it subscribes', async () => {
  const relay = pageRelay();
  const request = { originalSenderUserId: 'alice', originalSenderDeviceId: 1, failedTimestamp: 5 };
  await relay.sendRetryRequest(request);

  const heard = [];
  const unsubscribe = relay.subscribeRetryRequests('alice', 1, async (r) => heard.push(r.failedTimestamp));
  assert.equal(typeof unsubscribe, 'function');
  assert.deepEqual(heard, [5]);

  await relay.sendRetryRequest({ ...request, failedTimestamp: 6 });
  assert.deepEqual(heard, [5, 6]);
  unsubscribe();
  await relay.sendRetryRequest({ ...request, failedTimestamp: 7 });
  assert.deepEqual(heard, [5, 6]);
});

/**
 * The page relay, with every member the SDK calls written down.
 *
 * A property read is not a call: the SDK may test for an optional member
 * before it uses one. So a method is recorded when it is called, and the
 * connection-state getter when it is read.
 */
function recordedRelay(called) {
  const relay = pageRelay();
  return new Proxy(relay, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string') return value;
      if (property === 'relayConnectionState') {
        called.add(property);
        return value;
      }
      if (typeof value !== 'function' || !(property in PageRelay.prototype || Object.hasOwn(target, property))) {
        return value;
      }
      return function (...args) {
        called.add(property);
        return value.apply(this === receiver ? target : this, args);
      };
    },
  });
}

/** Members a call path used that the relay does not carry. */
function uncarried(called) {
  return [...called].filter((member) => !CARRIED.has(member) && !member.startsWith('getPending'));
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

test('the one-to-one session path calls only what the page relay carries', async () => {
  const called = new Set();
  let corrupted = false;
  const session = await startDemoSession({
    relay: recordedRelay(called),
    logger: { sender: quiet, recipient: quiet },
    /* One corrupted envelope makes the receiving device ask for a resend, so
       the retry members are on the path too. */
    tamper: (sent) => {
      if (corrupted) return sent;
      corrupted = true;
      return { ...sent, ciphertext: btoa(btoa('not the ciphertext')) };
    },
  });
  try {
    await session.send('first');
    await session.send('second');
  } finally {
    await session.stop();
  }
  assert.deepEqual(uncarried(called), []);
  for (const member of ['send', 'subscribe', 'registerDevice', 'sendRetryRequest', 'subscribeRetryRequests']) {
    assert.ok(called.has(member), `${member} was never called, so this path does not prove it`);
  }
});

test('the two-device run calls only what the page relay carries', async () => {
  const called = new Set();
  const run = await startDemoRun({ relay: () => recordedRelay(called) });
  try {
    await run.activate('a');
    await run.activate('b');
    await run.exchangeKeys();
    await run.send('a', 'outbound');
    await run.send('b', 'reply');
    await run.reset();
    await run.activate('a');
  } finally {
    await run.stop();
  }
  assert.deepEqual(uncarried(called), []);
  for (const member of ['send', 'subscribe', 'registerDevice', 'fetchPreKeyBundle', 'provisionIdentityKey']) {
    assert.ok(called.has(member), `${member} was never called, so this path does not prove it`);
  }
});
