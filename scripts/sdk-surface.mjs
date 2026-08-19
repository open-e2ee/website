/*
 * The SDK's real public surface, read from the package itself.
 *
 * The site prints import statements and symbol names as fact. Four of them
 * were wrong at once — all four had dropped the word "Protocol" from a real
 * export — and nothing in the build noticed, because to Astro they are just
 * words. This module produces the ground truth the audit checks them against.
 *
 * Ground truth is the published npm package (a devDependency, so the version
 * is pinned and reviewable). If it is absent, the sibling source checkout is
 * used instead, which is the same surface before the build step.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

export const SDK_PACKAGE = '@open-e2ee/signal-protocol-sdk';

const HERE = dirname(new URL(import.meta.url).pathname);
const INSTALLED = resolve(HERE, '..', 'node_modules', SDK_PACKAGE);
const SIBLING = resolve(HERE, '..', '..', 'signal-protocol-js');

/**
 * Where to read the SDK from, and how its exports map resolves to files.
 *
 * The installed package ships `dist/**.d.ts`, which is what the exports map
 * names. The sibling checkout has no dist, so the same entry is rewritten to
 * the TypeScript source it is built from.
 */
function locate() {
  if (existsSync(join(INSTALLED, 'package.json'))) {
    return { root: INSTALLED, origin: 'installed package', fromSource: false };
  }
  if (existsSync(join(SIBLING, 'package.json'))) {
    return { root: SIBLING, origin: 'sibling source checkout', fromSource: true };
  }
  return null;
}

function entryFile(root, target, fromSource) {
  const rel = typeof target === 'string' ? target : (target?.types ?? target?.default);
  if (typeof rel !== 'string' || !rel.endsWith('.d.ts')) return null;
  if (!fromSource) return join(root, rel);
  return join(root, rel.replace(/^\.\/dist\//, '').replace(/\.d\.ts$/, '.ts'));
}

/*
 * Names bound by a declaration, plus the string literals a declaration can be
 * compared against. Hook names and trust states reach the site as string
 * literals (`'onMessageDecrypted'`, `UNVERIFIED_TOFU`), so a vocabulary built
 * only from identifiers would report them as invented.
 */
function collectVocabulary(sourceFile, into) {
  const visit = (node) => {
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      into.add(node.literal.text);
    }
    const name = node.name;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
      const text = ts.isIdentifier(name) ? name.text : name.text;
      if (
        ts.isInterfaceDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isEnumMember(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isMethodSignature(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isModuleDeclaration(node)
      ) {
        into.add(text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

/*
 * Property names grouped by the interface that declares them.
 *
 * The flat vocabulary answers "is this a real name anywhere in the SDK", which
 * is the right question for prose. The live demo asks a narrower one: it prints
 * the fields of an envelope it built at runtime, and a test of that has to know
 * which names belong to `Envelope` specifically. Declarations of the same name
 * in several files union together, which is also how TypeScript reads them.
 */
function collectMembers(sourceFile, into) {
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node)) {
      const names = into.get(node.name.text) ?? new Set();
      for (const member of node.members) {
        if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue;
        const name = member.name;
        if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) names.add(name.text);
      }
      into.set(node.name.text, names);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
}

/**
 * @returns {Promise<{
 *   origin: string,
 *   version: string,
 *   subpaths: Map<string, Set<string>>,
 *   vocabulary: Set<string>,
 *   members: Map<string, Set<string>>,
 * } | null>} `null` when no copy of the SDK can be found at all.
 */
export async function readSdkSurface() {
  const found = locate();
  if (!found) return null;

  const { root, origin, fromSource } = found;
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

  const entries = new Map();
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    const file = entryFile(root, target, fromSource);
    if (file && existsSync(file)) entries.set(subpath, file);
  }
  if (entries.size === 0) return null;

  const program = ts.createProgram([...entries.values()], {
    noEmit: true,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
    allowJs: false,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ESNext,
  });
  const checker = program.getTypeChecker();

  const subpaths = new Map();
  for (const [subpath, file] of entries) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const moduleSymbol = checker.getSymbolAtLocation(source);
    const names = new Set(
      moduleSymbol ? checker.getExportsOfModule(moduleSymbol).map((s) => s.getName()) : [],
    );
    subpaths.set(subpath, names);
  }

  /* Members and literals from every file the entries reach, not just the
   * entries, so a property declared two files deep still counts as real. */
  const vocabulary = new Set();
  const members = new Map();
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.startsWith(root)) continue;
    collectVocabulary(source, vocabulary);
    collectMembers(source, members);
  }
  for (const names of subpaths.values()) for (const name of names) vocabulary.add(name);

  return { root, origin, version: manifest.version, subpaths, vocabulary, members };
}

/*
 * Suggestion, not fuzzy matching. Every one of the four shipped mistakes was
 * a real export with the token "Protocol" removed, so the normalization that
 * explains them is exactly that one — plus case, which costs nothing.
 */
export function suggest(name, candidates) {
  const key = (value) => value.toLowerCase().replaceAll('protocol', '');
  const wanted = key(name);
  for (const candidate of candidates) {
    if (candidate !== name && key(candidate) === wanted) return candidate;
  }
  return null;
}
