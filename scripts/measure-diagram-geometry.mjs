/*
 * What the diagrams actually draw, measured in the browser that draws them.
 *
 * Three of the drawings in `src/components/diagrams/` made claims their own
 * geometry contradicted: an arrow labeled device to device that started at
 * neither device, a figure whose two rows drew one concept at two scales, an
 * arrow between two forms that exchange nothing, and dotted boundary rules that
 * ran through the caption glyphs under them. None of those is visible to a
 * stylesheet or to a parser: a text box is the shaped run of a font, and only a
 * renderer knows how wide it is.
 *
 *   node scripts/measure-diagram-geometry.mjs
 *   node scripts/measure-diagram-geometry.mjs --json out.json
 *
 * A real Chrome over CDP, serving `dist/` under the production headers, for the
 * reason `scripts/measure-overflow.mjs` gives. Every reading is in the SVG's own
 * user units, which is the coordinate system the components are written in, so a
 * number here is a number a reader of the source can act on.
 *
 * Classification is geometric rather than by marker, so the same script reads a
 * drawing that predates it:
 *
 *   box    an open form — a rect with no fill and a stroke, 50 units or more
 *          on both axes. Devices, servers, stores, and unbranded relays.
 *   rule   a trust boundary — a line carrying a dash pattern.
 *   arrow  a shaft — a rect no more than 4 units thick and 20 or more long on
 *          its other axis, upright or across.
 *   text   every text element, at the box the renderer shaped it into.
 *
 * It fails on two conditions, which are the two the drawings broke. An arrow
 * that reaches a box it neither starts at nor ends at — either by running
 * through it or by carrying its whole width past it, which reads the same way to
 * anyone following the arrow — and a rule that runs through the box of a text
 * element.
 */

import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { Cdp, Infra, Red, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/* Wide enough that `.diagram-wide`'s 52rem floor is not the width in force, so
   the reading is of the drawing rather than of the scroll container. */
const VIEWPORT = { height: 1200, width: 1600 };

/* How near an endpoint has to be to a box before the arrow counts as starting
   or ending there. The head is a 12-unit triangle drawn past the shaft, and a
   shaft is held off an open form's 4-unit stroke by a visible gap. */
const TOUCH_UNITS = 20;

function jsonPath(argv) {
  const at = argv.indexOf('--json');
  return at === -1 ? null : argv[at + 1];
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
  /* Every label is set in the metadata face. A fallback face shapes a different
     run, and the whole point of the reading is where the runs end. */
  await evaluate(cdp, sessionId, 'document.fonts.ready');
}

/*
 * The reading. `getBBox` is the element's box in its own user units, which is
 * what the component's constants are written in.
 */
const READING = `(() => {
  const round = (n) => Math.round(n * 100) / 100;
  const box = (element) => {
    const b = element.getBBox();
    return {
      x: round(b.x),
      y: round(b.y),
      width: round(b.width),
      height: round(b.height),
      right: round(b.x + b.width),
      bottom: round(b.y + b.height),
    };
  };
  return [...document.querySelectorAll('figure.diagram svg, svg.signature-diagram')].map((svg) => {
    const title = svg.querySelector('title');
    const boxes = [];
    const rules = [];
    const arrows = [];
    const texts = [];
    for (const element of svg.querySelectorAll('rect, line, text, path')) {
      const tag = element.tagName.toLowerCase();
      const measured = box(element);
      if (tag === 'text') {
        texts.push({ ...measured, text: element.textContent.trim().replace(/\\s+/g, ' ') });
        continue;
      }
      if (tag === 'line') {
        if (element.getAttribute('stroke-dasharray')) rules.push(measured);
        continue;
      }
      if (tag !== 'rect') continue;
      const fill = element.getAttribute('fill');
      const stroke = element.getAttribute('stroke');
      if (fill === 'none' && stroke && measured.width >= 50 && measured.height >= 50) {
        boxes.push(measured);
        continue;
      }
      const thin = Math.min(measured.width, measured.height);
      const long = Math.max(measured.width, measured.height);
      if (thin <= 4 && long >= 20) {
        arrows.push({ ...measured, vertical: measured.height > measured.width });
      }
    }
    return {
      viewBox: svg.getAttribute('viewBox'),
      title: title ? title.textContent.trim().replace(/\\s+/g, ' ') : null,
      boxes,
      rules,
      arrows,
      texts,
    };
  });
})()`;

const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;

/*
 * Does the arrow carry a box's whole width? An arrow drawn clear over a form,
 * from one side of it to the other, is read as passing through the form: the eye
 * follows the shaft, and the form under it is on the path. NoWayBack drew its
 * device-to-device arrow this way, 26 units above a relay whose caption says
 * nothing reaches the new device from it.
 */
const spans = (arrow, box) =>
  arrow.vertical
    ? box.y >= arrow.y && box.bottom <= arrow.bottom
    : box.x >= arrow.x && box.right <= arrow.right;

/** Does the arrow start or end at this box? Either end, either side of it. */
function anchored(arrow, box) {
  const near = (x, y) =>
    x >= box.x - TOUCH_UNITS &&
    x <= box.right + TOUCH_UNITS &&
    y >= box.y - TOUCH_UNITS &&
    y <= box.bottom + TOUCH_UNITS;
  /* The shaft's two ends, on whichever axis it is long. An upright arrow read
     across instead has both ends inside its own 2-unit width, which anchors it
     to nothing and leaves the check blind to it. */
  if (arrow.vertical) {
    const x = arrow.x + arrow.width / 2;
    return near(x, arrow.y) || near(x, arrow.bottom);
  }
  const y = arrow.y + arrow.height / 2;
  return near(arrow.x, y) || near(arrow.right, y);
}

/** What an unanchored arrow does to a box it clears, on its own long axis. */
const sweep = (arrow) => 'carries its whole ' + (arrow.vertical ? 'height' : 'width') + ' past';

function faults(figure) {
  const found = [];
  for (const [index, arrow] of figure.arrows.entries()) {
    for (const [at, box] of figure.boxes.entries()) {
      const through = overlaps(arrow, box);
      if (!through && !spans(arrow, box)) continue;
      if (anchored(arrow, box)) continue;
      found.push(
        `arrow ${index} at ${arrow.x},${arrow.y} ${arrow.width}x${arrow.height} ` +
          `${through ? 'runs through' : sweep(arrow)} box ${at} at ` +
          `${box.x},${box.y} ${box.width}x${box.height}, and starts at neither end of it`,
      );
    }
  }
  for (const [index, rule] of figure.rules.entries()) {
    for (const label of figure.texts) {
      if (!overlaps(rule, label)) continue;
      found.push(
        `rule ${index} at x ${rule.x}, y ${rule.y} to ${rule.bottom} runs through the text ` +
          `"${label.text}" at ${label.x},${label.y} ${label.width}x${label.height}`,
      );
    }
  }
  return found;
}

async function main() {
  if (!existsSync(DIST)) throw new Infra('dist is missing; run npm run build first');
  const out = jsonPath(process.argv.slice(2));
  const paths = pages(DIST);
  if (paths.length === 0) throw new Infra(`${DIST} holds no page`);

  const held = { cdp: null, chrome: null, server: null, targets: [] };
  const figures = [];
  try {
    const served = await serve(DIST, productionHeaders());
    held.server = served.server;
    held.chrome = await launchChrome('oe-diagram-');
    const version = await fetch(`http://127.0.0.1:${held.chrome.port}/json/version`).then(
      (response) => response.json(),
    );
    held.cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    const { targetId } = await held.cdp.send('Target.createTarget', { url: 'about:blank' });
    held.targets.push(targetId);
    const { sessionId } = await held.cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await held.cdp.send('Page.enable', {}, sessionId);
    await held.cdp.send('Runtime.enable', {}, sessionId);
    await held.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      { deviceScaleFactor: 1, mobile: false, ...VIEWPORT },
      sessionId,
    );

    for (const path of paths) {
      await loaded(held.cdp, sessionId, `${served.origin}${path}`);
      for (const figure of await evaluate(held.cdp, sessionId, READING)) {
        figures.push({ path, ...figure, faults: faults(figure) });
      }
    }

    if (out) writeFileSync(out, `${JSON.stringify(figures, null, 2)}\n`);

    if (figures.length === 0) {
      throw new Infra(
        'no built page rendered a diagram. An empty sweep clears every drawing, so this is a ' +
          'failure rather than a clean run.',
      );
    }

    for (const figure of figures) {
      console.log(
        `${figure.path} ${figure.viewBox}: ${figure.boxes.length} boxes, ` +
          `${figure.rules.length} rules, ${figure.arrows.length} arrows, ` +
          `${figure.texts.length} labels, ${figure.faults.length} faults`,
      );
      for (const fault of figure.faults) console.log(`    ${fault}`);
    }

    const broken = figures.filter((figure) => figure.faults.length > 0);
    if (broken.length > 0) {
      const total = broken.reduce((count, figure) => count + figure.faults.length, 0);
      throw new Red(
        `${total} geometric faults in ${broken.length} of ${figures.length} figures. ` +
          'An arrow states a path and a rule states a place; a drawing whose geometry ' +
          'contradicts its own caption teaches the opposite of the caption.',
      );
    }

    console.log(
      `diagram geometry: PASS — ${figures.length} figures measured, no arrow crosses a box it ` +
        'does not touch, and no rule runs through a label.',
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
  console.error(`diagram geometry: ${prefix} — ${error.message}`);
  process.exit(error instanceof Red ? 1 : 2);
}
