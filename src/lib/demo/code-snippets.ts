/*
 * What a reader would have to type to cause each step, read off `run.ts`.
 *
 * Three of the eleven steps are not caused by an app call at all — the relay
 * accepting an envelope, the network carrying it, the relay handing it on —
 * and the honest thing to show under those is that they are not app calls,
 * not an invented snippet that looks like one. `idle` joins them: it is the
 * state before any client exists, so there is nothing yet to call.
 *
 * `Record<Step, CodeSnippet>` rather than a lookup with a default: a step
 * added to the protocol without an entry here is a type error at build time
 * instead of a blank pane a reader finds by clicking.
 */

import type { Step } from './trace.ts';

/**
 * A call, or an admission that there isn't one.
 *
 * A union rather than one shape with an optional `code`, so the log pane
 * cannot render an empty code block for a step that never had a call to show.
 */
export type CodeSnippet =
  | { readonly kind: 'call'; readonly code: string }
  | { readonly kind: 'note'; readonly text: string };

/** The one language every snippet here is written in. */
export const CODE_LANGUAGE = 'typescript';

export const CODE_SNIPPETS: Record<Step, CodeSnippet> = {
  idle: {
    kind: 'note',
    text: 'Before anything runs: no client exists yet, so there is no call to show.',
  },

  /* `run.ts`'s `makeDevice()`: the first thing a device sends over its
     connection, before it has made a single key. The device name is encrypted
     because even it is not the relay's business. */
  registered: {
    kind: 'call',
    code: 'await relay.registerDevice(userId, { encryptedDeviceName });',
  },

  /* The same call as `devices-ready` below, shown by the one argument that
     makes the generation visible: the keys are made inside `create()`, and
     `onProgress` is the only thing that says so while it is happening. */
  'generating-keys': {
    kind: 'call',
    code: `const client = await SignalProtocolClient.create(userId, {
  ...config,
  onProgress: ({ stage, detail }) => {
    // detail?.current of detail?.total, once a batch is generated
  },
});`,
  },

  /* `run.ts`'s `makeDevice()`: composed rather than `createSignalProtocolClient`,
     because that composition is the seam `onProtocolSelected` lives on. */
  'devices-ready': {
    kind: 'call',
    code: `const config = createSignalProtocolClientConfig({
  identity: { userId },
  adapters: { storage: inMemoryStore(), relay },
});
const client = await SignalProtocolClient.create(userId, config);`,
  },

  'bundles-published': {
    kind: 'call',
    code: 'await client.syncToServer();',
  },

  /* `run.ts`'s `ensureSession()`: the bundle has to be fetched before it can
     be agreed against, and both calls are the developer's, not the relay's. */
  'session-established': {
    kind: 'call',
    code: `const bundle = await relay.fetchPreKeyBundle(toUserId, toDeviceId, fromUserId);
await client.establishSession(toAddress, bundle);`,
  },

  encrypted: {
    kind: 'call',
    code: 'const result = await client.send(toUserId, text);',
  },

  'in-transit': {
    kind: 'note',
    text: 'The network carrying the envelope toward the relay — not something an app calls.',
  },

  'stored-at-relay': {
    kind: 'note',
    text: 'The relay accepting and holding the envelope — the relay’s doing, not the app’s.',
  },

  delivered: {
    kind: 'note',
    text: 'The relay handing the envelope to the far device — again the relay, not an app call.',
  },

  /* `run.ts` never calls a `decrypt()` of its own — the hook is what receives
     a plaintext the SDK already produced, and it is the one call a reader
     would write to be told about it. */
  opened: {
    kind: 'call',
    code: `client.registerHook('onMessageDecrypted', (message) => {
  // message.content is the plaintext
});`,
  },
};
