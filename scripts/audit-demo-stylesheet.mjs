/*
 * The line between the page chrome and the demo drawings.
 *
 *   node scripts/audit-demo-stylesheet.mjs
 *
 * The demo, the carrier panel, the six diagrams and the two marks are
 * drawings. Their geometry is measured against the markup that draws them, so
 * a rule moved by a hand that is rewriting the page chrome moves a drawing off
 * its anchor. src/styles/demo.css holds those rules, and this script holds the
 * boundary:
 *
 *   1. The demo and diagram classes a stylesheet dresses are the ones
 *      scripts/redesign-baseline/demo-classes.txt records. A class that loses
 *      its rule leaves that roll, and a class that gains one arrives on it.
 *   2. The chrome stylesheet defines none of those classes, and none of the
 *      classes the demo stylesheet defines that a source file still names.
 *
 * Rule 1 is a recorded roll rather than a test that each name is defined,
 * because the set of names is itself derived from the stylesheets: an undefined
 * class is indistinguishable from a script hook, so it never enters the set and
 * such a test can never fail. The roll is what a deleted rule shows up in.
 *
 * Rule 2 exempts the shared layer, which is where a page-wide primitive both a
 * drawing and a page write in belongs, and which the chrome is free to
 * specialize. What the chrome may not do is hold a rule the demo needs.
 *
 * The reading measure was such a primitive and is no longer one. `MEASURE` in
 * src/lib/recipes.ts caps a line as a utility, the demo's two notes write it,
 * and the demo stylesheet no longer restates it as `.measure`.
 *
 * Two other places define a class, and both sit outside this boundary: the
 * design package, which is pinned and generated and which neither stylesheet
 * may restate, and a component's own `<style>` block, which travels with the
 * markup it dresses and cannot be broken by a chrome rewrite.
 */

import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = 'src/styles/global.css';
const DEMO = 'src/styles/demo.css';
const SHARED = 'src/styles/shared.css';

/* The roll of demo classes a stylesheet dresses, one per line, sorted. */
const ROLL = 'scripts/redesign-baseline/demo-classes.txt';

/*
 * The sources that draw the demo and the diagrams. Named rather than inferred:
 * a directory name is what makes a file part of the demo, and a list that
 * grows by accident is a boundary that moves by accident.
 */
const DEMO_SOURCES = [
  'src/components/demo',
  'src/components/diagrams',
  'src/lib/demo',
  'src/components/CarrierBoundary.astro',
  'src/components/CarrierPanel.astro',
  'src/components/CommitLine.astro',
  'src/components/SignatureDiagram.astro',
  'src/components/StarfieldMark.astro',
];

const DESIGN_STYLESHEETS = [
  '@open-e2ee/design/components.css',
  '@open-e2ee/design/roles.css',
  '@open-e2ee/design/tokens.css',
  '@open-e2ee/design/wordmark.css',
];

/** Every source file under `root`, or `root` itself when it is a file. */
function sourceFiles(root) {
  if (!statSync(root).isDirectory()) return [root];
  const found = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(astro|md|mdx|mjs|ts|tsx)$/.test(path)) found.push(path);
  }
  return found;
}

/**
 * The classes a stylesheet writes a rule for. Comments are not selectors, and
 * a selector runs to its brace: `:global(.demo-log-row button)` is one, so the
 * parentheses have to stay inside the match.
 */
function definedClasses(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const names = new Set();
  for (const rule of bare.matchAll(/([^{}@;]*)\{/g)) {
    for (const name of rule[1].matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) {
      names.add(name[1]);
    }
  }
  return names;
}

/**
 * The classes a source file names. Class attributes carry them as whitespace
 * separated tokens; a script names them through a selector string or through
 * `classList`. Interpolation is dropped, so a template-built name is invisible
 * here — `src/components/docs` in the console is the standing example of why a
 * grep sweep is not a deletion list, and why this script only ever adds a
 * requirement rather than authorizing a removal.
 */
function namedClasses(source) {
  const names = new Set();
  const attributes =
    /\bclass(?:Name|:list)?\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;
  for (const match of source.matchAll(attributes)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? '')
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/[`'",[\]?:&|]/g, ' ');
    for (const token of value.split(/\s+/)) {
      if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(token)) names.add(token);
    }
  }
  const selectors =
    /\b(?:querySelector(?:All)?|closest|matches)\s*\(\s*[`'"]([^`'"]*)[`'"]/g;
  for (const match of source.matchAll(selectors)) {
    for (const name of match[1].matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) {
      names.add(name[1]);
    }
  }
  const lists =
    /\bclassList\s*\.\s*(?:add|contains|remove|replace|toggle)\s*\(([^)]*)\)/g;
  for (const match of source.matchAll(lists)) {
    for (const name of match[1].matchAll(/[`'"]([A-Za-z][A-Za-z0-9_-]*)[`'"]/g)) {
      names.add(name[1]);
    }
  }
  return names;
}

const require = createRequire(import.meta.url);
const design = new Set();
for (const specifier of DESIGN_STYLESHEETS) {
  for (const name of definedClasses(
    readFileSync(require.resolve(specifier), 'utf8'),
  )) {
    design.add(name);
  }
}

/* A component's own `<style>` block dresses its own markup and moves with it. */
const scoped = new Set();
for (const path of sourceFiles('src')) {
  if (path.startsWith('src/styles/')) continue;
  const source = readFileSync(path, 'utf8');
  for (const block of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const name of definedClasses(block[1])) scoped.add(name);
  }
}

const chrome = definedClasses(readFileSync(CHROME, 'utf8'));
const demo = definedClasses(readFileSync(DEMO, 'utf8'));
const shared = definedClasses(readFileSync(SHARED, 'utf8'));

/*
 * What the demo needs from a stylesheet: a class its own markup or its own
 * script names, that one of the three stylesheets dresses. A class nothing
 * dresses is a hook for a script or an anchor for a link, and no stylesheet
 * owes it a rule.
 */
const needed = new Set();
for (const path of DEMO_SOURCES.flatMap(sourceFiles)) {
  for (const name of namedClasses(readFileSync(path, 'utf8'))) {
    if (design.has(name) || scoped.has(name)) continue;
    if (chrome.has(name) || demo.has(name) || shared.has(name)) needed.add(name);
  }
}

/* A demo rule a page still names is as load-bearing as one the demo names. */
const named = new Set();
for (const path of sourceFiles('src')) {
  if (path.startsWith('src/styles/')) continue;
  for (const name of namedClasses(readFileSync(path, 'utf8'))) named.add(name);
}

/*
 * The recorded set. `needed` is derived from the stylesheets, so a class that
 * loses its rule leaves the set rather than arriving in a list of undefined
 * ones — which is why an "is it defined" test written against `needed` cannot
 * fail. The roll is what makes the loss visible, and it makes a class that
 * quietly gains a rule visible in the same read.
 */
const recorded = readFileSync(ROLL, 'utf8').split('\n').filter(Boolean);
const current = [...needed].sort();
const dropped = recorded.filter((name) => !needed.has(name));
const arrived = current.filter((name) => !recorded.includes(name));

const boundary = new Set([
  ...needed,
  ...[...demo].filter((name) => named.has(name)),
]);
const held = [...boundary].filter(
  (name) => chrome.has(name) && !shared.has(name),
);

const failures = [];
if (dropped.length > 0) {
  failures.push(
    `no stylesheet dresses these any more: ${dropped.join(', ')} ` +
      `(restore the rule, or drop the name from ${ROLL})`,
  );
}
if (arrived.length > 0) {
  failures.push(
    `dressed but not recorded: ${arrived.join(', ')} (add them to ${ROLL})`,
  );
}
if (held.length > 0) {
  failures.push(
    `${CHROME} still defines demo classes: ${held.sort().join(', ')}`,
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`demo stylesheet: ${failure}`);
  process.exit(1);
}

console.log(
  `Demo stylesheet audit passed: ${needed.size} class(es) named by the demo and diagram sources ` +
    `and dressed by a stylesheet, all ${recorded.length} of them on the roll, ` +
    `${demo.size} defined in ${DEMO}, ${shared.size} in ${SHARED}, none of them in ${CHROME}.`,
);
