/*
 * Does any page push the reader sideways?
 *
 * A horizontal scrollbar on a document is never a design decision. It is a
 * child wider than its container — a table, a code block, a diagram, a long
 * unbroken identifier — and on a phone it moves the whole column under the
 * reader's thumb. This walks the built site at the widths the design contract
 * names and asks each page whether its scrolling box is wider than its
 * viewport.
 *
 * A real Chrome over CDP, serving `dist/` under the production headers, for the
 * reason `scripts/measure-reduced-motion.mjs` gives: the answer depends on font
 * metrics, on `min-content` resolution, and on the scrollbar gutter, and none
 * of those exist in a parsed stylesheet.
 *
 *   node scripts/measure-overflow.mjs --widths 320,768,1280
 *
 * Every page, every width. A page that a width cannot reach and a page that
 * fits report the same thing to a caller that counts failures, so this counts
 * the measurements it took and fails when the sweep is empty.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { Cdp, Infra, Red, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/* Tall enough that a page's own vertical scrollbar is the normal case rather
   than the exception, which is what the reader has. */
const VIEWPORT_HEIGHT = 900;

/* A rounding allowance. A fractional layout width can leave `scrollWidth`, an
   integer, one pixel over a `clientWidth` that rounded the other way, and one
   pixel is not a page the reader can drag. Two is the smallest allowance that
   covers both edges of that rounding. */
const SLACK_PX = 2;

function widths(argv) {
  const at = argv.indexOf('--widths');
  if (at === -1) throw new Infra('pass --widths, for example --widths 320,768,1280');
  const parsed = (argv[at + 1] ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((width) => Number.isFinite(width) && width > 0);
  if (parsed.length === 0) {
    throw new Infra(`--widths took no width from ${JSON.stringify(argv[at + 1] ?? '')}`);
  }
  return parsed;
}

/** Every built page, as the path a reader types. */
function pages(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.endsWith('.html')) continue;
      const url = `/${relative(root, path)}`.replace(/\/index\.html$/, '/');
      found.push(url === '/index.html' ? '/' : url);
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
  /* Text width decides this, and a swapped face is a different width. */
  await evaluate(cdp, sessionId, 'document.fonts.ready');
}

/*
 * The reading, and the element to blame for it.
 *
 * `scrollWidth` says the page is wider than the window. It does not say what
 * made it so, and a caller who has to open a browser to find out has been given
 * a number rather than a defect. The walk names the widest boxes that reach
 * past the right edge, and passes over the ones that cannot have caused it: a
 * box inside an ancestor that scrolls, clips, or is fixed to the viewport does
 * not widen the document, so blaming it points at the fix rather than at the
 * fault.
 */
const READING = `(() => {
  const root = document.documentElement;
  const edge = root.clientWidth;
  const blame = [];
  for (const element of document.body.querySelectorAll('*')) {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.right <= edge + 1) continue;
    let contained = false;
    for (let node = element; node && node !== root; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) { contained = true; break; }
      if (style.position === 'fixed') { contained = true; break; }
    }
    if (contained) continue;
    blame.push({
      selector: element.tagName.toLowerCase() +
        (element.id ? '#' + element.id : '') +
        (element.className && typeof element.className === 'string'
          ? '.' + element.className.trim().split(/\\s+/).slice(0, 3).join('.')
          : ''),
      right: Math.round(box.right),
    });
  }
  blame.sort((a, b) => b.right - a.right);
  return { clientWidth: edge, scrollWidth: root.scrollWidth, blame: blame.slice(0, 5) };
})()`;

async function main() {
  if (!existsSync(DIST)) throw new Infra('dist is missing; run npm run build first');
  const sweep = widths(process.argv.slice(2));
  const paths = pages(DIST);
  if (paths.length === 0) {
    throw new Infra(
      `${DIST} holds no .html file. An empty sweep passes on any site, so this is a failure ` +
        `rather than a clean run.`,
    );
  }

  const held = { cdp: null, chrome: null, server: null, targets: [] };
  const overflowing = [];
  let measured = 0;
  try {
    const served = await serve(DIST, productionHeaders());
    held.server = served.server;
    held.chrome = await launchChrome('oe-overflow-');
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
        const reading = await evaluate(held.cdp, sessionId, READING);
        measured += 1;
        if (reading.scrollWidth > reading.clientWidth + SLACK_PX) {
          overflowing.push({ path, width, ...reading });
        }
      }
    }

    const expected = paths.length * sweep.length;
    if (measured !== expected) {
      throw new Infra(`took ${measured} of ${expected} readings`);
    }

    if (overflowing.length > 0) {
      throw new Red(
        `${overflowing.length} of ${measured} readings scroll sideways:\n` +
          overflowing
            .map(
              (reading) =>
                `  ${reading.path} at ${reading.width} px: ${reading.scrollWidth} px of content ` +
                `in ${reading.clientWidth} px of window\n` +
                (reading.blame.length === 0
                  ? `    no element reaches past the edge, so the width comes from a margin ` +
                    `or a positioned box\n`
                  : reading.blame
                      .map((item) => `    ${item.selector} ends at ${item.right} px\n`)
                      .join('')),
            )
            .join('') +
          `An element that has to be wider than the column scrolls inside its own box. See ` +
          `.oe-article > .prose > table in src/styles/article.css and .diagram in ` +
          `src/styles/demo.css.`,
      );
    }

    console.log(
      `overflow: PASS — ${paths.length} pages at ${sweep.join(', ')} px, ${measured} readings, ` +
        `none wider than its window.`,
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
        rmSync(held.chrome.profile, {
          force: true,
          maxRetries: 5,
          recursive: true,
          retryDelay: 100,
        });
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
  console.error(`overflow: ${prefix} — ${error.message}`);
  process.exit(error instanceof Red ? 1 : 2);
}
