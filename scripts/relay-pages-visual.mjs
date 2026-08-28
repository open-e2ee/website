/*
 * Layout regression for the two data-heavy Relay pages.
 *
 * Pixel snapshots make font and Chrome patch releases look like product
 * changes. This records the geometry that matters instead: page overflow,
 * heading bounds, and each table region's visible and scrollable widths at
 * the supported phone and desktop viewports.
 *
 *   npm run build
 *   npm run visual:relay
 *   npm run visual:relay -- --write
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cdp, Infra, Red, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'relay-pages-layout.json');
const WRITE = process.argv.includes('--write');
const PAGES = ['/relay/pricing/', '/compare/virgil-security/'];
const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 1000 },
];

function rounded(value) {
  return Math.round(value * 10) / 10;
}

async function loaded(cdp, sessionId, url) {
  const complete = new Promise((resolve, reject) => {
    let timeout;
    const off = cdp.on((message) => {
      if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
        clearTimeout(timeout);
        off();
        resolve();
      }
    });
    timeout = setTimeout(() => {
      off();
      reject(new Infra(`${url} did not load within 30 seconds`));
    }, 30_000);
  });
  await cdp.send('Page.navigate', { url }, sessionId);
  await complete;
  await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    expression: 'document.fonts.ready',
    returnByValue: true,
  }, sessionId);
}

async function main() {
  if (!existsSync(DIST)) throw new Infra('dist is missing; run npm run build first');
  const held = { cdp: null, chrome: null, server: null, targets: [] };
  try {
    const served = await serve(DIST, productionHeaders());
    held.server = served.server;
    held.chrome = await launchChrome('oe-relay-layout-');
    const version = await fetch(`http://127.0.0.1:${held.chrome.port}/json/version`).then((response) => response.json());
    const cdp = await Cdp.connect(version.webSocketDebuggerUrl);
    held.cdp = cdp;
    const actual = {};

    for (const viewport of VIEWPORTS) {
      for (const path of PAGES) {
        const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
        held.targets.push(targetId);
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Page.enable', {}, sessionId);
        await cdp.send('Runtime.enable', {}, sessionId);
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          deviceScaleFactor: 1,
          height: viewport.height,
          mobile: false,
          width: viewport.width,
        }, sessionId);
        await loaded(cdp, sessionId, `${served.origin}${path}`);
        const result = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const h1 = document.querySelector('h1').getBoundingClientRect();
            const tables = [...document.querySelectorAll('.table-scroll')].map((region) => ({
              clientWidth: region.clientWidth,
              overflowX: getComputedStyle(region).overflowX,
              scrollWidth: region.scrollWidth,
              tabIndex: region.tabIndex,
            }));
            return {
              documentWidth: document.documentElement.scrollWidth,
              h1: { height: h1.height, left: h1.left, right: h1.right, width: h1.width },
              tables,
              viewportWidth: innerWidth,
            };
          })()`,
          returnByValue: true,
        }, sessionId);
        const value = result.result.value;
        if (value.documentWidth > value.viewportWidth + 1) {
          throw new Red(`${path} overflows the ${viewport.name} viewport`);
        }
        if (value.h1.left < 0 || value.h1.right > value.viewportWidth + 1) {
          throw new Red(`${path} clips its heading at ${viewport.name}`);
        }
        if (value.tables.length === 0) {
          throw new Red(`${path} exposes no table region at ${viewport.name}`);
        }
        for (const table of value.tables) {
          if (table.overflowX !== 'auto' || table.tabIndex !== 0) {
            throw new Red(`${path} has a table that is not keyboard-scrollable at ${viewport.name}`);
          }
        }
        actual[`${viewport.name}:${path}`] = {
          documentWidth: value.documentWidth,
          h1: Object.fromEntries(Object.entries(value.h1).map(([key, number]) => [key, rounded(number)])),
          tables: value.tables,
          viewportWidth: value.viewportWidth,
        };
      }
    }

    const serialized = `${JSON.stringify(actual, null, 2)}\n`;
    if (WRITE) {
      writeFileSync(FIXTURE, serialized);
      console.log('relay page visual layout: fixture updated');
      return;
    }
    if (!existsSync(FIXTURE)) throw new Red('the Relay page layout fixture is missing');
    const expected = readFileSync(FIXTURE, 'utf8');
    if (expected !== serialized) {
      throw new Red('Relay page geometry changed; inspect both viewports and update the fixture intentionally');
    }
    console.log('relay page visual layout: PASS — 2 pages × 2 viewports');
  } finally {
    for (const targetId of held.targets) {
      try { await held.cdp?.send('Target.closeTarget', { targetId }); } catch {}
    }
    held.cdp?.socket.close();
    if (held.chrome) {
      const exited = new Promise((resolve) => held.chrome.child.once('exit', resolve));
      held.chrome.child.kill();
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      rmSync(held.chrome.profile, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      });
    }
    held.server?.close();
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  const prefix = error instanceof Red ? 'FAIL' : 'INFRASTRUCTURE FAILURE';
  console.error(`relay page visual layout: ${prefix} — ${error.message}`);
  process.exit(error instanceof Red ? 1 : 2);
}
