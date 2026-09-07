/*
 * Does the mark sit at the size of the words beside it, and does the lockup
 * stand clear of the navigation?
 *
 * Two readings, both of rendered pixels:
 *
 *   1. the mark's height against the wordmark's cap height. A mark set from the
 *      font size rather than from the cap height draws about a sixth too large,
 *      because Public Sans has a cap height of 0.723 em.
 *   2. the space between the lockup and the navigation against the space
 *      between two navigation words. A lockup with the navigation's own gap
 *      reads as the first word of the navigation. The other side of the lockup
 *      is the page gutter, which the whole page shares, so it is reported and
 *      not judged.
 *
 *   node scripts/measure-lockup-fit.mjs --widths 1024,1280,1440
 *   node scripts/measure-lockup-fit.mjs --widths 1440 --json out.json
 *
 * The cap height is measured, not computed: the page asks the loaded face for
 * the ink box of a flat-topped capital. A ratio taken from a manifest proves
 * what the manifest says, and the defect this measures is a manifest that says
 * one thing while a stylesheet does another.
 *
 * A real Chrome over CDP, serving `dist/` under the production headers, for the
 * reason `scripts/measure-rail-clearance.mjs` gives.
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Cdp, Infra, Red, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/* The pages a reader arrives on, each carrying the same header. Three of them
   rather than one: the header is one component, and a reading that takes it
   from a single page cannot tell a component from a page that happens to
   render it. */
const PATHS = ['/', '/relay/', '/pricing/'];

/* Tall enough for the sticky header and the first band under it. */
const VIEWPORT_HEIGHT = 900;

/* The navigation leaves the row at 62rem, and the lockup is then alone in it.
   Every width here is above that. */
const DEFAULT_WIDTHS = [1024, 1280, 1440];

/* DESIGN.md's own bound: the mark is at most 1.15 cap heights tall. */
export const MARK_CAP_LIMIT = 1.15;

function widths(argv) {
  const at = argv.indexOf('--widths');
  if (at === -1) return DEFAULT_WIDTHS;
  const parsed = (argv[at + 1] ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((width) => Number.isFinite(width) && width > 0);
  if (parsed.length === 0) {
    throw new Infra(`--widths took no width from ${JSON.stringify(argv[at + 1] ?? '')}`);
  }
  return parsed;
}

function jsonPath(argv) {
  const at = argv.indexOf('--json');
  return at === -1 ? null : argv[at + 1];
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { awaitPromise: true, expression, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Infra(
      `the page threw while being measured: ${
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      }`,
    );
  }
  return result.result.value;
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
  /* The wordmark is live text and the cap height is read from the face, so a
     reading taken before the face arrives is a reading of the fallback. */
  await evaluate(cdp, sessionId, 'document.fonts.ready');
}

/*
 * The reading.
 *
 * `capHeight` comes from the ink box of `E` set in the wordmark's own computed
 * font, which is the cap height of the face that actually rendered.
 *
 * `lockupTrail` is the space between the lockup and the first navigation word,
 * and `navGap` is the space between the first two navigation words. `lockupLead`
 * is the page gutter, reported for context.
 */
const READING = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const header = document.querySelector('header .oe-wordmark')?.closest('header');
  if (!header) return { fault: 'no header carries a wordmark' };
  const lockup = header.querySelector('a[aria-label="OpenE2EE home"]');
  const mark = header.querySelector('.oe-mark');
  const wordmark = header.querySelector('.oe-wordmark');
  const words = [...header.querySelectorAll('nav[aria-label="Primary"] > a')];
  if (!lockup || !mark || !wordmark) return { fault: 'the header carries no lockup' };
  if (words.length < 2) return { fault: 'the header row carries fewer than two navigation words' };

  const style = getComputedStyle(wordmark.firstElementChild ?? wordmark);
  const context = document.createElement('canvas').getContext('2d');
  context.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
  const capHeight = context.measureText('E').actualBoundingBoxAscent;

  const lockupBox = lockup.getBoundingClientRect();
  const markBox = mark.getBoundingClientRect();
  const rowBox = lockup.parentElement.getBoundingClientRect();
  const first = words[0].getBoundingClientRect();
  const second = words[1].getBoundingClientRect();

  return {
    markHeight: round(markBox.height),
    capHeight: round(capHeight),
    fontSize: round(parseFloat(style.fontSize)),
    lockupLead: round(lockupBox.left - rowBox.left),
    lockupTrail: round(first.left - lockupBox.right),
    navGap: round(second.left - first.right),
  };
})()`;

function fault(reading) {
  const reasons = [];
  if (reading.ratio > MARK_CAP_LIMIT) {
    reasons.push(
      `the mark is ${reading.markHeight} px against a ${reading.capHeight} px cap height, ` +
        `a ratio of ${reading.ratio} over the ${MARK_CAP_LIMIT} the lockup allows`,
    );
  }
  if (reading.lockupClear <= reading.navGap) {
    reasons.push(
      `the lockup holds ${reading.lockupClear} px of clear space beside a ` +
        `${reading.navGap} px navigation gap, so it reads as the first word of the navigation`,
    );
  }
  return reasons;
}

async function main() {
  if (!existsSync(DIST)) throw new Infra('dist is missing; run npm run build first');
  const sweep = widths(process.argv.slice(2));
  const out = jsonPath(process.argv.slice(2));

  const held = { cdp: null, chrome: null, server: null, targets: [] };
  const readings = [];
  const faulted = [];
  try {
    const served = await serve(DIST, productionHeaders());
    held.server = served.server;
    held.chrome = await launchChrome('oe-lockup-');
    const version = await fetch(`http://127.0.0.1:${held.chrome.port}/json/version`).then(
      (response) => response.json(),
    );
    held.cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    const { targetId } = await held.cdp.send('Target.createTarget', { url: 'about:blank' });
    held.targets.push(targetId);
    const { sessionId } = await held.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await held.cdp.send('Page.enable', {}, sessionId);
    await held.cdp.send('Runtime.enable', {}, sessionId);

    for (const width of sweep) {
      await held.cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { deviceScaleFactor: 1, height: VIEWPORT_HEIGHT, mobile: false, width },
        sessionId,
      );
      for (const path of PATHS) {
        await loaded(held.cdp, sessionId, `${served.origin}${path}`);
        const found = await evaluate(held.cdp, sessionId, READING);
        if (!found) throw new Infra(`${path} at ${width} px returned no reading`);
        if (found.fault) throw new Infra(`${path} at ${width} px: ${found.fault}`);
        const reading = {
          path,
          width,
          ...found,
          ratio: Math.round((found.markHeight / found.capHeight) * 1000) / 1000,
          lockupClear: found.lockupTrail,
        };
        readings.push(reading);
        const reasons = fault(reading);
        if (reasons.length > 0) faulted.push({ reading, reasons });
      }
    }

    if (out) writeFileSync(out, `${JSON.stringify(readings, null, 2)}\n`);

    if (readings.length === 0) {
      throw new Infra(
        `no page rendered a lockup beside a navigation at ${sweep.join(', ')} px. An empty ` +
          `sweep clears any stylesheet, so this is a failure rather than a clean run.`,
      );
    }

    if (faulted.length > 0) {
      throw new Red(
        `${faulted.length} of ${readings.length} readings fault:\n` +
          faulted
            .map(
              ({ reading, reasons }) =>
                reasons.map((reason) => `  ${reading.path} at ${reading.width} px: ${reason}\n`).join(''),
            )
            .join('') +
          `The mark sizes from the lockup token through the ratio in src/components/Lockup.astro, ` +
          `and the row's gaps are set in src/components/Header.astro.`,
      );
    }

    const worst = readings.reduce((high, reading) => Math.max(high, reading.ratio), 0);
    const tightest = readings.reduce((low, reading) => Math.min(low, reading.lockupClear), Infinity);
    console.log(
      `lockup fit: PASS — ${readings.length} readings at ${sweep.join(', ')} px, ` +
        `widest mark ${worst} cap heights, tightest clear space ${tightest} px.`,
    );
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
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
      try {
        rmSync(held.chrome.profile, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
      } catch {}
    }
    held.server?.close();
  }
}

try {
  await main();
  process.exit(0);
} catch (error) {
  const prefix = error instanceof Red ? 'FAIL' : 'INFRASTRUCTURE FAILURE';
  console.error(`lockup fit: ${prefix} — ${error.message}`);
  process.exit(error instanceof Red ? 1 : 2);
}
