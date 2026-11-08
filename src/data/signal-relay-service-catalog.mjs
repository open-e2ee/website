import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The repository build runs from its root. Read the source artifact because
// Astro relocates this module when it renders static pages. No runtime fetch.
export const signalRelayCatalogPin = Object.freeze({
  sourceRevision: 'b6db5bb4d24f0bff4a0dcb13f91e4765b84f5a06',
  catalogVersion: 'relay_managed_2026_11_01_v1',
  sha256: 'ddaf69635969ef8123c2361852572cfd63d334bda4361ef5108ab95ce081a967',
});

export function parsePinnedSignalProtocolRelayCatalog(bytes, pin = signalRelayCatalogPin) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== pin.sha256) throw new Error('Relay catalog SHA256 mismatch');
  const catalog = JSON.parse(bytes.toString('utf8'));
  if (catalog.schemaVersion !== 1 || catalog.currency !== 'USD' || catalog.recurrence !== 'month'
    || catalog.sourceRevision !== pin.sourceRevision
    || catalog.catalogVersion !== pin.catalogVersion) {
    throw new Error('Relay catalog identity mismatch');
  }
  return catalog;
}

export const signalRelayServiceCatalog = parsePinnedSignalProtocolRelayCatalog(
  readFileSync('src/data/vendor/signal-relay-service-catalog.json'),
);

// Format rational USD microunits without converting the rate to a float.
export function formatSignalProtocolRelayRate({ numerator, denominator }, units = 1n, minimumDecimals = 2) {
  let n = BigInt(numerator) * BigInt(units);
  const d = BigInt(denominator) * 1_000_000n;
  const whole = n / d;
  n %= d;
  let fraction = '';
  while (n !== 0n) {
    if (fraction.length === 12) throw new Error('Relay rate needs more than 12 decimal places');
    n *= 10n;
    fraction += n / d;
    n %= d;
  }
  return `$${whole}${fraction || minimumDecimals ? `.${fraction.padEnd(minimumDecimals, '0')}` : ''}`;
}
