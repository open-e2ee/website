#!/usr/bin/env node
/*
 * Tells IndexNow that the production site changed.
 *
 *   node scripts/indexnow-ping.mjs <sitemap-url>
 *
 * IndexNow is a shared push protocol. Bing and the other participating search
 * engines share each ping. The request names the host, the key, and the key
 * file URL, and lists the changed URLs. The engine then reads the key file on
 * the host to prove that the sender controls it.
 *
 * The key is public by protocol. It has one source in this repository: the
 * name and the content of `public/<key>.txt`. This script reads it there.
 *
 * The script reads the live sitemap (it follows a sitemap index to its child
 * sitemaps), confirms that the live key file answers with the key, and posts
 * every sitemap URL on the sitemap host. The deploy is complete when this
 * runs, so a failure must not fail the release: the script reports each
 * failure as a GitHub Actions warning, and the exit status is 0.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** The protocol allows up to 10,000 URLs in one request. */
export const MAX_URLS = 10_000;
const KEY_FILE = /^([0-9a-f]{32})\.txt$/;
const TIMEOUT_MS = 15_000;

/** The key from the one key file in `publicDir`. Throws unless exactly one file holds its own name. */
export function readIndexNowKey(publicDir) {
  const keys = readdirSync(publicDir)
    .map((name) => KEY_FILE.exec(name)?.[1])
    .filter(Boolean);
  if (keys.length !== 1) {
    throw new Error(`${publicDir} holds ${keys.length} IndexNow key files. It must hold exactly 1.`);
  }
  const [key] = keys;
  const content = readFileSync(join(publicDir, `${key}.txt`), 'utf8');
  if (content !== key) {
    throw new Error(`${key}.txt must contain its key and nothing else.`);
  }
  return key;
}

const locs = (xml) =>
  [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) =>
    match[1].replaceAll('&amp;', '&'),
  );

async function fetchText(fetchImpl, url) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

/** Every page URL in the sitemap. A sitemap index is read through its child sitemaps. */
export async function sitemapUrls(sitemapUrl, fetchImpl = fetch) {
  const xml = await fetchText(fetchImpl, sitemapUrl);
  if (!/<sitemapindex[\s>]/.test(xml)) return [...new Set(locs(xml))];
  const urls = [];
  for (const child of locs(xml)) urls.push(...locs(await fetchText(fetchImpl, child)));
  return [...new Set(urls)];
}

/**
 * Posts the sitemap URLs to IndexNow. It never throws: it returns
 * `{ ok, status, submitted }` and sends each failure to `warn`.
 */
export async function pingIndexNow({
  sitemap,
  key,
  fetchImpl = fetch,
  log = console.log,
  warn = (message) => console.log(`::warning title=IndexNow ping skipped::${message}`),
}) {
  try {
    const { host, origin } = new URL(sitemap);
    const keyLocation = `${origin}/${key}.txt`;

    const liveKey = await fetchText(fetchImpl, keyLocation);
    if (liveKey.trim() !== key) {
      warn(`${keyLocation} does not answer with the key, so IndexNow would refuse the ping.`);
      return { ok: false, status: null, submitted: 0 };
    }

    const urlList = (await sitemapUrls(sitemap, fetchImpl))
      .filter((url) => new URL(url).host === host)
      .slice(0, MAX_URLS);
    if (urlList.length === 0) {
      warn(`${sitemap} lists no URL on ${host}.`);
      return { ok: false, status: null, submitted: 0 };
    }

    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    /* 200: received. 202: received, and the key check is still pending. */
    if (response.status === 200 || response.status === 202) {
      log(`IndexNow accepted ${urlList.length} URLs on ${host} (HTTP ${response.status}).`);
      return { ok: true, status: response.status, submitted: urlList.length };
    }
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    warn(`IndexNow answered HTTP ${response.status} for ${urlList.length} URLs on ${host}. ${detail}`.trim());
    return { ok: false, status: response.status, submitted: 0 };
  } catch (error) {
    warn(error instanceof Error ? error.message : String(error));
    return { ok: false, status: null, submitted: 0 };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sitemap] = process.argv.slice(2);
  if (!sitemap) {
    console.error('usage: node scripts/indexnow-ping.mjs <sitemap-url>');
    process.exit(2);
  }
  try {
    const key = readIndexNowKey(fileURLToPath(new URL('../public/', import.meta.url)));
    await pingIndexNow({ sitemap, key });
  } catch (error) {
    console.log(`::warning title=IndexNow ping skipped::${error instanceof Error ? error.message : error}`);
  }
}
