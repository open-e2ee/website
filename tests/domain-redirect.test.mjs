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

function wranglerConfig(name) {
  return JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
}

test("keeps canonical and redirect Worker host assignments disjoint", () => {
  const canonicalHosts = wranglerConfig("wrangler.jsonc").routes.map((route) => route.pattern);
  const redirectHosts = wranglerConfig("wrangler.redirect.jsonc").routes.map((route) => route.pattern);

  assert.deepEqual(canonicalHosts, ["open-e2ee.dev"]);
  assert.deepEqual(redirectHosts, aliases);
  assert.equal(redirectHosts.includes("open-e2ee.dev"), false);
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
