/*
 * The build audit's check on links into the public repository, held to the
 * behaviours it is claimed to have.
 *
 * `/demo` shipped a link to `docs/DEVICE_LIFECYCLE.md`, which lives in the
 * internal repository and is not on the export allowlist, so the URL was a 404
 * on production from the day it shipped — reachable to whoever wrote it and to
 * nobody else. The check that catches that was added with the fix, and was then
 * described in a pull request as "proven against fixtures reproducing the LD6
 * defect" when no fixture existed anywhere: it had been proven by hand, once,
 * and nothing held it afterwards. A check with no test is a check that works
 * until someone edits it, which for a link checker means it goes quiet rather
 * than wrong. These are those fixtures.
 *
 * Each case builds a one-page `dist` in a temporary directory and runs the real
 * audit over it, because the check reads the installed package to decide what
 * the public repository publishes, and a unit test of the regex alone would
 * assert nothing about that. The page holds its URLs as text rather than in
 * `<a>` tags so that the off-site-link rules, which are a different check, stay
 * out of these results.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { readSdkSurface } from '../scripts/sdk-surface.mjs';

const run = promisify(execFile);
const AUDIT = join(dirname(new URL(import.meta.url).pathname), '..', 'scripts', 'audit-build.mjs');
const BLOB = 'https://github.com/open-e2ee/signal-protocol-js/blob/main';

const surface = await readSdkSurface();
const docsDir = surface ? join(surface.root, 'docs') : null;

/*
 * A real exported document of each kind, read from the package rather than
 * named here. Hard-coding `ASSURANCE.md` would make this suite fail the day the
 * export allowlist changed, which is a fact about the SDK and not a defect in
 * the check under test.
 */
const someDoc = docsDir && existsSync(docsDir) ? (await readdir(docsDir)).find((f) => f.endsWith('.md')) : null;
const someRootDoc = 'README.md';

/** Runs the audit over a dist containing one page with `body` in it. */
async function audit(body) {
  const dir = await mkdtemp(join(tmpdir(), 'oe-audit-'));
  try {
    await writeFile(join(dir, 'index.html'), `<html><body><p>${body}</p></body></html>`);
    try {
      const { stdout } = await run(process.execPath, [AUDIT, dir]);
      return { ok: true, output: stdout };
    } catch (failure) {
      return { ok: false, output: `${failure.stdout}${failure.stderr}` };
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the SDK resolves, or every case below passes for the wrong reason', () => {
  assert.ok(surface, 'no installed SDK: the audit cannot judge any link and these tests prove nothing');
  assert.ok(someDoc, 'the installed package ships no docs/*.md to link to');
});

test('accepts a link to a document the public repository exports', async () => {
  const result = await audit(`${BLOB}/docs/${someDoc}`);
  assert.ok(result.ok, `a link to a real exported doc must pass:\n${result.output}`);
});

test('rejects a link to a document it does not export, naming the file', async () => {
  const result = await audit(`${BLOB}/docs/DEVICE_LIFECYCLE.md`);
  assert.equal(result.ok, false, 'the LD6 defect must fail the build');
  assert.match(result.output, /docs\/DEVICE_LIFECYCLE\.md/);
  assert.match(result.output, /404/);
});

test('accepts a link to a root-level document', async () => {
  const result = await audit(`${BLOB}/${someRootDoc}`);
  assert.ok(result.ok, `a link to a real root-level doc must pass:\n${result.output}`);
});

test('rejects a root-level document that does not exist', async () => {
  const result = await audit(`${BLOB}/ARCHITECTURE_OVERVIEW.md`);
  assert.equal(result.ok, false, 'root-level links were exempt from this check until N7');
  assert.match(result.output, /ARCHITECTURE_OVERVIEW\.md/);
});

test('rejects an anchor no heading in the target would produce', async () => {
  const result = await audit(`${BLOB}/docs/${someDoc}#no-heading-is-called-this`);
  assert.equal(result.ok, false, 'a fragment that lands nowhere is still a broken link');
  assert.match(result.output, /no-heading-is-called-this/);
});

test('accepts an anchor that matches a heading', async () => {
  const text = await readFile(join(docsDir, someDoc), 'utf8');
  const heading = text.match(/^#{1,6} +(.+?)\s*$/m);
  assert.ok(heading, `${someDoc} has no heading to aim at`);
  const slug = heading[1]
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/ +/g, '-');
  const result = await audit(`${BLOB}/docs/${someDoc}#${slug}`);
  assert.ok(result.ok, `an anchor matching a real heading must pass:\n${result.output}`);
});

/*
 * The exclusion, asserted in the direction that makes it one. `docs/api/**` is
 * generated reference that the export publishes to the repository and not to
 * the package, so the package cannot answer whether one of those files exists.
 * Widening the pattern without this case would turn every future API link into
 * a build failure, which is why the check is one segment deep on purpose.
 */
test('leaves links below docs/ alone, because the package cannot judge them', async () => {
  const result = await audit(`${BLOB}/docs/api/classes/SignalProtocolClient.md`);
  assert.ok(result.ok, `a docs/api link must be out of scope, not a failure:\n${result.output}`);
});
