/*
 * Post-build audit. Two things a marketing site can silently get wrong and
 * neither `astro check` nor the test suite would notice: shipping a claim the
 * verbal identity forbids, and shipping an internal link that 404s.
 *
 * Run against dist/ after `npm run build`.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');

/*
 * Phrases that overclaim, imply a compliance mandate, or assert a review that
 * has not happened. "audited" is allowed only in an explicit negation.
 */
const BANNED = [
  /zero[- ]knowledge/i,
  /military[- ]grade/i,
  /\bmilitary\b/i,
  /bank[- ]grade/i,
  /unbreakable/i,
  /100%\s*secure/i,
  /complete privacy/i,
  /(?:the )?server sees nothing/i,
  /sees nothing/i,
  /hipaa[- ]compliant/i,
  /soc ?2[- ]compliant/i,
  /gdpr[- ]compliant/i,
  /\bfips\b/i,
  /production[- ]ready/i,
  /\bnsa\b/i,
  /uncrackable/i,
  /absolutely secure/i,
  /* Opaque Systems holds live OPAQUE marks in classes 9 and 42 covering
   * privacy software, so this pairing must not be presented as the name of
   * anything. The tagline's descriptive use of "opaque" alone is unaffected. */
  /opaque[- ]carrier/i,
];

/*
 * What must carry the qualifier is a claim of security review, not the word.
 * The privacy notice needs "auditors" among professional advisers and "audit"
 * among record-retention purposes, and neither asserts anything about the SDK.
 */
const AUDIT_NEGATIONS = [/not yet audited/i, /no third-party security audit/i];
const AUDIT_MENTION =
  /\baudit(ed|able)\b|\b(?:security|third[- ]party|independent|external|formal|code)[- ](?:review[- ])?audits?\b/i;

async function htmlFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

/* Strip markup, then collapse whitespace, so phrases split across tags match. */
function textOf(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;|&ndash;/g, '-')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const files = await htmlFiles(DIST);
const problems = [];

/* Every href a page can reach, so a typo in a nav link fails the build. */
const pages = new Set();
for (const file of files) {
  const rel = `/${relative(DIST, file).replace(/index\.html$/, '').replace(/\.html$/, '')}`;
  pages.add(rel.endsWith('/') && rel !== '/' ? rel.slice(0, -1) : rel);
}

for (const file of files) {
  const rel = relative(DIST, file);
  const html = await readFile(file, 'utf8');
  const text = textOf(html);

  for (const pattern of BANNED) {
    const hit = text.match(pattern);
    if (hit) problems.push(`${rel}: banned claim ${pattern} — "${hit[0]}"`);
  }

  if (AUDIT_MENTION.test(text) && !AUDIT_NEGATIONS.some((n) => n.test(text))) {
    problems.push(`${rel}: mentions an audit without the "not yet audited" qualifier`);
  }

  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const path = href.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
    if (pages.has(path)) continue;
    if (path.startsWith('/brand/') || /\.[a-z0-9]+$/i.test(path)) continue;
    problems.push(`${rel}: internal link has no page — ${href}`);
  }
}

// The CSP is script-src 'self' with no 'unsafe-inline': an inline script in
// built HTML is silently dead in production. The theme resolver broke exactly
// this way once; never again.
for (const file of files) {
  const html = await readFile(file, 'utf8');
  const rel = relative(DIST, file);
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim().length > 0 && !match[0].includes('application/ld+json')) {
      problems.push(`${rel}: inline script would be blocked by CSP script-src 'self'`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Build audit failed (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`Build audit passed: ${files.length} pages, no banned claims, all internal links resolve, no CSP-blocked inline scripts.`);
