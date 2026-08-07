/*
 * Ambient types for things that reach a page script from outside the module
 * graph. `astro/client` and the content collections arrive through
 * `.astro/types.d.ts`, which tsconfig already includes.
 */

interface Window {
  /**
   * What `public/measure.js` publishes for a page script with an event of its
   * own: a name, and at most a label, both of which the collector drops unless
   * they are on its list. The page path and the wire format are the
   * measurement script's business, not the caller's.
   *
   * Optional because it arrives in its own request. A blocked or failed
   * measurement script must never take a page down with it, so every call site
   * goes through `?.` and the page carries on unmeasured.
   */
  oeMeasure?: (name: string, label?: string) => void;
}
