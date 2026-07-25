# Editorial roadmap

Internal working document. Not published as a page, not linked from the site.

Companion to `RESEARCH-DOSSIER.md` (in the meta repo, 2026-07-24). Every demand
claim below traces to that dossier; read its **Verification caveats** section
before lifting anything into public copy.

## The thesis this roadmap encodes

Claim the position **via the unanswered questions, not via protocol explainers.**
The world does not need another "what is the Double Ratchet" post — Signal's own
spec, Wong's *Real-World Cryptography* §10.4, and a hundred blog posts already
cover it. What does not exist anywhere is the layer above: **application
architecture for shipping E2EE in a TypeScript, React Native, or web product.**

The gap is structural rather than temporary. Signal owns the protocol and
disclaims the app layer; Matrix owns a working implementation and scopes its
docs to Matrix clients; academia owns the theory and stops at the RFC. Nobody's
KPI covers application architecture, which is why the gap has persisted five
years.

Two consequences for how we prioritise:

1. **Items 1–4 are things the SDK has to solve in code anyway.** Writing them up
   is not a content-marketing tax on the roadmap; it *is* the roadmap,
   published.
2. **Move now.** [Encrypted Spaces](https://encryptedspaces.org/) launched
   11 June 2026 out of Harvard Berkman Klein with Microsoft Research and a
   Signal Protocol co-author contributing, explicitly aiming at "the Signal
   protocol for collaboration apps." Today it is a whitepaper and a Rust
   prototype with one commit and no tutorials. If they decide to become the
   teaching authority, they start with more credibility than we do.

## Shipped in this batch

| # | Piece | Covers roadmap item |
|---|---|---|
| 1 | [TLS is not end-to-end encryption](../src/content/blog/tls-is-not-end-to-end-encryption.mdx) | Positioning + breach-notification angle |
| 2 | [Signal Protocol in React Native and Expo in 2026](../src/content/blog/signal-protocol-react-native-expo-2026.mdx) | **R1** (below) |
| 3 | [E2EE changes your application architecture](../src/content/blog/e2ee-changes-your-application-architecture.mdx) | The mental-model frame that every later piece links back to |

Article 2 partially discharges **R2** (second device), **R3** (recovery) and
**R5** (push notifications) with a paragraph each. Each still needs its own
piece; the article links forward rather than claiming to have answered them.

---

## The queue, ranked

Ranking is by *demand evidence × defensibility*, not by ease. Where a piece is
both a docs page and an article, write the docs page first and let the article
be the argument that sends people to it.

### R1 — Signal Protocol in React Native and Expo · **SHIPPED**

- **Target query:** "signal protocol react native", "expo end to end encryption", "libsignal react native"
- **Evidence of demand:** Stack Overflow ["How to build a highly secure End to End Encryption React Native messaging app"](https://stackoverflow.com/questions/65604237/how-to-build-a-highly-secure-end-to-end-encryption-react-native-messaging-app) — 8,666 views, **zero answers**, open since January 2021 (figure API-verified; there is no quotable question text). An [`r/reactnative` Expo thread](https://www.reddit.com/r/reactnative/comments/1bsqbnr/signal_protocol_on_rn/) asking where keys live, how long they are retained, how to avoid leaking them to Supabase, and how many prekeys to generate still reads "Be the first to comment." The abandoned `@privacyresearch` port pulls ~29,800 downloads/month.
- **Format:** Blog article (shipped) → `guides/expo-encrypted-chat`, `start/expo`.

### R2 — Adding a second device: Sesame in TypeScript

- **Target query:** "e2ee multi device", "signal sesame implementation", "add second device encrypted app"
- **Evidence of demand:** Sesame is **Revision 2, April 2017** and no JavaScript library implements it. An [`r/privacy` thread](https://www.reddit.com/r/privacy/comments/1cpkoep/question_how_the_e2ee_works_on_multiple_devices/) on how a new device obtains a private key runs straight into password-encrypted key envelopes, recovery codes, and the both-lost case. Meta shipped Labyrinth 1.1 in **May 2026**, two and a half years after launch, still working on whether messages survive a lost phone.
- **Why defensible:** highest difficulty-to-existing-content ratio in the list. Nothing to compete with.
- **Format:** `build/multi-device-sesame` docs page + long-form article. Must state the multiplicative cost — `(nA−1)·nB` encryptions per message — and that a new device mathematically cannot read prior history.

### R3 — Account recovery when the user forgets everything

- **Target query:** "e2ee account recovery", "encrypted app forgot password", "e2ee backup key"
- **Evidence of demand:** research exists (PETS 2025 SoK); an engineering guide with code does not. An [`r/cryptography` debate](https://www.reddit.com/r/cryptography/comments/1t2owgl/building_an_e2ee_messenger_is_adding_a_master_key/) shows there is no universal answer — some builders need server-confidential business history, others consider password-restorable history a fatal weakening against coercion.
- **Non-negotiable framing:** present **named profiles**, never one "secure" default, and state what each gives up. 1Password: "Recovery mechanisms are inherently weak points in maintaining the secrecy of data."
- **Format:** `build/recovery-backup-migration` (exists — deepen it) + article.

### R4 — E2EE + SSO: OIDC/SAML when the server can't hold the keys

- **Target query:** "e2ee sso", "end to end encryption saml", "okta encrypted app keys"
- **Evidence of demand:** the **#1 blocker for B2B adoption** in the dossier's adoption-trigger analysis. This is a sales asset as much as content — it is the question that arrives with the security questionnaire.
- **Format:** `build/enterprise-sso` docs page + article. Pair with the enterprise objection piece (R7).

### R5 — Encrypted push notifications on iOS and Android

- **Target query:** "e2ee push notification", "react native encrypted notification", "notification service extension decrypt"
- **Evidence of demand:** contentless push plus decryption inside an iOS `UNNotificationServiceExtension` — separate process, own keychain access, seconds of budget, no access to your JS runtime. **Apple and Google document the pieces separately; nobody assembles them** for React Native.
- **Format:** `build/push-notifications` + article with a working repo. Highest "copy this and it works" value in the queue.

### R6 — Choosing an E2EE library in 2026

- **Target query:** "best e2ee library", "signal protocol vs mls", "e2ee sdk comparison"
- **Evidence of demand:** currently requires reconstructing from ~15 repositories by hand. The dossier's own competitor table took live API calls across GitHub and npm to build.
- **Risk:** we are a vendor publishing a comparison. Mitigate by publishing the methodology and the raw pull date, listing our own gaps (no audit yet, alpha, AGPL friction) in the same table, and updating on a schedule.
- **Format:** maintained comparison page under `learn/`, dated, with a visible "last verified" line. Not a blog post — blog posts rot silently.

### R7 — Moderation and abuse reporting in an E2EE product

- **Target query:** "e2ee moderation", "message franking", "encrypted app abuse reporting"
- **Evidence of demand:** **the #1 objection enterprise buyers raise.** Academic consensus ([arXiv:2202.04617](https://arxiv.org/abs/2202.04617)) endorses user reporting with cryptographic franking plus metadata analysis as the techniques that survive an encrypted channel.
- **Format:** `learn/moderation` + article. Frame as *redesigned, not abandoned* — the honest version outsells the reassuring one here.

### R8 — Testing E2EE: test vectors, ratchet desync fuzzing, cross-version compatibility

- **Target query:** "test end to end encryption", "double ratchet test vectors", "e2ee integration testing"
- **Evidence of demand:** zero content exists. Matrix's undecryptable-message meta-issue catalogues [**over 70 distinct causes**](https://github.com/element-hq/element-meta/issues/245) and notes that debugging generally needs logs from both sender and receiver; one gateway logged [a burst of 479 "Bad MAC" exceptions](https://github.com/openclaw/openclaw/issues/14146) while silently delivering nothing.
- **Why it matters disproportionately:** this is the **highest-credibility piece an SDK vendor can publish.** It is the one that makes a reviewer believe the rest.
- **Format:** `operate/testing` + article, with our actual test-vector fixtures linked.

### R9 — Migrating an existing app to E2EE without a flag day

- **Target query:** "migrate to end to end encryption", "add e2ee to existing app", "e2ee migration plan"
- **Evidence of demand:** zero content exists, and every company adding E2EE at Series A needs exactly this. Meta's own timeline — announced 2019, default December 2023 — is the cautionary anchor.
- **Format:** `build/migration` + article. Include the dual-write / cutover / backfill-is-impossible sequence explicitly.

### R10 — Search over encrypted messages

- **Target query:** "search encrypted messages", "encrypted search e2ee", "client side search index"
- **Evidence of demand:** a Stack Overflow question open since **October 2020** with 1,240 views and zero answers. Proton, which has invested most in this, still warns that local indexing ["may take a few minutes and can be quite resource-intensive"](https://proton.me/support/search-message-content).
- **Format:** `build/local-search` + article. Be honest that this is genuinely unsolved rather than implying we solved it.

### R11 — Every E2EE tutorial on the internet, reviewed

- **Target query:** "e2ee tutorial", "how to build end to end encryption" (intercepts the *bad* results)
- **Evidence of demand:** every top-ranking tutorial was fetched and read for the dossier, and every one is either vendor lock-in to a dying SDK, static-key ECDH mislabelled as Signal-grade, not actually E2EE, or conceptually correct with no code. Named specifics: a still-ranking dev.to post using **raw unauthenticated Diffie-Hellman**; another shipping a shared AES key in `NEXT_PUBLIC_KEY`; a tutorial **updated January 2026** calling the archived-since-2021 library "the official JavaScript implementation."
- **Why it works:** establishes authority by demonstrating judgment rather than asserting expertise. Pair with an **`awesome-e2ee`** repo, since awesome-cryptography (7,040 stars, active) has **no section for E2EE, secure messaging, Signal Protocol, or MLS** and the one existing `awesome-end-to-end-encryption` repo has 0 stars and died in March 2023.
- **Care required:** this piece names other people's work as dangerous. Critique the code, never the author; link the exact line; offer the correction. Legal read before publishing.

### R12 — The E2EE server: a reference data model

- **Target query:** "e2ee server schema", "prekey table design", "signal protocol server implementation"
- **Evidence of demand:** prekey tables, exhaustion rate limits, key-bundle versioning, device registries — **no schema published in any language.** Prekey exhaustion is a measured production failure: a 2025 study found [13% of WhatsApp companion devices lacked a one-time prekey at scan time](https://arxiv.org/pdf/2511.20252).
- **Format:** `build/relay-data-model` with real DDL for Postgres and Convex.

### R13 — MLS in the browser and React Native

- **Target query:** "mls browser", "rfc 9420 typescript", "messaging layer security react native"
- **Evidence of demand:** largest greenfield in the space. MLS shipped to every iPhone and Android in May 2026, yet the only pure-TS implementation ([ts-mls](https://github.com/LukaJCB/ts-mls), 105 stars, very active) states it "has not undergone a formal security audit," and the OpenMLS book covers no delivery service, auth service, or storage.
- **Strategic note:** writing this well means writing fairly about the strongest live competitor for TS-native mindshare. Do it anyway — R6 already commits us to that posture, and the alternative is that our silence looks like avoidance.
- **Format:** article, later a `learn/` page. Pair with **R14**.

### R14 — Sender Keys vs MLS: an honest engineering comparison

- **Target query:** "sender keys vs mls", "group encryption comparison"
- **Evidence of demand:** downstream of R13; the question follows immediately once someone has read both.
- **Format:** article with reproducible benchmarks and the benchmark harness published. Numbers without a harness will be dismissed, correctly.

---

## Sequencing note

R2 → R3 → R5 first: they close the loops article 2 opened, and they are the
three questions a developer hits in their first month. R7 and R4 next, because
they unblock revenue conversations rather than traffic. R8 whenever we want a
credibility spike — it is the cheapest way to be taken seriously by the people
who evaluate cryptography libraries for a living.

R11 and R6 are the two that create ongoing maintenance obligations. Do not start
either until someone owns the update cadence.

## Distribution note

The Reddit and Stack Overflow threads cited above are durable, indexable
question pages, and answering them is legitimate. It is also the easiest way to
look like a spammer. Rules we hold ourselves to, from the dossier: answer the
question **in the answer itself**, link only where the guide adds necessary
depth, disclose affiliation every time, never post automatically, and never
treat these threads as an acquisition channel. Drafts live in
`docs/reddit-drafts.md` and are gated on founder authorisation.
