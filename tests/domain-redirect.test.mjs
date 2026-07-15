import assert from "node:assert/strict";
import test from "node:test";

import { redirectRequest } from "../src/workers/domain-redirect.ts";

test("redirects the apex to the canonical domain", () => {
  const response = redirectRequest(new Request("https://signalprotocol.dev/"));

  assert.equal(response.status, 308);
  assert.equal(response.headers.get("location"), "https://signal-protocol.dev/");
});

test("preserves paths and query strings", () => {
  const response = redirectRequest(
    new Request("https://www.signalprotocol.dev/docs/getting-started?from=alias"),
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    "https://signal-protocol.dev/docs/getting-started?from=alias",
  );
});

test("keeps protocol-relative-looking paths on the canonical host", () => {
  const response = redirectRequest(
    new Request("https://signalprotocol.dev//example.com/path"),
  );

  assert.equal(
    response.headers.get("location"),
    "https://signal-protocol.dev//example.com/path",
  );
});
