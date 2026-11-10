/**
 * The website scope of the NM-FD25 naming entries.
 *
 * scripts/check-signal-relay-naming.mjs accepts an NM-FD25 entry only for a
 * role name, such as adapters.<word> or hosted.<word>Url
 * (docs/decisions.md#sdk-role-names-20261109). This repository limits the
 * entries to SDK usage in the demo and example code, and in the tests that
 * check that code. Every other website identifier keeps the signal prefix.
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROLE_OWNER = 'NM-FD25';
const NAMING_ALLOWLIST = 'scripts/signal-relay-naming-allowlist.txt';
const NAMING_GUARD = join(ROOT, 'scripts/check-signal-relay-naming.mjs');

/** The demo, the playground, and the blog code samples. */
const ROLE_SCOPE_DIRECTORIES = ['playground/src/', 'src/lib/demo/', 'src/content/blog/'];

/** The hero sample, the carrier capture, and the tests that check the demo and example code. */
const ROLE_SCOPE_FILES = new Set([
  'scripts/record-carrier-capture.mjs',
  'src/components/HeroSnippet.astro',
  'src/data/carrier-capture.json',
  'src/lib/hero-snippet.mjs',
  'tests/demo-driver.test.mjs',
  'tests/demo-run.test.mjs',
  'tests/demo-signal-relay.test.mjs',
  'tests/site-content.test.mjs',
]);

function inRoleScope(path) {
  return ROLE_SCOPE_DIRECTORIES.some((directory) => path.startsWith(directory)) || ROLE_SCOPE_FILES.has(path);
}

test('each NM-FD25 naming entry is in the demo or example code', async () => {
  const text = await readFile(join(ROOT, NAMING_ALLOWLIST), 'utf8');
  const entries = text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([owner]) => owner === ROLE_OWNER);
  assert.ok(entries.length > 0, `found no ${ROLE_OWNER} entries`);
  const outside = entries.filter(([, path]) => !inRoleScope(path)).map((entry) => entry.join(' '));
  assert.deepEqual(outside, [], `${ROLE_OWNER} entries outside the scope:\n  ${outside.join('\n  ')}`);
});

test('the NM-FD25 scope holds the demo and example code only', () => {
  for (const path of [
    'playground/src/exchange.ts',
    'src/lib/demo/run.ts',
    'src/content/blog/tls-is-not-end-to-end-encryption.mdx',
    'src/lib/hero-snippet.mjs',
    'tests/demo-signal-relay.test.mjs',
  ]) {
    assert.equal(inRoleScope(path), true, `${path} should be in the scope`);
  }
  for (const path of [
    'src/pages/signal-relay/index.astro',
    'src/pages/product.astro',
    'src/lib/demo',
    'src/content/',
    'playground/index.html',
    'scripts/audit-build.mjs',
    'tests/signal-relay-connection.test.mjs',
    'tests/signal-relay-naming-scope.test.mjs',
  ]) {
    assert.equal(inRoleScope(path), false, `${path} should be outside the scope`);
  }
});

test('the naming guard fails a bare role name in another website file with no entry', (t) => {
  // The fixture assembles the word so that this file holds no hit of its own.
  const word = ['r', 'e', 'l', 'a', 'y'].join('');
  const root = mkdtempSync(join(tmpdir(), 'website-naming-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {
    'src/lib/demo/run.ts': `const alice = await open({ adapters: { ${word} } });\n`,
    'src/pages/connect.ts': `export function connect(${word}: unknown) {}\n`,
    [NAMING_ALLOWLIST]: `${ROLE_OWNER} src/lib/demo/run.ts ${word}\n`,
  };
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  execFileSync('git', ['add', '--all'], { cwd: root });

  const result = spawnSync(process.execPath, [NAMING_GUARD, '--root', root, '--no-base'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.deepEqual(lines.slice(0, -1), [`src/pages/connect.ts: ${word} (not in the allowlist)`]);
});
