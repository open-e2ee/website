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
 * Quoted strings that are a bare identifier and nothing else. A hand-typed
 * field list is written this way — `['targetUserId', 'senderDeviceId', …]` —
 * while the panel's prose mentions a field inside a longer sentence, so this
 * separates naming a field to print it from describing one to the reader.
 */
const quotedIdentifiers = new Set(
  [...source.matchAll(/['"`]([A-Za-z_$][\w$]*)['"`]/g)].map((match) => match[1]),
);

test('reads the installed SDK, or these tests check nothing', () => {
  assert.ok(surface, 'the SDK must be resolvable');
  assert.ok(envelopeFields, 'the SDK must still declare an Envelope interface');
  assert.ok(envelopeFields.size >= 10, `Envelope declares ${envelopeFields?.size} fields`);
});

test('names no envelope field it intends to print', () => {
  const named = [...quotedIdentifiers].filter(
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
  assert.doesNotMatch(
    source,
    /\d+\.\d+\.\d+-alpha/,
    'the panel must print the version it imported, not a version someone typed',
  );
});

test('is what the homepage renders', async () => {
  const page = await readFile(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.match(page, /<LiveCarrierPanel\s*\/>/);
});
