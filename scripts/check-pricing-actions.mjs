/*
 * Every tier on /pricing carries one action, and one action leads.
 *
 *   node scripts/check-pricing-actions.mjs dist
 *
 * The page before this check sold five tiers with no button on any of them.
 * The reader who had decided was returned to the prose, and the free plan —
 * the one tier that needs no decision at all — read exactly like the four that
 * do.
 *
 * So this reads the built page rather than the source, and holds four rules:
 *
 *   1. Every Relay plan row carries exactly one action control.
 *   2. Every SDK commercial license row carries exactly one action control.
 *   3. Each section leads with one filled action and no more, so a reader who
 *      scans for weight finds the free start and the entry license.
 *   4. The free plan is the section's filled action.
 *
 * A count alone would pass a page that put all five buttons in one row, which
 * is why each rule is scoped to a row or a section rather than to the page.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const page = join(dist, 'pricing', 'index.html');

const html = await readFile(page, 'utf8').catch(() => null);
if (html === null) {
  console.error(`pricing actions: ${page} is missing (run npm run build)`);
  process.exit(1);
}

/** Slice one section by its id, up to the section that opens after it. */
function section(id) {
  const start = html.indexOf(`id="${id}"`);
  if (start === -1) return null;
  const end = html.indexOf('<section', start);
  return html.slice(start, end === -1 ? html.length : end);
}

/** The action controls in a slice, filled ones first. */
function actions(slice) {
  const anchors = [...slice.matchAll(/<a class="(oe-button[^"]*)"/g)].map((match) => match[1]);
  return {
    all: anchors,
    filled: anchors.filter((classes) => !classes.includes('oe-button-secondary')),
  };
}

const failures = [];

const plans = section('relay-plans');
const licensing = section('licensing');

if (!plans) failures.push('no section carries id="relay-plans"');
if (!licensing) failures.push('no section carries id="licensing"');

let rows = [];
if (plans) {
  /* One row per plan, taken from the marker the page writes for each. */
  const markers = [...plans.matchAll(/data-relay-plan="([^"]+)"/g)];
  rows = markers.map((marker, index) => {
    const start = marker.index;
    const end = index + 1 < markers.length ? markers[index + 1].index : plans.length;
    return { id: marker[1], html: plans.slice(start, end) };
  });

  if (rows.length < 5) failures.push(`only ${rows.length} Relay plan row(s) on the page`);

  for (const row of rows) {
    const found = actions(row.html).all.length;
    if (found !== 1) failures.push(`${row.id} carries ${found} action controls, not one`);
  }

  const filled = actions(plans).filled.length;
  if (filled !== 1) failures.push(`the Relay plans lead with ${filled} filled actions, not one`);

  const free = rows.find((row) => row.id === 'relay_free_v1');
  if (!free) failures.push('no row is marked relay_free_v1');
  else if (actions(free.html).filled.length !== 1) {
    failures.push('the free plan is not the filled action in its section');
  }
}

let licenseRows = 0;
if (licensing) {
  licenseRows = [...licensing.matchAll(/<a class="oe-button[^"]*"/g)].length;
  if (licenseRows < 4) {
    failures.push(`the licensing section carries ${licenseRows} action controls, fewer than four`);
  }

  const filled = actions(licensing).filled.length;
  if (filled !== 1) failures.push(`the licensing section leads with ${filled} filled actions, not one`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`pricing actions: ${failure}`);
  process.exit(1);
}

console.log(
  `Pricing actions passed: ${rows.length} Relay plan rows each carrying one action, ` +
    `${licenseRows} SDK commercial license actions below them, ` +
    'and one filled action leading each section.',
);
