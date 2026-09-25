/*
 * The deploy triggers of the three website lanes.
 *
 *   node --test scripts/check-deploy-workflows.mjs
 *   node scripts/check-deploy-workflows.mjs <workflows-dir>
 *
 * A pull request deploys a preview (preview.yml). A push to main deploys
 * staging.open-e2ee.dev (deploy-staging.yml). A published release whose tag
 * commit is on main deploys open-e2ee.dev (deploy.yml). No push to main may
 * reach production, so this check holds the trigger, the guards, and the
 * deploy command of each lane. `npm test` runs it against the committed
 * workflows. The directory argument lets it read another copy, for example a
 * workflow from an earlier commit.
 *
 * The checks read the workflow text, because the repository has no YAML
 * parser. Each check reads one section of the file (the `on:` block, or one
 * step), so a pattern cannot match text in an unrelated part of the file.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const WORKFLOWS =
  process.argv[2] ?? fileURLToPath(new URL('../.github/workflows/', import.meta.url));

const TAG_PATTERN = String.raw`^v20[0-9]{2}\.[0-9]{2}\.[0-9]{2}(-[0-9]+)?$`;
const STAGE_DEPLOY = 'command: deploy --config wrangler.website.stage.jsonc --env=""';
const WRANGLER_ACTION = 'uses: cloudflare/wrangler-action@';

const read = (name) => readFileSync(join(WORKFLOWS, name), 'utf8');

/** The lines of one top-level key, without the key line itself. */
function topLevelBlock(source, key) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** The names of the events under `on:`. */
function triggers(source) {
  const block = topLevelBlock(source, 'on');
  assert.ok(block !== null, 'the workflow has no top-level on: block');
  return [...block.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);
}

/** Each step of the workflow as its own text, in file order. */
function steps(source) {
  return source.split(/\n(?= {6}- )/).slice(1);
}

function stepIndex(all, predicate, description) {
  const index = all.findIndex(predicate);
  assert.notEqual(index, -1, `no step ${description}`);
  return index;
}

test('deploy.yml deploys production only from a published release', () => {
  const source = read('deploy.yml');
  assert.deepEqual(triggers(source).sort(), ['release', 'workflow_dispatch']);

  const on = topLevelBlock(source, 'on');
  assert.match(on, /^ {2}release:\n {4}types: \[published\]$/m);
  assert.match(
    on,
    /^ {4}inputs:\n {6}tag:\n(?: {8}.*\n)*? {8}required: true$/m,
    'a manual run must name the tag',
  );
});

test('deploy.yml deploys only a calendar tag whose commit is on main', () => {
  const source = read('deploy.yml');
  const all = steps(source);

  const tagGuard = stepIndex(
    all,
    (step) => step.includes(`grep -Eq '${TAG_PATTERN}'`) && /\bexit 1\b/.test(step),
    'that refuses a tag outside the calendar pattern',
  );
  const checkout = stepIndex(
    all,
    (step) => step.includes('uses: actions/checkout@'),
    'that checks out the repository',
  );
  assert.match(all[checkout], /^ {10}ref: refs\/tags\/\$\{\{ env\.RELEASE_TAG \}\}$/m);
  assert.match(all[checkout], /^ {10}fetch-depth: 0$/m);
  assert.match(
    source,
    /^ {6}RELEASE_TAG: \$\{\{ github\.event\.release\.tag_name \|\| inputs\.tag \}\}$/m,
  );

  const ancestorGuard = stepIndex(
    all,
    (step) =>
      step.includes('git merge-base --is-ancestor "$commit" origin/main') &&
      /\bexit 1\b/.test(step),
    'that refuses a tag commit outside main',
  );
  const deploy = stepIndex(all, (step) => step.includes(WRANGLER_ACTION), 'that deploys');

  assert.ok(tagGuard < checkout, 'the tag guard must run before the checkout');
  assert.ok(checkout < ancestorGuard, 'the ancestor guard needs the checkout');
  assert.ok(ancestorGuard < deploy, 'the ancestor guard must run before the deploy');
});

test('deploy.yml builds, tests, and deploys the production config', () => {
  const source = read('deploy.yml');
  const all = steps(source);

  assert.match(source, /^ {4}environment: production$/m);
  assert.match(topLevelBlock(source, 'concurrency'), /group: deploy-production\n {2}cancel-in-progress: false/);

  const build = stepIndex(all, (step) => /run: npm run build$/m.test(step), 'that builds');
  const unitTest = stepIndex(all, (step) => /run: npm test$/m.test(step), 'that tests');
  const deploy = stepIndex(all, (step) => step.includes(WRANGLER_ACTION), 'that deploys');
  assert.ok(build < unitTest && unitTest < deploy, 'build, then test, then deploy');
  assert.doesNotMatch(all[deploy], /command:/, 'production deploys wrangler.jsonc as is');
});

test('deploy-staging.yml deploys the stage config from each push to main', () => {
  const source = read('deploy-staging.yml');
  assert.deepEqual(triggers(source).sort(), ['push', 'workflow_dispatch']);
  assert.match(topLevelBlock(source, 'on'), /^ {2}push:\n {4}branches: \[main\]$/m);

  assert.match(source, /^ {4}if: github\.ref == 'refs\/heads\/main'$/m);
  assert.match(source, /^ {4}environment: staging$/m);
  assert.match(topLevelBlock(source, 'concurrency'), /group: deploy-staging\n {2}cancel-in-progress: false/);

  const all = steps(source);
  const deploys = all.filter((step) => step.includes(WRANGLER_ACTION));
  assert.equal(deploys.length, 1, 'staging has one deploy step');
  assert.ok(deploys[0].includes(STAGE_DEPLOY), 'staging deploys wrangler.website.stage.jsonc');
});

test('deploy-staging.yml deploys only the current main tip', () => {
  const all = steps(read('deploy-staging.yml'));

  const revision = stepIndex(
    all,
    (step) =>
      step.includes('main=$(git ls-remote origin refs/heads/main | cut -f1)') &&
      step.includes('head=$(git rev-parse HEAD)') &&
      step.includes('if [ "$main" != "$head" ]; then') &&
      step.includes('echo "current=false" >> "$GITHUB_OUTPUT"'),
    'that compares the checkout with the current main tip',
  );
  assert.match(all[revision], /^ {8}id: revision$/m);

  const gated = "if: steps.revision.outputs.current == 'true'";
  const build = stepIndex(all, (step) => /run: npm run build$/m.test(step), 'that builds');
  const unitTest = stepIndex(all, (step) => /run: npm test$/m.test(step), 'that tests');
  const deploy = stepIndex(all, (step) => step.includes(WRANGLER_ACTION), 'that deploys');

  assert.ok(revision < build && build < unitTest && unitTest < deploy, 'guard, build, test, deploy');
  for (const index of [build, unitTest, deploy]) {
    assert.ok(all[index].includes(gated), `step ${index} must wait for the main-tip guard`);
  }
});

test('no push-triggered workflow deploys anything but the stage config', () => {
  const pushed = readdirSync(WORKFLOWS)
    .filter((name) => /\.ya?ml$/.test(name))
    .filter((name) => triggers(read(name)).includes('push'));
  assert.ok(pushed.includes('deploy-staging.yml'));

  for (const name of pushed) {
    for (const step of steps(read(name)).filter((each) => each.includes(WRANGLER_ACTION))) {
      assert.ok(step.includes(STAGE_DEPLOY), `${name} deploys more than staging on a push`);
    }
  }
});
