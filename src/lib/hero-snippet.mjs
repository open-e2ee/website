/*
 * The quickstart, with the device store the reader gets to choose.
 *
 * The panel has a copy button, so each variant is one complete program. Every
 * line is true for every store that the selector offers.
 *
 * Two checks hold the program to the SDK, and each one covers a different
 * part of it:
 *
 * - `tests/site-content.test.mjs` type-checks every variant against the
 *   installed package. A wrong factory, option name, or import fails there.
 * - The same file looks up each code line in the recorded capture. The lines
 *   that the capture cannot hold are the Signal Protocol Relay construction:
 *   the recording runs offline against this site's own relay, and the hosted
 *   client needs a Relay project and an identity provider. The test lists
 *   those lines by name, so a new line that is in neither place fails.
 *
 * The build audit also checks every `@open-e2ee/` specifier and named import
 * against the installed types.
 */

import capture from '../data/carrier-capture.json' with { type: 'json' };

export const installCommand = `npm install ${capture.packageName}`;

const PACKAGE = capture.packageName;

/*
 * What the program shows.
 *
 * Two devices and one relay: construct, subscribe, send. It is the shape of
 * the SDK's own `createHostedSignalProtocolClient` docstring, with both sides
 * of the conversation on the page.
 *
 * The two blocks are labeled as devices. With the in-memory store, both can
 * run in one process. With a device store they cannot: `webSqliteStore()` with
 * no arguments opens one fixed database name, and the Node, Expo, and React
 * Native stores do the same kind of thing. So `BOB_COMMENT` says that each
 * device runs its own half in an application.
 *
 * `syncToServer()` is not here. `create()` syncs when a relay is configured,
 * and `syncToServer()` only retries a failed first sync. The send goes to
 * `bob.userId`, because the identity comes from the assertion that the
 * reader's provider signs, and the program does not know it in advance.
 *
 * The carrier panel below the fold shows the ciphertext that a recorded run
 * produced. The hero shows the API; the capture shows the result.
 */
/*
 * The device store, which is the runtime question.
 *
 * `expr` goes into `adapters.storage`. Four of the five factories are async
 * and are awaited here rather than quietly dropped — `expoStore`,
 * `webSqliteStore`, `nodeStore` and `reactNativeStore` all return promises, and a
 * snippet that forgot the `await` would hand the client a pending promise
 * where a store belongs. A test holds each `await` to the SDK's declared
 * return type.
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
    /* `directory` and `vault` are the reader's own, and they have to be: the
       store requires both, and the SDK ships no vault for a plain Node
       process. Naming a secret manager here would be invented usage of
       somebody else's API, so the note says whose values they are instead. */
    expr: 'await nodeStore({ directory, vault })',
    experimental: false,
    comment: 'directory is yours, and vault is your own SignalProtocolLocalSecretVault.',
  },
  {
    id: 'expo',
    label: 'Expo',
    subpath: 'local/store/expo',
    symbol: 'expoStore',
    expr: 'await expoStore()',
    experimental: false,
  },
  {
    id: 'web-sqlite',
    label: 'Browser',
    subpath: 'local/store/web-sqlite',
    symbol: 'webSqliteStore',
    expr: 'await webSqliteStore()',
    experimental: false,
  },
  {
    id: 'react-native',
    label: 'React Native',
    subpath: 'local/store/react-native',
    symbol: 'reactNativeStore',
    /* The store keeps its database key in the SDK's react-native-keychain
       vault by default, so the program passes nothing. */
    expr: 'await reactNativeStore()',
    experimental: false,
  },
];

/*
 * The relay, which is the backend question.
 *
 * The OpenE2EE Signal Protocol Relay is the one option. It is not an adapter
 * that the reader constructs: `createHostedSignalProtocolClient`, from the
 * package root, takes the Relay's connection URL and a callback that returns
 * the device's signed identity assertion, and builds the relay adapter and
 * the identity itself. `factory` names the client factory, and `setup` is the
 * construction that comes before the clients.
 *
 * A list of one keeps the selector and its measured toolbar layout. An
 * application can also supply its own `SignalProtocolRelayServer`, but no
 * importable relay stands behind that choice, so the panel does not offer it.
 *
 * `process.env.OPEN_E2EE_RELAY_URL` is the spelling that the Relay
 * documentation and the `oe` CLI write. An application reads its
 * configuration however its bundler exposes it.
 *
 * `aliceSignIn` and `bobSignIn` are the reader's own functions. Each returns a
 * signed assertion from the application's identity provider. Nothing
 * importable produces one, so the option says whose they are in a comment, the
 * same way the Node store does for `directory` and `vault`.
 */
export const relayOptions = [
  {
    id: 'hosted',
    label: 'Signal Protocol Relay',
    factory: 'createHostedSignalProtocolClient',
    setup: 'const relayUrl = process.env.OPEN_E2EE_RELAY_URL!;',
    experimental: false,
    comment:
      "aliceSignIn and bobSignIn return each device's signed identity assertion from your identity provider.",
  },
];

/*
 * The comments the page writes, as opposed to the code the recording proves.
 *
 * These are the part of the panel that is not traceable to the capture, and
 * naming them here rather than inlining them in `buildSnippet` is what lets
 * `tests/site-content.test.mjs` hold the line between the two: the code half
 * of every line must be in the recording or in the test's named list of
 * hosted lines, and every comment on it must be one of these. An editor who wants to say something new in the panel has to say
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
 * `<p class="code-note">` — that `directory` and `vault`, in the Node variant,
 * are values the reader brings rather than something the SDK exports. Prose
 * below a copy button is read after the copy, if at all; a comment travels with
 * the paste.
 *
 * The Signal Protocol Relay option carries a disclosure of the same kind for
 * `aliceSignIn` and `bobSignIn`. A comment saying where a name comes from is
 * a weaker version of a line that binds it, so a disclosure is spent only on
 * a name with nothing importable behind it, and both of these are the
 * reader's own identity-provider calls.
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

   It rides on the line that names the Relay's URL, which is the one line of
   the relay's construction.

   Exported, alone among the six, because its place in the listing depends on
   the length of that construction. A test that only knew the comment existed
   could not tell the fallback below from the comment being dropped. */
export const relayComment = '// Devices post and collect envelopes from the relay.';
/*
 * The ones that ride on a line of code, and the width that shapes them.
 *
 * Every comment here but the send's is a trailing one, which is worth six
 * lines of panel. The cost is that a
 * trailing comment is spent from a width budget rather than given a line, and
 * the budget is measurable: 108 characters at 1280, 97 at 1024. Each of these
 * is written to the room left after the longest code it can land on, which is
 * Node's 64-character adapters line.
 *
 * Nothing overruns 1280. Below it three lines do, and all are known: the URL
 * line with the relay comment on it and the sign-in disclosure are 104
 * characters each, and Bob's construction line is 99, so the 97-column budget
 * at 1024 holds none of them. The two budgets are measured in a browser, not
 * estimated from a font size; the line lengths are counted.
 *
 * So they say one thing each, and the thing they say is the one the code does
 * not. `adapters:` shows that an adapter is a value you pass, so its comment
 * spends the room on where the keys go instead. `bob.registerHook` names the
 * device, so its comment spends the room on when the hook fires.
 *
 * Bob's label carries the disclosure rather than Alice's, and that is a change
 * of position as well as of length: two clients in one listing raise the
 * question at the second one, not the first. With a device store the second
 * block belongs on a second device — `webSqliteStore()` with no argument
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

/** The combination shown first. The in-memory store is the one the capture also uses. */
export const defaultVariant = { storage: 'memory', relay: 'hosted' };

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
 * No option takes that branch today. The Signal Protocol Relay's URL line is
 * the longest construction at 50 characters and still leaves room. The branch
 * stays for the next construction that does not, and puts the comment above
 * rather than below so that it never reads as describing the line after.
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
 * The body is fixed. What moves is the import a store needs and the
 * expression that constructs it. The conversation itself, from the hook to
 * the send, is the same for every variant, which is the point the selector
 * makes: an adapter is a value your application passes, not a fork in your
 * application's code.
 */
export const buildSnippet = (storageId, relayId) => {
  const store = storageOptions.find((option) => option.id === storageId);
  const relay = relayOptions.find((option) => option.id === relayId);
  if (!store) throw new Error(`Unknown storage adapter: ${storageId}`);
  if (!relay) throw new Error(`Unknown relay adapter: ${relayId}`);

  const adapters = `  adapters: { storage: ${store.expr} },`;

  return [
    `import { ${relay.factory} } from "${PACKAGE}";`,
    `import { ${store.symbol} } from ${specifier(store.subpath)};`,
    /* A store may need names from beyond its own subpath, and they belong in
       the import block with the rest, not in a comment underneath. No option
       needs it today. */
    ...(store.imports ?? []),
    '',
    /* The relay's comment rides on the last line of its construction, so that
       a construction of more than one line never has the comment describing
       its neighbor. */
    ...withTrailingComment(relay.setup, relayComment),
    /* A store's construction comes after the relay's, in the same block: both
       are values the two clients below are handed. */
    ...(store.setup ? [store.setup] : []),
    '',
    /* The relay's own disclosure sits directly above the first line that uses
       the names it explains, which is Alice's `hosted` line. */
    `// ${relay.comment}`,
    `const alice = await ${relay.factory}({ ${ALICE_COMMENT}`,
    '  hosted: { relayUrl, getIdentityAssertion: aliceSignIn },',
    ...(store.comment ? [`  // ${store.comment}`] : []),
    `${adapters} ${ADAPTERS_COMMENT}`,
    '});',
    /* Bob's block is the same four lines with a different sign-in, and it
       carries neither the adapters note nor the store's own disclosure. Both
       are said one block up, about the same two values.

       No blank line between the two, either. They are one beat, two devices,
       and a gap made them read as two unrelated setups. */
    `const bob = await ${relay.factory}({ ${BOB_COMMENT}`,
    '  hosted: { relayUrl, getIdentityAssertion: bobSignIn },',
    adapters,
    '});',
    '',
    /* Receive first, then send. That is the order the SDK's own docstring uses
       (`client.d.ts`, the ServicesProvider example), and it is the order that
       is correct: `startRelaySubscription` is called automatically by
       `create()` only when a hook was already configured, so a hook registered
       afterwards needs the subscription started by hand. Sending last also
       puts the payoff on the last line. */
    `bob.registerHook("onMessageDecrypted", async (message) => { ${RECEIVE_COMMENT}`,
    `  console.log(message.content); ${PLAINTEXT_COMMENT}`,
    '});',
    'bob.startRelaySubscription();',
    '',
    /* The send keeps its comment on a line of its own. The claim beside it is
       the one that has to survive at full length: what is encrypted, where,
       and when relative to the relay. */
    SEND_COMMENT,
    `await alice.send(bob.userId, "${capture.plaintext}");`,
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
