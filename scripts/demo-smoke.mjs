/*
 * Drives the homepage live demo in a real browser and checks the two claims the
 * page makes about it: that a reader's own sentence round-trips through the SDK
 * in their tab, and that the sentence never leaves the page.
 *
 *   npm run build && npm run demo:smoke
 *
 * The second claim is the one that needs a browser. "Nothing left the page —
 * check the network tab" is an invitation, and a reader who accepts it and
 * finds a request carrying their sentence has caught the site lying. So this
 * harness watches every request the page makes, including WebSocket frames,
 * and fails on any that carries the typed text in cleartext, percent-encoded,
 * or base64 form. The typed sentence carries a per-run nonce: the site ships a
 * recorded capture whose plaintext is a fixed string, and a fixed probe string
 * would either collide with it or quietly stop proving anything.
 *
 * It also fails on a CSP violation. The demo's whole premise is that it runs
 * under the site's unchanged `script-src 'self'` — and the failure mode is not
 * hypothetical. An Astro island (`client:visible`) emits its hydration
 * bootstrap as an inline script, which this policy blocks in Chrome, Firefox
 * and WebKit alike; the island renders its server markup and simply never
 * wakes up. That was measured in LD0. A demo built that way would look fine to
 * a test that only asked whether the markup was present.
 *
 * Chrome is driven over CDP directly, the way the landing-page gauntlet's
 * viewport tooling was, and for the same reason: Node ships a WebSocket client,
 * so the whole harness costs no dependency. Headers come from `public/_headers`
 * rather than being retyped here, so the policy under test is the policy that
 * ships.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const HEADERS_FILE = join(ROOT, 'public', '_headers');

/*
 * The contract LD2 implements. The harness names the demo through data
 * attributes rather than class names or element structure so that restyling the
 * panel cannot break the test, and so that the test states plainly what the
 * demo has to expose.
 */
const PANEL = '[data-demo="live-carrier-panel"]';
const INPUT = '[data-demo-input]';
const SEND = '[data-demo-send]';
const DECRYPTED = '[data-demo-decrypted]';

const NONCE = randomUUID().slice(0, 8);
const PROBE = `Smoke probe ${NONCE}: the staging key rotates at 09:00 UTC.`;

const DECRYPT_TIMEOUT_MS = 30000;
const LOAD_TIMEOUT_MS = 30000;

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

/* Two failure classes, because they mean different things to whoever ran this.
   An infrastructure fault says nothing about the demo; a red assertion does. */
class Infra extends Error {}
class Red extends Error {}

// ---------------------------------------------------------------- the server

function productionHeaders() {
  if (!existsSync(HEADERS_FILE)) throw new Infra(`no ${HEADERS_FILE}`);
  const headers = {};
  let inGlobal = false;
  for (const line of readFileSync(HEADERS_FILE, 'utf8').split('\n')) {
    if (/^\S/.test(line)) {
      inGlobal = line.trim() === '/*';
      continue;
    }
    if (!inGlobal) continue;
    const m = line.match(/^\s+([^:]+):\s*(.+)$/);
    if (m) headers[m[1].trim()] = m[2].trim();
  }
  if (!headers['Content-Security-Policy']) {
    throw new Infra(`the /* block of public/_headers carries no Content-Security-Policy`);
  }
  return headers;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

/*
 * Plain HTTP on the loopback interface. The policy carries
 * `upgrade-insecure-requests`, which Chrome and Firefox do not apply to
 * loopback — WebKit does, which is why LD0's cross-engine spike had to serve
 * TLS. A Chrome-only harness does not.
 */
async function serve(headers) {
  const server = createServer((req, res) => {
    let path = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    if (!existsSync(path)) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const body = readFileSync(path);
    res.writeHead(200, {
      ...headers,
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      'Content-Length': body.length,
    });
    res.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', (e) => reject(new Infra(`could not bind a port: ${e.message}`)));
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

// ---------------------------------------------------------------- the browser

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/* CHROME_PATH is an override, not another guess: someone who sets it and gets a
   silent fallback to a different browser learns nothing from the result. */
function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Infra(`CHROME_PATH is set to ${process.env.CHROME_PATH}, which does not exist`);
    }
    return process.env.CHROME_PATH;
  }
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    throw new Infra(
      `no Chrome found. Looked at:\n  ${CHROME_CANDIDATES.join('\n  ')}\nSet CHROME_PATH to point at one.`,
    );
  }
  return found;
}

async function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), 'demo-smoke-'));
  const child = spawn(
    findChrome(),
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-extensions',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  /* Chrome writes the port it actually chose into the profile directory. */
  const portFile = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf8').split('\n');
      if (port) {
        return { child, profile, port: Number(port) };
      }
    }
    if (child.exitCode !== null) {
      throw new Infra(`Chrome exited early with code ${child.exitCode}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Infra('Chrome never reported a debugging port');
}

/* A CDP client small enough to read: request/response by id, events by name. */
class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.method}: ${message.error.message}`));
        else resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Infra(`CDP connect failed: ${url}`)), {
        once: true,
      });
    });
    return new Cdp(socket);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Infra(`CDP ${method} did not answer within 30s`));
        }
      }, 30000);
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

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
  for (const [label, form] of egressForms(PROBE)) {
    if (haystack.includes(form)) return label;
  }
  /* The nonce alone is enough: nothing else on the site contains it. */
  if (haystack.includes(NONCE)) return 'nonce fragment';
  return null;
}

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
  if (held.cdp && held.targetId) {
    try {
      await held.cdp.send('Target.closeTarget', { targetId: held.targetId });
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

async function main() {
  if (!existsSync(DIST)) {
    throw new Infra(`no dist/ to serve. Run \`npm run build\` first.`);
  }
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Infra(`dist/ has no index.html. Run \`npm run build\` first.`);
  }

  const headers = productionHeaders();
  const held = { server: null, chrome: null, cdp: null, targetId: null };
  try {
    await run(headers, held);
  } finally {
    await teardown(held);
  }
}

async function run(headers, held) {
  const { server, origin } = await serve(headers);
  held.server = server;
  const chrome = await launchChrome();
  held.chrome = chrome;

  const version = await fetch(`http://127.0.0.1:${chrome.port}/json/version`).then((r) => r.json());
  const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  held.cdp = cdp;

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  held.targetId = targetId;
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  const requests = [];
  const cspViolations = [];
  const pageErrors = [];
  const postDataNeeded = [];
  let lastRequestAt = Date.now();

  cdp.on((message) => {
    if (message.sessionId !== sessionId) return;
    if (message.method === 'Network.requestWillBeSent') {
      const { request, requestId } = message.params;
      lastRequestAt = Date.now();
      requests.push({
        url: request.url,
        method: request.method,
        postData: request.postData ?? null,
        headers: JSON.stringify(request.headers ?? {}),
      });
      if (request.hasPostData && !request.postData) postDataNeeded.push(requestId);
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

  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Network.enable', {}, sessionId);
  await cdp.send('Log.enable', {}, sessionId);

  /*
   * Wait out the tail of network activity so a late send is still observed.
   *
   * The minimum hold is measured from the moment the text appeared, not from
   * the last request. Without it, a slow decrypt would leave the connection
   * already quiet for longer than the window and this would return at once —
   * skipping exactly the interval the check exists to watch.
   */
  async function settleEgress() {
    const start = Date.now();
    const deadline = start + EGRESS_SETTLE_MAX_MS;
    for (;;) {
      const now = Date.now();
      const quiet = Math.min(now - lastRequestAt, now - start);
      if (quiet >= EGRESS_QUIET_MS || now >= deadline) return;
      await new Promise((r) => setTimeout(r, Math.min(200, EGRESS_QUIET_MS - quiet)));
    }
  }

  const loaded = new Promise((resolve, reject) => {
    const off = cdp.on((m) => {
      if (m.sessionId === sessionId && m.method === 'Page.loadEventFired') {
        off();
        resolve();
      }
    });
    setTimeout(() => {
      off();
      reject(new Infra(`the homepage did not fire load within ${LOAD_TIMEOUT_MS} ms`));
    }, LOAD_TIMEOUT_MS);
  });
  await cdp.send('Page.navigate', { url: `${origin}/` }, sessionId);
  await loaded;

  /* Serving the built site at all is the infrastructure check. If the homepage
     did not render, nothing below would mean anything. */
  {
    const titled = await evaluate(cdp, sessionId, 'document.title');
    if (!titled) throw new Infra('the homepage rendered no title — the served build looks wrong');

    const panelPresent = await evaluate(
      cdp,
      sessionId,
      `Boolean(document.querySelector(${JSON.stringify(PANEL)}))`,
    );
    if (!panelPresent) {
      throw new Red(
        `no live demo island on the homepage: nothing matches ${PANEL}.\n` +
          `  The site served and rendered correctly (title: ${JSON.stringify(titled)}), so this is\n` +
          `  the demo being absent rather than the harness failing to reach it.\n` +
          `  LD2 adds the island; until then this harness is expected to fail here.`,
      );
    }

    for (const [selector, what] of [
      [INPUT, 'a text input for the reader’s sentence'],
      [SEND, 'a control that sends it'],
      [DECRYPTED, 'a pane that shows the decrypted result'],
    ]) {
      const present = await evaluate(
        cdp,
        sessionId,
        `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
      );
      if (!present) {
        throw new Red(`the demo island is present but exposes no ${what} (${selector})`);
      }
    }

    /* Type as a reader would: focus the field, insert text so the demo's own
       input handlers run, then press its send control. */
    /* Blamed on the demo for the same reason as the click: the elements were
       there a moment ago, so if they are gone now the demo's own script moved
       them, and a demo that re-renders its panel out from under the reader is
       not an infrastructure fault. */
    await evaluate(
      cdp,
      sessionId,
      `document.querySelector(${JSON.stringify(INPUT)}).focus()`,
      'demo',
    );
    await cdp.send('Input.insertText', { text: PROBE }, sessionId);
    await evaluate(
      cdp,
      sessionId,
      `document.querySelector(${JSON.stringify(SEND)}).click()`,
      'demo',
    );

    await waitFor(
      cdp,
      sessionId,
      `document.querySelector(${JSON.stringify(DECRYPTED)})?.textContent?.includes(${JSON.stringify(PROBE)}) === true`,
      DECRYPT_TIMEOUT_MS,
      `the typed sentence never appeared decrypted in ${DECRYPTED} within ${DECRYPT_TIMEOUT_MS} ms`,
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

    await settleEgress();

    /* Pull bodies the browser did not hand over inline. */
    for (const requestId of postDataNeeded) {
      try {
        const { postData } = await cdp.send('Network.getRequestPostData', { requestId }, sessionId);
        requests.push({ url: '(deferred body)', method: 'POST', postData, headers: '{}' });
      } catch {}
    }

    const leaks = [];
    for (const request of requests) {
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

    if (cspViolations.length) {
      throw new Red(
        `the demo ran but the page reported ${cspViolations.length} CSP violation(s):\n  ` +
          cspViolations.join('\n  '),
      );
    }

    console.log(
      `demo smoke: PASS — round-tripped a typed sentence in the browser, ` +
        `${requests.length} request(s) observed (including a ${EGRESS_QUIET_MS} ms quiet window ` +
        `after it decrypted), none carrying it, no CSP violation.`,
    );
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
