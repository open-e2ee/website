/*
 * The live console's honesty guards, checked against the installed SDK.
 *
 * `demo-driver.test.mjs` proves the driver produces a real envelope and
 * `demo-smoke.mjs` proves the relay's column renders one in a browser. What
 * neither can see from where it stands is the console's *source* quietly
 * acquiring a hand-written field list.
 *
 * That is not a hypothetical failure. The recorded capture below it lists
 * envelope fields typed out by a person, and it drifted from ten fields to six
 * — in the direction that flattered us — on the one panel whose entire job is
 * not overstating the evidence. The live console derives its rows from
 * `Object.entries` of the envelope, and these tests fail if anyone replaces
 * that with a list, because a list is the mechanism the drift needs.
 *
 * The subject is `DemoConsole.astro`, which is the panel the homepage renders.
 * A guard here that pointed at a file no page renders would be green against
 * nothing.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { readSdkSurface } from '../scripts/sdk-surface.mjs';

const PANEL = new URL('../src/components/demo/DemoConsole.astro', import.meta.url);
const source = await readFile(PANEL, 'utf8');

/* The recorded capture is a separate component and advertises the version, so
   the version guard reads it rather than the console that renders it. */
const RECORDED = new URL('../src/components/CarrierPanel.astro', import.meta.url);
const recordedSource = await readFile(RECORDED, 'utf8');

const surface = await readSdkSurface();
const envelopeFields = surface?.members.get('Envelope');

/*
 * The panel used to print a table of envelope fields and hold two of them back,
 * and the held-back list was read out of the source here so a copy could not
 * drift. There is no table now: the relay's column is the mailbox drawing and
 * the byte figure, and the only envelope values that reach the page are the two
 * addresses on the drawn envelope. So the set is empty by construction, and the
 * test that watched it is replaced below by the rule that took over its job —
 * every field is withheld, and the two that are not have to come through
 * `NAMED_FIELDS`.
 */
const heldBack = new Set();

/*
 * Every way this file can write down a field name.
 *
 * The first version of this scanned for quoted bare identifiers, on the
 * reasoning that a hand-typed list is written `['targetUserId', …]`. Adversarial
 * review walked straight through it: an object literal with *unquoted* keys —
 * `{ targetUserId: envelope.targetUserId, … }` — is the same hand-typed list,
 * spelled the way most people would actually spell it, and it passed the whole
 * suite while `demo:smoke` cheerfully reported ten derived fields.
 *
 * So the names come from a parse now, not a regex over text. The panel's
 * frontmatter and its `<script>` are read as TypeScript and every construct
 * that can name a property is collected: quoted strings, object-literal keys
 * both quoted and bare, shorthand properties, destructuring, and property
 * access. The raw regex is unioned in as well, because the markup between the
 * two blocks is not TypeScript and a quoted name can still appear there.
 *
 * This is a wider net, not a closed one. A name assembled at runtime —
 * `envelope['target' + 'UserId']` — is still invisible here, and no source scan
 * can see it. `demo-smoke.mjs` is the check that does not care how the name was
 * spelled, because it compares the rendered pane against a live envelope.
 */
function collectNames(code, into) {
  const file = ts.createSourceFile('panel.ts', code, ts.ScriptTarget.ESNext, true);
  const named = (node) => {
    if (!node) return;
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) into.add(node.text);
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) into.add(node.text);
    if (ts.isPropertyAssignment(node)) named(node.name);
    if (ts.isShorthandPropertyAssignment(node)) named(node.name);
    if (ts.isPropertyAccessExpression(node)) named(node.name);
    if (ts.isBindingElement(node)) named(node.propertyName ?? node.name);
    if (ts.isElementAccessExpression(node)) named(node.argumentExpression);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
}

/* Comments come out before the regex runs, and only for the regex: the parse
   below never saw them, because TypeScript does not put a comment in the tree.
   The union exists to cover the markup between the two blocks, which is not
   TypeScript, and a comment is not markup either — it renders nothing. The
   alternative is a file whose prose may not name the field it is explaining,
   which is how `NAMED_FIELDS`'s own note came to be about "the relay's own
   messageType". `tests/site-content.test.mjs` strips comments before the
   banned-claim sweep for the same reason. */
const writtenNames = new Set(
  [...source.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/['"`]([A-Za-z_$][\w$]*)['"`]/g)].map(
    (match) => match[1],
  ),
);
for (const block of [
  source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1],
  source.match(/<script>([\s\S]*)<\/script>/)?.[1],
]) {
  if (block) collectNames(block, writtenNames);
}

test('reads the installed SDK, or these tests check nothing', () => {
  assert.ok(surface, 'the SDK must be resolvable');
  assert.ok(envelopeFields, 'the SDK must still declare an Envelope interface');
  assert.ok(envelopeFields.size >= 10, `Envelope declares ${envelopeFields?.size} fields`);
});

/*
 * The fields the panel says it names, read out of the panel for the same reason
 * `heldBack` is. Three of them cannot be derived: something has to say which
 * envelope field carries the recipient. The point of the declaration is that
 * they are countable and checkable rather than scattered through the source,
 * so the two tests below hold it to both halves of that bargain.
 */
const named = new Set(
  [
    ...(source.match(/NAMED_FIELDS = \{([^}]*)\}/s)?.[1] ?? '').matchAll(/'([^']+)'/g),
  ].map((match) => match[1]),
);

test('names no envelope field outside the declaration that lists them', () => {
  const stray = [...writtenNames].filter(
    (name) => envelopeFields.has(name) && !heldBack.has(name) && !named.has(name),
  );
  assert.deepEqual(
    stray,
    [],
    `the panel names ${stray.join(', ')} in its own source without declaring it in NAMED_FIELDS. ` +
      `The metadata list has to come from Object.entries of the live envelope; a field named here ` +
      `is a field that survives the SDK removing it, and a field the SDK adds will never appear ` +
      `beside it.`,
  );
});

test('every envelope field it names still exists in the installed SDK', () => {
  assert.ok(named.size > 0, 'NAMED_FIELDS must be readable from the panel source');
  for (const field of named) {
    assert.ok(
      envelopeFields.has(field),
      `the panel reads "${field}" off the envelope, and ` +
        `@open-e2ee/signal-protocol-sdk@${surface.version} does not declare it on Envelope. ` +
        `Nothing throws: the addressing on the drawn envelope falls back to an em dash and the ` +
        `note under the row quotes undefined, on the one panel whose job is not overstating the ` +
        `evidence.`,
    );
  }
});

/*
 * The other half of the same bargain, in the form the panel takes now. Nothing
 * about a stored row reaches the page except the two addresses and the size, so
 * the way this file can start overstating the evidence again is by reaching
 * into the envelope for one more field — `envelope.contentHint`, a timestamp,
 * the message id — and drawing it somewhere.
 *
 * Literal reads only, which is exactly right here: the two legitimate reads go
 * through `NAMED_FIELDS`, so they are computed and invisible to this, and a
 * field spelled out in the source is the thing being ruled out. A name built at
 * runtime is beyond any source scan, and `demo-smoke.mjs` is the check that
 * does not care how it was spelled.
 */
test('reads the envelope only through the fields it declares', () => {
  const literal = [
    ...source.matchAll(/envelope(?:\.([A-Za-z_$][\w$]*)|\[\s*'([^']+)'\s*\])/g),
  ]
    .map((match) => match[1] ?? match[2])
    .filter((field) => envelopeFields.has(field));

  assert.deepEqual(
    literal,
    [],
    `the panel reads ${literal.join(', ')} straight off the envelope. The relay's column is the ` +
      `mailbox and its byte figure; an address it draws comes through NAMED_FIELDS, where the ` +
      `test above holds it to the installed SDK. A field reached for here is one nothing checks.`,
  );
});

test('takes the SDK version it advertises from the installed package', () => {
  assert.match(recordedSource, /sdkManifest\.version/);
  /* The pattern catches a quoted version literal of any shape, which is the
   * thing being banned. A pattern shaped around whatever the current version
   * happens to look like goes inert — and reads green — as soon as the next
   * version takes a different shape. */
  assert.doesNotMatch(
    recordedSource,
    /['"`]\d+\.\d+\.\d+/,
    'the panel must print the version it imported, not a version someone typed',
  );
});

test('is what the homepage renders', async () => {
  const page = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  /* Open tag rather than self-closing: the band's heading and paragraph go in
     through a slot, so the console can put Demo Settings on the heading's own
     line. */
  assert.match(page, /<DemoConsole>/);
  /* And the console is what renders the recording, so neither can be dropped
     without the other's guard here going quiet. */
  assert.match(source, /<CarrierPanel\s*\/>/);
});

/*
 * The lead above the console offers the reader something to do — "type a
 * sentence and the installed SDK encrypts it here". With scripts off the field
 * is there but inert, and the status line stays empty by design, because
 * nothing failed for that reader. Adversarial review found the page making the
 * offer to someone who could not take it, with nothing on the page admitting
 * so. A `<noscript>` is the only thing that can say it, since the script that
 * would otherwise say it is the thing that is not running.
 */
test('admits to a reader with no scripts that the panel is a recording', async () => {
  const noscript = source.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
  assert.ok(noscript, 'the console must carry a <noscript> for the reader who has no live demo');
  assert.match(
    noscript,
    /recording/i,
    'the no-script line has to name what the reader is actually looking at',
  );
  assert.match(
    noscript,
    /JavaScript/,
    'and why the live version is not there, in the reader’s own terms',
  );

  const page = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.match(
    page,
    /type a sentence/i,
    'if the lead stops promising an interaction, this guard is checking the wrong page — ' +
      'the <noscript> exists to answer that promise',
  );
});
