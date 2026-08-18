/*
 * Post-build audit. Things a marketing site can silently get wrong and neither
 * `astro check` nor the test suite would notice: shipping a claim the verbal
 * identity forbids, shipping an internal link that 404s, linking to a doc the
 * public repository does not export, and printing an import or a symbol name
 * the SDK does not actually export.
 *
 * Run against dist/ after `npm run build`.
 */

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { readSdkSurface, SDK_PACKAGE, suggest } from './sdk-surface.mjs';

const DIST = resolve(process.argv[2] ?? 'dist');
const HERE = dirname(new URL(import.meta.url).pathname);

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
  /production[- ]ready/i,
  /\bnsa\b/i,
  /uncrackable/i,
  /absolutely secure/i,
  /* Opaque Systems holds live OPAQUE marks in classes 9 and 42 covering
   * privacy software, so this pairing must not be presented as the name of
   * anything. The tagline's descriptive use of "opaque" alone is unaffected. */
  /opaque[- ]carrier/i,
  /*
   * The relay formula paraphrased into an absolute. design/DESIGN.md fixes the
   * wording — "the relay never needs message plaintext or device private keys"
   * — and says not to paraphrase it, because the absolute is false: a relay
   * hostile from the very first message can substitute an identity before any
   * trust is pinned. The site tests enforced this on the two diagrams only, so
   * three instances of it shipped in page prose while this audit printed "no
   * banned claims" over them.
   *
   * Two shapes, because the paraphrase has two. First, the verb reaching the
   * object the formula names: "cannot read message plaintext", "can never
   * access the private keys". `never needs` is the sanctioned form and is not
   * matched, because `needs` is a claim about what the design requires rather
   * than about what an attacker can do.
   */
  /\b(?:cannot|can't|can not|never)\s+(?:read|see|access|obtain|decrypt|recover)\b[^.]{0,40}\b(?:plaintext|private keys)\b/i,
  /*
   * Second, the relay as bare subject: "the relay cannot read". No gap is
   * allowed between the noun and the verb, which is what separates an
   * assertion about this relay from a restrictive clause defining a class —
   * "a relay that cannot read the data cannot restore it" is correct English
   * about a property, and the recovery section of the TLS post needs it.
   */
  /\brelay\s+(?:cannot|can't|can not)\s+(?:read|see|access|decrypt)\b/i,
];

/*
 * Naming rules, mirrored from PUBLIC_TERMINOLOGY_PATTERNS in the SDK's
 * scripts/public-release-policy.mjs. The SDK enforces these on export, so its
 * own prose cannot ship a violation — but this site restates the same claims
 * about the same entities with no equivalent gate, which is how "the Signal
 * Foundation" reached production in the global footer and stayed there.
 *
 * Only the prose-relevant subset is mirrored; the SDK's identifier patterns
 * cover symbol names that cannot appear here. Keep the two lists in step.
 *
 * These match on rendered text with whitespace collapsed, so a phrase that
 * wraps across source lines is caught — the footer instance wrapped between
 * "Signal" and "Foundation" and survived a line-oriented search because of it.
 */
const TERMINOLOGY = [
  /* Signal Technology Foundation is the entity's name. The sentences these
   * appear in exist to be precise about who this project is not affiliated
   * with, so getting the name wrong defeats the disclaimer. */
  /\bSignal Foundation\b/i,
  /* Compatibility shorthand: each implies an endorsement or an interop
   * guarantee that does not exist. */
  /\bSignal-(?:inspired|style|styled|aligned|grade|compatible)\b/i,
  /* libsignal is the reference implementation; it is not "Signal's", and
   * public prose names it "the reference implementation". */
  /\bSignal(?:'|’)s reference implementation\b/i,
  /* Asserts an independence process that was never carried out. */
  /\bclean[- ]room\b/i,
  /* Renamed before launch; a docs link to it would 404 on npm. */
  /@open-e2ee\/sdk(?:\b|\/)/,
];

/*
 * What must carry the qualifier is a claim of security review, not the word.
 * The privacy notice needs "auditors" among professional advisers and "audit"
 * among record-retention purposes, and neither asserts anything about the SDK.
 *
 * The accepted qualifier is the second half of the fixed formula in
 * docs/messaging.md §7, and only that half. "Not yet audited" used to be
 * accepted here and is not any more: "yet" is the retired promise in one word,
 * and a gate that keeps taking it lets the retired copy back in one page at a
 * time.
 */
/*
 * House spelling, which TERMINOLOGY cannot carry: that list is mirrored from
 * the SDK's own export policy and has to stay in step with it, and this is a
 * rule about this site's copy alone.
 *
 * docs/messaging.md §4 mandates "commercial license", the legal pages and the
 * package metadata are American, and the site shipped both halves anyway —
 * /security rendered "Which licence your product needs" directly above a
 * footer that says "license", inside one viewport. CLAUDE.md names split
 * terminology as a defect this project has already paid for once.
 *
 * These run over the built scripts as well as the pages, like every other
 * prose rule here, so a word inside a bundled dependency would fail a build
 * over text no reader sees. Measured rather than assumed: across every built
 * script today the only matches were this project's own files, and they are
 * fixed. A dependency that trips it later should be allowlisted here, loudly,
 * rather than dropping the guard.
 *
 * The families are the ones that actually shipped, not a general list: -our,
 * -ise, -ogue, -mme, -ce, and the doubled l. A copy pass found "programme" in
 * the FIPS row, "scrutinised" on /product, "catalogues" and "prioritises" in
 * one article, "flavoured" in another, and "travelling" and "labelled" inside
 * SVG `<desc>` text that only a screen reader reads.
 *
 * Two exclusions are deliberate. "cancelled" is not here because the SDK ships
 * `Cancelled` as a media-attachment error code, and a guard that fails a build
 * over a dependency's identifier gets dropped rather than fixed. `analyses` is
 * not in the -ise pattern because it is also the American plural noun.
 * `aria-labelledby` is safe without an exception: the word boundary after
 * "labelled" does not hold inside it.
 */
const SPELLING = [
  /\b(?:licence|defence|offence|pretence)(?:s|d)?\b/i,
  /\b(?:behaviour|colour|flavour|favour|honour|neighbour|endeavour|rumour|valour)(?:s|ed|al|ing|able)?\b/i,
  /\b(?:catalogu|organis|prioritis|recognis|scrutinis|summaris)(?:e|es|ed|ing|ation|ations)\b/i,
  /\banalys(?:e|ed|ing)\b/i,
  /\bprogramme(?:s|d)?\b/i,
  /\b(?:labell|modell|signall|travell)(?:ed|ing|er|ers)\b/i,
];

const AUDIT_NEGATIONS = [/not audited by any independent firm/i, /no independent firm has audited/i];
const AUDIT_MENTION =
  /\baudit(ed|able)\b|\b(?:security|third[- ]party|independent|external|formal|code)[- ](?:review[- ])?audits?\b/i;

/*
 * The other direction of the same rule, and the one no pattern above can see.
 *
 * §7 binds two halves together: adversarial AI review, and the statement that
 * no independent firm has audited the SDK. AI review stated alone is a banned
 * claim (§2) — it reads as an assurance story with the limit filed off. But a
 * page can say "reviewed continuously by adversarial AI agents" without ever
 * writing "audited", so AUDIT_MENTION never fires on it and the page ships.
 * Hence a mention rule of its own, pointed the other way, sharing the same
 * negations.
 */
const AI_REVIEW_MENTION = /\badversarial AI\b|\bAI (?:review|audit|agents?)\b/i;

/*
 * FIPS, on the same principle as "audited": what must be qualified is the
 * claim, not the letters.
 *
 * This began as a flat ban on the word, which was the safe rule while nothing
 * on the site had cause to say it. Two things now do. `FIPS 203` is simply the
 * name of the NIST publication that standardises ML-KEM, and it appears in the
 * pinned-specification table. And a security reviewer's own checklist asks the
 * validation question directly — the verbal identity requires the honest
 * answer, which cannot be given by a page forbidden to say the word.
 *
 * So: the publication numbers are free, and any other mention must sit on a
 * page that also states the SDK is not validated. A compliance claim still
 * fails, which is the thing the ban was protecting.
 */
const FIPS_PUBLICATION = /\bFIPS\s*20[345]\b/gi;
const FIPS_MENTION = /\bFIPS\b/i;
const FIPS_NEGATION = /\bnot\s+FIPS[\s-]?140[\s-]?[23]?[\s-]?(?:validated|certified)/i;

async function filesWith(dir, extension) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await filesWith(full, extension)));
    else if (entry.name.endsWith(extension)) found.push(full);
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

/*
 * The text a built script can put on a page, near enough for these patterns.
 *
 * Escapes are decoded and whitespace collapsed for the same reason `textOf`
 * collapses it: a sentence the bundler split across an escape or a newline is
 * still one sentence by the time a reader has it.
 */
function scriptText(js) {
  return js
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\(["'`\\])/g, '$1')
    .replace(/\s+/g, ' ');
}

const files = await filesWith(DIST, '.html');
const problems = [];

/*
 * Everything a reader can be shown, which is not the same as everything in the
 * HTML.
 *
 * The demo writes its prose at runtime: every line the console and its reel
 * print ships as a string inside a built script and reaches the page only once
 * a reader has sent something. So the scans below, run over `.html` alone,
 * could not see that copy — and `textOf` strips `<script>` before matching, so
 * they could not see inline script text either. ld0-verify demonstrated the gap
 * rather than argued it: two of this file's own TERMINOLOGY patterns, planted
 * in a paragraph the demo shipped as a runtime string, built and passed this
 * audit.
 *
 * So the prose scans take the built scripts too. Scanning them whole, rather
 * than picking string literals out of them, is deliberate: a literal extractor
 * that loses sync on minified output fails by going quiet, and a checker that
 * goes quiet is the thing being fixed here. The cost is the reverse risk — a
 * banned phrase could match a minified identifier and fail a build over text no
 * reader sees. Measured rather than assumed: across every built script — the
 * whole SDK bundle and its crypto dependencies included — these patterns match
 * nothing today. No script count or byte total is written here on purpose: the
 * run prints the live count on success, and a figure quoted in a comment is one
 * build away from being false with nothing to catch it.
 *
 * Two limits worth knowing. A phrase the bundler split across a concatenation
 * or a template hole (`"…the Signal " + name`) is invisible to any static scan
 * of the output, here and in the HTML pass alike. And AUDIT/FIPS want their
 * qualifier on the same *page*, which does not map onto a chunk: a script that
 * ever needs to say "audited" has to carry "not audited by any independent
 * firm" in the same chunk, which is where the sentence belongs anyway.
 */
const scripts = await filesWith(DIST, '.js');
const prose = [
  ...(await Promise.all(
    files.map(async (file) => [relative(DIST, file), textOf(await readFile(file, 'utf8'))]),
  )),
  ...(await Promise.all(
    scripts.map(async (file) => [relative(DIST, file), scriptText(await readFile(file, 'utf8'))]),
  )),
];

/* Every href a page can reach, so a typo in a nav link fails the build. */
const pages = new Set();
for (const file of files) {
  const rel = `/${relative(DIST, file).replace(/index\.html$/, '').replace(/\.html$/, '')}`;
  pages.add(rel.endsWith('/') && rel !== '/' ? rel.slice(0, -1) : rel);
}

for (const [rel, text] of prose) {
  for (const pattern of BANNED) {
    const hit = text.match(pattern);
    if (hit) problems.push(`${rel}: banned claim ${pattern} — "${hit[0]}"`);
  }

  for (const pattern of TERMINOLOGY) {
    const hit = text.match(pattern);
    if (hit) problems.push(`${rel}: naming violation ${pattern} — "${hit[0]}"`);
  }

  for (const pattern of SPELLING) {
    const hit = text.match(pattern);
    if (hit) problems.push(`${rel}: British spelling ${pattern} — "${hit[0]}"`);
  }

  if (
    (AUDIT_MENTION.test(text) || AI_REVIEW_MENTION.test(text)) &&
    !AUDIT_NEGATIONS.some((n) => n.test(text))
  ) {
    problems.push(
      `${rel}: claims an audit or an AI review without "not audited by any independent firm"`,
    );
  }

  if (FIPS_MENTION.test(text.replace(FIPS_PUBLICATION, ' ')) && !FIPS_NEGATION.test(text)) {
    problems.push(`${rel}: mentions FIPS without stating that the SDK is not FIPS 140-validated`);
  }
}

/* Links are a property of the markup, so this pass stays on the pages. */
for (const file of files) {
  const rel = relative(DIST, file);
  const html = await readFile(file, 'utf8');

  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const path = href.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
    if (pages.has(path)) continue;
    if (path.startsWith('/brand/') || /\.[a-z0-9]+$/i.test(path)) continue;
    problems.push(`${rel}: internal link has no page — ${href}`);
  }
}

/*
 * Off-site links open in a new tab. `scripts/external-links.mjs` does the
 * rewriting during the build; this checks it happened, because an integration
 * that stops running is invisible — the pages still build, still deploy, and
 * still look right.
 *
 * `mailto:` and `tel:` are excluded there and here: they hand off to another
 * application, and the tab left behind would be empty.
 */
for (const file of files) {
  const html = await readFile(file, 'utf8');
  const rel = relative(DIST, file);
  for (const [, tag, href] of html.matchAll(/<a\b([^>]*\bhref="(https?:\/\/[^"]*)"[^>]*)>/g)) {
    let host;
    try {
      host = new URL(href).host;
    } catch {
      problems.push(`${rel}: link has an href that is not a URL — ${href}`);
      continue;
    }
    if (host === 'open-e2ee.dev') continue;
    if (!/\btarget="_blank"/.test(tag)) {
      problems.push(`${rel}: off-site link does not open in a new tab — ${href}`);
    }
    if (!/\brel="[^"]*\bnoopener\b/.test(tag)) {
      problems.push(`${rel}: off-site link opens a new tab without rel=noopener — ${href}`);
    }
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

/*
 * A preloaded font the stylesheet does not load is worse than no preload: it
 * fetches a second copy of the face on the critical path, which is the exact
 * opposite of what the hint is for.
 *
 * The layout imports the file from the website's own copy of
 * `@fontsource-variable/public-sans`; the @font-face rule comes from
 * `@open-e2ee/design`, which has its own copy. Both resolve to the same hashed
 * asset while the two versions agree. Bumping one and not the other would make
 * them silently disagree, and nothing else in the build would notice.
 */
const stylesheets = await filesWith(DIST, '.css');
const css = (await Promise.all(stylesheets.map((file) => readFile(file, 'utf8')))).join('\n');
for (const file of files) {
  const html = await readFile(file, 'utf8');
  const rel = relative(DIST, file);
  const preloads = [...html.matchAll(/<link\b[^>]*>/g)]
    .filter((tag) => /\bas="font"/.test(tag[0]))
    .map((tag) => tag[0].match(/\bhref="([^"]+)"/)?.[1])
    .filter(Boolean);
  for (const href of preloads) {
    if (!existsSync(join(DIST, href))) {
      problems.push(`${rel}: preloads a font that was not published — ${href}`);
    } else if (!css.includes(href)) {
      problems.push(`${rel}: preloads a font no stylesheet loads — ${href}`);
    }
  }
}

/*
 * Every symbol and subpath the site prints as fact, checked against the SDK's
 * real surface.
 *
 * Four invented identifiers shipped at once — `ISignalLocalStore`,
 * `ISignalRelayServer`, `configureSignalExpoDbBindings`, and
 * `ExpoSecureStoreSignalSecretVault`, each a real export with the word
 * "Protocol" removed. To Astro they are prose, so nothing objected. A reader
 * who copies one gets an import that cannot resolve, on the page whose entire
 * argument is that we are precise.
 *
 * Two rules, because the site states symbols two ways:
 *
 *   Imports  — a module specifier under `@open-e2ee/` must be a subpath the
 *              exports map really has, and each named specifier must really be
 *              exported by that subpath. Exact, from the package's own types.
 *
 *   Prose    — a bare identifier in an inline `<code>` span must exist
 *              somewhere in the SDK's vocabulary: an export, a member, or a
 *              string literal the API compares against.
 *
 * The prose rule is deliberately blunt, so a newly invented symbol fails on
 * the first build rather than after a support ticket. Its cost is that genuine
 * non-SDK code words need declaring, which is what the allowlist is for.
 */
const ALLOWLIST_FILE = join(HERE, 'sdk-identifier-allowlist.json');
const allowlist = new Set(JSON.parse(await readFile(ALLOWLIST_FILE, 'utf8')).allow);

const decode = (value) =>
  value
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&');

/* A `<code>` inside a `<pre>` is a highlighted program, where every local
 * variable would otherwise look like an SDK claim. Programs are checked by
 * their import statements instead, so the two passes see different text. */
const splitCode = (html) => {
  const blocks = [];
  const inline = [];
  const withoutPre = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => {
    blocks.push(decode(body.replace(/<[^>]+>/g, '')));
    return ' ';
  });
  for (const [, body] of withoutPre.matchAll(/<code[^>]*>([\s\S]*?)<\/code>/gi)) {
    inline.push(decode(body.replace(/<[^>]+>/g, '')).trim());
  }
  return { blocks, inline };
};

/*
 * `foo`, `foo()`, and `foo: 3` all assert that `foo` exists. `a.b` and `a-b`
 * carry a namespace that says up front they are someone else's, and a span
 * with prose in it is a quotation — `Error: Unable to bind Webassembly to
 * React Native JSI` is a pasted console message, not a claim about a symbol.
 * So a colon only counts when one token follows it, the way a property does.
 */
function bareIdentifier(span) {
  /* `node:crypto` is the reserved builtin-module namespace — as plainly
   * someone else's as `a.b`, and the reason the rule above exempts a
   * namespace. Without this the colon rule reads it as a property access on
   * a symbol named `node` and asks the SDK to export one. */
  if (/^node:[a-z][a-z/]*$/.test(span)) return null;
  const [head, ...tail] = span.split(/[:=(]/);
  const rest = tail.join(':').trim();
  if (rest.includes(' ')) return null;
  /* `new Foo()` names Foo as surely as `Foo` does, and the vault is written
   * that way in prose precisely because you construct it directly. */
  const name = head.trim().replace(/^new\s+/, '');
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : null;
}

/*
 * A hand-written document in the public repository, and the heading it aims at.
 *
 * Two shapes are in scope, because the site links both: a file one level under
 * `docs/`, and a file at the repository root. The root-level set —
 * `ARCHITECTURE.md`, `SECURITY.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`,
 * `ADAPTERS.md` — was outside this pattern until now, so nine links on the site
 * were exempt from the check written to catch exactly their failure mode. They
 * all resolve today; nothing was broken, and nothing was watching either.
 *
 * Anything deeper than one segment stays out of scope, which is load-bearing
 * rather than tidy. `docs/api/**` is generated reference that the export
 * publishes to the public repository (`publicDocRoots`) and does **not** put in
 * the npm package, so the package cannot answer whether one of those files
 * exists and this must not guess. The site has no `docs/api/` link today; the
 * exclusion is here so that the first one does not fail a check that was never
 * able to judge it.
 */
const PUBLIC_DOC_LINK =
  /https:\/\/github\.com\/open-e2ee\/signal-protocol-js\/blob\/[^/"]+\/([A-Za-z0-9._/-]+)(?:#([A-Za-z0-9._-]+))?/g;

/* GitHub's heading-to-fragment rule: case folded, punctuation dropped, spaces
 * hyphenated. It also numbers repeated headings `-1`, `-2`; ours are unique,
 * and a link to a repeated one fails here loudly rather than silently. */
const slug = (heading) =>
  heading
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/ +/g, '-');

const surface = await readSdkSurface();
if (!surface) {
  problems.push(
    `cannot verify code identifiers: no copy of ${SDK_PACKAGE} found — install it as a devDependency, or check out signal-protocol-js alongside this repo`,
  );
} else {
  const allExports = new Set([...surface.subpaths.values()].flatMap((names) => [...names]));

  for (const file of files) {
    const rel = relative(DIST, file);
    const { blocks, inline } = splitCode(await readFile(file, 'utf8'));

    for (const text of [...blocks, ...inline]) {
      for (const [, specifiers, spec] of text.matchAll(
        /import\s+(?:([\s\S]*?)\s+from\s+)?['"](@open-e2ee\/[^'"]+)['"]/g,
      )) {
        const [scope, name, ...rest] = spec.split('/');
        const pkg = `${scope}/${name}`;
        if (pkg !== SDK_PACKAGE) {
          problems.push(`${rel}: imports from an unknown package — ${pkg}`);
          continue;
        }
        const subpath = rest.length === 0 ? '.' : `./${rest.join('/')}`;
        const exported = surface.subpaths.get(subpath);
        if (!exported) {
          problems.push(`${rel}: ${SDK_PACKAGE} has no subpath "${subpath}"`);
          continue;
        }
        const named = specifiers?.match(/\{([\s\S]*?)\}/)?.[1] ?? '';
        for (const entry of named.split(',')) {
          const symbol = entry.trim().split(/\s+as\s+/)[0].trim().replace(/^type\s+/, '');
          if (!symbol || exported.has(symbol)) continue;
          const hint = suggest(symbol, allExports);
          problems.push(
            `${rel}: ${SDK_PACKAGE}${subpath.slice(1)} does not export ${symbol}` +
              (hint ? ` — did you mean ${hint}?` : ''),
          );
        }
      }
    }

    for (const span of inline) {
      /* A bare subpath quoted in prose is the same claim an import makes. */
      if (span.startsWith(`${SDK_PACKAGE}/`)) {
        const subpath = `.${span.slice(SDK_PACKAGE.length)}`;
        if (!surface.subpaths.has(subpath)) {
          problems.push(`${rel}: ${SDK_PACKAGE} has no subpath "${subpath}"`);
        }
        continue;
      }
      const name = bareIdentifier(span);
      if (!name || allowlist.has(name) || surface.vocabulary.has(name)) continue;
      const hint = suggest(name, allExports);
      problems.push(
        `${rel}: ${name} is not part of the ${SDK_PACKAGE} surface` +
          (hint
            ? ` — did you mean ${hint}?`
            : ` — fix it, or add it to ${relative(resolve(HERE, '..'), ALLOWLIST_FILE)}`),
      );
    }
  }

  /*
   * A link into the public repository's `docs/` resolves only if the export
   * allowlist carries that file. `DEVICE_LIFECYCLE.md` is in the internal
   * repository and not on the allowlist, so a page that linked to it served a
   * 404 on production from the day it shipped — reachable to whoever wrote it
   * and to nobody else.
   *
   * The installed package stands in for the public repository here, which
   * needs no network and so cannot flake. What makes it a fair stand-in is
   * that the export ships the same twelve top-level documents to both — one
   * list in the release policy feeds the repository and the package. That is
   * a property of the policy rather than a law: if the two ever diverge, this
   * fails a link that does resolve, and the message names the file so the
   * cause is visible from the failure alone.
   */
  const docsDir = join(surface.root, 'docs');
  const docs = existsSync(docsDir) ? new Set(await readdir(docsDir)) : null;
  const anchors = new Map();
  const rootFiles = new Set(
    (await readdir(surface.root, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );

  for (const file of files) {
    const rel = relative(DIST, file);
    const html = await readFile(file, 'utf8');
    for (const [, path, anchor] of html.matchAll(PUBLIC_DOC_LINK)) {
      const segments = path.split('/');
      const underDocs = segments.length === 2 && segments[0] === 'docs';
      /* Out of scope rather than passing: see PUBLIC_DOC_LINK. */
      if (segments.length > 1 && !underDocs) continue;
      if (underDocs && !docs) {
        problems.push(
          `${rel}: cannot verify the link to ${path} — the ${surface.origin} copy of ${SDK_PACKAGE} ships no docs directory`,
        );
        continue;
      }
      const published = underDocs ? docs : rootFiles;
      if (!published.has(segments.at(-1))) {
        problems.push(
          `${rel}: links to ${path} in the public repository, which does not export that file — the URL is a 404. ` +
            `Exported ${underDocs ? 'under docs/' : 'at the root'}: ${[...published].sort().join(', ')}`,
        );
        continue;
      }
      if (!anchor) continue;
      if (!anchors.has(path)) {
        const markdown = await readFile(join(surface.root, path), 'utf8');
        anchors.set(
          path,
          new Set([...markdown.matchAll(/^#{1,6} +(.+?)\s*$/gm)].map(([, head]) => slug(head))),
        );
      }
      if (!anchors.get(path).has(anchor)) {
        problems.push(`${rel}: ${path} has no heading that GitHub would number #${anchor}`);
      }
    }
  }

}

/* Social cards are produced in the design repo on their own schedule, so a
 * missing one is a gap to close rather than a reason to block a deploy. */
const warnings = [];
for (const file of files) {
  const html = await readFile(file, 'utf8');
  for (const [, image] of html.matchAll(
    /<meta\s+property="og:image"\s+content="([^"]+)"/g,
  )) {
    const path = image.replace(/^https?:\/\/[^/]+/, '');
    if (!path.startsWith('/')) continue;
    if (!existsSync(join(DIST, path))) {
      warnings.push(`${relative(DIST, file)}: social image is referenced but not published — ${path}`);
    }
  }
}

if (warnings.length > 0) {
  console.warn(`Build audit warnings (${warnings.length}):`);
  for (const warning of new Set(warnings)) console.warn(`  ${warning}`);
}

if (problems.length > 0) {
  console.error(`Build audit failed (${problems.length}):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `Build audit passed: ${files.length} pages and ${scripts.length} scripts, no banned claims, no naming violations, no British spellings, all internal links resolve, no CSP-blocked inline scripts, every preloaded font loaded by a stylesheet, ` +
    `every code identifier and every linked public doc found in ${SDK_PACKAGE}@${surface.version} (${surface.origin}).`,
);
