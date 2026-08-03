/*
 * Every link that leaves open-e2ee.dev opens in a new tab.
 *
 * Done here, on the emitted HTML, rather than on each anchor in source. The
 * site writes links four ways — literal attributes, data arrays, template
 * strings, and markdown in MDX articles — and only the first is visible to a
 * reader auditing a component. A rule applied once to the built output cannot
 * miss a link an editor forgot, and `scripts/audit-build.mjs` re-checks the
 * result so this file failing silently is not a way to ship half the site.
 *
 * `docs.` and `console.` are different hosts and are treated as external,
 * which is what was asked for: the reader keeps the page they were reading.
 *
 * `mailto:` and `tel:` are left alone. They hand off to another application
 * and a blank tab left behind is litter, not a destination.
 *
 * Opening a new window without saying so is what WCAG technique G201 exists to
 * prevent, so each link says so: through its `aria-label` where it has one —
 * an icon-only link's label is its whole accessible name and appended content
 * would not be read — and through visually hidden text where it does not.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SITE_HOST = 'open-e2ee.dev';
const HINT = 'opens in a new tab';

const isExternal = (href) => {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    return new URL(href).host !== SITE_HOST;
  } catch {
    return false;
  }
};

/** Add a token to a space-separated attribute without duplicating it. */
const withRel = (existing) => {
  const tokens = new Set((existing ?? '').split(/\s+/).filter(Boolean));
  tokens.add('noopener');
  return [...tokens].join(' ');
};

export function rewrite(html) {
  return html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (whole, attrs, body) => {
    const href = attrs.match(/\bhref="([^"]*)"/)?.[1];
    if (!href || !isExternal(href)) return whole;
    /* An explicit target in source is a decision; do not overrule it. */
    if (/\btarget=/.test(attrs)) return whole;

    const rel = attrs.match(/\brel="([^"]*)"/)?.[1];
    let next = rel
      ? attrs.replace(/\brel="[^"]*"/, `rel="${withRel(rel)}"`)
      : `${attrs} rel="${withRel()}"`;

    const label = next.match(/\baria-label="([^"]*)"/)?.[1];
    if (label !== undefined) {
      next = next.replace(/\baria-label="[^"]*"/, `aria-label="${label} (${HINT})"`);
      return `<a${next} target="_blank">${body}</a>`;
    }

    return `<a${next} target="_blank">${body}<span class="visually-hidden"> (${HINT})</span></a>`;
  });
}

async function htmlFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await htmlFiles(full)));
    else if (entry.name.endsWith('.html')) found.push(full);
  }
  return found;
}

/** @returns {import('astro').AstroIntegration} */
export default function externalLinks() {
  return {
    name: 'open-e2ee:external-links',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const files = await htmlFiles(dir.pathname);
        let changed = 0;
        for (const file of files) {
          const html = await readFile(file, 'utf8');
          const next = rewrite(html);
          if (next === html) continue;
          await writeFile(file, next);
          changed += 1;
        }
        logger.info(`off-site links open in a new tab on ${changed} of ${files.length} pages`);
      },
    },
  };
}
