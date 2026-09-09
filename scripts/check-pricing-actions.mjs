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
 *   1. Every Relay plan column or row carries exactly one action control. A
 *      column's action stands in the table's foot, under the rows, so a column
 *      here is its head plus its foot cell.
 *   2. Every SDK commercial license column or block carries exactly one
 *      action control, in the foot of its column as a Relay plan's is.
 *   3. Each rendering leads with one filled action and no more, so a reader who
 *      scans for weight finds the marked plan and the entry license.
 *   4. The plan marked "Most popular" is the filled action, in both renderings.
 *
 * The Relay plans and the licenses each render twice from one data set: a
 * table of columns above 62rem, and one block per column below it, with one of
 * the two in the document at a time. The rules hold on each rendering, and the
 * table and the blocks open the same routes, or the phone and the desktop sell
 * different things.
 *
 * The Enterprise band's link down to the licenses wears the button's classes
 * but leads nowhere off the page, so it is a cross-reference and not counted.
 *
 * A count alone would pass a page that put all five buttons in one row, which
 * is why each rule is scoped to a column, a row, or a rendering rather than to
 * the page.
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

/** The action controls in a slice, filled ones first. A link within the page
 * is a cross-reference in the control's clothes, not an action. */
function actions(slice) {
  const anchors = [...slice.matchAll(/<a class="(oe-button[^"]*)" href="([^"]+)"/g)]
    .filter((match) => !match[2].startsWith('#'))
    .map((match) => match[1]);
  return {
    all: anchors,
    filled: anchors.filter((classes) => !classes.includes('oe-button-secondary')),
  };
}

const failures = [];

/** The label one plan carries, and with it the filled action. */
const MARK = 'Most popular';

const plans = section('relay-plans');
const licensing = section('licensing');

if (!plans) failures.push('no section carries id="relay-plans"');
if (!licensing) failures.push('no section carries id="licensing"');

/** One slice per plan marker in a slice, each running to the next marker. */
function planSlices(slice, attribute) {
  const markers = [...slice.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))];
  return markers.map((marker, index) => {
    const start = marker.index;
    const end = index + 1 < markers.length ? markers[index + 1].index : slice.length;
    return { id: marker[1], html: slice.slice(start, end) };
  });
}

/** The first action's route in a slice, or null. */
const route = (slice) => slice.match(/<a class="oe-button[^"]*" href="([^#"][^"]*)"/)?.[1] ?? null;

let rows = [];
let blocks = [];
if (plans) {
  /* The wide rendering: the table's plan columns, then the Enterprise row. The
   * hero above the table carries the page's own actions, so the rendering
   * starts at the first plan. */
  const compactStart = plans.indexOf('data-relay-plan-compact=');
  const compactEnd = compactStart === -1 ? -1 : plans.indexOf('</ul>', compactStart);
  const tableStart = Math.max(plans.indexOf('data-relay-plan='), 0);
  const wide = (compactStart === -1 ? plans : plans.slice(0, compactStart) + plans.slice(compactEnd)).slice(tableStart);
  const tableEnd = wide.indexOf('</table>');
  const table = tableEnd === -1 ? '' : wide.slice(0, tableEnd);
  const bodyStart = table.indexOf('<tbody');
  const footStart = table.indexOf('<tfoot');
  if (bodyStart === -1 || footStart === -1) failures.push('the Relay plan table has no body or no foot');
  const heads = planSlices(table.slice(0, bodyStart === -1 ? table.length : bodyStart), 'data-relay-plan');
  const feet = planSlices(footStart === -1 ? '' : table.slice(footStart), 'data-relay-plan-action');
  if (feet.map((cell) => cell.id).join() !== heads.map((head) => head.id).join()) {
    failures.push(`the foot carries actions for ${feet.map((cell) => cell.id).join(', ') || 'no plan'} under columns ${heads.map((head) => head.id).join(', ')}`);
  }
  for (const head of heads) {
    const found = actions(head.html).all.length;
    if (found !== 0) failures.push(`${head.id} carries ${found} action control(s) in its head; the action stands in the foot`);
  }
  const columns = heads.map((head) => ({ id: head.id, html: head.html + (feet.find((cell) => cell.id === head.id)?.html ?? '') }));
  rows = [...columns, ...planSlices(tableEnd === -1 ? '' : wide.slice(tableEnd), 'data-relay-plan')];

  if (rows.length < 5) failures.push(`only ${rows.length} Relay plan column(s) and row(s) on the page`);

  for (const row of rows) {
    const found = actions(row.html).all.length;
    if (found !== 1) failures.push(`${row.id} carries ${found} action controls, not one`);
  }

  const filled = actions(wide).filled.length;
  if (filled !== 1) failures.push(`the Relay plan table leads with ${filled} filled actions, not one`);

  const marked = rows.filter((row) => row.html.includes(`>${MARK}<`));
  if (marked.length !== 1) failures.push(`${marked.length} columns carry "${MARK}", not one`);
  else if (actions(marked[0].html).filled.length !== 1) {
    failures.push(`${marked[0].id} is marked "${MARK}" but is not the filled action in its table`);
  }

  /* The narrow rendering: one block per self-service plan, same routes. */
  const compact = compactStart === -1 ? '' : plans.slice(compactStart, compactEnd);
  blocks = planSlices(compact, 'data-relay-plan-compact');
  if (blocks.length !== rows.length - 1) {
    failures.push(`${blocks.length} compact plan block(s) against ${rows.length - 1} self-service column(s)`);
  }
  for (const block of blocks) {
    const found = actions(block.html).all.length;
    if (found !== 1) failures.push(`${block.id} compact block carries ${found} action controls, not one`);
    const column = rows.find((row) => row.id === block.id);
    if (column && route(column.html) !== route(block.html)) {
      failures.push(`${block.id} opens ${route(block.html)} in its block and ${route(column.html)} in its column`);
    }
  }
  const compactFilled = actions(compact).filled.length;
  if (blocks.length > 0 && compactFilled !== 1) {
    failures.push(`the compact plan blocks lead with ${compactFilled} filled actions, not one`);
  }
  const markedBlock = blocks.filter((block) => block.html.includes(`>${MARK}<`));
  if (blocks.length > 0 && markedBlock.length !== 1) {
    failures.push(`${markedBlock.length} compact blocks carry "${MARK}", not one`);
  } else if (markedBlock.length === 1 && (marked.length !== 1 || markedBlock[0].id !== marked[0].id)) {
    failures.push(`${markedBlock[0].id} is marked in its block and ${marked[0]?.id} in its column`);
  } else if (markedBlock.length === 1 && actions(markedBlock[0].html).filled.length !== 1) {
    failures.push(`${markedBlock[0].id} is marked "${MARK}" but is not the filled action in its block`);
  }
}

let licenseColumns = [];
let licenseBlocks = [];
if (licensing) {
  /* The wide rendering: the license table's columns, head plus foot cell. */
  const compactStart = licensing.indexOf('data-license-compact=');
  const compactEnd = compactStart === -1 ? -1 : licensing.indexOf('</ul>', compactStart);
  const tableEnd = licensing.indexOf('</table>');
  const table = tableEnd === -1 ? '' : licensing.slice(0, tableEnd);
  const bodyStart = table.indexOf('<tbody');
  const footStart = table.indexOf('<tfoot');
  if (bodyStart === -1 || footStart === -1) failures.push('the license table has no body or no foot');
  const heads = planSlices(table.slice(0, bodyStart === -1 ? table.length : bodyStart), 'data-license');
  const feet = planSlices(footStart === -1 ? '' : table.slice(footStart), 'data-license-action');
  if (feet.map((cell) => cell.id).join() !== heads.map((head) => head.id).join()) {
    failures.push(`the license foot carries actions for ${feet.map((cell) => cell.id).join(', ') || 'no license'} under columns ${heads.map((head) => head.id).join(', ')}`);
  }
  for (const head of heads) {
    const found = actions(head.html).all.length;
    if (found !== 0) failures.push(`${head.id} carries ${found} action control(s) in its head; the action stands in the foot`);
  }
  licenseColumns = heads.map((head) => ({ id: head.id, html: head.html + (feet.find((cell) => cell.id === head.id)?.html ?? '') }));
  if (licenseColumns.length !== 3) failures.push(`${licenseColumns.length} license column(s) on the page, not three`);
  for (const column of licenseColumns) {
    const found = actions(column.html).all.length;
    if (found !== 1) failures.push(`${column.id} license carries ${found} action controls, not one`);
  }
  const filled = actions(table).filled.length;
  if (filled !== 1) failures.push(`the license table leads with ${filled} filled actions, not one`);

  /* The narrow rendering: one block per license, same routes. */
  const compact = compactStart === -1 ? '' : licensing.slice(compactStart, compactEnd);
  licenseBlocks = planSlices(compact, 'data-license-compact');
  if (licenseBlocks.length !== licenseColumns.length) {
    failures.push(`${licenseBlocks.length} compact license block(s) against ${licenseColumns.length} license column(s)`);
  }
  for (const block of licenseBlocks) {
    const found = actions(block.html).all.length;
    if (found !== 1) failures.push(`${block.id} compact license block carries ${found} action controls, not one`);
    const column = licenseColumns.find((entry) => entry.id === block.id);
    if (column && route(column.html) !== route(block.html)) {
      failures.push(`${block.id} license opens ${route(block.html)} in its block and ${route(column.html)} in its column`);
    }
  }
  const compactFilled = actions(compact).filled.length;
  if (licenseBlocks.length > 0 && compactFilled !== 1) {
    failures.push(`the compact license blocks lead with ${compactFilled} filled actions, not one`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`pricing actions: ${failure}`);
  process.exit(1);
}

console.log(
  `Pricing actions passed: ${rows.length} Relay plan columns and rows each carrying one action, ` +
    `${blocks.length} compact blocks opening the same routes, ` +
    `${licenseColumns.length} SDK commercial license columns and ${licenseBlocks.length} blocks below them, ` +
    'and one filled action leading each rendering.',
);
