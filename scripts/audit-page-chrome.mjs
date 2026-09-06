/*
 * The page chrome, and the stylesheet it replaced.
 *
 *   node scripts/audit-page-chrome.mjs --pages
 *   node scripts/audit-page-chrome.mjs --stylesheet
 *
 * Two conditions on one boundary, so they sit in one file and fail apart.
 *
 * --pages: every route renders src/components/PageChrome.astro. A page reaches
 * it by importing it, or by importing a component that does, so the check
 * resolves the import graph rather than reading a name. Four pages hold the
 * difference: the blog route renders BlogPostLayout, and the three legal terms
 * routes render a terms component. A grep for `PageChrome` or `BaseLayout`
 * calls all four broken, and calls a page that only mentions the word fixed.
 *
 * The graph is walked over rendered elements, not over imports alone. An
 * import a page never writes into its template renders no chrome, and a name
 * inside a comment renders nothing at all — both are stripped before the walk.
 *
 * --stylesheet: src/styles/global.css declares no class selector. The file is
 * the element base; a class rule in it is a page surface that a utility should
 * have expressed. Every selector is read at its own nesting depth, because the
 * rules sit indented inside `@layer base` and a line-anchored pattern reads the
 * indentation rather than the selector. Compound selectors count: `table.data`
 * is a class rule that does not start with a dot.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const PAGES = 'src/pages';
const CHROME = resolve('src/components/PageChrome.astro');
const CSS = 'src/styles/global.css';

/** Every `.astro` file under `root`. */
function astroFiles(root) {
  const found = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) found.push(...astroFiles(path));
    else if (path.endsWith('.astro')) found.push(path);
  }
  return found;
}

/** The frontmatter and the template, split at the fences that separate them. */
function parts(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  return match ? { frontmatter: match[1], template: match[2] } : { frontmatter: '', template: source };
}

/** The local `.astro` components a frontmatter imports, by the name it gives each one. */
function components(frontmatter, from) {
  const imports = new Map();
  const pattern = /import\s+([A-Za-z_$][\w$]*)\s+from\s+['"](\.[^'"]*\.astro)['"]/g;
  for (const [, name, specifier] of frontmatter.matchAll(pattern)) {
    imports.set(name, resolve(dirname(from), specifier));
  }
  return imports;
}

/**
 * The component names a template renders. Comments are stripped first: an
 * Astro expression comment and an HTML comment both write markup that never
 * reaches the page, and a check a comment can satisfy guards nothing.
 */
function rendered(template) {
  const markup = template
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  return new Set([...markup.matchAll(/<([A-Z][\w$]*)[\s/>]/g)].map((match) => match[1]));
}

/** Whether `path` renders the chrome, directly or through a component it renders. */
function reachesChrome(path, seen = new Set()) {
  if (path === CHROME) return true;
  if (seen.has(path)) return false;
  seen.add(path);
  const { frontmatter, template } = parts(readFileSync(path, 'utf8'));
  const drawn = rendered(template);
  for (const [name, target] of components(frontmatter, path)) {
    if (drawn.has(name) && reachesChrome(target, seen)) return true;
  }
  return false;
}

/**
 * The selectors a stylesheet writes rules for, at every depth. A prelude runs
 * from the end of the last block or declaration to the brace that opens its
 * block, so a nested rule is read the same way a top-level one is.
 */
function selectors(css) {
  const bare = css
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"[^"]*"|'[^']*'/g, '""');
  const found = [];
  let prelude = '';
  for (const character of bare) {
    if (character === '{') {
      found.push(prelude.trim());
      prelude = '';
    } else if (character === '}' || character === ';') {
      prelude = '';
    } else {
      prelude += character;
    }
  }
  return found.filter((text) => text.length > 0 && !text.startsWith('@'));
}

const mode = process.argv[2];
const failures = [];

if (mode === '--pages') {
  for (const page of astroFiles(PAGES).sort()) {
    if (!reachesChrome(resolve(page))) failures.push(`${page} renders no page chrome`);
  }
} else if (mode === '--stylesheet') {
  for (const selector of selectors(readFileSync(CSS, 'utf8'))) {
    if (/\.[A-Za-z_-]/.test(selector)) {
      failures.push(`${CSS} writes a class rule: ${selector.replace(/\s+/g, ' ')}`);
    }
  }
} else {
  process.stderr.write('usage: node scripts/audit-page-chrome.mjs --pages|--stylesheet\n');
  process.exit(2);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exit(1);
}

const subject = mode === '--pages' ? `${relative('.', PAGES)}/**.astro` : CSS;
process.stdout.write(`audit-page-chrome ${mode}: ${subject} holds.\n`);
