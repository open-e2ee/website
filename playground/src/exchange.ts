/*
 * The exchange that /playground runs.
 *
 * Two SDK clients talk through `pageRelay()`, the relay that this website owns.
 * It implements the SDK's `SignalProtocolRelayServer` contract in the memory of
 * this tab, so no envelope, key, or device record leaves the page. Every other
 * call here is a public SDK call. An application that connects separate devices
 * uses the OpenE2EE Signal Protocol Relay or a relay of its own in place of
 * `pageRelay()`.
 */
import { createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import { pageRelay } from '../../src/lib/demo/relay.ts';

type Client = Awaited<ReturnType<typeof createSignalProtocolClient>>;

export async function runExchange(message: string, log: (line: string) => void): Promise<void> {
  if (!message.trim() || message.length > 2000) {
    throw new Error('Enter a message with 1 to 2000 characters.');
  }

  const relay = pageRelay();
  const aliceId = await relay.registerDevice('alice', { encryptedDeviceName: new ArrayBuffer(0) });
  const bobId = await relay.registerDevice('bob', { encryptedDeviceName: new ArrayBuffer(0) });
  const clients: Client[] = [];

  try {
    log('Create Alice and Bob with separate keys and stores.');
    const alice = await createSignalProtocolClient({
      identity: { userId: 'alice', deviceId: aliceId },
      adapters: { storage: inMemoryStore(), relay },
    });
    clients.push(alice);
    const bob = await createSignalProtocolClient({
      identity: { userId: 'bob', deviceId: bobId },
      adapters: { storage: inMemoryStore(), relay },
    });
    clients.push(bob);

    async function deliver(sender: Client, receiver: Client, recipient: string, deviceId: number, text: string) {
      await sender.send(recipient, text);
      const envelopes = relay.getPendingMessages(recipient, deviceId);
      const envelope = envelopes.find((item) => item.messageType !== 'server_delivery_receipt');
      if (!envelope) throw new Error('The relay did not receive an encrypted envelope.');
      const payload = envelope.ciphertext;
      const preview = typeof payload === 'string'
        ? payload.slice(0, 48)
        : Array.from(payload.slice(0, 24), (byte) => byte.toString(16).padStart(2, '0')).join('');
      log(`Relay → ${recipient}: ${payload.length} ${typeof payload === 'string' ? 'base64 characters' : 'bytes'} of ciphertext`);
      log(`Ciphertext prefix: ${preview}…`);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          receiver.stopRelaySubscription();
          reject(new Error(`No decrypted message reached ${recipient} within 30 seconds.`));
        }, 30_000);
        receiver.registerHook('onMessageDecrypted', async (decrypted) => {
          clearTimeout(timer);
          receiver.stopRelaySubscription();
          if (decrypted.content !== text) {
            reject(new Error('The decrypted message did not match the sent message.'));
            return;
          }
          log(`${recipient} decrypted: ${decrypted.content}`);
          resolve();
        });
        receiver.startRelaySubscription();
      });
    }

    await deliver(alice, bob, 'bob', bobId, message);
    await deliver(bob, alice, 'alice', aliceId, `Received: ${message}`);
    log('PASS: both devices decrypted the expected messages.');
  } finally {
    for (const client of clients) client.stopRelaySubscription();
  }
}
