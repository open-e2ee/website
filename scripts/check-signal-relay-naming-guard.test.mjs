import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { lineIdentifiers, pathNames } from "./check-signal-relay-naming.mjs";

// The fixtures assemble the word so that this file holds no hit of its own.
const W = ["r", "e", "l", "a", "y"].join("");
const C = `R${W.slice(1)}`;
const U = W.toUpperCase();

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-signal-relay-naming.mjs",
);
const allowlist = "scripts/signal-relay-naming-allowlist.txt";
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
delete env.GITHUB_BASE_REF;

function git(root, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

// Returns a repository whose main branch holds the files in one commit.
function repository(t, files) {
  const root = mkdtempSync(join(tmpdir(), "signal-relay-naming-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "--quiet", "-b", "main");
  write(root, files);
  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", "base");
  return root;
}

function guard(root, args = ["--no-base"], extraEnv = {}) {
  const result = spawnSync(
    process.execPath,
    [script, "--root", root, ...args],
    { env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(result.error, undefined);
  return {
    status: result.status,
    lines: result.stdout.trim().split("\n"),
    stderr: result.stderr,
  };
}

const clean = {
  "src/client.ts": [
    `export const signal${C}Url = "https://example.invalid";`,
    `export class SignalProtocol${C}Client {}`,
    `// The ${W} forwards each message to the mailbox.`,
    `export const message = "The ${C} is not available.";`,
    "",
  ].join("\n"),
  [allowlist]: "# Remaining hits.\n",
};

test("a clean tree passes", (t) => {
  const result = guard(repository(t, clean));
  assert.equal(result.status, 0, result.lines.join("\n"));
  assert.match(
    result.lines[0],
    /^check-signal-relay-naming: ok, 0 hits in 1 files, 0 allowlist entries, no base check, \d+ ms$/,
  );
});

test("an injected bare identifier fails with its path and identifier", (t) => {
  const root = repository(t, clean);
  write(root, { "src/new.ts": `export const ${W}Url = "x";\n` });
  const result = guard(root);
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines.slice(0, -1), [
    `src/new.ts: ${W}Url (not in the allowlist)`,
  ]);
  assert.match(
    result.lines.at(-1),
    /^check-signal-relay-naming: 1 failures, 1 hits in 2 files, /,
  );
});

test("an allowlisted hit passes and a stale allowlist line fails", (t) => {
  const root = repository(t, {
    ...clean,
    "src/old.ts": `export type ${C}Error = Error;\n`,
    [allowlist]: `NM1.1 src/old.ts ${C}Error\n`,
  });
  assert.equal(guard(root).status, 0);
  write(root, { "src/old.ts": `export type Signal${C}Error = Error;\n` });
  const result = guard(root);
  assert.equal(result.status, 1);
  assert.equal(
    result.lines[0],
    `src/old.ts: ${C}Error (allowlist line ${allowlist}:1 has no hit)`,
  );
});

test("--base rejects a new allowlist line and accepts a removed one", (t) => {
  const root = repository(t, {
    ...clean,
    "src/old.ts": `export const OPEN_E2EE_${U}_TOKEN = 1;\n`,
    [allowlist]: `NM2.8 src/old.ts OPEN_E2EE_${U}_TOKEN\n`,
  });
  git(root, "checkout", "--quiet", "-b", "change");

  write(root, {
    "src/new.ts": `export const ${W}Url = "x";\n`,
    [allowlist]: [
      `NM2.8 src/old.ts OPEN_E2EE_${U}_TOKEN`,
      `NM7.3 src/new.ts ${W}Url`,
      "ignore generated/",
      "",
    ].join("\n"),
  });
  const added = guard(root, ["--base", "main"]);
  assert.equal(added.status, 1);
  assert.deepEqual(added.lines.slice(0, -1), [
    `ignore generated/ (allowlist line ${allowlist}:3 is not on base main)`,
    `src/new.ts: ${W}Url (allowlist line ${allowlist}:2 is not on base main)`,
  ]);
  assert.match(added.lines.at(-1), /, base main, \d+ ms$/);

  write(root, {
    "src/new.ts": "export {};\n",
    "src/old.ts": `export const OPEN_E2EE_SIGNAL_${U}_TOKEN = 1;\n`,
    [allowlist]: "# Remaining hits.\n",
  });
  assert.equal(guard(root, ["--base", "main"]).status, 0);
});

test("the base check keys an entry by path and identifier, not by owner", (t) => {
  const root = repository(t, {
    ...clean,
    "src/old.ts": `export const ${W}Url = 1;\n`,
    [allowlist]: `NM1.1 src/old.ts ${W}Url\n`,
  });
  write(root, { [allowlist]: `NM7.3   src/old.ts   ${W}Url\n` });
  assert.equal(guard(root, ["--base", "main"]).status, 0);
  write(root, {
    [allowlist]: `NM7.3 src/old.ts ${W}Url\nNM1.1 src/old.ts ${W}Url\n`,
  });
  const duplicate = guard(root, ["--base", "main"]);
  assert.equal(duplicate.status, 1);
  assert.equal(
    duplicate.lines[0],
    `src/old.ts: ${W}Url (duplicate allowlist line at ${allowlist}:2)`,
  );
});

test("GITHUB_BASE_REF sets the base, and a base without the allowlist skips the check", (t) => {
  const root = repository(t, { "README.md": "Fixture.\n" });
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(root, "checkout", "--quiet", "-b", "add-guard");
  write(root, clean);
  const added = guard(root, [], { GITHUB_BASE_REF: "main" });
  assert.equal(added.status, 0, added.lines.join("\n"));
  assert.match(
    added.lines[0],
    /, base origin\/main has no allowlist, base check skipped, \d+ ms$/,
  );

  git(root, "add", "--all");
  git(root, "commit", "--quiet", "-m", "guard");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  write(root, { [allowlist]: "ignore generated/\n" });
  const grown = guard(root, [], { GITHUB_BASE_REF: "main" });
  assert.equal(grown.status, 1);
  assert.equal(
    grown.lines[0],
    `ignore generated/ (allowlist line ${allowlist}:1 is not on base origin/main)`,
  );
});

test("file and directory names are hits keyed by their directory", (t) => {
  const root = repository(t, clean);
  write(root, {
    [`src/${W}-client.ts`]: "export {};\n",
    [`docs/${W}/README.md`]: "Fixture.\n",
  });
  const result = guard(root);
  assert.equal(result.status, 1);
  assert.deepEqual(result.lines.slice(0, -1), [
    `docs/: ${W} (not in the allowlist)`,
    `src/: ${W}-client.ts (not in the allowlist)`,
  ]);
  write(root, {
    [allowlist]: `NM1.1 docs/ ${W}\nNM1.1 src/ ${W}-client.ts\n`,
  });
  assert.equal(guard(root).status, 0);
});

test("skipped paths and ignore lines hold no hits", (t) => {
  const root = repository(t, {
    ...clean,
    "node_modules/pkg/index.js": `export const ${W}Url = 1;\n`,
    "dist/index.js": `export const ${W}Url = 1;\n`,
    "package-lock.json": `{ "${W}Url": 1 }\n`,
    "image.png": `\u0089PNG ${W}Url`,
    "data.txt": `\u0000${W}Url\n`,
    "evidence/run/report.json": `{ "${W}Url": 1 }\n`,
    [allowlist]: `ignore evidence/\n# NM1.1 src/x.ts ${W}Url\n`,
  });
  const result = guard(root);
  assert.equal(result.status, 0, result.lines.join("\n"));
  write(root, { "src/visible.txt": `${W}Url\n` });
  assert.deepEqual(guard(root).lines.slice(0, -1), [
    `src/visible.txt: ${W}Url (not in the allowlist)`,
  ]);
});

test("--list prints an entry for each hit with its owner", (t) => {
  const root = repository(t, {
    ...clean,
    "src/old.ts": `export const ${W}Url = OPEN_E2EE_${U}_TOKEN;\n`,
    [allowlist]: `NM7.3 src/old.ts ${W}Url\n`,
  });
  const result = guard(root, ["--no-base", "--list"]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.lines, [
    `UNOWNED src/old.ts OPEN_E2EE_${U}_TOKEN`,
    `NM7.3 src/old.ts ${W}Url`,
  ]);
});

test("usage and configuration errors exit 2", (t) => {
  const root = repository(t, clean);
  assert.equal(guard(root, ["--base", "missing"]).status, 2);
  assert.equal(guard(root, ["--base", "main", "--no-base"]).status, 2);
  write(root, { [allowlist]: `lowercase src/old.ts ${W}Url\n` });
  const malformed = guard(root);
  assert.equal(malformed.status, 2);
  assert.match(
    malformed.stderr,
    /signal-relay-naming-allowlist\.txt:1: expected/,
  );
});

test("the rules separate bare identifiers from prefixed names and prose", () => {
  const cases = [
    [`const ${W}Url = 1;`, [`${W}Url`]],
    [`type ${C}Error = string;`, [`${C}Error`]],
    [`process.env.OPEN_E2EE_${U}_TOKEN`, [`OPEN_E2EE_${U}_TOKEN`]],
    [`"x-${W}-audit": 1`, [`x-${W}-audit`]],
    [`CREATE TABLE ${W}_receipts`, [`${W}_receipts`]],
    [`https://sandbox.${W}.open-e2ee.dev/v1`, [`sandbox.${W}.open-e2ee.dev`]],
    [`workers/${W}-core/wrangler.jsonc`, [`${W}-core`]],
    [
      `"OpenE2EE ${C} group credential v1"`,
      [`OpenE2EE ${C} group credential v1`],
    ],
    [`options.${W}.host`, [`options.${W}.host`]],
    [`connect({ ${W} })`, [W]],
    [`new WebSocket(url, ["${W}"])`, [W]],
    [`SELECT id AS ${W}`, [W]],
    [`const signal${C}Url = 1;`, []],
    [`class SignalProtocol${C}Client {}`, []],
    [`process.env.OPEN_E2EE_SIGNAL_${U}_TOKEN`, []],
    [`"x-signal-${W}-audit": 1`, []],
    [`CREATE TABLE signal_${W}_receipts`, []],
    [`// The ${W} forwards each message.`, []],
    [`"The ${C} is not available."`, []],
    [`log("\\n${W}ed")`, []],
    [`${W}ed, ${W}s, and ${W}ing`, []],
  ];
  for (const [line, expected] of cases) {
    assert.deepEqual(lineIdentifiers(line), expected, line);
  }
  assert.deepEqual(pathNames(`src/${W}-client.ts`), [
    ["src/", `${W}-client.ts`],
  ]);
  assert.deepEqual(pathNames(`${W}.md`), [["./", `${W}.md`]]);
  assert.deepEqual(pathNames(`src/signal-${W}-client.ts`), []);
});
