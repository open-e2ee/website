/*
 * The quickstart, with the two adapters the reader gets to choose.
 *
 * This file used to slice four segments out of the recorded capture and join
 * them with `…`. That was the right shape for an excerpt and the wrong one for
 * a panel with a copy button on it. An excerpt is read, and its elision marks
 * are honest about what was left out; but the moment a reader can copy the
 * thing, the omissions stop being disclosure and become a program that does
 * not run. Taking the marks out therefore had to take the gaps out with them.
 *
 * What is here is one complete program, short enough to read in a breath, in
 * which every line is true for every adapter the selector offers. That last
 * clause is the whole constraint, and it is stricter than it sounds — see
 * "Why the program is not simply the recording" below.
 *
 * Provenance is still the rule, but the rule had to change with the shape, and
 * saying so precisely matters more than sounding strict. The old claim was
 * "every line is lifted verbatim". That is no longer true and must not be
 * repeated: this is a usage example, not an excerpt. Five of its thirteen code
 * lines differ from the recording, and all five differ for one
 * reason — the recording drives both sides of a conversation in one process,
 * so it has an `alice` and a `bob` where an application has one client. Four
 * are that rename; the fifth is the comment beside it, which said "only on
 * Bob's device" and now says "only on this device", because in the reader's
 * application the device is theirs.
 *
 * What is still exactly true, and is what `tests/site-content.test.mjs`
 * checks: every import line is verbatim from the capture; the relay
 * construction, the identity, the adapters line and the message string are
 * verbatim; every remaining line matches the recording under that one rename;
 * and every method called on the client is one the recording calls. Nothing
 * about the API's shape was invented for the page, and the build audit
 * independently re-checks every symbol and subpath against the installed
 * package's own types.
 *
 * That is a statement about the default combination, which is the one the
 * capture was recorded with. The other nine swap an adapter, so a capture
 * cannot prove them: what holds those is the build audit checking every
 * `@open-e2ee/` specifier and named export against the installed types, and,
 * for the one line an adapter needs that is nobody's export, the provenance
 * written down beside the option itself.
 */

import capture from '../data/carrier-capture.json' with { type: 'json' };

export const installCommand = `npm install ${capture.packageName}`;

const PACKAGE = capture.packageName;

/*
 * Why the program is not simply the recording.
 *
 * The recorded quickstart drives both sides of a conversation inside one
 * process: it calls `relay.registerDevice()` twice and reads the queue back
 * with `relay.getPendingMessages()`. Both belong to the in-memory relay, and
 * they exist so that a quickstart can show a round trip with no server running.
 * `convexRelay` returns a different class and does not have them.
 *
 * So a snippet built by swapping the relay line of the recording would compile
 * in the reader's head and fail on their machine — the exact failure this site
 * spends its whole budget avoiding. The program below is the subset that is
 * true of any relay: construct, subscribe, send. It is the shape the SDK's own
 * `convexRelay` docstring uses, and it is what an application actually writes,
 * because an application owns one side of the conversation rather than both.
 *
 * `syncToServer()` is not here, and its absence is deliberate. The recording
 * calls it twice, once per client, so an earlier draft of this snippet carried
 * it too — but `client.d.ts` says it is "called automatically by create() when
 * a relay is configured" and exists to retry a failed first sync. A hero
 * snippet that spends a line on a call the previous line already made is
 * teaching a cargo cult, and a reader who checks the types finds that out.
 * The fact it was carrying — that your public prekeys go to the relay — is a
 * claim about the model, and the page makes it in prose where it belongs.
 *
 * It is a usage example rather than a self-contained script, and the
 * difference is worth being exact about: `signal.send("bob", …)` presumes a
 * `bob` who exists, which in an application he does and in a bare `node
 * file.js` he does not. The round trip is still on the page — /product carries
 * the whole 29-line recording, and the carrier panel below the fold shows the
 * ciphertext that running it produced. The hero shows the API; the capture
 * shows the result.
 */
/*
 * The device store, which is the runtime question.
 *
 * `expr` goes into `adapters.storage`. Three of the five factories are async
 * and are awaited here rather than quietly dropped — `indexedDbStore`,
 * `nodeStore` and `reactNativeStore` all return promises, and a snippet that
 * forgot the `await` would hand the client a pending promise where a store
 * belongs.
 *
 * `experimental` is not decoration. index.astro and /product both carry the
 * sentence "Browser and bare React Native stores are experimental; Expo and
 * Node are not", two tests hold them to it, and a selector that offered all
 * five as peers would be the one place on the page where that line is
 * contradicted by the thing it describes. The flag puts the word in the
 * option's own label, where the choice is actually made.
 */
export const storageOptions = [
  {
    id: 'memory',
    label: 'In-memory',
    subpath: 'local/store/memory',
    symbol: 'inMemoryStore',
    expr: 'inMemoryStore()',
    experimental: false,
  },
  {
    id: 'node',
    label: 'Node',
    subpath: 'local/store/node',
    symbol: 'nodeStore',
    expr: 'await nodeStore()',
    experimental: false,
  },
  {
    id: 'expo',
    label: 'Expo',
    subpath: 'local/store/expo',
    symbol: 'expoStore',
    /* The relay is passed in because the SDK's own docstring passes it in —
       the Expo store keeps remote sender state alongside the local keys. */
    expr: 'expoStore({ relay })',
    experimental: false,
  },
  {
    id: 'web',
    label: 'Browser',
    subpath: 'local/store/web',
    symbol: 'indexedDbStore',
    expr: 'await indexedDbStore()',
    experimental: true,
  },
  {
    id: 'react-native',
    label: 'React Native',
    subpath: 'local/store/react-native',
    symbol: 'reactNativeStore',
    /* `storage` is the reader's own object, and it has to be: the store's
       `ReactNativeKeyValueStorage` wants `atomicWrite` and `removeMany`, which
       AsyncStorage does not have. Naming a library here would be invented
       usage of somebody else's API — the one kind of false claim the build
       audit cannot catch, because the symbol would not be ours. The note says
       whose object it is instead of guessing at a package. */
    expr: 'await reactNativeStore({ storage })',
    experimental: true,
    comment: 'storage is your own ReactNativeKeyValueStorage implementation.',
  },
];

/*
 * The relay, which is the backend question.
 *
 * `setup` is the whole construction, not just a factory name, because the two
 * options differ in more than one: the in-memory one takes nothing, and the
 * Convex one takes a client the reader builds and an API their own `convex/`
 * directory generates. The `convexRelay({ convex, api: api.signal })` shape is
 * copied from the SDK's docstring, `api.signal` included.
 *
 * Those two names used to be explained instead of shown — "convex is your
 * ConvexClient, api your generated Convex API" — which is a caption on a
 * program that could just contain them, and a program that names something it
 * never binds is not one a reader can paste. `imports` is the fix, and the
 * lines in it are not composed here either:
 *
 *   `import { api } from "../convex/_generated/api";` is verbatim from the
 *   SDK's own usage docstring, dist/remote/relay/convex/index.d.ts.
 *
 *   `new ConvexReactClient(process.env.CONVEX_URL!)` is verbatim from the three
 *   places the SDK source constructs one — client/headless.ts (as
 *   `ConvexHttpClient`), remote/relay/convex/relay.ts and
 *   remote/relay/convex/group-server.ts. `ConvexClient` in the relay's types is
 *   the union of those two, so either satisfies it.
 *
 * The env var keeps the SDK's spelling. An application reads its Convex URL
 * however its bundler exposes one, and picking a different spelling here to
 * look more idiomatic would be guessing at somebody else's build — the same
 * mistake naming a React Native storage package would be, one option up.
 *
 * scripts/audit-build.mjs checks module specifiers under `@open-e2ee/` only, so
 * it does not re-check these two. That scope is right — they are not ours to
 * check — and it is why the provenance is written down here instead.
 */
export const relayOptions = [
  {
    id: 'memory',
    label: 'In-memory',
    subpath: 'remote/relay/memory',
    symbol: 'inMemoryRelay',
    setup: 'const relay = inMemoryRelay();',
    experimental: false,
  },
  {
    id: 'convex',
    label: 'Convex',
    subpath: 'remote/relay/convex',
    symbol: 'convexRelay',
    imports: [
      'import { ConvexReactClient } from "convex/react";',
      'import { api } from "../convex/_generated/api";',
    ],
    setup: [
      'const convex = new ConvexReactClient(process.env.CONVEX_URL!);',
      'const relay = convexRelay({ convex, api: api.signal });',
    ].join('\n'),
    experimental: false,
  },
];

/*
 * The comments the page writes, as opposed to the code the recording proves.
 *
 * These are the one part of the panel that is not traceable to the capture, and
 * naming them here rather than inlining them in `buildSnippet` is what lets
 * `tests/site-content.test.mjs` hold the line between the two: every code line
 * must still be in the recording under the rename, and every comment-only line
 * must be one of these. An editor who wants to say something new in the panel
 * has to say it here, where the test will notice.
 *
 * They exist because the panel was answering "what is the API" and not "what is
 * happening", and the second question is the one a reader arrives with. Each
 * one names the beat of the program it sits above: what the relay is, pass
 * adapters as values, receive, send.
 *
 * One of them also carries what used to sit under the panel in a
 * `<p class="code-note">` — that `storage`, in the bare React Native variant,
 * is an object the reader brings rather than something the SDK exports. Prose
 * below a copy button is read after the copy, if at all; a comment travels with
 * the paste.
 *
 * That note covered `convex` and `api` too, and those two are no longer
 * explained by anybody. The Convex option imports them. A comment saying where
 * a name comes from is a weaker version of a line that binds it, and the
 * stronger version was available the whole time — so the disclosure that
 * remains is the one with nothing importable behind it.
 *
 * The wording is held to design/DESIGN.md's fixed relay formula like any other
 * text on the site. It renders into the page, so `scripts/audit-build.mjs`
 * greps it, and it is a string rather than a real comment in this file, so the
 * absolutes guard in the test suite reads it too — neither of which would be
 * true if these lived in `//` comments here.
 */
/* What the relay is, rather than whose it is.

   This read "The relay is yours. Swapping it changes this line and nothing
   else" — an answer about ownership, given to a reader who does not yet know
   what the thing is, and an answer the two dropdowns above already give by
   being operable. The first question a name like `relay` raises is what it
   does with a message, so that is what the line says now.

   The mailbox is the frame: devices post envelopes to it and collect the ones
   left for them. `envelope` is the SDK's own noun for what travels —
   `relay.send({ ciphertext, … })` and `relay.subscribe(userId, deviceId, cb)`
   are literally post and collect — so the metaphor is the API's vocabulary
   rather than a picture laid over it.

   "Encrypted" and not "sealed", and this was the draft's mistake before a test
   caught it. Sealed sender is a real feature of this SDK, named on this page,
   and a round of fresh readers stopped on a loose "sealed" in the lead asking
   whether it meant that one — so the homepage may use the word only in the
   phrase "sealed sender", and a test on the built HTML holds it. The reasoning
   that produced the loose use here was that "sealed" describes the contents
   rather than the sender, which is true and did not help: a reader meets the
   word before the distinction. "Encrypted envelopes" is the page's own phrase
   for the same thing, three paragraphs below this panel.

   True of both options, which is the standing constraint on a fixed comment:
   `inMemoryRelay` is a mailbox in this process and `convexRelay` is a hosted
   one. */
const RELAY_COMMENT =
  '// The relay is the mailbox: devices post encrypted envelopes and collect their own.';
const ADAPTERS_COMMENT = '// Adapters are values you pass. Your keys stay in your store.';
const RECEIVE_COMMENT = '// Fires on this device, after the SDK decrypts.';
const SEND_COMMENT = '// Encrypted on this device before the relay carries it.';

export const snippetComments = [
  RELAY_COMMENT,
  ADAPTERS_COMMENT,
  RECEIVE_COMMENT,
  SEND_COMMENT,
  ...[...storageOptions, ...relayOptions]
    .map((option) => option.comment)
    .filter(Boolean)
    .map((comment) => `// ${comment}`),
];

/** The combination the capture was recorded with, and the one shown first. */
export const defaultVariant = { storage: 'memory', relay: 'memory' };

const specifier = (subpath) => `"${PACKAGE}/${subpath}"`;

/*
 * One program, assembled from the two choices.
 *
 * The body is fixed. What moves is the import an adapter needs and the
 * expression that constructs it — nothing below `createSignalProtocolClient`
 * changes for any of the ten — which is exactly the point the selector exists
 * to make: an adapter is a value your application passes, not a fork in your
 * application's code.
 */
export const buildSnippet = (storageId, relayId) => {
  const store = storageOptions.find((option) => option.id === storageId);
  const relay = relayOptions.find((option) => option.id === relayId);
  if (!store) throw new Error(`Unknown storage adapter: ${storageId}`);
  if (!relay) throw new Error(`Unknown relay adapter: ${relayId}`);

  return [
    `import { createSignalProtocolClient } from "${PACKAGE}";`,
    `import { ${store.symbol} } from ${specifier(store.subpath)};`,
    `import { ${relay.symbol} } from ${specifier(relay.subpath)};`,
    /* An adapter may need names the SDK does not export — the Convex relay
       needs a client and a generated API — and they belong in the import block
       with the rest, not in a comment underneath. Written for either side
       because nothing about this is particular to relays; no store needs one
       today. */
    ...(store.imports ?? []),
    ...(relay.imports ?? []),
    '',
    RELAY_COMMENT,
    ...(relay.comment ? [`// ${relay.comment}`] : []),
    relay.setup,
    '',
    'const signal = await createSignalProtocolClient({',
    '  identity: { userId: "alice" },',
    `  ${ADAPTERS_COMMENT}`,
    ...(store.comment ? [`  // ${store.comment}`] : []),
    `  adapters: { storage: ${store.expr}, relay },`,
    '});',
    '',
    RECEIVE_COMMENT,
    /* Receive first, then send. That is the order the SDK's own docstring uses
       (`client.d.ts`, the ServicesProvider example), and it is the order that
       is actually correct: `startRelaySubscription` is called automatically by
       `create()` only when a hook was already configured, so a hook registered
       afterwards needs the subscription started by hand. Sending last also
       puts the payoff on the last line. */
    'signal.registerHook("onMessageDecrypted", async (message) => {',
    '  console.log(message.content); // plaintext, only on this device',
    '});',
    'signal.startRelaySubscription();',
    '',
    SEND_COMMENT,
    'await signal.send("bob", "Ship it Thursday. The staging key rotates at 09:00 UTC.");',
  ].join('\n');
};

/*
 * Every combination, pre-rendered so the page needs no highlighter at runtime.
 *
 * The labels and the default flag are resolved here rather than in the
 * component. They were two small helpers in the template's frontmatter until
 * `astro check` pointed out that neither had a type — a `.mjs` lib gives the
 * arrays inferred shapes, but a standalone arrow taking one of them has no
 * contextual type to infer from, so `option` was `any` and a typo in `.label`
 * would have rendered `undefined` into an accessible name. Precomputing them
 * beside the data they describe is both the fix and the better place for them.
 */
export const snippetVariants = storageOptions.flatMap((store) =>
  relayOptions.map((relay) => ({
    storage: store.id,
    relay: relay.id,
    storageLabel: store.label,
    relayLabel: relay.label,
    isDefault: store.id === defaultVariant.storage && relay.id === defaultVariant.relay,
    experimental: store.experimental || relay.experimental,
    code: buildSnippet(store.id, relay.id),
  })),
);

export const heroCode = buildSnippet(defaultVariant.storage, defaultVariant.relay);
