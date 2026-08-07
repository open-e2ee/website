/*
 * What `/demo` says about each scenario, and where the code it prints comes
 * from.
 *
 * This module is deliberately the half of a scenario that has no protocol in
 * it. The page's frontmatter imports it at build time, and a static import
 * that reached `../driver` would put the SDK's 713 KB on the page's first
 * paint — the cost invariant 7 exists to keep off a reader who has not asked
 * for it. So the runner lives in its own module and is fetched by a dynamic
 * `import()` when the reader presses the button; this holds only the words.
 *
 * The one thing it does not hold is the code sample. A page that prints "the
 * real code that runs" beside a button, with the sample typed into one file
 * and the behaviour written in another, is one edit away from printing a
 * program that no longer exists — and it would be the page's central claim
 * that broke, silently. So the sample is sliced out of the runner's own
 * source, between markers, at build time, by `./source.ts`. There is no copy
 * to drift.
 *
 * That slicing lives in its own module because it is a Vite feature and this
 * one has to stay plain TypeScript: `tests/measurement.test.mjs` imports the
 * list below under Node, to check that the collector accepts a scenario label
 * only for a scenario that ships.
 */

export interface ScenarioSummary {
  /** The fragment. `/demo#flip-a-byte` has to land on this scenario. */
  slug: string;
  title: string;
  /** One sentence, in the future tense: what pressing run will do. */
  expectation: string;
  /** Label on the control that runs it. */
  action: string;
  /** The module holding the runner, resolved against this file. */
  source: string;
  /** Exactly one way out, to whatever explains what the reader just saw. */
  link: { href: string; label: string };
}

export const SCENARIOS: ScenarioSummary[] = [
  {
    slug: 'flip-a-byte',
    title: 'Flip a byte in transit',
    expectation:
      'One byte of the encrypted message is changed on its way into the relay, and the ' +
      'receiving device refuses it rather than showing you what came out.',
    action: 'Corrupt a message',
    source: './flip-a-byte.ts',
    link: {
      href: 'https://github.com/open-e2ee/signal-protocol-js/blob/main/docs/ERROR_HANDLING.md',
      label: 'What DECRYPTION_FAILED means in your own error handling',
    },
  },
];
