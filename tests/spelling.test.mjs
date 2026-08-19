import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED,
  PATTERN,
  QUOTATIONS,
  REJECTED,
  SOURCE_ONLY,
  SPELLING,
} from '../scripts/spelling-table.mjs';

/*
 * House spelling in the source, which the build audit cannot reach.
 *
 * `scripts/audit-build.mjs` reads `dist`. It guards what a page shows a reader
 * and nothing else. Comments, test prose, and identifiers never render.
 *
 * Both tables and both bite lists live in `scripts/spelling-table.mjs`, which
 * explains every entry. That file is the only one either scan skips, and the
 * agreement test below is what keeps the two tables from drifting.
 */

/*
 * `scripts/spelling-table.mjs` lists the words it rejects, so the scan skips
 * it. Nothing else here is exempt for that reason.
 *
 * `.gauntlet-workbench.md` is a round-by-round log of a finished exercise. It
 * records what the exercise tried, including verbatim quotations from its
 * reviewers. This project does not maintain it as text.
 */
const EXCLUDED = new Set(['scripts/spelling-table.mjs', '.gauntlet-workbench.md']);

const SCANNED = /\.(astro|ts|mjs|js|md|css)$/;

test('the source carries no British spelling', async () => {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => path && SCANNED.test(path) && !EXCLUDED.has(path));

  const problems = [];
  for (const file of files) {
    let text = await readFile(file, 'utf8');
    for (const quotation of QUOTATIONS) text = text.split(quotation).join(' ');

    const hit = text.match(PATTERN);
    if (hit) problems.push(`${file}: "${hit[0]}"`);
  }

  assert.deepEqual(problems, [], `British spellings in source:\n  ${problems.join('\n  ')}`);
});

test('the pattern separates British forms from American look-alikes', () => {
  for (const rejected of REJECTED) {
    assert.ok(PATTERN.test(rejected), `${rejected} should be rejected`);
  }
  for (const allowed of ALLOWED) {
    assert.equal(PATTERN.test(allowed), false, `${allowed} should be allowed`);
  }
});

/*
 * The two tables agree, which is the claim this file used to make in a comment
 * and nothing enforced. They are not one literal: the built-output table is
 * bounded at the front because it reads minified scripts, and the source table
 * is not. `SOURCE_ONLY` names every word where that difference shows, so the
 * difference stays a decision rather than a drift.
 */
test('the two tables agree on every rejected word', () => {
  const caughtByAudit = (word) => SPELLING.some((rule) => rule.test(word));

  for (const rejected of REJECTED) {
    if (SOURCE_ONLY.includes(rejected)) {
      assert.equal(
        caughtByAudit(rejected),
        false,
        `${rejected} is listed as source-only, so the built-output table must not catch it`,
      );
      continue;
    }
    assert.ok(caughtByAudit(rejected), `the built-output table does not catch "${rejected}"`);
  }

  for (const allowed of ALLOWED) {
    assert.equal(caughtByAudit(allowed), false, `${allowed} should be allowed by both tables`);
  }
});
