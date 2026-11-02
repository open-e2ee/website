import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('..', import.meta.url);
const digest = (value) => createHash('sha256').update(value).digest('hex');

test('status module build is reproducible with a stable entry and a separate hashed SDK import', async () => {
  const directory = new URL('../public/analytics/', import.meta.url);
  const before = await readFile(new URL('status-v1.js', directory));
  const chunks = await readdir(new URL('status-v1/', directory));
  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /^module\.no-external-[\w-]+\.js$/);
  assert.ok(before.toString().includes(`import("./status-v1/${chunks[0]}")`));
  const sdk = await readFile(new URL(`status-v1/${chunks[0]}`, directory));
  const result = spawnSync(process.execPath, ['scripts/build-status-analytics.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(digest(await readFile(new URL('status-v1.js', directory))), digest(before));
  assert.equal(digest(await readFile(new URL(`status-v1/${chunks[0]}`, directory))), digest(sdk));
  assert.deepEqual((await readdir(directory)).sort(), ['status-v1', 'status-v1.js']);
});
