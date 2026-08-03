/*
 * The six lines of the quickstart that answer "what does the API look like".
 *
 * Every line is lifted verbatim from `quickstartCode` in
 * `src/data/carrier-capture.json` — the file recorded by running the SDK's
 * documented mock-relay quickstart. Nothing here is written for the page. The
 * same rule that governs the carrier panel governs this: a snippet that reads
 * better than the real thing is a claim about the API, and it is the one claim
 * this brand cannot afford to get wrong.
 *
 * Segments are selected by anchor rather than by line number, so a re-recorded
 * capture either still matches or throws at build time. It never drifts
 * quietly. `tests/site-content.test.mjs` checks the rendered lines back
 * against the capture.
 */

import capture from '../data/carrier-capture.json' with { type: 'json' };

export const installCommand = `npm install ${capture.packageName}`;

/** Marks the lines removed between segments. Never part of a segment. */
export const ELISION = '…';

const lines = capture.quickstartCode.split('\n');

/** `count` lines starting at the one that begins with `anchor`. */
const segment = (anchor, count = 1) => {
  const start = lines.findIndex((line) => line.startsWith(anchor));
  if (start === -1) {
    throw new Error(`Hero snippet anchor is not in the recorded capture: ${anchor}`);
  }
  return lines.slice(start, start + count);
};

/*
 * Import, construct, send. The setup the excerpt drops — the second client and
 * the mock relay's device registration — is real work a reader still has to
 * do, which is why the block links to the whole file rather than pretending
 * these are the only lines there are.
 */
export const heroSegments = [
  segment('import { createSignalProtocolClient }'),
  segment('const alice = await createSignalProtocolClient({', 4),
  segment('await alice.send('),
];

export const heroCode = heroSegments.map((segment) => segment.join('\n')).join(`\n\n${ELISION}\n\n`);
