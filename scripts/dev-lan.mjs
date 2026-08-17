/*
 * The dev server for testing from other devices: https on port 4321, with
 * plain http on the same port redirected instead of refused.
 *
 * A `http://192.168.x.x` origin is not a secure context, so `crypto.subtle`
 * does not exist there and the demo cannot encrypt — the dev server has to
 * speak https for any device that is not this machine (`DEV_SSL` in
 * `astro.config.mjs` is the switch). But one Vite server speaks exactly one
 * protocol, and a phone with the http address saved would get a connection
 * reset with no explanation. So Astro serves https on an internal port, and
 * this front door owns 4321: the first byte of a connection says which
 * protocol arrived — a TLS handshake opens with 0x16, no HTTP method starts
 * with it — and TLS is piped through untouched (wss included) while an http
 * request gets a 307 to the same host, port and path over https. 307 rather
 * than 308: browsers cache a permanent redirect against the origin, and a
 * later plain-http dev server on this port would fight that cache.
 *
 * `astro dev` manages its own daemon, so this script only asks it to start
 * (through `npm run dev` so `predev` still runs) and to stop again on
 * Ctrl-C. The daemon outliving a crash of this front door is harmless —
 * `astro dev stop` clears it.
 */

import { spawnSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';

const PUBLIC_PORT = 4321;
const INTERNAL_PORT = 4331;

const astro = (args) =>
  spawnSync('npx', ['astro', 'dev', ...args], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'inherit',
    env: { ...process.env, DEV_SSL: '1' },
  });

/* The daemon keeps its port for life, so a holdover from a plain
   `npm run dev` would still be sitting on 4321 or on a stale internal
   port. Stop is idempotent. */
astro(['stop']);
spawnSync('npm', ['run', 'dev', '--', '--port', String(INTERNAL_PORT), '--host', '0.0.0.0'], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: 'inherit',
  env: { ...process.env, DEV_SSL: '1' },
});

const front = net.createServer((sock) => {
  sock.once('data', (head) => {
    if (head[0] === 0x16) {
      const up = net.connect(INTERNAL_PORT, '127.0.0.1');
      up.write(head);
      sock.pipe(up);
      up.pipe(sock);
      up.on('error', () => sock.destroy());
      sock.on('error', () => up.destroy());
      return;
    }
    /* Enough of the request to name where it was going. The whole request
       line and Host header arrive in the first packet from every real
       browser; anything stranger can have the bare redirect. */
    const text = head.toString('latin1');
    const path = text.match(/^[A-Z]+ (\S+) HTTP/)?.[1] ?? '/';
    const host = (text.match(/\r\nHost:\s*([^\r\n]+)/i)?.[1] ?? 'localhost').replace(/:\d+$/, '');
    sock.end(
      `HTTP/1.1 307 Temporary Redirect\r\n` +
        `Location: https://${host}:${PUBLIC_PORT}${path}\r\n` +
        `Connection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  });
  sock.on('error', () => {});
});

front.listen(PUBLIC_PORT, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `  https://${i.address}:${PUBLIC_PORT}/`)
    .join('\n');
  console.log(
    `Front door on ${PUBLIC_PORT}: https served, http redirected.\n` +
      `  https://localhost:${PUBLIC_PORT}/\n${lan}`,
  );
});

process.on('SIGINT', () => {
  astro(['stop']);
  process.exit(0);
});
