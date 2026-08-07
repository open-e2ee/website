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
const PANEL = '[data-demo="live-carrier-panel"]';
const INPUT = '[data-demo-input]';
const SEND = '[data-demo-send]';
const DECRYPTED = '[data-demo-decrypted]';
const RECORDED = '[data-demo-recorded]';
const META = '[data-demo-meta]';
const CLAIM = '[data-demo-claim]';
const FALLBACK = '[data-demo-fallback-note]';

/*
 * `/demo`'s contract, on the same terms. A scenario is addressed by its slug
 * rather than by position: a second scenario landing on the page must not
 * silently move what this drives.
 *
 * The slug is a parameter rather than a constant because `/demo` now ships two
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

/*
 * The two-tab section's contract, which is not a scenario's.
 *
 * It has no slug, no fragment and no run: it is two windows holding one
 * conversation, so the harness drives two tabs at once and the thing being
 * checked is what each of them sees of the other. The role, the account and
 * the peer are exposed as data because the harness has to know which tab it is
 * looking at, and reading that out of the section's prose would make a copy
 * edit a red run.
 */
const TWO_TAB_CONNECT = '[data-two-tab-connect]';
const TWO_TAB_STATUS = '[data-two-tab-status]';
const TWO_TAB_OUTPUT = '[data-two-tab-output]';
const TWO_TAB_INPUT = '[data-two-tab-input]';
const TWO_TAB_SEND = '[data-two-tab-send]';
const TWO_TAB_LINE = '[data-two-tab-line]';
const TWO_TAB_ROW = '[data-two-tab-row]';
const TWO_TAB_DISCONNECT = '[data-two-tab-disconnect]';

/* The beacon `/demo` is allowed to send, in full. Same reasoning as
   `DEMO_RUN_BODY`: the body is fixed before the browser starts, so a dimension
   derived from the run — a timing, a byte count, an error code — is a failure
   rather than something to be searched for. */
const scenarioBeaconBody = (slug) => `scenario_opened /demo ${slug}`;

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

/* One sentence per direction through the two-tab section, so the check covers
   both halves of it: the tab holding the relay sends over its own copy, and
   the tab without one sends over the channel and back. A section that only
   ever worked outward would pass a one-way test. */
const TAB_PROBE = `First tab ${NONCE}: the relay is holding this one.`;
const TAB_REPLY = `Second tab ${NONCE}: answered from the other window.`;

const DECRYPT_TIMEOUT_MS = 30000;
const LOAD_TIMEOUT_MS = 30000;

/* A fixed viewport, so what the page chooses to fetch before the reader touches
   anything is the same on every machine that runs this. */
const VIEWPORT = { width: 1280, height: 800 };

/*
 * Every script a page fetches before the reader asks for the SDK, which on
 * 2026-08-07 was 15.7 KB over six files on the homepage and 13.5 KB over five
 * on `/demo` — the theme and measurement scripts, each page's own script, and
 * a shared preload helper Vite splits out because two pages now import
 * dynamically. The interaction then pulls about 1790 KB, so the tripwire sits
 * two orders of magnitude below any build that has the SDK on its initial path.
 *
 * `/demo` has 6.5 KB left, and it stopped being the page under pressure during
 * LD6. It had 2.0 KB left with two scenarios, because every scenario's
 * renderer — about four kilobytes of prose apiece — sat in the page's own
 * `<script>` and therefore on its initial path. The third scenario went 2.1 KB
 * over this tripwire and the prose was what tripped it. The renderers now live
 * in `src/lib/demo/render.ts`, fetched by the same press that fetches the
 * scenario, which is where code that cannot run until a reader presses the
 * button belongs. Measured on the same machine across that move and the
 * scenario after it: `/demo` was 18.0 KB over five files with two scenarios,
 * 13.1 KB over five with three, and is 13.5 KB over five with four.
 *
 * The fourth scenario's 0.4 KB is the whole of what a scenario now costs this
 * page: one entry in the `PROGRAMS` map in `demo.astro`, which is two dynamic
 * `import()` specifiers and a status line. Its prose, its runner and its
 * renderer are all behind the press. That is the shape the LD6 move was for,
 * and it is what makes the remaining 6.5 KB a budget for roughly a dozen more
 * scenarios rather than for two.
 *
 * These are wire bytes without compression: `chrome-harness.mjs` serves the
 * build as it is on disk, while Cloudflare compresses. So this is not
 * invariant 7's budget, which is 10 KB gzip and is a *delta* — it needs a build
 * without the demo to compare against, and is measured in the proof rather than
 * here. This is the tripwire for the SDK arriving uninvited.
 *
 * The proof's table reports `/demo` lower — 14.7 KB before LD6 and 9.7 KB
 * after — and both are right beside the figures above: it walks the module
 * graph on disk, while this counts what Chrome actually fetched, which includes
 * responses the static walk does not model. The ceiling is set against the
 * figure measured here.
 */
const PRE_INTERACTION_CEILING = 20 * 1024;

/*
 * A floor on the expected set, not on what the page printed.
 *
 * The expectation itself is computed per run (see `expectedFields`), so this
 * number is only here to catch the expectation collapsing: an `Envelope` that
 * suddenly declares two fields would make an equality check trivially
 * satisfiable, and a harness that passes because it expected nothing is worse
 * than no harness. Ten is what the installed alpha.10 produces.
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
  const found = findAny(haystack, [PROBE, REPEAT_PROBE, TAB_PROBE, TAB_REPLY]);
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
  const extra = context();
  throw new Red(extra.length ? `${describe}\n${extra.join('\n')}` : describe);
}

const present = (selector) => `Boolean(document.querySelector(${JSON.stringify(selector)}))`;

/*
 * Everything the checks need to read off the panel, in one round trip so that
 * no two assertions can disagree about which moment they are describing.
 *
 * `hidden` alone would not answer the question the invariants ask. A panel
 * displayed away in CSS is as gone to a reader as one with the attribute set,
 * and the recorded capture staying on screen is the thing being proved.
 */
const SNAPSHOT = `(() => {
  const panel = document.querySelector(${JSON.stringify(PANEL)});
  const visible = (element) => Boolean(element) && !element.hidden && element.offsetParent !== null;
  const text = (selector) => panel.querySelector(selector)?.textContent?.trim() ?? '';
  return {
    decrypted: text(${JSON.stringify(DECRYPTED)}),
    fallbackNote: text(${JSON.stringify(FALLBACK)}),
    fields: [...panel.querySelectorAll(${JSON.stringify(META)} + ' dt')].map((dt) => dt.textContent),
    values: [...panel.querySelectorAll(${JSON.stringify(META)} + ' dd')].map((dd) => dd.textContent),
    recordedVisible: visible(panel.querySelector(${JSON.stringify(RECORDED)})),
    claimVisible: visible(panel.querySelector(${JSON.stringify(CLAIM)})),
  };
})()`;

/*
 * Everything `/demo` printed about the scenario it just ran.
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
 * Load the homepage in a fresh tab, type the probe, press send, and report
 * everything the browser did.
 */
async function visit(cdp, origin, held, { blocked = [], repeat = false } = {}) {
  const tab = await openTab(cdp, held, { blocked });
  const { sessionId, requests, scripts, cspViolations, pageErrors, blockedRequests, quiet } = tab;

  try {
    await tab.navigate(`${origin}/`, 'the homepage');

    /* Serving the built site at all is the infrastructure check. If the
       homepage did not render, nothing below would mean anything. */
    const title = await evaluate(cdp, sessionId, 'document.title');
    if (!title) throw new Infra('the homepage rendered no title — the served build looks wrong');

    if (!(await evaluate(cdp, sessionId, present(PANEL)))) {
      throw new Red(
        `no live demo panel on the homepage: nothing matches ${PANEL}.\n` +
          `  The site served and rendered correctly (title: ${JSON.stringify(title)}), so this is\n` +
          `  the demo being absent rather than the harness failing to reach it.`,
      );
    }
    for (const [selector, what] of [
      [INPUT, 'a text input for the reader’s sentence'],
      [SEND, 'a control that sends it'],
      [DECRYPTED, 'a pane that shows the decrypted result'],
      [RECORDED, 'the recorded capture it falls back to'],
    ]) {
      if (!(await evaluate(cdp, sessionId, present(selector)))) {
        throw new Red(`the demo panel is present but exposes no ${what} (${selector})`);
      }
    }

    /* The demo's own claim must not be on screen before there is anything to
       claim. It says a round trip "ran in this tab", which is false until one
       has. */
    const beforeInteraction = await evaluate(cdp, sessionId, SNAPSHOT);

    await quiet(IDLE_QUIET_MS, IDLE_MAX_MS);
    const interactedAt = Date.now();

    /* Type as a reader would: focus the field, insert text so the demo's own
       input handlers run, then press its send control. Focus is also the
       demo's load trigger, which is why it has to happen after the byte
       accounting boundary rather than during setup.

       Blamed on the demo for the same reason as the click: the elements were
       there a moment ago, so if they are gone now the demo's own script moved
       them, and a demo that re-renders its panel out from under the reader is
       not an infrastructure fault. */
    await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(INPUT)}).focus()`, 'demo');
    await cdp.send('Input.insertText', { text: PROBE }, sessionId);
    await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(SEND)}).click()`, 'demo');

    /* Either outcome ends the wait. Which one was supposed to happen is the
       caller's business: this pass is the same interaction in both passes, and
       only the blocklist differs. */
    await waitFor(
      cdp,
      sessionId,
      `(() => {
         const panel = document.querySelector(${JSON.stringify(PANEL)});
         const decrypted = panel.querySelector(${JSON.stringify(DECRYPTED)})?.textContent ?? '';
         const note = panel.querySelector(${JSON.stringify(FALLBACK)})?.textContent ?? '';
         return decrypted.length > 0 || note.length > 0;
       })()`,
      DECRYPT_TIMEOUT_MS,
      `the demo neither decrypted the typed sentence nor reported a failure within ` +
        `${DECRYPT_TIMEOUT_MS} ms`,
      () => {
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
      },
    );

    /* Read the panel before touching it again, so the assertions about the
       first sentence are about the moment the first sentence landed. */
    const afterFirst = await evaluate(cdp, sessionId, SNAPSHOT);

    if (repeat) {
      /* Clearing the field by hand rather than selecting and overtyping: the
         panel reads `input.value` when send is pressed and nothing else, so
         this is the same thing a reader does and two fewer CDP round trips. */
      await evaluate(
        cdp,
        sessionId,
        `(() => {
           const input = document.querySelector(${JSON.stringify(INPUT)});
           input.focus();
           input.value = '';
         })()`,
        'demo',
      );
      await cdp.send('Input.insertText', { text: REPEAT_PROBE }, sessionId);
      await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(SEND)}).click()`, 'demo');
      await waitFor(
        cdp,
        sessionId,
        `(() => {
           const panel = document.querySelector(${JSON.stringify(PANEL)});
           const decrypted = panel.querySelector(${JSON.stringify(DECRYPTED)})?.textContent ?? '';
           const note = panel.querySelector(${JSON.stringify(FALLBACK)})?.textContent ?? '';
           return decrypted.includes(${JSON.stringify(REPEAT_PROBE)}) || note.length > 0;
         })()`,
        DECRYPT_TIMEOUT_MS,
        `the demo returned the first sentence and then never returned the second within ` +
          `${DECRYPT_TIMEOUT_MS} ms — the repeat send is a warm session, not a cold one`,
      );
    }

    const wentQuiet = await quiet(EGRESS_QUIET_MS, EGRESS_SETTLE_MAX_MS);
    const dom = await evaluate(cdp, sessionId, SNAPSHOT);

    await tab.fillPostData();

    /* A script *requested* before the interaction was requested without one,
       whenever it happened to finish arriving. */
    const before = scripts.filter((script) => script.at < interactedAt);
    const after = scripts.filter((script) => script.at >= interactedAt);
    return {
      beforeInteraction,
      afterFirst,
      dom,
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
 * Open `/demo` at the scenario's own fragment, run it twice, and report both
 * runs plus everything the browser did across them.
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
    /* The fragment, not the bare path: arriving at `/demo#<slug>` is a reader
       asking for this scenario by name, and opening it is what the page
       promises to do about that. */
    await tab.navigate(`${origin}/demo#${slug}`, `/demo#${slug}`);

    const title = await evaluate(cdp, sessionId, 'document.title');
    if (!title) throw new Infra('/demo rendered no title — the served build looks wrong');

    if (!(await evaluate(cdp, sessionId, present(SCENARIO)))) {
      throw new Red(
        `no scenario on /demo: nothing matches ${SCENARIO}.\n` +
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

/*
 * What one tab of the two-tab section can see, including which tab it is.
 *
 * The rows are read as field/value pairs rather than as text, because the
 * check they exist for is about a particular field: the pane must be printing
 * a stored envelope, and the ciphertext in it must not be the sentence. Text
 * scraped out of the whole pane would let a row that had stopped printing
 * `ciphertext` at all go on passing a search for the absence of something.
 */
const TWO_TAB_SNAPSHOT = `(() => {
  const output = document.querySelector(${JSON.stringify(TWO_TAB_OUTPUT)});
  const rows = [...(output?.querySelectorAll(${JSON.stringify(TWO_TAB_ROW)}) ?? [])].map((row) => {
    const fields = {};
    const terms = [...row.querySelectorAll('dt')];
    const values = [...row.querySelectorAll('dd')];
    terms.forEach((term, index) => {
      fields[term.textContent] = values[index]?.textContent ?? '';
    });
    return fields;
  });
  return {
    status: document.querySelector(${JSON.stringify(TWO_TAB_STATUS)})?.textContent ?? '',
    connected: Boolean(output) && !output.hidden,
    role: output?.dataset.twoTabRole ?? null,
    me: output?.dataset.twoTabMe ?? null,
    peer: output?.dataset.twoTabPeer ?? null,
    lines: [...(output?.querySelectorAll(${JSON.stringify(TWO_TAB_LINE)}) ?? [])].map(
      (line) => line.textContent.replace(/\\s+/g, ' ').trim(),
    ),
    stopped: output ? 'twoTabStopped' in output.dataset : false,
    rows,
  };
})()`;

/** True once the connect press has settled, whichever way it went. */
const TWO_TAB_SETTLED = `(() => {
  const button = document.querySelector(${JSON.stringify(TWO_TAB_CONNECT)});
  const output = document.querySelector(${JSON.stringify(TWO_TAB_OUTPUT)});
  return Boolean(output) && (!output.hidden || (Boolean(button) && !button.disabled));
})()`;

const sawLine = (text) =>
  `[...document.querySelectorAll(${JSON.stringify(TWO_TAB_LINE)})].some((line) =>
     line.textContent.includes(${JSON.stringify(text)}))`;

/** True once the disconnect press has settled, whichever way it went. */
const TWO_TAB_STOP_SETTLED = `(() => {
  const output = document.querySelector(${JSON.stringify(TWO_TAB_OUTPUT)});
  const status = document.querySelector(${JSON.stringify(TWO_TAB_STATUS)});
  if (!output) return false;
  return 'twoTabStopped' in output.dataset ||
    Boolean(status && status.textContent.includes('could not close cleanly'));
})()`;

/**
 * Two tabs of `/demo`, one conversation, driven the way a reader would.
 *
 * Sequential rather than simultaneous, which is the whole reason this reads as
 * cleanly as it does: the relay is claimed with a Web Lock, so whichever tab
 * presses first holds it. Pressing both at once would still work and would
 * make the roles a coin toss, and a check that has to accept either answer
 * cannot say the second tab went through the first one.
 */
async function visitTwoTabs(cdp, origin, held) {
  const tabs = [
    { tab: await openTab(cdp, held), what: 'the first tab' },
    { tab: await openTab(cdp, held), what: 'the second tab' },
  ];
  const [first, second] = tabs.map((entry) => entry.tab);
  const read = (tab) => evaluate(cdp, tab.sessionId, TWO_TAB_SNAPSHOT);

  /* Whatever the page reported about itself, on the failure path, so a red run
     names the browser's complaint rather than only the wait that expired. */
  const complaints = (tab) => () => {
    const lines = [];
    if (tab.cspViolations.length) {
      lines.push(
        `  The page reported ${tab.cspViolations.length} CSP violation(s):`,
        ...tab.cspViolations.map((violation) => `    ${violation}`),
      );
    }
    if (tab.pageErrors.length) {
      lines.push(
        `  The page threw ${tab.pageErrors.length} uncaught error(s):`,
        ...tab.pageErrors.map((error) => `    ${error.split('\n')[0]}`),
      );
    }
    return lines;
  };

  const type = async (tab, text) => {
    await evaluate(
      cdp,
      tab.sessionId,
      `document.querySelector(${JSON.stringify(TWO_TAB_INPUT)}).focus()`,
      'demo',
    );
    await cdp.send('Input.insertText', { text }, tab.sessionId);
    await evaluate(
      cdp,
      tab.sessionId,
      `document.querySelector(${JSON.stringify(TWO_TAB_SEND)}).click()`,
      'demo',
    );
  };

  try {
    for (const { tab, what } of tabs) {
      await tab.navigate(`${origin}/demo`, `/demo in ${what}`);
      const title = await evaluate(cdp, tab.sessionId, 'document.title');
      if (!title) throw new Infra(`/demo rendered no title in ${what} — the build looks wrong`);
      for (const [selector, describe] of [
        [TWO_TAB_CONNECT, 'a control that connects it'],
        [TWO_TAB_STATUS, 'a status line'],
        [TWO_TAB_OUTPUT, 'a pane for the conversation'],
      ]) {
        if (!(await evaluate(cdp, tab.sessionId, present(selector)))) {
          throw new Red(
            `the two-tab section on /demo exposes no ${describe} (${selector}) in ${what}`,
          );
        }
      }
    }

    /* The accounting boundary, on the tab whose bytes are reported. Nothing
       either tab fetched before this moment can have been the section's. */
    await first.quiet(IDLE_QUIET_MS, IDLE_MAX_MS);
    await second.quiet(IDLE_QUIET_MS, IDLE_MAX_MS);
    const interactedAt = Date.now();

    const connected = [];
    for (const { tab, what } of tabs) {
      await evaluate(
        cdp,
        tab.sessionId,
        `document.querySelector(${JSON.stringify(TWO_TAB_CONNECT)}).click()`,
        'demo',
      );
      await waitFor(
        cdp,
        tab.sessionId,
        TWO_TAB_SETTLED,
        SCENARIO_TIMEOUT_MS,
        `${what} neither connected nor reported a failure within ${SCENARIO_TIMEOUT_MS} ms`,
        complaints(tab),
      );
      const state = await read(tab);
      if (!state.connected) {
        throw new Red(
          `${what} could not join the two-tab section.\n` +
            `  Its own status line reads: ${JSON.stringify(state.status)}`,
        );
      }
      connected.push(state);
    }

    await type(first, TAB_PROBE);
    await waitFor(
      cdp,
      second.sessionId,
      sawLine(TAB_PROBE),
      SCENARIO_TIMEOUT_MS,
      `the second tab never showed the sentence the first tab sent, within ` +
        `${SCENARIO_TIMEOUT_MS} ms`,
      complaints(second),
    );

    await type(second, TAB_REPLY);
    await waitFor(
      cdp,
      first.sessionId,
      sawLine(TAB_REPLY),
      SCENARIO_TIMEOUT_MS,
      `the first tab never showed the sentence the second tab sent back, within ` +
        `${SCENARIO_TIMEOUT_MS} ms`,
      complaints(first),
    );

    const wentQuiet = (await first.quiet(EGRESS_QUIET_MS, EGRESS_SETTLE_MAX_MS)) &&
      (await second.quiet(EGRESS_QUIET_MS, EGRESS_SETTLE_MAX_MS));
    for (const { tab } of tabs) await tab.fillPostData();

    const before = first.scripts.filter((script) => script.at < interactedAt);
    const after = first.scripts.filter((script) => script.at >= interactedAt);
    const ended = [await read(first), await read(second)];

    /*
     * Both tabs leave, and both have to manage it.
     *
     * This is the only place anything on this site calls `stop()`, and it is
     * the one call that catches a relay whose `subscribe()` or
     * `subscribeRetryRequests()` returned a promise instead of a function:
     * every send, every delivery and every decryption works, and teardown
     * throws `this.relayUnsubscribe is not a function`. A round trip on its
     * own would have passed the whole way through that.
     *
     * The guest goes first. The host holds the relay, so stopping it first
     * would strand the other tab and the failure would be about ordering here
     * rather than about the page.
     */
    const stopped = [];
    for (const [tab, what] of [
      [second, 'the second tab'],
      [first, 'the first tab'],
    ]) {
      if (!(await evaluate(cdp, tab.sessionId, present(TWO_TAB_DISCONNECT)))) {
        throw new Red(
          `${what} offers no way to disconnect (${TWO_TAB_DISCONNECT}), so nothing on this ` +
            `site ever calls stop() and a teardown fault would ship unseen`,
        );
      }
      await evaluate(
        cdp,
        tab.sessionId,
        `document.querySelector(${JSON.stringify(TWO_TAB_DISCONNECT)}).click()`,
        'demo',
      );
      await waitFor(
        cdp,
        tab.sessionId,
        TWO_TAB_STOP_SETTLED,
        SCENARIO_TIMEOUT_MS,
        `${what} neither finished disconnecting nor reported a failure within ` +
          `${SCENARIO_TIMEOUT_MS} ms`,
        complaints(tab),
      );
      const state = await read(tab);
      if (!state.stopped) {
        throw new Red(
          `${what} could not shut its client down.\n` +
            `  Its own status line reads: ${JSON.stringify(state.status)}\n` +
            `  A "not a function" here is almost always a subscription: both subscribe() and\n` +
            `  subscribeRetryRequests() on the demo relay must return the unsubscribe function\n` +
            `  itself, never a promise of one. Note that the name in that message is minified in\n` +
            `  a production build — the envelope one reports as a single mangled letter — so the\n` +
            `  message tells you the shape of the fault and not which of the two it was.`,
        );
      }
      stopped.push(state);
    }

    return {
      connected,
      ended,
      stopped,
      requests: [...first.requests, ...second.requests],
      cspViolations: [...first.cspViolations, ...second.cspViolations],
      pageErrors: [...first.pageErrors, ...second.pageErrors],
      wentQuiet,
      before,
      after,
      bytesBefore: before.reduce((sum, script) => sum + script.bytes, 0),
      bytesAfter: after.reduce((sum, script) => sum + script.bytes, 0),
    };
  } finally {
    for (const { tab } of tabs) tab.off();
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
  const panelSource = await readFile(
    new URL('../src/components/demo/LiveCarrierPanel.astro', import.meta.url),
    'utf8',
  );
  const declared = panelSource.match(/HELD_BACK = new Set\(\[([^\]]*)\]\)/s)?.[1];
  if (declared === undefined) {
    throw new Infra(
      'could not read HELD_BACK out of LiveCarrierPanel.astro, so this run cannot tell a ' +
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
        `the panel withholds "${field}", which the installed SDK does not declare on Envelope — ` +
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
  if (pass.beforeInteraction.claimVisible) {
    throw new Red(
      'the page claimed "that ran in this tab" before anything had run in this tab',
    );
  }

  if (pass.dom.fallbackNote) {
    throw new Red(`the demo fell back to the recording: ${pass.dom.fallbackNote}`);
  }
  if (!pass.afterFirst.decrypted.includes(PROBE)) {
    throw new Red(
      `the typed sentence did not come back:\n  sent:      ${PROBE}\n` +
        `  decrypted: ${pass.afterFirst.decrypted || '(nothing)'}`,
    );
  }
  if (pass.repeated && !pass.dom.decrypted.includes(REPEAT_PROBE)) {
    throw new Red(
      `the demo returned the first sentence and not the second. The session was already warm ` +
        `and the ratchet had moved on:\n  sent:      ${REPEAT_PROBE}\n` +
        `  decrypted: ${pass.dom.decrypted || '(nothing)'}`,
    );
  }
  if (pass.dom.recordedVisible) {
    throw new Red('the live demo ran and the recorded capture is still on screen beside it');
  }
  if (!pass.dom.claimVisible) {
    throw new Red('the demo round-tripped a sentence and never showed the claim about it');
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

function checkFallback(pass) {
  if (pass.dom.decrypted) {
    throw new Red(
      `every chunk the demo asked for was blocked and it printed "${pass.dom.decrypted}" anyway`,
    );
  }
  if (!pass.dom.recordedVisible) {
    throw new Red(
      'the chunk never came and the recorded capture was taken off screen anyway — ' +
        'invariant 6 requires it to stay as the load-failure state',
    );
  }
  if (!pass.dom.fallbackNote) {
    throw new Red('the demo could not load and the page had nothing to say about it');
  }
  if (pass.dom.claimVisible) {
    throw new Red('the demo never ran and the page still claims something ran in this tab');
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
 * What the receiving device actually calls this failure, computed rather than
 * quoted.
 *
 * The same reasoning as `expectedFields`, applied to the claim `/demo` exists
 * to make. A harness carrying the string "MAC mismatch" would go green against
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
        `would see in the scenario's status line, so /demo is broken rather than the harness.`,
    );
  }
  if (!result.refusal) {
    throw new Red(
      'the installed SDK was handed a ciphertext with one byte flipped and reported no error ' +
        'at all.\n  This is not the page being wrong. Nothing on /demo is worth checking until ' +
        'it is explained.',
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
      `the scenario refuses with ${result.refusal.errorCode}, but /demo tells the reader it is ` +
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
 * assertions below are about the SDK rather than about `/demo` — if the pre-link
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
        `would see in the scenario's status line, so /demo is broken rather than the harness.`,
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
        `would see in the scenario's status line, so /demo is broken rather than the harness.`,
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
        `  That is an improvement, and it makes /demo wrong: the scenario is built around the ` +
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
        `would see in the scenario's status line, so /demo is broken rather than the harness.`,
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
        `touching /demo.`,
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
        `${result.hooks.fired.join(', ')}.\n  That is an improvement, and it makes /demo wrong: ` +
        `the scenario is built around no hook firing.\n  Update the page and this expectation ` +
        `together.`,
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
 * Everything that is true of any scenario `/demo` ships.
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
      `/demo#${slug} did not open the scenario it names. The fragment is the whole point of\n  ` +
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
      `/demo talked to ${offOrigin.length} host(s) that are not this site:\n  ` +
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
      `/demo posted to ${sent.length} destination(s) other than ${BEACON_PATH}:\n  ` +
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
        `/demo sent "${shape[1]}", which src/workers/site.ts does not accept — the collector ` +
          `drops it,\n  so the page is measuring nothing while looking like it is`,
      );
    }
  }
  if (beacons.length !== 1) {
    throw new Red(
      `/demo sent ${beacons.length} beacon(s) for one scenario opened once and run twice:\n  ` +
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
      `${kb(pass.bytesBefore)} of JavaScript arrived on /demo before the reader ran anything, ` +
        `over the ${kb(PRE_INTERACTION_CEILING)} tripwire:\n  ` +
        pass.before.map((s) => `${s.url} (${s.bytes} B)`).join('\n  '),
    );
  }
  if (pass.after.length === 0) {
    throw new Red(
      'running the scenario fetched no chunk at all — the SDK was already on /demo before the ' +
        'reader asked for it',
    );
  }
  if (pass.pageErrors.length) {
    throw new Red(`/demo threw while running the scenario:\n  ${pass.pageErrors.join('\n  ')}`);
  }
  if (pass.cspViolations.length) {
    throw new Red(
      `/demo violated the site's own CSP ${pass.cspViolations.length} time(s):\n  ` +
        pass.cspViolations.join('\n  '),
    );
  }

  return { beacons, ids };
}

/* What `flip-a-byte` has to have printed, held against the same scenario run in
   this process. */
/*
 * The two tabs, judged against each other.
 *
 * The claim this section makes is not that a message arrived — the scenarios
 * above it already move messages — but that it arrived *through a channel*,
 * and that what went over that channel was an envelope. So the checks are in
 * two halves: who each tab turned out to be and what it saw of the other, and
 * what the relay pane is printing while it says so.
 *
 * The pane is the harder half and the reason the row is read as fields rather
 * than as text. "The ciphertext is not the sentence" has to fail when the
 * ciphertext stops being ciphertext, and a search for an absent string across
 * a whole pane passes just as happily when the pane has stopped printing the
 * field at all. `tests/demo-broadcast-relay.test.mjs` holds the stronger form
 * of this claim — nothing crossing the channel in any encoding — because that
 * one can watch every message rather than what a pane chose to render.
 */
function checkTwoTabs(pass, envelopeFields) {
  const [first, second] = pass.connected;
  const [firstEnded, secondEnded] = pass.ended;

  if (first.role !== 'host' || second.role !== 'guest') {
    throw new Red(
      `the two tabs did not settle into one relay and one caller: the first reported ` +
        `${JSON.stringify(first.role)} and the second ${JSON.stringify(second.role)}.\n` +
        `  The first tab presses first, so it is the one that should be holding the relay.`,
    );
  }
  if (first.me === second.me || first.me !== second.peer || second.me !== first.peer) {
    throw new Red(
      `the two tabs disagree about who is who: the first is ${JSON.stringify(first.me)} ` +
        `writing to ${JSON.stringify(first.peer)}, the second is ${JSON.stringify(second.me)} ` +
        `writing to ${JSON.stringify(second.peer)}`,
    );
  }

  /*
   * The label on a received line is the SDK's `senderId`, not the name the
   * receiving tab was expecting, so this asserts what the protocol decided
   * rather than what the page assumed.
   */
  const arrived = secondEnded.lines.find((line) => line.includes(TAB_PROBE));
  if (!arrived?.startsWith(`${first.me} `)) {
    throw new Red(
      `the second tab showed the first tab's sentence but not as coming from ` +
        `${JSON.stringify(first.me)}.\n  The line reads: ${JSON.stringify(arrived)}`,
    );
  }
  const answered = firstEnded.lines.find((line) => line.includes(TAB_REPLY));
  if (!answered?.startsWith(`${second.me} `)) {
    throw new Red(
      `the first tab showed the reply but not as coming from ${JSON.stringify(second.me)}.\n` +
        `  The line reads: ${JSON.stringify(answered)}`,
    );
  }

  if (firstEnded.rows.length === 0) {
    throw new Red(
      `the first tab sent a sentence and printed no row for it, so the section made its ` +
        `argument about the relay with nothing on screen`,
    );
  }
  for (const [index, row] of firstEnded.rows.entries()) {
    const fields = Object.keys(row);
    if (!fields.includes('ciphertext')) {
      throw new Red(
        `row ${index + 1} of the relay pane prints no ciphertext field, so the pane is no ` +
          `longer showing a stored envelope.\n  It printed: ${fields.join(', ') || 'nothing'}`,
      );
    }
    const invented = fields.filter((field) => !envelopeFields.has(field));
    if (invented.length) {
      throw new Red(
        `the relay pane printed ${invented.length} field(s) the SDK's Envelope does not ` +
          `declare (${invented.join(', ')}), so it is not printing the row it was handed`,
      );
    }
    for (const [field, value] of Object.entries(row)) {
      const how = findProbe(value);
      if (how) {
        throw new Red(
          `the relay pane's ${field} carries the sentence that was typed — ${how}.\n` +
            `  This is the claim the section exists to make, and it is false: what the relay ` +
            `is holding\n  is readable.`,
        );
      }
    }
  }

  const found = leaks(pass.requests, findProbe);
  if (found.length) {
    throw new Red(
      `${found.length} request(s) from the two-tab section carried a typed sentence:\n` +
        found.map((line) => `    ${line}`).join('\n'),
    );
  }

  /* The section is deliberately unmeasured: `scenario_opened` is fired by a
     `<details>` toggle, and this is not a scenario. A beacon appearing here is
     a new event nobody registered. */
  const beacons = beaconsIn(pass.requests);
  if (beacons.length) {
    throw new Red(
      `the two-tab section sent ${beacons.length} beacon(s) to ${BEACON_PATH} ` +
        `(${beacons.map((beacon) => JSON.stringify(beacon.postData)).join(', ')}), and no event ` +
        `is registered for it`,
    );
  }

  if (pass.bytesBefore > PRE_INTERACTION_CEILING) {
    throw new Red(
      `/demo fetched ${kb(pass.bytesBefore)} of script before the section was connected, over ` +
        `the ${kb(PRE_INTERACTION_CEILING)} tripwire`,
    );
  }
  if (pass.bytesAfter === 0) {
    throw new Red(
      `connecting the section fetched no script at all, so either it was already on the page ` +
        `before the press — which is what the tripwire above exists to prevent — or the ` +
        `harness measured the wrong tab`,
    );
  }

  /*
   * Both tabs shut their clients down, which is the one thing a round trip
   * cannot prove.
   *
   * `stop()` is where a subscription that handed back a promise instead of an
   * unsubscribe function finally says so, and nothing else on this site calls
   * it. A page whose teardown throws sends, delivers and decrypts exactly as
   * this check has already watched it do.
   */
  if (pass.stopped.length !== 2) {
    throw new Red(
      `only ${pass.stopped.length} of the two tabs was driven through stop(), so teardown is ` +
        `not covered and the harness is claiming more than it ran`,
    );
  }
  for (const [index, state] of pass.stopped.entries()) {
    const what = index === 0 ? 'the second tab' : 'the first tab';
    if (!state.stopped) {
      throw new Red(
        `${what} did not finish stopping.\n  Its status line reads: ${JSON.stringify(state.status)}`,
      );
    }
  }

  return { beacons };
}

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

    /* `/demo` in its own tab per scenario, so the homepage's accounting above is
       about the homepage and each scenario's egress is about that scenario. Each
       is run twice in its tab, which is what the two runs are compared against
       each other for. */
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

    /* Two tabs at once, which is the only pass here that needs more than one:
       the section's claim is that the second window is a second window. */
    const twoTabs = await visitTwoTabs(cdp, origin, held);
    checkTwoTabs(twoTabs, envelopeFields);

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
        `  before a touch: ${kb(live.bytesBefore)} of script over ${live.before.length} file(s), ` +
        `under the ${kb(PRE_INTERACTION_CEILING)} tripwire (uncompressed — this server does ` +
        `not gzip)\n` +
        `  the touch drew: ${kb(live.bytesAfter)} over ${live.after.length} chunk(s)\n` +
        `  those blocked:  the recorded capture stayed on screen ` +
        `("${starved.dom.fallbackNote}")\n` +
        `  /demo:          ${FLIP_SLUG} opened by fragment and run twice; both runs printed ` +
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
        `  /demo:          ${SECOND_DEVICE_SLUG} opened by fragment and run twice; each run ` +
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
        `  /demo:          ${PREKEY_SLUG} opened by fragment and run twice; the relay published ` +
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
        `  /demo:          ${REINSTALL_SLUG} opened by fragment and run twice; the receiving ` +
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
        `${reinstalled.after.length} chunk(s)\n` +
        `  /demo:          two tabs of the same page connected as ` +
        `${twoTabs.connected.map((tab) => `${tab.me} (${tab.role})`).join(' and ')}, and each ` +
        `read the\n` +
        `                  other's sentence off the channel — the reply came back through the ` +
        `tab holding the relay\n` +
        `                  the relay pane printed ${twoTabs.ended[0].rows.length} stored row(s), ` +
        `every field declared by the SDK's Envelope,\n` +
        `                  the ciphertext carrying neither sentence in cleartext, ` +
        `percent-encoded or base64 form\n` +
        `                  measured 0 beacon(s): the section is not a scenario and registers no ` +
        `event\n` +
        `                  then both tabs were disconnected, guest first, and each shut its ` +
        `client down without\n` +
        `                  complaint — the only stop() this site performs\n` +
        `                  before a touch ${kb(twoTabs.bytesBefore)} over ` +
        `${twoTabs.before.length} file(s); connecting drew ${kb(twoTabs.bytesAfter)} over ` +
        `${twoTabs.after.length} chunk(s)`,
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
