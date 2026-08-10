/*
 * The live panel's honesty guards, checked against the installed SDK.
 *
 * `demo-driver.test.mjs` proves the driver produces a real envelope and
 * `demo-smoke.mjs` proves the panel renders one in a browser. What neither can
 * see from where it stands is the panel's *source* quietly acquiring a
 * hand-written field list.
 *
 * That is not a hypothetical failure. The recorded capture beside it lists
 * envelope fields typed out by a person, and it drifted from ten fields to six
 * — in the direction that flattered us — on the one panel whose entire job is
 * not overstating the evidence. The live panel derives its rows from
 * `Object.entries` of the envelope, and these tests fail if anyone replaces
 * that with a list, because a list is the mechanism the drift needs.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { readSdkSurface } from '../scripts/sdk-surface.mjs';

const PANEL = new URL('../src/components/demo/LiveCarrierPanel.astro', import.meta.url);
const source = await readFile(PANEL, 'utf8');

const surface = await readSdkSurface();
const envelopeFields = surface?.members.get('Envelope');

/*
 * The fields the panel deliberately does not print, read out of the panel
 * rather than retyped here — a copy in this file would be one more list to
 * drift, which is the defect these tests exist for.
 */
const heldBack = new Set(
  [...(source.match(/HELD_BACK = new Set\(\[([^\]]*)\]\)/s)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
    (match) => match[1],
  ),
);

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

const writtenNames = new Set(
  [...source.matchAll(/['"`]([A-Za-z_$][\w$]*)['"`]/g)].map((match) => match[1]),
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

test('names no envelope field it intends to print', () => {
  const named = [...writtenNames].filter(
    (name) => envelopeFields.has(name) && !heldBack.has(name),
  );
  assert.deepEqual(
    named,
    [],
    `the panel names ${named.join(', ')} in its own source. The metadata list has to come from ` +
      `Object.entries of the live envelope; a field named here is a field that survives the SDK ` +
      `removing it, and a field the SDK adds will never appear beside it.`,
  );
});

test('holds back only fields the installed Envelope actually declares', () => {
  assert.ok(heldBack.size > 0, 'the held-back set must be readable from the panel source');
  for (const field of heldBack) {
    assert.ok(
      envelopeFields.has(field),
      `the panel withholds "${field}", which @open-e2ee/signal-protocol-sdk@${surface.version} ` +
        `does not declare on Envelope — the exclusion is stale and silently excludes nothing`,
    );
  }
});

test('takes the SDK version it advertises from the installed package', () => {
  assert.match(source, /sdkManifest\.version/);
  /* The pattern catches a quoted version literal of any shape, which is the
   * thing being banned. A pattern shaped around whatever the current version
   * happens to look like goes inert — and reads green — as soon as the next
   * version takes a different shape. */
  assert.doesNotMatch(
    source,
    /['"`]\d+\.\d+\.\d+/,
    'the panel must print the version it imported, not a version someone typed',
  );
});

test('is what the homepage renders', async () => {
  const page = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.match(page, /<LiveCarrierPanel\s*\/>/);
});

/*
 * The lead above the panel offers the reader something to do — "type a
 * sentence and the installed SDK encrypts it here". With scripts off there is
 * no field to type into, and the fallback note stays empty by design, because
 * nothing failed for that reader. Adversarial review found the page making the
 * offer to someone who could not take it, with nothing on the page admitting
 * so. A `<noscript>` is the only thing that can say it, since the script that
 * would otherwise say it is the thing that is not running.
 */
test('admits to a reader with no scripts that the panel is a recording', async () => {
  const noscript = source.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
  assert.ok(noscript, 'the panel must carry a <noscript> for the reader who has no live demo');
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
