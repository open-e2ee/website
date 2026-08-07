/*
 * The program `/demo` prints, taken out of the module `/demo` runs.
 *
 * The page's central claim is that the code beside the button is the code the
 * button executes. A hand-written sample cannot keep that promise: it is one
 * edit to the runner away from being fiction, and nothing would fail. So the
 * sample is sliced out of the runner's own source between markers.
 *
 * Vite inlines the source text at build time, which is what makes this safe:
 * the read cannot be pointed at the wrong file, cannot miss because the build
 * moved the module, and cannot silently pick up a stale copy. An earlier
 * version read the file itself, relative to `import.meta.url` — that resolves
 * against the *bundled chunk* during a build, so it looked for the scenario
 * inside `dist/`. Keep the source text bundled with the module; do not
 * reintroduce a filesystem path.
 */

import type { ScenarioSummary } from './catalog.ts';

/*
 * Every scenario runner, as text. The catalogue and this module are excluded:
 * they are the machinery, not a scenario, and inlining their own source into
 * themselves would be pure weight.
 */
const SOURCES = import.meta.glob<string>(['./*.ts', '!./catalog.ts', '!./source.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

/*
 * The marker pair, and why a scenario gets more than one region.
 *
 * The interesting code is never contiguous with its imports, and a sample that
 * showed the body without the import would hide the one line the build's
 * identifier gate can actually check — `audit-build.mjs` validates a `<pre>`
 * block by its `@open-e2ee/` import statements, so a block with no imports in
 * it is a block nothing verifies. Regions are joined with a blank line in
 * source order.
 */
const REGION = /\/\* demo:code:start \*\/\n([\s\S]*?)[ \t]*\/\* demo:code:end \*\//g;

/** Remove the indentation a region carries from the function it sits in. */
function dedent(block: string): string {
  const lines = block.replace(/\s+$/, '').split('\n');
  const indents = lines.filter((line) => line.trim()).map((line) => /^ */.exec(line)![0].length);
  const shortest = Math.min(...indents);
  return lines.map((line) => line.slice(shortest)).join('\n');
}

/**
 * The marked regions of a scenario's runner, in source order.
 *
 * Throws when the module is missing or carries no marked region, rather than
 * returning an empty string. An empty code panel would read as "there is not
 * much to it", which is the most flattering possible way for this to break.
 */
export function scenarioCode(scenario: ScenarioSummary): string {
  const source = SOURCES[scenario.source];
  if (source === undefined) {
    throw new Error(
      `${scenario.slug} names ${scenario.source}, which is not a module beside the catalogue`,
    );
  }
  const regions = [...source.matchAll(REGION)].map((match) => dedent(match[1]));
  if (regions.length === 0) {
    throw new Error(
      `${scenario.source} has no demo:code region, so /demo would print an empty program beside ` +
        `a button that runs a real one`,
    );
  }
  return regions.join('\n\n');
}
