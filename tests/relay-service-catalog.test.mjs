import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  formatRelayRate,
  parsePinnedRelayCatalog,
  relayCatalogPin,
  relayEarlierCatalogPin,
  relayEarlierServiceCatalog,
  relayServiceCatalog,
} from '../src/data/relay-service-catalog.mjs';
import { relayPlans } from '../src/data/relay-pricing.mjs';

const artifact = new URL('../src/data/vendor/relay-service-catalog.json', import.meta.url);
const earlierArtifact = new URL('../src/data/vendor/relay-service-catalog-2026-10-18.json', import.meta.url);

test('pins the merged Relay revision, version, and exact catalog bytes', async () => {
  assert.equal(relayCatalogPin.sourceRevision, 'b6db5bb4d24f0bff4a0dcb13f91e4765b84f5a06');
  assert.equal(relayCatalogPin.catalogVersion, 'relay_managed_2026_11_01_v1');
  assert.equal(relayCatalogPin.sha256, 'ddaf69635969ef8123c2361852572cfd63d334bda4361ef5108ab95ce081a967');
  assert.deepEqual(parsePinnedRelayCatalog(await readFile(artifact)), relayServiceCatalog);
  assert.deepEqual(relayServiceCatalog.plans.map(({ planId }) => planId), ['relay_free_v1', 'relay_hobby_v1', 'relay_starter_v1', 'relay_growth_v1', 'relay_business_v1']);
});

/* Relay enforces the Free and Sandbox limits of the earlier catalog until
 * 2026-11-01T00:00:00Z. The website reads them from that catalog's exact
 * bytes, under its own pin, and not from typed figures. */
test('pins the earlier Relay catalog that holds the Free and Sandbox limits before the cut', async () => {
  assert.equal(relayEarlierCatalogPin.sourceRevision, '3d74de4ec7859e6d15c0c38ce4203e4e07d52b49');
  assert.equal(relayEarlierCatalogPin.catalogVersion, 'relay_managed_2026_10_18_v1');
  assert.equal(relayEarlierCatalogPin.sha256, 'a5b4156e8bb9c15a1734e9647235820cbdd85c7878c5cae72bdde0e743b72da8');
  const [earlier, current] = await Promise.all([readFile(earlierArtifact), readFile(artifact)]);
  assert.deepEqual(parsePinnedRelayCatalog(earlier, relayEarlierCatalogPin), relayEarlierServiceCatalog);
  /* Each artifact passes only its own pin. */
  assert.throws(() => parsePinnedRelayCatalog(earlier), /SHA256 mismatch/);
  assert.throws(() => parsePinnedRelayCatalog(current, relayEarlierCatalogPin), /SHA256 mismatch/);
});

test('rejects drift in each price, capacity, and rational rate before reading the catalog', async () => {
  for (const [file, pin] of [[artifact, relayCatalogPin], [earlierArtifact, relayEarlierCatalogPin]]) {
    const original = await readFile(file, 'utf8');
    assert.equal(`${JSON.stringify(JSON.parse(original), null, 2)}\n`, original);
    const fields = ['monthlyPriceMicrounits', 'monthlyActiveUsers', 'deliveryUnits', 'attachmentOperations', 'storageBytes'];
    const plans = JSON.parse(original).plans.length;
    assert.equal(plans, pin === relayCatalogPin ? 5 : 4);
    for (let index = 0; index < plans; index++) {
      for (const field of fields) {
        const changed = JSON.parse(original);
        changed.plans[index][field] = typeof changed.plans[index][field] === 'string'
          ? String(BigInt(changed.plans[index][field]) + 1n) : changed.plans[index][field] + 1;
        assert.throws(() => parsePinnedRelayCatalog(Buffer.from(`${JSON.stringify(changed, null, 2)}\n`), pin), /SHA256 mismatch/, `${index} ${field}`);
      }
      if (!index) continue;
      for (const metric of ['delivery_units', 'relay_mau', 'storage_byte_month']) {
        for (const fraction of ['numerator', 'denominator']) {
          const changed = JSON.parse(original);
          changed.plans[index].overageRates[metric][fraction] = String(BigInt(changed.plans[index].overageRates[metric][fraction]) + 1n);
          assert.throws(() => parsePinnedRelayCatalog(Buffer.from(`${JSON.stringify(changed, null, 2)}\n`), pin), /SHA256 mismatch/, `${index} ${metric} ${fraction}`);
        }
      }
    }
    for (const field of ['monthlyActiveUsers', 'deliveryUnits', 'attachmentOperations', 'storageBytes']) {
      const changed = JSON.parse(original);
      changed.sandbox[field] += 1;
      assert.throws(() => parsePinnedRelayCatalog(Buffer.from(`${JSON.stringify(changed, null, 2)}\n`), pin), /SHA256 mismatch/, `sandbox ${field}`);
    }
    assert.throws(() => parsePinnedRelayCatalog(Buffer.from('{invalid'), pin), /SHA256 mismatch/);
  }
});

test('formats exact rational microunits for customer-facing rates', () => {
  assert.equal(formatRelayRate({ numerator: '3', denominator: '4000' }, 1_000_000_000n), '$0.75');
  assert.equal(formatRelayRate({ numerator: '11', denominator: '20000' }, 1_000_000_000n), '$0.55');
  assert.equal(formatRelayRate({ numerator: '1', denominator: '1000' }, 1_000_000_000n), '$1.00');
  assert.equal(formatRelayRate({ numerator: '100', denominator: '1' }, 1_000_000n, 0), '$100');
  assert.equal(formatRelayRate({ numerator: '1', denominator: '500' }, 1_000_000_000n), '$2.00');
  assert.equal(formatRelayRate({ numerator: '100000', denominator: '1' }), '$0.10');
  assert.equal(formatRelayRate({ numerator: '400', denominator: '1' }, 1_000_000n, 0), '$400');
  assert.equal(formatRelayRate({ numerator: '1', denominator: '8' }), '$0.000000125');
  assert.throws(() => formatRelayRate({ numerator: '1', denominator: '3' }), /12 decimal places/);
  assert.equal(relayPlans.find(({ id }) => id === 'relay_growth_v1').price, '$499');
});

test('both current and immutable terms state the exact catalog rows', async () => {
  for (const path of ['src/components/SignalProtocolRelayTerms20261024.astro', 'src/pages/legal/relay-terms/2026-10-24.astro']) {
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
