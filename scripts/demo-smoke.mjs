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
import { SCENARIOS } from '../src/lib/demo/scenarios/catalog.ts';
import { runFlipAByte } from '../src/lib/demo/scenarios/flip-a-byte.ts';
import { runAddASecondDevice } from '../src/lib/demo/scenarios/add-a-second-device.ts';
import { runOutOfPreKeys } from '../src/lib/demo/scenarios/run-out-of-prekeys.ts';
import { reinstallADevice } from '../src/lib/demo/scenarios/reinstall-a-device.ts';
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

const META = '[data-console-row]';
const CIPHER = '[data-console-hex]';
const RELAY_EMPTY = '[data-console-relay-empty]';
const RECORDED = '[data-console-recorded]';

/* The composer, and it belongs to a device rather than to the console: the
   reader types into the phone on the left, which is where a message comes from
   in the arrangement the page draws. */
const COMPOSE = (side) => `[data-scene-input="${side}"]`;
const COMPOSE_SEND = (side) => `[data-scene-send="${side}"]`;
const INPUT = COMPOSE('a');
const SEND = COMPOSE_SEND('a');

/* The near device's conversation, and the far one's. A round trip is proved by
   the sentence appearing in the device that did not type it — the claim the
   whole arrangement is built to make, and one that flattened page text cannot
   check, since the sentence is on the page from the moment it is typed. */
const SENT = '[data-scene-chat="a"]';
const DECRYPTED = '[data-scene-chat="b"]';

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
 * The braid's own row, and the two things it prints.
 *
 * The figure is the chunk counts the braid reported, and the mark is the braid
 * saying a device has produced its epoch key. Both are written from the report
 * the SDK raises and from nothing else, so neither can be drawn by a page that
 * is working from the sizes it measured — which is what makes them worth
 * reading here rather than reading the column's geometry again.
 *
 * Both ship hidden and are shown by `scene-view.ts` when a report arrives, so
 * their presence is a fact about a braid that ran.
 */
const SCENE_BRAID = '[data-scene-braid]';
const SCENE_BRAID_FIGURE = '[data-scene-braid-figure]';
const SCENE_BRAID_MARK = '[data-scene-braid-mark]';

/* What a device is called, in the scene's own words. Read beside the mark so
   the mark can be held against a name the page took from the session rather
   than against a string this file also knows. */
const SCENE_NAME = (side) => `[data-scene-name="${side}"]`;

/*
 * The relay's column, whole, rather than any element inside it.
 *
 * The check below asks whether *something* in this column is drawn to the size
 * of what the relay is holding, and deliberately does not say which element
 * that is or how it is marked. Naming one would be this harness dictating a
 * drawing rather than reading one, and the drawing is free to move as long as
 * the column still answers the question.
 */
const RELAY_COLUMN = '.demo-scene-relay';

/* What the relay says it is holding, in its own words. Reported beside the
   geometry so a reader can see the sizes the two runs put through the column;
   never asserted on, because a printed figure is exactly what a column can get
   right while drawing nothing. */
const RELAY_STORED = '[data-console-metric="relay-holding"]';

/* And what it says about the one row it is showing, which is the row the
   drawing beside it is drawing. Reported for the same reason and under the same
   rule as the total above: context, never the claim. */
const ROW_NOTE = '[data-console-row-note]';

/*
 * How much wider the drawing has to get, and how small an element may be and
 * still count.
 *
 * The envelopes differ by roughly nine times between the two settings, so a
 * width drawn to scale differs by roughly nine times too. Three is the floor
 * that separates that from everything else in the column that moves a little
 * when the text changes: a longer byte figure or an extra field name reflows a
 * box by a few percent, never by three times. Sub-pixel boxes are dropped
 * rather than divided — an element a fraction of a pixel wide in one run is
 * noise, and it would otherwise manufacture an enormous ratio out of nothing.
 */
const BRAID_WIDTH_FACTOR = 3;
const BRAID_MIN_WIDTH_PX = 2;

/*
 * The scenario section's contract, on the same terms. A scenario is addressed
 * by its slug rather than by position: a second scenario landing on the page
 * must not silently move what this drives.
 *
 * The slug is a parameter rather than a constant because the site now ships two
 * scenarios and will ship more. What is shared is everything that is true of
 * any scenario — it opens by fragment, it runs twice, it prints steps and
 * non-events and the SDK's log, it sends one beacon and no other request. What
 * is not shared is what the run should say, and that is derived per scenario by
 * running it in this process. A second scenario driven by a copy of this
 * function would be a second harness to keep honest.
 */
const FLIP_SLUG = 'flip-a-byte';
const SECOND_DEVICE_SLUG = 'add-a-second-device';
const PREKEY_SLUG = 'run-out-of-prekeys';
const REINSTALL_SLUG = 'reinstall-a-device';

const scenarioRoot = (slug) => `[data-scenario="${slug}"]`;
const SCENARIO_RUN = '[data-scenario-run]';
const SCENARIO_STATUS = '[data-scenario-status]';
const SCENARIO_OUTPUT = '[data-scenario-output]';
const SCENARIO_STEPS = '[data-scenario-steps]';
const SCENARIO_NOTS = '[data-scenario-nots]';
/* A second ordered list, for the scenario whose recovery is a separate
   argument from what happened. Kept apart from the steps rather than appended
   to them because "nothing told the application" and "here is the ceremony it
   takes to recover" are checked against different things, and a first-match
   scan over one merged list would report the wrong half. */
const SCENARIO_RECOVERY = '[data-scenario-recovery]';
const SCENARIO_LOG_LINE = '[data-scenario-log-line]';
const SCENARIO_DEVICE = '[data-scenario-device]';

/* The beacon a scenario is allowed to send, in full. Same reasoning as
   `DEMO_RUN_BODY`: the body is fixed before the browser starts, so a dimension
   derived from the run — a timing, a byte count, an error code — is a failure
   rather than something to be searched for.

   The path is `/` because the scenarios are a homepage section now, which makes
   this string identical in shape to `DEMO_RUN_BODY`. They still differ in the
   part that matters: the panel sends one beacon per page, and a scenario sends
   one per scenario with its slug attached. */
const scenarioBeaconBody = (slug) => `scenario_opened / ${slug}`;

/* The longest a scenario gets. The most expensive one boots three devices,
   runs a provisioning handshake and sends twice; it ran in well under a second
   where this was written, and the bound is for a machine under load rather than
   for the protocol. */
const SCENARIO_TIMEOUT_MS = 60000;

const NONCE = randomUUID().slice(0, 8);
const PROBE = `Smoke probe ${NONCE}: the staging key rotates at 09:00 UTC.`;
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
/* The sentence a whole epoch is driven with, numbered so a conversation of them
   can be read back. Short, because the epoch pass sends it many times and the
   sentence is not what that pass is about. */
const EPOCH_PROBE = (turn) => `Epoch probe ${NONCE} #${turn}`;

/*
 * How many messages one braid epoch takes, measured through the SDK.
 *
 * The braid carries the ML-KEM key one chunk per message and needs the whole
 * epoch's worth before either device can close it, so a conversation shorter
 * than this can end without a single key having been produced. Driving this
 * many is what makes the completion the pass reads certain to exist.
 *
 * The pass does not depend on the exact figure. It reads the braid's own report
 * of a completion, so an epoch that grows or shrinks upstairs changes how much
 * of this drive is spare and not whether the reading is true.
 */
const EPOCH_MESSAGES = 86;

/*
 * The longest the epoch pass gets to reach the mark.
 *
 * The drive runs at the devices' pace and the drawing runs at the reader's, so
 * the mark appears when the reel reaches the message that produced the key —
 * many dwells behind the send that produced it. Separate from `REEL_BUDGET_MS`
 * and much larger for that reason, and sized as a bound on a machine under load
 * rather than from the dwell table, for the reason `walk` gives.
 */
const EPOCH_BUDGET_MS = 240000;

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
 * interaction then pulls about 1790 KB, so the tripwire sits two orders of
 * magnitude below any build that has the SDK on its initial path.
 *
 * The homepage is the page this measures, because it is the only page with demo
 * code on it. Measured on 2026-08-11, on the one-scene console: 29.9 KB over
 * eight responses by this harness's own count. Three of the eight are the
 * demo's, at the sizes the build wrote to disk —
 *
 *   DemoConsole   8196 B  the curtain, the settings and the stored row
 *   DemoLog       5175 B  the event log under the scene
 *   ScenarioList  3672 B  the four scenarios
 *
 * — against the page furniture that has nothing to do with the demo:
 * `theme-init.js`, `measure.js`, the theme toggle, the hero's copy button, and
 * the shared runtime the bundler splits out, 7399 B between them. The two
 * instruments do not reconcile and are not meant to: the harness counts what the
 * browser fetched, the breakdown counts what the build emitted.
 *
 * The ceiling is 32 KB and moved there from 20 KB when `/demo` folded into this
 * page, which is worth writing down because "the budget went up when a page got
 * bigger" is the shape of a tripwire being quietly retired. What it has always
 * been calibrated against is the SDK's 713 KB, and 32 KB is as far below that as
 * 20 KB was. Nothing that runs before a touch is new: the two demo scripts are
 * wiring the site already shipped, on one page instead of two.
 *
 * One cost is small and worth naming. Each demo script carries its own
 * `__vite__mapDeps` array naming the SDK chunk graph, because Astro emits one
 * script per component and each dynamic `import()` needs the graph. It is not
 * worth undoing: merging the wiring into a single `<script>` would put one
 * component's handler on another component's DOM to save under a kilobyte on a
 * page that spends 1790.
 *
 * What a scenario costs is still about 0.4 KB: one entry in `ScenarioList`'s
 * `PROGRAMS` map, which is two dynamic `import()` specifiers and a status line.
 * Its prose, its runner and its renderer are all behind the press — the LD6
 * move that put the renderers in `src/lib/demo/render.ts` is what makes that
 * true.
 *
 * The headroom is 2.1 KB, which is about five more scenarios and is the tightest
 * this has been. That is worth reading before the next thing lands on this page:
 * the next component to ship a wiring script of its own will not fit, and the
 * answer then is to find the bytes rather than to raise the ceiling. What the
 * ceiling is calibrated against has never changed — see below.
 *
 * These are wire bytes without compression: `chrome-harness.mjs` serves the
 * build as it is on disk, while Cloudflare compresses. So this is not
 * invariant 7's budget, which is 10 KB gzip and is a *delta* — it needs a build
 * without the demo to compare against, and is measured in the proof rather than
 * here. This is the tripwire for the SDK arriving uninvited.
 *
 * The proof's table reports lower figures, and both are right. It sums the
 * files on disk; this counts what Chrome received, and `encodedDataLength` is
 * the whole response, headers included. Both see the same eight responses —
 * there is no fetch here that the static walk misses — so the gap is a flat
 * per-response cost, 686 bytes apiece from `chrome-harness.mjs`, and the
 * 23.9 KB on disk arrives as the 29.9 KB above. Anything that changes those
 * headers moves this number without a byte of script changing, which is one
 * more reason it is a tripwire and not a budget. The ceiling is set against
 * the figure measured here.
 */
const PRE_INTERACTION_CEILING = 32 * 1024;

/*
 * A floor on the expected set, not on what the page printed.
 *
 * The expectation itself is computed per run (see `expectedFields`), so this
 * number is only here to catch the expectation collapsing: an `Envelope` that
 * suddenly declares two fields would make an equality check trivially
 * satisfiable, and a harness that passes because it expected nothing is worse
 * than no harness. Ten is a floor, not the expectation: if the installed
 * `Envelope` ever declares fewer, this fails loudly rather than letting the
 * equality check pass on a shrunken set.
 */
const MIN_DERIVED_FIELDS = 10;

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
    cipher: text(${JSON.stringify(CIPHER)}),
    status: text(${JSON.stringify(STATUS)}),
    fields: [...root.querySelectorAll(${JSON.stringify(META)} + ' dt')].map((dt) => dt.textContent),
    values: [...root.querySelectorAll(${JSON.stringify(META)} + ' dd')].map((dd) => dd.textContent),
    /* The relay's two mutually exclusive states, both read: a page that showed
       neither would pass a check written against only one of them. */
    holdingNothing: visible(root.querySelector(${JSON.stringify(RELAY_EMPTY)})),
    holdingRow: visible(root.querySelector(${JSON.stringify(META)})),
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
      return {
        state: scene.dataset.sceneState ?? null,
        /* The step list the scene ships, so a check for the end state can say
           whether that state is even one the scene knows about. */
        steps: (scene.dataset.sceneSteps ?? '').split(/\\s+/).filter(Boolean),
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
    stored: document.querySelector(${JSON.stringify(RELAY_STORED)})?.textContent?.trim() ?? '',
    note: document.querySelector(${JSON.stringify(ROW_NOTE)})?.textContent?.trim() ?? '',
  };
})()`;

/*
 * Everything the page printed about the scenario it just ran.
 *
 * Read through the same data attributes the page renders, in one round trip.
 * The rendered text is what a reader sees, so it is what the checks read: a
 * harness that reached into a result object the page happened to expose would
 * pass on a page that computed the right answer and printed something else.
 */
const scenarioSnapshot = (slug) => `(() => {
  const scenario = document.querySelector(${JSON.stringify(scenarioRoot(slug))});
  const output = scenario?.querySelector(${JSON.stringify(SCENARIO_OUTPUT)});
  const flat = (node) => (node?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  const list = (selector) =>
    [...(output?.querySelectorAll(selector + ' li') ?? [])].map(flat);
  return {
    open: Boolean(scenario?.open),
    status: flat(scenario?.querySelector(${JSON.stringify(SCENARIO_STATUS)})),
    outputVisible: Boolean(output) && !output.hidden,
    text: flat(output),
    steps: list(${JSON.stringify(SCENARIO_STEPS)}),
    nots: list(${JSON.stringify(SCENARIO_NOTS)}),
    recovery: list(${JSON.stringify(SCENARIO_RECOVERY)}),
    /* One entry per device pane the scenario printed, each carrying what that
       device's own client decrypted. A scenario whose whole argument is that
       one device has a message and another does not cannot be checked from
       flattened page text: "is this sentence on the page" is true either way. */
    devices: [...(output?.querySelectorAll(${JSON.stringify(SCENARIO_DEVICE)}) ?? [])].map(
      (pane) => ({
        deviceId: pane.dataset.scenarioDevice,
        messages: [...pane.querySelectorAll('li')].map(flat),
      }),
    ),
    logLines: [...(output?.querySelectorAll(${JSON.stringify(SCENARIO_LOG_LINE)}) ?? [])].map(
      (row) => ({ level: row.dataset.scenarioLogLine, text: flat(row) }),
    ),
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
 */
async function type(cdp, sessionId, text, side = 'a') {
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
 * back when it resolves, and a send resolves when the devices are done rather
 * than when the reel has drawn what they did. So this waits at the pace the
 * protocol works at, and it is what lets a whole epoch be driven without
 * waiting out an epoch of dwell first.
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
 * `epoch` adds a whole braid epoch to the conversation and reads the completion
 * the braid reports for it. It is off by default, and the passes the drawing
 * checks read leave it off: they are measured against each other, and a run that
 * had sent ninety more messages would not be the same run.
 */
async function visit(cdp, origin, held, { blocked = [], repeat = false, braid = null, epoch = false } = {}) {
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
     * There is one control before the composer. Starting boots the two devices
     * and publishes their public prekeys; the composers stay unavailable until
     * that has happened, so a harness that went straight for send would press a
     * disabled button and report the demo as broken. Pressing start first is
     * not the harness being polite about the UI — it is the harness driving the
     * step the page actually has.
     *
     * The chunk arrives on this press, which is why it happens after the byte
     * accounting boundary rather than during setup.
     *
     * Blamed on the demo for the same reason as the click: the elements were
     * there a moment ago, so if they are gone now the demo's own script moved
     * them, and a demo that re-renders itself out from under the reader is not
     * an infrastructure fault.
     */
    await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(START)}).click()`, 'demo');

    /* Either outcome ends the wait: devices that can be typed at, or a status
       line saying why there are none. Waiting on the button alone would not
       distinguish them — `enable()` re-runs on both paths. */
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
      `the demo neither started nor reported a failure within ${DECRYPT_TIMEOUT_MS} ms of the ` +
        `start control being pressed`,
      why({
        "the send button's disabled": `document.querySelector(${JSON.stringify(SEND)}).disabled`,
        'the status line': `document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? null`,
      }),
    );

    /* What starting alone did, before a sentence is typed. The relay has
       carried two public bundles by now and is still holding no row, which is a
       claim the page makes and this is where it is true. */
    const afterStart = await evaluate(cdp, sessionId, SNAPSHOT);

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
     * A whole epoch of the braid, and the completion it reports for it.
     *
     * The chunks the braid carries are added one per message, so the only way to
     * reach a produced epoch key is to send the messages that carry them. The
     * drive alternates for that reason: each side adds its chunk on the messages
     * it sends, and a conversation that only ever went one way would carry half
     * a braid however long it ran.
     *
     * Driven at the devices' pace and read at the reader's. Each send waits only
     * for the composer, so the conversation is complete long before the drawing
     * has caught up with it, and the single wait afterwards is what the pass
     * spends its time in. The reel is behind by design and this is the shape
     * that costs the least: waiting out the dwell after every message would take
     * the pass from minutes to hours and would prove nothing further.
     *
     * `EPOCH_MESSAGES` more, rather than that many in total. The sentences above
     * are already in the conversation, so counting from here is the bound that
     * holds whatever preceded it.
     */
    let epochMark = null;
    if (epoch) {
      for (let turn = 0; turn < EPOCH_MESSAGES; turn += 1) {
        await sendAndSettle(
          cdp,
          sessionId,
          EPOCH_PROBE(turn),
          turn % 2 === 0 ? 'b' : 'a',
          `the conversation stopped ${turn} messages into an epoch of ${EPOCH_MESSAGES}`,
        );
      }

      /*
       * Then wait for the braid to say a device produced its key.
       *
       * Waited on the mark rather than on a step: the mark is written from the
       * report the SDK raised and a step is written for every message, so a walk
       * to a step would arrive whether a braid had reported anything or not.
       */
      await walk(
        cdp,
        sessionId,
        `!document.querySelector(${JSON.stringify(SCENE_BRAID_MARK)})?.hidden`,
        `${EPOCH_MESSAGES} alternating messages went through the braid and the scene never ` +
          `reported an epoch key`,
        why({
          'the braid row is shown': `!document.querySelector(${JSON.stringify(SCENE_BRAID)})?.hidden`,
          'the chunk figure': `document.querySelector(${JSON.stringify(SCENE_BRAID_FIGURE)})?.textContent ?? null`,
          'the reel is on': `document.querySelector(${JSON.stringify(SCENE)})?.dataset.sceneState ?? null`,
          'the status line': `document.querySelector(${JSON.stringify(STATUS)})?.textContent ?? null`,
        }),
        EPOCH_BUDGET_MS,
      );

      /* Read in one round trip, so the mark, the figure beside it and the name
         it is held against all describe the same moment. */
      epochMark = await evaluate(
        cdp,
        sessionId,
        `(() => {
           const row = document.querySelector(${JSON.stringify(SCENE_BRAID)});
           const mark = document.querySelector(${JSON.stringify(SCENE_BRAID_MARK)});
           const figure = document.querySelector(${JSON.stringify(SCENE_BRAID_FIGURE)});
           if (!row || !mark || !figure) return null;
           const where = {
             a: ${JSON.stringify(SCENE_NAME('a'))},
             b: ${JSON.stringify(SCENE_NAME('b'))},
           };
           const side = mark.dataset.sceneBraidKey ?? null;
           const named = where[side]
             ? document.querySelector(where[side])?.textContent ?? null
             : null;
           return {
             row: !row.hidden,
             marked: !mark.hidden,
             side,
             named,
             mark: mark.textContent ?? '',
             figure: figure.textContent ?? '',
           };
         })()`,
        'demo',
      );
    }

    /*
     * And to the end of the recording, so the state the checks read is the one
     * the run finishes in rather than wherever the last sentence happened to
     * leave it. Already there when the reel's last cue is the one that decrypted
     * — the wait costs one sample and returns — and not when a scenario or a
     * repeat put something after it.
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
      dom,
      geometry,
      braid,
      epochMark,
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

/**
 * Open the homepage at the scenario's own fragment, run it twice, and report
 * both runs plus everything the browser did across them.
 *
 * Twice, because once cannot tell a live protocol failure from a page that
 * prints one. Every fixed string in the output — the error code, the SDK's
 * message, the two "did not happen" lines — is exactly what a hand-written page
 * would print, and it would print it in 0 ms. What such a page cannot do is
 * produce a different message id on the second press, because that id comes
 * from a device pair booted for that run. So the checks require the fixed parts
 * to match across both runs and the per-run parts to differ.
 */
async function visitScenario(cdp, origin, held, slug) {
  const tab = await openTab(cdp, held);
  const { sessionId } = tab;
  const SCENARIO = scenarioRoot(slug);
  const snapshot = scenarioSnapshot(slug);

  const read = () => evaluate(cdp, sessionId, snapshot);

  try {
    /* The fragment, not the bare path: arriving at `/#<slug>` is a reader
       asking for this scenario by name, and opening it is what the page
       promises to do about that. */
    await tab.navigate(`${origin}/#${slug}`, `/#${slug}`);

    const title = await evaluate(cdp, sessionId, 'document.title');
    if (!title)
      throw new Infra('the homepage rendered no title — the served build looks wrong');

    if (!(await evaluate(cdp, sessionId, present(SCENARIO)))) {
      throw new Red(
        `no scenario on the homepage: nothing matches ${SCENARIO}.\n` +
          `  The page served and rendered (title: ${JSON.stringify(title)}), so the scenario is ` +
          `absent rather than\n  unreachable.`,
      );
    }
    for (const [selector, what] of [
      [`${SCENARIO} ${SCENARIO_RUN}`, 'a control that runs it'],
      [`${SCENARIO} ${SCENARIO_STATUS}`, 'a status line'],
      [`${SCENARIO} ${SCENARIO_OUTPUT}`, 'a pane for what the SDK said'],
    ]) {
      if (!(await evaluate(cdp, sessionId, present(selector)))) {
        throw new Red(`the scenario is on the page but exposes no ${what} (${selector})`);
      }
    }

    const opened = await read();

    await tab.quiet(IDLE_QUIET_MS, IDLE_MAX_MS);
    const interactedAt = Date.now();

    const runs = [];
    for (const attempt of [1, 2]) {
      await evaluate(
        cdp,
        sessionId,
        `document.querySelector(${JSON.stringify(`${SCENARIO} ${SCENARIO_RUN}`)}).click()`,
        'demo',
      );
      /*
       * Wait for the run to be over, not for the output to change.
       *
       * Waiting on changed text reads well and is wrong: a page replaying one
       * recorded run prints identical text twice, so the wait would sit there
       * until the cap and report a page that printed nothing — blaming a hang
       * for what is actually the most interesting failure this harness can
       * find. Let both runs finish, and let the checks below say what was
       * wrong with them.
       *
       * The control is disabled synchronously by the click handler before its
       * first await and re-enabled in its `finally`, so "enabled again with
       * the pane showing" is exactly one completed run, whichever attempt it
       * is.
       */
      try {
        await waitFor(
          cdp,
          sessionId,
          `(() => {
             const scenario = document.querySelector(${JSON.stringify(SCENARIO)});
             const run = scenario?.querySelector(${JSON.stringify(SCENARIO_RUN)});
             const output = scenario?.querySelector(${JSON.stringify(SCENARIO_OUTPUT)});
             return Boolean(run) && !run.disabled && Boolean(output) && !output.hidden;
           })()`,
          SCENARIO_TIMEOUT_MS,
          `run ${attempt} of the ${slug} scenario did not finish within ${SCENARIO_TIMEOUT_MS} ms`,
          () => {
            const lines = [];
            if (tab.cspViolations.length) {
              lines.push(
                `  The page reported ${tab.cspViolations.length} CSP violation(s), which is the ` +
                  `likeliest cause:`,
                ...tab.cspViolations.map((v) => `    ${v}`),
              );
            }
            if (tab.pageErrors.length) {
              lines.push(
                `  The page threw ${tab.pageErrors.length} uncaught error(s):`,
                ...tab.pageErrors.map((e) => `    ${e.split('\n')[0]}`),
              );
            }
            return lines;
          },
        );
      } catch (error) {
        /* The page writes its own failure into the status line, and a scenario
           that could not run has already said why there. Reading it costs one
           round trip on a path that has already failed. */
        if (!(error instanceof Red)) throw error;
        const status = await evaluate(cdp, sessionId, snapshot).catch(() => null);
        throw new Red(
          `${error.message}\n  The page's own status line reads: ` +
            `${JSON.stringify(status?.status ?? '(unreadable)')}`,
        );
      }
      runs.push(await read());
    }

    const wentQuiet = await tab.quiet(EGRESS_QUIET_MS, EGRESS_SETTLE_MAX_MS);
    await tab.fillPostData();

    const before = tab.scripts.filter((script) => script.at < interactedAt);
    const after = tab.scripts.filter((script) => script.at >= interactedAt);
    return {
      slug,
      opened,
      runs,
      requests: tab.requests,
      cspViolations: tab.cspViolations,
      pageErrors: tab.pageErrors,
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
 * What the metadata pane must print, computed rather than counted.
 *
 * A count is the wrong assertion, and this harness shipped with one. Ten rows
 * of the right names pass `>= 10` whether the panel iterated the envelope or
 * carried a list someone typed — which is the drift the recorded panel already
 * suffered, and the thing invariant 4 exists to stop. Adversarial review proved
 * the hole by hand-typing the current ten field names and watching the run stay
 * green.
 *
 * So the expectation is derived the same way the panel's rows are supposed to
 * be: run the real driver here in Node, against the same installed package the
 * browser loads, and take the keys of the envelope it produces. Subtract the
 * fields the panel declares it holds back, read out of the panel source rather
 * than retyped here, and what remains is the exact set the pane must show —
 * no more, no less.
 *
 * That equality does not make a hand-typed list fail *today*: a list that
 * happens to be correct right now prints the correct names. What it does is
 * turn the next `Envelope` change into a red run instead of a silent
 * divergence, which is the failure this guard is for. The list has to be caught
 * at the source, and `tests/demo-panel.test.mjs` is where that happens.
 */
async function expectedFields(envelopeFields) {
  const consoleSource = await readFile(
    new URL('../src/components/demo/DemoConsole.astro', import.meta.url),
    'utf8',
  );
  const declared = consoleSource.match(/HELD_BACK = new Set\(\[([^\]]*)\]\)/s)?.[1];
  if (declared === undefined) {
    throw new Infra(
      'could not read HELD_BACK out of DemoConsole.astro, so this run cannot tell a ' +
        'deliberately withheld field from a missing one',
    );
  }
  const heldBack = new Set([...declared.matchAll(/'([^']+)'/g)].map((match) => match[1]));

  let envelope;
  try {
    const session = await startDemoSession();
    ({ envelope } = await session.send('probe for the expected field set'));
  } catch (cause) {
    throw new Infra(`the driver could not produce an envelope to expect: ${cause}`);
  }

  const expected = new Set(Object.keys(envelope).filter((field) => !heldBack.has(field)));
  for (const field of heldBack) {
    if (!envelopeFields.has(field)) {
      throw new Infra(
        `the console withholds "${field}", which the installed SDK does not declare on Envelope — ` +
          `the exclusion is stale and this run would expect the wrong set`,
      );
    }
  }
  if (expected.size < MIN_DERIVED_FIELDS) {
    throw new Infra(
      `a live envelope yielded only ${expected.size} printable field(s) ` +
        `(${[...expected].join(', ') || 'none'}), fewer than the ${MIN_DERIVED_FIELDS} this SDK ` +
        `should produce — the expectation has collapsed, so checking against it proves nothing`,
    );
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
  if (!pass.dom.holdingRow || pass.dom.holdingNothing) {
    throw new Red(
      'a sentence completed a round trip and the relay column still says it is holding nothing',
    );
  }

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

  /* Invariant 4. The rows have to be the envelope's own keys, so every name on
     screen must be a field the installed package declares — a hand-written list
     survives the SDK renaming a field, and this is what notices. */
  const invented = pass.dom.fields.filter((field) => !envelopeFields.has(field));
  if (invented.length) {
    throw new Red(
      `the metadata pane printed ${invented.join(', ')}, which the installed SDK does not ` +
        `declare on Envelope — those rows cannot have come from the live object`,
    );
  }

  /* And it has to be *every* one of them. `expected` is the key set of an
     envelope this process built from the same package, less what the panel says
     it withholds, so a missing row is a field the pane stopped showing and an
     extra row is one it shows without the envelope having it. Either is the
     pane and the object disagreeing, which is the whole of invariant 4. */
  const printed = new Set(pass.dom.fields);
  const missing = [...expected].filter((field) => !printed.has(field));
  const extra = [...printed].filter((field) => !expected.has(field));
  if (missing.length || extra.length) {
    throw new Red(
      `the metadata pane and the live envelope disagree about which fields exist:\n` +
        (missing.length ? `  never printed: ${missing.join(', ')}\n` : '') +
        (extra.length ? `  printed anyway: ${extra.join(', ')}\n` : '') +
        `  expected exactly: ${[...expected].join(', ')}\n` +
        `  the pane showed:  ${pass.dom.fields.join(', ') || '(nothing)'}\n` +
        `A pane built by iterating the envelope cannot disagree with it. This one did, so it ` +
        `is not being built that way.`,
    );
  }
  if (pass.dom.fields.length !== printed.size) {
    throw new Red(
      `the metadata pane printed the same field twice: ${pass.dom.fields.join(', ')}`,
    );
  }
  const empty = pass.dom.fields.filter((_, index) => !pass.dom.values[index]?.trim());
  if (empty.length) {
    throw new Red(`the metadata pane printed ${empty.join(', ')} with no value beside it`);
  }

  checkScene(pass);
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

  /* Invariant 4, on the bytes. The relay column prints the ciphertext it is
     holding, and bytes drawn rather than read are the exact thing this page says
     it does not do — so they have to be well-formed, and they have to not be the
     sentence. */
  const strip = pass.dom.cipher.split(/\s+/).filter(Boolean);
  if (strip.length === 0) {
    throw new Red(
      'the relay column printed no bytes — the hex strip is empty after a real envelope went ' +
        'through it',
    );
  }
  const malformed = strip.filter((byte) => !/^[0-9a-f]{2}$/.test(byte));
  if (malformed.length) {
    throw new Red(
      `the relay column's byte strip is not bytes: ${malformed.slice(0, 6).join(' ')}${
        malformed.length > 6 ? ' …' : ''
      }`,
    );
  }
  /*
   * Decoded, the strip must not be the sentence.
   *
   * This is the claim the column exists to make, checked rather than asserted: a
   * page that printed the plaintext as hex would satisfy every shape test above
   * and be exactly the demo this site says it is not. Latin-1 rather than UTF-8
   * because the strip is a window into the middle of a document and may cut a
   * multi-byte character in half — decoding byte for byte cannot throw, and a
   * sentence of ASCII would still be plainly there.
   */
  const decoded = Buffer.from(strip.join(''), 'hex').toString('latin1');
  const leaked = findProbe(decoded);
  if (leaked) {
    throw new Red(
      `the bytes the relay column printed decode to the sentence itself (${leaked}) — the strip ` +
        `is not ciphertext`,
    );
  }
}

/*
 * The relay pane and the byte lane, on a tab that is receiving.
 *
 * A tab watched only the rows it had sent. So the pane and the strip on a
 * receiving tab showed one of two things, both false: nothing at all, on a tab
 * that had never sent, or the bytes of that tab's own previous outbound message
 * — sitting beside a slab and a caption describing the message it had just been
 * handed. It rendered perfectly. It was a picture of the wrong envelope.
 *
 * The last thing to happen in the run is the second tab's reply, so afterwards
 * both tabs are looking at that one row: the tab that sent it, and the tab it
 * was addressed to. That gives an assertion neither tab can pass alone —
 * equality of the two printed ciphertexts across two browser tabs, which is
 * false the moment either tab goes back to printing only its own sends.
 *
 * Then each tab's own strip against its own pane, which is what makes the lane
 * evidence rather than decoration on the receiving side too.
 */
/*
 * Two sends, two different strips.
 *
 * The first cut of the lane decoded one base64 layer and printed the head of
 * what came out, which is the head of the *inner* base64 document — and a
 * prekey header that two messages on one session share byte for byte. The strip
 * was therefore identical on every send: a still image of ciphertext, standing
 * under a caption claiming those are the bytes of the row that was just stored.
 * It rendered perfectly, it decoded correctly, and it was the one thing on the
 * page that was not evidence.
 *
 * Nothing about the fix is self-checking. The offset is a measurement of where
 * one build of the SDK puts its per-message material, and an SDK that moves it
 * takes the strip back to a constant without moving a line of this repository.
 * So the run sends twice and reads the lane both times.
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
    const [, digits] = /^(\d+) keys?$/.exec(printed) ?? [];
    if (digits === undefined) {
      throw new Red(
        `device ${side} printed "${printed || '(nothing)'}" where its key count goes — the ` +
          'wheel says "N key" or "N keys", and anything else is a count this run cannot read',
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

  const before = first.cipher.trim();
  const after = second.cipher.trim();
  if (before.length === 0 || after.length === 0) {
    throw new Red(
      'the relay column printed no bytes on one of two sends, so there is nothing to compare — ' +
        `first "${before}", second "${after}"`,
    );
  }
  if (before === after) {
    throw new Red(
      'the relay column printed the same bytes for two different messages, so it is showing a ' +
        'constant rather than this envelope:\n' +
        `  both sends: ${before}\n` +
        '  the strip is sampled from a stretch of the envelope that no longer varies per ' +
        'message — HEX_OFFSET in src/lib/demo/ciphertext.ts is the measurement that moved',
    );
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
 * The relay's column draws the size of what the relay is holding.
 *
 * Two runs of the same page, differing in one switch. Braid off sends the
 * ML-KEM key whole in every message and braid on sends it in 32-byte chunks, so
 * the envelope the relay stores is several times larger in the first run than
 * in the second — and a column that draws that size has to be visibly different
 * between them.
 *
 * Geometry, and only geometry. The column already prints the byte count in
 * three places, and every one of those printed figures changes between these
 * two runs whether or not anything is drawn: a check that read one of them
 * would go green against the page as it stands and would go on being green if
 * the drawing were deleted. What no printed figure can do is change a box's
 * width, so the width is what is measured, at the size the reader's browser
 * gave it.
 *
 * Which box is not this harness's business. Every box in the column is measured
 * in both runs and paired by where it sits, and the pair that moved the most is
 * the answer — so a drawing may be a bar, a strip, a stack of chunks or the row
 * itself, may carry any markup, and may be moved within the column, and this
 * check neither knows nor cares. What it requires is that the column contain
 * one box that gets several times wider when the envelope does.
 */
function checkBraidDrawing(disabled, required) {
  const measured = (pass, setting) => {
    if (!pass.geometry) {
      throw new Red(
        `braid drawing — the run under braid ${setting} has no relay column on the page to ` +
          `measure (${RELAY_COLUMN}), so whether it draws the size of an envelope cannot be asked`,
      );
    }
    return pass.geometry;
  };
  const whole = measured(disabled, 'off');
  const chunked = measured(required, 'on');

  /* Paired by position in the column rather than by anything either run's
     markup says about itself. A box drawn in only one of the two runs has no
     pair and is passed over: the claim is about a box whose width answers the
     setting, and a box that exists under one setting alone cannot be compared
     to itself. */
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
      ratio: box.width / other.width,
    });
  }
  pairs.sort((first, second) => second.ratio - first.ratio);

  const held =
    `  the relay held, braid off: ${JSON.stringify(whole.stored)}\n` +
    `    of which the drawn row:  ${JSON.stringify(whole.note)}\n` +
    `  the relay held, braid on:  ${JSON.stringify(chunked.stored)}\n` +
    `    of which the drawn row:  ${JSON.stringify(chunked.note)}`;

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

  if (widest.ratio < BRAID_WIDTH_FACTOR) {
    throw new Red(
      `braid drawing — the relay column does not draw the size of what it is holding. The same ` +
        `page ran under both braid settings, which put envelopes of very different sizes through ` +
        `the relay, and the widest that any box in ${RELAY_COLUMN} changed between the two runs ` +
        `was ${widest.ratio.toFixed(2)}×. A width drawn to the envelope's size changes by at ` +
        `least ${BRAID_WIDTH_FACTOR}×.\n` +
        held +
        `\n  the boxes that moved most, of ${pairs.length} measured in both runs:\n` +
        pairs.slice(0, 3).map(describe).join('\n'),
    );
  }

  return { widest, whole, chunked, pairs };
}

/*
 * The braid tells the page when a device has produced its epoch key, and the
 * page draws it.
 *
 * The column check above measures a drawing against the sizes the relay is
 * holding, and every number in it can be had from bytes the page measured
 * itself. A completion cannot. Nothing in an envelope's length says that enough
 * chunks have arrived for a device to close its epoch — only the braid knows
 * that, and it says so once, in a report the page subscribes to. So this reads
 * the one thing on the page that no amount of measuring could have produced.
 *
 * Read after a whole epoch has been driven, because that is how long it takes
 * for the claim to become available to make.
 *
 * Held against the scene's own name for the device rather than against a name
 * this file knows. Both names come off the session the run booted, so a mark
 * that agrees with the column beside it is a mark written for a device that
 * exists; a fixed string typed into the markup would agree with neither.
 */
function checkBraidProgress(pass) {
  const reading = pass.epochMark;
  if (!reading) {
    throw new Red(
      `braid progress — ${EPOCH_MESSAGES} alternating messages went through a braided session ` +
        `and the scene has no braid row on it at all (${SCENE_BRAID}), so the page shows nothing ` +
        `about how much of the key has arrived`,
    );
  }
  if (!reading.row || !reading.marked) {
    throw new Red(
      `braid progress — the braid reported an epoch key and the scene is not showing it: the ` +
        `row is ${reading.row ? 'shown' : 'hidden'} and the mark is ` +
        `${reading.marked ? 'shown' : 'hidden'}`,
    );
  }

  /* The mark says which device produced the key, and it can only say it because
     the report named one. A mark that stood for no device would be the page
     announcing a completion it could not attribute. */
  if (reading.side !== 'a' && reading.side !== 'b') {
    throw new Red(
      `braid progress — the scene marks an epoch key and does not say which device produced ` +
        `it: it reads ${JSON.stringify(reading.mark)} and stands for ` +
        `${JSON.stringify(reading.side)}`,
    );
  }
  if (!reading.named || !reading.mark.includes(reading.named)) {
    throw new Red(
      `braid progress — the mark names a device the scene does not have. It reads ` +
        `${JSON.stringify(reading.mark)}, it stands for device ${JSON.stringify(reading.side)}, ` +
        `and that device's column calls it ${JSON.stringify(reading.named)}.`,
    );
  }

  /* And the counts beside it, which come from the same report. Two numbers and
     the word the drawing counts in — required as a shape rather than as a
     figure, because the figures are the braid's to choose and change. */
  const counted = /(\d+)\s+of\s+(\d+)\s+chunks/.exec(reading.figure);
  if (!counted) {
    throw new Red(
      `braid progress — the braid row prints no chunk counts. It reads ` +
        `${JSON.stringify(reading.figure)}, and the report it is drawn from carries how many ` +
        `chunks a device is holding and how many it needs.`,
    );
  }

  return {
    side: reading.side,
    named: reading.named,
    mark: reading.mark,
    figure: reading.figure,
    carried: Number(counted[1]),
    required: Number(counted[2]),
  };
}

/*
 * What the receiving device actually calls this failure, computed rather than
 * quoted.
 *
 * The same reasoning as `expectedFields`, applied to the claim the scenario
 * exists to make. A harness carrying the string "MAC mismatch" would go green against
 * a page that had that string typed into it, which is precisely the page this
 * one must never become — and it would go red the day the SDK reworded its
 * errors, teaching whoever ran it to update the string rather than look. So the
 * expectation is produced by running the scenario here in Node, against the
 * same installed package the browser loads, and taking the SDK's own words out
 * of the run.
 *
 * A Node run that does not refuse is not a demo failure. It means the shipped
 * package accepted a ciphertext with a flipped byte, and there is no page left
 * worth checking.
 *
 * Deriving it is not enough on its own, and this was a real hole rather than a
 * theoretical one. Both sides of the comparison come from the same scenario
 * module, so a change to *what the scenario corrupts* moves the page and the
 * expectation together and the check stays green: reintroducing the base64
 * layer bug (§3 of the proof) made the page demonstrate `UNKNOWN` with a parse
 * error, the Node run derive the same, and both error-surface assertions pass —
 * the page was demonstrating something it does not claim, and only the
 * liveness check caught it, with a message about device pairs. So the derived
 * code is held against the code the scenario's own shipped copy names. That
 * string is not computed from anything; it is what the reader is told, and it
 * is the thing the page is actually claiming.
 */
const CODE = /\b[A-Z][A-Z0-9_]{3,}\b/g;

/** The error code the scenario's copy promises a reader, out of the copy. */
function promisedErrorCode(slug) {
  const scenario = SCENARIOS.find((entry) => entry.slug === slug);
  if (!scenario) throw new Red(`no scenario in the catalogue is called ${slug}`);

  const copy = [scenario.title, scenario.expectation, scenario.action, scenario.link.label];
  const codes = [...new Set(copy.join(' ').match(CODE) ?? [])];
  if (codes.length !== 1) {
    throw new Red(
      `${slug}'s copy names ${codes.length} error codes (${codes.join(', ') || 'none'}), ` +
        `so there is\n  nothing for the derived expectation to be held against. The scenario has ` +
        `to promise the reader\n  exactly one code, or this check is a comparison of a value ` +
        `with itself.`,
    );
  }
  return codes[0];
}

async function expectedRefusal() {
  /* A scenario that throws is a demo failure, not an environment one. It is
     the same throw the page would show a reader in its status line, and the
     harness saying "this says nothing about the demo" over it would be wrong
     in the most expensive direction — the scenario's own guards (the base64
     depth check, above all) report exactly here. */
  let result;
  try {
    result = await runFlipAByte();
  } catch (cause) {
    throw new Red(
      `the scenario could not complete a run in this process: ` +
        `${cause instanceof Error ? cause.message : String(cause)}\n  This is what a reader ` +
        `would see in the scenario's status line, so the page is broken rather than the harness.`,
    );
  }
  if (!result.refusal) {
    throw new Red(
      'the installed SDK was handed a ciphertext with one byte flipped and reported no error ' +
        'at all.\n  This is not the page being wrong. Nothing on it is worth checking until it ' +
        'is explained.',
    );
  }
  if (result.delivered !== null && result.delivered !== result.sentence) {
    throw new Red(
      `the installed SDK delivered something other than the sent sentence after one byte was ` +
        `flipped:\n  sent:      ${result.sentence}\n  delivered: ${result.delivered}`,
    );
  }
  const promised = promisedErrorCode(FLIP_SLUG);
  if (result.refusal.errorCode !== promised) {
    throw new Red(
      `the scenario refuses with ${result.refusal.errorCode}, but the page says it is ` +
        `${promised}.\n  ${JSON.stringify(result.refusal.errorMessage)}\n  Both halves of this ` +
        `harness's expectation come from the scenario module, so a change to what the scenario ` +
        `corrupts\n  moves the page and the expectation together — this is the check that does ` +
        `not move with them. Either the\n  scenario is corrupting something other than the ` +
        `ciphertext the MAC covers, or the copy in catalog.ts\n  is now wrong about what a ` +
        `reader will see.`,
    );
  }

  return { ...result.refusal, sentence: result.sentence };
}

/*
 * What linking a second device does, according to the installed SDK.
 *
 * Same stance as `expectedRefusal`: the scenario is run in this process first,
 * and what it produced becomes the expectation the page is held to. The
 * assertions below are about the SDK rather than about the page — if the pre-link
 * message turns up on a device that did not exist when it was encrypted, the
 * page printing that faithfully is not the interesting problem.
 *
 * The claim is checked in both directions on purpose. "The new device does not
 * have it" is satisfied by a device that has nothing at all, and by a run where
 * the second message never arrived anywhere; the scenario is only evidence if
 * the device that was there kept both sentences while the new one holds exactly
 * the sentence sent after it was linked.
 */
async function expectedSecondDevice() {
  let result;
  try {
    result = await runAddASecondDevice();
  } catch (cause) {
    throw new Red(
      `the second-device scenario could not complete a run in this process: ` +
        `${cause instanceof Error ? cause.message : String(cause)}\n  This is what a reader ` +
        `would see in the scenario's status line, so the page is broken rather than the harness.`,
    );
  }

  if (!result.after) {
    throw new Red(
      'the message sent after the link never reached every device, so there is nothing to ' +
        'compare.\n  The scenario waited and gave up: the new device was linked and then did ' +
        'not receive.',
    );
  }
  if (result.before.recipientDeviceCount !== 1) {
    throw new Red(
      `the message sent before the link was encrypted to ` +
        `${result.before.recipientDeviceCount} devices, not 1. The account had one device at ` +
        `that point,\n  and the whole scenario is arithmetic about that number.`,
    );
  }
  if (result.after.recipientDeviceCount !== 2) {
    throw new Red(
      `the message sent after the link was encrypted to ` +
        `${result.after.recipientDeviceCount} devices, not 2. The link and the explicit ` +
        `establishSession both\n  succeeded, so the new device should have been in that fan-out.`,
    );
  }

  const primary = result.scrollback.find((device) => device.deviceId !== result.linked.deviceId);
  const linked = result.scrollback.find((device) => device.deviceId === result.linked.deviceId);
  if (!primary || !linked || result.scrollback.length !== 2) {
    throw new Red(
      `the run produced ${result.scrollback.length} device scroll-back(s) and the relay linked ` +
        `device ${result.linked.deviceId};\n  the scenario compares exactly two devices.`,
    );
  }
  if (linked.messages.includes(result.before.text)) {
    throw new Red(
      `the installed SDK delivered a message to a device that did not exist when it was ` +
        `encrypted:\n  ${JSON.stringify(result.before.text)} is on device ` +
        `${linked.deviceId}.\n  This is not the page being wrong.`,
    );
  }
  if (!primary.messages.includes(result.before.text)) {
    throw new Red(
      `the device that was already there lost the message sent before the link, so "the new ` +
        `device does not have it"\n  says nothing about linking — nothing has it. Device ` +
        `${primary.deviceId} holds: ${JSON.stringify(primary.messages)}`,
    );
  }
  for (const device of [primary, linked]) {
    if (!device.messages.includes(result.after.text)) {
      throw new Red(
        `the message sent after the link is not on device ${device.deviceId}, which the sender ` +
          `was told it was encrypted to.\n  That device holds: ${JSON.stringify(device.messages)}`,
      );
    }
  }

  return {
    before: result.before,
    after: result.after,
    linked: result.linked,
    primaryMessages: primary.messages,
    linkedMessages: linked.messages,
  };
}

/*
 * What running the relay out of one-time prekeys does, according to the
 * installed SDK.
 *
 * This scenario's claim is a negative — the SDK does not complain — and a
 * negative is the easiest thing on this site to assert falsely, so the run is
 * done here first and the page is held to it. The assertions below are about
 * the SDK: they fail when the SDK's behaviour moves, including when it moves
 * in the direction everyone would prefer.
 */
async function expectedPreKeys() {
  let result;
  try {
    result = await runOutOfPreKeys();
  } catch (cause) {
    throw new Red(
      `the prekey-exhaustion scenario could not complete a run in this process: ` +
        `${cause instanceof Error ? cause.message : String(cause)}\n  This is what a reader ` +
        `would see in the scenario's status line, so the page is broken rather than the harness.`,
    );
  }

  if (!result.bundle) {
    throw new Red(
      'the relay published no prekey bundle at all, so the run never reached the state the ' +
        'scenario is about.',
    );
  }
  if (result.bundle.ecOneTimePreKey !== null || result.bundle.kemOneTimePreKey !== null) {
    throw new Red(
      `the relay was told to serve no one-time prekeys and served them anyway: EC ` +
        `${result.bundle.ecOneTimePreKey}, KEM ${result.bundle.kemOneTimePreKey}.\n  The ` +
        `scenario has nothing to show, and the page would be describing an exhaustion that ` +
        `did not happen.`,
    );
  }
  if (result.bundle.kemLastResortPreKey === null) {
    throw new Red(
      'the relay published no last-resort prekey either, so this run is about a bundle with no ' +
        'usable KEM key\n  rather than about the fallback the scenario exists to show.',
    );
  }
  if (result.healthy.usedKemPreKeyType !== 'one-time') {
    throw new Red(
      `the ordinary conversation did not use a one-time prekey — the SDK called it ` +
        `${JSON.stringify(result.healthy.usedKemPreKeyType)}.\n  Without that, the run has no ` +
        `healthy case to contrast the exhausted one against.`,
    );
  }
  if (result.fallback.usedKemPreKeyType !== 'last-resort' || result.fallback.usedOneTimePreKey) {
    throw new Red(
      `the handshake against the empty bundle did not fall back the way the page says: ` +
        `usedKemPreKeyType ${JSON.stringify(result.fallback.usedKemPreKeyType)}, ` +
        `usedOneTimePreKey ${String(result.fallback.usedOneTimePreKey)}.`,
    );
  }
  if (result.delivered !== result.sentence) {
    throw new Red(
      `the first message of the new conversation never arrived, so this run cannot show that ` +
        `exhaustion is survivable.\n  sent: ${JSON.stringify(result.sentence)}, delivered: ` +
        `${JSON.stringify(result.delivered)}`,
    );
  }
  if (result.exhausted.ec !== 0 || result.exhausted.kem !== 0) {
    throw new Red(
      `the relay still held ${result.exhausted.ec} EC and ${result.exhausted.kem} KEM one-time ` +
        `prekeys at the moment it published an empty bundle.\n  The counts the page prints ` +
        `would contradict the bundle beside them.`,
    );
  }

  /*
   * The finding, asserted in the direction that makes it a finding. If a future
   * SDK does warn, this goes red — deliberately. The page's central sentence
   * would then be false, and a harness that stayed green while the page told a
   * reader "the SDK says nothing" about an SDK that says something is worse
   * than no harness. The message says which way to fix it.
   */
  if (result.warnings.length > 0) {
    throw new Red(
      `the SDK now reports prekey exhaustion: ` +
        `${result.warnings.map((record) => `${record.level} ${record.message}`).join('; ')}.\n` +
        `  That is an improvement, and it makes the page wrong: the scenario is built around the ` +
        `SDK saying nothing.\n  Update the page and this expectation together.`,
    );
  }

  /*
   * And the check that keeps the one above from being vacuous.
   *
   * An empty `warnings` array proves nothing by itself: an SDK that logged
   * nothing at all would produce one, and so would a filter that had quietly
   * stopped working. What makes the silence a finding is that the SDK is
   * talking throughout — in breadcrumbs, several of them naming the fallback —
   * and never at a level an application would see. A run where the breadcrumbs
   * dried up is a run where "no warning" is no longer evidence of anything, and
   * the page would be printing a finding it did not observe.
   */
  if (result.whileEmpty.namingFallback === 0) {
    throw new Red(
      `the SDK dropped ${result.whileEmpty.breadcrumbs} breadcrumb(s) during the exhausted ` +
        `handshake and none of them\n  named the last-resort fallback. The page's "no warning" ` +
        `line is read against what the SDK did say;\n  with nothing said, an empty warn/error ` +
        `list stops being evidence that exhaustion goes unreported.`,
    );
  }

  /*
   * And the other half of the finding: the SDK's own prekey-health call cannot
   * see the exhaustion, because it counts this device's stored prekeys rather
   * than the server's. If it ever agrees with the server, the page's
   * explanation of why it does not is wrong.
   */
  if (
    result.health &&
    result.health.oneTimePreKeysRemaining >= 0 &&
    result.health.oneTimePreKeysRemaining === result.exhausted.ec
  ) {
    throw new Red(
      `checkPreKeyStatus() now agrees with the relay (both ${result.exhausted.ec}), so it is no ` +
        `longer counting only\n  local storage. The page tells a reader the opposite. Update ` +
        `both.`,
    );
  }

  return {
    firstSentence: result.firstSentence,
    sentence: result.sentence,
    bundle: result.bundle,
    exhausted: result.exhausted,
    fallback: result.fallback,
    health: result.health,
    whileEmpty: result.whileEmpty,
  };
}

/*
 * What destroying the receiving device and rebuilding it does, according to the
 * installed SDK.
 *
 * This scenario's central claim is the strongest negative on the site: the
 * application is told nothing. The plan it was built from expected a
 * safety-number change event, the SDK has no such hook, and the page says so.
 * That makes this expectation the thing standing between "the SDK has no
 * identity-change event" and "the page asserts the SDK has no identity-change
 * event" — so every assertion below is about the SDK, and each one fails when
 * the SDK grows the thing the page says it lacks.
 */
async function expectedReinstall() {
  let result;
  try {
    result = await reinstallADevice();
  } catch (cause) {
    throw new Red(
      `the reinstall scenario could not complete a run in this process: ` +
        `${cause instanceof Error ? cause.message : String(cause)}\n  This is what a reader ` +
        `would see in the scenario's status line, so the page is broken rather than the harness.`,
    );
  }

  if (result.established.delivered !== result.established.sentence) {
    throw new Red(
      `the opening message never arrived, so this run never had the working conversation the ` +
        `reinstall is\n  supposed to interrupt. Everything after it would be about a first ` +
        `contact instead.`,
    );
  }

  /*
   * The relay refusing the rebuilt device is the protocol half of the scenario.
   * A run where it succeeds is a run where a device that has never seen the
   * account took the account over, which would be a finding of an entirely
   * different and much louder kind.
   */
  if (result.publish.ok) {
    throw new Red(
      `the rebuilt device published itself over the account identity and the relay allowed it. ` +
        `That is not\n  a page that needs updating — a device with no prior relationship to the ` +
        `account took it over.\n  Stop and look at the relay's identity provisioning before ` +
        `touching the page.`,
    );
  }
  /*
   * The refusal arrives in two parts and the page prints both, so both are
   * checked here. `message` is the SDK's own wrapper — "Failed to sync with
   * server", which on its own could be a network error — and `cause` is the
   * relay saying why. The page's claim is that a reinstalled device cannot
   * quietly become the account; only the second sentence supports it, so a run
   * that lost the cause would leave the page attributing a generic failure to a
   * policy.
   *
   * Both halves are asserted non-empty *here* because the page-side check
   * cannot assert it there. `reinstallExpectation` looks for each half with
   * `run.text.includes(half)`, and `includes('')` is true of every string — so
   * an empty half is not a check that fails, it is a check that stops existing.
   * That is not hypothetical: this comment used to claim both halves were
   * checked when only `cause` was, and emptying the wrapper message left the
   * whole suite green. These two guards are what make the page-side `includes`
   * mean anything, so they belong to it as much as to this function.
   */
  if (!result.publish.message.trim()) {
    throw new Red(
      `the relay refused the rebuilt device and the SDK wrapped the refusal in an empty message.\n` +
        `  The page prints the SDK's wrapper beside the relay's reason to show that the wrapper ` +
        `alone reads as a\n  network failure; with nothing there, the page prints the reason ` +
        `twice and the check that it printed\n  the wrapper passes against the empty string.`,
    );
  }
  if (!result.publish.cause) {
    throw new Red(
      `the relay refused the rebuilt device with "${result.publish.message}" and no underlying ` +
        `reason.\n  The page quotes the reason as the evidence that this is a policy rather than ` +
        `a network failure,\n  and there is nothing to quote.`,
    );
  }
  if (!result.rotate.ok) {
    throw new Red(
      `the rebuilt device could not get back onto the account even with an explicit rotation: ` +
        `${result.rotate.code ?? result.rotate.name}: ${result.rotate.message}.\n  The scenario ` +
        `then has no recovery to show, and the page's account of what it takes is untested.`,
    );
  }

  /*
   * The finding, asserted in the direction that makes it a finding. Every hook
   * the SDK offers was registered before the device was destroyed; a run where
   * one of them fires means the SDK now tells the application something, the
   * page's central sentence is false, and the fix is to update both.
   */
  if (result.hooks.fired.length > 0) {
    throw new Red(
      `the SDK now notifies the application when the far identity changes: ` +
        `${result.hooks.fired.join(', ')}.\n  That is an improvement, and it makes the page ` +
        `wrong: the scenario is built around no hook firing.\n  Update the page and this ` +
        `expectation together.`,
    );
  }

  /*
   * And the check that keeps the one above from being vacuous, which this
   * scenario needs more than the prekey one does. An empty `fired` list is
   * exactly what a run that registered nothing produces, and it is also what a
   * run that hooked the wrong device produces. Holding the registered list
   * against the SDK's own union is what makes the silence evidence: these are
   * all the hooks there are, they were live, and none of them fired.
   */
  if (result.hooks.registered.length === 0 || result.hooks.devices.length === 0) {
    throw new Red(
      `the run registered ${result.hooks.registered.length} hook(s) on ` +
        `${result.hooks.devices.length} device(s), so "no hook fired" is a statement about an ` +
        `empty\n  registration rather than about the SDK.`,
    );
  }

  /*
   * The other half of the finding: the SDK is not quiet, it is quiet *where an
   * application looks*. A run with nothing at warn or error would make the
   * page's "all of it went to the logger" line describe an absence of logging
   * rather than a routing problem.
   */
  if (result.loud.length === 0) {
    throw new Red(
      `the SDK logged nothing at warn or error across the whole reinstall. The page's argument ` +
        `is that it\n  says plenty and says all of it to the logger; with nothing said, "none ` +
        `of it reached a hook" stops\n  being evidence about where the SDK reports and becomes ` +
        `a sentence about an empty list.`,
    );
  }

  /*
   * And which codes those records carry, which the page prints by name and
   * tells a reader to expect in their own logs. `REINSTALL_CODES` says why this
   * is an exact set rather than a floor.
   */
  const seen = [...result.codes].sort();
  const missing = REINSTALL_CODES.filter((code) => !seen.includes(code));
  const extra = seen.filter((code) => !REINSTALL_CODES.includes(code));
  if (missing.length > 0 || extra.length > 0) {
    throw new Red(
      `the reinstall's error codes are not the set the page names. Expected exactly ` +
        `${REINSTALL_CODES.join(', ')};\n  this run carried ${seen.join(', ') || 'none'}` +
        (missing.length > 0 ? `, missing ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `, and carrying ${extra.join(', ')} as well` : '') +
        `.\n  Either the scenario stopped reading one of the four places the SDK puts a code, or ` +
        `the SDK reports\n  something here it did not before. The page names these codes, so fix ` +
        `the page and this list together.`,
    );
  }

  /*
   * And how they are spread across the records, which is the other half of what
   * the page says and the half a check on the set cannot see. `REINSTALL_CODED`
   * says why it is asserted separately.
   */
  if (result.loud.length !== REINSTALL_CODED.loud || result.coded !== REINSTALL_CODED.coded) {
    throw new Red(
      `the reinstall's records are not spread the way the page describes. Expected ` +
        `${REINSTALL_CODED.coded} of ${REINSTALL_CODED.loud} records at warn or error to carry ` +
        `a code and\n  ${REINSTALL_CODED.loud - REINSTALL_CODED.coded} to carry none; this run ` +
        `had ${result.coded} of ${result.loud.length} carrying one and ` +
        `${result.loud.length - result.coded} carrying none.\n  The page tells a reader how much ` +
        `of this grepping for a single code accounts for, so that sentence and this ` +
        `expectation\n  move together.`,
    );
  }

  /*
   * `verify()` throwing is what stops an application from rendering the changed
   * number a "safety number changed" banner is made of. If it starts answering,
   * the page's account of why the banner is hard to build is wrong.
   */
  if (result.asked.ok) {
    throw new Red(
      `verify() now returns a safety number after the far identity has changed, rather than ` +
        `throwing.\n  The page tells a reader the application cannot render the comparison until ` +
        `it has already accepted\n  the change. Update both.`,
    );
  }

  if (!result.accepted.ok || result.recovered === null) {
    throw new Red(
      `the run never recovered: acceptIdentityRotation ` +
        `${result.accepted.ok ? 'succeeded' : 'failed'} and delivery ` +
        `${result.recovered === null ? 'did not resume' : 'resumed'}.\n  The scenario would then ` +
        `be showing a break with no way out, which is not what it says.`,
    );
  }
  if (!result.after) {
    throw new Red(
      'the run produced no safety number after the change, so the comparison the page prints ' +
        'has nothing on\n  one side of it.',
    );
  }

  /*
   * The split. The page's closing argument is that a user is asked to re-read
   * sixty digits of which thirty moved; that is only true while the local half
   * holds still and the remote half does not.
   */
  if (result.before.localHalf !== result.after.localHalf) {
    throw new Red(
      `the sending party's own half of the safety number changed across a reinstall of the ` +
        `other device\n  (${result.before.localHalf} then ${result.after.localHalf}), which no ` +
        `part of this scenario touched.`,
    );
  }
  if (result.before.remoteHalf === result.after.remoteHalf) {
    throw new Red(
      `the far party's half of the safety number is unchanged after they rebuilt on a new ` +
        `identity\n  (${result.after.remoteHalf}). The number is then not a function of the ` +
        `identity it is supposed to\n  commit to, and the whole comparison is worthless.`,
    );
  }

  return {
    sender: result.sender,
    recipient: result.recipient,
    established: result.established,
    /* All three sentences this scenario types, including the one that never
       arrives. A stranded message is still plaintext the page had in hand, and
       "it did not reach the recipient" is not the same claim as "it did not
       reach the network". */
    sentences: [result.established.sentence, result.stranded.sentence, result.recovered].filter(
      (sentence) => typeof sentence === 'string',
    ),
    publish: result.publish,
    hooks: result.hooks,
    asked: result.asked,
    loud: result.loud,
    codes: result.codes,
    coded: result.coded,
    before: result.before,
    after: result.after,
  };
}

/*
 * Sentences the page prints when the run did *not* go the way it claims runs
 * go. Each is the else-branch of a check against an observed value, so any of
 * them on screen means the page is being honest about a run that failed — which
 * is still a red harness result, and a far more interesting one than a missing
 * element.
 */
const FLIP_DENIALS = [
  'reported no error at all',
  'Something other than the sent message was delivered',
  'Garbage plaintext reached the application',
  'no recovery to show',
  'cannot say the drop was not silent',
  'cannot say that no garbage plaintext reached it',
];

/*
 * Each of these is a branch the page renders when it cannot make its argument.
 * The page is right to print them; a run that reaches one is not a pass.
 *
 * `no scroll-back for the device it linked` is the state where the linked
 * device produced no pane at all — which is not the same as a pane that simply
 * lacks the pre-link message, and that difference is the whole point of the
 * scenario. It shares its cause with `never joined the session`, so both
 * render together, and the scan below reports the first match: the precise one
 * has to come first, or the failure is reported as the vaguer of the two.
 */
const SECOND_DEVICE_DENIALS = [
  'no scroll-back for the device it linked',
  'is on the new device',
  'never reached every device',
  'never joined the session',
];

/*
 * The branches the prekey scenario renders when it cannot make its argument.
 *
 * Ordered so the scan below reports the most precise one first, as the
 * second-device list is. "went on serving them" is the state where the run
 * never reached exhaustion at all, and everything printed after it is about a
 * bundle that was never empty — so it has to be reported ahead of the vaguer
 * downstream branches it causes.
 *
 * `The SDK did warn` is in here for a different reason than the rest. It is not
 * a failed run: it is the page discovering that the SDK has grown the warning
 * this scenario says it does not have. It belongs on this list because it means
 * the page is stale, which is a stop, not a pass.
 *
 * What is deliberately *not* on this list is the health check declining to
 * answer. `checkPreKeyStatus()` is throttled per account for twelve hours in a
 * map that outlives the client, so the second press in a tab is always refused
 * — it was on the run that put this note here. That is the SDK behaving as
 * built rather than a run that failed, and it is the same finding as the
 * counted branch: no signal reaches the application either way. It is held to
 * instead by `checkRuns` below, which requires the counted branch from at least
 * one of the two presses, so a pass still proves the finding on screen.
 */
const PREKEY_DENIALS = [
  'went on serving them',
  'The SDK reported no key agreement',
  'The message never arrived',
  'The SDK did warn',
  'returned nothing on this run',
];

/*
 * Every error code the reinstall produces, and nothing else.
 *
 * The page names these codes and tells a reader which of the records carry one,
 * so the set is copy rather than a diagnostic. It shipped wrong once: the
 * scenario read a code from two of the four places the SDK puts one, saw only
 * the two records that carry `UNTRUSTED_IDENTITY`, missed the two that carry the
 * other codes — `INITIALIZATION_FAILED` and `PREKEY_NOT_FOUND`, one record each
 * — and the page told a reader to grep for a code most of the records do not
 * have. Nothing was red, because the set was printed in the summary and asserted
 * nowhere. The remaining three records carry no code at all, which is what
 * `REINSTALL_CODED` below is for.
 *
 * Asserted as an exact set, in both directions. A missing code means the
 * scenario stopped reading one of the four places, which is the mistake that
 * happened; an extra one means the SDK reports something new here, and the page
 * has to say so before it can go on claiming to list what a reader will see.
 */
const REINSTALL_CODES = ['INITIALIZATION_FAILED', 'PREKEY_NOT_FOUND', 'UNTRUSTED_IDENTITY'];

/*
 * How those codes are spread across the records: seven at warn or error, four
 * carrying a code and three carrying none.
 *
 * The set above is not enough on its own, and twice now it has not been. The
 * page does not only name the codes, it tells a reader how much of the noise
 * grepping for one of them accounts for — and that is a distribution claim, so
 * a check on the set leaves it unheld. Both sentences that shipped wrong here
 * had the set right: "all of them carrying `UNTRUSTED_IDENTITY`" and then "each
 * record carries one of those" were each contradicted by the three records that
 * carry no code, while `REINSTALL_CODES` stayed green through both.
 *
 * Exact in both directions for the same reason the set is. A different split is
 * either the scenario reading a code place it did not before, or the SDK
 * changing what it reports — and either way the page's sentence about grepping
 * is describing a run that no longer happens.
 */
const REINSTALL_CODED = { loud: 7, coded: 4 };

/*
 * The branches the reinstall scenario renders when it cannot make its argument.
 *
 * Ordered most precise first, like the two lists above, but the first entry is
 * here for a different reason than the rest: it is not a run that failed to
 * reach the state the page describes, it is the relay letting a device with no
 * prior relationship to the account publish under it. Everything below it is
 * downstream of a run going differently; that one is a security finding, and it
 * has to be the sentence the harness reports.
 */
const REINSTALL_DENIALS = [
  'published itself over the account identity without being challenged',
  'never had the working conversation',
  'could not rotate onto the account',
  'The SDK did notify the application',
  'send was rejected outright',
  'no stranded message to show',
  'returned a safety number rather than refusing',
  'logged nothing at warn or error',
  'Accepting the identity change failed',
  'Delivery did not resume',
  'does not split the way this page expects',
];

/*
 * The reinstall scenario's per-run value: the far party's half of the safety
 * number, after they rebuilt.
 *
 * It is the strongest divergence value on the page. The other scenarios pick a
 * fresh key because a fresh key is what a live run has and a recording does
 * not; here the fresh value is also the scenario's subject — those thirty
 * digits are a commitment to the identity the rebuilt device generated, and a
 * page that printed the same ones twice would be showing a reader a safety
 * number that does not depend on the identity it is supposed to commit to.
 */
const SAFETY_HALF = /went from [\d ]+ to ([\d ]+?)\./;

function safetyHalfIn(run) {
  for (const step of run.recovery) {
    const found = SAFETY_HALF.exec(step);
    if (found) return found[1];
  }
  return null;
}

/*
 * The prekey scenario's per-run value: the last-resort key the empty bundle
 * handed over.
 *
 * It is the right one for this scenario twice over. It is key material rather
 * than an identifier, so it is fresh on every press and cannot be fresh on a
 * recording; and it is the exact key the scenario's argument is about — the one
 * every sender arriving at an empty stash shares.
 */
const LAST_RESORT = /public key ([A-Za-z0-9+/]+)/;

function lastResortIn(run) {
  for (const step of run.steps) {
    const found = LAST_RESORT.exec(step);
    if (found) return found[1];
  }
  return null;
}

/*
 * The one value in the output that a page cannot have been born knowing.
 *
 * It has to come from the log rather than from the summary, and it has to be
 * key material rather than an identifier. The message id looked like the
 * obvious choice and is useless: the in-memory relay numbers messages from one,
 * so every run reports `msg-1`. The sending device's identity key fingerprint
 * is generated when that device boots, and every press of the button boots a
 * new pair — so it differs across runs of a live demo and cannot differ across
 * runs of a recording.
 */
const FINGERPRINT = /"senderIdentityKeyFingerprint":"([^"]+)"/;

function fingerprintIn(run) {
  for (const row of run.logLines) {
    const found = FINGERPRINT.exec(row.text);
    if (found) return found[1];
  }
  return null;
}

/*
 * The same job for the second-device scenario, which has no fingerprint on
 * screen: its two info records are about the first send and carry no key
 * material. The provisioning URL does. The primary device puts a fresh
 * ephemeral public key in the QR code it shows, so the key differs on every
 * press of a live demo and cannot differ on a replayed one.
 */
const QR_KEY = /link-device\?session=[^\s&]+&key=(\S+)/;

function qrKeyIn(run) {
  for (const step of run.steps) {
    const found = QR_KEY.exec(step);
    if (found) return found[1];
  }
  return null;
}

/*
 * Everything that is true of any scenario the site ships.
 *
 * `expectation` carries the rest: which slug this pass drove, the sentences
 * that must never leave the tab, the page's own denial strings, the per-run
 * checks, and the one value that has to differ between two live runs. All of
 * those are derived from a run of the scenario in this process, never typed
 * here — a harness holding the page to strings it was given by the same person
 * who wrote the page is checking that nobody made a typo.
 *
 * `checkRuns` is the optional half of `checkRun`: a claim that has to hold
 * across the pass rather than on every press. Only a scenario whose output
 * legitimately differs between presses needs one.
 */
function checkScenario(pass, origin, expectation) {
  const { slug, secrets, denials, divergence, checkRun, checkRuns } = expectation;

  if (!pass.opened.open) {
    throw new Red(
      `/#${slug} did not open the scenario it names. The fragment is the whole point of\n  ` +
        `addressing one: a reader who follows that link lands on a closed list.`,
    );
  }
  if (pass.opened.outputVisible || pass.opened.text) {
    throw new Red(
      `the scenario showed output before anything had run: ${JSON.stringify(pass.opened.text)}`,
    );
  }

  for (const [index, run] of pass.runs.entries()) {
    const where = `run ${index + 1}`;

    for (const denial of denials) {
      if (run.text.includes(denial)) {
        throw new Red(
          `${where} reported that the protocol did not hold: the page printed "${denial}".\n` +
            `  The page is telling the truth about a run that failed, which is the harness ` +
            `working — but the\n  run failed.`,
        );
      }
    }

    checkRun(run, where);
  }

  checkRuns?.(pass.runs);

  /*
   * The two runs, against each other. This is what a page cannot fake: the
   * fixed strings are identical because both runs asked the same SDK, and one
   * value differs because each run boots its own devices with their own keys. A
   * page with the output typed into it gets the first right and the second
   * wrong.
   */
  const ids = pass.runs.map(divergence.of);
  if (ids.some((id) => id === null)) {
    throw new Red(
      `a run printed no ${divergence.what} (${ids.map(String).join(', ')}), so the two runs ` +
        `cannot be\n  told apart and this pass cannot say whether the page ran the SDK or ` +
        `replayed a recording.\n  It does not mean no device booted: the scenario got far enough ` +
        `to print ` +
        `${pass.runs.map((run) => run.logLines.length).join(' and ')} log record(s). The likelier ` +
        `reading is\n  that the run failed before that value existed, or that the SDK stopped ` +
        `reporting it.`,
    );
  }
  if (ids[0] === ids[1]) {
    throw new Red(
      `both runs reported ${divergence.what} ${ids[0]}. Every press boots fresh devices with ` +
        `fresh keys,\n  so a repeated value means the page is printing a recording rather than ` +
        `running the SDK.`,
    );
  }
  if (pass.runs[0].text === pass.runs[1].text) {
    throw new Red(
      'both runs printed byte-for-byte the same output, which no two live runs of this scenario do',
    );
  }

  /* The sentences a scenario sends are fixed and live in its module, so they
     are on the page as source before they are ever encrypted. What must not
     happen is one of them leaving in a request. */
  const carried = leaks(pass.requests, (value) => findAny(value, secrets));
  if (carried.length) {
    throw new Red(
      `the scenario's sentence left the page in ${carried.length} request(s):\n  ` +
        carried.join('\n  '),
    );
  }

  const offOrigin = pass.requests.filter(
    (request) => /^https?:/i.test(request.url) && new URL(request.url).origin !== origin,
  );
  if (offOrigin.length) {
    throw new Red(
      `the page talked to ${offOrigin.length} host(s) that are not this site:\n  ` +
        offOrigin.map((request) => `${request.method} ${request.url}`).join('\n  '),
    );
  }

  const beacons = beaconsIn(pass.requests);
  const sent = pass.requests.filter((request) => {
    if (request.method === 'GET') return false;
    try {
      return new URL(request.url).pathname !== BEACON_PATH;
    } catch {
      return true;
    }
  });
  if (sent.length) {
    throw new Red(
      `the page posted to ${sent.length} destination(s) other than ${BEACON_PATH}:\n  ` +
        sent.map((request) => `${request.method} ${request.url}`).join('\n  '),
    );
  }

  for (const beacon of beacons) {
    const body = beacon.postData ?? '';
    const shape = BEACON_SHAPE.exec(body);
    if (!shape) {
      throw new Red(`a beacon body is not the collector's wire format: ${JSON.stringify(body)}`);
    }
    if (!EVENTS.has(shape[1])) {
      throw new Red(
        `the page sent "${shape[1]}", which src/workers/site.ts does not accept — the collector ` +
          `drops it,\n  so the page is measuring nothing while looking like it is`,
      );
    }
  }
  if (beacons.length !== 1) {
    throw new Red(
      `the page sent ${beacons.length} beacon(s) for one scenario opened once and run twice:\n  ` +
        (beacons.map((beacon) => JSON.stringify(beacon.postData)).join('\n  ') || '(none)') +
        `\n  It is one per scenario per page — not per run, and not per toggle.`,
    );
  }
  if (beacons[0].postData !== scenarioBeaconBody(slug)) {
    throw new Red(
      `the scenario's beacon reads ${JSON.stringify(beacons[0].postData)}, not ` +
        `${JSON.stringify(scenarioBeaconBody(slug))}.\n  It has grown a dimension, and everything ` +
        `this page has to derive one from is a fact about a protocol\n  failure the reader ran — ` +
        `the error code, the byte position, the milliseconds. None of those may leave the tab.`,
    );
  }

  /* Invariant 7 again, on the page that has the most to gain from breaking it:
     the SDK is 713 KB and every scenario needs it. */
  if (pass.bytesBefore > PRE_INTERACTION_CEILING) {
    throw new Red(
      `${kb(pass.bytesBefore)} of JavaScript arrived on the page before the reader ran anything, ` +
        `over the ${kb(PRE_INTERACTION_CEILING)} tripwire:\n  ` +
        pass.before.map((s) => `${s.url} (${s.bytes} B)`).join('\n  '),
    );
  }
  if (pass.after.length === 0) {
    throw new Red(
      'running the scenario fetched no chunk at all — the SDK was already on the page before the ' +
        'reader asked for it',
    );
  }
  if (pass.pageErrors.length) {
    throw new Red(`the page threw while running the scenario:\n  ${pass.pageErrors.join('\n  ')}`);
  }
  if (pass.cspViolations.length) {
    throw new Red(
      `the page violated the site's own CSP ${pass.cspViolations.length} time(s):\n  ` +
        pass.cspViolations.join('\n  '),
    );
  }

  return { beacons, ids };
}

/* What `flip-a-byte` has to have printed, held against the same scenario run in
   this process. */
function flipExpectation(refusal) {
  return {
    slug: FLIP_SLUG,
    secrets: [refusal.sentence],
    denials: FLIP_DENIALS,
    divergence: { what: 'sending identity key fingerprint', of: fingerprintIn },
    checkRun(run, where) {
      /* The SDK's error surface, which is the reason this page exists. Both the
         code and the message, because the code alone is a constant a page could
         hold and the message is what the SDK actually said. */
      for (const [what, value] of [
        ['error code', refusal.errorCode],
        ['error message', refusal.errorMessage],
      ]) {
        if (!run.text.includes(value)) {
          throw new Red(
            `${where} never printed the SDK's ${what}. The same scenario run in this process ` +
              `against\n  the installed package reported ${JSON.stringify(value)}, and the page ` +
              `printed:\n  ${run.text.slice(0, 400) || '(nothing)'}`,
          );
        }
      }

      /* And in the log pane, not only in the summary. The summary is this
         page's prose about the run; the log is the SDK's own records, and a
         page that printed the right sentence over an empty log would be
         describing a failure rather than showing one. */
      const named = run.logLines.filter(
        (row) => row.text.includes(refusal.errorCode) && row.text.includes(refusal.errorMessage),
      );
      if (named.length === 0) {
        throw new Red(
          `${where} printed the refusal in its summary and no log record carrying it. The pane ` +
            `is headed\n  "What the SDK said", so it has to be what the SDK said: ` +
            `${run.logLines.length} record(s) shown.`,
        );
      }

      /* Invariant: the scenario's two named non-events are on screen. They are
         the half of the story a log does not tell, and the task they came from
         names them. */
      for (const promised of ['No garbage plaintext', 'No silent drop']) {
        if (!run.nots.some((text) => text.startsWith(promised))) {
          throw new Red(
            `${where} did not say "${promised}". Naming what did not happen is the point of the ` +
              `scenario;\n  printed: ${run.nots.join(' | ') || '(nothing)'}`,
          );
        }
      }

      if (!run.steps.some((text) => text.includes('One byte changed on the way into the relay'))) {
        throw new Red(`${where} printed no step saying which byte was changed`);
      }
      if (!run.steps.some((text) => text.includes('the resend arrived intact'))) {
        throw new Red(
          `${where} never showed the recovery. Refusing is half the story; the sentence arriving ` +
            `on the\n  resend is what makes it a protocol rather than a wall.`,
        );
      }
    },
  };
}

/*
 * The same for `add-a-second-device`, whose subject is an absence.
 *
 * The check that matters reads the per-device panes rather than the page's
 * text, and it runs in both directions: the sentence sent before the link is on
 * the device that was there and not on the device that was not, and the
 * sentence sent after is on both. Every one of those four facts is what the
 * installed SDK did in this process a moment earlier.
 */
function secondDeviceExpectation(expected) {
  const devices = (value) => new RegExp(`\\b${value} devices?\\b`);

  return {
    slug: SECOND_DEVICE_SLUG,
    secrets: [expected.before.text, expected.after.text],
    denials: SECOND_DEVICE_DENIALS,
    divergence: { what: 'provisioning key', of: qrKeyIn },
    checkRun(run, where) {
      /* The SDK's own fan-out figures, in the steps that carry each sentence.
         These are the numbers the scenario is an argument about, so a page that
         printed the sentences without them would be telling the story with the
         evidence removed. */
      for (const [what, message] of [
        ['before the link', expected.before],
        ['after the link', expected.after],
      ]) {
        const step = run.steps.find((text) => text.includes(message.text));
        if (!step) {
          throw new Red(
            `${where} printed no step for the message sent ${what}. Steps printed:\n  ` +
              (run.steps.join('\n  ') || '(none)'),
          );
        }
        if (!devices(message.recipientDeviceCount).test(step)) {
          throw new Red(
            `${where} said the message sent ${what} went to a different number of devices than ` +
              `the SDK did.\n  This process saw ${message.recipientDeviceCount}; the page ` +
              `printed: ${JSON.stringify(step)}`,
          );
        }
      }

      /* Both scroll-backs, compared to the ones the SDK produced here. This is
         the assertion the whole scenario exists for. */
      if (run.devices.length !== 2) {
        throw new Red(
          `${where} printed ${run.devices.length} device scroll-back(s), not 2. The scenario is ` +
            `a comparison;\n  one column is not one.`,
        );
      }
      const linked = run.devices.find(
        (device) => device.deviceId === String(expected.linked.deviceId),
      );
      const primary = run.devices.find(
        (device) => device.deviceId !== String(expected.linked.deviceId),
      );
      if (!linked || !primary) {
        throw new Red(
          `${where} printed no pane for the device the relay linked as ` +
            `${expected.linked.deviceId}; panes are for device(s) ` +
            `${run.devices.map((device) => device.deviceId).join(', ') || 'none'}`,
        );
      }
      if (linked.messages.includes(expected.before.text)) {
        throw new Red(
          `${where} showed the message sent before the link on the device that was linked after ` +
            `it.\n  The SDK did not deliver it there in this process, so the page is printing ` +
            `something it was not given:\n  ${JSON.stringify(linked.messages)}`,
        );
      }
      if (!primary.messages.includes(expected.before.text)) {
        throw new Red(
          `${where} showed the message sent before the link on neither device, so "the new ` +
            `device does not have it"\n  is not about linking. Device ${primary.deviceId} ` +
            `printed: ${JSON.stringify(primary.messages)}`,
        );
      }
      for (const device of [primary, linked]) {
        if (!device.messages.includes(expected.after.text)) {
          throw new Red(
            `${where} did not show the message sent after the link on device ` +
              `${device.deviceId}, which the page itself said it was encrypted to.\n  That pane ` +
              `printed: ${JSON.stringify(device.messages)}`,
          );
        }
      }
      if (JSON.stringify(linked.messages) !== JSON.stringify(expected.linkedMessages)) {
        throw new Red(
          `${where} printed a different scroll-back for the linked device than the SDK produced ` +
            `in this process.\n  here: ${JSON.stringify(expected.linkedMessages)}\n  page: ` +
            `${JSON.stringify(linked.messages)}`,
        );
      }

      /* And the reason, in the page's own words. The scenario is only worth
         shipping if a reader is told that the absence is arithmetic rather than
         a gap someone means to close. */
      for (const promised of ['No history followed the device', 'No back-fill']) {
        if (!run.nots.some((text) => text.startsWith(promised))) {
          throw new Red(
            `${where} did not say "${promised}". Naming what did not happen is the point of the ` +
              `scenario;\n  printed: ${run.nots.join(' | ') || '(nothing)'}`,
          );
        }
      }
      if (!run.nots.some((text) => text.includes('did not exist when that message was encrypted'))) {
        throw new Red(
          `${where} said the message is missing and never said why. Without the arithmetic — the ` +
            `device's keys\n  did not exist when the message was encrypted — the page reads as ` +
            `an apology for a limitation.`,
        );
      }
    },
  };
}

/*
 * The same for `run-out-of-prekeys`, whose subject is a silence.
 *
 * The page is held to the SDK's own words for the fallback, to the bundle the
 * relay published, and to the two sentences it is only allowed to print when
 * the run earned them. The citation is checked as well: it is the one claim in
 * the output that this run did not produce, which is exactly why it must not be
 * quietly droppable.
 */
function preKeysExpectation(expected) {
  return {
    slug: PREKEY_SLUG,
    secrets: [expected.firstSentence, expected.sentence],
    denials: PREKEY_DENIALS,
    divergence: { what: 'last-resort prekey', of: lastResortIn },
    checkRun(run, where) {
      /* The SDK's own account of the handshake, in the page's steps. Both
         fields, because "last-resort" alone is a string the page could hold
         and `usedOneTimePreKey false` is the SDK conceding the other half. */
      for (const value of [expected.fallback.usedKemPreKeyType, 'usedOneTimePreKey false']) {
        if (!run.text.includes(value)) {
          throw new Red(
            `${where} never printed ${JSON.stringify(value)}. The same scenario run in this ` +
              `process against\n  the installed package reported it, and the page printed:\n  ` +
              `${run.text.slice(0, 400) || '(nothing)'}`,
          );
        }
      }

      /* The counts, which are the before and after the whole scenario turns
         on. A page that printed the fallback without them would be asserting
         the stash ran out rather than showing it — and the numbers themselves
         are checked, not just their presence, because "99 and 99 left to give"
         beside a bundle with nothing in it is the one arrangement of this
         scenario's own figures that contradicts the rest of it. */
      const left = `${expected.exhausted.ec} and ${expected.exhausted.kem} left to give`;
      if (!run.steps.some((text) => text.includes(left))) {
        throw new Red(
          `${where} printed no step saying "${left}" — what the relay actually had when it ` +
            `published\n  the empty bundle, as the same scenario reported it in this process.\n  ` +
            `Steps printed:\n  ${run.steps.join('\n  ') || '(none)'}`,
        );
      }

      /* The two named non-events. The first is the scenario's whole finding;
         the second is the answer to the question a reader asks immediately
         afterwards, and leaving it out would imply the SDK has a health call
         that covers this. */
      /* The page's silence line has to carry what the SDK did say, for the
         reason the expectation above spells out: "no warning" beside a count
         of breadcrumbs naming the fallback is a finding, and on its own it is
         a sentence about an empty array. */
      if (!run.nots.some((text) => /name the last-resort fallback outright/.test(text))) {
        throw new Red(
          `${where} said the SDK gave no warning without saying what it gave instead. The ` +
            `breadcrumbs naming\n  the fallback are what make the silence evidence rather than ` +
            `an absence of logging.\n  printed: ${run.nots.join(' | ') || '(nothing)'}`,
        );
      }

      for (const promised of ['No warning', 'No signal from the health check']) {
        if (!run.nots.some((text) => text.startsWith(promised))) {
          throw new Red(
            `${where} did not say "${promised}". Naming what did not happen is the point of the ` +
              `scenario;\n  printed: ${run.nots.join(' | ') || '(nothing)'}`,
          );
        }
      }

      /* The measurement, with its source. This page may tell a reader that
         exhaustion happens in production only while it also tells them who
         measured it — an unsourced "13%" is the kind of claim this project has
         a document forbidding. */
      for (const required of ['13% of companion devices', 'arXiv:2511.20252']) {
        if (!run.text.includes(required)) {
          throw new Red(
            `${where} printed the scenario without ${JSON.stringify(required)}. The measurement ` +
              `and its source ship together\n  or neither ships.`,
          );
        }
      }
    },

    /*
     * The finding itself, which only one of the two presses can show.
     *
     * `checkPreKeyStatus()` answers at most once per account every twelve
     * hours, in a map that outlives the client, so the second press in a tab
     * is refused whatever it would have said. Both branches are honest and
     * both are checked above as "No signal from the health check"; only the
     * counted one carries the evidence — a healthy-looking number standing
     * beside a relay holding nothing. Requiring it of every press would red on
     * the throttle; requiring it of neither would let the page stop making its
     * argument and still pass.
     */
    checkRuns(runs) {
      /* `-1` is the SDK declining to answer, not a number of prekeys. A page
         that printed it as a count would be handing a reader a reading the SDK
         refused to give, in the one sentence on the page about whether the
         application can find any of this out. */
      for (const [index, run] of runs.entries()) {
        const negative = run.nots.find((text) => /reported -\d+ remaining/.test(text));
        if (negative) {
          throw new Red(
            `run ${index + 1} printed checkPreKeyStatus()'s refusal as though it were a count of ` +
              `prekeys:\n  ${negative}\n  The SDK returns -1 when it declines to answer, and the ` +
              `page has to say so rather than\n  report it.`,
          );
        }
      }

      const counted = runs.find((run) =>
        run.nots.some((text) => text.includes('remaining and needsReplenishment')),
      );
      if (!counted) {
        throw new Red(
          `neither press printed what checkPreKeyStatus() actually returned, so this pass never ` +
            `showed\n  the SDK's health call reporting good numbers over an empty relay — the ` +
            `half of the scenario\n  a reader cannot infer. Printed:\n  ` +
            `${runs.map((run) => run.nots.join(' | ') || '(nothing)').join('\n  ')}`,
        );
      }

      /* And the number, held against the relay's. The page says the call
         counts local storage rather than the server; a run where the two agree
         means it no longer does, and the sentence beside them is then wrong. */
      const held = String(expected.exhausted.ec);
      if (new RegExp(`reported ${held} remaining`).test(counted.nots.join(' '))) {
        throw new Red(
          `checkPreKeyStatus() reported the same ${held} the relay had left, so it is no longer ` +
            `counting only\n  local storage. The page tells a reader the opposite, in the ` +
            `sentence right beside it. Update both.`,
        );
      }
    },
  };
}

/*
 * The same for `reinstall-a-device`, whose subject is an absence with no name.
 *
 * The other two silence scenarios can be held to something the SDK said. This
 * one has to be held to a list it did not act on, so the page is required to
 * print the registration beside the silence — the count of hooks, the devices
 * they were live on — and required to print the SDK's own noise beside it, so
 * that "nothing reached the application" is read against a logger that was busy
 * rather than against a run where nothing happened at all.
 */
function reinstallExpectation(expected) {
  return {
    slug: REINSTALL_SLUG,
    secrets: expected.sentences,
    denials: REINSTALL_DENIALS,
    divergence: { what: 'safety-number half', of: safetyHalfIn },
    checkRun(run, where) {
      /* The relay's own sentence, quoted rather than paraphrased. The page
         claims a reinstalled device cannot quietly become the account; the
         refusal is the evidence, and a page that summarised it would be asking
         the reader to take the refusal on trust. */
      for (const quoted of [expected.publish.message, expected.publish.cause]) {
        if (!run.text.includes(quoted)) {
          throw new Red(
            `${where} never printed what came back when the rebuilt device tried to publish:\n  ` +
              `${JSON.stringify(quoted)}\n  The same scenario run in this process against the ` +
              `installed package got that sentence back.\n  Both halves ship: the SDK's wrapper ` +
              `alone reads as a network failure, and the relay's reason is\n  what makes it a ` +
              `policy. The page printed:\n  ${run.text.slice(0, 400) || '(nothing)'}`,
          );
        }
      }

      /* The finding, and the registration that makes it one. The count has to
         be on screen: "no event fired" beside a number of hooks that were
         listening is evidence, and on its own it is a sentence about an empty
         array — the same trap the prekey scenario's breadcrumb counts exist to
         avoid. */
      const noEvent = run.nots.find((text) => text.startsWith('No event.'));
      if (!noEvent) {
        throw new Red(
          `${where} did not say "No event." — the finding this scenario exists for. Naming what ` +
            `did not\n  happen is the point; printed: ${run.nots.join(' | ') || '(nothing)'}`,
        );
      }
      const registered = `${expected.hooks.registered.length} hooks`;
      if (!noEvent.includes(registered)) {
        throw new Red(
          `${where} said no event fired without saying how many hooks were listening. The SDK ` +
            `offers ${registered},\n  every one of them was registered by the run in this ` +
            `process, and without that number on screen the\n  page is claiming a silence rather ` +
            `than showing one.\n  printed: ${noEvent}`,
        );
      }
      for (const device of expected.hooks.devices) {
        if (!noEvent.includes(device)) {
          throw new Red(
            `${where} did not name ${JSON.stringify(device)} as a device the hooks were live ` +
              `on. A silence that does not\n  say where it was measured is not evidence.\n  ` +
              `printed: ${noEvent}`,
          );
        }
      }

      /* There is no hook to register, and the page has to say so outright. This
         is the sentence a reader arrives looking for, and the one the plan this
         scenario came from expected to be false. */
      if (!noEvent.includes('no onIdentityChanged to register')) {
        throw new Red(
          `${where} reported the silence without saying that the SDK's hook surface has no entry ` +
            `for this\n  event at all. A reader who has just watched every hook stay quiet will ` +
            `assume they registered the\n  wrong one.\n  printed: ${noEvent}`,
        );
      }

      /* And the counterweight. The page is not allowed to leave a reader with
         "the SDK is silent" when it is not: it is loud in the log and quiet
         everywhere an application is built to look. */
      const notSilent = run.nots.find((text) => text.includes('It is not that the SDK said'));
      if (!notSilent) {
        throw new Red(
          `${where} never said what the SDK did say. Without it the page reads as "the SDK ` +
            `noticed nothing",\n  which is false — it logged ${expected.loud.length} record(s) ` +
            `at warn or error in this process.\n  printed: ${run.nots.join(' | ') || '(nothing)'}`,
        );
      }
      for (const code of expected.codes) {
        if (!notSilent.includes(code)) {
          throw new Red(
            `${where} did not carry ${JSON.stringify(code)}, which the same run in this process ` +
              `logged. That code is\n  what an application would have had to match on to find ` +
              `out, so dropping it drops the point.\n  printed: ${notSilent}`,
          );
        }
      }

      /* And the spread, held to the run the same way the safety-number
         arithmetic below is. Naming the codes is the easy half; what a reader
         acts on is how much of the noise one of them accounts for, and that
         sentence has been rewritten twice into a claim the run contradicts. */
      const spread =
        expected.coded === expected.loud.length
          ? 'one on every record'
          : `${expected.coded} of the ${expected.loud.length} carry one of those and ` +
            `${expected.loud.length - expected.coded} carry none`;
      if (!notSilent.includes(spread)) {
        throw new Red(
          `${where} did not print how the codes are spread across the records. The same run in ` +
            `this process\n  produced "${spread}", and a reader told only which codes exist ` +
            `will grep for one and conclude the\n  rest of the reinstall was quiet.\n  printed: ` +
            `${notSilent}`,
        );
      }

      /* The safety number, in halves, which is the closing argument. Both are
         required: the near half proves the number did not simply regenerate,
         and the far half is the thirty digits a user is asked to re-read. */
      const split = run.recovery.find((text) => text.includes('changed — in half of itself'));
      if (!split) {
        throw new Red(
          `${where} printed no comparison of the safety number before and after. The scenario ` +
            `ends on what a\n  user would be asked to check, and without the halves the page ` +
            `asserts a change rather than\n  showing one.\n  printed: ` +
            `${run.recovery.join(' | ') || '(nothing)'}`,
        );
      }
      const arithmetic =
        `${expected.after.numeric.replace(/ /g, '').length} digits of which ` +
        `${expected.after.remoteHalf.replace(/ /g, '').length} moved`;
      if (!split.includes(arithmetic)) {
        throw new Red(
          `${where} did not print the arithmetic a user is handed — how much of the number they ` +
            `have to re-read.\n  The same scenario run in this process produced "${arithmetic}".` +
            `\n  printed: ${split}`,
        );
      }

      /* The citation, checked for the same reason the prekey scenario's is: it
         is the one claim in this output that the run did not produce. A page
         that tells a reader warning fatigue is the industry's experience owes
         them the source, and an unsourced version of that claim is exactly what
         messaging.md forbids. */
      for (const required of ['TADA', 'Keybase', 'no one bothers']) {
        if (!run.text.includes(required)) {
          throw new Red(
            `${where} printed the scenario without ${JSON.stringify(required)}. The framing and ` +
              `its source ship together\n  or neither ships.`,
          );
        }
      }
    },
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

  const expected = await expectedFields(envelopeFields);
  const refusal = await expectedRefusal();
  const secondDevice = await expectedSecondDevice();
  const preKeys = await expectedPreKeys();
  const reinstall = await expectedReinstall();

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
    checkRoundTrip(live, origin, envelopeFields, expected);

    /* Block every chunk the interaction asked for, so the dynamic import cannot
       resolve however Vite chose to split it. Taking only the first request
       would depend on whether a preload or the chunk itself won the race. */
    const starved = await visit(cdp, origin, held, {
      blocked: live.after.map((script) => script.url),
    });
    checkFallback(starved);

    /* A fresh tab of the homepage per scenario, so the accounting above stays
       about the page a reader lands on and each scenario's egress is about that
       scenario alone. Each is run twice in its tab, which is what the two runs
       are compared against each other for. */
    const flip = await visitScenario(cdp, origin, held, FLIP_SLUG);
    const { beacons: flipBeacons, ids } = checkScenario(flip, origin, flipExpectation(refusal));

    const linking = await visitScenario(cdp, origin, held, SECOND_DEVICE_SLUG);
    const { beacons: linkingBeacons, ids: keys } = checkScenario(
      linking,
      origin,
      secondDeviceExpectation(secondDevice),
    );

    const prekeys = await visitScenario(cdp, origin, held, PREKEY_SLUG);
    const { beacons: prekeyBeacons, ids: lastResorts } = checkScenario(
      prekeys,
      origin,
      preKeysExpectation(preKeys),
    );

    const reinstalled = await visitScenario(cdp, origin, held, REINSTALL_SLUG);
    const { beacons: reinstallBeacons, ids: halves } = checkScenario(
      reinstalled,
      origin,
      reinstallExpectation(reinstall),
    );

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
     * And a third run, long enough for the braid to finish a key.
     *
     * Its own run rather than more sentences on either of the two above. The
     * check before it measures those two against each other, and a run carrying
     * an extra epoch of conversation would be drawing a different message of a
     * different length — so the pair it reads is left exactly as it was.
     *
     * This is the slowest pass here by a wide margin, and the cost is the point:
     * a braid key is produced after a whole epoch of messages and there is no
     * shorter way to reach one.
     */
    const epochStartedAt = Date.now();
    const epoch = await visit(cdp, origin, held, { braid: true, epoch: true });
    const progress = checkBraidProgress(epoch);
    const epochSeconds = ((Date.now() - epochStartedAt) / 1000).toFixed(1);

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
        `  metadata:       ${live.dom.fields.length} fields, exactly the set an envelope built ` +
        `in this process yields less the withheld ones (${live.dom.fields.join(', ')})\n` +
        /* Read off the scene rather than restated from the constants the checks
           compared against, so a line that prints is a line something observed. */
        `  the scene:      finished on "${live.dom.scene.state}", both wheels captioned ` +
        `"${live.dom.scene.a.label}", ${live.dom.scene.a.keys} and ${live.dom.scene.b.keys}, ` +
        `turned ${live.dom.scene.a.turns} and ${live.dom.scene.b.turns} time(s)\n` +
        `  the braid:      the relay held ${JSON.stringify(braid.whole.stored)} with the switch ` +
        `off and ${JSON.stringify(braid.chunked.stored)} with it on, and the column drew that ` +
        `${braid.widest.ratio.toFixed(2)}× wider — ${braid.widest.whole.toFixed(1)} px against ` +
        `${braid.widest.chunked.toFixed(1)} px on <${braid.widest.tag}> at ` +
        `${braid.widest.path || 'the column'}\n` +
        `  the epoch:      ${EPOCH_MESSAGES} alternating messages through a braided session, and ` +
        `the scene reported\n` +
        `                  "${progress.mark}" beside "${progress.figure}" — a completion no ` +
        `measurement of an envelope\n` +
        `                  could produce (${epochSeconds} s)\n` +
        `  before a touch: ${kb(live.bytesBefore)} of script over ${live.before.length} file(s), ` +
        `under the ${kb(PRE_INTERACTION_CEILING)} tripwire (uncompressed — this server does ` +
        `not gzip)\n` +
        `  the touch drew: ${kb(live.bytesAfter)} over ${live.after.length} chunk(s)\n` +
        `  those blocked:  nothing ran, nothing was claimed, and the page said so ` +
        `("${starved.dom.status}")\n` +
        `  scenario:       ${FLIP_SLUG} opened by fragment and run twice; both runs printed ` +
        `${refusal.errorCode}\n` +
        `                  ("${refusal.errorMessage}") in the SDK's own log, and the resend ` +
        `arrived intact\n` +
        `                  sending identity keys ${ids.join(' then ')} — a fresh device pair ` +
        `per run\n` +
        `                  measured ${flipBeacons.length} beacon(s): ` +
        `${flipBeacons.map((beacon) => JSON.stringify(beacon.postData)).join(', ')}\n` +
        `                  before a touch ${kb(flip.bytesBefore)} over ` +
        `${flip.before.length} file(s); the run drew ${kb(flip.bytesAfter)} over ` +
        `${flip.after.length} chunk(s)\n` +
        `  scenario:       ${SECOND_DEVICE_SLUG} opened by fragment and run twice; each run ` +
        `linked a device over\n` +
        `                  the QR handshake and the sender was told ` +
        `${secondDevice.before.recipientDeviceCount} device then ` +
        `${secondDevice.after.recipientDeviceCount}\n` +
        `                  the linked device's scroll-back held ` +
        `${secondDevice.linkedMessages.length} of the ${secondDevice.primaryMessages.length} ` +
        `sentences — not the one sent before it existed\n` +
        `                  provisioning keys ${keys.map((key) => key.slice(0, 12)).join(' then ')} ` +
        `— a fresh link per run\n` +
        `                  measured ${linkingBeacons.length} beacon(s): ` +
        `${linkingBeacons.map((beacon) => JSON.stringify(beacon.postData)).join(', ')}\n` +
        `                  before a touch ${kb(linking.bytesBefore)} over ` +
        `${linking.before.length} file(s); the run drew ${kb(linking.bytesAfter)} over ` +
        `${linking.after.length} chunk(s)\n` +
        `  scenario:       ${PREKEY_SLUG} opened by fragment and run twice; the relay published ` +
        `a bundle with no\n` +
        `                  one-time prekey of either type and ${preKeys.exhausted.ec} left to ` +
        `give, and the SDK called the handshake\n` +
        `                  "${preKeys.fallback.usedKemPreKeyType}" with no record at warn or ` +
        `error\n` +
        `                  checkPreKeyStatus() answered ` +
        `${preKeys.health ? preKeys.health.oneTimePreKeysRemaining : 'nothing'} while the relay ` +
        `held ${preKeys.exhausted.ec}\n` +
        `                  last-resort prekeys ` +
        `${lastResorts.map((key) => key.slice(0, 12)).join(' then ')} — a fresh stash per run\n` +
        `                  measured ${prekeyBeacons.length} beacon(s): ` +
        `${prekeyBeacons.map((beacon) => JSON.stringify(beacon.postData)).join(', ')}\n` +
        `                  before a touch ${kb(prekeys.bytesBefore)} over ` +
        `${prekeys.before.length} file(s); the run drew ${kb(prekeys.bytesAfter)} over ` +
        `${prekeys.after.length} chunk(s)\n` +
        `  scenario:       ${REINSTALL_SLUG} opened by fragment and run twice; the receiving ` +
        `device was rebuilt on\n` +
        `                  empty storage and the relay refused it — the SDK reported ` +
        `"${reinstall.publish.message}"\n` +
        `                  over the relay's "${reinstall.publish.cause}" — and of the\n` +
        `                  ${reinstall.hooks.registered.length} hooks the SDK offers — all ` +
        `registered on ${reinstall.hooks.devices.join(' and ')} — none fired\n` +
        `                  the SDK logged ${reinstall.loud.length} record(s) at warn or error ` +
        `(${reinstall.codes.join(', ') || 'no code'}), all of it to the logger\n` +
        `                  far safety-number halves ${halves.join(' then ')} — a fresh identity ` +
        `per run\n` +
        `                  measured ${reinstallBeacons.length} beacon(s): ` +
        `${reinstallBeacons.map((beacon) => JSON.stringify(beacon.postData)).join(', ')}\n` +
        `                  before a touch ${kb(reinstalled.bytesBefore)} over ` +
        `${reinstalled.before.length} file(s); the run drew ${kb(reinstalled.bytesAfter)} over ` +
        `${reinstalled.after.length} chunk(s)`,
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
