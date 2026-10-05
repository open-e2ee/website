import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const site = 'https://open-e2ee.dev';
const stagingHost = 'stage.open-e2ee.dev';

/*
 * dist/ is absent on a clean checkout and present in CI, which builds before it
 * tests. A bare skip would let a dist-reading assertion report a pass in the one
 * place it is the only guard there is.
 */
const skipUnbuilt = (page) => {
  assert.ok(
    !process.env.CI,
    `${page} is missing — CI builds before it tests, so a dist-reading assertion must never skip here`,
  );
};

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );
}

const canonicalsOf = (html) =>
  (html.match(/<link\b[^>]*>/g) ?? [])
    .map(attributes)
    .filter((attrs) => attrs.rel === 'canonical')
    .map((attrs) => attrs.href);

const ogUrlsOf = (html) =>
  (html.match(/<meta\b[^>]*>/g) ?? [])
    .map(attributes)
    .filter((attrs) => attrs.property === 'og:url')
    .map((attrs) => attrs.content);

/*
 * The configs are .jsonc and do carry comments, so they cannot go straight to
 * JSON.parse. Strings are matched first in the alternation below, which is what
 * keeps a "//" inside a value from being read as the start of a comment.
 */
async function wranglerConfig(name) {
  const source = await read(name);
  return JSON.parse(
    source.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, string) => string ?? ''),
  );
}

/** Each `_headers` block: its URL pattern and the headers it sets. */
function headerRules(source) {
  const rules = [];
  for (const line of source.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    if (/^\S/.test(line)) {
      rules.push({ pattern: line.trim(), headers: {} });
      continue;
    }
    const header = line.match(/^\s+([^:]+):\s*(.+)$/);
    if (header) rules.at(-1).headers[header[1].trim().toLowerCase()] = header[2].trim();
  }
  return rules;
}

test('names every sitemap URL as its own canonical and og:url', async () => {
  const index = new URL('dist/sitemap-index.xml', root);
  if (!existsSync(index)) return skipUnbuilt('dist/sitemap-index.xml');

  const pages = [];
  for (const sitemap of locs(await readFile(index, 'utf8'))) {
    assert.ok(sitemap.startsWith(`${site}/`), `${sitemap} is off the site origin`);
    pages.push(...locs(await read(`dist${new URL(sitemap).pathname}`)));
  }
  /* A sitemap that lost its pages would pass the loop below with nothing in it. */
  assert.ok(pages.length >= 40, `the sitemap lists ${pages.length} pages`);

  for (const loc of pages) {
    const { origin, pathname } = new URL(loc);
    assert.equal(origin, site, `${loc} is off the site origin`);
    /* The asset server answers a path without its slash with a 307. */
    assert.ok(pathname.endsWith('/'), `${loc} is not the served slash form`);
    const html = await read(`dist${pathname}index.html`);
    assert.deepEqual(canonicalsOf(html), [loc], `${loc} names another canonical`);
    assert.deepEqual(ogUrlsOf(html), [loc], `${loc} names another og:url`);
  }
});

test('lets no page name its own canonical', async () => {
  /*
   * BaseLayout derives the canonical from the served path. A literal can name
   * a URL that redirects: `canonical="/contact"` on a page the build serves at
   * `/contact/`.
   */
  const files = (await readdir(new URL('src/', root), { recursive: true })).filter((file) =>
    file.endsWith('.astro'),
  );
  assert.ok(files.length > 30, `found ${files.length} .astro files`);
  for (const file of files) {
    assert.doesNotMatch(await read(`src/${file}`), /\bcanonical=/, `src/${file} passes a canonical`);
  }
  assert.doesNotMatch(await read('src/layouts/BaseLayout.astro'), /canonical\?:/);
});

test('sends noindex on the staging host and never on production', async () => {
  const rules = headerRules(await read('public/_headers'));
  const robots = rules.filter((rule) => 'x-robots-tag' in rule.headers);

  assert.deepEqual(
    robots.map((rule) => [rule.pattern, rule.headers['x-robots-tag']]),
    [[`https://${stagingHost}/*`, 'noindex']],
    'exactly one X-Robots-Tag rule, scoped to the staging host',
  );

  /* The rule names the host the staging Worker serves, and no other Worker. */
  const stage = await wranglerConfig('wrangler.website.stage.jsonc');
  const production = await wranglerConfig('wrangler.jsonc');
  assert.deepEqual(stage.routes.map((route) => route.pattern), [stagingHost]);
  assert.equal(production.routes.some((route) => route.pattern === stagingHost), false);

  /* A path-only rule matches every host, production included. */
  for (const rule of rules.filter((each) => each.pattern.startsWith('/'))) {
    assert.equal('x-robots-tag' in rule.headers, false, `${rule.pattern} applies on every host`);
  }
});
