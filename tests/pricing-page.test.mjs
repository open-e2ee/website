/*
 * /pricing leads with the Relay, and the Relay reads as a table.
 *
 * The page sold four SDK commercial licenses and named no Relay plan. Its
 * first rebuild put five plan columns on the page as prose lists, so a reader
 * comparing one meter across plans read five places, and the meters a buyer
 * does arithmetic on sat on another route.
 *
 * This file asserts the shape the page keeps now: the self-service plans are
 * the columns of one table, in catalog order, priced larger than they are
 * named; monthly active users are the first row and its overage the second, because a
 * buyer sizes a plan by it; every row that differs by plan is headed by a name
 * that defines itself on hover; what every plan carries closes the table under
 * one heading; one plan is marked with a tinted, padded column and carries the
 * filled action; Enterprise is one outlined band under them; the same rows
 * render again as one block per plan for narrow viewports; and the licensing
 * section follows, raised once the plans are read.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { relayMeterDefinitions, relayPlans, relayProductionRetention } from '../src/data/relay-pricing.mjs';
import { tiers } from '../src/data/pricing.mjs';
import { iconPaths } from '@open-e2ee/design/icons';

const built = await readFile(new URL('../dist/pricing/index.html', import.meta.url), 'utf8').catch(
  () => null,
);

/*
 * Read loudly rather than skipping. Every other assertion here is about
 * rendered markup, so a missing build would turn this whole file green while
 * the page it describes had never been produced.
 */
assert.ok(built, 'dist/pricing/index.html is missing; run npm run build before npm test');

const source = await readFile(new URL('../src/pages/pricing.astro', import.meta.url), 'utf8');

const selfServe = relayPlans.filter((plan) => plan.monthlyPriceUsd !== null);
const enterprise = relayPlans.find((plan) => plan.monthlyPriceUsd === null);

/* The founder's 2026-09-07 call in docs/decisions.md: Starter carries the label. */
const HIGHLIGHT = 'relay_starter_v1';
const HIGHLIGHT_LABEL = 'Most popular';

/** The Enterprise band, from its marker to the section after the plans. */
function enterpriseBand() {
  const start = built.indexOf(`data-relay-plan="${enterprise.id}"`);
  assert.ok(start !== -1, 'Enterprise has no band');
  return built.slice(start, built.indexOf('id="development"', start));
}

/** The plan table, from its opening tag to its close. */
const table = (() => {
  const start = built.indexOf('<table');
  const end = built.indexOf('</table>', start);
  assert.ok(start !== -1 && end !== -1, 'the page carries no table');
  return built.slice(start, end);
})();

/** The column head for one plan, from its marker to the next head or the body. */
function columnHead(id) {
  const start = table.indexOf(`data-relay-plan="${id}"`);
  if (start === -1) return null;
  const next = table.indexOf('<th scope="col"', start + 1);
  const body = table.indexOf('<tbody', start);
  return table.slice(start, next === -1 ? body : Math.min(next, body));
}

/** The compact block for one plan, from its marker to the next block or the list's end. */
function compactBlock(id) {
  const start = built.indexOf(`data-relay-plan-compact="${id}"`);
  if (start === -1) return null;
  const next = built.indexOf('<li ', start + 1);
  const end = built.indexOf('</ul>', start);
  return built.slice(start, next === -1 ? end : Math.min(next, end));
}

/** The rem value of a `text-[...]` utility, taking a clamp at its minimum. */
function textRem(classes) {
  const utility = classes.match(/text-\[(?:length:)?([^\]]+)\]/);
  if (!utility) return null;
  const value = utility[1].startsWith('clamp(') ? utility[1].slice(6).split(',')[0] : utility[1];
  const rem = value.match(/^([\d.]+)rem$/);
  return rem ? Number(rem[1]) : null;
}

/** The rows of the table's first body, each as its heading and its cells. */
const capacityRows = (() => {
  const start = table.indexOf('<tbody');
  const body = table.slice(start, table.indexOf('</tbody>', start));
  return [...body.matchAll(/<tr>(.*?)<\/tr>/gs)].map(([, row]) => {
    const head = row.slice(0, row.indexOf('</th>'));
    const headClasses = head.match(/^<th scope="row" class="([^"]*)"/)?.[1] ?? '';
    const label = head.match(/>([^<]+)<\/button>/)?.[1] ?? null;
    /* A value cell carries classes and no markup. The class attribute holds
     * no `>`, so a bounded match is safe here. */
    const cells = [...row.slice(row.indexOf('</th>')).matchAll(/<td class="([^"]*)">([^<]*)<\/td>/g)].map((m) => ({
      classes: m[1],
      text: m[2],
    }));
    return { head, headClasses, label, cells };
  });
})();

/** The cells of one row of the first body, by its heading. */
function cells(label) {
  const row = capacityRows.find((entry) => entry.label === label);
  assert.ok(row, `the table has no row headed ${label}`);
  return row.cells.map((cell) => cell.text);
}

/** The dialog under the plans: what every plan carries. */
const included = (() => {
  const start = built.indexOf('<dialog ');
  assert.ok(start !== -1, 'the page has no dialog');
  return built.slice(start, built.indexOf('</dialog>', start) + '</dialog>'.length);
})();

test('the self-service plans are the columns of one table, in catalog order', () => {
  /* The head's class carries a `>` (a child-combinator variant), so the
   * markers are read from the head as a whole rather than tag by tag. */
  const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
  const columns = [...head.matchAll(/data-relay-plan="([^"]+)"/g)].map((m) => m[1]);
  assert.equal((head.match(/<th scope="col"/g) ?? []).length, columns.length, 'a column head is not a th');
  assert.deepEqual(
    columns,
    selfServe.map((plan) => plan.id),
    'the table columns are not the self-service catalog, in catalog order',
  );

  for (const plan of selfServe) {
    const head = columnHead(plan.id);
    assert.ok(head.includes(`>${plan.name}</h3>`), `${plan.id} is not headed ${plan.name}`);
    assert.ok(head.includes(`>${plan.price}</p>`), `${plan.id} does not print ${plan.price}`);
    assert.match(head, /<a class="oe-button[^"]*" href="https:\/\/console\.open-e2ee\.dev\/relay\/new/);
  }

  /* Rendered from the catalog, not typed. A page that lists the plans by hand
   * passes the assertions above on the day it ships and drifts from the
   * product contract at the next plan change. */
  assert.match(source, /selfServe\.map\(/);
  assert.doesNotMatch(source, /<h3[^>]*>Starter</);
});

test('monthly active users lead the rows, their overage follows, and every cell comes from the catalog', () => {
  /* The founder's 2026-09-08 call: monthly active users are the count a buyer
   * sizes a plan by, so they are the first row under the name every buyer
   * knows, with the meter that counts them as the unit line, and the price of
   * one more sits directly under it. Every row is named by what the plan
   * provides, and the meter that counts it is the unit under its name.
   * Retention is the same on every plan, so it is not a row. */
  assert.deepEqual(
    capacityRows.map((row) => row.label),
    ['Monthly active users (MAU)', 'Additional MAU', 'Message delivery', 'Encrypted attachments', 'Encrypted storage'],
  );
  assert.deepEqual(cells('Monthly active users (MAU)'), selfServe.map((plan) => plan.relayMau));
  assert.deepEqual(cells('Additional MAU'), selfServe.map((plan) => plan.overage?.relayMau ?? 'Hard cap'));
  assert.deepEqual(cells('Message delivery'), selfServe.map((plan) => plan.deliveryUnits));
  assert.deepEqual(cells('Encrypted attachments'), selfServe.map((plan) => plan.attachmentOperations));
  assert.deepEqual(cells('Encrypted storage'), selfServe.map((plan) => plan.storage));

  const unit = (label) => capacityRows.find((row) => row.label === label).head.match(/<span class="[^"]*">([^<]*)<\/span>\s*$/)?.[1] ?? null;
  assert.equal(unit('Monthly active users (MAU)'), 'Relay MAU');
  assert.equal(unit('Message delivery'), 'Delivery units');
  assert.equal(unit('Encrypted attachments'), 'Attachment uploads');
  assert.equal(unit('Encrypted storage'), null, 'a value with its own unit needs no unit line');

  /* The leading row is the one a buyer decides by, so it is set apart by size
   * and room and not by color: its name is a step up from the other names, its
   * values are a step up again in the price's weight, and it has more space
   * above and below it than any other row. Every other value recedes. */
  const lead = capacityRows[0];
  assert.match(lead.headClasses, /\btext-\[1\.0625rem\]/);
  assert.match(lead.headClasses, /\bpt-5\b/);
  for (const cell of lead.cells) {
    assert.match(cell.classes, /\btext-text-1\b/);
    assert.match(cell.classes, /\btext-\[1\.375rem\]/);
    assert.match(cell.classes, /\bfont-medium\b/);
    assert.match(cell.classes, /\bpt-5\b/);
    assert.doesNotMatch(cell.classes, /\btext-\[var\(--oe-sealed\)\]/, 'the lead row does not borrow the accent');
  }
  for (const row of capacityRows.slice(1)) {
    assert.doesNotMatch(row.headClasses, /\btext-\[1\.0625rem\]/);
    for (const cell of row.cells) assert.match(cell.classes, /\btext-text-3\b/);
  }

  /* Delivery and storage overage price the same on every paid plan, so they
   * are one sentence in the note under the table and not two rows of one
   * repeated figure. The note also says once that allowances are monthly; a
   * row label that says it again is the explainer this page shed. */
  const note = built.slice(built.indexOf('</table>'), built.indexOf('id="development"'));
  const paid = selfServe.filter((plan) => plan.overage);
  for (const plan of paid) {
    assert.ok(note.includes(plan.overage.delivery), `the note does not price delivery overage at ${plan.overage.delivery}`);
    assert.ok(note.includes(plan.overage.storage), `the note does not price storage overage at ${plan.overage.storage}`);
  }
  assert.match(note, /allowances are monthly/);
  for (const row of capacityRows) assert.doesNotMatch(row.label, /per month|[Ee]xact|[Ee]xcess|operations/, `row label "${row.label}"`);
});

test('every row that differs by plan is headed by a name that defines itself', () => {
  /* A title attribute reaches neither a keyboard nor a touch screen. The
   * definition is a tooltip the label's button describes itself by, shown on
   * hover and focus by CSS and on a tap by the one script the component
   * ships, and the ids that bind them are unique on the page. */
  const define = (name) => relayMeterDefinitions.find((meter) => meter.name === name).definition;
  const expected = { 'Monthly active users (MAU)': define('Relay MAU'), 'Message delivery': define('Delivery unit'), 'Encrypted attachments': define('Attachment upload'), 'Encrypted storage': define('Storage') };
  for (const row of capacityRows) {
    const trigger = row.head.match(/<button type="button" class="([^"]*)" aria-describedby="([^"]+)">([^<]+)<\/button>/);
    assert.ok(trigger, `${row.label} is not a button that describes itself`);
    assert.match(trigger[1], /\bcursor-help\b/);
    assert.match(trigger[1], /\bdecoration-dotted\b/, 'the affordance is the dotted underline');
    const tooltip = row.head.match(new RegExp(`<span role="tooltip" id="${trigger[2]}" class="([^"]*)">([^<]+)</span>`));
    assert.ok(tooltip, `${row.label} has no tooltip with id ${trigger[2]}`);
    assert.match(tooltip[1], /\bgroup-hover:visible\b/);
    assert.match(tooltip[1], /\bgroup-focus-within:visible\b/);
    assert.match(tooltip[1], /\bgroup-data-\[open\]:visible\b/);
    /* A popover is the one surface above the page plane, so it is the one
     * that carries a shadow, and DESIGN.md gives every shadow an inset ring. */
    assert.match(tooltip[1], /shadow-\[var\(--oe-shadow-md\),inset_0_0_0_1px_var\(--oe-border-1\)\]/);
    assert.doesNotMatch(tooltip[1], /rounded/);
    if (expected[row.label]) assert.equal(tooltip[2], expected[row.label], `${row.label} does not carry the catalog definition`);
    else assert.ok(tooltip[2].length > 40, `${row.label} carries a definition too short to define it`);
    assert.doesNotMatch(row.head, /title="/);
  }
  const ids = [...built.matchAll(/role="tooltip" id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'two tooltips share an id');
  assert.equal(ids.length, capacityRows.length * (selfServe.length + 1), 'every rendering of every row defines itself');
  assert.equal((built.match(/Term\.astro_astro_type_script/g) ?? []).length, 1, 'the tap script is on the page once');

  /* A tooltip opens below its row, so nothing between the table and the band
   * may clip or scroll: a scroll box here cut the last rows' tooltips off and
   * counted their hidden boxes as height the table scrolled through. */
  assert.doesNotMatch(built, /data-table-scroll/, 'the page has a scroll region');
  const wrapper = built.slice(built.indexOf('id="relay-plans"'), table.length ? built.indexOf('<table') : -1);
  assert.doesNotMatch(wrapper, /overflow|contain:/, 'the table sits inside a clipping box');
});

test('what every plan carries opens in one dialog of cards from the head over the plans', () => {
  /* The table holds only the rows that differ by plan: one body, and no
   * row group for the shared rows. */
  assert.equal((table.match(/<tbody/g) ?? []).length, 1, 'the table has more than one body');
  assert.doesNotMatch(table, /rowgroup/);
  assert.doesNotMatch(table, /Included on every plan/);
  assert.doesNotMatch(built, /<details[ >]/, 'the page still has a disclosure');

  /* The plans are the page. Nothing opens it but the head over the table:
   * the label, the heading, and the lead, and at the end of the lead the one
   * control that opens what every plan carries, the page's secondary control
   * on the table's shoulder. It takes no row of its own, says it opens a
   * dialog, and is never hidden by width. */
  assert.doesNotMatch(built, /data-included-row/, 'the trigger still takes a row under the table');
  assert.equal((built.match(/<h1[ >]/g) ?? []).length, 1, 'the page does not have one heading');
  const plansStart = built.indexOf('id="relay-plans"');
  const plansClasses = built.slice(plansStart, built.indexOf('>', plansStart)).match(/class="([^"]*)"/)[1];
  assert.doesNotMatch(plansClasses, /rule-t/, 'the opening section draws a rule under the site header');
  assert.ok(built.indexOf('<h1') > plansStart, 'a hero still opens the page above the plans');
  const headStart = built.indexOf('data-plans-head');
  assert.ok(headStart > plansStart, 'the head is not inside the plans section');
  assert.ok(headStart < built.indexOf('<table'), 'the head is not above the table');
  const head = built.slice(built.lastIndexOf('<div', headStart), built.indexOf('<table'));
  const headClasses = head.match(/^<div class="([^"]*)"/)[1];
  assert.match(headClasses, /\bflex\b/);
  assert.match(headClasses, /\bitems-end\b/, "the control does not sit on the table's shoulder");
  assert.doesNotMatch(headClasses, /rule-|hidden/);
  assert.match(head, /<p class="[^"]*">Pricing<\/p>/);
  assert.match(head, /<h1>OpenE2EE Relay, free to start\.<\/h1>/);
  assert.match(head, /Pick a plan by monthly active users, the accounts active in a month\./);
  assert.match(head, /at no cost and without a card\./);
  assert.doesNotMatch(built, /<h2>OpenE2EE Relay plans<\/h2>/, 'the table still carries a second heading over the head');
  const triggerPattern = /<button type="button" class="([^"]*)" aria-haspopup="dialog" data-included-trigger>([^<]+)<\/button>/g;
  assert.equal([...built.matchAll(triggerPattern)].length, 1, 'the page does not have one trigger');
  const [trigger] = [...head.matchAll(triggerPattern)];
  assert.ok(trigger, 'the trigger is not in the head');
  assert.match(trigger[1], /^oe-button oe-button-secondary\b/, 'the trigger is not the secondary control');
  assert.doesNotMatch(trigger[1], /rule-|hidden|text-text-3|oe-button-strong/);
  assert.equal(trigger[2], 'See what is included');

  /* The dialog is closed until asked, names itself by its heading, and is the
   * one surface above the page plane, so it carries the popover shadow with
   * DESIGN.md's inset ring, on the raised ground, behind a clear backdrop:
   * overlap occludes and never blends, so there is no half-transparent scrim. */
  assert.equal((built.match(/<dialog /g) ?? []).length, 1, 'the page does not have one dialog');
  const attributes = included.slice(0, included.indexOf('>'));
  assert.doesNotMatch(attributes, /\bopen\b/, 'the dialog ships open');
  const labelId = attributes.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelId, 'the dialog does not name itself by its heading');
  assert.match(included, new RegExp(`<h2 id="${labelId}" class="[^"]*">Included on every plan</h2>`));
  const classes = attributes.match(/class="([^"]*)"/)[1];
  assert.match(classes, /shadow-\[var\(--oe-shadow-md\),inset_0_0_0_1px_var\(--oe-border-1\)\]/);
  assert.match(classes, /\bbg-ground-raised\b/);
  assert.match(classes, /\bbackdrop:bg-transparent\b/);
  assert.doesNotMatch(classes, /rounded|backdrop:bg-black|backdrop:backdrop-blur|\/\d\d\b/);
  assert.equal((built.match(/Included on every plan/g) ?? []).length, 1, 'the heading is on the page other than in the dialog');

  /* One close control in the design system's icon button, with a name a
   * screen reader can say, and the one page script that opens and closes. */
  assert.match(included, /<button type="button" class="oe-icon-button" aria-label="Close" data-included-close>/);
  assert.equal((built.match(/pricing\.astro_astro_type_script/g) ?? []).length, 1, 'the dialog script is not on the page once');

  /* These do not differ by plan, so each is one card, in the words the Relay
   * page uses: a hairline on the panel ground with a term over what it means.
   * They are not tiers, so none is a heading. Each term leads with one icon
   * from the design system's set, muted and at the text size, hidden from
   * assistive technology because the word carries the meaning. */
  assert.match(included, /<dl class="[^"]*\[--oe-icon-size:1rem\][^"]*">/, 'the cards do not size their icons');
  const cardPattern =
    /<div class="([^"]*)"><dt class="([^"]*)"><svg class="oe-icon ([^"]*)" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="([^"]+)"><\/path><\/svg>([^<]+)<\/dt><dd class="[^"]*">([^<]+)<\/dd><\/div>/g;
  const cards = [...included.matchAll(cardPattern)].map((m) => ({ classes: m[1], termClasses: m[2], iconClasses: m[3], path: m[4], label: m[5], detail: m[6] }));
  assert.doesNotMatch(included, /<h3/, 'a card carries a tier heading');
  const iconByPath = new Map(Object.entries(iconPaths).map(([name, paths]) => [paths.join(' '), name]));
  assert.deepEqual(
    cards.map((card) => iconByPath.get(card.path)),
    ['stack', 'send', 'people', 'clock', 'pulse', 'terminal'],
    'the cards do not lead with the six icons the design system ships for them',
  );
  for (const card of cards) {
    assert.match(card.termClasses, /\bflex\b/, `${card.label} does not set its icon beside the term`);
    assert.match(card.iconClasses, /\btext-text-3\b/, `${card.label} icon is not muted`);
    assert.doesNotMatch(card.iconClasses, /accent/, `${card.label} icon takes the accent`);
  }
  assert.deepEqual(
    cards.map((card) => card.label),
    ['Protocol features', 'Delivery', 'Groups and attachments', 'Ciphertext retention', 'Operations', 'Development environment'],
  );
  for (const card of cards) {
    assert.match(card.classes, /\brule\b/, `${card.label} is not a hairline card`);
    assert.match(card.classes, /\bbg-ground-panel\b/, `${card.label} is not on the panel ground`);
  }
  assert.equal(cards.find((card) => card.label === 'Delivery').detail, 'Durable encrypted device mailboxes, pull, acknowledgment, expiry, and multi-device fan-out.');
  assert.equal(cards.find((card) => card.label === 'Groups and attachments').detail, 'Bounded group fan-out and private encrypted attachment storage.');
  /* Retention is the same on every plan, so it is one card here and not a
   * row of one repeated figure, and the figure is the catalog's. */
  assert.equal(
    cards.find((card) => card.label === 'Ciphertext retention').detail,
    `${relayProductionRetention} in device mailboxes and attachment storage before ciphertext expires. A project can set a shorter retention.`,
  );
  assert.doesNotMatch(built.slice(built.indexOf('<table'), built.indexOf('</table>')), /retention/i, 'retention is still a row of the plan table');
});

test('every plan\'s action carries its name and nothing else', () => {
  for (const plan of selfServe) {
    const expected = plan.name;
    const labels = [...built.matchAll(new RegExp(`href="[^"]*plan=${plan.id}"[^>]*>([^<]+)</a>`, 'g'))].map((m) => m[1]);
    if (plan.id !== 'relay_free_v1') {
      assert.equal(labels.length, 2, `${plan.name} does not have one action per rendering`);
      for (const label of labels) assert.equal(label, expected);
    }
  }
  assert.doesNotMatch(built, /Start with /, 'an action still carries the "Start with" prefix');
  /* Free names itself like the paid plans do; "Start free" is the site
   * header's action, and the plan section carries none of it. */
  const plans = built.slice(built.indexOf('id="relay-plans"'), built.indexOf(`data-relay-plan="${enterprise.id}"`));
  assert.equal((plans.match(/>Free<\/a>/g) ?? []).length, 2, 'Free does not open with "Free" in each rendering');
  assert.doesNotMatch(plans, /Start free/, 'a plan action still reads "Start free"');
});

test('one plan is marked, and it alone carries the filled action', () => {
  const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
  assert.equal(head.split(`>${HIGHLIGHT_LABEL}<`).length - 1, 1, `the head does not carry "${HIGHLIGHT_LABEL}" exactly once`);
  assert.ok(columnHead(HIGHLIGHT).includes(`>${HIGHLIGHT_LABEL}<`), `${HIGHLIGHT} is not the marked column`);
  /* The tint is on the cells, not on a <col>: a column background is flush
   * with every cell edge and runs under the rows every plan shares. Each cell
   * carries its own padding, so the tint has an inset on all four sides, and
   * the marked head closes at the top with the 3px edge the callout uses
   * where something is settled; the other heads carry the edge in no color so
   * every name sits on one baseline. */
  assert.doesNotMatch(table, /<col class="[^"]*bg-ground-panel/);
  const markedIndex = selfServe.findIndex((plan) => plan.id === HIGHLIGHT);
  for (const plan of selfServe) {
    const classes = table.slice(table.lastIndexOf('<th scope="col"', table.indexOf(`data-relay-plan="${plan.id}"`))).match(/class="([^"]+)"/)[1];
    assert.match(classes, /\bborder-t-\[3px\]/, `${plan.id} head has no top edge`);
    assert.match(classes, /\bpx-4\b/, `${plan.id} head has no side padding`);
    assert.match(classes, /\bpt-4\b/, `${plan.id} head has no top padding`);
    if (plan.id === HIGHLIGHT) {
      assert.match(classes, /\bbg-ground-panel\b/, 'the marked head is not tinted');
      assert.match(classes, /border-t-\[var\(--oe-sealed\)\]/, 'the marked head has no sealed edge');
    } else {
      assert.doesNotMatch(classes, /bg-ground-panel/, `${plan.id} head is tinted`);
      assert.match(classes, /\bborder-t-transparent\b/, `${plan.id} head does not hold the baseline`);
    }
  }
  for (const row of capacityRows) {
    row.cells.forEach((cell, index) => {
      assert.match(cell.classes, /\bpx-4\b/, `${row.label} cell ${index} has no side padding`);
      if (index === markedIndex) assert.match(cell.classes, /\bbg-ground-panel\b/, `${row.label} is not tinted under the marked plan`);
      else assert.doesNotMatch(cell.classes, /bg-ground-panel/, `${row.label} is tinted under an unmarked plan`);
    });
  }
  /* The last row that differs by plan closes the tint with room under it. */
  for (const cell of capacityRows.at(-1).cells) assert.match(cell.classes, /\bpb-6\b/);
  for (const cell of capacityRows[0].cells) assert.match(cell.classes, /\bpt-5\b/, "the lead row does not open the tint with room under the head");

  /* The narrow rendering marks the same plan the same way. */
  for (const plan of selfServe) {
    const opening = built.slice(built.lastIndexOf('<li', built.indexOf(`data-relay-plan-compact="${plan.id}"`)));
    const classes = opening.match(/class="([^"]+)"/)[1];
    if (plan.id === HIGHLIGHT) {
      assert.match(classes, /\bbg-ground-panel\b/);
      assert.match(classes, /border-t-\[var\(--oe-sealed\)\]/);
    } else {
      assert.doesNotMatch(classes, /bg-ground-panel|oe-sealed/);
      assert.match(classes, /\brule-t\b/);
    }
  }

  for (const plan of selfServe) {
    for (const rendering of [columnHead(plan.id), compactBlock(plan.id)]) {
      const classes = rendering.match(/<a class="(oe-button[^"]*)" href=/)[1];
      if (plan.id === HIGHLIGHT) assert.doesNotMatch(classes, /oe-button-secondary|oe-button-strong/, `${plan.id} is marked but not filled`);
      else assert.match(classes, /oe-button-secondary/, `${plan.id} is filled but not marked`);
      /* Free costs nothing, so its action is the strong secondary: apart from
       * the paid secondaries, and short of the one filled control. The class is
       * a modifier of the secondary, so it rides with it or not at all. */
      if (plan.id === 'relay_free_v1') assert.match(classes, /\boe-button-secondary oe-button-strong\b/, 'Free is not the strong secondary');
      else assert.doesNotMatch(classes, /oe-button-strong/, `${plan.id} takes the strong secondary`);
      /* The lines under each button said what the note under the table and
       * "How buying works" already say. */
      assert.doesNotMatch(rendering, /Verified card|Billed monthly|Overage off|Start here/);
    }
  }
});

test('a paid plan names itself to the console, and the free plan needs no query', () => {
  for (const plan of selfServe) {
    const head = columnHead(plan.id);
    const href = head.match(/<a class="oe-button[^"]*" href="([^"]+)"/)[1];
    if (plan.id === 'relay_free_v1') {
      assert.equal(href, 'https://console.open-e2ee.dev/relay/new');
    } else {
      assert.equal(href, `https://console.open-e2ee.dev/relay/new?plan=${plan.id}`);
    }
    /* The console is the same product: the reader is leaving on purpose, and a
     * second tab holding the page they just read is litter. */
    assert.doesNotMatch(head, /target="_blank"/);
  }
});

test('the price is larger than the name it prices', () => {
  const heads = [
    ...selfServe.map((plan) => [plan.id, columnHead(plan.id)]),
    [enterprise.id, enterpriseBand()],
  ];
  for (const [id, head] of heads) {
    /* The price is the element directly after the heading, which is also the
     * reading order the column is built to produce. */
    const pair = head.match(/<h3 class="([^"]+)"[^>]*>[^<]*<\/h3><p class="([^"]+)">/);
    assert.ok(pair, `${id} does not print a price directly after its name`);
    const name = textRem(pair[1]);
    const price = textRem(pair[2]);
    assert.ok(name, `${id} names itself at no measurable size`);
    assert.ok(price, `${id} prices itself at no measurable size`);
    assert.ok(price > name, `${id} prints its name at ${name}rem over its price at ${price}rem`);
  }
});

test('the narrow rendering carries the same plans, rows, and actions', () => {
  const compact = [...built.matchAll(/data-relay-plan-compact="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(compact, selfServe.map((plan) => plan.id));

  for (const plan of selfServe) {
    const block = compactBlock(plan.id);
    const head = columnHead(plan.id);
    assert.ok(block.includes(`>${plan.name}</h3>`), `${plan.id} compact block is not headed ${plan.name}`);
    assert.ok(block.includes(`>${plan.price}</p>`), `${plan.id} compact block does not print ${plan.price}`);
    assert.equal(
      block.match(/<a class="oe-button[^"]*" href="([^"]+)"/)[1],
      head.match(/<a class="oe-button[^"]*" href="([^"]+)"/)[1],
      `${plan.id} opens two different routes in its two renderings`,
    );
    const labels = [...block.matchAll(/<dt class="[^"]*"><span class="group relative inline-block" data-term><button type="button" class="[^"]*" aria-describedby="[^"]+">([^<]+)<\/button>/g)].map((m) => m[1]);
    assert.deepEqual(labels, capacityRows.map((row) => row.label), `${plan.id} compact block does not carry the table's rows`);
    assert.equal(block.match(/<dd class="[^"]*">([^<]*)<\/dd>/)[1], plan.relayMau, `${plan.id} compact block does not lead with Relay MAU`);
  }

  /* One rendering is in the document at a time: the table above 62rem, the
   * blocks below it. Both classes are written where the two are declared. */
  assert.match(source, /const PLAN_TABLE_AT = 'max-\[62rem\]:hidden'/);
  assert.match(source, /const COMPACT = '[^']*\bmin-\[62rem\]:hidden\b/);
});

test('Enterprise is one outlined band under the table, with its own action', () => {
  const start = built.indexOf(`data-relay-plan="${enterprise.id}"`);
  assert.ok(start > built.indexOf('</table>'), 'Enterprise is not below the table');
  assert.ok(start > built.indexOf('data-relay-plan-compact='), 'Enterprise is not below the compact blocks');

  /* The band is outlined on every side with the house hairline and sits on the
   * panel ground, so it reads as the table's last row and not as a footnote. */
  const opening = built.slice(built.lastIndexOf('<div', start), start);
  const classes = opening.match(/class="([^"]+)"/)[1];
  assert.match(classes, /\brule\b/, `the Enterprise band has no hairline: ${classes}`);
  assert.match(classes, /\bbg-ground-panel\b/, `the Enterprise band has no ground: ${classes}`);
  assert.doesNotMatch(classes, /rule-t/);

  const band = enterpriseBand();
  assert.ok(band.includes(`>${enterprise.name}</h3>`));
  assert.ok(band.includes(`>${enterprise.price}</p>`));
  assert.match(band, /<a class="oe-button oe-button-secondary" href="mailto:licensing@open-e2ee\.dev/);
});

test('the licensing section follows the plans, raised in context above it', () => {
  const anchor = built.indexOf('href="#licensing"');
  const plans = built.indexOf('id="relay-plans"');
  const lastPlan = built.indexOf(`data-relay-plan="${enterprise.id}"`);
  const licensing = built.indexOf('id="licensing"');

  assert.ok(anchor !== -1, 'the page carries no in-page link to the licensing section');
  assert.ok(licensing !== -1, 'the page carries no licensing section to link to');
  assert.ok(plans < licensing, 'the licensing section is not below the Relay plans');

  /* The link is raised where a reader has just read the plans and can weigh
   * the other way of running the code, not in the hero ahead of them. */
  assert.ok(lastPlan < anchor, 'the licensing link is raised before the Relay plans are read');
  assert.ok(anchor < licensing, 'the licensing link is not above the section it points at');

  /* Every license tier still prices itself on the page it moved down within,
   * so the move did not quietly become a deletion. */
  for (const tier of tiers) {
    assert.ok(
      built.slice(licensing).includes(tier.price),
      `the licensing section does not price ${tier.name}`,
    );
  }
});

test('the meters and the Development environment are on this page', () => {
  const meters = built.indexOf('id="meters"');
  const development = built.indexOf('id="development"');
  const licensing = built.indexOf('id="licensing"');
  assert.ok(development !== -1 && meters !== -1, 'the page dropped a section the limits page carried');
  assert.ok(development < meters && meters < licensing, 'the sections are out of the order the page argues');
  for (const meter of ['Relay MAU', 'Delivery unit', 'Attachment upload', 'Storage']) {
    assert.ok(built.slice(meters, licensing).includes(`<dt>${meter}</dt>`), `${meter} is not defined`);
  }
  assert.match(built.slice(development, meters), />Development environment<\/h3>/);
});

test('no two tiers on the page answer to the same name', () => {
  /* The compact rendering repeats each self-service heading by design, so the
   * names are read once from the table and once from the ruled rows. */
  const headings = [...built.matchAll(/<h3 class="[^"]*"(?: itemprop="name")?>([^<]+)<\/h3>/g)].map((m) => m[1]);
  const names = new Set(headings);

  assert.equal(
    names.size,
    relayPlans.length + tiers.length + 1,
    `expected ${relayPlans.length + tiers.length + 1} tier names, found ${[...names]}`,
  );

  /* `Growth` names a Relay plan at $299 a month and an SDK commercial license
   * at $20,000 a year. Neither name may move — the catalog is the approved
   * product contract, and the license is a Stripe product the Console bills
   * against — so the license heading carries the word that separates them. */
  assert.ok(names.has('Growth'), 'the Relay plan Growth is not a heading');
  assert.ok(names.has('Growth license'), 'the Growth license is not headed as a license');
});

test('the page names no differentiator the product contract does not define', () => {
  for (const phrase of [
    'approved operational controls',
    'evidence-backed',
    'Plans differ by capacity, support, service terms',
  ]) {
    assert.ok(!built.includes(phrase), `the page still says "${phrase}"`);
  }
});
