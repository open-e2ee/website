import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

for (const extension of ['ico', 'svg']) {
  test(`the root ${extension} favicon matches the shared brand`, async () => {
    const root = await readFile(new URL(`../public/favicon.${extension}`, import.meta.url));
    const brand = await readFile(new URL(`../public/brand/open-e2ee-favicon.${extension}`, import.meta.url));
    assert.deepEqual(root, brand);
  });
}
