/*
 * What a reader who asks for less motion loses, and what they keep.
 *
 *   npm run build
 *   node scripts/measure-reduced-motion.mjs
 *
 * `@open-e2ee/design` collapses the duration tokens under
 * `prefers-reduced-motion: reduce`, which is right for a transition and wrong
 * for a dwell. A transition zeroed by that media query is motion the reader
 * asked not to see. A dwell zeroed by it is the whole teaching animation
 * playing in one frame, and the reader who asked for less motion loses the
 * demo instead of the movement.
 *
 * `src/lib/demo/playback.ts` and `src/lib/demo/mobile-reel.ts` both say in
 * prose that this is why their dwells are constants. This script is what makes
 * that a measurement. It asks the running page three things:
 *
 *   1. Which `:root` custom properties reduced motion actually shortens. Read
 *      off the page under both settings rather than named here, so a token
 *      renamed or a new one collapsed arrives on its own.
 *   2. Which custom properties the page's scripts read. Recorded by wrapping
 *      `CSSStyleDeclaration.prototype.getPropertyValue` before any page script
 *      runs, which is the only way a script can reach a custom property, and
 *      which separates a value read as a number from one handed to CSS inside
 *      a `var()`.
 *   3. Whether the mobile reel still spends its dwells under reduced motion,
 *      by watching the captions it writes and timing them.
 *
 * The first two answer the condition: no duration a teaching animation reads
 * is a duration reduced motion zeroes. The third is the failure that condition
 * exists to prevent, measured directly rather than inferred from the first two.
 *
 * Both the empty set and the never-installed hook read exactly like a pass, so
 * each is a failure of its own here: a run that finds nothing collapsed, or a
 * run that records no read at all, has measured nothing.
 *
 * The reel and not the wide console, because the reel is the teaching
 * animation this page plays on its own. The console waits on a reader pressing
 * Start and then three more controls, and driving all four is what
 * `scripts/demo-smoke.mjs` is. The dwell table under test is shared: the reel's
 * session and message frames carry `playback.ts`'s own dwells.
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Cdp, Infra, Red, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

/* The page that carries the reel, at a width the reel is drawn at: the figure
   exists only under `max-width: 60rem`, and the observer that pauses it fires
   for `display: none` as readily as for a scroll. */
const PAGE = '/';
const VIEWPORT = { width: 390, height: 844 };

const FIGURE = '[data-demo-mobile]';
const START = '[data-mobile-start]';
const CURTAIN = '[data-mobile-curtain]';
const CAPTION = '[data-mobile-caption]';

/*
 * How long the reel gets to open, and how long it is then watched.
 *
 * The opening runs the conversation at full speed — two devices registering,
 * their keys made and published, and four sentences sent — before the first
 * frame plays. It is bounded as a machine under load rather than from any
 * measurement of it, for `demo-smoke.mjs`'s reason: a budget tuned to this
 * machine is a budget that fails on a slower one and says nothing when it does.
 */
const OPENING_BUDGET_MS = 120_000;
const WATCH_BUDGET_MS = 40_000;
const POLL_MS = 200;

/*
 * How many frames are watched, and the floor the time across them has to clear.
 *
 * Four captions is three dwells. The shortest three in `MOBILE_DWELL_MS` are
 * 1400, 1800 and 1800 ms, so a reel spending its dwells cannot come near this
 * floor and a reel whose dwells collapsed to the tokens' 0.01 ms cannot come
 * near it from the other side. The floor sits between the two by two orders of
 * magnitude, so it reads the collapse rather than the machine.
 */
const FRAMES_WATCHED = 4;
const DWELL_FLOOR_MS = 1000;

/*
 * The recorder, installed before any page script runs.
 *
 * `getPropertyValue` is the only way a script reaches a custom property, so
 * wrapping it records every read and nothing else. A `var()` inside a value
 * handed to `setProperty` never comes through here, which is the distinction
 * that matters: a duration handed to CSS is a transition, and reduced motion
 * is meant to zero it.
 *
 * The observers wait for a document to observe. They are attached to the
 * curtain and to the caption separately, because the frames worth timing are
 * the ones after the curtain lifts — the opening writes its own progress into
 * the same caption, and a count that included those would time the SDK
 * booting rather than the reel playing.
 */
const RECORDER = `(() => {
  const state = { reads: [], captions: [], openedAt: null };
  window.__oeReducedMotion = state;

  const original = CSSStyleDeclaration.prototype.getPropertyValue;
  CSSStyleDeclaration.prototype.getPropertyValue = function (name) {
    if (typeof name === 'string' && name.startsWith('--')) state.reads.push(name);
    return original.call(this, name);
  };

  addEventListener('DOMContentLoaded', () => {
    const curtain = document.querySelector(${JSON.stringify(CURTAIN)});
    const caption = document.querySelector(${JSON.stringify(CAPTION)});
    if (!curtain || !caption) return;
    new MutationObserver(() => {
      if (curtain.hidden && state.openedAt === null) state.openedAt = performance.now();
    }).observe(curtain, { attributeFilter: ['hidden'], attributes: true });
    new MutationObserver(() => {
      state.captions.push({ at: performance.now(), text: caption.textContent });
    }).observe(caption, { characterData: true, childList: true, subtree: true });
  });
})()`;

/** The custom properties any stylesheet declares on the document element. */
const DECLARED = `(() => {
  const names = new Set();
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules) walk(rule.cssRules);
      if (!rule.style || !rule.selectorText) continue;
      if (!/(^|,)\\s*(:root|html)\\b/.test(rule.selectorText)) continue;
      for (const property of rule.style) if (property.startsWith('--')) names.add(property);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      /* A stylesheet this document may not read declares nothing this document
         resolves either, so there is nothing here to lose. */
    }
  }
  return [...names].sort();
})()`;

const computed = (names) => `(() => {
  const styles = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    ${JSON.stringify(names)}.map((name) => [name, styles.getPropertyValue(name).trim()]),
  );
})()`;

/** A CSS time as milliseconds, or null when the value is not a time. */
function milliseconds(value) {
  const time = /^(-?\d*\.?\d+)(ms|s)$/.exec(value);
  if (!time) return null;
  return Number(time[1]) * (time[2] === 's' ? 1000 : 1);
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    'Runtime.evaluate',
    { awaitPromise: true, expression, returnByValue: true },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Infra(
      `the page threw while being asked a question: ${
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      }`,
    );
  }
  return result.result.value;
}

async function reducedMotion(cdp, sessionId, on) {
  await cdp.send(
    'Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-reduced-motion', value: on ? 'reduce' : 'no-preference' }] },
    sessionId,
  );
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
  await evaluate(cdp, sessionId, 'document.fonts.ready');
}

async function waitFor(cdp, sessionId, expression, budgetMs, complaint) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (await evaluate(cdp, sessionId, expression)) return;
    if (Date.now() > deadline) throw new Red(`${complaint} within ${budgetMs} ms`);
    await new Promise((resume) => setTimeout(resume, POLL_MS));
  }
}

async function openTarget(cdp, held) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  held.targets.push(targetId);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { deviceScaleFactor: 1, height: VIEWPORT.height, mobile: false, width: VIEWPORT.width },
    sessionId,
  );
  return sessionId;
}

/*
 * Which duration reduced motion shortens, read off the page under both
 * settings.
 *
 * One document asked twice rather than two documents compared, so the two
 * readings differ in the preference and in nothing else. A custom property
 * that is not a time under both settings is not a duration and is passed over.
 */
async function collapsedDurations(cdp, held, origin) {
  const sessionId = await openTarget(cdp, held);
  await reducedMotion(cdp, sessionId, false);
  await loaded(cdp, sessionId, `${origin}${PAGE}`);
  const declared = await evaluate(cdp, sessionId, DECLARED);
  if (declared.length === 0) {
    throw new Red(`${PAGE} declares no custom property on its document element`);
  }
  const plain = await evaluate(cdp, sessionId, computed(declared));
  await reducedMotion(cdp, sessionId, true);
  const reduced = await evaluate(cdp, sessionId, computed(declared));

  const collapsed = [];
  for (const name of declared) {
    const before = milliseconds(plain[name]);
    const after = milliseconds(reduced[name]);
    if (before === null || after === null || after >= before) continue;
    collapsed.push({ name, before: plain[name], after: reduced[name] });
  }
  return { collapsed, declared };
}

/*
 * What the reel reads and how long it holds each frame, under reduced motion.
 *
 * The figure is scrolled into view before the press because the observer that
 * drives it pauses a reel that is not on screen, and a reel paused for the
 * whole watch would report every dwell as infinite rather than as spent.
 */
async function reelUnderReducedMotion(cdp, held, origin) {
  const sessionId = await openTarget(cdp, held);
  await reducedMotion(cdp, sessionId, true);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: RECORDER }, sessionId);
  await loaded(cdp, sessionId, `${origin}${PAGE}`);

  if (!(await evaluate(cdp, sessionId, `Boolean(document.querySelector(${JSON.stringify(FIGURE)}))`))) {
    throw new Red(
      `${PAGE} draws no reel at ${VIEWPORT.width} px (${FIGURE}), so the animation this ` +
        `condition is about is not on the page to be measured`,
    );
  }
  await evaluate(
    cdp,
    sessionId,
    `document.querySelector(${JSON.stringify(FIGURE)}).scrollIntoView({ block: 'center' })`,
  );
  await waitFor(
    cdp,
    sessionId,
    `(() => {
       const button = document.querySelector(${JSON.stringify(START)});
       return Boolean(button) && !button.disabled;
     })()`,
    OPENING_BUDGET_MS,
    `the reel's start control never became operable`,
  );
  await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(START)}).click()`);
  await waitFor(
    cdp,
    sessionId,
    'window.__oeReducedMotion.openedAt !== null',
    OPENING_BUDGET_MS,
    `the reel's curtain never lifted after the start control was pressed, so no frame played`,
  );
  await waitFor(
    cdp,
    sessionId,
    `(() => {
       const state = window.__oeReducedMotion;
       return state.captions.filter((frame) => frame.at >= state.openedAt).length >= ${FRAMES_WATCHED};
     })()`,
    WATCH_BUDGET_MS,
    `the reel wrote fewer than ${FRAMES_WATCHED} captions after its curtain lifted`,
  );
  return evaluate(cdp, sessionId, 'window.__oeReducedMotion');
}

async function main() {
  if (!existsSync(DIST)) throw new Infra('dist is missing; run npm run build first');
  const held = { cdp: null, chrome: null, server: null, targets: [] };
  try {
    const served = await serve(DIST, productionHeaders());
    held.server = served.server;
    held.chrome = await launchChrome('oe-reduced-motion-');
    const version = await fetch(`http://127.0.0.1:${held.chrome.port}/json/version`).then(
      (response) => response.json(),
    );
    held.cdp = await Cdp.connect(version.webSocketDebuggerUrl);

    const { collapsed, declared } = await collapsedDurations(held.cdp, held, served.origin);
    if (collapsed.length === 0) {
      throw new Red(
        `reduced motion shortens none of the ${declared.length} custom properties on the ` +
          `document element. This check compares what the page reads against what the ` +
          `preference zeroes, and an empty second set makes it pass on any page at all.`,
      );
    }

    const state = await reelUnderReducedMotion(held.cdp, held, served.origin);
    if (state.reads.length === 0) {
      throw new Red(
        `no script on ${PAGE} read a custom property, which is what this check reads to find a ` +
          `dwell taken from a token. A page that reads none and a recorder that never installed ` +
          `report the same thing, so this is a failure rather than a pass.`,
      );
    }

    const zeroed = new Map(collapsed.map((token) => [token.name, token]));
    const taken = [...new Set(state.reads)].filter((name) => zeroed.has(name)).sort();
    if (taken.length > 0) {
      throw new Red(
        `a script on ${PAGE} reads a duration that reduced motion zeroes:\n` +
          taken
            .map(
              (name) =>
                `  ${name}  ${zeroed.get(name).before} → ${zeroed.get(name).after} under reduce`,
            )
            .join('\n') +
          `\nA dwell derived from one of these plays the whole animation in a single frame for a ` +
          `reader who asked for less motion. Dwells are constants: see MOBILE_DWELL_MS in ` +
          `src/lib/demo/mobile-reel.ts and STEP_DWELL_MS in src/lib/demo/playback.ts.`,
      );
    }

    const frames = state.captions.filter((frame) => frame.at >= state.openedAt);
    const watched = frames.slice(0, FRAMES_WATCHED);
    const spent = watched[watched.length - 1].at - watched[0].at;
    if (spent < DWELL_FLOOR_MS) {
      throw new Red(
        `the reel played ${watched.length} frames in ${Math.round(spent)} ms under reduced ` +
          `motion, under the ${DWELL_FLOOR_MS} ms floor. The dwells are what a reader reads ` +
          `each frame in, and reduced motion is meant to drop the movement between frames and ` +
          `keep them.\n` +
          watched.map((frame) => `  ${Math.round(frame.at)} ms  ${frame.text}`).join('\n'),
      );
    }

    console.log(
      `reduced motion: PASS — reduce zeroes ${collapsed.length} of ${declared.length} custom ` +
        `properties (${collapsed.map((token) => token.name).join(', ')}), the page's scripts read ` +
        `${new Set(state.reads).size} custom properties and none of the zeroed ones, and the reel ` +
        `held ${watched.length} frames across ${Math.round(spent)} ms.`,
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
      /* Guarded for `relay-pages-visual.mjs`'s reason: Chrome on Linux keeps
         writing its profile after the kill returns, and an unguarded removal
         both invents failures and replaces the one the body raised. */
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
  console.error(`reduced motion: ${prefix} — ${error.message}`);
  process.exit(error instanceof Red ? 1 : 2);
}
