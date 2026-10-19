import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { formatRelayRate, parsePinnedRelayCatalog, relayCatalogPin, relayServiceCatalog } from '../src/data/relay-service-catalog.mjs';
import { relayPlans } from '../src/data/relay-pricing.mjs';

const artifact = new URL('../src/data/vendor/relay-service-catalog.json', import.meta.url);

test('pins the merged Relay revision, version, and exact catalog bytes', async () => {
  assert.equal(relayCatalogPin.sourceRevision, '3d74de4ec7859e6d15c0c38ce4203e4e07d52b49');
  assert.equal(relayCatalogPin.catalogVersion, 'relay_managed_2026_10_18_v1');
  assert.equal(relayCatalogPin.sha256, 'a5b4156e8bb9c15a1734e9647235820cbdd85c7878c5cae72bdde0e743b72da8');
  assert.deepEqual(parsePinnedRelayCatalog(await readFile(artifact)), relayServiceCatalog);
});

test('rejects drift in each price, capacity, and rational rate before reading the catalog', async () => {
  const original = await readFile(artifact, 'utf8');
  assert.equal(`${JSON.stringify(JSON.parse(original), null, 2)}\n`, original);
  const fields = ['monthlyPriceMicrounits', 'monthlyActiveUsers', 'deliveryUnits', 'attachmentOperations', 'storageBytes'];
  for (let index = 0; index < 4; index++) {
    for (const field of fields) {
      const changed = JSON.parse(original);
      changed.plans[index][field] = typeof changed.plans[index][field] === 'string'
        ? String(BigInt(changed.plans[index][field]) + 1n) : changed.plans[index][field] + 1;
      assert.throws(() => parsePinnedRelayCatalog(Buffer.from(`${JSON.stringify(changed, null, 2)}\n`)), /SHA256 mismatch/, `${index} ${field}`);
    }
    if (!index) continue;
    for (const metric of ['delivery_units', 'relay_mau', 'storage_byte_month']) {
      for (const fraction of ['numerator', 'denominator']) {
        const changed = JSON.parse(original);
        changed.plans[index].overageRates[metric][fraction] = String(BigInt(changed.plans[index].overageRates[metric][fraction]) + 1n);
        assert.throws(() => parsePinnedRelayCatalog(Buffer.from(`${JSON.stringify(changed, null, 2)}\n`)), /SHA256 mismatch/, `${index} ${metric} ${fraction}`);
      }
    }
  }
  assert.throws(() => parsePinnedRelayCatalog(Buffer.from('{invalid')), /SHA256 mismatch/);
});

test('formats exact rational microunits for customer-facing rates', () => {
  assert.equal(formatRelayRate({ numerator: '3', denominator: '4000' }, 1_000_000_000n), '$0.75');
  assert.equal(formatRelayRate({ numerator: '11', denominator: '20000' }, 1_000_000_000n), '$0.55');
  assert.equal(formatRelayRate({ numerator: '1', denominator: '1000' }, 1_000_000_000n), '$1.00');
  assert.equal(formatRelayRate({ numerator: '100', denominator: '1' }, 1_000_000n, 0), '$100');
  assert.equal(formatRelayRate({ numerator: '1', denominator: '8' }), '$0.000000125');
  assert.throws(() => formatRelayRate({ numerator: '1', denominator: '3' }), /12 decimal places/);
  assert.equal(relayPlans.find(({ id }) => id === 'relay_growth_v1').price, '$499');
});

test('both current and immutable terms state the exact catalog rows', async () => {
  for (const path of ['src/components/SignalProtocolRelayTerms20261018.astro', 'src/pages/legal/relay-terms/2026-10-18.astro']) {
    const terms = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    const rows = [...terms.matchAll(/<tr><th scope="row">([^<]+)<\/th>(.*?)<\/tr>/g)];
    for (const plan of relayPlans.filter(({ monthlyPriceUsd }) => monthlyPriceUsd !== null)) {
      const row = rows.find(([, name]) => name === plan.name);
      assert.ok(row, `${path} ${plan.name}`);
      assert.deepEqual([...row[2].matchAll(/<td>([^<]+)<\/td>/g)].map(([, cell]) => cell), [
        plan.price, plan.relayMau, plan.deliveryUnits, plan.attachmentOperations, plan.storage,
        plan.overage?.relayMau ?? 'Hard cap', plan.overage?.delivery ?? 'Hard cap', plan.overage?.storage ?? 'Hard cap',
      ], `${path} ${plan.name}`);
    }
  }
});
