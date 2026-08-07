/*
 * A real Chrome, driving a real build, served under the headers the site ships.
 *
 * Extracted from `demo-smoke.mjs` when `demo-driver-check.mjs` needed the same
 * three things: the production CSP read out of `public/_headers` rather than
 * retyped, a static server that applies it, and a CDP client. Two copies of a
 * CDP client in one `scripts/` directory would drift, and the one that drifted
 * would be the one nobody was watching.
 *
 * Chrome is driven over CDP directly, the way the landing-page gauntlet's
 * viewport tooling was, and for the same reason: Node ships a WebSocket client,
 * so the whole harness costs no dependency.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, mkdtempSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;
const HEADERS_FILE = join(ROOT, 'public', '_headers');

/* Two failure classes, because they mean different things to whoever ran this.
   An infrastructure fault says nothing about the demo; a red assertion does. */
export class Infra extends Error {}
export class Red extends Error {}

// ---------------------------------------------------------------- the server

/** The `/*` block of `public/_headers`, so the policy under test is the one
 *  that ships rather than a copy that goes stale on the first edit. */
export function productionHeaders() {
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
export async function serve(root, headers) {
  const server = createServer((req, res) => {
    let path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
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
export function findChrome() {
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

export async function launchChrome(profilePrefix = 'oe-harness-') {
  const profile = mkdtempSync(join(tmpdir(), profilePrefix));
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
export class Cdp {
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
