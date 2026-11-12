import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { signalRelaySandboxEnvironment, signalRelayPlans } from '../src/data/signal-relay-pricing.mjs';
test('Sandbox has an explicit registered-account display field while Production retains MAU', () => {
  assert.equal(signalRelaySandboxEnvironment.registeredTestAccounts, '5 test accounts');
  assert.equal(Object.hasOwn(signalRelaySandboxEnvironment,'signalRelayMau'),false);
  assert.ok(signalRelayPlans.every(plan => typeof plan.signalRelayMau === 'string'));
});
test('current future copy states reclamation without changing frozen legal versions', async () => {
  const copy = await readFile(new URL('../src/content/blog/how-signal-protocol-relay-pricing-counts-usage.mdx',import.meta.url),'utf8');
  assert.match(copy,/currently registered canonical test accounts and does not reset each month/);
  assert.match(copy,/capacityRelease: 'released'/);
  assert.match(copy,/Removing a device, clearing local storage, or reinstalling an app does not free/);
  assert.match(copy,/draft: true/);
  const terms = await readFile(new URL('../src/pages/legal/signal-relay-terms/2026-11-08.astro',import.meta.url),'utf8');
  assert.match(terms,/Sandbox environment with 5 test accounts/);
});
