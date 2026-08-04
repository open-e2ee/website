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
 * Import, construct, send, receive.
 *
 * The receive side earns its lines twice over. It is the half a reader cannot
 * infer from the send call — a hook rather than a return value, because the
 * message arrives whenever the relay delivers it — and its recorded comment,
 * `plaintext, only on Bob's device`, is the page's central claim written in
 * code that ran rather than in a sentence about code.
 *
 * The opening segment is five lines rather than one because of what four fresh
 * readers did with the shorter version. It imported a single name, and then the
 * constructor used three that had never been declared: `mockStore()`, a bare
 * `relay`, and `bob`. The caption disclosed the third and neither of the first
 * two — and every one of those readers worked out on their own that a bare
 * `relay` in `adapters` meant a server they had to write and operate. One put
 * it as partial candour reading worse than none, because they found the
 * omission themselves. That is the correct reaction, and the cheapest possible
 * answer was already in the recording: lines 1-5 of the capture declare
 * `relay`, import `mockStore`, and carry their own disclosure in the specifier
 * — `/local/store/mock` and `/remote/relay/mock` say `mock` twice, in the
 * reader's own language, without the page asserting anything.
 *
 * They are taken as one contiguous run, blank line included, so no elision
 * mark stands between them. An `…` claims code was removed; between line 3 and
 * line 5 the only thing removed would be an empty line, and a truthful snippet
 * does not get to imply otherwise. The `…` that follows is honest — device
 * registration really is elided there.
 *
 * `bob` stays undeclared, because his client is Alice's four lines with one
 * name changed and the panel should not spend four lines on a rename. The
 * caption names him, and now names the store and the relay as well.
 */
export const heroSegments = [
  segment('import { createSignalProtocolClient }', 5),
  segment('const alice = await createSignalProtocolClient({', 4),
  segment('await alice.send('),
  segment('bob.registerHook("onMessageDecrypted"', 4),
];

export const heroCode = heroSegments.map((segment) => segment.join('\n')).join(`\n\n${ELISION}\n\n`);
