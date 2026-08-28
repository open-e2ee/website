import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { relayMeterDefinitions, relayOverages, relayPlans } from '../src/data/relay-pricing.mjs';
import { virgilSecurityComparison } from '../src/data/virgil-security-comparison.mjs';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('publishes the exact approved Relay catalog from one data module', () => {
  assert.deepEqual(
    relayPlans.map(({ id, price, relayMau, deliveryUnits, attachmentOperations, storage }) => ({
      id,
      price,
      relayMau,
      deliveryUnits,
      attachmentOperations,
      storage,
    })),
    [
      { id: 'relay_development_v1', price: '$0', relayMau: '25 test accounts', deliveryUnits: '25,000', attachmentOperations: '25,000', storage: '250 MB' },
      { id: 'relay_free_v1', price: '$0', relayMau: '100', deliveryUnits: '100,000', attachmentOperations: '100,000', storage: '1 GB' },
      { id: 'relay_starter_v1', price: '$99', relayMau: '1,000', deliveryUnits: '500,000', attachmentOperations: '500,000', storage: '10 GB' },
      { id: 'relay_growth_v1', price: '$299', relayMau: '5,000', deliveryUnits: '2,500,000', attachmentOperations: '2,500,000', storage: '50 GB' },
      { id: 'relay_business_v1', price: '$899', relayMau: '25,000', deliveryUnits: '12,500,000', attachmentOperations: '12,500,000', storage: '250 GB' },
      { id: 'relay_enterprise_v1', price: 'Custom', relayMau: 'Negotiated', deliveryUnits: 'Negotiated', attachmentOperations: 'Negotiated', storage: 'Negotiated' },
    ],
  );
  assert.equal(relayMeterDefinitions.length, 4);
  assert.equal(relayOverages.delivery, '$55 per million delivery units');
  assert.equal(relayOverages.storage, '$0.50 per GB-month of exact live encrypted storage');
  assert.equal(relayOverages.attachmentOperations, 'Hard cap; no overage');
});

test('keeps the comparison factual, dated, sourced, and explicit about the 5,000-user ambiguity', async () => {
  const page = await source('src/pages/compare/virgil-security.astro');
  assert.equal(virgilSecurityComparison.verifiedAt, '2026-08-26');
  assert.equal(virgilSecurityComparison.sources.length, 3);
  assert.deepEqual(virgilSecurityComparison.virgilBands[1], ['251–5,000 registered users', '$99 per month']);
  assert.deepEqual(virgilSecurityComparison.virgilBands[2], ['5,000–100,000 registered users', '$0.019 per registered user per month']);
  assert.match(page, /different parts of an encrypted application/i);
  assert.match(page, /about \$95 to \$99 unless Virgil clarifies/i);
  assert.match(page, /Fairness note:/);
  assert.match(page, /Virgil vendor fee \+ customer messaging backend/);
  assert.doesNotMatch(page, /Virgil (?:is )?(?:cheaper|more expensive|equivalent)/i);
});

test('publishes canonical Relay routes with accessible responsive tables', async () => {
  const relay = await source('src/pages/relay/index.astro');
  const pricing = await source('src/pages/relay/pricing.astro');
  const comparison = await source('src/pages/compare/virgil-security.astro');
  assert.match(relay, /canonical="\/relay"/);
  assert.match(pricing, /canonical="\/relay\/pricing"/);
  assert.match(comparison, /canonical="\/compare\/virgil-security"/);
  for (const page of [pricing, comparison]) {
    assert.match(page, /class="table-scroll" tabindex="0" role="region"/);
    assert.match(page, /<th scope="col">/);
    assert.match(page, /<th scope="row">/);
  }
});
