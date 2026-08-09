# Reddit reply drafts

> # ⚠️ DO NOT POST WITHOUT FOUNDER AUTHORIZATION
>
> These are drafts for review, not queued content. Nothing here goes to Reddit
> until the founder explicitly approves the specific comment on the specific
> thread. Do not automate, schedule, or delegate posting.

## Ground rules these drafts follow

From `RESEARCH-DOSSIER.md` and the editorial roadmap:

1. **The answer has to stand on its own.** If the comment is only useful once
   you click the link, it is an advertisement. Each draft below is written so
   that someone who never clicks anything still leaves better off.
2. **Affiliation is disclosed in every comment**, in the comment body, not in a
   flair or profile. Every draft states it.
3. **Links are the exception.** One or two, only where the guide supplies
   working code the comment cannot reasonably contain.
4. **No competitor disparagement beyond checkable fact.** "Archived in August
   2021" is a fact. "Abandoned garbage" is not, and it reads as marketing.
5. **Never post to more than one thread per subreddit per week**, and never
   post to a thread we have not read in full.
6. **Do not edit in links later.** If a comment is worth posting without a
   link, it is worth leaving that way.

## Additional care items

- **Thread age.** Two of the three threads are 1–2 years old. Necro-posting is
  tolerated on Reddit when the answer is substantive and the thread ranks in
  search — which is exactly why these threads matter — but the original poster
  will likely never see it. Write for the searcher, not the OP.
- **Subreddit rules vary.** `r/cryptography` in particular is hostile to
  self-promotion and to non-experts giving crypto advice, correctly. Check each
  subreddit's current rules the day of posting, not today.
- **Expect the audit question.** The honest answer is the fixed sentence from
  `docs/messaging.md` §7: reviewed continuously by adversarial AI agents, not
  audited by any independent firm. Say both halves, and say them before someone
  asks — being the one to raise it is the only version that builds trust. Do not
  promise a firm review in any tense; that promise was retired on 2026-08-09.
- **If a reply is hostile, do not defend the product.** Answer the technical
  point or say nothing.

---

## Draft 1 — `r/reactnative`: "Signal protocol on RN"

**Thread:** https://www.reddit.com/r/reactnative/comments/1bsqbnr/signal_protocol_on_rn/
**Status:** unanswered ("Be the first to comment") as of the 24 July 2026 pass.
**Why this one:** the questions asked map exactly onto the SDK's storage, relay,
and prekey responsibilities. This is the highest-value thread in the set.

---

Disclosure up front: I work on OpenE2EE, which is one of the options below, so
weigh that accordingly. I want to answer the actual questions you asked rather
than pitch, because nobody answered them and they deserve answers.

**Why you found nothing that works.** There are three Signal Protocol options in
JavaScript and each fails on React Native for a different reason.
`signalapp/libsignal-protocol-javascript` was archived in August 2021 and has had
no commits since — it still ranks first in GitHub search, which is why everyone
finds it. Its replacement, `@signalapp/libsignal-client`, is a Node native addon
with prebuilt binaries for Windows, macOS and Linux only; Hermes has no N-API, so
there is no configuration that makes it load, and the README says "Use outside of
Signal is unsupported." The community port,
`@privacyresearch/libsignal-protocol-typescript`, is pure TS and does run on RN,
but its last publish was May 2023, it has no group or post-quantum support, it is
GPL-3.0-only, and issue #92 (filed June 2026) reports that `isTrustedIdentity()`
is not awaited in `SessionBuilder.processV3()` — an unawaited promise in a trust
check is a trust check that does not run. Compiling Rust to WASM does not rescue
you either; that path ends at `Unable to bind Webassembly to React Native JSI`.

**Where the keys should live.** Three places, and the split matters:

- *One small secret in `expo-secure-store`* — the key that encrypts your local
  database. Use the `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` accessibility class.
  `THIS_DEVICE_ONLY` keeps it out of iCloud Keychain backups so it cannot be
  restored onto a different device; `AFTER_FIRST_UNLOCK` still lets background
  message processing work while the phone is locked.
- *Everything else in a SQLCipher-encrypted SQLite database* — identity keys,
  prekeys, session records, ratchet state, messages. Encrypted at rest with the
  key above, so the database file alone is not enough. Note SQLCipher needs a dev
  build; it is not available in Expo Go.
- *Nothing else anywhere.* Do not put key material in AsyncStorage, in Redux
  state you persist, or in a generic "device backup."

**How long they live.** Identity keys live for the life of the install. Signed
prekeys rotate on a timer (a couple of days is a reasonable interval, with a
maximum age of about two weeks so an offline device still has a window to catch
up). One-time prekeys live until consumed. Session state lives until the session
is torn down, and it must persist *atomically* — a decrypt mutates the ratchet,
so a partial write corrupts the session irrecoverably.

**How to not leak them to Supabase.** This should be structural, not a matter of
discipline. Your backend should only ever be handed two things: public prekey
bundles and opaque ciphertext envelopes. If your architecture has a code path
that could send a private key to the server, the fix is to remove the path, not
to remember not to call it. Concretely: never sync the SQLite file, never include
it in an automatic backup, and keep the server-facing adapter separate from the
storage layer so the types make the mistake impossible.

**How many prekeys.** 100 one-time prekeys per batch is the conventional number,
with a low-watermark refill at around 50. The reason to care is the failure mode:
if a device runs out, session establishment falls back to the signed prekey,
which weakens forward secrecy for that session — and it does so *silently*, with
no error anywhere. A 2025 measurement study found 13% of WhatsApp companion
devices had no one-time prekey available at scan time, so this is not
theoretical. Whatever you build, put a counter and an alert on it.

**One more thing nobody mentions:** `expo-crypto` will not get you there. It has
digests, random bytes and AES-GCM, but no ECDH, no HKDF, no X25519, no Ed25519 —
no key agreement of any kind, and key agreement is the operation at the centre of
both X3DH and the Double Ratchet.

If it is useful, we wrote all of the above up with working Expo code here:
[link to the Expo guide]. Every change to it passes an adversarial AI review
before it merges, and no independent firm has audited it — I would rather say
that now than have you find out later.

---

## Draft 2 — `r/webdev`: "How do I implement end-to-end encryption in the browser?"

**Thread:** https://www.reddit.com/r/webdev/comments/1c3sl7s/how_do_i_implement_endtoend_encryption_in_the/
**Status:** answered, but the answers range from "just use RSA" to "don't roll
your own" with nothing actionable in between.
**Why this one:** the OP correctly diagnosed the gap (library deprecated,
replacement is Node-only) and still could not find a next step. The disagreement
in the replies is the evidence.

---

Disclosure: I work on an E2EE SDK (OpenE2EE), so I have an interest here. The
diagnosis in your post is correct and worth stating plainly for anyone who finds
this later.

**You are right about the libraries.** The official JavaScript implementation was
archived in August 2021. Its replacement is a Node native addon with no browser
build, and Signal Messenger's own README says "Use outside of Signal is
unsupported." That is not you failing to find the right package; that is the
state of the ecosystem.

**On the "just use RSA / asymmetric encryption" answers** — those give you
confidentiality against a passive observer and nothing else. What they do not
give you is forward secrecy (compromise the key once and every past message
decrypts), post-compromise security (compromise it once and every future message
decrypts too), or any answer to multi-device. The reason the Double Ratchet
exists is that a static keypair is not enough for a messaging product, and the
reason people say "don't roll your own crypto" is mostly that the gap between
"encrypts things" and "resists the attacks that actually happen" is invisible
from inside your own implementation.

**The thing worth saying about the browser specifically**, which most answers in
this thread skip: browser E2EE has a code-delivery problem that native apps do
not. The server you are defending against also ships the JavaScript that does the
encrypting, so it can ship different JavaScript to one user on one day.
Subresource integrity, code signing and reproducible builds narrow this; nothing
closes it. Related, and more immediate: storing a non-extractable key in
IndexedDB protects against exfiltration of the key, but any XSS turns that key
into a signing/decryption oracle the attacker can call. Non-extractable is a real
mitigation and not a solution.

None of that means don't do it. It means the honest claim for a web app is
narrower than the one for a mobile app, and you should write the narrower claim
in your own docs so a security reviewer does not have to catch you.

**Practically,** your options today are: a maintained TypeScript implementation
of the Signal Protocol (ours is one, `ts-mls` is another if you prefer MLS to
the Signal Protocol and can live with it stating it has not had a formal
security audit), or adopting Matrix wholesale via `matrix-js-sdk` if you are
willing to take on the whole ecosystem rather than just a crypto library. What I
would avoid is the middle path the top tutorials recommend, which is
hand-assembling libsodium or tweetnacl primitives into a protocol — that is
exactly the "roll your own" the other commenters are warning you about, just
with well-audited building blocks.

Happy to answer specifics if you have a threat model in mind. What are you
protecting against, and from whom? The answer changes a lot depending on whether
"the server operator" is in scope.

---

## Draft 3 — `r/cryptography`: "Where should I start to implement real end-to-end encryption?"

**Thread:** https://www.reddit.com/r/cryptography/comments/1r7sheb/where_should_i_start_to_implement_real_endtoend/
**Status:** has a substantive reply identifying trust establishment as the hard
part — which is correct and worth building on rather than talking over.
**Why this one:** the OP's stack (React web + React Native + Node + cloud
storage) reproduces the entire job-to-be-done. Highest risk thread of the three:
`r/cryptography` is rightly hostile to vendors. If in doubt, skip this one.

---

Disclosure: I work on OpenE2EE, a TypeScript Signal Protocol SDK, so I am not a
neutral party. Posting because the top reply is right about the thing that
matters and I want to extend it rather than contradict it.

**"Trust establishment, not primitive selection, is the hard part" is the correct
answer.** Everything below assumes you have accepted that.

To your specific questions:

**Primitives or a protocol?** A protocol. Not because primitives are hard to call
— they are easy to call — but because the design space between them is where the
attacks live. If you find yourself choosing an AEAD and a KDF for a messaging
app, you have already committed to designing a protocol, whether or not you meant
to. Use X3DH/PQXDH + Double Ratchet (Signal Protocol) or RFC 9420 (MLS)
depending on whether your product is more pairwise or more group-shaped.

**Is production E2EE realistic without a cryptographer on the team?** Yes, with a
caveat that is not the one people expect. Using a protocol library correctly is
achievable. What is not achievable without deliberate effort is the layer above:
how a second device gets provisioned, what happens when a user loses their phone,
what your server sees, how you moderate, how you test the failure paths. That
layer has almost no published guidance and it is where most projects stall. Budget
your unknowns there, not in the cryptography.

**Where to store private keys on both platforms.** Web: IndexedDB with
non-extractable `CryptoKey` objects, understanding that this stops key
exfiltration but leaves you with a signing oracle under XSS. React Native: the
platform keychain (`expo-secure-store` or equivalent) for one small secret, and
an encrypted local database (SQLCipher) for everything else, with the keychain
secret unlocking the database. In both cases the design goal is that the server
never has a code path that could receive a private key.

**A reference implementation.** This is the honest gap in your question. The
Signal Protocol specifications are authoritative but pedagogically hostile —
X3DH is still Revision 1 from 2016, Sesame (multi-device, the thing you will
need) is Revision 2 from April 2017, and neither has a walkthrough. Matrix has a
working implementation scoped to Matrix. The books do not cover it:
*Real-World Cryptography* has one section on the Signal Protocol, *Serious
Cryptography* 2e has no secure-messaging chapter at all. So there isn't a good
canonical reference, which is uncomfortable but better to know going in.

**One thing I would add to your list:** decide your recovery policy before you
write any code, and write down what it gives up. "User loses device, history is
gone" and "user can restore history with a password" are both defensible, and
they are different products with different threat models. Deciding it late means
retrofitting it, and retrofitting recovery into a shipped E2EE app is genuinely
painful.

If you want the SDK we work on, it is `@open-e2ee/signal-protocol-sdk` — pure
TypeScript, runs in browser/Node/Expo, PQXDH by default. It is alpha, it is
reviewed continuously by adversarial AI agents, and it is not audited by any
independent firm. Do not take my word for any of the above just because I build
one of these.

---

## Threads deliberately not drafted

- [`r/cryptography` — "How to build an E2EE chat"](https://www.reddit.com/r/cryptography/comments/1i11psp/how_to_build_a_end_to_end_encryption_chat/):
  the commenters already found the missing sender authentication, the key
  substitution attack, and the absent threat model. Nothing useful left to add,
  and arriving late with a product link reads badly.
- [`r/webdev` — "How do you make E2EE seamless"](https://www.reddit.com/r/webdev/comments/1qupl6m/how_do_you_make_endtoend_encryption_as_seamless/):
  the OP resolved their own question. A comment here would be pure promotion.
- [`r/selfhosted` — Etebase launch](https://www.reddit.com/r/selfhosted/comments/jrljmy/etebase_an_opensource_and_endtoend_encrypted_sdk/):
  another project's launch thread. Do not post in it.
