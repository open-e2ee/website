import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

/*
 * House spelling in the source, which the build audit cannot reach.
 *
 * `scripts/audit-build.mjs` reads `dist`. It guards what a page shows a reader
 * and nothing else. Comments, test prose, and identifiers never render.
 *
 * The source held about 450 British forms while every built page passed. Among
 * them were 95 `colour`, 81 `licence`, 41 `centre`, and the diagram geometry
 * `centreOf`, `holeCentreY`, and `emittedColours`. This test guards the half
 * the audit cannot see. It uses the same word list, so the two cannot drift
 * apart.
 *
 * The families are the ones that shipped somewhere in the org, not a general
 * list. `artefact`, `judgement`, `acknowledgement`, and `sceptic` come from
 * this repository. The rest match `SPELLING` in the audit and
 * `test/naming.test.ts` in the console.
 *
 * `centre` and `grey` are bounded on both ends because the audit shares this
 * list and reads minified output. Minification makes word-shaped collisions
 * that never appear in source. `centRetryRequests` reads as `centre` under a
 * case-insensitive scan, exactly as `analyses` reads as `analyse`.
 */
const PATTERN =
  /colour|licence|defence|offence|pretence|behaviour|honour|candour|flavour|favour|neighbour|rumour|endeavour|artefact|acknowledgement|judgement|sceptic|\bprogrammes?\b|\b(?:centre|centred|centres)\b|\b(?:grey|greys|greyscale)\b|\banalys(?:e|ed|ing)\b|(?:labell|modell|signall|travell)(?:ed|ing|er|ers)\b|(?:generalis|characteris|organis|recognis|standardis|prioritis|scrutinis|summaris|normalis|serialis|authoris|optimis|catalogu|stylis)(?:e|ed|es|ing|ation|ations)/i;

/*
 * Both spelling tables list the words they reject, so both must skip
 * themselves. This file spells out `colour` and `mislabelled` to prove the
 * pattern catches them, and `scripts/audit-build.mjs` does the same. That file
 * also names the copy that once shipped past it.
 *
 * `.gauntlet-workbench.md` is a round-by-round log of a finished exercise. It
 * records what the exercise tried. This project does not maintain it as text.
 */
const EXCLUDED = new Set([
  'tests/spelling.test.mjs',
  'scripts/audit-build.mjs',
  '.gauntlet-workbench.md',
]);

/*
 * Copy this page dropped, quoted back so nobody restores it. Respelling a
 * quotation makes the record false. In `product.astro` it also deletes the
 * subject. That comment counts three spellings of one word. Flatten them to
 * `license` and it counts three identical strings. Empty this list and the
 * test goes red on both files, which is what keeps the list from going stale.
 */
const QUOTATIONS = [
  'Three spellings of "licence"',
  'licence offered" where the cell',
  '"A licence row is not a',
  'these are the documents it summarises"',
];

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
  for (const rejected of [
    'colour',
    'recolour',
    'grey',
    'greyscale',
    'centre',
    'centred',
    'licence',
    'candour',
    'travelling',
    'labelled',
    'mislabelled',
    'unlabelled',
    'remodelled',
    'organise',
    'recognised',
    'characterisation',
    'artefact',
    'judgement',
    'acknowledgement',
    'sceptical',
    'programme',
    'analyse',
  ]) {
    assert.ok(PATTERN.test(rejected), `${rejected} should be rejected`);
  }

  /*
   * `centRetryRequests` is the collision minification produced in `run.js`.
   * `analyses` is the American plural noun. The doubled-l family needs its
   * closing boundary and only that. The trailing `\b` excludes the ARIA
   * attribute `aria-labelledby`. A leading one would buy nothing and would let
   * every prefixed form through. The -mme family stops at the plural because
   * `programmed` is the American past tense of `program`.
   */
  for (const allowed of [
    'color',
    'gray',
    'grayscale',
    'center',
    'license',
    'organization',
    'recognized',
    'characteristics',
    'generalist',
    'optimistic',
    'artifact',
    'judgment',
    'acknowledgment',
    'skeptical',
    'program',
    'programmer',
    'programmed',
    'analyses',
    'analysis',
    'labeled',
    'traveled',
    'aria-labelledby',
    'centRetryRequests',
  ]) {
    assert.equal(PATTERN.test(allowed), false, `${allowed} should be allowed`);
  }
});
