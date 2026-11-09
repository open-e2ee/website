#!/usr/bin/env node
// Fails when the repository holds a bare relay identifier that the naming
// allowlist does not hold.
//
// Usage:
//   node scripts/check-signal-relay-naming.mjs [--root <dir>]
//     [--allowlist <file>] [--base <ref> | --no-base] [--list]
//
// The company naming rule gives every identifier that holds the word relay
// the signal prefix: signal_relay, signal-relay, signalRelay, SignalRelay,
// SIGNAL_RELAY, or SignalProtocolRelay. A bare identifier is the word in an
// identifier, key, label, file name, environment variable, or URL segment
// without that prefix. Prose is not an identifier.
//
// The script is the same file in each repository that runs it. The
// repository supplies only the allowlist, which holds the configuration and
// the hits that remain. The default allowlist is
// scripts/signal-relay-naming-allowlist.txt under the root. The default root
// is the current directory.
//
// Allowlist format. A line that starts with # is a comment. Every other line
// is a directive or an entry.
//
//   scan <glob>      Scan only the paths that match one scan glob. Without a
//                    scan line, the script scans every path.
//   ignore <glob>    Do not scan the paths that match the glob.
//   <owner> <path> <identifier>
//                    One remaining hit. <owner> is the task ID that removes
//                    the hit, or NM-FD1 for an approved historical constant.
//                    <path> is the file that holds the identifier. A path
//                    that ends with / names a directory, and the entry is a
//                    file or directory name in that directory (./ is the
//                    root). The identifier is the rest of the line.
//
// A glob without / matches a file name at any depth. Any other glob matches
// from the root, and a glob that ends with / matches the directory and every
// path under it. * matches within one path segment, ** matches across
// segments, **/ matches zero or more directories, and ? matches one
// character. A path holds %XX for a space, a tab, or %.
//
// The script always skips the allowlist, lockfiles, binary files, and the
// directories node_modules, .git, .worktrees, dist, build, coverage, and
// vendor. It scans the files that `git ls-files --cached --others
// --exclude-standard` lists, so the scan follows .gitignore and also reads a
// new file before its first commit.
//
// Failures. A hit that no entry holds. An entry with no hit. A duplicate
// line. With a base ref, a directive that the allowlist at the base ref does
// not hold, or a new entry whose identifier the base allowlist does not hold
// under the same owner. Entries compare by path and identifier, so a pull
// request can change the owner of an entry. A new entry can repeat a frozen
// name in a new path until its owner task renames it, so the set of owner
// and identifier names only shrinks. --base <ref> sets the base. Without it,
// the script uses origin/$GITHUB_BASE_REF when GitHub Actions sets
// GITHUB_BASE_REF for a pull request. --no-base turns the base check off. A
// base ref without the allowlist skips the base check, because that pull
// request adds the guard.
//
// --list prints an entry for each hit and exits 0. An entry keeps its owner
// from the allowlist, or gets the owner UNOWNED.
//
// Exit status: 0 on success, 1 on a failure, 2 on a usage, configuration,
// or Git error.

import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const NAME = "check-signal-relay-naming";
const DEFAULT_ALLOWLIST = "scripts/signal-relay-naming-allowlist.txt";
const GIT_TIMEOUT_MS = 60_000;

// The word is assembled so that this file holds no hit of its own rules.
const WORD = ["r", "e", "l", "a", "y"].join("");
const UPPER = WORD.toUpperCase();
const ANY = `[Rr]${WORD.slice(1)}`;

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".worktrees",
  "dist",
  "build",
  "coverage",
  "vendor",
]);
const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "go.sum",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "composer.lock",
]);
const BINARY_EXTENSIONS = new Set(
  (
    "png jpg jpeg gif webp avif ico icns bmp tif tiff pdf zip gz tgz bz2 xz " +
    "zst 7z tar jar wasm woff woff2 ttf otf eot mp3 mp4 m4a mov webm ogg wav " +
    "flac sqlite db bin dylib so dll exe node class o a pyc"
  ).split(" "),
);
const BINARY_PROBE_BYTES = 8000;

// The signal prefix in each spelling. A word that this prefix ends right
// before is not bare.
const PREFIX = /signal[-_]?(?:protocol[-_]?)?$/i;
const PREFIX_WINDOW = "signal-protocol-".length;

const PATH_CHARS = "A-Za-z0-9_.~@%+/-";
const LABEL = "[A-Za-z0-9_$-]+";

// Each rule names one kind of bare identifier. The whole match is the
// identifier. Rules run in order, and a word that an earlier rule matched is
// not matched again.
const RULES = [
  {
    kind: "label",
    regex: new RegExp(`OpenE2EE ${ANY}(?:[A-Za-z0-9 -]*? v[0-9]+)?`, "g"),
  },
  {
    // A path or URL segment: the word after or before a slash. The
    // identifier ends at that segment, so a longer path does not churn it.
    kind: "path",
    regex: new RegExp(
      `(?<![${PATH_CHARS}])(?:[${PATH_CHARS}]*/${WORD}s?(?:[.][A-Za-z0-9_-]+)*|${WORD}s?/)(?![A-Za-z0-9_$-])`,
      "g",
    ),
    trim: /[.-]+$/,
    // A delimiter of a regular expression literal is not a path separator.
    // The match starts at the opening delimiter and ends inside the literal,
    // or it ends at the closing delimiter.
    skip: (line, start, end) => {
      const opened = regexLiteralAt(line, start);
      if (opened?.open === start && end - 1 <= opened.close) return true;
      return regexLiteralAt(line, end - 1)?.close === end - 1;
    },
  },
  {
    // An upper-case constant or environment variable.
    kind: "constant",
    regex: new RegExp(
      `(?<![A-Za-z0-9_])[A-Z0-9_]*${UPPER}[A-Z0-9_]*(?![A-Za-z0-9_$])`,
      "g",
    ),
    // A lone capital word next to another capital word is prose, such as a
    // license notice in capitals.
    skip: (line, start, end) =>
      LONE_UPPER.test(line.slice(start, end)) &&
      (UPPER_BEFORE.test(line.slice(0, start)) ||
        UPPER_AFTER.test(line.slice(end))),
  },
  {
    // A camelCase or PascalCase name.
    kind: "camel",
    regex: new RegExp(
      `(?<![A-Za-z0-9_$])(?:[A-Za-z0-9_$]+R${WORD.slice(1)}[A-Za-z0-9_$]*|R${WORD.slice(1)}[A-Za-z0-9_$]+|[A-Za-z0-9_$]*${WORD}[A-Z0-9][A-Za-z0-9_$]*)`,
      "g",
    ),
    exclude: new RegExp(`^R${WORD.slice(1)}(?:s|ed|ing)$`),
  },
  {
    // A lower-case kebab-case or snake_case name, or its prefix before a
    // template placeholder or a regular expression group.
    kind: "kebab",
    regex: new RegExp(
      `(?<![A-Za-z0-9_$-])[a-z0-9_-]*(?:${WORD}[-_][a-z0-9]|[a-z0-9][-_]${WORD}|${WORD}[-_](?=[$({[]))[A-Za-z0-9_-]*`,
      "g",
    ),
  },
  {
    // A lower-case name without separators. The English word forms are
    // prose.
    kind: "compact",
    regex: new RegExp(
      `(?<![A-Za-z0-9_$-])(?:[a-z0-9]+${WORD}[a-z0-9]*|${WORD}[a-z0-9]+)(?![A-Za-z0-9_$-])`,
      "g",
    ),
    exclude: new RegExp(`^${WORD}(?:s|ed|ing|er|ers)$`),
  },
  {
    // A dotted name: a host name, a file name, or a property chain.
    kind: "dotted",
    regex: new RegExp(
      `(?<![A-Za-z0-9_$.-])(?:(?:${LABEL}[?]?[.])+${ANY}s?(?:[?]?[.]${LABEL})*|${ANY}s?(?:[?]?[.]${LABEL})+)(?![A-Za-z0-9_$-])`,
      "g",
    ),
  },
  {
    // The bare word as a code name: a declaration, a parameter, a key, an
    // assignment, a spread, a call, an SQL alias, or a quoted string. A
    // parameter after a comma needs an opening bracket earlier on the line,
    // so a comma list in prose is prose.
    kind: "word",
    regex: new RegExp(
      [
        `(?<=\\b(?:const|let|var|function|class|interface|type|enum|readonly|private|protected|public|static|declare|export|import)\\s+)${WORD}s?(?![A-Za-z0-9_$-])`,
        `(?<=(?:[({]|[([{].*,)\\s*)${WORD}s?(?=\\s*(?:[,)}=]|[?]?:|$))`,
        `(?<=^\\s*)${WORD}s?(?=[?]?:\\s)`,
        `(?<==\\s*)${WORD}s?(?=\\s*(?:[;,)]|$))`,
        `(?<=[.][.][.])${WORD}s?(?![A-Za-z0-9_$-])`,
        `(?<![A-Za-z0-9_$.-])${WORD}s?(?=\\()`,
        `(?<=\\bAS\\s+)${WORD}s?(?![A-Za-z0-9_$-])`,
        `(?<=["'\`])${WORD}s?(?=["'\`])`,
      ].join("|"),
      "g",
    ),
  },
];
const LONE_UPPER = new RegExp(`^${UPPER}S?$`);
const UPPER_BEFORE = /(?<![A-Za-z0-9_$])[A-Z]+\s+$/;
const UPPER_AFTER = /^\s+[A-Z]+(?![A-Za-z0-9_$])/;

// A regular expression literal starts with a slash after an operator, an
// opening bracket, an arrow, or the start of the line. A bare > is not an
// opener, because text after a closing tag can start with a slash. A literal
// holds escapes and character classes, and it ends at the next free slash.
const REGEX_OPENER = /(?:^|[(,=:[!&|?{};]|=>)\s*$/;
const REGEX_LITERAL = /\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\[])+\//y;

// Returns true when a regular expression literal can start at the slash. The
// closing brace of a template placeholder ends a value, so a slash after it
// is a path separator. A closing brace whose opening brace is not on the
// line stays an opener.
function opensRegexLiteral(line, slash) {
  const before = line.slice(0, slash);
  if (!REGEX_OPENER.test(before)) return false;
  const brace = before.trimEnd().length - 1;
  if (line[brace] !== "}") return true;
  let depth = 0;
  for (let at = brace; at >= 0; at -= 1) {
    if (line[at] === "}") depth += 1;
    else if (line[at] === "{") {
      depth -= 1;
      if (depth === 0) return line[at - 1] !== "$";
    }
  }
  return true;
}

// Returns the { open, close } slash indexes of the regular expression literal
// that the slash at index delimits, or null. A slash inside a literal is not
// a delimiter.
function regexLiteralAt(line, index) {
  if (line[index] !== "/") return null;
  let open = line.indexOf("/");
  while (open !== -1 && open <= index) {
    let next = open + 1;
    if (opensRegexLiteral(line, open)) {
      REGEX_LITERAL.lastIndex = open;
      const literal = REGEX_LITERAL.exec(line);
      if (literal) {
        const close = open + literal[0].length - 1;
        if (open === index || close === index) return { open, close };
        next = close + 1;
      }
    }
    open = line.indexOf("/", next);
  }
  return null;
}

// matchAll copies lastIndex, so no code calls test or exec on this regex.
const WORD_ANY_CASE = new RegExp(WORD, "gi");
const HAS_WORD = new RegExp(WORD, "i");

class UsageError extends Error {}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    allowlist: null,
    base: null,
    noBase: false,
    list: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--root" || flag === "--allowlist" || flag === "--base") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${flag} needs a value`);
      }
      options[flag.slice(2)] = value;
      index += 1;
    } else if (flag === "--no-base") options.noBase = true;
    else if (flag === "--list") options.list = true;
    else throw new UsageError(`unknown argument ${flag}`);
  }
  if (options.base !== null && options.noBase) {
    throw new UsageError("--base and --no-base exclude each other");
  }
  return options;
}

function git(root, args) {
  return execFileSync(
    "git",
    ["-C", root, "-c", "core.quotePath=false", ...args],
    {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    },
  );
}

function gitSucceeds(root, args) {
  try {
    git(root, args);
    return true;
  } catch {
    return false;
  }
}

function globRegex(glob) {
  let pattern = glob;
  if (pattern.endsWith("/")) pattern += "**";
  const anchored =
    pattern.slice(0, -1).includes("/") || pattern.startsWith("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      index += 1;
      if (pattern[index + 1] === "/") {
        source += "(?:.*/)?";
        index += 1;
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[\\^$.|+()[\]{}]/g, "\\$&");
  }
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source}$`);
}

function encodePath(path) {
  return path.replace(
    /[%\s]/g,
    (char) =>
      `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

function decodePath(path) {
  return path.replace(/%([0-9A-F]{2})/g, (_, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

const OWNER = /^[A-Z][A-Z0-9]*(?:[.-][A-Z0-9]+)*$/;
const ENTRY = /^(\S+)\s+(\S+)\s+(\S.*?)\s*$/;
const DIRECTIVE = /^(scan|ignore)\s+(\S+)\s*$/;

// Returns the parsed allowlist. Each line keeps a key: the directive text, or
// the path and identifier of an entry. The duplicate and base checks compare
// keys, so a changed owner or changed spacing is not a new line.
function parseAllowlist(text, source) {
  const scan = [];
  const ignore = [];
  const entries = [];
  const lines = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) return;
    const where = `${source}:${index + 1}`;
    const directive = DIRECTIVE.exec(line);
    if (directive) {
      const [, keyword, glob] = directive;
      (keyword === "scan" ? scan : ignore).push(globRegex(glob));
      lines.push({
        key: `${keyword} ${glob}`,
        where,
        label: `${keyword} ${glob}`,
      });
      return;
    }
    const entry = ENTRY.exec(line);
    if (!entry || !OWNER.test(entry[1])) {
      throw new UsageError(
        `${where}: expected "<owner> <path> <identifier>", "scan <glob>", or "ignore <glob>"`,
      );
    }
    const [, owner, path, identifier] = entry;
    const key = `${decodePath(path)}\0${identifier}`;
    entries.push({ owner, path: decodePath(path), identifier, key, where });
    lines.push({
      key,
      where,
      label: `${decodePath(path)}: ${identifier}`,
      owner,
      identifier,
    });
  });
  return { scan, ignore, entries, lines };
}

function isSkipped(path, allowlistPath, config) {
  if (path === allowlistPath) return true;
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  if (LOCKFILES.has(name)) return true;
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (SKIPPED_DIRECTORIES.has(segments[index])) return true;
  }
  if (config.scan.length > 0 && !config.scan.some((regex) => regex.test(path)))
    return true;
  return config.ignore.some((regex) => regex.test(path));
}

function isBinary(path, buffer) {
  const dot = path.lastIndexOf(".");
  if (
    dot > path.lastIndexOf("/") &&
    BINARY_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
  ) {
    return true;
  }
  return buffer.subarray(0, BINARY_PROBE_BYTES).includes(0);
}

function isBare(text, index) {
  return !PREFIX.test(text.slice(Math.max(0, index - PREFIX_WINDOW), index));
}

// Returns the identifiers on one line. Each occurrence of the word belongs
// to at most one identifier.
export function lineIdentifiers(source) {
  // A string escape such as a newline escape ends a name. Two spaces keep
  // each offset.
  const line = source.replace(/\\[nrtbfv0]/g, "  ");
  const occurrences = [];
  for (const found of line.matchAll(WORD_ANY_CASE))
    occurrences.push(found.index);
  if (occurrences.length === 0) return [];
  const claimed = new Set();
  const identifiers = [];
  for (const rule of RULES) {
    if (claimed.size === occurrences.length) break;
    for (const found of line.matchAll(rule.regex)) {
      const start = found.index;
      const end = start + found[0].length;
      const inside = occurrences.filter(
        (at) => at >= start && at + WORD.length <= end && !claimed.has(at),
      );
      if (inside.length === 0) continue;
      if (rule.skip && rule.skip(line, start, end)) continue;
      for (const at of inside) claimed.add(at);
      let identifier = found[0];
      if (rule.trim) identifier = identifier.replace(rule.trim, "");
      if (rule.exclude && rule.exclude.test(identifier)) continue;
      if (inside.some((at) => isBare(line, at))) identifiers.push(identifier);
    }
  }
  return identifiers;
}

// Returns the bare file and directory names in a path, as [directory, name]
// pairs. The directory ends with /.
export function pathNames(path) {
  const segments = path.split("/");
  const names = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    let bare = false;
    for (const found of segment.matchAll(WORD_ANY_CASE)) {
      if (isBare(segment, found.index)) bare = true;
    }
    if (bare) {
      const directory =
        index === 0 ? "./" : `${segments.slice(0, index).join("/")}/`;
      names.push([directory, segment]);
    }
  }
  return names;
}

function listFiles(root) {
  const output = git(root, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

function scan(root, allowlistPath, config) {
  const hits = new Map();
  let files = 0;
  const add = (path, identifier) => {
    const key = `${path}\0${identifier}`;
    if (!hits.has(key)) hits.set(key, { path, identifier, key });
  };
  for (const path of listFiles(root)) {
    if (isSkipped(path, allowlistPath, config)) continue;
    const absolute = resolve(root, path);
    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      continue; // A tracked file that the worktree deleted.
    }
    files += 1;
    for (const [directory, name] of pathNames(path)) add(directory, name);
    if (!stat.isFile()) continue;
    const buffer = readFileSync(absolute);
    if (isBinary(path, buffer)) continue;
    const text = buffer.toString("utf8");
    if (!HAS_WORD.test(text)) continue;
    for (const line of text.split(/\r?\n/)) {
      for (const identifier of lineIdentifiers(line)) add(path, identifier);
    }
  }
  return { hits, files };
}

function resolveBase(options) {
  if (options.noBase) return null;
  if (options.base !== null) return options.base;
  const pullRequestBase = process.env.GITHUB_BASE_REF;
  return pullRequestBase ? `origin/${pullRequestBase}` : null;
}

// Returns the line keys of the allowlist at the base ref, and the owners of
// each identifier there, or null when the base ref has no allowlist.
function baseAllowlist(root, base, allowlistPath) {
  if (
    !gitSucceeds(root, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`])
  ) {
    throw new UsageError(
      `base ref ${base} does not resolve; fetch it (actions/checkout fetch-depth: 0) or pass --base <ref>`,
    );
  }
  const spec = `${base}:./${allowlistPath}`;
  if (!gitSucceeds(root, ["cat-file", "-e", spec])) return null;
  const parsed = parseAllowlist(git(root, ["show", spec]), spec);
  const owners = new Map();
  for (const entry of parsed.entries) {
    if (!owners.has(entry.identifier)) owners.set(entry.identifier, new Set());
    owners.get(entry.identifier).add(entry.owner);
  }
  return { keys: new Set(parsed.lines.map((line) => line.key)), owners };
}

// Returns why an allowlist line that the base does not hold fails, or null
// when it is an entry that repeats a base name under the same owner.
function newLineReason(line, base, held) {
  const reason = `allowlist line ${line.where} is not on base ${base}`;
  if (line.identifier === undefined) return reason;
  const owners = held.owners.get(line.identifier);
  if (owners === undefined) {
    return `${reason} and ${line.identifier} has no base entry`;
  }
  if (owners.has(line.owner)) return null;
  return `${reason} and ${line.identifier} is owned by ${[...owners].sort().join(", ")} there`;
}

function run(options) {
  const started = performance.now();
  const root = resolve(options.root);
  const allowlistFile = resolve(root, options.allowlist ?? DEFAULT_ALLOWLIST);
  const allowlistPath = relative(root, allowlistFile).split(sep).join("/");
  if (isAbsolute(allowlistPath) || allowlistPath.startsWith("../")) {
    throw new UsageError(
      `allowlist ${allowlistFile} is outside the root ${root}`,
    );
  }
  let allowlistText;
  try {
    allowlistText = readFileSync(allowlistFile, "utf8");
  } catch (error) {
    throw new UsageError(
      `cannot read the allowlist ${allowlistPath}: ${error.message}`,
    );
  }
  const config = parseAllowlist(allowlistText, allowlistPath);
  const { hits, files } = scan(root, allowlistPath, config);

  const owners = new Map(
    config.entries.map((entry) => [entry.key, entry.owner]),
  );
  if (options.list) {
    const lines = [...hits.values()]
      .sort(
        (a, b) =>
          a.path.localeCompare(b.path) ||
          a.identifier.localeCompare(b.identifier),
      )
      .map(
        (hit) =>
          `${owners.get(hit.key) ?? "UNOWNED"} ${encodePath(hit.path)} ${hit.identifier}`,
      );
    process.stdout.write(lines.length > 0 ? `${lines.join("\n")}\n` : "");
    return 0;
  }

  const failures = [];
  const seen = new Set();
  for (const line of config.lines) {
    if (seen.has(line.key))
      failures.push({
        label: line.label,
        reason: `duplicate allowlist line at ${line.where}`,
      });
    seen.add(line.key);
  }
  const allowed = new Set(config.entries.map((entry) => entry.key));
  for (const hit of hits.values()) {
    if (!allowed.has(hit.key))
      failures.push({
        label: `${hit.path}: ${hit.identifier}`,
        reason: "not in the allowlist",
      });
  }
  for (const entry of config.entries) {
    if (!hits.has(entry.key)) {
      failures.push({
        label: `${entry.path}: ${entry.identifier}`,
        reason: `allowlist line ${entry.where} has no hit`,
      });
    }
  }
  const base = resolveBase(options);
  let baseNote = "no base check";
  if (base !== null) {
    const held = baseAllowlist(root, base, allowlistPath);
    if (held === null) {
      baseNote = `base ${base} has no allowlist, base check skipped`;
    } else {
      baseNote = `base ${base}`;
      for (const line of config.lines) {
        if (held.keys.has(line.key)) continue;
        const reason = newLineReason(line, base, held);
        if (reason !== null) failures.push({ label: line.label, reason });
      }
    }
  }

  const elapsed = Math.round(performance.now() - started);
  const summary = `${hits.size} hits in ${files} files, ${config.entries.length} allowlist entries, ${baseNote}, ${elapsed} ms`;
  if (failures.length === 0) {
    process.stdout.write(`${NAME}: ok, ${summary}\n`);
    return 0;
  }
  failures.sort(
    (a, b) =>
      a.label.localeCompare(b.label) || a.reason.localeCompare(b.reason),
  );
  const out = failures.map((failure) => `${failure.label} (${failure.reason})`);
  out.push(`${NAME}: ${failures.length} failures, ${summary}`);
  process.stdout.write(`${out.join("\n")}\n`);
  return 1;
}

function main() {
  try {
    process.exitCode = run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    const message =
      error instanceof UsageError
        ? error.message
        : error.stderr?.toString().trim() || error.message;
    process.stderr.write(`${NAME}: ${message}\n`);
    process.exitCode = 2;
  }
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
