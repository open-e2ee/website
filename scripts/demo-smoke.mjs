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
import { runFlipAByte } from '../src/lib/demo/scenarios/flip-a-byte.ts';
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
 * `/demo`'s contract, on the same terms. The scenario is addressed by its slug
 * rather than by position: a second scenario landing on the page must not
 * silently move what this drives.
 */
const SCENARIO_SLUG = 'flip-a-byte';
const SCENARIO = `[data-scenario="${SCENARIO_SLUG}"]`;
const SCENARIO_RUN = '[data-scenario-run]';
const SCENARIO_STATUS = '[data-scenario-status]';
const SCENARIO_OUTPUT = '[data-scenario-output]';
const SCENARIO_STEPS = '[data-scenario-steps]';
const SCENARIO_NOTS = '[data-scenario-nots]';
const SCENARIO_LOG_LINE = '[data-scenario-log-line]';

/* The beacon `/demo` is allowed to send, in full. Same reasoning as
   `DEMO_RUN_BODY`: the body is fixed before the browser starts, so a dimension
   derived from the run — a timing, a byte count, an error code — is a failure
   rather than something to be searched for. */
const SCENARIO_BEACON_BODY = `scenario_opened /demo ${SCENARIO_SLUG}`;

/* Two boots of two devices, a MAC failure, a session archive and a resend, all
   in one tab. It ran in ~80 ms where this was written; the bound is for a
   machine under load, not for the protocol. */
const SCENARIO_TIMEOUT_MS = 60000;

const NONCE = randomUUID().slice(0, 8);
const PROBE = `Smoke probe ${NONCE}: the staging key rotates at 09:00 UTC.`;
/* A second sentence through a session that is already warm. The repeat send is
   a different path — the SDK chunk is there, the handshake is done, the ratchet
   has moved on — and until LD3 nothing ever exercised it. It is also what makes
   "one beacon per page, not per sentence" a measurement rather than an
   assertion: a page asked once cannot tell the two apart. */
const REPEAT_PROBE = `Second probe ${NONCE}: sent again, on a session already warm.`;

const DECRYPT_TIMEOUT_MS = 30000;
const LOAD_TIMEOUT_MS = 30000;

/* A fixed viewport, so what the page chooses to fetch before the reader touches
   anything is the same on every machine that runs this. */
const VIEWPORT = { width: 1280, height: 800 };

/*
 * Every script a page fetches before the reader asks for the SDK, which on
 * 2026-08-07 was 15.7 KB over six files on the homepage and 14.4 KB over five
 * on `/demo` — the theme and measurement scripts, each page's own script, and
 * a shared preload helper Vite splits out because two pages now import
 * dynamically. The interaction then pulls 1760.8 KB, so the tripwire sits two
 * orders of magnitude below any build that has the SDK on its initial path.
 *
 * These are wire bytes without compression: `chrome-harness.mjs` serves the
 * build as it is on disk, while Cloudflare compresses. So this is not
 * invariant 7's budget, which is 10 KB gzip and is a *delta* — it needs a build
 * without the demo to compare against, and is measured in the proof rather than
 * here. This is the tripwire for the SDK arriving uninvited.
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
const SCENARIO_SNAPSHOT = `(() => {
  const scenario = document.querySelector(${JSON.stringify(SCENARIO)});
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
async function visitScenario(cdp, origin, held) {
  const tab = await openTab(cdp, held);
  const { sessionId } = tab;

  const read = () => evaluate(cdp, sessionId, SCENARIO_SNAPSHOT);

  try {
    /* The fragment, not the bare path: arriving at `/demo#flip-a-byte` is a
       reader asking for this scenario by name, and opening it is what the page
       promises to do about that. */
    await tab.navigate(`${origin}/demo#${SCENARIO_SLUG}`, `/demo#${SCENARIO_SLUG}`);

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
          `run ${attempt} of the ${SCENARIO_SLUG} scenario did not finish within ` +
            `${SCENARIO_TIMEOUT_MS} ms`,
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
        const status = await evaluate(cdp, sessionId, SCENARIO_SNAPSHOT).catch(() => null);
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
 */
async function expectedRefusal() {
  const result = await runFlipAByte();
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
  return { ...result.refusal, sentence: result.sentence };
}

/*
 * Sentences `render()` prints when the run did *not* go the way the page
 * claims it goes. Each is the else-branch of a check against an observed
 * value, so any of them on screen means the page is being honest about a run
 * that failed — which is still a red harness result, and a far more
 * interesting one than a missing element.
 */
const SCENARIO_DENIALS = [
  'reported no error at all',
  'Something other than the sent message was delivered',
  'Garbage plaintext reached the application',
  'no recovery to show',
  'cannot say the drop was not silent',
];

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

function checkScenario(pass, origin, expected) {
  if (!pass.opened.open) {
    throw new Red(
      `/demo#${SCENARIO_SLUG} did not open the scenario it names. The fragment is the whole ` +
        `point of\n  addressing one: a reader who follows that link lands on a closed list.`,
    );
  }
  if (pass.opened.outputVisible || pass.opened.text) {
    throw new Red(
      `the scenario showed output before anything had run: ${JSON.stringify(pass.opened.text)}`,
    );
  }

  for (const [index, run] of pass.runs.entries()) {
    const where = `run ${index + 1}`;

    /* The SDK's error surface, which is the reason this page exists. Both the
       code and the message, because the code alone is a constant a page could
       hold and the message is what the SDK actually said. */
    for (const [what, value] of [
      ['error code', expected.errorCode],
      ['error message', expected.errorMessage],
    ]) {
      if (!run.text.includes(value)) {
        throw new Red(
          `${where} never printed the SDK's ${what}. The same scenario run in this process ` +
            `against\n  the installed package reported ${JSON.stringify(value)}, and the page ` +
            `printed:\n  ${run.text.slice(0, 400) || '(nothing)'}`,
        );
      }
    }

    /* And in the log pane, not only in the summary. The summary is this page's
       prose about the run; the log is the SDK's own records, and a page that
       printed the right sentence over an empty log would be describing a
       failure rather than showing one. */
    const named = run.logLines.filter(
      (row) => row.text.includes(expected.errorCode) && row.text.includes(expected.errorMessage),
    );
    if (named.length === 0) {
      throw new Red(
        `${where} printed the refusal in its summary and no log record carrying it. The pane is ` +
          `headed\n  "What the SDK said", so it has to be what the SDK said: ` +
          `${run.logLines.length} record(s) shown.`,
      );
    }

    for (const denial of SCENARIO_DENIALS) {
      if (run.text.includes(denial)) {
        throw new Red(
          `${where} reported that the protocol did not hold: the page printed "${denial}".\n` +
            `  The page is telling the truth about a run that failed, which is the harness ` +
            `working — but the\n  run failed.`,
        );
      }
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
  }

  /*
   * The two runs, against each other. This is what a page cannot fake: the
   * fixed strings are identical because both runs asked the same SDK, and the
   * identity key fingerprint differs because each run boots its own pair of
   * devices. A page with the output typed into it gets the first right and the
   * second wrong.
   */
  const ids = pass.runs.map(fingerprintIn);
  if (ids.some((id) => id === null)) {
    throw new Red(
      `a run printed no sending identity key fingerprint (${ids.join(', ')}), so the two runs ` +
        `cannot be told\n  apart and neither of them proves a device pair was ever booted`,
    );
  }
  if (ids[0] === ids[1]) {
    throw new Red(
      `both runs reported identity key fingerprint ${ids[0]}. Every press boots a fresh pair of ` +
        `devices with\n  fresh keys, so a repeated fingerprint means the page is printing a ` +
        `recording rather than running the SDK.`,
    );
  }
  if (pass.runs[0].text === pass.runs[1].text) {
    throw new Red(
      'both runs printed byte-for-byte the same output, which no two live runs of this scenario do',
    );
  }

  /* The sentence the scenario sends is fixed and lives in the module, so it is
     on the page as source before it is ever encrypted. What must not happen is
     it leaving in a request. */
  const carried = leaks(pass.requests, (value) => findAny(value, [expected.sentence]));
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
  if (beacons[0].postData !== SCENARIO_BEACON_BODY) {
    throw new Red(
      `the scenario's beacon reads ${JSON.stringify(beacons[0].postData)}, not ` +
        `${JSON.stringify(SCENARIO_BEACON_BODY)}.\n  It has grown a dimension, and everything ` +
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

    /* `/demo` in its own tab, so the homepage's accounting above is about the
       homepage. The scenario is run twice in that tab, which is what the two
       runs are compared against each other for. */
    const scenario = await visitScenario(cdp, origin, held);
    const { beacons: scenarioBeacons, ids } = checkScenario(scenario, origin, refusal);

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
        `  /demo:          ${SCENARIO_SLUG} opened by fragment and run twice; both runs printed ` +
        `${refusal.errorCode}\n` +
        `                  ("${refusal.errorMessage}") in the SDK's own log, and the resend ` +
        `arrived intact\n` +
        `                  sending identity keys ${ids.join(' then ')} — a fresh device pair ` +
        `per run\n` +
        `                  measured ${scenarioBeacons.length} beacon(s): ` +
        `${scenarioBeacons.map((beacon) => JSON.stringify(beacon.postData)).join(', ')}\n` +
        `                  before a touch ${kb(scenario.bytesBefore)} over ` +
        `${scenario.before.length} file(s); the run drew ${kb(scenario.bytesAfter)} over ` +
        `${scenario.after.length} chunk(s)`,
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
