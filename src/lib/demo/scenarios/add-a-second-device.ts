/*
 * Link a second device to an account mid-conversation, and look at what it can
 * and cannot read.
 *
 * The interesting fact about a linked device is not that linking works. It is
 * that the device arrives with no history and cannot be given any: every
 * message sent before it existed was sealed to the devices that existed, and
 * nothing about adding a device goes back and re-seals them. Applications built
 * on this protocol have to have an answer for that, and the answer is a product
 * decision rather than a protocol one — so this scenario runs the handshake and
 * then prints both devices' scroll-backs side by side, which is the whole
 * argument in one picture.
 *
 * Everything here is the shipped SDK's own provisioning surface: the QR code
 * comes from `generateProvisioningQR`, the new device answers with
 * `connectToProvisioningSession`, the primary encrypts the account identity to
 * that key with `provisionDevice`, and `receiveProvisioningMessage` decrypts it
 * and takes the device id the relay assigns. Both devices are in this tab, so
 * the page plays both parts and calls them in order; a real new device would be
 * polling for the message its primary is about to send.
 *
 * The step a reader is most likely to expect the SDK to do for them is the one
 * this page does by hand: after the link, the sender fetches the new device's
 * prekey bundle and establishes a session with it. That call is in the printed
 * program because it is what makes the second message reach two devices.
 */

/* demo:code:start */
import { ProtocolAddress, createSignalProtocolClient } from '@open-e2ee/signal-protocol-sdk';
import { inMemoryStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import {
  connectToProvisioningSession,
  generateProvisioningQR,
  parseProvisioningQR,
  provisionDevice,
  receiveProvisioningMessage,
} from '@open-e2ee/signal-protocol-sdk/device/provisioning';
import { startDemoSession } from '../driver.ts';
/* demo:code:end */
import type { InMemorySignalProtocolStore } from '@open-e2ee/signal-protocol-sdk/local/store/memory';
import type { ProvisioningIdentityStore } from '@open-e2ee/signal-protocol-sdk/device/provisioning';
import { captureScenarioLog, type ScenarioLogRecord } from './log.ts';

export { describePayload } from './log.ts';

/** What the sender was told about one message. A success, both times. */
export interface AcceptedMessage {
  text: string;
  messageId: string;
  /** The SDK's own count of the devices it encrypted this message to. */
  recipientDeviceCount: number;
}

/** What one device of the receiving account can read, in the order it read it. */
export interface DeviceScrollback {
  deviceId: number;
  /** The scenario's name for the device, not the relay's. */
  label: string;
  messages: string[];
}

export interface LinkedDevice {
  /** Assigned by the relay when it completed the link, not chosen here. */
  deviceId: number;
  /** The URL the primary device would have put in a QR code. */
  qrCodeUrl: string;
  deviceName: string;
  platform: string;
}

export interface SecondDeviceResult {
  /** Sent while the account had one device. */
  before: AcceptedMessage;
  /** Sent after the link, or `null` if it never arrived everywhere. */
  after: AcceptedMessage | null;
  linked: LinkedDevice;
  /** Every device of the receiving account, primary first. */
  scrollback: DeviceScrollback[];
  /** Every record at info and above, from all three devices, in logging order. */
  records: ScenarioLogRecord[];
  /** How many records the SDK emitted at debug, which this does not print. */
  debugRecords: number;
}

const BEFORE = 'The gate code is 4417, and it changes at midnight.';
const AFTER = 'Change of plan — the north gate, an hour later.';

/*
 * How the new device describes itself.
 *
 * Provisioning takes this from the device rather than reading a platform,
 * which is why the SDK's provisioning module has no platform imports in it at
 * all: the caller says what it is running on. This one is a browser tab, and
 * says so.
 */
const NEW_DEVICE = {
  deviceName: 'The second device',
  platform: 'web',
  appVersion: 'open-e2ee.dev/demo',
  osVersion: 'this browser tab',
};

/** What the primary device shares about the account while linking. */
const PROFILE = { name: 'The reader' };

/*
 * How long the second message is given to reach both devices.
 *
 * `send()` resolves once every linked device has decrypted, so a change that
 * stopped the new device from receiving would leave the page waiting on a
 * promise that never settles, with nothing for a reader to see. The run takes
 * a few hundred milliseconds where this was written; ten seconds is far past
 * any real answer and far short of a reader's patience.
 */
const DELIVERY_TIMEOUT_MS = 10000;

/*
 * The store, as provisioning asks for it.
 *
 * `ProvisioningIdentityStore` is `getIdentityKey`/`storeIdentityKey` plus a
 * `deleteIdentityKey` that the SDK's own `inMemoryStore()` does not implement —
 * provisioning needs it to unwind a half-written identity when a link fails
 * part-way. Nothing here fakes the write path: the two methods that matter go
 * straight to the store. The rollback is reported rather than performed,
 * because there is no delete to call and a silent no-op would be a store that
 * lies about having cleaned up.
 */
function provisioningIdentityStore(
  store: InMemorySignalProtocolStore,
  onRollback: (what: string) => void,
): ProvisioningIdentityStore {
  return {
    getIdentityKey: (identityType) => store.getIdentityKey(identityType),
    storeIdentityKey: (keyPair, identityType) => store.storeIdentityKey(keyPair, identityType),
    deleteIdentityKey: async (identityType) => {
      onRollback(identityType);
    },
  };
}

export async function runAddASecondDevice(): Promise<SecondDeviceResult> {
  /* One logger per device, each tagging its own records, so the printed log can
     say which of the three spoke. */
  const log = captureScenarioLog();

  /* Provisioning unwinding an identity key is a failed link, and this scenario
     has nothing to say about a failed link — but it must not swallow one
     either, so it is recorded where the reader can see it. */
  const rolledBack: string[] = [];
  const onRollback = (identityType: string) => {
    rolledBack.push(identityType);
    log.records.push({
      role: 'new device',
      level: 'error',
      message: 'Provisioning rolled back an identity key',
      payload: [{ identityType }],
    });
  };

  /* demo:code:start */
  const session = await startDemoSession({
    logger: { sender: log.for('sender'), recipient: log.for('primary device') },
  });
  const { relay, recipient } = session;

  /* One message while the account has one device. */
  const before = await session.send(BEFORE);

  /* The primary device shows a QR code; the new device scans it and answers
     with an ephemeral key of its own. */
  const link = await generateProvisioningQR(relay, recipient);
  const scanned = parseProvisioningQR(link.qrCodeUrl);
  const newDevice = await connectToProvisioningSession(relay, scanned.sessionId, NEW_DEVICE);

  /* The primary encrypts the account identity to that key. Both devices are in
     this tab, so the page calls the two halves in order; a real new device
     would be polling for the message its primary is about to send. */
  const secondStorage = inMemoryStore();
  await provisionDevice(
    relay,
    PROFILE,
    link.sessionId,
    link.ephemeralKeyPair.privateKey,
    newDevice.publicKey,
    recipient,
    { identityStore: provisioningIdentityStore(session.recipientStorage, onRollback) },
  );
  const linked = await receiveProvisioningMessage(
    relay,
    scanned.sessionId,
    newDevice.privateKey,
    scanned.primaryEphemeralPublicKey,
    {
      identityStore: provisioningIdentityStore(secondStorage, onRollback),
      deviceMetadata: NEW_DEVICE,
    },
  );

  /* The new device is a client like any other, on storage that now holds the
     account identity the primary sent it. The relay assigned its device id. */
  const second = await createSignalProtocolClient({
    identity: { userId: recipient, deviceId: linked.deviceId },
    adapters: { storage: secondStorage, relay },
    logger: log.for('new device'),
  });
  session.watchRecipientDevice(second);
  await second.syncToServer();

  /* And this is the part an application has to do itself: fetch the new
     device's prekey bundle and establish a session with it. */
  const bundle = await relay.fetchPreKeyBundle(recipient, linked.deviceId, session.sender);
  if (!bundle) {
    throw new Error(`the relay published no prekey bundle for the device it linked as ${linked.deviceId}`);
  }
  await session.senderClient.establishSession(
    ProtocolAddress.create(recipient, linked.deviceId),
    bundle,
  );

  /* One message after. */
  const after = await Promise.race([
    session.send(AFTER),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), DELIVERY_TIMEOUT_MS)),
  ]);
  /* demo:code:end */

  try {
    if (rolledBack.length > 0) {
      throw new Error(
        `provisioning unwound ${rolledBack.join(' and ')} identity material, so the device was ` +
          `never linked and this run has nothing to compare`,
      );
    }

    /* Read off the devices themselves rather than off a list this scenario
       kept: what a device can show a reader is what its own client decrypted,
       and a scenario that assembled that from the sends would be printing its
       own arithmetic instead of the protocol's. */
    const labels = new Map([
      [session.recipientClient.deviceId, 'The device that was already there'],
      [linked.deviceId, NEW_DEVICE.deviceName],
    ]);
    const scrollback = session.recipientDevices.map((device) => ({
      deviceId: device.deviceId,
      label: labels.get(device.deviceId) ?? `Device ${device.deviceId}`,
      messages: device.received.map((message) => message.content),
    }));

    return {
      before: {
        text: before.text,
        messageId: before.result.messageId,
        recipientDeviceCount: before.result.recipientDeviceCount,
      },
      after: after && {
        text: after.text,
        messageId: after.result.messageId,
        recipientDeviceCount: after.result.recipientDeviceCount,
      },
      linked: {
        deviceId: linked.deviceId,
        qrCodeUrl: link.qrCodeUrl,
        deviceName: NEW_DEVICE.deviceName,
        platform: NEW_DEVICE.platform,
      },
      scrollback,
      records: log.records,
      debugRecords: log.debugRecords,
    };
  } finally {
    /* Every run links its own device onto its own pair of accounts, so every
       run puts all three away. A second press has to start from an account
       with one device again, or the scenario would be showing the reader a
       third device joining a conversation it never saw the start of. */
    await session.stop();
  }
}
