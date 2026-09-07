/*
 * Does the contents rail stand clear of what the article puts beside it?
 *
 * Above 80rem the table of contents leaves the column and becomes a sticky rail
 * in the leading gutter. A figure, a code block, and a table leave the column in
 * the other direction: they take a step of token space on each side of the
 * measure. Both reach into the same gutter, so the rail and the drawing beside
 * it occupied the same pixels.
 *
 *   node scripts/measure-rail-clearance.mjs --widths 1280,1440,1680
 *   node scripts/measure-rail-clearance.mjs --widths 1280 --json out.json
 *
 * A real Chrome over CDP, serving `dist/` under the production headers, for the
 * reason `scripts/measure-overflow.mjs` gives: the column is a `ch` measure of
 * the reading face, and no parsed stylesheet knows how wide that is.
 *
 * A page with no rail and a page whose rail is clear report the same thing to a
 * caller that counts overlaps, so this counts the readings it took and fails
 * when the sweep found no rail at all.
 */

import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { Cdp, Infra, Red, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/* Tall enough to hold a sticky rail and the first figure under it in one
   viewport, so the reading is of the state a reader meets. */
const VIEWPORT_HEIGHT = 1000;

/* A rounding allowance. The column is a fractional `ch` measure, so an edge
   that meets the rail exactly can read a hundredth of a pixel either way. */
const SLACK_PX = 0.5;

function widths(argv) {
  const at = argv.indexOf('--widths');
  if (at === -1) throw new Infra('pass --widths, for example --widths 1280,1440,1680');
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

/** Every built page that renders an article, as the path a reader types. */
function articles(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry !== 'index.html') continue;
      found.push(`/${relative(root, path)}`.replace(/\/index\.html$/, '/'));
    }
  };
  walk(root);
  return found;
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
  /* The column is 68 characters of the reading face, so a swapped face is a
     different column and every edge in the reading moves with it. */
  await evaluate(cdp, sessionId, 'document.fonts.ready');
}

/*
 * The reading.
 *
 * The rail counts only where it is a rail. Under 80rem the same element is the
 * first piece of furniture in the column, and its right edge is then the right
 * edge of the measure, which every wide element is supposed to pass.
 * `position` is what separates the two forms, and it is the property the media
 * query sets.
 */
const READING = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const article = document.querySelector('.oe-article');
  if (!article) return null;
  const rail = article.querySelector(':scope > .oe-article-toc');
  const railing = rail && getComputedStyle(rail).position === 'sticky';
  const box = rail ? rail.getBoundingClientRect() : null;
  const wide = [...article.querySelectorAll(
    ':scope > .prose > figure, :scope > .prose > pre, :scope > .prose > table, :scope > .prose > .oe-article-wide',
  )];
  return {
    rail: railing ? { left: round(box.left), right: round(box.right), width: round(box.width) } : null,
    wide: wide.map((element, index) => {
      const rect = element.getBoundingClientRect();
      return {
        index,
        tag: element.tagName.toLowerCase(),
        left: round(rect.left),
        right: round(rect.right),
        width: round(rect.width),
      };
    }),
  };
})()`;

async function main() {
  if (!existsSync(DIST)) throw new Infra('dist is missing; run npm run build first');
  const sweep = widths(process.argv.slice(2));
  const out = jsonPath(process.argv.slice(2));
  const paths = articles(DIST);
  if (paths.length === 0) throw new Infra(`${DIST} holds no page`);

  const held = { cdp: null, chrome: null, server: null, targets: [] };
  const readings = [];
  const overlapping = [];
  try {
    const served = await serve(DIST, productionHeaders());
    held.server = served.server;
    held.chrome = await launchChrome('oe-rail-');
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
      for (const path of paths) {
        await loaded(held.cdp, sessionId, `${served.origin}${path}`);
        const found = await evaluate(held.cdp, sessionId, READING);
        if (!found || !found.rail) continue;
        for (const element of found.wide) {
          const reading = {
            path,
            width,
            tag: element.tag,
            index: element.index,
            railRight: found.rail.right,
            elementLeft: element.left,
            elementWidth: element.width,
            clearance: Math.round((element.left - found.rail.right) * 100) / 100,
          };
          readings.push(reading);
          if (reading.clearance < -SLACK_PX) overlapping.push(reading);
        }
      }
    }

    if (out) writeFileSync(out, `${JSON.stringify(readings, null, 2)}\n`);

    if (readings.length === 0) {
      throw new Infra(
        `no page rendered a rail beside a wide element at ${sweep.join(', ')} px. An empty ` +
          `sweep clears any stylesheet, so this is a failure rather than a clean run.`,
      );
    }

    if (overlapping.length > 0) {
      throw new Red(
        `${overlapping.length} of ${readings.length} readings overlap the rail:\n` +
          overlapping
            .map(
              (reading) =>
                `  ${reading.path} at ${reading.width} px: ${reading.tag} starts at ` +
                `${reading.elementLeft} px, the rail ends at ${reading.railRight} px, ` +
                `${-reading.clearance} px of overlap\n`,
            )
            .join('') +
          `The rail takes the leading gutter. A wide element that centers on the column ` +
          `spans that same gutter. See the 80rem query in src/styles/article.css.`,
      );
    }

    const least = readings.reduce((low, reading) => Math.min(low, reading.clearance), Infinity);
    console.log(
      `rail clearance: PASS — ${readings.length} readings at ${sweep.join(', ')} px, ` +
        `least clearance ${least} px.`,
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
  console.error(`rail clearance: ${prefix} — ${error.message}`);
  process.exit(error instanceof Red ? 1 : 2);
}
