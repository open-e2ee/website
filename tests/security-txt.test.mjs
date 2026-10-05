/*
 * /.well-known/security.txt is the RFC 9116 answer to "where do I report a
 * vulnerability". It is public text that a researcher and a scanner both read,
 * so every field is held to the policy the site already states.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SDK_REPO, docs, reporting } from '../src/lib/assurance.mjs';

const text = await readFile(new URL('../public/.well-known/security.txt', import.meta.url), 'utf8');
const fields = text
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const colon = line.indexOf(': ');
    return [line.slice(0, colon), line.slice(colon + 2)];
  });
const valuesOf = (name) => fields.filter(([field]) => field === name).map(([, value]) => value);

test('names the reporting channels the security policy names', () => {
  assert.deepEqual(valuesOf('Contact'), [
    `mailto:${reporting.address}`,
    `${SDK_REPO}/security/advisories/new`,
  ]);
  assert.deepEqual(valuesOf('Policy'), [docs.reporting]);
  assert.deepEqual(valuesOf('Canonical'), ['https://open-e2ee.dev/.well-known/security.txt']);
});

test('carries one Expires that has not passed', () => {
  const [expires, ...rest] = valuesOf('Expires');
  assert.deepEqual(rest, [], 'RFC 9116 allows exactly one Expires');
  assert.match(expires, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  /* An expired file tells a researcher the contact is stale, so this fails on
   * the day it lapses. Renew the date in the file; do not relax the check. */
  assert.ok(Date.parse(expires) > Date.now(), `security.txt expired on ${expires}`);
});

test('holds only fields RFC 9116 defines and no personal identifier', () => {
  const known = ['Contact', 'Expires', 'Preferred-Languages', 'Canonical', 'Policy'];
  for (const [field] of fields) assert.ok(known.includes(field), `unknown field ${field}`);
  const addresses = text.match(/[^\s:]+@[^\s]+/g) ?? [];
  assert.deepEqual(addresses, [reporting.address]);
});
