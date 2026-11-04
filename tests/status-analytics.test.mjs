import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const digest = (value) => createHash('sha256').update(value).digest('hex');

// Maps each file path under a directory to the SHA-256 of its bytes.
async function tree(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
  const digests = await Promise.all(files.map(async (file) => [relative(directory, file), digest(await readFile(file))]));
  return Object.fromEntries(digests);
}

test('status module build is reproducible with a stable entry and a separate hashed SDK import', async () => {
  const directory = fileURLToPath(new URL('../public/analytics/', import.meta.url));
  const built = await tree(directory);
  const chunks = await readdir(join(directory, 'status-v1'));
  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /^module\.no-external-[\w-]+\.js$/);
  const entry = await readFile(join(directory, 'status-v1.js'), 'utf8');
  assert.ok(entry.includes(`import("./status-v1/${chunks[0]}")`));
  assert.deepEqual(Object.keys(built).sort(), [join('status-v1', chunks[0]), 'status-v1.js'].sort());

  const out = await mkdtemp(join(tmpdir(), 'oe-status-analytics-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/build-status-analytics.mjs', out], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(await tree(out), built);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
  assert.deepEqual(await tree(directory), built);
});
