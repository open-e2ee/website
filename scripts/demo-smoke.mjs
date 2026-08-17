/*
 * Drives the homepage live demo in a real browser, then takes it away and
 * checks what the page does without it.
 *
 *   npm run build && npm run demo:smoke
 *
 * Five claims, one run:
 *
 *   1. A reader's own sentence round-trips through the installed SDK in their
 *      tab, under the site's unchanged `script-src 'self'`, twice.
 *   2. The sentence never leaves the page.
 *   3. The only thing the page posts anywhere is one measurement beacon, of a
 *      shape fixed in advance, carrying nothing derived from the sentence.
 *   4. The metadata beside it is the live envelope's own fields, not a list
 *      someone typed.
 *   5. Nothing SDK-shaped is fetched before the reader asks for it.
 *
 * Then a second pass blocks every chunk the interaction pulled and checks the
 * page lands back on the recorded capture rather than on a hole.
 *
 * Claim 2 is the one that needs a browser. "Nothing left the page — check the
 * network tab" is an invitation, and a reader who accepts it and finds a
 * request carrying their sentence has caught the site lying. So this harness
 * watches every request the page makes, including WebSocket frames, and fails
 * on any that carries the typed text in cleartext, percent-encoded, or base64
 * form. The typed sentence carries a per-run nonce: the site ships a recorded
 * capture whose plaintext is a fixed string, and a fixed probe string would
 * either collide with it or quietly stop proving anything.
 *
 * Claim 3 is what claim 2 stopped being sufficient for the moment the demo
 * gained an analytics event (LD3). Searching for the sentence proves the
 * sentence did not go; it says nothing about a beacon carrying the sentence's
 * *length*, the ciphertext's byte count, or how many milliseconds the encrypt
 * took — each of which is a fact about what the reader typed, and none of which
 * would ever match a probe search. So the beacon is checked positively: the
 * whole body, against a string this file knows before the browser starts.
 *
 * Which is only worth anything if the beacon is the whole outbound story. A
 * second endpoint on our own origin, posted a summary of the sentence, would
 * pass claim 2 — same host, no probe text — and never be read by claim 3. So
 * the page is allowed exactly one destination for anything it sends: every
 * non-GET request has to be the beacon, and the beacon's body is read in full.
 *
 * It also fails on a CSP violation. The demo's whole premise is that it runs
 * under the site's unchanged `script-src 'self'` — and the failure mode is not
 * hypothetical. An Astro island (`client:visible`) emits its hydration
 * bootstrap as an inline script, which this policy blocks in Chrome, Firefox
 * and WebKit alike; the island renders its server markup and simply never
 * wakes up. That was measured in LD0. A demo built that way would look fine to
 * a test that only asked whether the markup was present.
 *
 * Claims 3 and 4 and the blocked pass arrived from `demo-driver-check.mjs`,
 * which proved them against a generated fixture page because the homepage panel
 * did not exist yet. It does now, so the fixture would be proving them about a
 * copy of the demo rather than about the demo — and the copy is the one that
 * cannot break in front of a reader. The fixture, its build step and its
 * throwaway output directory went with it.
 *
 * Chrome, the server and the CDP client come from `./chrome-harness.mjs`.
 * Headers come from `public/_headers` rather than being retyped there, so the
 * policy under test is the policy that ships.
 */

import { existsSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startDemoSession } from '../src/lib/demo/driver.ts';
import { EVENTS } from '../src/workers/site.ts';
import {
  Cdp,
  Infra,
  Red,
  launchChrome,
  productionHeaders,
  serve,
} from './chrome-harness.mjs';
import { readSdkSurface } from './sdk-surface.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/*
 * The demo's contract with this harness. It is named through data attributes
 * rather than class names or element structure so that restyling the panel
 * cannot break the test, and so that the test states plainly what the demo has
 * to expose.
 */
const CONSOLE = '[data-demo="console"]';

/*
 * The one control that starts anything. It brings both devices online and
 * publishes their bundles; after it, the reel plays itself and the composers
 * are the only other thing to press.
 *
 * So this harness waits on the *state the scene reaches* rather than driving it
 * there, on a wall-clock budget generous enough that the dwell table can be
 * retuned without touching this file. What it must never do is read the dwell
 * and size a wait from it, which would let a pacing change pass by moving the
 * goalposts with it.
 */
const START = '[data-console-start]';

const STATUS = '[data-console-status]';

/* The demo reporting that it could not run, which every wait here treats as an
   ending. Written once because a wait that forgot it would hang for its whole
   budget against a page that had already answered. */
const EXCUSED = `/did not finish/.test(document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? '')`;

/*
 * The mailbox the relay is holding a row in, and what the row is drawn as.
 *
 * The console used to print the relay's custody as a list of field names beside
 * a hex dump. The scene draws it instead: a bay per account, lit by
 * `data-holding` while the relay actually has the envelope, with the sealed
 * message resting in it. So "the relay is holding something" is read off the
 * bay's own state, and the addressing and the size are read off the message
 * resting there — the two facts the relay can see, and the only two the drawing
 * claims.
 *
 * Addressed per account rather than as one row, because which mailbox is a fact
 * about who the envelope is for, and a reading that took any lit bay would pass
 * on a relay that put the message in the sender's own.
 */
const MAILBOX = (side) => `[data-scene-slot="mailbox"][data-scene-side="${side}"]`;
const MAILBOX_EMPTY = (side) =>
  `[data-scene-slot-body="mailbox"][data-scene-side="${side}"] .demo-relay-slot-empty`;

/* The sealed message, and what is written on its outside. The size is the
   recording's own measure of the ciphertext, and the addressing is read off the
   envelope the relay stored. Those are the two facts the relay has, and the
   tile shows nothing else while it is sealed. */
const ENVELOPE_SIZE = '[data-scene-envelope-size]';
const ENVELOPE_TEXT = '[data-scene-envelope-text]';
/* `humanBytes`'s grammar, which is where every size on the page comes from. */
const STORED_SIZE = /^(\d+(?:\.\d)?) (B|KB|MB)$/;

const RECORDED = '[data-console-recorded]';

/* The composer, and it belongs to a device rather than to the console: the
   reader types into the phone on the left, which is where a message comes from
   in the arrangement the page draws. */
const COMPOSE = (side) => `[data-scene-input="${side}"]`;
const COMPOSE_SEND = (side) => `[data-scene-send="${side}"]`;

/* And the press that makes a phone a device. One per phone, because coming up
   is something a device does for itself: it makes its own keys and publishes
   its own bundle, and a single control for the pair would draw one act where
   the protocol has two. */
const SCENE_ACTIVATE = (side) => `[data-scene-activate="${side}"]`;

/* Which device starts the conversation, and which one is spoken to. The first
   sentence is what makes a session, and a session is made out of the *other*
   device's published bundle — so this pair decides whose shelf is expected to
   fall by the time the two are talking, and everything below that depends on
   the direction is written from it rather than from a side letter typed twice. */
const INITIATOR = 'a';
const RESPONDER = 'b';

const INPUT = COMPOSE(INITIATOR);
const SEND = COMPOSE_SEND(INITIATOR);

/* The near device's conversation, and the far one's. A round trip is proved by
   the sentence appearing in the device that did not type it — the claim the
   whole arrangement is built to make, and one that flattened page text cannot
   check, since the sentence is on the page from the moment it is typed. */
const SENT = `[data-scene-chat="${INITIATOR}"]`;
const DECRYPTED = `[data-scene-chat="${RESPONDER}"]`;

/* The names the page is really running the SDK under. Read rather than assumed:
   the component renders them into the headings and into these attributes from
   one constant, and the captions below are written in whichever names the run
   actually used. */
const NAME_A = 'consoleNameA';
const NAME_B = 'consoleNameB';

/*
 * The scene the two devices and the relay are drawn in, on the same terms and
 * for a specific reason.
 *
 * The devices, the relay and the wheels all ship in the build's HTML, so a
 * scene whose script never mounted looks very like one that mounted and had
 * nothing to report — the whole arrangement is on screen either way, in the
 * state the build shipped. There is no error, no gap and no empty box.
 *
 * What tells them apart is what only the script can put there, and that is what
 * the checks below read: the step the scene says it is on, the turn count on
 * each wheel, and the name the wheel takes from the session's own selection
 * event.
 */
const SCENE = '[data-demo-scene]';

/*
 * A wheel, and how far it has been turned.
 *
 * `data-turns` is written by `scene-view.ts` at mount and never appears in the
 * shipped HTML, which is what makes its presence a fact about a script that ran
 * rather than about markup that shipped.
 *
 * It counts turns rather than describing the drawing, and it only ever grows.
 * The ratchet is one-way, so the count and the message keys derived are the same
 * number for the life of the page, and a reading of it is unambiguous about how
 * far along a conversation is in a way that any cycling drawing would not be.
 */
const SCENE_WHEEL = (side) => `[data-scene-ratchet-wheel="${side}"]`;

/* The running total of message keys the device has derived, in the device's own
   words — the same number the wheel is turned from, printed. */
const SCENE_KEYS = (side) => `[data-scene-ratchet-count="${side}"]`;

/* What the wheel is called. Bare before a session exists and named from the
   selection event afterwards, so reading it after a round trip asks the one
   question the shipped markup cannot answer by itself. */
const SCENE_RATCHET_LABEL = (side) => `[data-scene-ratchet-label="${side}"]`;

/* How many keys the device says it holds, in the device's own column. Read
   beside the relay's shelf for that device, which prints the public halves of
   the same set: two drawings of one figure, and a shelf that agreed with the
   wrong device would disagree here. */
const SCENE_DEVICE_KEYS = (side) => `[data-scene-keys-count="${side}"]`;

/*
 * Key generation, as the device draws it happening.
 *
 * It is drawn on the device's own key store rather than on a row of its own:
 * one bar, filling batch by batch from the SDK's progress reports and settling
 * at the amount the store ends up holding. The bar's length and the figure
 * beside it are written from counts the SDK reported while it was generating —
 * nothing here is interpolated, and nothing here can be drawn by a page working
 * from a timetable.
 *
 * Read as three separate things because they can disagree: the bar is an inline
 * width the script sets, the figure is text it writes, and the rendered
 * rectangle is what the reader actually sees. A bar told to be 100% inside a
 * track of zero width is on the page and is not on the screen.
 */
const SCENE_KEYGEN = (side) => `[data-scene-keys="${side}"]`;
const SCENE_KEYGEN_BAR = (side) => `[data-scene-keys-bar="${side}"]`;
const SCENE_KEYGEN_FIGURE = (side) => `[data-scene-keys-count="${side}"]`;

/*
 * The figure's whole grammar, in the store's own words: `so far / total` while
 * the two differ, and the plain amount once they meet — `outOf`'s rule, and the
 * reason a settled store does not read `500 / 500` at a reader.
 *
 * Both forms come back as the same pair, so every check below compares counts
 * rather than spellings. A row printing anything else is caught here rather
 * than read as prose.
 */
const KEYGEN_FIGURE = /^(\d+)(?: \/ (\d+))?$/;

function keygenCounts(figure) {
  const parsed = KEYGEN_FIGURE.exec(figure ?? '');
  if (!parsed) return null;
  const count = Number(parsed[1]);
  return { count, total: parsed[2] === undefined ? count : Number(parsed[2]) };
}

/*
 * The relay's shelves, one slot per kind per device.
 *
 * The relay keeps public prekeys and undelivered rows for each account
 * separately, and the drawing says so with a slot per account. Addressed by the
 * pair the drawing itself is keyed on, so a slot that went missing, lost its
 * side, or was labelled with the other device's name cannot be read as the one
 * that was asked for — it is simply not found, which is the failure.
 */
const SCENE_SLOT = (kind, side) => `[data-scene-slot="${kind}"][data-scene-side="${side}"]`;
const SCENE_SLOT_BODY = (kind, side) =>
  `[data-scene-slot-body="${kind}"][data-scene-side="${side}"]`;

/* The name the slot is labelled with, which `scene-view.ts` stamps at mount
   from the same session the device columns take their names from. A label read
   here and held against the device's own name is the whole of "this shelf
   belongs to that account".

   The relay draws one account block per device and both of that device's
   shelves inside it, so the label is read by walking up from the slot rather
   than by asking for the side's name directly. Containment is the drawing's
   own claim about whose shelf this is: a slot moved into the other account
   comes back wearing the other name, which is the failure this reads for, and
   a slot addressed by its own side attribute could not see it. */
const SCENE_ACCOUNT = '[data-scene-account]';
const SCENE_SLOT_NAME = '[data-scene-slot-name]';
const slotLabel = (slot) =>
  `${slot}.closest(${JSON.stringify(SCENE_ACCOUNT)})` +
  `?.querySelector(${JSON.stringify(SCENE_SLOT_NAME)})?.textContent?.trim() ?? ''`;

/* The two kinds of shelf, named once. Used to read every slot rather than the
   one a check happens to care about: a reading that covered only the slot under
   test could not say the other one was left alone. */
const SLOT_KINDS = ['bundles', 'mailbox'];

/* The line drawn from a device to the relay. Background, and deliberately so —
   read for whether it is on the page and how wide, never for what it looks
   like. */
const SCENE_LINK = (side) => `[data-scene-link="${side}"]`;

/* The envelope, wherever the reel has put it. Read as a rectangle so a check
   can ask which slot it is resting on, which is a question no text on the page
   answers. */
const SCENE_ENVELOPE = '[data-scene-envelope]';

/*
 * The state the scene must be in once a sentence has completed a round trip,
 * and the only one it can honestly be in: the receiving device decrypted, and
 * that is the last thing that happens.
 */
const SCENE_END_STATE = 'opened';

/*
 * The braid switch, and the column whose drawing has to answer it.
 *
 * Braid is a session setting: with it off the ML-KEM key rides whole in every
 * message, and with it on the same key is carried in 32-byte chunks, one per
 * message. So the two settings put envelopes of very different sizes through
 * the relay, and a column that draws what the relay is holding has to look
 * different under the two. Addressed by the key the console maps the switch on
 * rather than by its element id, which is assembled from that key.
 *
 * The setting is read by `startDemoRun`, so it must be chosen before a session
 * exists — `enable()` takes the switch away once one does.
 */
const BRAID_TOGGLE = '[data-console-toggle="braid"]';

/*
 * The braid's counts, drawn on the thing the braid changes.
 *
 * The strip is written from the report the SDK raises and from nothing else, so
 * it cannot be drawn by a page working from the sizes it measured — which is
 * what makes it worth reading here rather than reading the column's geometry
 * again. It prints how many chunks of the post-quantum key the message is
 * carrying and how many the whole key takes, so the pair meeting is the braid
 * saying a device has a complete epoch key.
 *
 * It ships hidden and is shown by `scene-view.ts` only for a cue that carries a
 * braid report, so a direct-mode run never grows the message and the strip's
 * presence is a fact about a braid that ran.
 */
const SCENE_BRAID_FIGURE = '[data-scene-envelope-chunk]';

/* The strip's whole grammar: the drawing's word for what it is counting, then
   what this message carries of what the key takes. Both figures are the braid's
   to choose, so the shape is what is pinned and never the numbers. */
const BRAID_FIGURE = /^pq chunks (\d+) \/ (\d+)$/;

/*
 * The relay's column, whole, rather than any element inside it.
 *
 * The check below asks what the column does when the envelope's size changes,
 * and deliberately does not name the elements it measures. Every box in the
 * column is measured and paired by where it sits, so the drawing is free to
 * move, to be remarked or to be rebuilt, and the reading still describes it.
 */
const RELAY_COLUMN = '.demo-scene-relay';

/* What the relay says about the one message it is holding. The scene draws
   every size as a figure and none as a length, so this is the drawing of the
   size rather than a caption beside one. */
const ROW_NOTE = ENVELOPE_SIZE;

/*
 * How far apart the two settings put the envelope, and how steady the drawing
 * of it stays.
 *
 * With the braid off the ML-KEM material rides whole in the message that agrees
 * the session; with it on the same material is spread a chunk at a time, so
 * that first envelope is the smaller of the two by roughly the size of the key
 * it is no longer carrying. Measured at 3.1 KB against 1.9 KB, 1.63× apart.
 * The sizes are deterministic — fixed key lengths and a fixed sentence — so the
 * floor is not guarding against sampling noise; 1.3 is set where the setting
 * remains unmistakable if the SDK's framing shifts a little around it.
 *
 * The width of the transit is the other half, and it is a claim in the other
 * direction: the envelope rides the wire at one size whatever it carries, so
 * the bigger message is drawn on the same box as the smaller. A tenth is the
 * allowance for the text inside it reflowing a box — a byte figure gaining a
 * digit, a chunk strip appearing — and nothing in a constant-size drawing
 * moves further than that. Sub-pixel boxes are passed over rather than
 * divided: an element a fraction of a pixel wide in one run is noise, and it
 * would otherwise manufacture an enormous ratio out of nothing.
 */
const BRAID_SIZE_FACTOR = 1.3;
const BRAID_STEADY_RATIO = 1.1;
const BRAID_MIN_WIDTH_PX = 2;

const NONCE = randomUUID().slice(0, 8);
const PROBE = `Smoke probe ${NONCE}: dinner at 7, table by the window.`;
/* A second sentence through a session that is already warm. The repeat send is
   a different path — the SDK chunk is there, the handshake is done, the ratchet
   has moved on — and until LD3 nothing ever exercised it. It is also what makes
   "one beacon per page, not per sentence" a measurement rather than an
   assertion: a page asked once cannot tell the two apart. */
const REPEAT_PROBE = `Second probe ${NONCE}: sent again, on a session already warm.`;
/* The far device answering, and the sentence that follows the answer. Between
   them they take the conversation out of its handshake: everything before the
   reply is a prekey message carrying the whole agreement, and the sentence
   after it is the first one sized by the session alone. */
const REPLY_PROBE = `Reply probe ${NONCE}: answered from the far device.`;
const STEADY_PROBE = `Third probe ${NONCE}: sent after the answer, on an agreed session.`;
/* The sentence the braid is driven with, numbered so a conversation of them can
   be read back. Short, because the braid pass sends it many times and the
   sentence is not what that pass is about. */
const BRAID_PROBE = (turn) => `Braid probe ${NONCE} #${turn}`;

/*
 * How many messages the braid pass drives, and why that is not a whole epoch.
 *
 * The braid carries the ML-KEM key one chunk per message and the SDK's epoch is
 * about eighty of them, so the completed key this pass used to wait for cost
 * eighty sends. It could afford them while the composer stayed live through a
 * replay: the drive ran at the devices' pace and the reel trailed behind it. The
 * console now holds both composers while any transport is playing, so that a
 * reader cannot type into the middle of the last sentence's replay — which puts
 * a whole reel inside every send, and an epoch of them past twenty minutes.
 *
 * So the drive is a run of messages and what is read off it is the climb rather
 * than the arrival. That keeps the claim worth having: the two figures on the
 * strip are the braid's own report, the carried count rises message by message,
 * and the total beside it is a number no measurement of an envelope on this page
 * produces. It gives up a completed key that no reader sees either — eighty
 * sentences is not a thing anyone types into a demo — so nothing that was on
 * screen for a reader went unchecked with it.
 */
const BRAID_MESSAGES = 10;

/*
 * The longest the braid pass gets for the drawing to catch up with the drive.
 *
 * Every send is already reel-paced, so by the time the last one is away the
 * strip has been drawn for every message before it and this covers that last
 * message's own reel. Sized as a bound on a machine under load rather than from
 * the dwell table, for the reason `walk` gives.
 */
const BRAID_BUDGET_MS = 60000;

const DECRYPT_TIMEOUT_MS = 30000;
const LOAD_TIMEOUT_MS = 30000;

/* The longest the reel gets to play itself out, and how often it is looked at
   while it does.

   The budget covers the whole recording — every dwell, the flight between the
   cues, and the SDK work that produces them — on a machine under load, and it
   is a round number well above any of that on purpose. Tightening it to the
   dwell table would couple this file to a number that belongs upstairs and is
   meant to be retuned; loosening it costs nothing, because a reel that arrives
   ends the wait immediately and only a reel that stopped ever spends it.

   The sample interval is a compromise between an accurate trail and the cost of
   asking. A cue shorter than this can be missed from the trail, which is a
   diagnostic and not an assertion; nothing here concludes anything from a state
   being absent from it. */
const REEL_BUDGET_MS = 90000;
const REEL_SAMPLE_MS = 150;

/* A fixed viewport, so what the page chooses to fetch before the reader touches
   anything is the same on every machine that runs this. */
const VIEWPORT = { width: 1280, height: 800 };

/*
 * Every script a page fetches before the reader asks for the SDK. The
 * interaction then pulls about 1790 KB, so the tripwire sits well over an order
 * of magnitude below any build that has the SDK on its initial path.
 *
 * The homepage is the page this measures, because it is the only page with demo
 * code on it. Measured on 2026-08-16, on the console and the mobile reel:
 * 51.6 KB over twelve responses by this harness's own count. Five of the twelve
 * are the demo's, at the sizes the build wrote to disk —
 *
 *   DemoMobile   14544 B  the reel the small screen reads the run on
 *   DemoConsole   9173 B  the curtain, the settings and the stored row
 *   DemoLog       5913 B  the event log under the scene
 *   drawing        769 B  the scene's shared geometry
 *   units          127 B  the byte grammar both of them print in
 *
 * — against the page furniture that has nothing to do with the demo:
 * `theme-init.js`, `measure.js`, the commit line, the starfield mark, the theme
 * toggle, the hero's copy button, and the preload helper the bundler splits
 * out, 14099 B between them. The two instruments do not reconcile exactly and
 * are not meant to: the harness counts what the browser fetched, the breakdown
 * counts what the build emitted.
 *
 * The ceiling is 60 KB. It has moved twice — 20 KB to 32 KB when `/demo` folded
 * into this page, and 32 KB to 60 KB when the reel shipped — and both moves are
 * written down here because "the budget went up when a page got bigger" is the
 * shape of a tripwire being quietly retired. Two things make this one honest.
 * The reel is a second reading of the same run for a screen the scene does not
 * fit on, so it is the site's own wiring and not a dependency arriving; and the
 * four scenarios that used to sit under the ceiling left with the page they
 * were listed on, which is 3.7 KB the move did not have to pay for. What the
 * ceiling has always been calibrated against is the SDK's 713 KB, and 60 KB is
 * still an order of magnitude below it.
 *
 * One cost is small and worth naming. Each demo script carries its own
 * `__vite__mapDeps` array naming the SDK chunk graph, because Astro emits one
 * script per component and each dynamic `import()` needs the graph. It is not
 * worth undoing: merging the wiring into a single `<script>` would put one
 * component's handler on another component's DOM to save under a kilobyte on a
 * page that spends 1790.
 *
 * The headroom is 8.4 KB. That is worth reading before the next thing lands on
 * this page: a third reading of the run, or any component shipping a wiring
 * script the size of the reel's, will not fit, and the answer then is to find
 * the bytes rather than to raise the ceiling again.
 *
 * These are wire bytes without compression: `chrome-harness.mjs` serves the
 * build as it is on disk, while Cloudflare compresses. So this is not
 * invariant 7's budget, which is 10 KB gzip and is a *delta* — it needs a build
 * without the demo to compare against, and is measured in the proof rather than
 * here. This is the tripwire for the SDK arriving uninvited.
 *
 * The proof's table reports lower figures, and both are right. It sums the
 * files on disk; this counts what Chrome received, and `encodedDataLength` is
 * the whole response, headers included. Both see the same twelve responses —
 * there is no fetch here that the static walk misses — so the gap is a flat
 * per-response cost, 686 bytes apiece from `chrome-harness.mjs`, and the
 * 43.6 KB on disk arrives as the 51.6 KB above. Anything that changes those
 * headers moves this number without a byte of script changing, which is one
 * more reason it is a tripwire and not a budget. The ceiling is set against
 * the figure measured here.
 */
const PRE_INTERACTION_CEILING = 60 * 1024;

/*
 * The decrypted text appearing is not the end of the story for invariant 8.
 * A demo that reported the plaintext to an analytics endpoint a beat later
 * would have satisfied every assertion above while doing the exact thing this
 * harness exists to forbid. So after the text lands, keep watching: hold at
 * least QUIET_MS with no new request, and extend that window each time one
 * arrives, up to SETTLE_MAX_MS. The cap is what stops a page that polls
 * forever from hanging the run.
 */
const EGRESS_QUIET_MS = 2000;
const EGRESS_SETTLE_MAX_MS = 10000;

/*
 * The one endpoint the page is allowed to talk to, and the exact thing it is
 * allowed to say there. `/e` is the site's own cookieless collector
 * (`public/measure.js` posts to it, `src/workers/site.ts` decides what is
 * stored); the demo posts `demo_run` once a sentence has been through the SDK.
 *
 * `dist/` has no `/e` in it, so the harness's file server answers 404 and the
 * beacon lands nowhere. That is the right split: what is under test here is
 * what the page *sends*, which is the half a reader can see in their network
 * tab. What the collector then keeps is `tests/measurement.test.mjs`, which
 * drives the Worker directly.
 */
const BEACON_PATH = '/e';
const DEMO_RUN_BODY = 'demo_run /';
/* `<event> <path>[ <label>]`, the collector's wire format. The path shape is
   the one `scrubPath` reduces to; anything outside it is a payload trying to
   look like a route. */
const BEACON_SHAPE = /^([a-z_]+) (\/[a-z0-9/_.-]*)(?: ([a-z0-9-]+))?$/;

/* Astro fetches a page's module scripts after the load event, so "before the
   reader asked" means after the page has stopped asking for things of its own
   accord — not after the load event. */
const IDLE_QUIET_MS = 500;
const IDLE_MAX_MS = 5000;

// ---------------------------------------------------------------- the checks

/** Every spelling of the probe a request could plausibly carry it in. */
function egressForms(text) {
  return [
    ['cleartext', text],
    ['percent-encoded', encodeURIComponent(text)],
    ['base64', Buffer.from(text, 'utf8').toString('base64')],
  ];
}

/** Which spelling of any of `texts` this string carries, if it carries one. */
function findAny(haystack, texts) {
  if (!haystack) return null;
  for (const text of texts) {
    for (const [label, form] of egressForms(text)) {
      if (haystack.includes(form)) return label;
    }
  }
  return null;
}

function findProbe(haystack) {
  const found = findAny(haystack, [PROBE, REPEAT_PROBE]);
  if (found) return found;
  /* The nonce alone is enough: nothing else on the site contains it. */
  if (haystack?.includes(NONCE)) return 'nonce fragment';
  return null;
}

/**
 * Every request `find` recognises, named by where in it the text was and in
 * what form. The URL, the body and the headers are all searched: a page that
 * put the plaintext in a query string or a custom header has leaked it just as
 * thoroughly as one that posted it.
 */
function leaks(requests, find) {
  const found = [];
  for (const request of requests) {
    for (const [field, value] of [
      ['url', request.url],
      ['body', request.postData],
      ['headers', request.headers],
    ]) {
      const how = find(value);
      if (how) found.push(`${request.method} ${request.url} — ${how} in the ${field}`);
    }
  }
  return found;
}

/** Every request the page made to the measurement endpoint. */
function beaconsIn(requests) {
  return requests.filter((request) => {
    try {
      return new URL(request.url).pathname === BEACON_PATH;
    } catch {
      return false;
    }
  });
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/*
 * `blame` decides which failure class an exception becomes, and the choice is
 * not cosmetic. Reading `document.title` is the harness talking to the page: if
 * that throws, the harness is broken and the run says nothing about the demo.
 * Clicking the demo's own send control is the demo running: if that throws, the
 * demo is broken, which is precisely what a red result is for. Classifying the
 * second as infrastructure told a reader "this says nothing about the demo"
 * about the demo's own stack trace.
 */
async function evaluate(cdp, sessionId, expression, blame = 'harness') {
  const { result, exceptionDetails } = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (exceptionDetails) {
    const text = exceptionDetails.exception?.description ?? exceptionDetails.text ?? 'unknown';
    if (blame === 'demo') throw new Red(`the demo threw while handling the send:\n  ${text}`);
    throw new Infra(`page evaluation threw: ${text}`);
  }
  return result.value;
}

/*
 * On timeout, say what else the page reported. A blocked script and a thrown
 * handler both present as "the text never appeared", and the reader should not
 * have to go and find the cause that the harness already had in hand.
 */
async function waitFor(cdp, sessionId, expression, timeoutMs, describe, context = () => []) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, sessionId, expression)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  const extra = await context();
  throw new Red(extra.length ? `${describe}\n${extra.join('\n')}` : describe);
}

/*
 * What each half of a compound wait was holding when it ran out of time.
 *
 * A conjunction that times out names the whole condition and none of its parts.
 * "The first tab never completed a solo round trip" is equally true of a figure
 * that stalled with the text decrypted and of a decryption that never landed
 * under a figure that arrived, and the timeout alone cannot tell them apart —
 * so the one run in six that fails teaches nothing, and the next reader starts
 * from where this one started.
 *
 * Read at the moment of the failure rather than polled throughout, because what
 * is wanted is the state the run ended in, and a term that changed while the
 * wait was running would be reported as whichever sample happened to be kept.
 */
const terms = (cdp, sessionId, parts) => async () => {
  const lines = [];
  for (const [name, expression] of Object.entries(parts)) {
    let held;
    try {
      held = await evaluate(cdp, sessionId, expression);
    } catch (error) {
      /* The page being unreadable is itself the answer, and it must not replace
         the failure that is already on its way up. */
      held = `unreadable: ${error.message}`;
    }
    lines.push(`  ${name}: ${JSON.stringify(held)}`);
  }
  return lines;
};

const present = (selector) => `Boolean(document.querySelector(${JSON.stringify(selector)}))`;

/*
 * Everything the checks need to read off the console, in one round trip so that
 * no two assertions can disagree about which moment they are describing.
 *
 * `hidden` alone would not answer the question the invariants ask. An element
 * displayed away in CSS is as gone to a reader as one with the attribute set,
 * and "the relay is holding nothing" is a claim the page makes by showing one
 * element and not another.
 */
const SNAPSHOT = `(() => {
  const root = document.querySelector(${JSON.stringify(CONSOLE)});
  const visible = (element) => Boolean(element) && !element.hidden && element.offsetParent !== null;
  const text = (selector) => root.querySelector(selector)?.textContent?.trim() ?? '';
  const said = (selector) =>
    [...root.querySelectorAll(selector + ' li')].map((item) => item.textContent.trim());
  return {
    names: { a: root.dataset.${NAME_A} ?? '', b: root.dataset.${NAME_B} ?? '' },
    /* Each column's conversation as its own list. Flattened page text would
       answer "is the sentence somewhere on the page", which is true the moment
       it is typed — the claim being checked is that it reached the other one. */
    sent: said(${JSON.stringify(SENT)}),
    decrypted: said(${JSON.stringify(DECRYPTED)}).join('\\n'),
    status: text(${JSON.stringify(STATUS)}),
    /* The relay's two mutually exclusive states, per mailbox and both read: a
       page that showed neither would pass a check written against only one of
       them, and a bay lit for the wrong account is the drawing this pair is
       here to catch. */
    holdingNothing: [${JSON.stringify(MAILBOX_EMPTY('a'))}, ${JSON.stringify(MAILBOX_EMPTY('b'))}]
      .every((selector) => visible(root.querySelector(selector))),
    holdingRow: [${JSON.stringify(MAILBOX('a'))}, ${JSON.stringify(MAILBOX('b'))}]
      .some((selector) => root.querySelector(selector)?.dataset.holding === 'true'),
    /* The recorded capture: what the page shows before its script runs and what
       it goes back to if the run cannot be brought up. Read as visibility
       rather than as presence, because it is always in the HTML. */
    recorded: visible(root.querySelector(${JSON.stringify(RECORDED)})),
    scene: (() => {
      const scene = document.querySelector(${JSON.stringify(SCENE)});
      if (!scene) return null;
      /*
       * Each wheel separately. One session runs under both devices, so a scene
       * that turned one wheel and left the other alone is drawing a state the
       * protocol does not have — and a read that summed the two would pass on
       * exactly that.
       *
       * The turn count is read off the wheel's own attribute rather than
       * inferred from the key count printed beside it, so a wheel whose count
       * advanced without the drawing following is visible here. A null means the
       * attribute is absent, which is the shipped markup: no script has been
       * near it.
       */
      const wheel = (turns, keys, label) => {
        const written = scene.querySelector(turns)?.dataset?.turns;
        return {
          turns: written === undefined ? null : Number(written),
          keys: scene.querySelector(keys)?.textContent?.trim() ?? '',
          label: scene.querySelector(label)?.textContent?.trim() ?? '',
        };
      };
      /*
       * Every shelf the relay keeps, read whole.
       *
       * The label is what the slot calls the account it belongs to, and the
       * count is whatever number the slot is printing — taken as digits out of
       * the slot's own text rather than off an element this file names, because
       * how a slot draws its figure is the drawing's business and what it says
       * is the check's. The empty caption carries no digits, so a slot showing
       * nothing reads as null rather than as zero, and the two are different
       * claims.
       *
       * A slot that is absent reads as null and every check below says so in
       * those words. A slot whose side or label went wrong is absent by this
       * reading, which is the point of addressing them by the pair.
       */
      const box = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: Math.round(rect.left * 10) / 10,
          top: Math.round(rect.top * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      };
      const readSlot = (where, whereBody) => {
        const slot = scene.querySelector(where);
        const body = scene.querySelector(whereBody);
        if (!slot || !body) return null;
        const said = (body.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const digits = /\\d+/.exec(said);
        return {
          label: ${slotLabel('slot')},
          holding: slot.dataset.holding ?? null,
          count: digits ? Number(digits[0]) : null,
          said,
          box: box(slot),
        };
      };
      return {
        state: scene.dataset.sceneState ?? null,
        /* The step list the scene ships, so a check for the end state can say
           whether that state is even one the scene knows about. */
        steps: (scene.dataset.sceneSteps ?? '').split(/\\s+/).filter(Boolean),
        slots: {${SLOT_KINDS.map(
          (kind) => `
          ${kind}: {${['a', 'b'].map(
            (side) => `
            ${side}: readSlot(${JSON.stringify(SCENE_SLOT(kind, side))}, ${JSON.stringify(
              SCENE_SLOT_BODY(kind, side),
            )}),`,
          ).join('')}
          },`,
        ).join('')}
        },
        /* The count the device itself prints, for the shelf above to be held
           against. */
        deviceKeys: {
          a: scene.querySelector(${JSON.stringify(SCENE_DEVICE_KEYS('a'))})?.textContent?.trim() ?? '',
          b: scene.querySelector(${JSON.stringify(SCENE_DEVICE_KEYS('b'))})?.textContent?.trim() ?? '',
        },
        /* The generation row as it stands at the end, when nothing is moving.
           The watcher below catches it growing; this catches what it grew to,
           and it is the reading taken while no transition is running — which is
           the only moment a drawn width can be held against the width it was
           told to be. */
        keygen: {${['a', 'b'].map(
          (side) => `
          ${side}: (() => {
            const row = scene.querySelector(${JSON.stringify(SCENE_KEYGEN(side))});
            const bar = scene.querySelector(${JSON.stringify(SCENE_KEYGEN_BAR(side))});
            const track = bar?.parentElement ?? null;
            if (!row || !bar || !track) return null;
            return {
              hidden: row.hidden,
              told: bar.style.width || '',
              figure: scene.querySelector(${JSON.stringify(
                SCENE_KEYGEN_FIGURE(side),
              )})?.textContent?.trim() ?? '',
              bar: box(bar),
              track: box(track),
              /* The track's inside. Its rectangle is a border box and the bar
                 fills the content box within it, so a full bar is two border
                 widths short of the track it fills — held against the wrong one
                 of the two, a correct drawing reads as a bar that never got
                 there. */
              inner: Math.round(track.clientWidth * 10) / 10,
            };
          })(),`,
        ).join('')}
        },
        /* The two network lines, as rectangles. A line is background and has no
           text to read, so its width on the page is the only thing that can say
           whether it is drawn — and its absence below the collapse is a claim
           this file checks by measuring at two window sizes. */
        links: {
          a: box(scene.querySelector(${JSON.stringify(SCENE_LINK('a'))})),
          b: box(scene.querySelector(${JSON.stringify(SCENE_LINK('b'))})),
        },
        envelope: (() => {
          const element = scene.querySelector(${JSON.stringify(SCENE_ENVELOPE)});
          if (!element || element.hidden) return null;
          return box(element);
        })(),
        a: wheel(
          ${JSON.stringify(SCENE_WHEEL('a'))},
          ${JSON.stringify(SCENE_KEYS('a'))},
          ${JSON.stringify(SCENE_RATCHET_LABEL('a'))},
        ),
        b: wheel(
          ${JSON.stringify(SCENE_WHEEL('b'))},
          ${JSON.stringify(SCENE_KEYS('b'))},
          ${JSON.stringify(SCENE_RATCHET_LABEL('b'))},
        ),
      };
    })(),
  };
})()`;

/* The step at which the relay takes the row, and the name the envelope is
   carrying while it does. The step is the scene's own word for it, taken from
   the recording rather than from this file's idea of the story. */
const STORED_STEP = 'stored-at-relay';
const SCENE_ENVELOPE_TO = '[data-scene-envelope-to]';
const SCENE_ENVELOPE_FROM = '[data-scene-envelope-from]';

/*
 * Watch for the moment the relay takes the row, and record it as it happens.
 *
 * The reel plays itself and this harness has no hold on its clock, so a
 * measurement of a single step cannot be taken by asking for it later — by the
 * time a poll comes back the reel has moved on, and a poll fast enough to catch
 * the step is a poll that decides how long the step lasted. This installs a
 * watcher instead: the drawing writes its step onto the scene, an observer
 * fires on that write, and the reading is taken inside it.
 *
 * Two readings, because the step has two moments worth measuring. The first is
 * taken as the step begins and says which mailbox the relay lit. The second is
 * taken when the envelope stops moving and says where it came to rest, which is
 * the only reading that can be held against a slot's rectangle — an envelope
 * measured mid-flight is somewhere between two places and is not a claim about
 * either.
 *
 * The rest is taken on `transitionend` where there is a transition, and on the
 * reel leaving the step where there is not: a page under reduced motion runs no
 * transition and fires no end event, and a check that quietly recorded nothing
 * there would be a check that turns itself off on a preference. Which of the
 * two happened is recorded with the reading, so a failure can say what it
 * measured.
 *
 * Installed once. A second call would leave two observers writing over each
 * other's readings, and the run that installs it types afterwards.
 */
const WATCH_STORED = `(() => {
  const scene = document.querySelector(${JSON.stringify(SCENE)});
  if (!scene) return false;
  if (window.__oeStoredWatch) return true;
  const envelope = scene.querySelector(${JSON.stringify(SCENE_ENVELOPE)});
  if (!envelope) return false;
  const seen = { at: null, rest: null };
  window.__oeStoredWatch = seen;
  const box = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left * 10) / 10,
      top: Math.round(rect.top * 10) / 10,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };
  };
  const mailboxes = () => ({
    a: (() => {
      const slot = scene.querySelector(${JSON.stringify(SCENE_SLOT('mailbox', 'a'))});
      return slot ? { holding: slot.dataset.holding ?? null, label: ${slotLabel('slot')}, box: box(slot) } : null;
    })(),
    b: (() => {
      const slot = scene.querySelector(${JSON.stringify(SCENE_SLOT('mailbox', 'b'))});
      return slot ? { holding: slot.dataset.holding ?? null, label: ${slotLabel('slot')}, box: box(slot) } : null;
    })(),
  });
  /* What the tile is showing while the relay has it, read in the same frame as
     the mailbox it is resting on. \`sealed\` is the drawing's own word for the
     face it is wearing; \`shows\` is what a reader can actually read off it,
     taken from the rendered box rather than from the text node, because the
     sealed face hides the message in CSS and a node the page never paints is
     not something the relay was shown. */
  const shown = (element) => {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return '';
    if (getComputedStyle(element).display === 'none') return '';
    return element.textContent ?? '';
  };
  const reading = (via) => ({
    via,
    step: scene.dataset.sceneState ?? null,
    addressed: scene.querySelector(${JSON.stringify(SCENE_ENVELOPE_TO)})?.textContent?.trim() ?? '',
    sender: scene.querySelector(${JSON.stringify(SCENE_ENVELOPE_FROM)})?.textContent?.trim() ?? '',
    sealed: envelope.dataset.sealed ?? null,
    shows: shown(scene.querySelector(${JSON.stringify(ENVELOPE_TEXT)})),
    size: scene.querySelector(${JSON.stringify(ENVELOPE_SIZE)})?.textContent?.trim() ?? '',
    envelope: envelope.hidden ? null : box(envelope),
    mailboxes: mailboxes(),
  });
  const settle = (via) => {
    if (seen.rest || scene.dataset.sceneState !== ${JSON.stringify(STORED_STEP)}) return;
    seen.rest = reading(via);
  };
  envelope.addEventListener('transitionend', (event) => {
    if (event.propertyName === 'transform') settle('the envelope stopped moving');
  });
  new MutationObserver(() => {
    const step = scene.dataset.sceneState ?? null;
    if (step === ${JSON.stringify(STORED_STEP)}) {
      if (!seen.at) seen.at = reading('the relay took the row');
      return;
    }
    /* Leaving the step. The envelope has just been told where to go next and
       has not gone anywhere yet, so it is still standing where it landed —
       which is the resting place, read at the last instant it is true. */
    if (seen.at && !seen.rest) seen.rest = reading('the reel moved on');
  }).observe(scene, { attributes: true, attributeFilter: ['data-scene-state'] });
  return true;
})()`;

/* The step the devices make their keys on, in the scene's own word for it. */
const KEYGEN_STEP = 'generating-keys';

/*
 * Watch the generation bar grow, and record every value it is drawn at.
 *
 * Generation is the opening of the reel and is over before a sentence is
 * typed, so this watcher goes on before the start control is pressed — earlier
 * than the stored-row watcher above, which only has to be in place before the
 * sentence. What survives to the end of the run is the finished row, and a
 * finished row is exactly what a page that drew one frame at 100% would also
 * show. The intermediate readings are the difference, and they cannot be asked
 * for afterwards.
 *
 * The whole subtree is observed rather than the scene's step attribute alone.
 * Two generation cues in a row for the same device write the same step, and the
 * thing that changed between them is the bar's width and the text beside it —
 * which is the change worth recording, and the one an attribute filter on the
 * step would be blind to.
 *
 * Readings are taken only while the reel says it is generating, and a reading
 * identical to that side's last is dropped: the observer fires for every
 * mutation anywhere in the scene, and a row that has not changed being recorded
 * fifty times would bury the four values that matter.
 */
const WATCH_KEYGEN = `(() => {
  const scene = document.querySelector(${JSON.stringify(SCENE)});
  if (!scene) return false;
  if (window.__oeKeygenWatch) return true;
  const seen = [];
  window.__oeKeygenWatch = seen;
  const width = (element) => Math.round(element.getBoundingClientRect().width * 10) / 10;
  /* The key store is one row and it is always on the page — it is the device's
     own store, and generation fills it rather than replacing it. So there is no
     hidden row to skip, and two things say a reading belongs to generation:
     the step the observer is filtering on, and the row being the busy one.
     Each device is brought up on its own now, so the other device's store is
     on screen and empty for the whole of the first one's generation — and a
     reading taken off it would be a device drawn as having made no keys of no
     keys, which is not a figure the drawing ever claims. */
  const read = (side) => {
    const row = scene.querySelector('[data-scene-keys="' + side + '"]');
    const bar = scene.querySelector('[data-scene-keys-bar="' + side + '"]');
    const track = bar ? bar.parentElement : null;
    if (!row || !bar || !track) return null;
    if (row.dataset.busy !== 'true') return null;
    const figure = scene.querySelector('[data-scene-keys-count="' + side + '"]');
    return {
      side,
      told: bar.style.width || '',
      figure: (figure?.textContent ?? '').trim(),
      bar: width(bar),
      track: width(track),
    };
  };
  new MutationObserver(() => {
    if ((scene.dataset.sceneState ?? null) !== ${JSON.stringify(KEYGEN_STEP)}) return;
    for (const side of ['a', 'b']) {
      const now = read(side);
      if (!now) continue;
      const last = [...seen].reverse().find((entry) => entry.side === side);
      if (last && last.told === now.told && last.figure === now.figure) continue;
      seen.push(now);
    }
  }).observe(scene, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  return true;
})()`;

/*
 * Watch the two prekey shelves, and keep every figure they are drawn at.
 *
 * The decrement this exists to catch is a fact about *two* frames — what the
 * shelf said when the account published and what it says once the peer's key
 * agreement has taken a bundle off it — and only one of those survives to the
 * end of the run. A reading taken afterwards can report the second and has
 * nothing to hold it against, so the shelves are recorded as they change.
 *
 * The step is recorded with each figure rather than the figures alone. A count
 * that fell is only the right count if it fell on the step that spends one, and
 * a shelf quietly losing keys on some other frame is a different defect wearing
 * the same reading.
 *
 * Consecutive identical readings are dropped, for the reason the generation
 * watcher drops them: the scene is mutated many times per cue and a list with
 * one entry per mutation says nothing a list of changes does not.
 *
 * `MutationObserver` rather than a poll, and no clock of its own — the drawing
 * announces its own step and the reading is taken on that announcement. A poll
 * fast enough to catch a 1900 ms frame would be a poll deciding how long the
 * frame lasted.
 */
/* The frame each shelf figure is read against: the one where an account's keys
   arrive on the relay, and the one where a peer takes a bundle off them. Both
   are the scene's own words, the same strings the recording steps carry. */
const PUBLISH_STEP = 'bundles-published';
const ESTABLISH_STEP = 'session-established';

const WATCH_SHELVES = `(() => {
  const scene = document.querySelector(${JSON.stringify(SCENE)});
  if (!scene) return false;
  if (window.__oeShelfWatch) return true;
  const seen = [];
  window.__oeShelfWatch = seen;
  const read = (side) => {
    const body = scene.querySelector(
      '[data-scene-slot-body="bundles"][data-scene-side="' + side + '"]',
    );
    if (!body) return null;
    const said = (body.textContent ?? '').replace(/\\s+/g, ' ').trim();
    const digits = /\\d+/.exec(said);
    return { said, count: digits ? Number(digits[0]) : null };
  };
  new MutationObserver(() => {
    const step = scene.dataset.sceneState ?? null;
    const a = read('a');
    const b = read('b');
    if (!a || !b) return;
    const now = { step, a: a.count, b: b.count, saidA: a.said, saidB: b.said };
    const last = seen[seen.length - 1];
    if (
      last &&
      last.step === now.step &&
      last.a === now.a &&
      last.b === now.b
    ) {
      return;
    }
    seen.push(now);
  }).observe(scene, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  return true;
})()`;

/*
 * Watch the braid's strip, and keep every figure it is drawn at.
 *
 * The strip rides the envelope: it is written on the sealing step of a braided
 * message and cleared when the tile folds away, so no figure it ever showed
 * survives to the end of a run. What the check needs is the sequence — a key
 * arriving a chunk at a time is a claim about many messages, and one figure
 * read afterwards is as consistent with a strip written once as with a braid.
 *
 * Consecutive identical figures are dropped, for the reason the two watchers
 * above drop them: the scene is mutated many times per cue, and a list with one
 * entry per mutation says nothing a list of changes does not.
 */
const WATCH_BRAID = `(() => {
  const scene = document.querySelector(${JSON.stringify(SCENE)});
  if (!scene) return false;
  if (window.__oeBraidWatch) return true;
  const seen = [];
  window.__oeBraidWatch = seen;
  const strip = scene.querySelector(${JSON.stringify(SCENE_BRAID_FIGURE)});
  if (!strip) return false;
  new MutationObserver(() => {
    if (strip.hidden) return;
    const figure = (strip.textContent ?? '').trim();
    if (figure === '' || figure === seen[seen.length - 1]?.figure) return;
    seen.push({ figure, step: scene.dataset.sceneState ?? null });
  }).observe(scene, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  return true;
})()`;

/*
 * Every box the relay's column draws, measured where it is drawn.
 *
 * Rendered widths and not the values behind them. A width is what a reader sees
 * and is the one reading that cannot be satisfied by printing a number: the
 * column already prints the byte count three times over, and printing it a
 * fourth would move none of these figures. `getBoundingClientRect` is taken
 * rather than `scrollWidth` for the same reason — the width of the content a
 * box could show is not the width of the box on the page.
 *
 * Each box carries the path that locates it in the column, so two runs of the
 * page can be compared box for box without either run's markup being described
 * here. The path is child positions from the column down, which survives an
 * element being added to the column as long as both runs get it; the tag is
 * carried with it so a pair that lines up by accident after a run drew a
 * different number of children can be told apart.
 */
const RELAY_GEOMETRY = `(() => {
  const column = document.querySelector(${JSON.stringify(RELAY_COLUMN)});
  if (!column) return null;
  const drawn = [];
  const measure = (element, path) => {
    drawn.push({
      path,
      tag: element.tagName.toLowerCase(),
      classes: element.getAttribute('class') || '',
      width: Math.round(element.getBoundingClientRect().width * 10) / 10,
    });
    const children = [...element.children];
    for (let index = 0; index < children.length; index += 1) {
      measure(children[index], path === '' ? String(index) : path + '.' + index);
    }
  };
  measure(column, '');
  return {
    drawn,
    note: document.querySelector(${JSON.stringify(ROW_NOTE)})?.textContent?.trim() ?? '',
  };
})()`;

// ---------------------------------------------------------------- the harness

/*
 * Teardown must never become the reported failure, and must run even when setup
 * is what failed. Chrome keeps writing to its profile directory for a moment
 * after the kill signal, so removing it immediately raced and threw ENOTEMPTY —
 * which replaced a perfectly good red result with an infrastructure error and
 * inverted the one distinction this harness exists to make. Wait for the
 * process to go, then swallow whatever is left: it is a temp directory and the
 * OS owns it. Without this running on the setup path, a failed CDP connect
 * would leave Chrome alive and the server listening, and the harness would
 * report nothing because it would never exit.
 */
async function teardown(held) {
  for (const targetId of held.targets) {
    try {
      await held.cdp.send('Target.closeTarget', { targetId });
    } catch {}
  }
  if (held.chrome) {
    try {
      const exited = new Promise((resolve) => held.chrome.child.once('exit', resolve));
      held.chrome.child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    } catch {}
    try {
      rmSync(held.chrome.profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } catch {}
  }
  if (held.server) {
    try {
      held.server.close();
    } catch {}
  }
}

/**
 * A fresh tab with every listener the checks read from already attached.
 *
 * Both pages need the same accounting — every request with its body, every
 * script with its wire bytes and the moment it was asked for, CSP violations,
 * uncaught errors — so that lives here. What a page is then driven to do with
 * it is the caller's business, and the two callers do very different things.
 *
 * `blocked` is the list of URLs Chrome refuses before the page loads, which is
 * how the homepage's second pass makes the demo's chunks never arrive.
 */
async function openTab(cdp, held, { blocked = [] } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  held.targets.push(targetId);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const requests = [];
  const scripts = [];
  const cspViolations = [];
  const pageErrors = [];
  const blockedRequests = [];
  const postDataNeeded = [];
  const requestedAt = new Map();
  let lastRequestAt = Date.now();

  const off = cdp.on((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Network.requestWillBeSent') {
      const { request, requestId, type } = message.params;
      lastRequestAt = Date.now();
      requestedAt.set(requestId, { url: request.url, at: Date.now(), type });
      const record = {
        url: request.url,
        method: request.method,
        postData: request.postData ?? null,
        headers: JSON.stringify(request.headers ?? {}),
      };
      requests.push(record);
      /* Keep the record, not the id. A body fetched later has to land back on
         the request it belongs to — filed as a separate entry it would be a
         body with no URL, which the beacon checks cannot read. */
      if (request.hasPostData && !request.postData) postDataNeeded.push({ requestId, record });
    }
    if (message.method === 'Network.loadingFinished') {
      const request = requestedAt.get(message.params.requestId);
      /* `encodedDataLength` is bytes on the wire, which is the number the
         budget is about — the site serves these compressed in production. */
      if (request?.type === 'Script') {
        scripts.push({ ...request, bytes: message.params.encodedDataLength });
      }
    }
    if (message.method === 'Network.loadingFailed') {
      const request = requestedAt.get(message.params.requestId);
      if (request) blockedRequests.push({ ...request, reason: message.params.errorText });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails;
      pageErrors.push(d?.exception?.description ?? d?.text ?? 'unknown page exception');
    }
    if (message.method === 'Network.webSocketFrameSent') {
      lastRequestAt = Date.now();
      requests.push({
        url: message.params.response?.payloadData ? 'websocket frame' : 'websocket',
        method: 'WS',
        postData: message.params.response?.payloadData ?? null,
        headers: '{}',
      });
    }
    if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry;
      if (entry.source === 'security' || /Content Security Policy/i.test(entry.text ?? '')) {
        cspViolations.push(entry.text);
      }
    }
  });

  /*
   * Wait out network activity.
   *
   * The minimum hold is measured from the moment waiting started, not from the
   * last request. Without it, a slow decrypt would leave the connection already
   * quiet for longer than the window and this would return at once — skipping
   * exactly the interval the check exists to watch.
   *
   * Returns whether the quiet window was actually observed. A page that keeps
   * talking until the cap expires never gives us one, and the pass message has
   * to say so rather than claim a window it did not get.
   */
  async function quiet(minQuietMs, capMs) {
    const start = Date.now();
    const deadline = start + capMs;
    for (;;) {
      const now = Date.now();
      const settled = Math.min(now - lastRequestAt, now - start);
      if (settled >= minQuietMs) return true;
      if (now >= deadline) return false;
      await new Promise((r) => setTimeout(r, Math.min(200, minQuietMs - settled)));
    }
  }

  /** Go to a URL and wait for its load event, or say which page never fired. */
  async function navigate(url, what) {
    const loaded = new Promise((resolve, reject) => {
      const stop = cdp.on((m) => {
        if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
          stop();
          resolve();
        }
      });
      setTimeout(() => {
        stop();
        reject(new Infra(`${what} did not fire load within ${LOAD_TIMEOUT_MS} ms`));
      }, LOAD_TIMEOUT_MS);
    });
    await cdp.send('Page.navigate', { url }, sessionId);
    await loaded;
  }

  /** Pull bodies the browser did not hand over inline, onto their own records. */
  async function fillPostData() {
    for (const { requestId, record } of postDataNeeded) {
      try {
        const { postData } = await cdp.send('Network.getRequestPostData', { requestId }, sessionId);
        record.postData = postData;
      } catch {}
    }
  }

  /* A listener attached and then abandoned would go on filling arrays nobody
     reads for the rest of the run, so setup failing has to detach it too. */
  try {
    for (const domain of ['Page', 'Runtime', 'Network', 'Log']) {
      await cdp.send(`${domain}.enable`, {}, sessionId);
    }
    await cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { ...VIEWPORT, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    if (blocked.length) {
      await cdp.send('Network.setBlockedURLs', { urls: blocked }, sessionId);
    }
  } catch (error) {
    off();
    throw error;
  }

  return {
    sessionId,
    requests,
    scripts,
    cspViolations,
    pageErrors,
    blockedRequests,
    get lastRequestAt() {
      return lastRequestAt;
    },
    quiet,
    navigate,
    fillPostData,
    off,
  };
}

/**
 * Put a sentence through the composer the way a reader does.
 *
 * The field is cleared by hand rather than selected and overtyped: the console
 * reads `input.value` when send is pressed and nothing else, so this is the same
 * thing a reader does and two fewer round trips. `Input.insertText` rather than
 * assigning the value, so the page's own input handling runs.
 *
 * The composer comes first, because the console takes it away for the length of
 * a send and gives it back after — and a press on a control that is away is a
 * press that does nothing, which reads downstream as a demo that stopped
 * answering rather than as a harness that typed too early.
 */
async function type(cdp, sessionId, text, side = 'a') {
  await waitFor(
    cdp,
    sessionId,
    `(() => {
       const send = document.querySelector(${JSON.stringify(COMPOSE_SEND(side))});
       const input = document.querySelector(${JSON.stringify(COMPOSE(side))});
       return (Boolean(send) && !send.disabled && Boolean(input) && !input.disabled) || ${EXCUSED};
     })()`,
    DECRYPT_TIMEOUT_MS,
    `the composer on device ${side.toUpperCase()} was still away ${DECRYPT_TIMEOUT_MS} ms after ` +
      'the previous send, so the sentence could not be typed',
    () => [],
  );
  await evaluate(
    cdp,
    sessionId,
    `(() => {
       const input = document.querySelector(${JSON.stringify(COMPOSE(side))});
       input.focus();
       input.value = '';
     })()`,
    'demo',
  );
  await cdp.send('Input.insertText', { text }, sessionId);
  await evaluate(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(COMPOSE_SEND(side))}).click()`,
    'demo',
  );
}

/**
 * Send, and wait only for the composer to come back.
 *
 * The console takes both composers away for the length of a send and gives them
 * back when the reel that narrates it has finished, so this waits at the pace
 * the page plays rather than the pace the protocol works at. Which is the
 * console's decision and not this file's: a reader must not be able to type
 * into the middle of the last sentence's replay.
 *
 * A failure the console reports ends the wait too, on the same grounds as every
 * other wait here: a composer that never comes back and a page saying why it
 * did not are different outcomes, and only the caller knows which one this pass
 * was expecting.
 */
async function sendAndSettle(cdp, sessionId, text, side, describe) {
  await type(cdp, sessionId, text, side);
  await waitFor(
    cdp,
    sessionId,
    `(() => {
       const send = document.querySelector(${JSON.stringify(COMPOSE_SEND(side))});
       const status = document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? '';
       return (Boolean(send) && !send.disabled) || /did not finish/.test(status);
     })()`,
    DECRYPT_TIMEOUT_MS,
    `${describe} — the composer never came back within ${DECRYPT_TIMEOUT_MS} ms of the send`,
    () => [],
  );
}

/**
 * Read where the reel is, and whether it has arrived.
 *
 * One round trip, so the state reported and the verdict on it describe the same
 * moment. A reel that is between cues answers `false` and its current state,
 * which is what the sampling above it accumulates into a trail.
 */
async function sample(cdp, sessionId, done) {
  return evaluate(
    cdp,
    sessionId,
    `(() => {
       const root = document.querySelector(${JSON.stringify(CONSOLE)});
       const scene = document.querySelector(${JSON.stringify(SCENE)});
       if (!root || !scene) return null;
       return { done: Boolean(${done}), state: scene.dataset.sceneState ?? null };
     })()`,
    'demo',
  );
}

/**
 * Wait for the reel to reach a step, at the pace the page plays it.
 *
 * The reel runs itself: one module owns the clock and walks the recording from
 * the first cue to the last without anything pressing it. So this samples the
 * scene rather than driving it, and the states it saw come back deduplicated,
 * so a wait that expires can say where the reel stopped rather than only that
 * it did not arrive.
 *
 * The budget is wall-clock and deliberately loose. It has to cover the dwell
 * table plus the flight between cues plus the SDK's real work, and none of
 * those is this file's business — a dwell retuned upstairs must not make this
 * harness wrong. What it must never do is read the dwell table and size the
 * wait from it: a wait derived from the thing it is waiting on passes whatever
 * that thing does, including stopping.
 *
 * Ends on the demo saying why it did not run, as every wait here does. The
 * starved pass blocks the demo's chunks on purpose, so there is no recording to
 * play and there is not supposed to be one; the page says so on its status line
 * and the caller — which is the only thing that knows which pass this is — is
 * left to decide whether that was the right outcome.
 */
async function walk(cdp, sessionId, done, complaint, context = () => [], budgetMs = REEL_BUDGET_MS) {
  const deadline = Date.now() + budgetMs;
  const reached = `(${done}) || ${EXCUSED}`;
  const trail = [];
  let last = null;

  for (;;) {
    const round = await sample(cdp, sessionId, reached);
    if (round === null) throw new Red(`${complaint} — the scene is not on the page`);
    if (trail[trail.length - 1] !== round.state) trail.push(round.state);
    last = round.state;
    if (round.done) return { done: true, state: last, trail };
    if (Date.now() >= deadline) break;
    await new Promise((resume) => setTimeout(resume, REEL_SAMPLE_MS));
  }

  const extra = await context();
  throw new Red(
    `${complaint} — ${budgetMs} ms of watching the reel left the scene on "${last}"\n` +
      `  it went: ${trail.join(' → ')}` +
      (extra.length ? `\n${extra.join('\n')}` : ''),
  );
}

/**
 * Load the homepage in a fresh tab, exchange keys, type the probe, press send,
 * and report everything the browser did.
 *
 * `braid` chooses the setting the run is made under, and `null` — the default —
 * leaves the page exactly as it ships. A pass that names the setting presses the
 * switch itself and proves it took, so a run that says it was made with braid on
 * was made with braid on.
 *
 * `drive` adds a run of braided messages to the conversation and keeps every
 * figure the strip is drawn at along the way. It is off by default, and the
 * passes the drawing checks read leave it off: they are measured against each
 * other, and a run that had sent ten more messages would not be the same run.
 */
async function visit(cdp, origin, held, { blocked = [], repeat = false, braid = null, drive = false } = {}) {
  const tab = await openTab(cdp, held, { blocked });
  const { sessionId, requests, scripts, cspViolations, pageErrors, blockedRequests, quiet } = tab;

  /* What the page reported about itself, which is the likeliest cause of any
     wait here running out of time. */
  const faults = () => {
    const lines = [];
    if (cspViolations.length) {
      lines.push(
        `  The page reported ${cspViolations.length} CSP violation(s), which is the likeliest cause:`,
        ...cspViolations.map((v) => `    ${v}`),
      );
    }
    if (pageErrors.length) {
      lines.push(
        `  The page threw ${pageErrors.length} uncaught error(s):`,
        ...pageErrors.map((e) => `    ${e.split('\n')[0]}`),
      );
    }
    return lines;
  };

  /*
   * The faults, then what each half of the wait was holding when it expired.
   *
   * Every wait below is satisfied by either of two things happening — the demo
   * working, or the demo saying why it did not — so a timeout means neither
   * did, and a message naming only the conclusion cannot say which half was
   * closer. `terms` answers that; this composes it with the page's own report
   * so one failure carries both, and no leg has to remember to ask for both.
   */
  const why = (parts) => async () => [...faults(), ...(await terms(cdp, sessionId, parts)())];

  try {
    await tab.navigate(`${origin}/`, 'the homepage');

    /* Serving the built site at all is the infrastructure check. If the
       homepage did not render, nothing below would mean anything. */
    const title = await evaluate(cdp, sessionId, 'document.title');
    if (!title) throw new Infra('the homepage rendered no title — the served build looks wrong');

    if (!(await evaluate(cdp, sessionId, present(CONSOLE)))) {
      throw new Red(
        `no demo console on the homepage: nothing matches ${CONSOLE}.\n` +
          `  The site served and rendered correctly (title: ${JSON.stringify(title)}), so this is\n` +
          `  the demo being absent rather than the harness failing to reach it.`,
      );
    }
    for (const [selector, what] of [
      [START, 'a control that starts the demo'],
      [SCENE_ACTIVATE('a'), 'a control that brings the near device up'],
      [SCENE_ACTIVATE('b'), 'a control that brings the far device up'],
      [INPUT, 'a text input for the reader’s sentence'],
      [SEND, 'a control that sends it'],
      [DECRYPTED, 'a conversation on the far device'],
      [STATUS, 'a status line to report a failure in'],
      [SCENE, 'the scene the devices and the relay are drawn in'],
    ]) {
      if (!(await evaluate(cdp, sessionId, present(selector)))) {
        throw new Red(`the demo console is present but exposes no ${what} (${selector})`);
      }
    }

    /* Read before anything is pressed. The page must not be showing a stored
       row, a decrypted sentence, or a drawing past `idle` — every one of those
       is a claim about a run, and no run has happened. */
    const beforeInteraction = await evaluate(cdp, sessionId, SNAPSHOT);

    await quiet(IDLE_QUIET_MS, IDLE_MAX_MS);
    const interactedAt = Date.now();

    /*
     * The setting, before the run that reads it exists.
     *
     * Pressed rather than assigned: the console keeps its own copy of the
     * switches and updates it from the change event, so a harness that wrote
     * `checked` would tick a box the next `startDemoRun` never hears about and
     * would then report a run under a setting that was never chosen.
     *
     * Waited for rather than pressed and hoped: the switches ship inside a
     * disabled fieldset and the script enables them, so a press that arrived
     * first would land on nothing at all. `:disabled` is asked rather than the
     * `disabled` property, because the property answers for the element's own
     * attribute and says nothing about the fieldset holding it.
     */
    if (braid !== null) {
      const operable = `(() => {
         const input = document.querySelector(${JSON.stringify(BRAID_TOGGLE)});
         return Boolean(input) && !input.matches(':disabled');
       })()`;
      await waitFor(
        cdp,
        sessionId,
        operable,
        DECRYPT_TIMEOUT_MS,
        `the braid switch never became operable within ${DECRYPT_TIMEOUT_MS} ms, so a run under ` +
          `braid ${braid ? 'on' : 'off'} could not be asked for`,
        why({
          'the switch is on the page': present(BRAID_TOGGLE),
          'it reports itself disabled': `document.querySelector(${JSON.stringify(BRAID_TOGGLE)})?.matches(':disabled') ?? null`,
          'the status line': `document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? null`,
        }),
      );
      const chose = await evaluate(
        cdp,
        sessionId,
        `(() => {
           const input = document.querySelector(${JSON.stringify(BRAID_TOGGLE)});
           if (input.checked !== ${JSON.stringify(braid)}) input.click();
           return { checked: input.checked, blocked: input.matches(':disabled') };
         })()`,
        'demo',
      );
      if (chose.checked !== braid) {
        throw new Red(
          `the braid switch would not go ${braid ? 'on' : 'off'}: it was pressed and it still ` +
            `reads ${chose.checked ? 'on' : 'off'}` +
            (chose.blocked ? ', and it is unavailable' : '') +
            `\n  Nothing below would be about the setting it says it is about, so the run stops ` +
            `here rather than reporting one setting's drawing under the other's name.`,
        );
      }
    }

    /*
     * Press as a reader would, in the order the console requires.
     *
     * There are three controls before the composer. Starting brings the run up
     * — a relay and no devices — and then each phone comes up on its own
     * Register press, which is where its keys are made and its bundle
     * published. The composers stay unavailable until both are up, so a harness
     * that went straight for send would press a disabled button and report the
     * demo as broken. Driving all three is not the harness being polite about
     * the UI: they are the steps the page has, and the first press of each is
     * the reader's own.
     *
     * The chunk arrives on the start press, which is why it happens after the
     * byte accounting boundary rather than during setup.
     *
     * Blamed on the demo for the same reason as the click: the elements were
     * there a moment ago, so if they are gone now the demo's own script moved
     * them, and a demo that re-renders itself out from under the reader is not
     * an infrastructure fault.
     */
    /* Before the press, because generation is the first thing the reel draws
       and there is no later moment at which it can be watched. */
    if ((await evaluate(cdp, sessionId, WATCH_KEYGEN, 'demo')) !== true) {
      throw new Red(
        `the scene has no generation row to watch (${SCENE_KEYGEN('a')}), so the devices making ` +
          `their keys cannot be measured`,
      );
    }

    /* Before the press for the same reason: the shelves fill on the publish
       step, which the opening reaches on its own, and the figure they fill to
       is what the spend later has to be lower than. */
    if ((await evaluate(cdp, sessionId, WATCH_SHELVES, 'demo')) !== true) {
      throw new Red(
        `the scene has no prekey shelf to watch (${SCENE_SLOT_BODY('bundles', 'a')}), so what the ` +
          `relay holds for each account cannot be followed as it changes`,
      );
    }

    await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(START)}).click()`, 'demo');

    /*
     * Then a device at a time, each on its own press.
     *
     * Waited on the control before it is pressed, because the run has to exist
     * for a device to be registered against it: the console holds the buttons
     * until the modules have arrived and `startDemoRun` has returned. A press
     * that arrived first would land on a disabled button and the run would sit
     * here with no devices, reporting only that a sentence never went anywhere.
     *
     * Both presses, left then right, and both are the reader's: the page draws
     * a phone that is not yet a device and asks for the press that makes it one.
     * A harness that pressed one would be driving half the demo.
     *
     * Either outcome ends each wait: a control that can be pressed, or a status
     * line saying why nothing can. Waiting on the control alone would not
     * distinguish them — `enable()` re-runs on both paths.
     */
    for (const side of ['a', 'b']) {
      const activate = SCENE_ACTIVATE(side);
      await waitFor(
        cdp,
        sessionId,
        `(() => {
           const button = document.querySelector(${JSON.stringify(activate)});
           return (Boolean(button) && !button.disabled) || ${EXCUSED};
         })()`,
        DECRYPT_TIMEOUT_MS,
        `device ${side.toUpperCase()}'s register control never became operable within ` +
          `${DECRYPT_TIMEOUT_MS} ms of the start control being pressed, so that device could ` +
          `not be brought up`,
        why({
          'the control is on the page': present(activate),
          "the control's disabled": `document.querySelector(${JSON.stringify(activate)})?.disabled ?? null`,
          'the status line': `document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? null`,
        }),
      );
      if (await evaluate(cdp, sessionId, EXCUSED)) break;
      await evaluate(
        cdp,
        sessionId,
        `document.querySelector(${JSON.stringify(activate)}).click()`,
        'demo',
      );
    }

    /* And then the composer, which is live only once both devices are up: a
       sentence needs somewhere to go, and the run refuses a send to a device
       that does not exist. */
    await waitFor(
      cdp,
      sessionId,
      `(() => {
         const root = document.querySelector(${JSON.stringify(CONSOLE)});
         const send = root.querySelector(${JSON.stringify(SEND)});
         const status = root.querySelector(${JSON.stringify(STATUS)})?.textContent ?? '';
         return !send.disabled || /did not finish/.test(status);
       })()`,
      DECRYPT_TIMEOUT_MS,
      `both devices were registered and neither a composer nor a failure appeared within ` +
        `${DECRYPT_TIMEOUT_MS} ms`,
      why({
        "the send button's disabled": `document.querySelector(${JSON.stringify(SEND)}).disabled`,
        "device A's register control": `document.querySelector(${JSON.stringify(SCENE_ACTIVATE('a'))})?.disabled ?? null`,
        "device B's register control": `document.querySelector(${JSON.stringify(SCENE_ACTIVATE('b'))})?.disabled ?? null`,
        'the status line': `document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? null`,
      }),
    );

    /* What starting alone did, before a sentence is typed. The relay has
       carried two public bundles by now and is still holding no row, which is a
       claim the page makes and this is where it is true. */
    const afterStart = await evaluate(cdp, sessionId, SNAPSHOT);

    /* The watcher goes on before the sentence does, because what it is waiting
       for happens in the middle of the reel and cannot be asked for afterwards. */
    if ((await evaluate(cdp, sessionId, WATCH_STORED, 'demo')) !== true) {
      throw new Red(
        `the scene has no envelope to watch (${SCENE_ENVELOPE}), so where the relay puts a ` +
          `stored row cannot be measured`,
      );
    }

    /* And the braid's, on the same terms: the strip is written on a sealing step
       and cleared when the tile folds away, so it is watched from before the
       first sentence rather than read after the last. */
    if (drive && (await evaluate(cdp, sessionId, WATCH_BRAID, 'demo')) !== true) {
      throw new Red(
        `the scene has no chunk strip to watch (${SCENE_BRAID_FIGURE}), so what the braid is ` +
          `carrying per message cannot be read`,
      );
    }

    await type(cdp, sessionId, PROBE);

    /*
     * The reel moves off the step starting left it on, unaided.
     *
     * This is the wait that proves the drawing runs by itself, and it is worth
     * separating from the sentence arriving: the wait below would sit out a reel
     * that had never started for its whole budget and report only that the
     * sentence never came, which names the symptom and not the cause. A failure
     * reported on the status line ends the wait too — this
     * pass is the same interaction in both passes, and only the blocklist
     * differs, so which outcome was supposed to happen is the caller's business.
     */
    const parkedAt = afterStart.scene?.state ?? null;
    await waitFor(
      cdp,
      sessionId,
      `(() => {
         const root = document.querySelector(${JSON.stringify(CONSOLE)});
         const status = root.querySelector(${JSON.stringify(STATUS)})?.textContent ?? '';
         if (/did not finish/.test(status)) return true;
         const scene = document.querySelector(${JSON.stringify(SCENE)});
         return !scene || (scene.dataset.sceneState ?? null) !== ${JSON.stringify(parkedAt)};
       })()`,
      DECRYPT_TIMEOUT_MS,
      `a sentence was sent and the scene never left "${parkedAt}" on its own within ` +
        `${DECRYPT_TIMEOUT_MS} ms — the reel is not advancing`,
      why({
        "the scene's state": `document.querySelector(${JSON.stringify(SCENE)})?.dataset.sceneState ?? null`,
        'the state it was parked on': JSON.stringify(parkedAt),
        'the status line': `document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? null`,
      }),
    );

    /* Then to the end of the recording, at the reader's pace, because there is
       no other pace on offer. The far device's conversation is written when the
       reel reaches the step that decrypted, so this is what makes the sentence
       readable.

       Waited on the sentence rather than on the step: a second send replays the
       whole recording, so the first `opened` a walk meets is the one belonging
       to the message before it. The sentence is what the caller is waiting for
       and is unambiguous about which message it means. */
    await walk(
      cdp,
      sessionId,
      `(root.querySelector(${JSON.stringify(DECRYPTED)})?.textContent ?? '').includes(` +
        `${JSON.stringify(PROBE)})`,
      `the far device never showed the sentence`,
      why({
        'the status line': `document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? null`,
        "the near device's conversation": `document.querySelector(${JSON.stringify(SENT)})?.textContent ?? null`,
        "the far device's conversation": `document.querySelector(${JSON.stringify(DECRYPTED)})?.textContent ?? null`,
        "the send control's disabled": `document.querySelector(${JSON.stringify(SEND)})?.disabled ?? null`,
        'the composer holds': `document.querySelector(${JSON.stringify(INPUT)})?.value ?? null`,
        'the reel is on': `document.querySelector(${JSON.stringify(SCENE)})?.dataset.sceneState ?? null`,
      }),
    );

    /* Read the panel before touching it again, so the assertions about the
       first sentence are about the moment the first sentence landed. */
    const afterFirst = await evaluate(cdp, sessionId, SNAPSHOT);

    /* And what the watcher caught on the way here, which is the one reading in
       this file that describes a step the run has already left. */
    const stored = await evaluate(cdp, sessionId, 'window.__oeStoredWatch ?? null', 'demo');

    /* And what the other watcher caught before any of this: the two devices
       making their keys, which happened while the start control was still the
       only thing that had been pressed. */
    const keygen = await evaluate(cdp, sessionId, 'window.__oeKeygenWatch ?? null', 'demo');

    /* And the shelves, every figure they were drawn at from the publish to
       here. Read at the same point as the generation rows: the first sentence
       has landed, so the step that spends a bundle is behind us. */
    const shelves = await evaluate(cdp, sessionId, 'window.__oeShelfWatch ?? null', 'demo');

    if (repeat) {
      await type(cdp, sessionId, REPEAT_PROBE);
      await walk(
        cdp,
        sessionId,
        `(root.querySelector(${JSON.stringify(DECRYPTED)})?.textContent ?? '').includes(` +
          `${JSON.stringify(REPEAT_PROBE)})`,
        `the demo returned the first sentence and then never returned the second — the repeat ` +
          `send is a warm session, not a cold one`,
      );
    }

    /*
     * A reply, and then a third sentence on top of it.
     *
     * The first two sentences a device sends are both prekey messages: until
     * the far device answers, every one of them carries the whole handshake
     * again and the setting under test barely shows in the size. The reply is
     * what agrees the session properly and starts the ratchet, so the sentence
     * after it is the first one whose size is the session's own — which is the
     * message the two settings differ over, and therefore the one the column
     * has to be measured on.
     */
    if (braid !== null) {
      await type(cdp, sessionId, REPLY_PROBE, 'b');
      await walk(
        cdp,
        sessionId,
        `(root.querySelector(${JSON.stringify(SENT)})?.textContent ?? '').includes(` +
          `${JSON.stringify(REPLY_PROBE)})`,
        `the far device never answered, so the session never left its handshake`,
      );
      await type(cdp, sessionId, STEADY_PROBE, 'a');
      await walk(
        cdp,
        sessionId,
        `(root.querySelector(${JSON.stringify(DECRYPTED)})?.textContent ?? '').includes(` +
          `${JSON.stringify(STEADY_PROBE)})`,
        `the conversation was answered and the next sentence never arrived`,
      );
    }

    /*
     * A run of braided messages, and every figure the strip is drawn at along
     * the way.
     *
     * The chunks the braid carries are added one per message, so the only way to
     * see the count climb is to send the messages that carry them. The drive
     * alternates for that reason: each side adds its chunk on the messages it
     * sends, and a conversation that only ever went one way would carry half a
     * braid however long it ran.
     *
     * Driven at the reel's pace, because the console holds the composer for the
     * whole of a replay and there is no faster door into the page. What that
     * costs is why the drive is a run of messages and not an epoch of them; see
     * `BRAID_MESSAGES`.
     *
     * `BRAID_MESSAGES` more, rather than that many in total. The sentences above
     * are already in the conversation, so counting from here is the bound that
     * holds whatever preceded it.
     */
    let braidChunks = null;
    if (drive) {
      for (let turn = 0; turn < BRAID_MESSAGES; turn += 1) {
        await sendAndSettle(
          cdp,
          sessionId,
          BRAID_PROBE(turn),
          turn % 2 === 0 ? 'b' : 'a',
          `the conversation stopped ${turn} messages into a run of ${BRAID_MESSAGES}`,
        );
      }

      /*
       * Then wait for the drawing to have a figure for every message.
       *
       * Waited on what the watcher has recorded rather than on the strip as it
       * stands: the strip belongs to the envelope, so a poll of the page is a
       * poll against a tile that folds away between messages, and the figure
       * would be gone by the time a sample landed on it.
       *
       * Waited on the figures rather than on a step, too. A step is written for
       * every message and would arrive whether a braid had carried anything or
       * not; a count of chunks is the braid's own report and nothing else on the
       * page can produce it.
       */
      await walk(
        cdp,
        sessionId,
        `(window.__oeBraidWatch ?? []).length >= ${BRAID_MESSAGES}`,
        `${BRAID_MESSAGES} alternating messages went through the braid and the strip was drawn ` +
          `for fewer of them than that`,
        why({
          'what the strip has been drawn at': `JSON.stringify((window.__oeBraidWatch ?? []).map((entry) => entry.figure))`,
          'the reel is on': `document.querySelector(${JSON.stringify(SCENE)})?.dataset.sceneState ?? null`,
          'the status line': `document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? null`,
        }),
        BRAID_BUDGET_MS,
      );

      braidChunks = await evaluate(cdp, sessionId, 'window.__oeBraidWatch ?? null', 'demo');
    }

    /*
     * And to the end of the recording, so the state the checks read is the one
     * the run finishes in rather than wherever the last sentence happened to
     * leave it. Already there when the reel's last cue is the one that decrypted
     * — the wait costs one sample and returns — and not when a repeat or a
     * braid drive put something after it.
     */
    await walk(
      cdp,
      sessionId,
      `scene.dataset.sceneState === ${JSON.stringify(SCENE_END_STATE)}`,
      `the devices completed a round trip and the scene never reached "${SCENE_END_STATE}"`,
    );

    const wentQuiet = await quiet(EGRESS_QUIET_MS, EGRESS_SETTLE_MAX_MS);
    const dom = await evaluate(cdp, sessionId, SNAPSHOT);
    /* Measured after the reel has arrived and the page has gone quiet, so the
       column is drawing the state the run finished in rather than a frame of
       the journey there. */
    const geometry = await evaluate(cdp, sessionId, RELAY_GEOMETRY);

    await tab.fillPostData();

    /* A script *requested* before the interaction was requested without one,
       whenever it happened to finish arriving. */
    const before = scripts.filter((script) => script.at < interactedAt);
    const after = scripts.filter((script) => script.at >= interactedAt);
    return {
      names: dom.names,
      beforeInteraction,
      afterStart,
      afterFirst,
      stored,
      keygen,
      shelves,
      dom,
      geometry,
      braid,
      braidChunks,
      repeated: repeat,
      requests,
      cspViolations,
      pageErrors,
      blockedRequests,
      wentQuiet,
      before,
      after,
      bytesBefore: before.reduce((sum, script) => sum + script.bytes, 0),
      bytesAfter: after.reduce((sum, script) => sum + script.bytes, 0),
    };
  } finally {
    tab.off();
  }
}

// ----------------------------------------------------------------- the verdict

/*
 * What the sealed message must be addressed to, computed rather than quoted.
 *
 * The drawing writes two facts on the outside of the envelope, the two the
 * relay can read: who it is for and who it is from. Both are taken off the
 * envelope object the relay stored, through a field table the console declares
 * — and a harness that typed the account names here would go green against a
 * page that had them typed in too, which is the drift this check exists to
 * stop.
 *
 * So the expectation is derived the way the drawing's own values are supposed
 * to be: run the real driver here in Node, against the same installed package
 * the browser loads, and read the addressing out of the envelope it produces,
 * through the same field names the console declares. The field names are read
 * out of the console source rather than retyped, so a table that moved takes
 * the expectation with it and cannot quietly stop being checked.
 *
 * Equality with a live envelope does not make a hand-typed value fail *today*:
 * names that happen to be correct right now print correctly. What it does is
 * turn the next `Envelope` change into a red run instead of a silent
 * divergence. Reading the envelope through nothing but the declared table is a
 * property of the source, and `tests/demo-panel.test.mjs` is where that is
 * held.
 */
async function expectedAddressing(envelopeFields) {
  const consoleSource = await readFile(
    new URL('../src/components/demo/DemoConsole.astro', import.meta.url),
    'utf8',
  );
  const table = consoleSource.match(/NAMED_FIELDS = \{(.*?)\}/s)?.[1];
  if (table === undefined) {
    throw new Infra(
      'could not read NAMED_FIELDS out of DemoConsole.astro, so this run cannot tell which ' +
        'envelope fields the drawing is supposed to be addressed from',
    );
  }
  const named = Object.fromEntries(
    [...table.matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((match) => [match[1], match[2]]),
  );
  for (const half of ['to', 'from']) {
    if (!named[half]) {
      throw new Infra(
        `the console's field table names no envelope field for "${half}", so half the addressing ` +
          `the drawing shows could not be checked against a real envelope`,
      );
    }
    if (!envelopeFields.has(named[half])) {
      throw new Infra(
        `the console reads "${named[half]}" for the envelope's ${half}, and the installed SDK ` +
          `does not declare it on Envelope — the table is stale and this run would expect the ` +
          `wrong name`,
      );
    }
  }

  /* And under the same two accounts. The console runs the SDK under the names
     it prints over the columns, so an envelope built here under the driver's
     own defaults would be addressed to a device this page has never heard of —
     and the check would fail on the accounts rather than on the drawing. Read
     from the same source the run reads, for the same reason the field table
     is. */
  const accounts = consoleSource.match(/NAMES = \{(.*?)\}/s)?.[1];
  const names = Object.fromEntries(
    [...(accounts ?? '').matchAll(/(\w+)\s*:\s*'([^']+)'/g)].map((match) => [match[1], match[2]]),
  );
  if (!names.a || !names.b) {
    throw new Infra(
      'could not read NAMES out of DemoConsole.astro, so this run cannot build an envelope for ' +
        'the accounts the page is running the SDK under',
    );
  }

  let envelope;
  try {
    const session = await startDemoSession({ sender: names.a, recipient: names.b });
    ({ envelope } = await session.send('probe for the expected addressing'));
  } catch (cause) {
    throw new Infra(`the driver could not produce an envelope to expect: ${cause}`);
  }

  const expected = { to: envelope[named.to], from: envelope[named.from] };
  for (const [half, value] of Object.entries(expected)) {
    if (typeof value !== 'string' || value.length === 0) {
      throw new Infra(
        `a live envelope carried no ${half} in "${named[half]}" (${JSON.stringify(value)}), so ` +
          `there is nothing to hold the drawing against and checking it would prove nothing`,
      );
    }
  }
  return expected;
}

/*
 * What the page said to its own collector, checked as a whole string.
 *
 * Two sentences went through the demo in this pass, so a `demo_run` count is
 * the difference between the privacy notice's "one is sent per page" and a
 * panel that quietly measures each send.
 *
 * The accepted names come from the Worker's own `EVENTS`, imported rather than
 * retyped: a beacon carrying a name that source does not know is dropped on
 * arrival, so the site would be measuring nothing and looking like it was, and
 * a copy of the list in this file would go stale in the way that hides it.
 */
function checkBeacons(pass) {
  const beacons = beaconsIn(pass.requests);

  for (const beacon of beacons) {
    const body = beacon.postData ?? '';
    const shape = BEACON_SHAPE.exec(body);
    if (!shape) {
      throw new Red(
        `a beacon body is not the collector's wire format: ${JSON.stringify(body)}\n` +
          `  It has to be "<event> <path>" and at most a label, because those are the only ` +
          `three things\n  src/workers/site.ts will store. Anything else is a field somebody added.`,
      );
    }
    if (!EVENTS.has(shape[1])) {
      throw new Red(
        `the page sent "${shape[1]}", which src/workers/site.ts does not accept — the collector ` +
          `drops it,\n  so the site is measuring nothing while looking like it is`,
      );
    }
  }

  const runs = beacons.filter((beacon) => (beacon.postData ?? '').startsWith('demo_run'));
  if (runs.length === 0) {
    throw new Red(
      'two sentences round-tripped and nothing measured either of them: no demo_run beacon was ' +
        'sent.\n  The panel calls window.oeMeasure, which public/measure.js publishes — check ' +
        'that both are on the page.',
    );
  }
  if (runs.length > 1) {
    throw new Red(
      `two sentences produced ${runs.length} demo_run beacons. The panel is measuring per send, ` +
        `and /legal/privacy\n  says one is sent per page, not per sentence.`,
    );
  }
  if (runs[0].postData !== DEMO_RUN_BODY) {
    throw new Red(
      `the demo's beacon reads ${JSON.stringify(runs[0].postData)}, not ` +
        `${JSON.stringify(DEMO_RUN_BODY)}.\n  It has grown a dimension, and the only material on ` +
        `that page to derive one from is what the reader typed —\n  its length, the ciphertext's ` +
        `size, the milliseconds. None of those may leave the tab.`,
    );
  }
  return beacons;
}

function checkRoundTrip(pass, origin, envelopeFields, expected) {
  /*
   * Nothing may be claimed before anything has run.
   *
   * Three separate claims, and all three are checked, because the console can
   * make any one of them without the others: a scene past `idle` says a
   * protocol step happened, a stored row says the relay took an envelope, and a
   * sentence in either device says it holds one. The page ships with the whole
   * arrangement in its HTML, so the first of these is the one a build could get
   * wrong without anyone noticing.
   */
  const before = pass.beforeInteraction;
  if (before.scene && before.scene.state !== 'idle') {
    throw new Red(
      `the scene was showing "${before.scene.state}" before anything had been pressed — ` +
        `the shipped HTML is claiming a protocol step that has not happened`,
    );
  }
  /* And no wheel had turned. The state attribute and the turn count are written
     by different calls, so a build that shipped a turned wheel under an `idle`
     scene would pass the check above and be drawing a key nobody derived.

     Zero and absent both pass here. Absent is the shipped markup — the module
     stamps the count when it mounts, and this is read early enough that it may
     not have — and a wheel that is still absent after a round trip is caught
     further down, where it means something. */
  for (const side of ['a', 'b']) {
    if (before.scene?.[side]?.turns) {
      throw new Red(
        `device ${side}'s wheel was ${before.scene[side].turns} turn(s) along before anything ` +
          'had been pressed — the shipped HTML is claiming a message key that has not been ' +
          'derived',
      );
    }
  }
  if (!before.holdingNothing || before.holdingRow) {
    throw new Red(
      'the relay column was showing a stored row before anything had been sent',
    );
  }
  if (before.sent.length || before.decrypted) {
    throw new Red(
      `a conversation had a sentence in it before anything had been typed:\n` +
        `  ${pass.names.a}: ${before.sent.join(' / ') || '(nothing)'}\n` +
        `  ${pass.names.b}: ${before.decrypted || '(nothing)'}`,
    );
  }
  /* The recorded capture is for the reader who cannot run the demo. This reader
     can, and the script has already said so by enabling the controls, so a
     recording still on screen would put a round trip from another machine
     underneath a live one and leave the reader to work out which is which. */
  if (before.recorded) {
    throw new Red(
      'the console is interactive and the recorded capture is still on the page, so two round ' +
        'trips are showing at once and only one of them happened in this tab',
    );
  }

  /* The key exchange is a real step and it is not a send. Public bundles went
     through the relay, and the relay is still holding no message — which is the
     distinction the console gives its own control to make. */
  if (pass.afterStart.holdingRow) {
    throw new Red(
      'the key exchange alone put a stored row in the relay column — the exchange is being ' +
        'drawn as a message, or the send ran without being pressed',
    );
  }

  if (/did not finish/.test(pass.dom.status)) {
    throw new Red(`the demo reported a failure: ${pass.dom.status}`);
  }
  if (!pass.afterFirst.decrypted.includes(PROBE)) {
    throw new Red(
      `the typed sentence did not reach the far device:\n  sent:      ${PROBE}\n` +
        `  ${pass.names.b} has: ${pass.afterFirst.decrypted || '(nothing)'}`,
    );
  }
  if (pass.repeated && !pass.dom.decrypted.includes(REPEAT_PROBE)) {
    throw new Red(
      `the demo returned the first sentence and not the second. The session was already warm ` +
        `and the ratchet had moved on:\n  sent:      ${REPEAT_PROBE}\n` +
        `  ${pass.names.b} has: ${pass.dom.decrypted || '(nothing)'}`,
    );
  }
  /* The sending device kept its own copy, which is what makes the far column a
     round trip rather than the only place the sentence was ever rendered. */
  if (!pass.dom.sent.some((line) => line.includes(PROBE))) {
    throw new Red(
      `the far device has the sentence and the device that typed it does not:\n` +
        `  ${pass.names.a}: ${pass.dom.sent.join(' / ') || '(nothing)'}`,
    );
  }
  /* What the relay did with the row is not read here. The mailbox holds while
     the relay has the row and empties when the far device collects it, so the
     end of the reel is the one moment in the whole run when "holding nothing"
     is the correct drawing. The row is checked where it exists — `stored`, out
     of the watcher — and the empty rack it leaves behind is checked in
     `checkRelayShelves`. */

  const carried = leaks(pass.requests, findProbe);
  if (carried.length) {
    throw new Red(
      `the typed sentence left the page in ${carried.length} request(s):\n  ${carried.join('\n  ')}`,
    );
  }

  /* Nowhere else, either. The probe search proves the sentence did not go; this
     proves nothing at all went off our own origin, which is the claim a reader
     opening the network tab is actually reading. `data:` and `blob:` URLs never
     reach a network, so a scheme test is the filter, not an allowlist. */
  const offOrigin = pass.requests.filter(
    (request) => /^https?:/i.test(request.url) && new URL(request.url).origin !== origin,
  );
  if (offOrigin.length) {
    throw new Red(
      `the demo page talked to ${offOrigin.length} host(s) that are not this site:\n  ` +
        offOrigin.map((request) => `${request.method} ${request.url}`).join('\n  '),
    );
  }

  /* On our origin is not the same as accounted for. A page can post a summary
     of what was typed — a length, a byte count, a timing — to a path of its own
     and satisfy both checks above: same host, and no probe text to find. So the
     page gets exactly one destination for anything it sends, and it is the
     beacon whose whole body the next check reads. A GET is how the page fetches
     what it needs to run; anything else is the page talking, and a WebSocket
     frame is the page talking whatever its URL looks like. */
  const sent = pass.requests.filter((request) => {
    if (request.method === 'GET') return false;
    if (!/^https?:/i.test(request.url)) return true;
    return new URL(request.url).pathname !== BEACON_PATH;
  });
  if (sent.length) {
    throw new Red(
      `the demo page sent ${sent.length} request(s) somewhere other than ${BEACON_PATH}, where ` +
        `nothing reads what they carry:\n  ` +
        sent
          .map((request) => `${request.method} ${request.url} — ${request.postData ?? '(no body)'}`)
          .join('\n  '),
    );
  }

  checkBeacons(pass);

  if (pass.cspViolations.length) {
    throw new Red(
      `the demo ran but the page reported ${pass.cspViolations.length} CSP violation(s):\n  ` +
        pass.cspViolations.join('\n  '),
    );
  }
  if (pass.pageErrors.length) {
    throw new Red(`the demo ran and the page threw:\n  ${pass.pageErrors.join('\n  ')}`);
  }

  /*
   * Invariant 4, on the addressing. The value written on the envelope has to be
   * the value on the envelope object, so it is held against one this process
   * built from the same package.
   *
   * Only the recipient is compared. Sealed sender is on by default and the
   * drawing is the lens: with it on the sender's half is blank on purpose, and
   * a check that demanded a name there would be demanding the demo undo the
   * thing it is demonstrating. That the blank is a lens rather than a gap is
   * `tests/demo-run.test.mjs`'s to hold — it proves the field the lens covers
   * is one a real send produced.
   */
  const stored = pass.stored?.at;
  if (!stored) {
    throw new Red(
      `the relay took a sentence and the scene never drew "${STORED_STEP}", so what the ` +
        `envelope was addressed to while the relay held it was never on screen`,
    );
  }
  if (stored.addressed !== expected.to) {
    throw new Red(
      `the envelope the relay held is addressed to ${JSON.stringify(stored.addressed)} and an ` +
        `envelope built from the same package in this process is addressed to ` +
        `${JSON.stringify(expected.to)}.\n` +
        `A drawing that reads the address off the stored envelope cannot disagree with it. This ` +
        `one did, so it is not being drawn that way.`,
    );
  }
  if (stored.sender !== '' && stored.sender !== expected.from) {
    throw new Red(
      `the envelope the relay held names ${JSON.stringify(stored.sender)} as its sender, and an ` +
        `envelope built from the same package in this process names ` +
        `${JSON.stringify(expected.from)}`,
    );
  }

  /*
   * And the relay is not shown the message.
   *
   * The tile wears a sealed face while the relay has it, and the sealed face
   * does not paint the sentence. Read as what is rendered rather than as what
   * the node holds: the drawing keeps the text through the journey so the
   * opening has something to reveal, and a check on the text node alone would
   * fail a page that is behaving. What the reader can see at the relay is the
   * claim, and the size beside it is what a relay legitimately knows.
   */
  if (stored.sealed !== 'true') {
    throw new Red(
      `the message resting in the relay's mailbox is drawn ${JSON.stringify(stored.sealed)}, not ` +
        `sealed — the relay is being shown an open envelope`,
    );
  }
  const leaked = findProbe(stored.shows ?? '');
  if (leaked) {
    throw new Red(
      `the message resting in the relay's mailbox shows the sentence itself (${leaked}) — the ` +
        `drawing is handing the relay the plaintext`,
    );
  }
  /*
   * The size beside it is a measurement, not decoration.
   *
   * It is the one fact about the contents a relay legitimately holds, so it has
   * to be the size of what is stored. Two things are held against it. The
   * grammar is `humanBytes`'s, so a figure assembled anywhere else reads wrong
   * here. And the quantity has to exceed the sentence: ciphertext is the
   * sentence plus a header, so a figure that fits inside the plaintext is a
   * drawing measuring the wrong thing — which is what a size taken off the typed
   * text would look like.
   */
  const size = STORED_SIZE.exec(stored.size ?? '');
  if (!size) {
    throw new Red(
      `the message resting in the relay's mailbox carries ${
        stored.size ? `"${stored.size}"` : 'no size'
      } where its size belongs, so the drawing shows the relay neither of the two facts it has`,
    );
  }
  const bytes = Number(size[1]) * { B: 1, KB: 1024, MB: 1024 * 1024 }[size[2]];
  if (bytes <= Buffer.byteLength(PROBE, 'utf8')) {
    throw new Red(
      `the relay's mailbox says it is holding ${stored.size}, and the sentence alone is ` +
        `${Buffer.byteLength(PROBE, 'utf8')} bytes — no envelope carrying it can be that small, ` +
        `so the figure is not a measurement of what is stored`,
    );
  }

  checkScene(pass);
  checkKeyGeneration(pass);
  const spend = checkPrekeySpend(pass);
  checkRelayShelves(pass, spend);
  checkStoredMailbox(pass);
  if (pass.repeated) checkSceneMoves(pass.afterFirst, pass.dom);

  /* Invariant 7. Nothing SDK-shaped before the reader asked. */
  if (pass.bytesBefore > PRE_INTERACTION_CEILING) {
    throw new Red(
      `${kb(pass.bytesBefore)} of JavaScript arrived before the first interaction, over the ` +
        `${kb(PRE_INTERACTION_CEILING)} tripwire — something on the demo's static path reaches ` +
        `the SDK:\n  ${pass.before.map((s) => `${s.url} (${s.bytes} B)`).join('\n  ')}`,
    );
  }
  if (pass.after.length === 0) {
    throw new Red(
      'the interaction fetched no chunk at all — the SDK was already on the page before the ' +
        'reader touched it, or the demo is not the code under test',
    );
  }

  /* For the PASS line: the two figures one shelf was drawn at, which no reading
     of the settled page can recover. */
  return { spend };
}

/*
 * The scene told the same story the relay column and the log just finished, and
 * told it about this run rather than about the state the build shipped.
 *
 * Split out because it is the one part of the page whose failure is invisible.
 * The rest proves itself: no ciphertext, no decrypted line, nothing on screen.
 * The devices, the relay and the wheels ship complete in the HTML, so if the
 * scene's script never mounts, or mounts and loses the reel's cues, the page
 * still shows the whole arrangement in its shipped state — beside a log that
 * plainly ran. Only a reader would notice, and only if they looked twice.
 */
function checkScene(pass) {
  const scene = pass.dom.scene;
  if (!scene) {
    throw new Red(
      `the devices completed a round trip and ${SCENE} matched nothing on the page — the ` +
        `demo shipped without its scene`,
    );
  }
  /* Named before it is compared against, so a scene that renamed or dropped the
     step reports that rather than reporting a state mismatch it cannot reach. */
  if (!scene.steps.includes(SCENE_END_STATE)) {
    throw new Red(
      `the scene's own step list has no "${SCENE_END_STATE}" in it: ${
        scene.steps.join(' ') || '(empty)'
      }`,
    );
  }
  if (scene.state !== SCENE_END_STATE) {
    throw new Red(
      `the far device decrypted the sentence and the scene around it is showing ` +
        `${scene.state ? `"${scene.state}"` : 'no state at all'} rather than ` +
        `"${SCENE_END_STATE}" — the scene and the log are describing different runs`,
    );
  }

  /*
   * A turn count at all, which only a script that ran can have written.
   *
   * This is the check that separates a mounted scene from the markup the build
   * shipped: the wheel is drawn in the HTML but carries no count until the
   * client module stamps one at mount. A scene that never woke up reaches here
   * with the attribute still absent, which is why this reads absent rather than
   * zero — zero is a mounted wheel that has not turned, and the check below is
   * the one entitled to have an opinion about that.
   */
  for (const side of ['a', 'b']) {
    if (scene[side].turns === null) {
      throw new Red(
        `device ${side}'s wheel carries no turn count after a round trip — the count is ` +
          'written by the client module at mount, so an absent one is a scene whose script ' +
          'never ran, under a log that plainly did',
      );
    }
  }

  /*
   * What the wheel is called, on both devices.
   *
   * The caption ships unnamed and the client module replaces it with the
   * ratchet the session's own selection event reported, so a named wheel is
   * proof the selection reached the drawing. This check reads both, because
   * there is one session and both devices are in it: a page naming one wheel
   * and not the other draws two devices on different ratchets, which is not a
   * state the protocol has.
   */
  const NAMED = /^(?:double|triple) ratchet$/;
  for (const side of ['a', 'b']) {
    if (!NAMED.test(scene[side].label)) {
      throw new Red(
        `device ${side}'s wheel is captioned "${scene[side].label || '(nothing)'}" after a ` +
          'session was agreed — it should carry the ratchet the selection event reported, ' +
          'and an unnamed caption means the selection never reached the scene',
      );
    }
  }
  if (scene.a.label !== scene.b.label) {
    throw new Red(
      `the two devices are captioned with different ratchets — ${scene.a.label} and ` +
        `${scene.b.label} — but they are in one session, which selected one`,
    );
  }

}

/*
 * Agreeing a key spends one of the peer's prekeys, and the shelf says so.
 *
 * This is the whole point of publishing a bundle a peer can collect without
 * asking: the first sentence is encrypted against material the recipient left
 * on the relay while it was offline, and that material is taken. A shelf that
 * still reads its published figure after a session exists is drawing a relay
 * that hands out copies — which is the one thing a prekey is not, since the
 * whole forward-secrecy argument rests on the one-time keys being one-time.
 *
 * Held between two frames rather than at the end. A shelf frozen at its
 * published count and a shelf that has decremented look identical in a reading
 * taken once, and the difference is the entire claim: what makes 202 the right
 * figure is that the same shelf said 204 before the peer collected.
 *
 * Both directions are checked, and the second is the one that catches a shelf
 * redrawn from the wrong place. Only the device that was *spoken to* pays: the
 * initiator collected a bundle and published nothing new, so a run where both
 * shelves fall is a scene subtracting from a pooled figure, and one where the
 * initiator's falls instead is a scene that has the two accounts crossed.
 *
 * Then the figure is read a second time out of the settled page, by a path that
 * shares nothing with the watcher — the end-of-run DOM snapshot rather than the
 * live observer. A decrement drawn for one frame and quietly restored afterwards
 * would satisfy the frames above and leave the reader looking at the published
 * count.
 */
function checkPrekeySpend(pass) {
  const seen = pass.shelves;
  if (!Array.isArray(seen) || seen.length === 0) {
    throw new Red(
      `the reel published two bundles and the scene never drew a prekey shelf — the watcher was ` +
        `installed before the start control was pressed and recorded nothing.\n` +
        `  what was recorded: ${JSON.stringify(seen)}`,
    );
  }

  const establishedAt = seen.findIndex((entry) => entry.step === ESTABLISH_STEP);
  if (establishedAt === -1) {
    throw new Red(
      `the two devices exchanged a sentence and the scene never drew "${ESTABLISH_STEP}", so ` +
        `there is no frame on which a bundle is collected.\n` +
        `  the steps the shelves were drawn on: ${[...new Set(seen.map((e) => e.step))].join(', ')}`,
    );
  }

  const before = seen
    .slice(0, establishedAt)
    .filter((entry) => entry.step === PUBLISH_STEP)
    .at(-1);
  if (!before) {
    throw new Red(
      `the scene drew "${ESTABLISH_STEP}" without ever drawing "${PUBLISH_STEP}" first, so the ` +
        `shelf figures at the key agreement have nothing to be held against — a session cannot ` +
        `be made from a bundle that was never published.\n` +
        `  what was recorded: ${JSON.stringify(seen)}`,
    );
  }

  const established = seen.filter((entry) => entry.step === ESTABLISH_STEP);
  const settled = established[0];
  for (const entry of established) {
    if (entry.a !== settled.a || entry.b !== settled.b) {
      throw new Red(
        `the shelves were drawn at two different pairs of figures on one "${ESTABLISH_STEP}" ` +
          `frame — ${JSON.stringify([settled.a, settled.b])} and ` +
          `${JSON.stringify([entry.a, entry.b])}. One frame is one state of the relay; a shelf ` +
          `moving inside it is drawing a count from something other than the cue.`,
      );
    }
  }

  for (const [label, entry] of [
    ['publish', before],
    ['key agreement', settled],
  ]) {
    for (const side of [INITIATOR, RESPONDER]) {
      if (typeof entry[side] !== 'number') {
        throw new Red(
          `on the ${label} frame the relay's prekey shelf for device ${side.toUpperCase()} printed ` +
            `${JSON.stringify(side === INITIATOR ? entry.saidA : entry.saidB)}, which says no ` +
            `number of keys`,
        );
      }
    }
  }

  if (settled[RESPONDER] >= before[RESPONDER]) {
    throw new Red(
      `device ${RESPONDER.toUpperCase()} published ${before[RESPONDER]} prekeys and its shelf ` +
        `still reads ${settled[RESPONDER]} once the other device has agreed a key with it. ` +
        `Establishing a session collects a bundle and the relay does not hand out a second copy ` +
        `of a one-time key, so the shelf has to have fallen — a shelf holding its published ` +
        `figure is drawing prekeys as if they were reusable.\n` +
        `  ${PUBLISH_STEP}:   a ${before[INITIATOR]}, b ${before[RESPONDER]}\n` +
        `  ${ESTABLISH_STEP}: a ${settled[INITIATOR]}, b ${settled[RESPONDER]}`,
    );
  }

  if (settled[RESPONDER] <= 0) {
    throw new Red(
      `device ${RESPONDER.toUpperCase()}'s shelf fell from ${before[RESPONDER]} to ` +
        `${settled[RESPONDER]} on one key agreement — one session takes one bundle, so a shelf ` +
        `emptied by it is being cleared rather than decremented`,
    );
  }

  if (settled[INITIATOR] !== before[INITIATOR]) {
    throw new Red(
      `device ${INITIATOR.toUpperCase()} started the conversation and its own shelf moved from ` +
        `${before[INITIATOR]} to ${settled[INITIATOR]}. The device that speaks first spends the ` +
        `*other* account's bundle; nobody has collected its own, so a shelf falling on both sides ` +
        `is one figure being subtracted from a pooled total rather than from an account.\n` +
        `  ${PUBLISH_STEP}:   a ${before[INITIATOR]}, b ${before[RESPONDER]}\n` +
        `  ${ESTABLISH_STEP}: a ${settled[INITIATOR]}, b ${settled[RESPONDER]}`,
    );
  }

  const drawn = pass.dom.scene?.slots?.bundles?.[RESPONDER];
  if (drawn && drawn.count !== settled[RESPONDER]) {
    throw new Red(
      `the shelf for ${pass.names[RESPONDER]} read ${settled[RESPONDER]} on the key agreement and ` +
        `reads ${JSON.stringify(drawn.said)} at the end of the reel. The bundle stays collected, ` +
        `so a count that came back is a decrement drawn for one frame and taken away again.`,
    );
  }

  return { side: RESPONDER, before: before[RESPONDER], after: settled[RESPONDER] };
}

/*
 * The relay keeps an account per device, and the drawing says whose is whose.
 *
 * A relay with one prekey pile and one mailbox draws a service that holds
 * material without holding it for anyone, which is the opposite of what the
 * page is teaching: the whole reason a relay can be untrusted is that what it
 * keeps is addressed. So the rack has a slot per device per shelf, and this
 * asks the drawing four questions about them.
 *
 * The labels are held against the names the console gave the two devices, which
 * is the same pair the device columns are titled from. A slot labelled from the
 * markup would pass a check against a fixed string and would go on passing
 * after the names changed; a slot labelled with the *other* device's name is
 * the failure this exists for, and it is only visible against the names.
 *
 * The counts are held against what each device says it holds, less whatever the
 * relay handed out while the reel ran. The public halves on the shelf are the
 * halves of the private keys in that device's column, and the only thing that
 * separates the two figures is a peer collecting a bundle — which the reel draws
 * and `checkPrekeySpend` has already read off it. So the three numbers close,
 * and the ways a per-device shelf goes wrong all show here: a shelf drawn from a
 * pooled total reads too high, a pair of shelves fed the same figure agrees with
 * one device and not the other, a shelf that never got a count reads nothing,
 * and a shelf that decremented by something other than what was collected reads
 * as a figure arrived at by arithmetic rather than from the relay.
 *
 * Read at the end of the reel, where the counts are settled and no row is
 * outstanding. The mailboxes are checked here for being empty, which is the
 * state a relay is in once the far device has collected: a mailbox still lit
 * after the sentence was opened would be drawing a message that is both
 * delivered and waiting.
 */
function checkRelayShelves(pass, spend) {
  const scene = pass.dom.scene;
  const slots = scene?.slots;
  if (!slots) {
    throw new Red(
      `the scene carries no relay shelves at all — nothing on the page matched ` +
        `${SCENE_SLOT('bundles', 'a')}, so the relay is not drawing an account per device`,
    );
  }

  for (const kind of SLOT_KINDS) {
    for (const side of ['a', 'b']) {
      const slot = slots[kind]?.[side];
      if (!slot) {
        throw new Red(
          `the relay has no ${kind} slot for device ${side}: nothing matched ` +
            `${SCENE_SLOT(kind, side)} together with its body. A shelf the reader can see and ` +
            `this cannot find is a shelf drawn without saying whose it is.`,
        );
      }
      const named = pass.names[side];
      if (!named) {
        throw new Red(
          `the console never named device ${side}, so the label on its ${kind} slot ` +
            `(${JSON.stringify(slot.label)}) has nothing to be held against`,
        );
      }
      if (slot.label !== named) {
        throw new Red(
          `the relay's ${kind} slot for device ${side} is labelled ${JSON.stringify(slot.label)} ` +
            `and that device is called ${JSON.stringify(named)}. The labels are stamped from the ` +
            `session the run booted, so a slot wearing another name — or none — is a shelf ` +
            `pointing at the wrong account.`,
        );
      }
    }
  }

  /* The store's own figure, read through its own grammar: a settled store says
     the plain amount, and one that has spent a key since it filled says `so far
     / total`. The first number is what the device is holding now and the second
     is the batch it made, and both are needed — the shelf is held against the
     first, and the drop from the second is what the key agreement took. */
  const held = (side) => {
    const printed = scene.deviceKeys?.[side] ?? '';
    const counts = keygenCounts(printed);
    if (!counts) {
      throw new Red(
        `device ${side} prints ${JSON.stringify(printed || '(nothing)')} where its key count ` +
          `goes, so the relay's shelf for it has no figure to be held against`,
      );
    }
    return counts;
  };

  const said = () =>
    `  ${pass.names.a}: shelf ${slots.bundles.a.count}, device ${scene.deviceKeys.a}\n` +
    `  ${pass.names.b}: shelf ${slots.bundles.b.count}, device ${scene.deviceKeys.b}\n` +
    `  collected on ${ESTABLISH_STEP}: ${spend.before - spend.after} from device ` +
    `${spend.side.toUpperCase()}`;

  for (const side of ['a', 'b']) {
    const slot = slots.bundles[side];
    const own = held(side);
    if (own.count <= 0) {
      throw new Red(
        `device ${side} finished a round trip holding ${own.count} keys — a device that published ` +
          `a bundle holds the private halves of it`,
      );
    }
    if (slot.count === null) {
      throw new Red(
        `the relay's prekey slot for ${pass.names[side]} prints no count after that device ` +
          `published: it reads ${JSON.stringify(slot.said)}. The count is written from the ` +
          `publish the recording carries, so a slot without one never received it.`,
      );
    }
    /* One store drawn twice. The shelf is the public halves of the keys that
       device is holding, so the two figures move together — a shelf showing
       the pair's total, or the other device's figure, or one left behind by a
       spend the device recorded, is what a disagreement here reads like. */
    if (slot.count !== own.count) {
      throw new Red(
        `the relay says it holds ${slot.count} prekeys for ${pass.names[side]} and that device ` +
          `says it holds ${own.count}. A shelf is the public halves of the keys that device is ` +
          `holding, so the two cannot disagree.\n` +
          said(),
      );
    }
    /* And what left the store is what the reel drew leaving it. The device
       that answered the key agreement consumed one prekey of each kind doing
       it; the other one answered nothing and is still holding its whole
       batch. */
    const collected = side === spend.side ? spend.before - spend.after : 0;
    if (own.total - own.count !== collected) {
      throw new Red(
        `${pass.names[side]} made ${own.total} keypairs and is holding ${own.count}, so ` +
          `${own.total - own.count} left that store — and the reel drew ${collected} collected ` +
          `from it. A key leaves this store when the peer's key agreement takes it, so a drop ` +
          `nobody was drawn collecting is a store spending keys off screen.\n` +
          said(),
      );
    }
  }

  for (const side of ['a', 'b']) {
    const slot = slots.mailbox[side];
    if (slot.holding === 'true') {
      throw new Red(
        `the far device opened the sentence and ${pass.names[side]}'s mailbox is still shown as ` +
          `holding a row (${JSON.stringify(slot.said)}) — a message cannot be both delivered ` +
          `and waiting`,
      );
    }
  }
}

/*
 * The devices are shown making their keys, and shown making them a batch at a
 * time.
 *
 * The opening of the run is nearly all key generation — hundreds of keypairs
 * per device, and by far the longest thing the SDK does here — and a scene that
 * skipped it would jump from nothing to two ready devices with the expensive
 * part hidden. So this checks the bar was drawn part-way as well as full: a
 * page that only ever painted a finished bar would satisfy any check written
 * about the end state, and would be showing an outcome rather than the work.
 *
 * Every figure is held against the row's own numbers rather than against a
 * count typed here. How many keypairs a device makes is the SDK's business and
 * changes with its configuration; that the bar's length is that device's count
 * over that device's total is the claim the drawing makes, and it is checkable
 * without knowing either number in advance.
 *
 * Then the finished row is measured on the page, once nothing is moving. The
 * width the script set and the width the reader sees are two different facts —
 * a bar told to fill a track that collapsed to nothing is at 100% and is
 * invisible — and the second cannot be read while a transition is running.
 */
function checkKeyGeneration(pass) {
  const seen = pass.keygen;
  if (!Array.isArray(seen) || seen.length === 0) {
    throw new Red(
      `the run booted two devices and the scene never drew "${KEYGEN_STEP}" — the watcher was ` +
        `installed before the start control was pressed and recorded nothing, so the reel is ` +
        `not showing the keys being made.\n  what was recorded: ${JSON.stringify(seen)}`,
    );
  }

  for (const side of ['a', 'b']) {
    const drawn = seen.filter((entry) => entry.side === side);
    if (drawn.length === 0) {
      throw new Red(
        `device ${side.toUpperCase()} never drew its key generation. Both devices make their own ` +
          `keys, and a scene that showed one of them doing it draws the other as ready without ` +
          `having done the work.\n  what was recorded: ${JSON.stringify(seen)}`,
      );
    }

    const read = drawn.map((entry) => {
      const counts = keygenCounts(entry.figure);
      if (!counts) {
        throw new Red(
          `device ${side.toUpperCase()}'s generation row printed ${JSON.stringify(entry.figure)}, ` +
            `which does not say how many keypairs of how many were made`,
        );
      }
      return { ...entry, ...counts };
    });

    for (const entry of read) {
      if (entry.count > entry.total || entry.total === 0) {
        throw new Red(
          `device ${side.toUpperCase()}'s generation row printed ${JSON.stringify(entry.figure)}, ` +
            `which is not a count of a total`,
        );
      }
      /* The length is the count, and this is where that stops being a claim.
         A bar driven by a clock rather than by the recording would keep this
         row's text and lose exactly this. */
      const told = Number.parseFloat(entry.told);
      const want = (entry.count / entry.total) * 100;
      if (!Number.isFinite(told) || Math.abs(told - want) > 0.5) {
        throw new Red(
          `device ${side.toUpperCase()}'s generation bar was drawn at ` +
            `${JSON.stringify(entry.told)} while the figure beside it read ` +
            `${JSON.stringify(entry.figure)}, which is ${want.toFixed(1)}%. The bar and the ` +
            `number are two drawings of one pair of counts and cannot disagree.`,
        );
      }
      if (entry.track <= 0) {
        throw new Red(
          `device ${side.toUpperCase()}'s generation bar was drawn inside a track of no width, so ` +
            `the row is on the page and not on the screen`,
        );
      }
    }

    /* Part-way, and then finished. Either alone is satisfied by a page that
       never animates: one frame at 50% is a stuck bar, and one frame at 100%
       is a result. */
    if (!read.some((entry) => entry.count < entry.total)) {
      throw new Red(
        `device ${side.toUpperCase()}'s generation bar was only ever drawn full: ` +
          `${JSON.stringify(read.map((entry) => entry.figure))}. The reel is showing the outcome ` +
          `of generation rather than generation happening.`,
      );
    }
    if (!read.some((entry) => entry.count === entry.total)) {
      throw new Red(
        `device ${side.toUpperCase()}'s generation bar never reached its own total: ` +
          `${JSON.stringify(read.map((entry) => entry.figure))}`,
      );
    }
  }

  /* And what it came to rest at, measured on the page after it went quiet. */
  for (const side of ['a', 'b']) {
    const row = pass.dom.scene?.keygen?.[side];
    if (!row || row.hidden) {
      throw new Red(
        `device ${side.toUpperCase()}'s generation row was drawn during the run and is not on the ` +
          `page at the end of it: ${JSON.stringify(row)}`,
      );
    }
    /* The row is the device's own store and the store is spent from: the
       device that answered the key agreement consumed a one-time prekey of
       each kind doing it, so the figure at rest is the batch it made less what
       the session took. What cannot happen is a count over the batch, or a
       store that emptied. Reaching the total is asserted where it is true —
       above, off the generation the watcher recorded. */
    const settled = keygenCounts(row.figure);
    if (!settled || settled.count <= 0 || settled.count > settled.total) {
      throw new Red(
        `device ${side.toUpperCase()}'s generation row finished the run reading ` +
          `${JSON.stringify(row.figure)}, which is not an amount of the batch that device made`,
      );
    }
    /* And the bar draws that amount. Told as a percentage of a track, so a
       length that never reached the page is a full-looking figure over a bar
       that is not there. */
    const want = (settled.count / settled.total) * (row.inner ?? 0);
    if (!row.bar || !row.inner || Math.abs(row.bar.width - want) > 0.5) {
      throw new Red(
        `device ${side.toUpperCase()}'s generation row reads ${JSON.stringify(row.figure)} and its ` +
          `bar is ${row.bar?.width} wide inside a track ${row.inner} across, where that figure is ` +
          `${want.toFixed(1)}. The bar is told its length as a percentage of the figure beside ` +
          `it, so the two cannot disagree.`,
      );
    }
  }
}

/*
 * The lengths the generation rows were seen at, for the summary.
 *
 * The first part-way figure and the last are the two the check turns on: a page
 * that only ever drew a finished bar cannot produce the first, and one that
 * stopped short cannot produce the second. Printing them means the PASS line
 * carries the observation rather than the assertion's own wording.
 */
function generationSaid(pass, names) {
  return ['a', 'b']
    .map((side) => {
      const drawn = pass.keygen.filter((entry) => entry.side === side);
      const figures = drawn.map((entry) => entry.figure);
      const partway = figures.find((figure) => {
        const counts = keygenCounts(figure);
        return counts && counts.count !== counts.total;
      });
      return (
        `${names[side]} drew "${partway}" then "${figures[figures.length - 1]}" ` +
        `over ${drawn.length} length(s)`
      );
    })
    .join(', ');
}

/*
 * The stored row waits in the mailbox it is addressed to.
 *
 * The step the relay takes a row on is the middle of the reel and is gone by
 * the time the run finishes, so this reads what the watcher recorded as it
 * happened rather than asking the page afterwards.
 *
 * Which mailbox is right is decided by the envelope rather than by this file.
 * The envelope prints who it is for, the slots print whose they are, and the
 * claim is that those two agree — a harness that knew the probe was typed into
 * the first device would pass a drawing that put every row in the same mailbox
 * whichever way the message went.
 *
 * Both mailboxes are read. A relay that lit them both would satisfy any check
 * written about the right one alone, and would be drawing one message waiting
 * for two people.
 *
 * Then where the envelope came to rest, because the lighting and the drawing
 * are separate: the slot's state is an attribute the drawing writes and the
 * envelope's position is a transform it computes from measured rectangles, and
 * either can be right while the other is wrong. The envelope's centre has to be
 * inside the mailbox it is addressed to.
 */
function checkStoredMailbox(pass) {
  const seen = pass.stored;
  if (!seen?.at) {
    throw new Red(
      `the run put a sentence through the relay and the scene never showed "${STORED_STEP}" — ` +
        `the watcher was installed before the sentence was typed and recorded nothing, so the ` +
        `reel never drew the relay taking the row`,
    );
  }
  const { at } = seen;
  const addressed = at.addressed;
  const mailbox = at.mailboxes;
  if (!mailbox?.a || !mailbox?.b) {
    throw new Red(
      `the relay had no mailbox per device at "${STORED_STEP}": ` +
        `${JSON.stringify(mailbox)}. A row is stored for someone, and a rack with one mailbox ` +
        `cannot say who.`,
    );
  }
  const owner = ['a', 'b'].find((side) => mailbox[side].label === addressed);
  if (!addressed || !owner) {
    throw new Red(
      `the envelope the relay stored says it is addressed to ` +
        `${JSON.stringify(addressed || '(nothing)')} and neither mailbox is labelled that: ` +
        `${JSON.stringify(mailbox.a.label)} and ${JSON.stringify(mailbox.b.label)}. The address ` +
        `and the labels are written from the same session, so they cannot name different devices.`,
    );
  }
  const other = owner === 'a' ? 'b' : 'a';
  if (mailbox[owner].holding !== 'true') {
    throw new Red(
      `the relay took a row addressed to ${addressed} and did not light that device's mailbox: ` +
        `${addressed}'s reads ${JSON.stringify(mailbox[owner].holding)} and ` +
        `${mailbox[other].label}'s reads ${JSON.stringify(mailbox[other].holding)}`,
    );
  }
  if (mailbox[other].holding === 'true') {
    throw new Red(
      `the relay took one row addressed to ${addressed} and lit both mailboxes, so the drawing ` +
        `shows one message waiting for two devices`,
    );
  }

  const rest = seen.rest;
  if (!rest?.envelope) {
    throw new Red(
      `the relay took the row and the envelope was never measured at rest on it. The reading is ` +
        `taken when the envelope stops moving, or failing that when the reel leaves ` +
        `"${STORED_STEP}", and neither happened — so where the page put the stored envelope is ` +
        `unknown.\n  what was recorded: ${JSON.stringify(rest)}`,
    );
  }
  const target = rest.mailboxes?.[owner]?.box;
  if (!target) {
    throw new Red(
      `${addressed}'s mailbox could not be measured while the envelope rested on it, so the two ` +
        `cannot be compared`,
    );
  }
  const centre = {
    x: rest.envelope.left + rest.envelope.width / 2,
    y: rest.envelope.top + rest.envelope.height / 2,
  };
  const inside =
    centre.x >= target.left &&
    centre.x <= target.left + target.width &&
    centre.y >= target.top &&
    centre.y <= target.top + target.height;
  if (!inside) {
    throw new Red(
      `the stored envelope came to rest away from the mailbox it is addressed to. It is for ` +
        `${addressed}, and its centre is at (${centre.x.toFixed(1)}, ${centre.y.toFixed(1)}) ` +
        `while that mailbox occupies ${target.left.toFixed(1)}–` +
        `${(target.left + target.width).toFixed(1)} across and ${target.top.toFixed(1)}–` +
        `${(target.top + target.height).toFixed(1)} down.\n` +
        `  measured ${rest.via}\n` +
        `  the other mailbox (${rest.mailboxes?.[other]?.label}) is at ` +
        `${JSON.stringify(rest.mailboxes?.[other]?.box)}`,
    );
  }
}

/*
 * What a second sentence has to move.
 *
 * One frame cannot tell a drawing that follows the session from a drawing that
 * was written once and left there, and the wheel is the thing on the page whose
 * whole claim is per-message. So the run sends twice and reads it both times.
 */
function checkSceneMoves(first, second) {
  /*
   * The wheel, counted where it is drawn.
   *
   * One key per message is the whole claim the wheel makes, and the only way to
   * see it is two messages: a wheel frozen on one position and a wheel that
   * jumps a whole turn at once both look correct in a single frame.
   */
  const keys = (pass, side) => {
    const printed = pass.scene?.[side]?.keys ?? '';
    const [, digits] = /^(\d+) message keys? derived$/.exec(printed) ?? [];
    if (digits === undefined) {
      throw new Red(
        `device ${side} printed "${printed || '(nothing)'}" where its key count goes — the ` +
          'wheel says "N message key derived" or "N message keys derived", and anything else ' +
          'is a count this run cannot read',
      );
    }
    return Number(digits);
  };

  for (const side of ['a', 'b']) {
    const before = keys(first, side);
    const after = keys(second, side);
    if (after <= before) {
      throw new Red(
        `device ${side} was in a conversation that sent a second message and its ratchet did ` +
          `not turn — ${before} key(s) after the first, ${after} after the second`,
      );
    }
  }

  /*
   * And the drawing followed the total rather than being written beside it. The
   * count is text the module prints and the turn is a transform it applies; a
   * wheel that advanced one and not the other is the failure a reader would see
   * and no total-only check would.
   *
   * One turn per key, and never a turn back: the ratchet is one-way, so the two
   * numbers are the same number and the equality is the whole property. A wheel
   * that wrapped, or that reset on a long conversation, would draw a key nobody
   * derived and would fail here rather than being modelled around.
   */
  for (const side of ['a', 'b']) {
    const turns = second.scene?.[side]?.turns;
    const taken = keys(second, side);
    if (turns !== taken) {
      throw new Red(
        `device ${side} says it has taken ${taken} key(s) and its wheel is ` +
          `${turns === null ? 'not turned at all' : `${turns} turn(s) along`} — the ratchet is ` +
          'one-way, so the drawing and the count are the same number',
      );
    }
  }

}

function checkFallback(pass) {
  if (pass.dom.decrypted || pass.dom.sent.length) {
    throw new Red(
      `every chunk the demo asked for was blocked and a conversation filled anyway:\n` +
        `  ${pass.names.a}: ${pass.dom.sent.join(' / ') || '(nothing)'}\n` +
        `  ${pass.names.b}: ${pass.dom.decrypted || '(nothing)'}`,
    );
  }
  if (pass.dom.holdingRow || !pass.dom.holdingNothing) {
    throw new Red(
      'every chunk the demo asked for was blocked and the relay column is showing a stored row',
    );
  }
  /* The load-failure state has two halves and both are checked: a line saying
     what failed, and the recorded capture back on the page. Either alone is a
     worse page than the pair — a silent failure leaves a reader pressing a
     button that has stopped working, and a page that only apologises has
     nothing left on it showing what a relay holds. */
  if (!pass.dom.recorded) {
    throw new Red(
      'every chunk the demo asked for was blocked and the recorded capture is not on the page, ' +
        'so a reader whose demo cannot run is left with no evidence at all',
    );
  }
  if (!/did not finish/.test(pass.dom.status)) {
    throw new Red(
      `the demo could not load and the page had nothing to say about it — its status line ` +
        `reads ${JSON.stringify(pass.dom.status)}`,
    );
  }

  /* The scene makes the same claim in pictures, and it ships in the build —
     the devices, the relay and the wheels are already in the HTML when the
     chunk that would have driven them fails to arrive. Showing any step of a
     run that never started is the one way this page could still lie after the
     failure was reported. */
  if (pass.dom.scene && pass.dom.scene.state !== 'idle') {
    throw new Red(
      `the demo could not load and the scene is showing "${pass.dom.scene.state}" — a ` +
        `protocol step that did not happen`,
    );
  }
  /* Nothing ran, so nothing may be reported as having run. A demo_run recorded
     off a page that fell back to the recording would make the D5 measurement
     count readers who saw no demo at all. */
  const beacons = beaconsIn(pass.requests);
  if (beacons.length) {
    throw new Red(
      `the chunk never arrived and the page measured ${beacons.length} event(s) anyway:\n  ` +
        beacons.map((beacon) => JSON.stringify(beacon.postData)).join('\n  '),
    );
  }
  if (pass.pageErrors.length) {
    throw new Red(
      `a blocked chunk should be handled, not thrown:\n  ${pass.pageErrors.join('\n  ')}`,
    );
  }
}

/*
 * The braid changes the size of the message, and the drawing says so in
 * figures while the transit stays one size.
 *
 * Two runs of the same page, differing in one switch. Braid off sends the
 * ML-KEM key whole in the message that agrees the session and braid on sends it
 * a chunk at a time, so the envelope the relay stores is larger in the first
 * run than in the second by about a key. The scene states that difference as a
 * byte figure on the envelope, and draws the envelope itself at one size
 * whatever it carries — a wire that widened with the payload would teach that a
 * bigger message is a bigger journey, and the journey is the same journey.
 *
 * So both halves are read, and they are read as opposites. The figure has to
 * move by the factor the setting moves the envelope by; the boxes have to stay
 * where they are. A drawing that scaled with the payload would pass the first
 * and fail the second, which is the point: this is the check that would catch
 * the constant-size transit being quietly given up.
 *
 * Which boxes is not this harness's business. Every box in the column is
 * measured in both runs and paired by where it sits, so the drawing may be
 * rebuilt, remarked or moved within the column and the reading still describes
 * it.
 */
function checkBraidDrawing(disabled, required) {
  const measured = (pass, setting) => {
    if (!pass.geometry) {
      throw new Red(
        `braid drawing — the run under braid ${setting} has no relay column on the page to ` +
          `measure (${RELAY_COLUMN}), so what the setting does to the drawing cannot be asked`,
      );
    }
    const printed = pass.stored?.at?.size ?? '';
    const size = STORED_SIZE.exec(printed);
    if (!size) {
      throw new Red(
        `braid drawing — the run under braid ${setting} put a message through the relay and the ` +
          `envelope was drawn reading ${JSON.stringify(printed || '(nothing)')}, which is not a ` +
          `size. The setting is a claim about how big a message is, so a run that never states ` +
          `one says nothing about it.`,
      );
    }
    return {
      ...pass.geometry,
      note: printed,
      bytes: Number(size[1]) * { B: 1, KB: 1024, MB: 1024 * 1024 }[size[2]],
    };
  };
  const whole = measured(disabled, 'off');
  const chunked = measured(required, 'on');

  const held =
    `  the message the relay held, braid off: ${JSON.stringify(whole.note)}\n` +
    `  the message the relay held, braid on:  ${JSON.stringify(chunked.note)}`;

  /* The setting did what the setting does. Read before the drawing, because a
     run where the two envelopes came out the same size has nothing to say
     about a drawing of either. */
  const factor = whole.bytes / chunked.bytes;
  if (!Number.isFinite(factor) || factor < BRAID_SIZE_FACTOR) {
    throw new Red(
      `braid drawing — the braid setting did not change the size of the message. The ML-KEM ` +
        `material rides whole in the first message with the braid off and a chunk at a time ` +
        `with the braid on, so the first envelope is the larger by about the size of that ` +
        `material; these two are ${factor.toFixed(2)}× apart, under the ${BRAID_SIZE_FACTOR}× ` +
        `floor.\n` +
        held,
    );
  }

  /* Paired by position in the column rather than by anything either run's
     markup says about itself. A box drawn in only one of the two runs has no
     pair and is passed over: the claim is about a box that is the same size
     under both settings, and a box that exists under one setting alone cannot
     be compared to itself. */
  const facing = new Map(chunked.drawn.map((box) => [box.path, box]));
  const pairs = [];
  for (const box of whole.drawn) {
    const other = facing.get(box.path);
    if (!other || other.tag !== box.tag) continue;
    if (box.width < BRAID_MIN_WIDTH_PX || other.width < BRAID_MIN_WIDTH_PX) continue;
    pairs.push({
      path: box.path,
      tag: box.tag,
      classes: box.classes,
      whole: box.width,
      chunked: other.width,
      ratio: Math.max(box.width / other.width, other.width / box.width),
    });
  }
  pairs.sort((first, second) => second.ratio - first.ratio);

  if (pairs.length === 0) {
    throw new Red(
      `braid drawing — nothing in the relay column could be measured across the two settings: ` +
        `${whole.drawn.length} box(es) drawn under braid off and ${chunked.drawn.length} under ` +
        `braid on, and no box sat in the same place in both with a width worth dividing.\n` +
        held,
    );
  }

  const widest = pairs[0];
  const describe = (pair) =>
    `    ${pair.ratio.toFixed(2)}×  ${pair.whole.toFixed(1)} px → ${pair.chunked.toFixed(1)} px  ` +
    `<${pair.tag}${pair.classes ? ` class="${pair.classes}"` : ''}> at ${pair.path || 'the column'}`;

  if (widest.ratio > BRAID_STEADY_RATIO) {
    throw new Red(
      `braid drawing — the relay column is drawn to the size of what it is holding. The same ` +
        `page ran under both braid settings, ${factor.toFixed(2)}× apart in envelope size, and a ` +
        `box in ${RELAY_COLUMN} changed by ${widest.ratio.toFixed(2)}× between them — over the ` +
        `${BRAID_STEADY_RATIO}× a reflow accounts for. The envelope rides the wire at one size ` +
        `whatever it carries, and the size it carries is stated in figures.\n` +
        held +
        `\n  the boxes that moved most, of ${pairs.length} measured in both runs:\n` +
        pairs.slice(0, 3).map(describe).join('\n'),
    );
  }

  return { widest, whole, chunked, pairs, factor };
}

/*
 * The braid says how much of the key each message carries, and the strip draws
 * it arriving.
 *
 * The column check above measures a drawing against the sizes the relay is
 * holding, and every number in it can be had from bytes the page measured
 * itself. These two cannot. Nothing in an envelope's length says how many chunks
 * of a key it is carrying or how many the whole key takes — only the braid knows
 * that, and it says so in the reports the page subscribes to. So this reads the
 * one figure on the page that no amount of measuring could have produced.
 *
 * The whole sequence rather than the last figure. A key arriving a chunk at a
 * time is a claim about many messages: a strip written once carries a figure
 * too, and the difference between the two is that the counts climbed. So the
 * check is that they climbed, message by message, each one short of the total
 * beside it. Reaching that total is not read here and is not driven for — see
 * `BRAID_MESSAGES` for what an epoch costs at the pace the console plays.
 *
 * The counts themselves are never pinned. How many chunks a key takes is the
 * braid's to choose and the SDK's to change; that the strip counts one against
 * the other is the drawing's claim, and it is checkable without knowing either
 * number in advance.
 */
function checkBraidProgress(pass) {
  const seen = pass.braidChunks;
  if (!Array.isArray(seen) || seen.length === 0) {
    throw new Red(
      `braid progress — ${BRAID_MESSAGES} alternating messages went through a braided session ` +
        `and the strip (${SCENE_BRAID_FIGURE}) was never drawn with a figure on it, so the page ` +
        `shows nothing about how much of the key has arrived.\n` +
        `  what was recorded: ${JSON.stringify(seen)}`,
    );
  }

  const read = seen.map((entry) => {
    const counted = BRAID_FIGURE.exec(entry.figure);
    if (!counted) {
      throw new Red(
        `braid progress — the strip was drawn reading ${JSON.stringify(entry.figure)}, which does ` +
          `not say how many chunks of the key this message carries of how many the key takes`,
      );
    }
    return { ...entry, carried: Number(counted[1]), required: Number(counted[2]) };
  });

  for (const entry of read) {
    if (entry.required === 0 || entry.carried > entry.required) {
      throw new Red(
        `braid progress — the strip was drawn reading ${JSON.stringify(entry.figure)}, which is ` +
          `not a count of a total`,
      );
    }
  }

  const figures = () => JSON.stringify(read.map((entry) => entry.figure));

  /* A figure for every message driven. One report rides every send, so a run
     that drew fewer strips than it sent sentences is a drawing that skipped a
     message — and the climb below would read as steady on a strip that was
     simply not redrawn. */
  if (read.length < BRAID_MESSAGES) {
    throw new Red(
      `braid progress — ${BRAID_MESSAGES} braided messages went through the session and the ` +
        `strip was drawn for ${read.length} of them: ${figures()}`,
    );
  }

  /* The counts climb. This is the whole reading: a strip written once and left
     alone carries a plausible figure too, and what separates a key arriving
     from a decoration is that the carried count is larger at the end of a
     conversation than it was at the start, having risen along the way. */
  const first = read[0];
  const last = read[read.length - 1];
  const fell = read.find((entry, index) => index > 0 && entry.carried < read[index - 1].carried);
  if (fell) {
    throw new Red(
      `braid progress — the carried count went backwards, at ${JSON.stringify(fell.figure)}: ` +
        `${figures()}. The chunks accumulate, so the count that reports them does not fall.`,
    );
  }
  if (last.carried <= first.carried) {
    throw new Red(
      `braid progress — the strip never moved off ${JSON.stringify(first.figure)} across ` +
        `${read.length} messages: ${figures()}. The chunks ride one per message, so a count that ` +
        `stands still is a figure written once rather than a key arriving.`,
    );
  }

  /* And every one of them short of the total. The pass drives a run of messages
     and not an epoch of them, so a strip that reported a whole key here is
     reporting one the conversation was far too short to have carried. */
  const arrived = read.find((entry) => entry.carried === entry.required);
  if (arrived) {
    throw new Red(
      `braid progress — the strip reached a whole key at ${JSON.stringify(arrived.figure)} after ` +
        `${read.length} messages: ${figures()}. A key takes an epoch of messages to carry, and ` +
        `this conversation is nowhere near one, so a total met here is a total that was not ` +
        `counted to.`,
    );
  }

  return {
    drawn: read.length,
    first: first.figure,
    last: last.figure,
    climbed: last.carried - first.carried,
    required: last.required,
  };
}

// --------------------------------------------------------------------- the run

async function main() {
  if (!existsSync(DIST)) {
    throw new Infra(`no dist/ to serve. Run \`npm run build\` first.`);
  }
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Infra(`dist/ has no index.html. Run \`npm run build\` first.`);
  }

  const surface = await readSdkSurface();
  const envelopeFields = surface?.members.get('Envelope');
  if (!envelopeFields) {
    throw new Infra(
      'could not read an Envelope interface out of the installed SDK, so the metadata pane ' +
        'has nothing to be checked against',
    );
  }

  const expected = await expectedAddressing(envelopeFields);

  const held = { server: null, chrome: null, cdp: null, targets: [] };
  try {
    const { server, origin } = await serve(DIST, productionHeaders());
    held.server = server;
    const chrome = await launchChrome('demo-smoke-');
    held.chrome = chrome;

    const { webSocketDebuggerUrl } = await fetch(
      `http://127.0.0.1:${chrome.port}/json/version`,
    ).then((response) => response.json());
    const cdp = await Cdp.connect(webSocketDebuggerUrl);
    held.cdp = cdp;

    const live = await visit(cdp, origin, held, { repeat: true });
    const { spend } = checkRoundTrip(live, origin, envelopeFields, expected);

    /* Block every chunk the interaction asked for, so the dynamic import cannot
       resolve however Vite chose to split it. Taking only the first request
       would depend on whether a preload or the chunk itself won the race. */
    const starved = await visit(cdp, origin, held, {
      blocked: live.after.map((script) => script.url),
    });
    checkFallback(starved);

    /*
     * The same page again under each braid setting, one sentence per run.
     *
     * Two runs rather than one reading of the run above: the setting is chosen
     * before a session exists and is fixed for that session's life, so the only
     * way to see what it changes is to run the page twice. One sentence each,
     * so the two columns are drawing the same message of the conversation and
     * not the first against the second.
     *
     * Last of everything, so a failure here is about the drawing. Every other
     * claim this harness makes has already been made by the time these run.
     */
    const braidOff = await visit(cdp, origin, held, { braid: false });
    const braidOn = await visit(cdp, origin, held, { braid: true });
    const braid = checkBraidDrawing(braidOff, braidOn);

    /*
     * And a third run, long enough to watch the chunk counts climb.
     *
     * Its own run rather than more sentences on either of the two above. The
     * check before it measures those two against each other, and a run carrying
     * ten more messages would be drawing a different message of a different
     * length — so the pair it reads is left exactly as it was.
     *
     * This is the slowest pass here, because every sentence in it waits out the
     * reel that narrates the one before it.
     */
    const driveStartedAt = Date.now();
    const driven = await visit(cdp, origin, held, { braid: true, drive: true });
    const progress = checkBraidProgress(driven);
    const driveSeconds = ((Date.now() - driveStartedAt) / 1000).toFixed(1);

    /* Say which of the two things happened. Claiming a quiet window we never
       got would overstate the egress evidence on exactly the chatty pages
       where it is weakest. */
    const watched = live.wentQuiet
      ? `including a ${EGRESS_QUIET_MS} ms quiet window after it decrypted`
      : `the page was still making requests when the ` +
        `${EGRESS_SETTLE_MAX_MS / 1000} s settle cap expired`;

    const beacons = beaconsIn(live.requests);

    console.log(
      `demo smoke: PASS — round-tripped two typed sentences on the homepage under the shipped ` +
        `CSP, against ${surface.origin} @${surface.version}.\n` +
        `  egress:         ${live.requests.length} request(s) observed (${watched}), all on this ` +
        `origin, none carrying either sentence\n` +
        `  measured:       ${beacons.length} beacon(s) to ${BEACON_PATH} — ` +
        `${beacons.map((beacon) => JSON.stringify(beacon.postData)).join(', ') || 'none'}, ` +
        `one for two sentences\n` +
        `  addressing:     the sealed message the relay held was drawn for ` +
        `"${live.stored.at.addressed}" at ${live.stored.at.size}, the address an envelope built ` +
        `in this process carries\n` +
        /* Read off the scene rather than restated from the constants the checks
           compared against, so a line that prints is a line something observed. */
        `  the scene:      finished on "${live.dom.scene.state}", both wheels captioned ` +
        `"${live.dom.scene.a.label}", ${live.dom.scene.a.keys} and ${live.dom.scene.b.keys}, ` +
        `turned ${live.dom.scene.a.turns} and ${live.dom.scene.b.turns} time(s)\n` +
        `  generation:     ${generationSaid(live, live.names)} — each bar's length its own count\n` +
        `  the relay:      ${live.names.a} ${live.dom.scene.slots.bundles.a.count} and ` +
        `${live.names.b} ${live.dom.scene.slots.bundles.b.count} prekeys, each on that device's ` +
        `own shelf,\n` +
        `                  ${live.names[spend.side]}'s falling ${spend.before} → ${spend.after} ` +
        `on "${ESTABLISH_STEP}" as the other collected a bundle,\n` +
        `                  and the row it stored waited in ${live.stored.at.addressed}'s mailbox ` +
        `alone (measured ${live.stored.rest.via})\n` +
        `  the braid:      the relay held ${JSON.stringify(braid.whole.note)} with the switch ` +
        `off and ${JSON.stringify(braid.chunked.note)} with it on, ` +
        `${braid.factor.toFixed(1)}× apart,\n` +
        `                  and the column drew both at one size — the furthest of ` +
        `${braid.pairs.length} box(es) moved ${braid.widest.ratio.toFixed(2)}× ` +
        `(${braid.widest.whole.toFixed(1)} px against ${braid.widest.chunked.toFixed(1)} px)\n` +
        `  the chunks:     ${BRAID_MESSAGES} alternating messages through a braided session, and ` +
        `the strip climbed\n` +
        `                  from "${progress.first}" to "${progress.last}" over ` +
        `${progress.drawn} figure(s), ${progress.climbed} chunk(s)\n` +
        `                  of the ${progress.required} the key takes — counts no measurement of ` +
        `an envelope could produce (${driveSeconds} s)\n` +
        `  before a touch: ${kb(live.bytesBefore)} of script over ${live.before.length} file(s), ` +
        `under the ${kb(PRE_INTERACTION_CEILING)} tripwire (uncompressed — this server does ` +
        `not gzip)\n` +
        `  the touch drew: ${kb(live.bytesAfter)} over ${live.after.length} chunk(s)\n` +
        `  those blocked:  nothing ran, nothing was claimed, and the page said so ` +
        `("${starved.dom.status}")`,
    );
  } finally {
    await teardown(held);
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  if (error instanceof Red) {
    console.error(`demo smoke: FAIL — ${error.message}`);
    process.exit(1);
  }
  console.error(`demo smoke: INFRASTRUCTURE FAILURE — ${error.message}`);
  console.error('  This says nothing about the demo. Fix the harness or the environment.');
  process.exit(2);
}
