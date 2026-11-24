import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { signalRelayPlans, signalRelaySandboxEnvironment } from '../src/data/signal-relay-pricing.mjs';

test('Sandbox shows registered test accounts while Production plans keep MAU', () => {
  assert.equal(signalRelaySandboxEnvironment.registeredTestAccounts, '5 test accounts');
  assert.equal(Object.hasOwn(signalRelaySandboxEnvironment, 'signalRelayMau'), false);
  assert.ok(signalRelayPlans.every((plan) => typeof plan.signalRelayMau === 'string'));
});

test('the usage post explains Sandbox reclamation and the dated terms stay unchanged', async () => {
  const post = await readFile(new URL('../src/content/blog/how-signal-protocol-relay-pricing-counts-usage.mdx', import.meta.url), 'utf8');
  assert.match(post, /currently registered canonical test accounts and does not reset each month/);
  assert.match(post, /When no slot is available, the Relay refuses new accounts\./);
  assert.doesNotMatch(post, /accounts wait/);
  assert.match(post, /capacityRelease: 'released'/);
  assert.match(post, /Removing a device, clearing local storage, or reinstalling an app does not free/);
  assert.match(post, /draft: true/);
  const terms = await readFile(new URL('../src/pages/legal/signal-relay-terms/2026-11-24.astro', import.meta.url), 'utf8');
  assert.match(terms, /Sandbox environment with 5 test accounts/);
});
