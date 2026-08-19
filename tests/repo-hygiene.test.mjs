import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * Names that are build output or installed dependencies, and must never be
 * tracked whatever shape they take on disk.
 *
 * This exists because a self-referential `node_modules` symlink reached main.
 * `.gitignore` said `node_modules/`, and a trailing slash matches a directory
 * only — a symlink of the same name is a different kind of entry and slipped
 * past it. Every clone then had a broken link where the install belongs, so
 * `npm ci` and every gate that needs it failed before running. The ignore rule
 * lost its slash in the same change; this test is the part that stays true if
 * someone writes the slash back.
 */
const ARTIFACT_NAMES = ['node_modules', 'dist', '.astro', '.wrangler'];

test('no build output or installed dependency is tracked', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);

  const offenders = tracked.filter((path) =>
    path.split('/').some((segment) => ARTIFACT_NAMES.includes(segment)),
  );

  assert.deepEqual(offenders, [], `tracked build or dependency paths:\n  ${offenders.join('\n  ')}`);
});
