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
  {
    slug: 'add-a-second-device',
    title: 'Add a second device',
    expectation:
      'A second device is linked to the receiving account over the real QR handshake, and the ' +
      'message sent before it existed is not on it.',
    action: 'Link a second device',
    source: './add-a-second-device.ts',
    /*
     * SESAME-ARTICLE-PENDING — the engineering journal's 2026-08 article on
     * Sesame and multi-device is the destination this scenario was planned
     * around, and it is not published yet. This link goes to the recipe for
     * the call the scenario makes by hand instead, because it is a page that
     * exists; the article replaces it when there is a URL to replace it with.
     * There is no placeholder URL here on purpose: a link to a page nobody has
     * written is a broken promise a reader finds before we do.
     */
    link: {
      href: 'https://github.com/open-e2ee/signal-protocol-js/blob/main/docs/RECIPES.md#direct-device-session',
      label: 'Opening a session with a device you have never written to',
    },
  },
  {
    slug: 'run-out-of-prekeys',
    title: 'Run out of one-time prekeys',
    expectation:
      'The server is left with no one-time prekeys, a new conversation is opened against it ' +
      'anyway, and the handshake quietly settles for the fallback key instead.',
    action: 'Empty the prekey stash',
    source: './run-out-of-prekeys.ts',
    link: {
      href: 'https://github.com/open-e2ee/signal-protocol-js/blob/main/docs/DEVICE_LIFECYCLE.md#prekey-types-explained',
      label: 'Which prekey does what, and which one a session falls back to',
    },
  },
];
