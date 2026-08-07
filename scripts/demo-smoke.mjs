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
 *   3. What does leave the page is one measurement beacon of a shape fixed in
 *      advance, carrying nothing derived from the sentence.
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
 * Every script the homepage fetches before the reader touches the demo, which
 * on 2026-08-06 was 14.5 KB over five files — the theme and measurement
 * scripts, two other page scripts, and the demo's own loader chunk. The
 * interaction then pulls 1760.8 KB, so the tripwire sits two orders of
 * magnitude below any build that has the SDK on its initial path.
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

function findProbe(haystack) {
  if (!haystack) return null;
  for (const text of [PROBE, REPEAT_PROBE]) {
    for (const [label, form] of egressForms(text)) {
      if (haystack.includes(form)) return label;
    }
  }
  /* The nonce alone is enough: nothing else on the site contains it. */
  if (haystack.includes(NONCE)) return 'nonce fragment';
  return null;
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
 * Load the homepage in a fresh tab, type the probe, press send, and report
 * everything the browser did.
 *
 * `blocked` is the list of URLs Chrome refuses before the page loads, which is
 * how the second pass makes the demo's chunks never arrive.
 */
async function visit(cdp, origin, held, { blocked = [], repeat = false } = {}) {
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

    const loaded = new Promise((resolve, reject) => {
      const stop = cdp.on((m) => {
        if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
          stop();
          resolve();
        }
      });
      setTimeout(() => {
        stop();
        reject(new Infra(`the homepage did not fire load within ${LOAD_TIMEOUT_MS} ms`));
      }, LOAD_TIMEOUT_MS);
    });
    await cdp.send('Page.navigate', { url: `${origin}/` }, sessionId);
    await loaded;

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

    /* Pull bodies the browser did not hand over inline. */
    for (const { requestId, record } of postDataNeeded) {
      try {
        const { postData } = await cdp.send('Network.getRequestPostData', { requestId }, sessionId);
        record.postData = postData;
      } catch {}
    }

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
    off();
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
 * The event names the collector accepts, read out of the Worker rather than
 * retyped here. A beacon carrying a name that source does not know is dropped
 * on arrival — the site would be measuring nothing and looking like it was, and
 * a copy of the list in this file would go stale in exactly the way that hides
 * it.
 */
async function collectorEvents() {
  const source = await readFile(new URL('../src/workers/site.ts', import.meta.url), 'utf8');
  const declared = source.match(/const EVENTS = new Set\(\[([^\]]*)\]\)/s)?.[1];
  if (declared === undefined) {
    throw new Infra(
      'could not read EVENTS out of src/workers/site.ts, so this run cannot tell a beacon the ' +
        'collector keeps from one it silently drops',
    );
  }
  return new Set([...declared.matchAll(/'([^']+)'/g)].map((match) => match[1]));
}

/*
 * What the page said to its own collector, checked as a whole string.
 *
 * Two sentences went through the demo in this pass, so a `demo_run` count is
 * the difference between the privacy notice's "one is sent per page" and a
 * panel that quietly measures each send.
 */
function checkBeacons(pass, events) {
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
    if (!events.has(shape[1])) {
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

function checkRoundTrip(pass, origin, envelopeFields, expected, events) {
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

  const leaks = [];
  for (const request of pass.requests) {
    for (const [field, value] of [
      ['url', request.url],
      ['body', request.postData],
      ['headers', request.headers],
    ]) {
      const how = findProbe(value);
      if (how) leaks.push(`${request.method} ${request.url} — ${how} in the ${field}`);
    }
  }
  if (leaks.length) {
    throw new Red(
      `the typed sentence left the page in ${leaks.length} request(s):\n  ${leaks.join('\n  ')}`,
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

  checkBeacons(pass, events);

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
  const events = await collectorEvents();

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
    checkRoundTrip(live, origin, envelopeFields, expected, events);

    /* Block every chunk the interaction asked for, so the dynamic import cannot
       resolve however Vite chose to split it. Taking only the first request
       would depend on whether a preload or the chunk itself won the race. */
    const starved = await visit(cdp, origin, held, {
      blocked: live.after.map((script) => script.url),
    });
    checkFallback(starved);

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
        `("${starved.dom.fallbackNote}")`,
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
