/*
 * The header seats the wordmark on the navigation's baseline.
 *
 * Beside the navigation, "OpenE2EE" and the words after it share one bottom
 * line. That is a rendered fact about two font sizes, a line height, and a
 * translate, so it is read from the browser rather than from the classes. At
 * phone width the navigation is hidden and the lockup centers its ink on the
 * bar instead, the way the generated asset centers the mark on its canvas.
 *
 *   npm run build
 *   npm run visual:header
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Cdp, Infra, Red, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, navigation: true },
  { name: 'mobile', width: 390, height: 844, navigation: false },
];
/* Chrome rounds glyph boxes to a hundredth on one platform and a tenth on
   another; a baseline that moves reads as whole pixels. */
const TOLERANCE = 0.5;

const READ = `(() => {
  const baselineOf = (el) => {
    const probe = document.createElement('span');
    probe.setAttribute('style', 'display:inline-block;width:0;height:0;vertical-align:baseline;');
    el.appendChild(probe);
    const top = probe.getBoundingClientRect().top;
    probe.remove();
    return top;
  };
  const header = document.querySelector('header');
  const bar = header.getBoundingClientRect();
  const wordmark = header.querySelector('.oe-wordmark > span');
  const mark = header.querySelector('.oe-mark').getBoundingClientRect();
  const word = header.querySelector('nav[aria-label="Primary"] > a');
  const shown = word && word.getClientRects().length > 0;
  /* The mark spans the row's ink: its bottom is the wordmark's ink bottom by
     the lockup recipe, and the wordmark's capitals stop short of its top. */
  const inkCenter = (mark.top + mark.bottom) / 2;
  return {
    wordmark: baselineOf(wordmark),
    navigation: shown ? baselineOf(word) : null,
    inkOffCenter: inkCenter - (bar.top + bar.bottom - 1) / 2,
  };
})()`;

async function evaluate(cdp, sessionId, expression) {
  const res = await cdp.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true }, sessionId);
  if (res.exceptionDetails) throw new Infra(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
  return res.result.value;
}

const held = { cdp: null, chrome: null, server: null, targets: [] };
const failures = [];
try {
  await run();
} catch (error) {
  const prefix = error instanceof Red ? 'FAIL' : 'INFRASTRUCTURE FAILURE';
  console.error(`header baseline: ${prefix} — ${error.message}`);
  process.exit(error instanceof Red ? 1 : 2);
}

async function run() {
  try {
  const served = await serve(DIST, productionHeaders());
  held.server = served.server;
  held.chrome = await launchChrome('oe-header-');
  const version = await fetch(`http://127.0.0.1:${held.chrome.port}/json/version`).then((r) => r.json());
  held.cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  for (const viewport of VIEWPORTS) {
    const { targetId } = await held.cdp.send('Target.createTarget', { url: 'about:blank' });
    held.targets.push(targetId);
    const { sessionId } = await held.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await held.cdp.send('Page.enable', {}, sessionId);
    await held.cdp.send('Runtime.enable', {}, sessionId);
    await held.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { deviceScaleFactor: 1, height: viewport.height, mobile: !viewport.navigation, width: viewport.width },
      sessionId,
    );
    const loaded = new Promise((resolve) => {
      const off = held.cdp.on((message) => {
        if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
          off();
          resolve();
        }
      });
    });
    await held.cdp.send('Page.navigate', { url: `${served.origin}/` }, sessionId);
    await loaded;
    await evaluate(held.cdp, sessionId, 'document.fonts.ready');
    const read = await evaluate(held.cdp, sessionId, READ);
    const seen = `${viewport.name} ${viewport.width}px`;
    if (viewport.navigation) {
      if (read.navigation === null) failures.push(`${seen}: the navigation is hidden`);
      else if (Math.abs(read.wordmark - read.navigation) > TOLERANCE) {
        failures.push(
          `${seen}: the wordmark baseline is at ${read.wordmark}px and the navigation's at ${read.navigation}px`,
        );
      }
    } else {
      if (read.navigation !== null) failures.push(`${seen}: the navigation is shown`);
      if (Math.abs(read.inkOffCenter) > TOLERANCE) {
        failures.push(`${seen}: the lockup ink sits ${read.inkOffCenter}px off the bar's center`);
      }
    }
  }
  } finally {
  for (const targetId of held.targets) {
    try {
      await held.cdp?.send('Target.closeTarget', { targetId });
    } catch {}
  }
  held.cdp?.socket.close();
  if (held.chrome) {
    const exited = new Promise((resolve) => held.chrome.child.once('exit', resolve));
    held.chrome.child.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    try {
      rmSync(held.chrome.profile, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
    } catch {}
  }
  held.server?.close();
}
  if (failures.length > 0) throw new Red(`\n  ${failures.join('\n  ')}`);
  console.log(`header baseline: PASS — ${VIEWPORTS.length} viewports`);
}
