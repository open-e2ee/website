/*
 * Every exported `Signal` spells `SignalProtocol`. The shorter forms are what
 * a person reaches for from memory, and several of them reached the marketing
 * site before the identifier gate existed.
 *
 * These tests hold the gate to the whole family rather than to the ones that
 * were caught by hand: every short form must be rejected, and each must point
 * at the real export, so the next one cannot arrive quietly.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readSdkSurface, suggest } from '../scripts/sdk-surface.mjs';

/** Confirmed nonexistent in the SDK; each is a real export minus "Protocol". */
const PRE_RENAME = [
  'ISignalRelayServer',
  'ISignalLocalStore',
  /* Each entry has to track the real export or it stops standing for
   * anything. When an adapter itself is renamed, its entry here must be
   * renamed with it — otherwise the list asserts against a name with no
   * export behind it rather than against the short form this gate is for. */
  'InMemorySignalRelayServer',
  'ConvexSignalRelayServer',
  'SignalRemoteObjectStore',
  'ExpoSignalStore',
  'IndexedDbSignalStore',
  'NodeSignalStore',
  'ExpoSecureStoreSignalSecretVault',
  'configureSignalExpoDbBindings',
];

const surface = await readSdkSurface();

test('reads a usable SDK surface to check against', () => {
  assert.ok(surface, 'the SDK must be resolvable, or the gate silently checks nothing');
  assert.ok(surface.vocabulary.size > 1000);
  assert.ok(surface.subpaths.size > 10);
});

test('rejects every pre-rename name, not just the ones that shipped', () => {
  for (const name of PRE_RENAME) {
    assert.equal(
      surface.vocabulary.has(name),
      false,
      `${name} is a pre-rename name and must not be treated as real`,
    );
  }
});

test('points each pre-rename name at the export it was meant to be', () => {
  for (const name of PRE_RENAME) {
    const real = suggest(name, surface.vocabulary);
    assert.ok(real, `${name} should suggest its renamed form`);
    assert.equal(real, name.replace(/Signal(?!Protocol)/, 'SignalProtocol'));
    assert.ok(surface.vocabulary.has(real));
  }
});

test('does not suggest a replacement for a name that is simply invented', () => {
  /* The suggestion only claims to explain the rename. Inventing a plausible
   * "did you mean" for an unrelated name would be worse than staying quiet. */
  for (const name of ['SignalProtocolTeapot', 'encryptEverything', 'ISignalProtocolMagic']) {
    assert.equal(suggest(name, surface.vocabulary), null);
  }
});
