/*
 * Proves the demo driver in a real browser, over the wire, under the real CSP.
 *
 *   node scripts/demo-driver-check.mjs
 *
 * `tests/demo-driver.test.mjs` runs the same driver in node and proves the
 * protocol half — a real handshake, a real round trip, the real envelope. Three
 * claims it structurally cannot reach live here instead, because each is about
 * a browser fetching a chunk:
 *
 *   1. Nothing SDK-touching arrives before a reader asks (invariant 7). Node
 *      has no network to watch; here the run fails if the page has pulled more
 *      than PRE_INTERACTION_CEILING of JavaScript before the first click, which
 *      no build carrying the 713 KB SDK chunk can meet.
 *   2. `import('./driver')` resolves to something that runs. In node that
 *      specifier is never exercised: the loader's own tests inject their import
 *      because there is no chunk to fetch.
 *   3. When the chunk does not come, the page keeps the recorded panel and says
 *      so (invariant 6). The second pass blocks every chunk the interaction
 *      asks for and watches the same page land on `failed` with the recorded
 *      capture still on screen — a broken live demo must never render as a
 *      broken page.
 *
 * The page under test is a fixture, generated below, not LD2's panel: LD1 owns
 * `src/lib/demo/`, and the homepage panel does not exist yet. `npm run
 * demo:smoke` is the harness that fails until it does. The fixture imports the
 * real modules from `src/lib/demo/`, builds through the site's real Astro
 * pipeline with the site's real config, and is served under the `/*` headers
 * from `public/_headers`, so what runs is the shipped policy against shipped
 * code — the only part that is scaffolding is the markup around it.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cdp, Infra, Red, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const WORK = join(ROOT, '.demo-driver-check');
const SRC = join(WORK, 'src');
const OUT = join(WORK, 'dist');
/* Astro joins `--config` onto the project root rather than resolving it, so
   this has to stay relative to the root the CLI is run from. */
const CONFIG_REL = '.demo-driver-check/astro.config.mjs';
const CONFIG = join(ROOT, CONFIG_REL);

const PANEL = '[data-demo="live-carrier-panel"]';
const PROBE = 'Ship it Thursday. The staging key rotates at 09:00 UTC.';

/*
 * Comfortably above a page whose only script is the loader and this fixture's
 * markup glue, and roughly two orders of magnitude below the smallest build
 * that contains the SDK — LD0 measured that at 713 KB gzip, of which the
 * smallest single chunk on the path is already larger than this. The ceiling
 * is a tripwire for a static import creeping into the loader, not a budget:
 * invariant 7's 10 KB budget is against the homepage, which LD2 owns.
 */
const PRE_INTERACTION_CEILING = 20 * 1024;

const BUILD_TIMEOUT_MS = 300000;
const LOAD_TIMEOUT_MS = 30000;
const SETTLE_TIMEOUT_MS = 60000;

// ------------------------------------------------------------- the fixture

/*
 * A page in the shape invariant 6 describes: the recorded capture is what is on
 * screen, and it only gives way once the live demo is actually running. It
 * renders the metadata pane from `Object.entries` of the live envelope, which
 * is invariant 4 made mechanical — there is no field list here to drift.
 */
const FIXTURE = `---
---
<html lang="en">
  <head><meta charset="utf-8" /><title>demo driver check</title></head>
  <body>
    <section data-demo="live-carrier-panel" data-demo-state="idle">
      <p data-demo-recorded>recorded capture stands in until the live demo runs</p>
      <input data-demo-input type="text" />
      <button data-demo-send type="button">Send</button>
      <pre data-demo-decrypted></pre>
      <dl data-demo-meta></dl>
      <p data-demo-error></p>
    </section>
    <script>
      import { createDemoLoader } from '../../../src/lib/demo/loader';

      const panel = document.querySelector('[data-demo="live-carrier-panel"]');
      const recorded = panel.querySelector('[data-demo-recorded]');
      const out = panel.querySelector('[data-demo-decrypted]');
      const meta = panel.querySelector('[data-demo-meta]');
      const problem = panel.querySelector('[data-demo-error]');

      const loader = createDemoLoader();
      loader.subscribe((state) => {
        panel.dataset.demoState = state.status;
        if (state.status === 'failed') problem.textContent = state.error.message;
        /* The recorded panel goes away only once something live can replace
           it. Loading and failed both leave it exactly where it was. */
        if (state.status === 'ready') recorded.hidden = true;
      });

      panel.querySelector('[data-demo-send]').addEventListener('click', async () => {
        const text = panel.querySelector('[data-demo-input]').value;
        try {
          const { startDemoSession } = await loader.load();
          const session = window.__demoSession ?? (window.__demoSession = await startDemoSession());
          const { envelope, decrypted } = await session.send(text);
          for (const [field, value] of Object.entries(envelope)) {
            if (value === undefined) continue;
            const dt = document.createElement('dt');
            dt.textContent = field;
            const dd = document.createElement('dd');
            dd.textContent = String(value);
            meta.append(dt, dd);
          }
          out.textContent = decrypted.content;
        } catch (error) {
          problem.textContent = error instanceof Error ? error.message : String(error);
        }
      });
    </script>
  </body>
</html>
`;

const CONFIG_SOURCE = `/* Generated by scripts/demo-driver-check.mjs. */
import base from ${JSON.stringify(join(ROOT, 'astro.config.mjs'))};

export default {
  ...base,
  srcDir: ${JSON.stringify(SRC)},
  outDir: ${JSON.stringify(OUT)},
  /* The fixture is one page. A sitemap of it would only add noise, and the
     external-link rewriter has nothing to rewrite. */
  integrations: [],
};
`;

function writeFixture() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(SRC, 'pages'), { recursive: true });
  writeFileSync(join(SRC, 'pages', 'index.astro'), FIXTURE);
  writeFileSync(CONFIG, CONFIG_SOURCE);
}

async function build() {
  const child = spawn('npx', ['astro', 'build', '--config', CONFIG_REL], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));

  const timer = setTimeout(() => child.kill('SIGKILL'), BUILD_TIMEOUT_MS);
  const code = await new Promise((resolve) => child.on('close', resolve));
  clearTimeout(timer);

  if (code !== 0) throw new Infra(`the fixture build failed (exit ${code}):\n${log}`);
  if (!existsSync(join(OUT, 'index.html'))) {
    throw new Infra(`the fixture build produced no index.html:\n${log}`);
  }
}

// -------------------------------------------------------------- the browser

/** Attach to a fresh tab with the domains this harness listens to enabled. */
async function openTab(cdp, origin) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  for (const domain of ['Page', 'Runtime', 'Network', 'Log']) {
    await cdp.send(`${domain}.enable`, {}, sessionId);
  }
  return { targetId, sessionId, origin };
}

async function evaluate(tab, cdp, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    tab.sessionId,
  );
  if (result.exceptionDetails) {
    const text =
      result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'unknown';
    throw new Infra(`page evaluation threw: ${text}`);
  }
  return result.result.value;
}

/** Poll the page until `expression` is truthy, or give up and say what it saw. */
async function until(tab, cdp, expression, timeoutMs, describe) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await evaluate(tab, cdp, expression)) return;
    if (Date.now() > deadline) throw new Red(describe());
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Load the fixture, click send, and report what the browser did.
 *
 * `blocked` is the list of URLs Chrome should refuse before the page loads,
 * which is how the second pass makes the chunk never arrive.
 */
async function run(cdp, origin, { blocked = [] } = {}) {
  const tab = await openTab(cdp, origin);
  const scripts = [];
  const violations = [];
  const pageErrors = [];
  const failed = [];
  let interactedAt = Infinity;

  const requestedAt = new Map();
  const off = cdp.on((message) => {
    if (message.sessionId !== tab.sessionId) return;
    if (message.method === 'Network.requestWillBeSent') {
      requestedAt.set(message.params.requestId, {
        url: message.params.request.url,
        at: Date.now(),
        type: message.params.type,
      });
    }
    if (message.method === 'Network.loadingFinished') {
      const request = requestedAt.get(message.params.requestId);
      if (request?.type === 'Script') {
        scripts.push({ ...request, bytes: message.params.encodedDataLength });
      }
    }
    if (message.method === 'Network.loadingFailed') {
      const request = requestedAt.get(message.params.requestId);
      if (request) failed.push({ ...request, reason: message.params.errorText });
    }
    if (message.method === 'Log.entryAdded') {
      const entry = message.params.entry;
      if (entry.source === 'security' && /Content Security Policy/i.test(entry.text)) {
        violations.push(entry.text);
      }
    }
    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      pageErrors.push(details.exception?.description ?? details.text);
    }
  });

  try {
    if (blocked.length) {
      await cdp.send('Network.setBlockedURLs', { urls: blocked }, tab.sessionId);
    }

    const loaded = new Promise((resolve, reject) => {
      const stop = cdp.on((message) => {
        if (message.sessionId === tab.sessionId && message.method === 'Page.loadEventFired') {
          stop();
          resolve();
        }
      });
      setTimeout(() => {
        stop();
        reject(new Infra(`the fixture did not fire load within ${LOAD_TIMEOUT_MS} ms`));
      }, LOAD_TIMEOUT_MS);
    });
    await cdp.send('Page.navigate', { url: origin }, tab.sessionId);
    await loaded;

    /* The module script is fetched after the load event, so give the page a
       beat to have asked for everything it intends to before deciding what
       "before the first interaction" means. */
    await new Promise((r) => setTimeout(r, 1000));
    await until(
      tab,
      cdp,
      `!!document.querySelector('${PANEL}')`,
      LOAD_TIMEOUT_MS,
      () => 'the fixture rendered no panel — the served build looks wrong',
    );

    interactedAt = Date.now();
    await evaluate(
      tab,
      cdp,
      `(() => {
         const panel = document.querySelector('${PANEL}');
         panel.querySelector('[data-demo-input]').value = ${JSON.stringify(PROBE)};
         panel.querySelector('[data-demo-send]').click();
         return true;
       })()`,
    );

    await until(
      tab,
      cdp,
      `(() => {
         const panel = document.querySelector('${PANEL}');
         const state = panel.dataset.demoState;
         if (state === 'failed') return true;
         return panel.querySelector('[data-demo-decrypted]').textContent.length > 0;
       })()`,
      SETTLE_TIMEOUT_MS,
      () => {
        const context = [
          ...violations.map((text) => `  CSP violation: ${text}`),
          ...pageErrors.map((text) => `  page error: ${text}`),
        ];
        return (
          `the fixture neither decrypted nor reported a failed load within ` +
          `${SETTLE_TIMEOUT_MS / 1000} s` + (context.length ? `\n${context.join('\n')}` : '')
        );
      },
    );

    const dom = await evaluate(
      tab,
      cdp,
      `(() => {
         const panel = document.querySelector('${PANEL}');
         const recorded = panel.querySelector('[data-demo-recorded]');
         return {
           state: panel.dataset.demoState,
           decrypted: panel.querySelector('[data-demo-decrypted]').textContent,
           error: panel.querySelector('[data-demo-error]').textContent,
           recordedVisible: !recorded.hidden && recorded.offsetParent !== null,
           fields: [...panel.querySelectorAll('[data-demo-meta] dt')].map((dt) => dt.textContent),
         };
       })()`,
    );

    const before = scripts.filter((script) => script.at < interactedAt);
    const after = scripts.filter((script) => script.at >= interactedAt);
    return {
      dom,
      violations,
      pageErrors,
      failed,
      before,
      after,
      bytesBefore: before.reduce((sum, script) => sum + script.bytes, 0),
      bytesAfter: after.reduce((sum, script) => sum + script.bytes, 0),
    };
  } finally {
    off();
    await cdp.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => {});
  }
}

// ----------------------------------------------------------------- the checks

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

function checkGreen(result) {
  if (result.violations.length) {
    throw new Red(`the fixture violated the shipped CSP:\n  ${result.violations.join('\n  ')}`);
  }
  if (result.pageErrors.length) {
    throw new Red(`the fixture threw:\n  ${result.pageErrors.join('\n  ')}`);
  }
  if (result.dom.state !== 'ready') {
    throw new Red(
      `the loader ended in "${result.dom.state}" rather than ready` +
        (result.dom.error ? `: ${result.dom.error}` : ''),
    );
  }
  if (result.dom.decrypted !== PROBE) {
    throw new Red(
      `the sentence did not come back:\n  sent:      ${PROBE}\n  decrypted: ${result.dom.decrypted}`,
    );
  }
  if (result.dom.recordedVisible) {
    throw new Red('the live demo ran and the recorded capture is still on screen');
  }
  if (result.dom.fields.length < 10) {
    throw new Red(
      `the metadata pane derived ${result.dom.fields.length} fields from the live envelope; ` +
        `LD0 measured ten: ${result.dom.fields.join(', ')}`,
    );
  }
  if (result.bytesBefore > PRE_INTERACTION_CEILING) {
    throw new Red(
      `${kb(result.bytesBefore)} of JavaScript arrived before the first interaction, over the ` +
        `${kb(PRE_INTERACTION_CEILING)} tripwire — something on the loader's static path reaches ` +
        `the SDK:\n  ${result.before.map((s) => `${s.url} (${s.bytes} B)`).join('\n  ')}`,
    );
  }
  if (result.after.length === 0) {
    throw new Red('the interaction fetched no chunk at all — the driver was already loaded');
  }
}

function checkBlocked(result) {
  if (result.dom.state !== 'failed') {
    throw new Red(
      `every chunk the interaction asked for was blocked and the loader reported ` +
        `"${result.dom.state}" rather than failed`,
    );
  }
  if (!result.dom.error) {
    throw new Red('the loader failed and the page had no message to show for it');
  }
  if (!result.dom.recordedVisible) {
    throw new Red(
      'the chunk never came and the recorded capture was taken off screen anyway — ' +
        'invariant 6 requires it to stay as the load-failure state',
    );
  }
  if (result.dom.decrypted) {
    throw new Red(`the demo failed to load and still printed "${result.dom.decrypted}"`);
  }
}

// ------------------------------------------------------------------- the run

const held = {};
process.on('exit', () => {
  held.server?.close();
  held.chrome?.child.kill('SIGKILL');
  if (held.chrome) rmSync(held.chrome.profile, { recursive: true, force: true, maxRetries: 3 });
});

try {
  writeFixture();
  await build();

  const { server, origin } = await serve(OUT, productionHeaders());
  held.server = server;

  const chrome = await launchChrome('demo-driver-check-');
  held.chrome = chrome;
  const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${chrome.port}/json/version`).then(
    (response) => response.json(),
  );
  const cdp = await Cdp.connect(webSocketDebuggerUrl);

  const green = await run(cdp, origin);
  checkGreen(green);

  /* Block every chunk the interaction asked for, so the dynamic import cannot
     resolve however Vite chose to split it. Taking only the first request
     would depend on whether a preload or the chunk itself won the race. */
  const blocked = await run(cdp, origin, { blocked: green.after.map((script) => script.url) });
  checkBlocked(blocked);

  console.log(
    `demo driver: PASS — round-tripped a typed sentence in Chrome under the shipped CSP, ` +
      `${green.dom.fields.length} envelope fields derived from the live object.\n` +
      `  before the first interaction: ${kb(green.bytesBefore)} over ${green.before.length} ` +
      `script(s), under the ${kb(PRE_INTERACTION_CEILING)} tripwire\n` +
      `  the interaction pulled:       ${kb(green.bytesAfter)} over ${green.after.length} chunk(s)\n` +
      `  with those ${green.after.length} chunk(s) blocked: the loader reported failed ` +
      `("${blocked.dom.error}") and the recorded capture stayed on screen`,
  );
  process.exit(0);
} catch (error) {
  if (error instanceof Red) {
    console.error(`demo driver: FAIL — ${error.message}`);
    process.exit(1);
  }
  console.error(`demo driver: INFRASTRUCTURE — ${error.message}`);
  process.exit(2);
}
