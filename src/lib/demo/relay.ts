/**
 * The relay inside this page.
 *
 * The home-page demo, the playground, and the carrier capture all run two SDK
 * clients that talk through this object. It implements the SDK's
 * `SignalProtocolRelayServer` contract in page memory, so no envelope, key, or
 * device record leaves the page. The SDK documents this seam as the place for
 * an application-owned transport, and this site is that application.
 *
 * It carries one-to-one messages only. The members that a one-to-one exchange
 * calls are real: delivery, the device registry, account identity, prekeys,
 * the prekey inventory, and retry requests. The group, ZK credential, and
 * device-provisioning members throw `PageRelayUnsupportedError`. The optional
 * sealed-sender members are absent, so a client that the demo configures
 * without sealed sender never reaches for them.
 *
 * Delivery is synchronous. `send()` hands an envelope to every live
 * subscriber before it returns, and the demo's handoff mark depends on that
 * order.
 */
import { MAX_DEVICES } from '@open-e2ee/signal-protocol-sdk/device/constants';
import { compositeIdentitiesEqual, deriveIdentityCommitment } from '@open-e2ee/signal-protocol-sdk/keys';
import type { PublicKey, Signature } from '@open-e2ee/signal-protocol-sdk/keys';
import type {
  AccountIdentityProvisioning,
  AccountIdentityRotation,
  CompositeIdentityV1,
  DeviceInfo,
  DeviceRegistration,
  Envelope,
  GroupMemberDevice,
  IdentityType,
  PreKeyBundle,
  PreKeyInventory,
  PreKeyMetadata,
  PreKeyPublicationPlan,
  PreKeyUpload,
  RelayConnectionState,
  RetryRequest,
  SignalProtocolRelayServer,
  Unsubscribe,
} from '@open-e2ee/signal-protocol-sdk/remote/relay/types';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** A member of the relay contract that this page relay does not carry. */
export class PageRelayUnsupportedError extends Error {
  readonly member: string;

  constructor(member: string) {
    super(`${member} is not supported by the page relay. It carries one-to-one messages only.`);
    this.name = 'PageRelayUnsupportedError';
    this.member = member;
  }
}

function unsupported(member: string): Promise<never> {
  return Promise.reject(new PageRelayUnsupportedError(member));
}

/**
 * A copy that shares no mutable reference with the caller, as a relay across
 * a network would give.
 */
function copy<T>(value: T): T {
  return structuredClone(value);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function rowKey(userId: string, deviceId: number): string {
  return `${userId}:${deviceId}`;
}

function keyStoreKey(userId: string, deviceId: number, identityType: IdentityType = 'aci'): string {
  return `${userId}:${deviceId}:${identityType}`;
}

function identityKey(userId: string, identityType: IdentityType = 'aci'): string {
  return `${userId}:${identityType}`;
}

/**
 * One connection state and its listeners. A move to the same state emits
 * nothing. A listener that throws does not stop the others, and its error is
 * thrown again in a microtask.
 */
class ConnectionState {
  private value: RelayConnectionState = { state: 'stopped', since: Date.now() };
  private readonly listeners = new Set<(state: RelayConnectionState) => void>();

  get current(): RelayConnectionState {
    return this.value;
  }

  move(state: RelayConnectionState['state']): void {
    if (this.value.state === state) return;
    const next: RelayConnectionState = { state, since: Date.now() };
    this.value = next;
    for (const listener of [...this.listeners]) {
      try {
        listener(next);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  subscribe(listener: (state: RelayConnectionState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class PageRelay implements SignalProtocolRelayServer {
  private readonly connection = new ConnectionState();
  private readonly subscriptions = new Map<string, Array<(envelope: Envelope) => void>>();
  private liveSubscriptions = 0;
  private readonly pending = new Map<string, Envelope[]>();
  private readonly receipts = new Map<string, { messageId: string; serverTimestamp: number }>();
  private sent = 0;

  private readonly devices = new Map<string, DeviceInfo[]>();
  private readonly identities = new Map<string, CompositeIdentityV1>();
  private readonly registrationIds = new Map<string, number>();

  private readonly ecSignedPreKeys = new Map<string, PreKeyUpload>();
  private readonly kemLastResortPreKeys = new Map<string, PreKeyUpload>();
  private readonly ecPreKeys = new Map<string, PreKeyUpload[]>();
  private readonly kemOneTimePreKeys = new Map<string, PreKeyUpload[]>();
  private readonly consumedEcPreKeyIds = new Map<string, Set<number>>();
  private readonly consumedKemPreKeyIds = new Map<string, Set<number>>();
  private readonly ecSignedPreKeyMetadata = new Map<string, PreKeyMetadata>();
  private readonly kemLastResortPreKeyMetadata = new Map<string, PreKeyMetadata>();

  private readonly retryRequests = new Map<string, RetryRequest[]>();
  private readonly retrySubscriptions = new Map<string, Array<(request: RetryRequest) => Promise<void>>>();

  // --------------------------------------------------------------------------
  // Delivery
  // --------------------------------------------------------------------------

  async send(envelope: Envelope): Promise<{ messageId: string; serverTimestamp: number }> {
    const target = rowKey(envelope.targetUserId, envelope.targetDeviceId);
    // A client message id collapses a resend from the same sender only.
    const receiptKey = envelope.clientMessageId
      ? `${target}:${envelope.senderUserId ?? ''}:${envelope.clientMessageId}`
      : null;
    const existing = receiptKey ? this.receipts.get(receiptKey) : undefined;
    if (existing) return copy(existing);

    this.sent += 1;
    const messageId = `msg-${this.sent}`;
    const serverTimestamp = Date.now();
    const stored: Envelope = { ...copy(envelope), id: messageId, serverTimestamp };

    // An ephemeral envelope goes to live subscribers only and is never queued.
    if (envelope.deliveryClass !== 'ephemeral') {
      const queue = this.pending.get(target) ?? [];
      queue.push(stored);
      this.pending.set(target, queue);
      if (receiptKey) this.receipts.set(receiptKey, { messageId, serverTimestamp });
    }
    for (const onEnvelope of [...(this.subscriptions.get(target) ?? [])]) {
      onEnvelope(copy(stored));
    }
    return { messageId, serverTimestamp };
  }

  subscribe(userId: string, deviceId: number, onEnvelope: (envelope: Envelope) => void): Unsubscribe {
    const target = rowKey(userId, deviceId);
    const subscribers = this.subscriptions.get(target) ?? [];
    subscribers.push(onEnvelope);
    this.subscriptions.set(target, subscribers);
    this.liveSubscriptions += 1;
    this.connection.move('connected');

    // The queue goes to the new subscriber only.
    for (const envelope of this.pending.get(target) ?? []) {
      onEnvelope(copy(envelope));
    }

    let live = true;
    return () => {
      if (!live) return;
      live = false;
      const current = this.subscriptions.get(target) ?? [];
      const index = current.indexOf(onEnvelope);
      if (index >= 0) current.splice(index, 1);
      this.liveSubscriptions -= 1;
      if (this.liveSubscriptions === 0) this.connection.move('stopped');
    };
  }

  /**
   * `connected` while any envelope subscription on this relay is live, and
   * `stopped` otherwise. Every client on this relay reads the same value. The
   * page relay has no connection to lose, so it never reads `connecting` or
   * `reconnecting`.
   */
  get relayConnectionState(): RelayConnectionState {
    return this.connection.current;
  }

  subscribeRelayConnectionState(listener: (state: RelayConnectionState) => void): Unsubscribe {
    return this.connection.subscribe(listener);
  }

  async markDelivered(envelopeId: string): Promise<void> {
    for (const [target, queue] of this.pending) {
      const index = queue.findIndex((envelope) => envelope.id === envelopeId);
      if (index < 0) continue;
      queue.splice(index, 1);
      if (queue.length === 0) this.pending.delete(target);
      return;
    }
  }

  /** The envelopes queued for one device that it has not marked delivered. */
  getPendingMessages(userId: string, deviceId: number): Envelope[] {
    return copy(this.pending.get(rowKey(userId, deviceId)) ?? []);
  }

  // --------------------------------------------------------------------------
  // Devices
  // --------------------------------------------------------------------------

  async getDevices(userId: string): Promise<DeviceInfo[]> {
    return copy(this.devices.get(userId) ?? []);
  }

  async registerDevice(userId: string, device: DeviceRegistration): Promise<number> {
    const rows = this.devices.get(userId) ?? [];
    const occupied = new Set(rows.filter((row) => row.registered).map((row) => row.deviceId));
    const requested = device.deviceId;
    if (
      requested !== undefined &&
      (!Number.isInteger(requested) || requested < 1 || requested > MAX_DEVICES)
    ) {
      throw new Error(`Device ID must be between 1 and ${MAX_DEVICES}`);
    }
    const deviceId =
      requested ??
      Array.from({ length: MAX_DEVICES }, (_, index) => index + 1).find((id) => !occupied.has(id));
    if (deviceId === undefined || occupied.has(deviceId)) {
      throw new Error('Maximum devices limit reached');
    }

    const now = Date.now();
    const primary = deviceId === 1;
    const row: DeviceInfo = {
      deviceId,
      encryptedDeviceName: device.encryptedDeviceName ? copy(device.encryptedDeviceName) : undefined,
      deviceType: device.deviceType,
      registered: true,
      linked: !primary,
      enabled: true,
      createdAt: now,
      linkedAt: primary ? undefined : now,
    };
    const reused = rows.findIndex((candidate) => candidate.deviceId === deviceId);
    if (reused >= 0) rows[reused] = row;
    else rows.push(row);
    this.devices.set(userId, rows);
    return deviceId;
  }

  async removeDevice(userId: string, deviceId: number): Promise<void> {
    const row = (this.devices.get(userId) ?? []).find((candidate) => candidate.deviceId === deviceId);
    if (row) {
      row.registered = false;
      row.linked = false;
      row.enabled = false;
    }
    for (const identityType of ['aci', 'pni'] as const) {
      this.clearDeviceKeys(keyStoreKey(userId, deviceId, identityType));
    }
    this.pending.delete(rowKey(userId, deviceId));
  }

  async getActiveDevices(userId: string): Promise<GroupMemberDevice[]> {
    return (this.devices.get(userId) ?? [])
      .filter((row) => row.registered && row.enabled)
      .map((row) => ({ userId, deviceId: row.deviceId }));
  }

  // --------------------------------------------------------------------------
  // Account identity
  // --------------------------------------------------------------------------

  async provisionIdentityKey(request: AccountIdentityProvisioning): Promise<void> {
    const { userId, deviceId, identity, registrationId, identityType = 'aci' } = request;
    const account = identityKey(userId, identityType);
    const current = this.identities.get(account);
    if (current && !compositeIdentitiesEqual(current, identity)) {
      throw new Error(
        'Account identity already exists with a different composite tuple; explicit rotation required'
      );
    }
    this.identities.set(account, copy(identity));
    this.registrationIds.set(keyStoreKey(userId, deviceId, identityType), registrationId);
  }

  async rotateIdentityKey(request: AccountIdentityRotation): Promise<void> {
    const { userId, deviceId, identity, registrationId, identityType = 'aci' } = request;
    const account = identityKey(userId, identityType);
    const current = this.identities.get(account);
    if (!current) {
      throw new Error('Cannot rotate an account identity that has not been provisioned');
    }
    if (!sameBytes(deriveIdentityCommitment(current), request.expectedCurrentCommitment)) {
      throw new Error('Account identity rotation compare-and-swap failed');
    }
    if (compositeIdentitiesEqual(current, identity)) {
      throw new Error('Account identity rotation requires a different composite tuple');
    }
    this.identities.set(account, copy(identity));
    this.registrationIds.set(keyStoreKey(userId, deviceId, identityType), registrationId);
    // Every prekey of this account was signed by the retired identity.
    const prefix = `${userId}:`;
    const suffix = `:${identityType}`;
    for (const store of this.keyStores()) {
      for (const key of [...store.keys()]) {
        if (key.startsWith(prefix) && key.endsWith(suffix)) store.delete(key);
      }
    }
  }

  async getIdentityKey(userId: string, identityType?: IdentityType): Promise<CompositeIdentityV1 | null> {
    const identity = this.identities.get(identityKey(userId, identityType));
    return identity ? copy(identity) : null;
  }

  // --------------------------------------------------------------------------
  // Prekeys
  // --------------------------------------------------------------------------

  async uploadPreKeys(
    userId: string,
    deviceId: number,
    keys: PreKeyUpload[],
    identityType?: IdentityType
  ): Promise<void> {
    const key = keyStoreKey(userId, deviceId, identityType);
    const now = Date.now();
    for (const preKey of keys) {
      switch (preKey.type) {
        case 'ecPreKey':
          this.upsertOneTime(this.ecPreKeys, this.consumedEcPreKeyIds, key, preKey);
          break;
        case 'kemOneTimePreKey':
          this.upsertOneTime(this.kemOneTimePreKeys, this.consumedKemPreKeyIds, key, preKey);
          break;
        case 'ecSignedPreKey':
          this.ecSignedPreKeys.set(key, copy(preKey));
          this.ecSignedPreKeyMetadata.set(key, metadataFor(preKey, now));
          break;
        case 'kemLastResortPreKey':
          this.kemLastResortPreKeys.set(key, copy(preKey));
          this.kemLastResortPreKeyMetadata.set(key, metadataFor(preKey, now));
          break;
      }
    }
  }

  async fetchPreKeyBundle(
    userId: string,
    deviceId: number,
    _fetcherUserId?: string,
    identityType?: IdentityType
  ): Promise<PreKeyBundle | null> {
    const key = keyStoreKey(userId, deviceId, identityType);
    const identity = this.identities.get(identityKey(userId, identityType));
    const registrationId = this.registrationIds.get(key);
    const ecSignedPreKey = this.ecSignedPreKeys.get(key);
    if (!identity || registrationId === undefined || !ecSignedPreKey) return null;

    const ecOneTimePreKey = this.takeOneTime(this.ecPreKeys, this.consumedEcPreKeyIds, key);
    const kemOneTimePreKey = this.takeOneTime(this.kemOneTimePreKeys, this.consumedKemPreKeyIds, key);
    const kemLastResortPreKey = this.kemLastResortPreKeys.get(key) ?? null;

    // The upload carries plain base64 strings. The bundle brands them.
    return copy({
      registrationId,
      deviceId,
      identity,
      ecSignedPreKey: {
        keyId: ecSignedPreKey.keyId,
        publicKey: ecSignedPreKey.publicKey as PublicKey,
        signature: ecSignedPreKey.signature as Signature,
      },
      ecOneTimePreKey: ecOneTimePreKey
        ? { keyId: ecOneTimePreKey.keyId, publicKey: ecOneTimePreKey.publicKey as PublicKey }
        : null,
      kemLastResortPreKey: kemLastResortPreKey
        ? {
            keyId: kemLastResortPreKey.keyId,
            publicKey: kemLastResortPreKey.publicKey as PublicKey,
            signature: kemLastResortPreKey.signature as Signature,
          }
        : null,
      kemOneTimePreKey: kemOneTimePreKey
        ? {
            keyId: kemOneTimePreKey.keyId,
            publicKey: kemOneTimePreKey.publicKey as PublicKey,
            signature: kemOneTimePreKey.signature as Signature,
          }
        : null,
    });
  }

  async getPreKeyInventory(
    userId: string,
    deviceId: number,
    identityType?: IdentityType
  ): Promise<PreKeyInventory> {
    const key = keyStoreKey(userId, deviceId, identityType);
    return copy({
      ecSignedPreKey: this.ecSignedPreKeyMetadata.get(key) ?? null,
      kemLastResortPreKey: this.kemLastResortPreKeyMetadata.get(key) ?? null,
      ecOneTimePreKeyCount: this.ecPreKeys.get(key)?.length ?? 0,
      kemOneTimePreKeyCount: this.kemOneTimePreKeys.get(key)?.length ?? 0,
    });
  }

  async getPreKeyCount(
    userId: string,
    deviceId: number,
    type: 'ec' | 'kem',
    identityType?: IdentityType
  ): Promise<number> {
    const key = keyStoreKey(userId, deviceId, identityType);
    return (type === 'ec' ? this.ecPreKeys : this.kemOneTimePreKeys).get(key)?.length ?? 0;
  }

  async clearStaleKemPreKeys(
    userId: string,
    deviceId: number,
    identityType?: IdentityType
  ): Promise<{ cleared: number }> {
    const key = keyStoreKey(userId, deviceId, identityType);
    const cleared = this.kemOneTimePreKeys.get(key)?.length ?? 0;
    this.kemOneTimePreKeys.delete(key);
    return { cleared };
  }

  async publishPlannedPreKeys(
    userId: string,
    deviceId: number,
    plan: PreKeyPublicationPlan,
    identityType?: IdentityType
  ): Promise<void> {
    const uploads = await plan(await this.getPreKeyInventory(userId, deviceId, identityType));
    if (uploads.length === 0) return;
    await this.uploadPreKeys(userId, deviceId, [...uploads], identityType);
  }

  async getEcSignedPreKeyMetadata(
    userId: string,
    deviceId: number,
    identityType?: IdentityType
  ): Promise<PreKeyMetadata | null> {
    const metadata = this.ecSignedPreKeyMetadata.get(keyStoreKey(userId, deviceId, identityType));
    return metadata ? copy(metadata) : null;
  }

  async getKemLastResortPreKeyMetadata(
    userId: string,
    deviceId: number,
    identityType?: IdentityType
  ): Promise<PreKeyMetadata | null> {
    const metadata = this.kemLastResortPreKeyMetadata.get(keyStoreKey(userId, deviceId, identityType));
    return metadata ? copy(metadata) : null;
  }

  // --------------------------------------------------------------------------
  // Retry requests
  // --------------------------------------------------------------------------

  async sendRetryRequest(request: RetryRequest): Promise<void> {
    const target = rowKey(request.originalSenderUserId, request.originalSenderDeviceId);
    const queue = this.retryRequests.get(target) ?? [];
    queue.push(copy(request));
    this.retryRequests.set(target, queue);
    for (const handler of [...(this.retrySubscriptions.get(target) ?? [])]) {
      await handler(copy(request));
    }
  }

  subscribeRetryRequests(
    userId: string,
    deviceId: number,
    handler: (request: RetryRequest) => Promise<void>
  ): Unsubscribe {
    const target = rowKey(userId, deviceId);
    const handlers = this.retrySubscriptions.get(target) ?? [];
    handlers.push(handler);
    this.retrySubscriptions.set(target, handlers);
    for (const request of this.retryRequests.get(target) ?? []) {
      void handler(copy(request));
    }
    return () => {
      const current = this.retrySubscriptions.get(target) ?? [];
      const index = current.indexOf(handler);
      if (index >= 0) current.splice(index, 1);
    };
  }

  // --------------------------------------------------------------------------
  // Members this relay does not carry
  // --------------------------------------------------------------------------

  createGroupState(): Promise<never> {
    return unsupported('createGroupState');
  }

  getGroupState(): Promise<never> {
    return unsupported('getGroupState');
  }

  getGroupJoinInfo(): Promise<never> {
    return unsupported('getGroupJoinInfo');
  }

  getGroupChanges(): Promise<never> {
    return unsupported('getGroupChanges');
  }

  submitGroupChange(): Promise<never> {
    return unsupported('submitGroupChange');
  }

  issueAuthCredential(): Promise<never> {
    return unsupported('issueAuthCredential');
  }

  createProvisioningSession(): Promise<never> {
    return unsupported('createProvisioningSession');
  }

  connectNewDevice(): Promise<never> {
    return unsupported('connectNewDevice');
  }

  sendProvisioningMessage(): Promise<never> {
    return unsupported('sendProvisioningMessage');
  }

  getProvisioningMessage(): Promise<never> {
    return unsupported('getProvisioningMessage');
  }

  completeProvisioning(): Promise<never> {
    return unsupported('completeProvisioning');
  }

  acknowledgeProvisioning(): Promise<never> {
    return unsupported('acknowledgeProvisioning');
  }

  rollbackProvisioning(): Promise<never> {
    return unsupported('rollbackProvisioning');
  }

  deleteProvisioningSession(): Promise<never> {
    return unsupported('deleteProvisioningSession');
  }

  // --------------------------------------------------------------------------

  private upsertOneTime(
    store: Map<string, PreKeyUpload[]>,
    consumed: Map<string, Set<number>>,
    key: string,
    preKey: PreKeyUpload
  ): void {
    // A consumed one-time key is never served twice, even if uploaded again.
    if (consumed.get(key)?.has(preKey.keyId)) return;
    const rows = store.get(key) ?? [];
    const index = rows.findIndex((row) => row.keyId === preKey.keyId);
    if (index >= 0) rows[index] = copy(preKey);
    else rows.push(copy(preKey));
    store.set(key, rows);
  }

  private takeOneTime(
    store: Map<string, PreKeyUpload[]>,
    consumed: Map<string, Set<number>>,
    key: string
  ): PreKeyUpload | null {
    const rows = store.get(key);
    const taken = rows?.shift() ?? null;
    if (rows && rows.length === 0) store.delete(key);
    if (taken) {
      const ids = consumed.get(key) ?? new Set<number>();
      ids.add(taken.keyId);
      consumed.set(key, ids);
    }
    return taken;
  }

  private keyStores(): Array<Map<string, unknown>> {
    return [
      this.ecSignedPreKeys,
      this.kemLastResortPreKeys,
      this.ecPreKeys,
      this.kemOneTimePreKeys,
      this.consumedEcPreKeyIds,
      this.consumedKemPreKeyIds,
      this.ecSignedPreKeyMetadata,
      this.kemLastResortPreKeyMetadata,
    ];
  }

  private clearDeviceKeys(key: string): void {
    this.registrationIds.delete(key);
    for (const store of this.keyStores()) store.delete(key);
  }
}

function metadataFor(preKey: PreKeyUpload, now: number): PreKeyMetadata {
  return { keyId: preKey.keyId, createdAt: now, expiresAt: now + THIRTY_DAYS_MS, publicKey: preKey.publicKey };
}

/** A new, empty relay inside this page. */
export function pageRelay(): PageRelay {
  return new PageRelay();
}
