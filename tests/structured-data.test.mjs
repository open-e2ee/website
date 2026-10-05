import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const site = 'https://open-e2ee.dev';

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

/*
 * The banned claims of docs/messaging.md §2, mirrored for the JSON-LD. The
 * build audit strips every <script> before its prose scan, so it never reads
 * these blocks. Structured data makes no negated or term-of-art statement, so
 * each phrase is banned here outright. Keep this list in step with §2:
 * additions there are additions here.
 */
const BANNED = [
  /military[- ]grade/i,
  /unbreakable/i,
  /uncrackable/i,
  /mathematically impossible/i,
  /complete privacy/i,
  /total privacy/i,
  /absolute security/i,
  /zero[- ]knowledge/i,
  /sees nothing/i,
  /\b(?:hipaa|soc ?2|gdpr)[- ]compliant/i,
  /required for (?:hipaa|gdpr|soc ?2|cjis|dora|nis2)/i,
  /\banonymous\b/i,
  /untraceable/i,
  /wire[- ]compatible/i,
  /works with signal messenger/i,
  /\b(?:endorsed by|partnered with|affiliated with)\b/i,
  /\baudit/i,
  /\bcertified\b/i,
  /reviewed by/i,
  /independent review/i,
  /production[- ]ready/i,
  /\b(?:unlimited|infinite)\b/i,
  /never expires/i,
  /your data is safe/i,
  /\bAGPL/i,
  /copyleft/i,
  /commercial license required/i,
  /buy your way out/i,
];

/* Invariant 4 of the discoverability plan, and anonymous public authorship. */
const FORBIDDEN_TYPES = ['FAQPage', 'Review', 'AggregateRating', 'Person'];
const FORBIDDEN_KEYS = [
  'aggregateRating',
  'review',
  'reviews',
  'author',
  'founder',
  'founders',
  'creator',
  'contributor',
  'editor',
  'employee',
  'employees',
  'accountablePerson',
];

const BLOCK = /<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
const blocksOf = (html) => [...html.matchAll(BLOCK)].map((match) => match[1]);

const metaContent = (html, property) =>
  html.match(new RegExp(`<meta\\b[^>]*property="${property}"[^>]*content="([^"]*)"`))?.[1];
const canonicalOf = (html) => html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]*)"/)?.[1];

/** Every [key, value] pair in a JSON value, at every depth. */
function* entries(value, key = '') {
  if (Array.isArray(value)) {
    for (const item of value) yield* entries(item, key);
  } else if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) yield* entries(child, name);
  } else {
    yield [key, value];
  }
}

function* keysOf(value) {
  if (Array.isArray(value)) {
    for (const item of value) yield* keysOf(item);
  } else if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) {
      yield name;
      yield* keysOf(child);
    }
  }
}

const nodesOf = (graph) => graph['@graph'] ?? [graph];
const nodeOfType = (graph, type) => nodesOf(graph).find((node) => node['@type'] === type);

/** The published posts, from the collection source, so a missing page fails. */
async function postIds() {
  const files = (await readdir(new URL('src/content/blog/', root))).filter((file) =>
    /\.mdx?$/.test(file),
  );
  const ids = [];
  for (const file of files) {
    const source = await read(`src/content/blog/${file}`);
    if (/^draft:\s*true\s*$/m.test(source.split(/^---$/m)[1] ?? '')) continue;
    ids.push(file.replace(/\.mdx?$/, ''));
  }
  return ids;
}

async function builtPages(dir = new URL('dist/', root)) {
  const pages = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
    if (entry.isDirectory()) pages.push(...(await builtPages(path)));
    else if (entry.name.endsWith('.html')) pages.push(path);
  }
  return pages;
}

/** The one JSON-LD block of a built page, parsed. */
async function onlyBlock(page) {
  const html = await read(`dist/${page}index.html`);
  const blocks = blocksOf(html);
  assert.equal(blocks.length, 1, `/${page} carries ${blocks.length} JSON-LD blocks, not 1`);
  return { html, graph: JSON.parse(blocks[0]) };
}

test('describes the organization and the site on the home page', async () => {
  if (!existsSync(new URL('dist/index.html', root))) return skipUnbuilt('dist/index.html');
  const { html, graph } = await onlyBlock('');

  assert.equal(graph['@context'], 'https://schema.org');
  const organization = nodeOfType(graph, 'Organization');
  assert.ok(organization, 'the home page has no Organization');
  assert.equal(organization.name, 'OpenE2EE');
  assert.equal(organization.legalName, 'OpenE2EE LLC');
  assert.equal(organization.url, `${site}/`);
  assert.equal(organization.url, canonicalOf(html), 'the organization url is not the home canonical');
  assert.equal(organization.logo, `${site}/brand/open-e2ee-app-icon-512.png`);
  assert.ok(
    existsSync(new URL('public/brand/open-e2ee-app-icon-512.png', root)),
    'the logo is not an asset the site serves',
  );
  assert.deepEqual(organization.sameAs, [
    'https://github.com/open-e2ee',
    'https://www.npmjs.com/org/open-e2ee',
  ]);

  const website = nodeOfType(graph, 'WebSite');
  assert.ok(website, 'the home page has no WebSite');
  assert.equal(website.name, 'OpenE2EE');
  assert.equal(website.url, `${site}/`);
  assert.deepEqual(website.publisher, { '@id': organization['@id'] });
});

test('describes the SDK source code on /product', async () => {
  if (!existsSync(new URL('dist/product/index.html', root))) {
    return skipUnbuilt('dist/product/index.html');
  }
  const { html, graph } = await onlyBlock('product/');

  assert.equal(graph['@context'], 'https://schema.org');
  assert.equal(graph['@type'], 'SoftwareSourceCode');
  /* docs/identity.md §4: the first mention of a product is its full name. */
  assert.equal(graph.name, 'OpenE2EE Signal Protocol SDK');
  assert.equal(graph.url, canonicalOf(html));
  assert.equal(graph.codeRepository, 'https://github.com/open-e2ee/signal-protocol-js');
  assert.equal(graph.programmingLanguage, 'TypeScript');
  /* docs/messaging.md §4: the license in words names both, and the reader picks. */
  assert.equal(graph.license.name, 'MIT or Apache-2.0');
  assert.equal(graph.license.url, 'https://github.com/open-e2ee/signal-protocol-js/blob/main/LICENSE');
  assert.equal(graph.publisher.name, 'OpenE2EE');
});

test('describes each post from its own dates', async () => {
  const ids = await postIds();
  assert.ok(ids.length >= 3, `found ${ids.length} published posts`);
  for (const id of ids) {
    if (!existsSync(new URL(`dist/blog/${id}/index.html`, root))) {
      return skipUnbuilt(`dist/blog/${id}/index.html`);
    }
    const { html, graph } = await onlyBlock(`blog/${id}/`);

    assert.equal(graph['@type'], 'BlogPosting', `/blog/${id}/`);
    assert.equal(graph.url, canonicalOf(html));
    assert.equal(graph.mainEntityOfPage, canonicalOf(html));
    assert.equal(`${graph.headline} · OpenE2EE`, metaContent(html, 'og:title'));
    assert.equal(graph.image, metaContent(html, 'og:image'));
    /* The dates the post already states, and no others. */
    assert.ok(graph.datePublished, `/blog/${id}/ has no datePublished`);
    assert.equal(graph.datePublished, metaContent(html, 'article:published_time'));
    assert.equal(graph.dateModified, metaContent(html, 'article:modified_time'));
    assert.equal(graph.publisher.name, 'OpenE2EE');
  }
});

test('keeps every JSON-LD block to true, permitted, anonymous facts', async () => {
  if (!existsSync(new URL('dist/index.html', root))) return skipUnbuilt('dist/index.html');

  let blocks = 0;
  for (const page of await builtPages()) {
    for (const raw of blocksOf(await readFile(page, 'utf8'))) {
      blocks += 1;
      const where = page.pathname.slice(new URL('dist/', root).pathname.length);
      /* A literal `</script>` or `<!--` in a value would end or corrupt the block. */
      assert.doesNotMatch(raw, /</, `${where}: the JSON-LD holds an unescaped "<"`);
      const graph = JSON.parse(raw);

      for (const key of keysOf(graph)) {
        assert.ok(!FORBIDDEN_KEYS.includes(key), `${where}: the JSON-LD has a "${key}" property`);
      }
      const values = [...entries(graph)];
      for (const [key, value] of values) {
        if (key === '@type') {
          assert.ok(!FORBIDDEN_TYPES.includes(value), `${where}: the JSON-LD has a ${value} node`);
        }
        if (typeof value !== 'string') continue;
        for (const pattern of BANNED) {
          assert.doesNotMatch(value, pattern, `${where}: ${key} states a banned claim`);
        }
        /* docs/identity.md §1: the legal entity name is for legal identification only. */
        if (key !== 'legalName') {
          assert.doesNotMatch(value, /OpenE2EE\s+LLC/, `${where}: ${key} names the legal entity`);
        }
      }
      for (const type of FORBIDDEN_TYPES) {
        assert.ok(!raw.includes(`"${type}"`), `${where}: the JSON-LD names ${type}`);
      }
    }
  }
  /* A build that lost its blocks would pass the loop above with nothing in it. */
  assert.ok(blocks >= 5, `found ${blocks} JSON-LD blocks in dist/`);
});

test('escapes markup in the serialized JSON-LD', async () => {
  const { serializeJsonLd } = await import('../src/lib/structured-data.mjs');
  const value = { name: '</script><script>alert(1)</script><!--' };
  const serialized = serializeJsonLd(value);
  assert.doesNotMatch(serialized, /</);
  assert.deepEqual(JSON.parse(serialized), value);
});
