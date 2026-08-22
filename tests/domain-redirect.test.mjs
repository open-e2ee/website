import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { REDIRECT_HOSTS, redirectRequest } from "../src/workers/domain-redirect.ts";

const aliases = [
  "www.open-e2ee.dev",
  "signal-protocol.dev",
  "www.signal-protocol.dev",
  "docs.signal-protocol.dev",
  "console.signal-protocol.dev",
  "signalprotocol.dev",
  "www.signalprotocol.dev",
  "open-e2ee.com",
  "www.open-e2ee.com",
  "opene2ee.dev",
  "www.opene2ee.dev",
];

const canaryAliases = [
  "signal-protocol.dev",
  "www.signal-protocol.dev",
  "docs.signal-protocol.dev",
  "console.signal-protocol.dev",
];

const canonicalAliases = ["www.open-e2ee.dev", ...canaryAliases];

/*
 * The configs are .jsonc and do carry comments, so they cannot go straight to
 * JSON.parse. Strings are matched first in the alternation below, which is what
 * keeps a "//" inside a value from being read as the start of a comment.
 */
function wranglerConfig(name) {
  const source = readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  const withoutComments = source.replace(
    /("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (match, string) => string ?? "",
  );
  return JSON.parse(withoutComments);
}

function workflow(name) {
  return readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
}

test("keeps canonical and redirect Worker host assignments disjoint", () => {
  const canonicalHosts = wranglerConfig("wrangler.jsonc").routes.map((route) => route.pattern);
  const redirectHosts = wranglerConfig("wrangler.redirect.jsonc").routes.map((route) => route.pattern);

  assert.deepEqual(canonicalHosts, ["open-e2ee.dev"]);
  assert.deepEqual(redirectHosts, aliases);
  assert.equal(redirectHosts.includes("open-e2ee.dev"), false);
});

test("stages the redirect Worker without claiming a hostname", () => {
  const production = wranglerConfig("wrangler.redirect.jsonc");
  const stage = wranglerConfig("wrangler.redirect.stage.jsonc");

  assert.equal(stage.name, `${production.name}-stage`);
  assert.equal(stage.main, production.main);
  assert.deepEqual(stage.routes, []);
  assert.equal(stage.workers_dev, false);
});

test("stages the canonical website under an isolated Worker name with no routes", () => {
  const migration = workflow("deploy-redirect-migration.yml");
  const production = wranglerConfig("wrangler.jsonc");
  const stage = wranglerConfig("wrangler.website.stage.jsonc");

  assert.match(migration, /command: deploy --config wrangler\.website\.stage\.jsonc --env=""/);
  assert.equal(stage.name, `${production.name}-stage`);
  assert.notEqual(stage.name, production.name);
  assert.equal(stage.main, production.main);
  assert.equal(stage.compatibility_date, production.compatibility_date);
  assert.deepEqual(stage.compatibility_flags, production.compatibility_flags);
  assert.deepEqual(stage.assets, production.assets);
  assert.deepEqual(stage.analytics_engine_datasets, production.analytics_engine_datasets);
  assert.deepEqual(stage.observability, production.observability);
  assert.deepEqual(stage.routes, []);
  assert.equal(stage.workers_dev, false);
  assert.equal(stage.preview_urls, false);
});

test("limits canary activation to the four canary hostnames", () => {
  const production = wranglerConfig("wrangler.redirect.jsonc");
  const canary = wranglerConfig("wrangler.redirect.canary.jsonc");
  const canaryHosts = canary.routes.map((route) => route.pattern);

  assert.equal(canary.name, production.name);
  assert.equal(canary.main, production.main);
  assert.deepEqual(canaryHosts, canaryAliases);
  assert.equal(canary.routes.every((route) => route.custom_domain === true), true);
  assert.equal(canaryHosts.every((host) => aliases.includes(host)), true);
  assert.equal(canaryHosts.includes("open-e2ee.dev"), false);
});

test("limits canonical activation to the canonical alias and canary hostnames", () => {
  const production = wranglerConfig("wrangler.redirect.jsonc");
  const canonical = wranglerConfig("wrangler.redirect.canonical.jsonc");
  const canonicalHosts = canonical.routes.map((route) => route.pattern);

  assert.equal(canonical.name, production.name);
  assert.equal(canonical.main, production.main);
  assert.deepEqual(canonicalHosts, canonicalAliases);
  assert.equal(canonical.routes.every((route) => route.custom_domain === true), true);
  assert.equal(canonicalHosts.every((host) => aliases.includes(host)), true);
  assert.equal(canonicalHosts.includes("open-e2ee.dev"), false);
});

test("activates the complete redirect set only through the final migration operation", () => {
  const migration = workflow("deploy-redirect-migration.yml");

  assert.match(migration, /- activate-final/);
  assert.match(migration, /if: inputs\.operation == 'activate-final'/);
  assert.match(migration, /command: deploy --config wrangler\.redirect\.jsonc --env=""/);
});

test("redirects every configured alias to the canonical domain", () => {
  assert.deepEqual([...REDIRECT_HOSTS], aliases);

  for (const host of aliases) {
    const response = redirectRequest(new Request(`https://${host}/`));
    const expectedOrigin =
      host === "docs.signal-protocol.dev"
        ? "https://docs.open-e2ee.dev"
        : host === "console.signal-protocol.dev"
          ? "https://console.open-e2ee.dev"
          : "https://open-e2ee.dev";
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), `${expectedOrigin}/`);
  }
});

test("preserves paths and query strings", () => {
  const response = redirectRequest(
    new Request("https://www.signal-protocol.dev/docs/getting-started?from=legacy"),
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://open-e2ee.dev/docs/getting-started?from=legacy",
  );
});

test("redirects legacy Docs and Console hosts to their canonical counterparts", () => {
  const docsResponse = redirectRequest(
    new Request("https://docs.signal-protocol.dev/guides/start?from=legacy"),
  );
  const consoleResponse = redirectRequest(
    new Request("https://console.signal-protocol.dev/login?next=%2Fkeys"),
  );

  assert.equal(
    docsResponse.headers.get("location"),
    "https://docs.open-e2ee.dev/guides/start?from=legacy",
  );
  assert.equal(
    consoleResponse.headers.get("location"),
    "https://console.open-e2ee.dev/login?next=%2Fkeys",
  );
});

test("keeps protocol-relative-looking paths on the canonical host", () => {
  const response = redirectRequest(
    new Request("https://signalprotocol.dev//example.com/path"),
  );

  assert.equal(
    response.headers.get("location"),
    "https://open-e2ee.dev//example.com/path",
  );
});

test("does not become an open redirect for an unconfigured host", () => {
  const response = redirectRequest(new Request("https://attacker.example/path"));
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("location"), null);
});
