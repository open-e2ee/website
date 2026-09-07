#!/usr/bin/env node
/*
 * Asserts that the built site reaches every color ramp the design package
 * ships.
 *
 *   node scripts/check-ramp-coverage.mjs dist
 *
 * A ramp the site never reaches is a decision the design package made and the
 * product did not use. Six ramps ship, and the site drew its state, its
 * emphasis, and its diagram legend out of four of them: information and
 * failure had no color at all, so a status line said "the send did not finish"
 * in the same gray as the caption beside it.
 *
 * The reading is of the built stylesheet rather than of the source, because a
 * role reaches a rule by three hops and only the build knows all three. A
 * utility class names a role, the role layer resolves that role to a literal
 * pair, and the pair is a step of a ramp. Counting `--oe-color-` declarations
 * instead would count the ramps the design package published, which is six on
 * a site that draws none of them.
 *
 * So a ramp is reached when some ordinary declaration — a `color`, a
 * `background`, a `border-color`, never another custom property — names a
 * variable whose value resolves to one of that ramp's steps. Resolution
 * follows `var()` through as many custom properties as the chain holds, which
 * is what lets a site token defined from a role count for the role's ramp.
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const built = process.argv[2];

if (!built) {
  console.error('usage: check-ramp-coverage.mjs <built directory>');
  process.exit(2);
}

/*
 * The ramp names come from the installed package rather than from the
 * stylesheet. Read from the stylesheet they would be the ramps the site
 * happens to declare, and deleting a ramp's declarations would raise the
 * coverage rather than lower it.
 */
const primitives = JSON.parse(
  await readFile(join(root, 'node_modules/@open-e2ee/design/tokens/primitives.json'), 'utf8'),
);
const ramps = Object.keys(primitives.color);

/** Every stylesheet under the built directory, concatenated. */
async function stylesheets(directory) {
  let text = '';
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) text += await stylesheets(path);
    else if (entry.name.endsWith('.css')) text += `${await readFile(path, 'utf8')}\n`;
  }
  return text;
}

const css = await stylesheets(join(root, built));

/*
 * Every custom property, with every value declared for it. A property is
 * declared more than once: once per theme, and again in a scope that overrides
 * it. All of them count, because either theme can put a ramp on the page.
 */
const declared = new Map();
for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
  if (!declared.has(name)) declared.set(name, []);
  declared.get(name).push(value.trim());
}

/*
 * The variables that ordinary declarations name. The property test is what
 * separates a use from a definition: `--oe-canvas: var(--oe-ground-canvas)`
 * passes a value along and paints nothing, and counting it would let an
 * unused chain of aliases report a ramp as reached.
 */
const used = new Set();
for (const [, property, value] of css.matchAll(/[;{}]\s*([\w-]+)\s*:\s*([^;}]+)/g)) {
  if (property.startsWith('--')) continue;
  for (const [, name] of value.matchAll(/var\((--[\w-]+)/g)) used.add(name);
}

/** The step each ramp value belongs to, keyed by the literal the build writes. */
const steps = new Map();
for (const [ramp, entries] of Object.entries(primitives.color)) {
  for (const [step, value] of Object.entries(entries)) {
    steps.set(String(value).toLowerCase(), `${ramp}-${step}`);
  }
}

const reached = new Map(ramps.map((ramp) => [ramp, new Set()]));

/** Follow one variable to the ramp steps its value can resolve to. */
function walk(name, entry, seen) {
  if (seen.has(name)) return;
  seen.add(name);
  for (const value of declared.get(name) ?? []) {
    for (const [literal] of value.matchAll(/#[0-9a-fA-F]{6}/g)) {
      const step = steps.get(literal.toLowerCase());
      if (step) reached.get(step.replace(/-\d+$/, ''))?.add(entry);
    }
    for (const [, next] of value.matchAll(/var\((--[\w-]+)/g)) walk(next, entry, seen);
  }
}

for (const name of used) walk(name, name, new Set());

for (const ramp of ramps) {
  const names = [...reached.get(ramp)].sort();
  console.log(`${ramp.padEnd(8)} ${String(names.length).padStart(2)}  ${names.join(' ') || '—'}`);
}

const missing = ramps.filter((ramp) => reached.get(ramp).size === 0);
for (const ramp of missing) {
  console.error(`FAIL the built site reaches no step of the ${ramp} ramp`);
}
if (missing.length > 0) process.exit(1);

console.log(`PASS ${ramps.length} ramps, each reached by a declaration in the built stylesheet`);
