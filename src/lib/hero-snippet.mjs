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
 * Provenance is the rule, and the rule is the strict one again: every code
 * line here is lifted verbatim from the recording. It was not, for a while.
 * The panel used to show one client called `signal`, which cost four renamed
 * lines and a reworded comment, and `tests/site-content.test.mjs` had to
 * license exactly that rename to keep checking anything. Showing both devices
 * gave the licence back — `alice` and `bob` are the recording's own names, so
 * the test undoes nothing before it looks a line up.
 *
 * What that check means: every import line, the relay construction, both
 * identities, both adapters lines, the hook, the subscription and the message
 * string appear in the capture as written. Nothing about the API's shape was
 * invented for the page, and the build audit independently re-checks every
 * symbol and subpath against the installed package's own types.
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
 * `convexRelay` docstring uses.
 *
 * It shows both sides of the conversation, which an earlier draft argued
 * against — an application owns one client, so the panel showed one. That
 * reasoning answered the wrong question. A reader at the top of this page is
 * not yet writing their application; they are working out what an encrypted
 * conversation costs them, and one client sending to a string called "bob"
 * leaves the other half of that to imagination. Two clients and one relay is
 * the whole shape in nine lines.
 *
 * The two blocks are labelled as devices, and the label is doing real work
 * rather than decorating. With the in-memory store the listing runs exactly as
 * written, both devices in one process, which is what the recording did. With
 * the four device stores it does not: `indexedDbStore()` takes no arguments
 * and opens one fixed database name, and the Node, Expo and React Native
 * stores are the same kind of thing, so two clients in one runtime would share
 * one device's keys. That is why `ALICE_COMMENT` says each device runs its own
 * half in an application. The lines stay true of any store — each is a real
 * call on a real device — and the disclosure travels with the paste.
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
 * `await alice.send("bob", …)` needs a `bob` with published prekeys, and the
 * block above it is now what publishes them: `create()` syncs to the relay on
 * its own when one is configured, which is the same fact `syncToServer()` was
 * dropped for. So the send has its recipient in the listing rather than in the
 * reader's assumptions.
 *
 * The round trip is still on the page in fuller form — /product carries the
 * whole 29-line recording, and the carrier panel below the fold shows the
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
 * `experimental` is not decoration. When the installed SDK marks a store
 * experimental in ADAPTERS.md, the flag puts the word in the option's own
 * label, where the choice is actually made, and a test holds the selector to
 * exactly the SDK's markers. No store carries the marker now, so every flag is
 * false, and the machinery stays for the next store that ships experimental.
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
    experimental: false,
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
    experimental: false,
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
 * These are the part of the panel that is not traceable to the capture, and
 * naming them here rather than inlining them in `buildSnippet` is what lets
 * `tests/site-content.test.mjs` hold the line between the two: the code half
 * of every line must be in the recording, and every comment on it must be one
 * of these. An editor who wants to say something new in the panel has to say
 * it here, where the test will notice.
 *
 * `PLAINTEXT_COMMENT` is the exception and is declared anyway. It comes from
 * the recording rather than from the page, so the capture would prove it — but
 * it renders as a comment, and a comment the declared list does not contain is
 * a comment the absolutes guard does not read. The list is what the panel
 * says, not what the panel invented.
 *
 * They exist because the panel was answering "what is the API" and not "what is
 * happening", and the second question is the one a reader arrives with. Each
 * one names the beat of the program it sits on: what the relay is, whose
 * device this is, where the keys stay, when the hook fires, what is encrypted.
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

   Post and collect is the frame, and `envelope` is the SDK's own noun for what
   travels: `relay.send({ ciphertext, … })` and `relay.subscribe(userId,
   deviceId, cb)` are literally those two verbs, so the picture is the API's
   vocabulary rather than one laid over it.

   It rides on the construction, which took the sentence down from 84
   characters to 53 and decided what came off. "The relay is the mailbox" was a
   metaphor spent on a noun the next word defines anyway. "Encrypted" went with
   it, and is not gone from the panel: the send says what is encrypted, where,
   and when, which is the stronger place for the claim.

   Losing that word was also a hazard removed. Sealed sender is a real feature
   of this SDK, named on this page, and a round of fresh readers stopped on a
   loose "sealed" in the lead asking whether it meant that one — so the homepage
   may use the word only in the phrase "sealed sender", and a test on the built
   HTML holds it. This line reached for "sealed" first for exactly the reason
   that fails: it describes the contents rather than the sender, which is true
   and does not help a reader who meets the word before the distinction.

   True of both options, which is the standing constraint on a fixed comment:
   devices post to `inMemoryRelay` in this process and to `convexRelay` over the
   network, and collect from either the same way.

   Exported, alone among the six, because it is the one whose place in the
   listing depends on the option chosen. A test that only knew the comment
   existed could not tell the fallback below from the comment being dropped. */
export const relayComment = '// Devices post and collect envelopes from the relay.';
/*
 * The ones that ride on a line of code, and the width that shapes them.
 *
 * Every comment here but the send's is a trailing one, which is worth six
 * lines of panel — the program is 22 lines and was 28. The cost is that a
 * trailing comment is spent from a width budget rather than given a line, and
 * the budget is measurable: 108 characters at 1280, 97 at 1024. Each of these
 * is written to the room left after the longest code it can land on, which is
 * React Native's 67-character adapters line.
 *
 * Nothing overruns 1280. Below it two do, and both are known: React Native's
 * adapters line is 101 characters with its comment and scrolls under a 1120px
 * viewport, and Convex's construction takes `PANEL_COLUMNS` off the trailing
 * position entirely, so its comment is a line rather than a scrollbar. All
 * three figures are measured in a browser, not estimated from a font size.
 *
 * So they say one thing each, and the thing they say is the one the code does
 * not. `adapters:` shows that an adapter is a value you pass, so its comment
 * spends the room on where the keys go instead. `bob.registerHook` names the
 * device, so its comment spends the room on when the hook fires.
 *
 * Bob's label carries the disclosure rather than Alice's, and that is a change
 * of position as well as of length: two clients in one listing raise the
 * question at the second one, not the first. With a device store the second
 * block belongs on a second device — `indexedDbStore()` takes no argument and
 * opens one fixed database name — and the label is where a reader is told so.
 */
const ADAPTERS_COMMENT = '// Your keys stay in your store.';
const ALICE_COMMENT = "// Alice's device.";
const BOB_COMMENT = "// Bob's device. In an app, each runs its own.";
const RECEIVE_COMMENT = '// Fires after the SDK decrypts.';
const PLAINTEXT_COMMENT = "// plaintext, only on Bob's device";
const SEND_COMMENT = "// Encrypted on Alice's device before the relay carries it.";

export const snippetComments = [
  relayComment,
  ALICE_COMMENT,
  ADAPTERS_COMMENT,
  BOB_COMMENT,
  RECEIVE_COMMENT,
  PLAINTEXT_COMMENT,
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
 * What fits on one line of the panel, measured rather than guessed.
 *
 * The pre is 1130px of 18px monospace at 1280 and scales down with the page,
 * so this is the widest viewport's budget: 108 characters render inside it and
 * 109 overrun it by 12px. Every width below 1280 is stricter — see the note
 * over the comments themselves.
 */
const PANEL_COLUMNS = 108;

/*
 * A block of code with `comment` on its last line, where that line has room.
 *
 * Where it does not, the comment goes on its own line directly above the line
 * it describes, which costs a line of panel and is the cheaper of the two
 * losses: a trailing comment that does not fit puts a horizontal scrollbar
 * under the program for as long as it ships, at every viewport width, because
 * the panel has a maximum width and this exceeds it there too.
 *
 * Only Convex takes that branch today, and only because its construction line
 * is the longest in the file at 54 characters. Above it rather than below is
 * deliberate: `const convex = …` sits on the line before, and a comment about
 * what a relay does would be answering for its neighbour.
 */
const withTrailingComment = (code, comment) => {
  const lines = code.split('\n');
  const last = lines[lines.length - 1];
  if (`${last} ${comment}`.length <= PANEL_COLUMNS) {
    lines[lines.length - 1] = `${last} ${comment}`;
    return lines;
  }
  return [...lines.slice(0, -1), comment, last];
};

/*
 * One program, assembled from the two choices.
 *
 * The body is fixed. What moves is the import an adapter needs and the
 * expression that constructs it — the conversation itself, from the hook to
 * the send, is the same nine lines for all ten — which is exactly the point
 * the selector exists to make: an adapter is a value your application passes,
 * not a fork in your application's code.
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
    ...(relay.comment ? [`// ${relay.comment}`] : []),
    /* The relay's comment rides on the last line of its construction, not the
       first. Convex builds a client before it builds a relay, and a comment
       about what a relay does, sitting on the line that makes a Convex client,
       would be describing its neighbour. */
    ...withTrailingComment(relay.setup, relayComment),
    '',
    `const alice = await createSignalProtocolClient({ ${ALICE_COMMENT}`,
    '  identity: { userId: "alice" },',
    ...(store.comment ? [`  // ${store.comment}`] : []),
    `  adapters: { storage: ${store.expr}, relay }, ${ADAPTERS_COMMENT}`,
    '});',
    /* Bob's block is the same four lines with a different identity, and it
       deliberately carries neither the adapters note nor the store's own
       disclosure. Both are said one block up, about the same two values; a
       reader who needs the React Native note has already read it above the
       line that first uses it, which is the order the test checks.

       No blank line between the two, either. They are one beat — two devices
       — and a gap made them read as two unrelated setups. */
    `const bob = await createSignalProtocolClient({ ${BOB_COMMENT}`,
    '  identity: { userId: "bob" },',
    `  adapters: { storage: ${store.expr}, relay },`,
    '});',
    '',
    /* Receive first, then send. That is the order the SDK's own docstring uses
       (`client.d.ts`, the ServicesProvider example), and it is the order that
       is actually correct: `startRelaySubscription` is called automatically by
       `create()` only when a hook was already configured, so a hook registered
       afterwards needs the subscription started by hand. Sending last also
       puts the payoff on the last line. */
    `bob.registerHook("onMessageDecrypted", async (message) => { ${RECEIVE_COMMENT}`,
    `  console.log(message.content); ${PLAINTEXT_COMMENT}`,
    '});',
    'bob.startRelaySubscription();',
    '',
    /* The send keeps its comment on a line of its own. The call is 74
       characters with the message in it, and the claim beside it is the one
       that has to survive at full length: what is encrypted, where, and when
       relative to the relay. */
    SEND_COMMENT,
    `await alice.send("bob", "${capture.plaintext}");`,
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
