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
 * that defines itself on hover; what every plan carries stands in its own
 * section under the plans, one card per capability, and answers the pointer; one plan is marked with a tinted, padded column and carries the
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
  return built.slice(start, built.indexOf('id="included"', start));
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

/** The foot cell for one plan, from its marker to the next cell or the row's end. */
function columnFoot(id) {
  const start = table.indexOf(`data-relay-plan-action="${id}"`);
  if (start === -1) return null;
  const next = table.indexOf('<td ', start + 1);
  const end = table.indexOf('</tr>', start);
  return table.slice(start, next === -1 ? end : Math.min(next, end));
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
    const label = head.match(/<button [^>]*>(.*?)<\/button>/)?.[1] ?? null;
    /* A value cell carries a figure, or the em dash for a price that does not
     * exist with its spoken form beside it. The class attribute holds no `>`,
     * so a bounded match is safe here. */
    const cells = [...row.slice(row.indexOf('</th>')).matchAll(/<td class="([^"]*)">(.*?)<\/td>/g)].map((m) => ({
      classes: m[1],
      text: m[2].replace(/<span class="sr-only">[^<]*<\/span>/, '').replace(/<[^>]+>/g, ''),
      spoken: m[2].match(/<span class="sr-only">([^<]*)<\/span>/)?.[1] ?? null,
      html: m[2],
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

/** The section under the plans: what every plan carries. */
const included = (() => {
  const start = built.indexOf('<section id="included"');
  assert.ok(start !== -1, 'the page has no included section');
  return built.slice(start, built.indexOf('</section>', start) + '</section>'.length);
})();

test('the self-service plans are the columns of one table, in catalog order', () => {
  /* The head's class carries a `>` (a child-combinator variant), so the
   * markers are read from the head as a whole rather than tag by tag. */
  const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
  const columns = [...head.matchAll(/data-relay-plan="([^"]+)"/g)].map((m) => m[1]);
  /* The corner names the table, the founder's 2026-09-09 call, so it is a
   * column head too: one more th than there are plans, and the first. */
  assert.equal((head.match(/<th scope="col"/g) ?? []).length, columns.length + 1, 'a column head is not a th');
  assert.match(head, /^<thead><tr><th scope="col" class="[^"]*">Signal Protocol Relay<\/th><th scope="col" class="[^"]*" data-relay-plan=/, 'the head row does not open with the table\u2019s name in its corner');
  assert.match(head.match(/<th scope="col" class="([^"]*)">Signal Protocol Relay/)[1], /\balign-top\b/, 'the name does not stand at the top of the head row');
  assert.match(built, /<p class="[^"]*min-\[62rem\]:hidden[^"]*">Signal Protocol Relay<\/p><ul class="[^"]*min-\[62rem\]:hidden/, 'the narrow rendering does not carry the table\u2019s name over the blocks');
  assert.deepEqual(
    columns,
    selfServe.map((plan) => plan.id),
    'the table columns are not the self-service catalog, in catalog order',
  );

  for (const plan of selfServe) {
    const head = columnHead(plan.id);
    assert.ok(head.includes(`>${plan.name}</h3>`), `${plan.id} is not headed ${plan.name}`);
    assert.ok(head.includes(`>${plan.price}</p>`), `${plan.id} does not print ${plan.price}`);
    assert.match(columnFoot(plan.id), /<a class="oe-button[^"]*" href="https:\/\/console\.open-e2ee\.dev\/relay\/new/, `${plan.id} has no action under its column`);
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
   * knows, and the price of one more sits directly under it. Every row is
   * named by what the plan provides, in the founder's words, in title case,
   * with no unit line under it. Retention is the same on every plan, so it is
   * not a row. */
  assert.deepEqual(
    capacityRows.map((row) => row.label),
    ['Monthly Active Users', 'Additional MAU', 'Message Delivery Units', 'Attachment Uploads', 'Encrypted Storage', 'SDK Commercial License'],
  );
  /* The founder's 2026-09-08 call: the row name stands on its own, with no
   * abbreviation on a second line. The row under it says "MAU", and the
   * definition on each spells it out. */
  assert.doesNotMatch(capacityRows[0].head, /<br>|MAU/, 'the lead row name carries more than the name');
  assert.deepEqual(cells('Monthly Active Users'), selfServe.map((plan) => plan.relayMau));
  assert.deepEqual(cells('Message Delivery Units'), selfServe.map((plan) => plan.deliveryUnits));
  assert.deepEqual(cells('Attachment Uploads'), selfServe.map((plan) => plan.attachmentOperations));
  assert.deepEqual(cells('Encrypted Storage'), selfServe.map((plan) => plan.storage));

  /* The founder's 2026-09-08 call: the one row every plan shares. A buyer with
   * a proprietary application asks whether the SDK's license reaches it before
   * asking how many users a plan carries, and the meters do not answer. The
   * Relay service terms grant the project license on every plan, Free
   * included, so every cell is the check, in the color of a thing that holds,
   * and a screen reader hears the word. The definition repeats the grant's
   * limits, so the row promises nothing the terms do not. */
  const license = capacityRows.find((row) => row.label === 'SDK Commercial License');
  assert.equal(license.cells.length, selfServe.length);
  for (const cell of license.cells) {
    assert.match(cell.html, /^<svg class="oe-icon text-success" [^>]*aria-hidden="true"/, 'the cell is not the check');
    assert.equal(cell.spoken, 'Included');
    assert.equal(cell.text, '');
  }
  assert.match(license.head, /no self-hosting right and no right to redistribute the SDK\./, 'the definition does not repeat the limits of the grant');
  const compact = built.slice(built.indexOf('data-relay-plan-compact='), built.indexOf(`data-relay-plan="${enterprise.id}"`));
  assert.equal((compact.match(/<dd class="[^"]*"><svg class="oe-icon text-success" /g) ?? []).length, selfServe.length, 'the compact blocks do not carry the check');

  /* A price that does not exist is an em dash, never $0 and never a phrase in
   * a column of figures, and a screen reader hears what the dash means. The
   * price of one more is a plain figure, and its definition says what it is per. */
  assert.deepEqual(cells('Additional MAU'), selfServe.map((plan) => plan.overage?.relayMau ?? '\u2014'));
  for (const cell of capacityRows.find((row) => row.label === 'Additional MAU').cells) {
    if (cell.text === '\u2014') {
      assert.equal(cell.html, '<span aria-hidden="true">\u2014</span><span class="sr-only">No overage</span>');
    } else {
      assert.match(cell.text, /^\$\d+\.\d\d$/, `${cell.text} is not a plain price`);
      assert.equal(cell.spoken, null);
    }
  }
  assert.doesNotMatch(table.slice(table.indexOf('<tbody')), /Hard cap|>\$0</, 'a row still spells out a price that does not exist');

  const unit = (label) => capacityRows.find((row) => row.label === label).head.match(/<span class="[^"]*">([^<]*)<\/span>\s*$/)?.[1] ?? null;
  /* The founder's 2026-09-08 call: a row name carries its meter, so no row
   * has a unit line under its name. */
  for (const row of capacityRows) assert.equal(unit(row.label), null, `${row.label} carries a unit line`);
  assert.doesNotMatch(source, /ROW_UNIT|unit\?: string/, 'the page still knows how to set a unit line');

  /* The founder's 2026-09-08 call: a value sits at the vertical center of its
   * row, so a figure beside a two-line name is level with the name and not
   * with its first line. Names keep the top, so every name in the column
   * starts on the same line as its row. */
  assert.match(table.slice(0, table.indexOf('>')), /\[&amp;_td\]:align-middle/, 'the values do not center in their rows');
  assert.match(table.slice(0, table.indexOf('>')), /\[&amp;_th\]:align-top/, 'the names do not hold the top of their rows');

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

  /* Delivery and storage overage price the same on every paid plan, so each
   * is one sentence in the definition of its row and not a row of one
   * repeated figure. The founder's 2026-09-08 call removed the note under the
   * table that used to carry them, with the self-hosting note and the two
   * links under it, and then the How buying works band. The terms stand in
   * the footer of every page, and the console binds them at checkout. A row
   * label that says "per month" is the explainer this page shed. */
  const paid = selfServe.filter((plan) => plan.overage);
  const delivery = capacityRows.find((row) => row.label === 'Message Delivery Units');
  const storage = capacityRows.find((row) => row.label === 'Encrypted Storage');
  for (const plan of paid) {
    assert.ok(delivery.head.includes(`additional units are ${plan.overage.delivery} on every paid plan`), `the delivery row does not price its overage at ${plan.overage.delivery}`);
    assert.ok(storage.head.includes(`additional storage is ${plan.overage.storage} on every paid plan`), `the storage row does not price its overage at ${plan.overage.storage}`);
  }
  const underTable = built.slice(built.indexOf('</table>'), built.indexOf('id="licensing"'));
  assert.doesNotMatch(underTable, /Prefer to operate the delivery layer|allowances are monthly|Free stops at every cap/, 'a note the founder removed still stands under the table');
  assert.doesNotMatch(underTable, /href="\/relay"|href="\/compare\/virgil-security"/, 'a link the founder removed still stands under the table');
  assert.equal(built.indexOf('How buying works'), -1, 'the How buying works band the founder cut is still on the page');
  assert.doesNotMatch(built.slice(0, built.indexOf('<footer')), /Taxes can apply|Compare self-hosted rights|Ask a licensing question|Create a project and build in its Development environment/, 'a line of the How buying works band is still on the page');
  for (const row of capacityRows) assert.doesNotMatch(row.label, /per month|[Ee]xact|[Ee]xcess|operations/, `row label "${row.label}"`);
});

test('every row that differs by plan is headed by a name that defines itself', () => {
  /* A title attribute reaches neither a keyboard nor a touch screen. The
   * definition is a tooltip the label's button describes itself by, shown on
   * hover and focus by CSS and on a tap by the one script the component
   * ships, and the ids that bind them are unique on the page. */
  const define = (name) => relayMeterDefinitions.find((meter) => meter.name === name).definition;
  const rate = (key) => {
    const rates = new Set(selfServe.flatMap((plan) => (plan.overage ? [plan.overage[key]] : [])));
    assert.equal(rates.size, 1, `paid plans price ${key} overage more than one way, so one sentence cannot state it`);
    return [...rates][0];
  };
  const expected = {
    'Monthly Active Users': define('Relay MAU'),
    'Message Delivery Units': `${define('Delivery unit')} Once overage is on, additional units are ${rate('delivery')} on every paid plan.`,
    'Attachment Uploads': `${define('Attachment upload')} A hard cap on every plan.`,
    'Encrypted Storage': `${define('Storage')} Once overage is on, additional storage is ${rate('storage')} on every paid plan.`,
  };
  for (const row of capacityRows) {
    const trigger = row.head.match(/<button type="button" class="([^"]*)" aria-describedby="([^"]+)">(.*?)<\/button>/);
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
  const plansIds = ids.filter((id) => !id.startsWith('license-'));
  assert.equal(plansIds.length, capacityRows.length * (selfServe.length + 1), 'every rendering of every row defines itself');
  assert.equal((built.match(/Term\.astro_astro_type_script/g) ?? []).length, 1, 'the tap script is on the page once');

  /* A tooltip opens below its row, so nothing between the table and the band
   * may clip or scroll: a scroll box here cut the last rows' tooltips off and
   * counted their hidden boxes as height the table scrolled through. */
  assert.doesNotMatch(built, /data-table-scroll/, 'the page has a scroll region');
  const wrapper = built.slice(built.indexOf('id="relay-plans"'), table.length ? built.indexOf('<table') : -1);
  assert.doesNotMatch(wrapper, /overflow|contain:/, 'the table sits inside a clipping box');
});

test('what every plan carries stands in one section of cards under the plans, linked from the hero', () => {
  /* The head over the table is the page's hero: one heading, one lead
   * sentence, and the two actions under it, centered over the table, the
   * primary carrying the promise as its note. There is no label over the heading;
   * the heading names the page. The founder's 2026-09-08 lead is the one
   * sentence, and the sentence that lists what Relay runs is on the Relay
   * page, not here twice. */
  const plansStart = built.indexOf('id="relay-plans"');
  const plansClasses = built.slice(built.lastIndexOf('<section', plansStart), plansStart).match(/class="([^"]*)"/)?.[1] ?? '';
  assert.doesNotMatch(plansClasses, /rule-t/, 'the opening section draws a rule under the site header');
  assert.ok(built.indexOf('<h1') > plansStart, 'a hero still opens the page above the plans');
  const headStart = built.indexOf('data-plans-head');
  assert.ok(headStart > plansStart, 'the head is not inside the plans section');
  assert.ok(headStart < built.indexOf('<table'), 'the head is not above the table');
  const head = built.slice(built.lastIndexOf('<div', headStart), built.indexOf('<table'));
  const headClasses = head.match(/^<div class="([^"]*)"/)[1];
  assert.doesNotMatch(headClasses, /rule-|hidden|flex|items-center|mx-auto/, 'the head is not a stack');
  assert.match(headClasses, /\btext-center\b/, 'the head is not centered over the table');
  assert.doesNotMatch(head, /<p class="[^"]*">Pricing<\/p>/, 'a label still stands over the heading');
  assert.match(head, /^<div class="[^"]*" data-plans-head><h1>Pricing that scales to zero\.<\/h1>/, 'the heading does not open the head');
  assert.doesNotMatch(built, /OpenE2EE Relay, free to start|Free to start, pricing that scales/, 'a heading the founder replaced on 2026-09-08 is still on the page');
  const lead = head.match(/<p class="([^"]*)">([^<]+)<\/p>/);
  assert.equal(lead[2], 'Ship fully featured end-to-end encrypted messaging, securely, and at scale.');
  assert.match(lead[1], /\bmax-w-none\b/, 'the lead is measured instead of running the width of the table');
  assert.doesNotMatch(head, /Run encrypted device mailboxes|at no cost and without a card\.|A team ships/, 'the head carries a sentence that moved');
  assert.doesNotMatch(head, /Pick a plan|Choose|Select/, 'the lead tells the reader what to do');
  assert.equal((built.match(/<h1/g) ?? []).length, 1);
  assert.doesNotMatch(built, /<h2>OpenE2EE Relay plans<\/h2>/, 'the table still carries a second heading over the head');

  /* The actions are the hero's, not the table's: the primary creates a
   * project and the secondary opens the booking page, in that order,
   * in one centered row that wraps. Both are the large control, the size the
   * design package reserves for the pair under a page's one heading, so the
   * hero's buttons are not the size of the plan buttons a screen below. The
   * primary is the stacked button, the founder's 2026-09-08 call: the promise
   * is the smaller note under "Start free" inside the control, not a line
   * under the row and not a span this site styles. The row leaves its cross
   * axis at stretch, so the link grows to the primary's height. There is one
   * such link on the page, in the hero, so the table and the compact list
   * carry none, and the corner of the head row carries the table's name. */
  const actions = head.match(/<div class="([^"]*)" data-actions="pricing">(.*?)<\/div>/s);
  assert.ok(actions, 'the head has no action row');
  assert.equal(actions[1], 'flex flex-wrap gap-4 justify-center mt-8!', 'the actions are not the site recipe, centered, at the hero\u2019s distance');
  const primary = actions[2].match(/^<a class="([^"]*)" href="([^"]+)">([^<]+)<span class="([^"]*)">([^<]+)<\/span><\/a>/);
  assert.ok(primary, 'the primary action does not lead the row as one stacked control');
  assert.equal(primary[1], 'oe-button oe-button-large oe-button-stacked');
  assert.equal(primary[2], 'https://console.open-e2ee.dev/relay/new');
  assert.equal(primary[3], 'Start free ', 'the label does not end in the space that keeps it a word apart from the note in the link\u2019s name');
  assert.equal(primary[4], 'oe-button-note', 'the note is not the design package\u2019s');
  assert.equal(primary[5], 'No credit card needed');
  assert.equal((head.match(/No credit card needed/g) ?? []).length, 1, 'the promise is on the head more than once');
  assert.doesNotMatch(head.slice(head.indexOf('data-actions="pricing"')), /<p /, 'a line still stands under the action row');
  assert.doesNotMatch(built, /Development environment · no card/, 'the old promise is still on the page');
  const linkPattern = /<a class="([^"]*)" href="([^"]+)" rel="noopener" target="_blank">Schedule a demo<span class="oe-visually-hidden"> \(opens in a new tab\)<\/span><\/a>/g;
  const links = [...built.matchAll(linkPattern)];
  assert.equal(links.length, 1, 'the page must have one demo booking action');
  assert.equal(links[0][1], 'oe-button oe-button-secondary oe-button-large', 'the link is not the large secondary control');
  assert.equal(links[0][2], 'https://calendar.app.google/AzV4HAGYh91zy4ZG7');
  assert.equal(tiers.find((tier) => tier.id === 'enterprise').cta.href, 'https://calendar.app.google/mb3PgGVCae7DFVAZ7');
  assert.notEqual(tiers.find((tier) => tier.id === 'enterprise').cta.href, links[0][2]);
  assert.doesNotMatch(built, /See what is included|https:\/\/console\.open-e2ee\.dev\/contact\?plan=enterprise/);
  assert.ok(actions[2].endsWith(links[0][0]), 'the link does not close the action row');
  assert.ok(actions[2].indexOf(primary[0]) < actions[2].indexOf(links[0][0]), 'the link stands before the primary');
  assert.doesNotMatch(built, /<dialog |data-included|aria-haspopup/, 'the dialog the founder replaced on 2026-09-08 is still on the page');
  assert.match(table.slice(table.indexOf('<thead')), /^<thead><tr><th scope="col" class="[^"]*">Signal Protocol Relay<\/th><th scope="col"/, 'the head row does not open with the table\u2019s name');

  /* The section stands right after the Enterprise band, before the licensing
   * section, names itself by its heading, and is the one place the heading
   * appears. It is a band on the page ground, so its cards on the panel ground
   * read as cards. The page ships no dialog and no script of its own now: the
   * one script left is the Term component's. */
  assert.equal((built.match(/<section id="included"/g) ?? []).length, 1, 'the page does not have one included section');
  const enterpriseEnd = built.indexOf('</section>', built.indexOf(`data-relay-plan="${enterprise.id}"`));
  assert.match(built.slice(enterpriseEnd, enterpriseEnd + 80), /^<\/section>\s*<section id="included"/, 'the section does not follow the Enterprise band directly');
  assert.ok(built.indexOf('<section id="included"') < built.indexOf('id="licensing"'), 'the section is not before licensing');
  const attributes = included.slice(0, included.indexOf('>'));
  const labelId = attributes.match(/aria-labelledby="([^"]+)"/)?.[1];
  assert.ok(labelId, 'the section does not name itself by its heading');
  /* The founder's 2026-09-09 heading names the Relay. */
  assert.match(included, new RegExp(`<h2 id="${labelId}">Signal Protocol Relay features built into every plan</h2></div>`));
  const classes = attributes.match(/class="([^"]*)"/)[1];
  assert.match(classes, /\brule-t\b/, 'the band draws no rule');
  assert.doesNotMatch(classes, /bg-ground-panel/, 'the band is on the panel ground, so its cards on the panel ground are not cards');
  /* The founder's 2026-09-08 call: the heading is the whole head. A lead that
   * said every plan carries all of these said the heading again. */
  assert.doesNotMatch(included.slice(0, included.indexOf('<dl')), /<p[ >]/, 'a lead stands under the heading');
  assert.equal((built.match(/built into every plan/gi) ?? []).length, 1, 'the heading is on the page other than over the section');
  assert.equal((built.match(/pricing\.astro_astro_type_script/g) ?? []).length, 0, 'the page still ships the dialog script');

  /* These do not differ by plan, so each is one card, in the words the Relay
   * page uses: a hairline on the panel ground with a term over what it means.
   * They are not tiers, so none is a heading. Each term leads with one icon
   * from the design system's set, muted and at the text size, hidden from
   * assistive technology because the word carries the meaning. */
  assert.match(included, /<dl class="[^"]*\[--oe-icon-size:1\.125rem\][^"]*">/, 'the cards do not size their icons');
  const cardPattern =
    /<div class="([^"]*)"><dt class="([^"]*)"><svg class="oe-icon ([^"]*)" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="([^"]+)"><\/path><\/svg>([^<]+)<\/dt><dd class="[^"]*">([^<]+)<\/dd><\/div>/g;
  const cards = [...included.matchAll(cardPattern)].map((m) => ({ classes: m[1], termClasses: m[2], iconClasses: m[3], path: m[4], label: m[5], detail: m[6] }));
  assert.doesNotMatch(included, /<h3/, 'a card carries a tier heading');
  const iconByPath = new Map(Object.entries(iconPaths).map(([name, paths]) => [paths.join(' '), name]));
  assert.deepEqual(
    cards.map((card) => iconByPath.get(card.path)),
    ['send', 'key', 'unseen', 'people', 'device', 'attachment', 'clock', 'pulse', 'terminal'],
    'the cards do not lead with the nine icons the design system ships for them',
  );
  for (const card of cards) {
    assert.match(card.termClasses, /\bflex\b/, `${card.label} does not set its icon beside the term`);
    assert.match(card.iconClasses, /\btext-text-3\b/, `${card.label} icon is not muted`);
    assert.doesNotMatch(card.iconClasses, /accent/, `${card.label} icon takes the accent`);
  }
  assert.deepEqual(
    cards.map((card) => card.label),
    [
      'Encrypted delivery',
      'Keys and sessions',
      'Sealed sender',
      'Zero-knowledge groups',
      'Multi-device',
      'Encrypted attachments',
      'Ciphertext retention',
      'Push wakes and operations',
      'Development environment',
    ],
  );
  for (const card of cards) {
    assert.match(card.classes, /\brule\b/, `${card.label} is not a hairline card`);
    assert.match(card.classes, /\bbg-ground-panel\b/, `${card.label} is not on the panel ground`);
  }
  assert.match(included, /<dl class="[^"]*\bgrid-cols-3\b[^"]*">/, 'the deck is not three across');
  /* A card answers the pointer, the founder's 2026-09-08 call: it lifts, takes
   * the hover ground and the stronger edge, casts the elevation shadow, and
   * its icon comes forward. Every part is a transition on the design
   * package's durations, which collapse under reduced motion, and the lift is
   * off there. Nothing fades, nothing morphs, and no card animates on its own. */
  for (const card of cards) {
    assert.match(card.classes, /\bgroup\b/, `${card.label} is not the group its icon answers`);
    assert.match(card.classes, /\btransition-\[transform,box-shadow,border-color,background-color\]/, `${card.label} does not transition the parts that change`);
    assert.match(card.classes, /\bduration-\[var\(--oe-duration-normal\)\]/, `${card.label} does not take its duration from the design package`);
    assert.match(card.classes, /\bhover:-translate-y-0\.5\b/, `${card.label} does not lift`);
    assert.match(card.classes, /\bhover:bg-ground-hover\b/, `${card.label} does not take the hover ground`);
    assert.match(card.classes, /\bhover:border-border-2\b/, `${card.label} does not take the stronger edge`);
    assert.match(card.classes, /\bhover:shadow-\[var\(--oe-shadow-md\)\]/, `${card.label} casts no elevation shadow`);
    assert.match(card.classes, /\bmotion-reduce:hover:translate-y-0\b/, `${card.label} still lifts under reduced motion`);
    assert.doesNotMatch(card.classes, /opacity|animate-|scale-|rotate-|blur/, `${card.label} fades, animates on its own, or morphs`);
    assert.match(card.iconClasses, /\bgroup-hover:text-text-1\b/, `${card.label} icon does not come forward on hover`);
    assert.match(card.iconClasses, /\bduration-\[var\(--oe-duration-normal\)\]/, `${card.label} icon does not take its duration from the design package`);
  }
  /* Every phrase names a route or concept the relay ships. "Zero-knowledge"
   * is the term of art for the SDK's group credentials and describes nothing
   * else on the page; sealed sender is never "anonymous". */
  assert.equal(
    cards.find((card) => card.label === 'Encrypted delivery').detail,
    'Durable encrypted device mailboxes, pull or a live connection, acknowledgment, retry requests, and bounded fan-out.',
  );
  assert.equal(cards.find((card) => card.label === 'Sealed sender').detail, 'Sender certificates, access keys, and unidentified delivery to devices and groups.');
  assert.doesNotMatch(included, /anonymous|untraceable/i, 'a card applies a banned word to sealed sender');
  assert.equal((built.match(/[Zz]ero-knowledge/g) ?? []).length, 1, '"zero-knowledge" is on the page other than as the name of the group credentials card');
  assert.equal(cards.find((card) => card.label === 'Development environment').detail, 'One with every project, at no cost and without a card.');
  /* Retention is the same on every plan, so it is one card here and not a
   * row of one repeated figure, and the figure is the catalog's. */
  assert.equal(
    cards.find((card) => card.label === 'Ciphertext retention').detail,
    `${relayProductionRetention} in device mailboxes and attachment storage before ciphertext expires. A project can set a shorter retention.`,
  );
  assert.doesNotMatch(built.slice(built.indexOf('<table'), built.indexOf('</table>')), /retention/i, 'retention is still a row of the plan table');
});

/* The founder's 2026-09-08 labels, recorded in docs/messaging.md. The plan
 * keeps its name in its heading; the action under the rows is the invitation. */
const ACTION_LABELS = {
  relay_free_v1: 'Fun &amp; Free',
  relay_starter_v1: 'Startup Starter',
  relay_growth_v1: 'Get Growing',
  relay_business_v1: 'Big Business',
};

test('every plan\'s action carries the label the founder chose for it', () => {
  const plans = built.slice(built.indexOf('id="relay-plans"'), built.indexOf(`data-relay-plan="${enterprise.id}"`));
  for (const plan of selfServe) {
    const expected = ACTION_LABELS[plan.id];
    assert.ok(expected, `${plan.id} has no label in this test`);
    const href = plan.id === 'relay_free_v1' ? 'https://console.open-e2ee.dev/relay/new' : `https://console.open-e2ee.dev/relay/new?plan=${plan.id}`;
    const labels = [...plans.matchAll(/<a class="oe-button[^"]*" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].filter((m) => m[1] === href).map((m) => m[2]);
    assert.equal(labels.length, 2, `${plan.name} does not have one action per rendering`);
    for (const label of labels) assert.equal(label, expected, `${plan.name} action reads "${label}"`);
    assert.ok(plans.includes(`>${plan.name}</h3>`), `${plan.id} is not still named ${plan.name} in its heading`);
  }
  assert.doesNotMatch(built, /Start with /, 'an action still carries the "Start with" prefix');
  /* "Start free" is the hero's primary action and the site header's; no plan
   * action reads it. */
  assert.equal((plans.match(/>Start free\b/g) ?? []).length, 1, 'the plans carry "Start free" other than once, in the hero');
  assert.ok(plans.indexOf('>Start free<') < plans.indexOf('<table'), 'the hero is not where "Start free" stands');
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
  /* The rows close flush on one another; the foot row closes the tint with
   * room under the action. */
  for (const cell of capacityRows.at(-1).cells) assert.match(cell.classes, /\bpb-3\b/);
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
    for (const rendering of [columnFoot(plan.id), compactBlock(plan.id)]) {
      const classes = rendering.match(/<a class="(oe-button[^"]*)" href=/)[1];
      if (plan.id === HIGHLIGHT) assert.doesNotMatch(classes, /oe-button-secondary|oe-button-strong/, `${plan.id} is marked but not filled`);
      else assert.match(classes, /oe-button-secondary/, `${plan.id} is filled but not marked`);
      /* Free costs nothing, so its action is the strong secondary: apart from
       * the paid secondaries, and short of the one filled control. The class is
       * a modifier of the secondary, so it rides with it or not at all. */
      if (plan.id === 'relay_free_v1') assert.match(classes, /\boe-button-secondary oe-button-strong\b/, 'Free is not the strong secondary');
      else assert.doesNotMatch(classes, /oe-button-strong/, `${plan.id} takes the strong secondary`);
      /* The lines under each button said what the table and the Relay service
       * terms already say. */
      assert.doesNotMatch(rendering, /Verified card|Billed monthly|Overage off|Start here/);
    }
  }
});

test('the actions close the table and each compact block', () => {
  /* The founder's 2026-09-08 call: a reader chooses after reading the rows.
   * The head carries no action, the foot carries one per column in column
   * order, and each foot cell closes the column's tint with room around the
   * action. */
  const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
  assert.doesNotMatch(head, /<a class="oe-button/, 'an action still stands in the head');
  const footStart = table.indexOf('<tfoot');
  assert.ok(footStart > table.indexOf('</tbody>'), 'the foot does not follow the body');
  const foot = table.slice(footStart);
  /* The corner is empty like the head's: the founder cut the instruction that
   * stood there. */
  assert.match(foot, /^<tfoot><tr><td class="rule-t pr-4"><\/td><td /, 'the foot row does not open with an empty ruled corner');
  assert.doesNotMatch(built, /Select a plan/i, 'the foot row carries an instruction');
  assert.deepEqual([...foot.matchAll(/data-relay-plan-action="([^"]+)"/g)].map((m) => m[1]), selfServe.map((plan) => plan.id));
  assert.equal((foot.match(/<a class="oe-button/g) ?? []).length, selfServe.length, 'the foot does not carry one action per plan');
  for (const plan of selfServe) {
    const cell = columnFoot(plan.id);
    const classes = table.slice(table.lastIndexOf('<td class="', table.indexOf(`data-relay-plan-action="${plan.id}"`))).match(/class="([^"]+)"/)[1];
    assert.match(classes, /\brule-t\b/, `${plan.id} foot cell has no rule over it`);
    assert.match(classes, /\bpx-4\b/, `${plan.id} foot cell has no side padding`);
    assert.match(classes, /\bpy-5\b/, `${plan.id} foot cell does not close with room`);
    if (plan.id === HIGHLIGHT) assert.match(classes, /\bbg-ground-panel\b/, 'the marked column loses its tint at the foot');
    else assert.doesNotMatch(classes, /bg-ground-panel/, `${plan.id} foot cell is tinted`);
    assert.equal((cell.match(/<a class="oe-button/g) ?? []).length, 1, `${plan.id} foot cell does not carry one action`);
    assert.match(cell, /oe-button-full/, `${plan.id} action does not fill its cell`);

    const block = compactBlock(plan.id);
    const action = block.indexOf('<a class="oe-button');
    assert.ok(action !== -1 && action > block.indexOf('</dl>'), `${plan.id} compact action does not follow the rows`);
    assert.match(block.slice(action), /^<a class="oe-button[^"]* mt-5!"/, `${plan.id} compact action does not stand off the rows`);
  }
  /* Every body row now closes flush; the foot carries the room. */
  assert.doesNotMatch(table.slice(table.indexOf('<tbody'), table.indexOf('</tbody>')), /\bpb-6\b/, 'a body row still closes the tint');
  assert.match(source, /const HEAD_CELL = `\$\{PLAN_HEAD\} border-t-\[3px\] px-4 pt-4 pb-4 font-normal`;/, 'the head still carries the room the action had');
});

test('a paid plan names itself to the console, and the free plan needs no query', () => {
  for (const plan of selfServe) {
    const head = columnFoot(plan.id);
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
  /* Enterprise prints no price, so its band is not in the set. */
  const heads = selfServe.map((plan) => [plan.id, columnHead(plan.id)]);
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
    const head = columnFoot(plan.id);
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

  /* The founder's 2026-09-09 call: the band is one row as tall as its button
   * plus padding, not the two-column grid the license rows keep, and it sits
   * close under the table. Name, detail, and the action are direct children on
   * one centerline, and no wrapper adds height of its own. The band prints no
   * price: "Custom" is not one, and it outsized the name. The founder's
   * 2026-09-09 call adds a subdued link down to the SDK licenses before the
   * action: the secondary control in the muted text, keeping to the end. */
  assert.match(classes, /\bflex\b/, 'the band is not a row');
  assert.match(classes, /\bitems-center\b/, 'the band does not center its row');
  assert.doesNotMatch(classes, /\bgrid\b|py-[5-9]|py-1\d/, `the band is taller than its button: ${classes}`);
  assert.match(classes, /\bmt-4\b/, `the band does not sit close under the table: ${classes}`);
  const band = enterpriseBand();
  const inner = band.slice(band.indexOf('>') + 1, band.indexOf('</div>'));
  assert.match(inner, new RegExp(`^<h3 class="[^"]*">${enterprise.name}</h3><p class="[^"]*">${enterprise.detail}</p><a class="oe-button oe-button-secondary [^"]*" href="#licensing">SDK commercial licenses</a><a class="oe-button oe-button-secondary[^"]*" href="https://calendar\\.app\\.google/ZpFdxaL9HZh9J7x97" rel="noopener" target="_blank">Schedule a meeting<span class="oe-visually-hidden"> \\(opens in a new tab\\)</span></a>$`), `the band is not name, detail, link, action: ${inner}`);
  assert.equal(inner.includes(enterprise.price), false, 'the band prints the Custom price the founder removed');
  const [link, action] = [...inner.matchAll(/<a class="([^"]*)"/g)].map((m) => m[1]);
  assert.match(link, /\bms-auto\b/, 'the link does not keep the controls to the end of the row');
  assert.match(link, /\btext-text-3!/, 'the link is not subdued');
  assert.doesNotMatch(action, /ms-auto|text-text-3/, 'the action is not the plain secondary control');
});

test('the licensing section follows the plans and what they carry, and states the other way to run the code', () => {
  const plans = built.indexOf('id="relay-plans"');
  const lastPlan = built.indexOf(`data-relay-plan="${enterprise.id}"`);
  const included = built.indexOf('id="included"');
  const licensing = built.indexOf('id="licensing"');

  assert.ok(licensing !== -1, 'the page carries no licensing section');
  assert.ok(plans < licensing, 'the licensing section is not below the Relay plans');

  /* The founder's 2026-09-08 call removed the note under the plans that once
   * linked here and the How buying works band that followed, so the section
   * is reached by reading down: plans, what every plan carries, then the
   * license tiers, which close the page. The other way of running the code is
   * the AGPLv3 tier's own column, and /licensing holds the self-hosting rule.
   * The one link down to the section is the Enterprise band's, the founder's
   * 2026-09-09 call. */
  assert.ok(lastPlan < included && included < licensing, 'the licensing section does not follow what every plan carries');
  const links = [...built.matchAll(/href="#licensing"/g)].map((m) => m.index);
  assert.equal(links.length, 1, `${links.length} links to the licensing section`);
  assert.ok(links[0] > lastPlan && links[0] < included, 'the link to the licensing section is not in the Enterprise band');
  assert.equal(built.indexOf('<section', licensing), -1, 'a band follows the license tiers');
  assert.ok(built.slice(licensing).includes('AGPLv3'), 'the license tiers do not name AGPLv3');

  /* Every license tier prints its price, so the move did not quietly become
   * a deletion. Enterprise prints "Custom", the founder's word for a figure
   * the contract sets. */
  for (const tier of tiers) {
    assert.ok(
      built.slice(licensing).includes(tier.price),
      `the licensing section does not price ${tier.name}`,
    );
  }
});

test('the licenses are a second table in the shape of the first: three columns, ruled rows, actions in the foot', () => {
  /* The founder's 2026-09-09 call: AGPLv3, Startup, and Enterprise. Growth and
   * Enterprise / OEM are one column here; the console keeps them apart. The
   * table is the Relay table's shape from the same classes, so a reader who
   * has read the plans reads the licenses the same way, and the narrow
   * rendering makes one block per license as it does per plan. */
  const licensing = built.slice(built.indexOf('id="licensing"'));
  const start = licensing.indexOf('<table');
  const end = licensing.indexOf('</table>', start);
  assert.ok(start !== -1 && end !== -1, 'the licensing section carries no table');
  const table = licensing.slice(start, end);
  const tableClasses = (slice) => slice.match(/^<table class="([^"]*)"/)[1];
  assert.equal(tableClasses(table), tableClasses(built.slice(built.indexOf('<table'))), 'the license table does not take the Relay table\u2019s classes');

  const head = table.slice(table.indexOf('<thead'), table.indexOf('</thead>'));
  assert.deepEqual([...head.matchAll(/data-license="([^"]+)"/g)].map((m) => m[1]), tiers.map((tier) => tier.id), 'the columns are not the license catalog in order');
  assert.deepEqual(tiers.map((tier) => tier.name), ['AGPLv3', 'Startup', 'Enterprise'], 'the public catalog is not the founder\u2019s three licenses');
  assert.match(head, /^<thead><tr><td class="pr-4"><\/td><th scope="col"/, 'the head row does not open with an empty corner');
  for (const tier of tiers) {
    const column = head.slice(head.indexOf(`data-license="${tier.id}"`));
    const own = column.slice(0, column.indexOf('</th>'));
    assert.ok(own.includes(`>${tier.name}</h3>`), `${tier.id} is not headed ${tier.name}`);
    assert.ok(own.includes(`>${tier.price}</p>`), `${tier.id} does not print ${tier.price}`);
    assert.ok(own.includes(`>${tier.note}</p>`), `${tier.id} does not carry its note`);
  }

  const body = table.slice(table.indexOf('<tbody'), table.indexOf('</tbody>'));
  const rows = [...body.matchAll(/<tr>(.*?)<\/tr>/gs)].map(([, row]) => ({
    label: row.match(/<button [^>]*>(.*?)<\/button>/)?.[1],
    lead: /text-\[1\.0625rem\]/.test(row.slice(0, row.indexOf('</th>'))),
    cells: [...row.slice(row.indexOf('</th>')).matchAll(/<td class="([^"]*)">(.*?)<\/td>/g)].map((m) => m[2]),
  }));
  assert.deepEqual(rows.map((row) => row.label), ['Closed Source', 'Products Covered', 'Redistribution', 'SDK Updates', 'Support', 'Security Review'], 'the rows are not the rights that differ by license');
  assert.deepEqual(rows.map((row) => row.lead), [true, false, false, false, false, false], 'closed source does not lead the rows');
  for (const row of rows) assert.equal(row.cells.length, tiers.length, `${row.label} does not carry one cell per license`);
  const spoken = (cell) => cell.match(/<span class="sr-only">([^<]*)<\/span>/)?.[1] ?? cell.replace(/<[^>]+>/g, '');
  assert.deepEqual(rows[0].cells.map(spoken), ['Not included', 'Included', 'Included'], 'closed source is not the free column\u2019s one absence');
  assert.deepEqual(rows[2].cells.map(spoken), ['Under AGPLv3', 'Not included', 'Negotiated'], 'redistribution does not follow the agreement');
  assert.ok(rows[0].cells[0].includes('aria-hidden="true">\u2014<'), 'a right a license does not carry is not the dash');

  const foot = table.slice(table.indexOf('<tfoot'));
  const actions = [...foot.matchAll(/data-license-action="([^"]+)"[^>]*><a class="([^"]*)" href="([^"]+)"(?: rel="noopener" target="_blank")?>([^<]+)(?:<span class="oe-visually-hidden"> \(opens in a new tab\)<\/span>)?<\/a>/g)];
  assert.deepEqual(actions.map((m) => m[1]), tiers.map((tier) => tier.id), 'the foot does not carry one action per license');
  for (const [, id, classes, href, label] of actions) {
    const tier = tiers.find((entry) => entry.id === id);
    assert.equal(href, tier.cta.href, `${id} opens ${href}`);
    assert.equal(label, tier.cta.label);
    assert.match(classes, /\boe-button-full\b/);
  }
  assert.deepEqual(actions.filter((m) => !m[2].includes('oe-button-secondary')).map((m) => m[1]), ['startup'], 'the entry license is not the one filled action');

  /* The narrow rendering: one block per license, same heads, rows, and routes. */
  const blocks = [...licensing.matchAll(/data-license-compact="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(blocks, tiers.map((tier) => tier.id), 'the compact blocks are not the license catalog');
  const compact = licensing.slice(licensing.indexOf('<ul class='), licensing.indexOf('</ul>'));
  assert.match(compact.slice(0, compact.indexOf('>')), /min-\[62rem\]:hidden/, 'the blocks do not leave the document above 62rem');
  const relayCompact = built.slice(built.indexOf('<ul class='));
  assert.equal(compact.slice(0, compact.indexOf('>')), relayCompact.slice(0, relayCompact.indexOf('>')), 'the license blocks do not stand on the plan blocks\u2019 grid');
  for (const tier of tiers) {
    const block = compact.slice(compact.indexOf(`data-license-compact="${tier.id}"`));
    const own = block.slice(0, block.indexOf('</li>'));
    assert.ok(own.includes(`>${tier.name}</h3>`), `${tier.id} compact block is not headed ${tier.name}`);
    assert.equal(own.match(/<a class="oe-button[^"]*" href="([^"]+)"/)[1], tier.cta.href, `${tier.id} opens two routes in its two renderings`);
    const labels = [...own.matchAll(/<dt class="[^"]*"><span class="group relative inline-block" data-term><button type="button" class="[^"]*" aria-describedby="[^"]+">([^<]+)<\/button>/g)].map((m) => m[1]);
    assert.deepEqual(labels, rows.map((row) => row.label), `${tier.id} compact block does not carry the table\u2019s rows`);
  }
  const licenseIds = [...built.matchAll(/role="tooltip" id="(license-[^"]+)"/g)].map((m) => m[1]);
  assert.equal(licenseIds.length, rows.length * (tiers.length + 1), 'every rendering of every license row defines itself');
});

test('the meters and the Development environment left their sections for the table and the cards', () => {
  /* The founder's 2026-09-08 call: the row names define the meters on hover,
   * so the page has no section that defines them again, and the Development
   * environment is one card of what every plan carries, so it has no band of
   * its own. Every definition the catalog carries is still on the page, in a
   * tooltip of the table, and the dropped headings are gone. */
  assert.equal(built.indexOf('id="meters"'), -1, 'the meters section is still on the page');
  assert.equal(built.indexOf('id="development"'), -1, 'the Development environment section is still on the page');
  assert.doesNotMatch(built, /What the meters count|Included with every project|defined the way the Relay service terms define them/);
  for (const meter of relayMeterDefinitions) {
    assert.ok(table.includes(meter.definition), `${meter.name} is not defined in the table`);
  }
  assert.doesNotMatch(built, /Development environment<\/h3>/, 'the Development environment is still a tier');
  assert.ok(built.indexOf('id="included"') < built.indexOf('id="licensing"'), 'the sections are out of the order the page argues');
});

test('no two tiers on the page answer to the same name', () => {
  /* The compact rendering repeats each self-service heading by design, so the
   * names are read once from the table and once from the ruled rows. */
  const headingsIn = (slice) => new Set([...slice.matchAll(/<h3 class="[^"]*"(?: itemprop="name")?>([^<]+)<\/h3>/g)].map((m) => m[1]));
  const licensing = built.indexOf('id="licensing"');
  const plans = headingsIn(built.slice(0, licensing));
  const licenses = headingsIn(built.slice(licensing));

  /* `Enterprise` names a Relay plan and an SDK commercial license, the
   * founder's 2026-09-09 catalog. Each section's headings are its own
   * catalog and nothing else, so the two share a name only across the
   * section rule, under headings that say which is which. */
  assert.deepEqual([...plans].sort(), relayPlans.map((plan) => plan.name).sort(), `the plan headings are ${[...plans]}`);
  assert.deepEqual([...licenses].sort(), tiers.map((tier) => tier.name).sort(), `the license headings are ${[...licenses]}`);
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
