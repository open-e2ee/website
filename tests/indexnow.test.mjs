import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  INDEXNOW_ENDPOINT,
  pingIndexNow,
  readIndexNowKey,
  sitemapUrls,
} from '../scripts/indexnow-ping.mjs';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const key = '0123456789abcdef0123456789abcdef';
const origin = 'https://open-e2ee.dev';

const sitemapIndex = `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/sitemap-0.xml</loc></sitemap></sitemapindex>`;
const childSitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url><url><loc>${origin}/product/</loc></url><url><loc>${origin}/product/</loc></url><url><loc>https://docs.open-e2ee.dev/</loc></url></urlset>`;

/** A fetch that answers from a table of URL to Response factory, and records each request. */
function fakeFetch(routes) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    const route = routes[String(url)];
    if (!route) return new Response('not found', { status: 404 });
    return route(init);
  };
  return { fetchImpl, requests };
}

const liveSite = (indexNow) =>
  fakeFetch({
    [`${origin}/${key}.txt`]: () => new Response(key),
    [`${origin}/sitemap-index.xml`]: () => new Response(sitemapIndex),
    [`${origin}/sitemap-0.xml`]: () => new Response(childSitemap),
    [INDEXNOW_ENDPOINT]: indexNow,
  });

test('public/ holds one IndexNow key file whose content is its own name', () => {
  const live = readIndexNowKey(publicDir);
  assert.match(live, /^[0-9a-f]{32}$/);
  assert.equal(readFileSync(join(publicDir, `${live}.txt`), 'utf8'), live);
});

test('the build ships the key file at the site root', (t) => {
  const live = readIndexNowKey(publicDir);
  const built = join(distDir, `${live}.txt`);
  if (!existsSync(built)) {
    assert.ok(!process.env.CI, 'CI builds before it tests, so the built key file must exist');
    t.skip('dist/ is not built');
    return;
  }
  assert.equal(readFileSync(built, 'utf8'), live);
});

test('readIndexNowKey refuses no key file, two key files, and a file that holds another value', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'indexnow-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'robots.txt'), 'User-agent: *');
  assert.throws(() => readIndexNowKey(dir), /holds 0 IndexNow key files/);

  writeFileSync(join(dir, `${key}.txt`), `${key}\n`);
  assert.throws(() => readIndexNowKey(dir), /must contain its key and nothing else/);

  writeFileSync(join(dir, `${key}.txt`), key);
  assert.equal(readIndexNowKey(dir), key);

  writeFileSync(join(dir, 'fedcba9876543210fedcba9876543210.txt'), 'fedcba9876543210fedcba9876543210');
  assert.throws(() => readIndexNowKey(dir), /holds 2 IndexNow key files/);
});

test('sitemapUrls follows a sitemap index and removes duplicates', async () => {
  const { fetchImpl } = liveSite();
  assert.deepEqual(await sitemapUrls(`${origin}/sitemap-index.xml`, fetchImpl), [
    `${origin}/`,
    `${origin}/product/`,
    'https://docs.open-e2ee.dev/',
  ]);
});

test('the ping posts the host, key, key location, and every sitemap URL on the host', async () => {
  const { fetchImpl, requests } = liveSite(() => new Response(null, { status: 202 }));
  const logs = [];
  const warnings = [];
  const result = await pingIndexNow({
    sitemap: `${origin}/sitemap-index.xml`,
    key,
    fetchImpl,
    log: (line) => logs.push(line),
    warn: (line) => warnings.push(line),
  });

  assert.deepEqual(result, { ok: true, status: 202, submitted: 2 });
  assert.deepEqual(warnings, []);
  assert.match(logs[0], /accepted 2 URLs on open-e2ee\.dev/);
  const post = requests.find((request) => request.url === INDEXNOW_ENDPOINT);
  assert.equal(post.init.method, 'POST');
  assert.equal(post.init.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(post.init.body), {
    host: 'open-e2ee.dev',
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList: [`${origin}/`, `${origin}/product/`],
  });
});

test('the ping warns and resolves when IndexNow refuses or fails', async () => {
  for (const [indexNow, expected] of [
    [() => new Response('Too Many Requests', { status: 429 }), /HTTP 429 for 2 URLs/],
    [() => new Response('', { status: 503 }), /HTTP 503/],
    [() => Promise.reject(new TypeError('fetch failed')), /fetch failed/],
  ]) {
    const { fetchImpl } = liveSite(indexNow);
    const warnings = [];
    const result = await pingIndexNow({
      sitemap: `${origin}/sitemap-index.xml`,
      key,
      fetchImpl,
      log: () => {},
      warn: (line) => warnings.push(line),
    });
    assert.equal(result.ok, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], expected);
  }
});

test('the ping skips IndexNow when the live key file or the sitemap is wrong', async () => {
  for (const [routes, expected] of [
    [{ [`${origin}/${key}.txt`]: () => new Response('another value') }, /does not answer with the key/],
    [{ [`${origin}/${key}.txt`]: () => new Response('not found', { status: 404 }) }, /answered 404/],
    [
      {
        [`${origin}/${key}.txt`]: () => new Response(key),
        [`${origin}/sitemap-index.xml`]: () => new Response('<urlset></urlset>'),
      },
      /lists no URL on open-e2ee\.dev/,
    ],
  ]) {
    const { fetchImpl, requests } = fakeFetch(routes);
    const warnings = [];
    const result = await pingIndexNow({
      sitemap: `${origin}/sitemap-index.xml`,
      key,
      fetchImpl,
      log: () => {},
      warn: (line) => warnings.push(line),
    });
    assert.deepEqual(result, { ok: false, status: null, submitted: 0 });
    assert.match(warnings[0], expected);
    assert.ok(!requests.some((request) => request.url === INDEXNOW_ENDPOINT), 'no ping is sent');
  }
});
