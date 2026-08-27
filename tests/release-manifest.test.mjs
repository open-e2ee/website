import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  RELEASE_ARTIFACT_NAMES,
  RELEASE_PACKAGE_NAMES,
  RELEASE_SOURCE_NAMES,
  validateReleaseManifest,
} from "../scripts/verify-release-manifest.mjs";

test("accepts the exact public release manifest roster", () => {
  assert.deepEqual(validateReleaseManifest(fixture()), []);
});

test("keeps one exact release roster", () => {
  const candidate = fixture();
  assert.deepEqual(
    Object.keys(candidate.packages).sort(),
    [...RELEASE_PACKAGE_NAMES].sort(),
  );
  assert.deepEqual(
    Object.keys(candidate.artifacts).sort(),
    [...RELEASE_ARTIFACT_NAMES].sort(),
  );
});

for (const [name, mutate, expected] of [
  [
    "unknown top-level key",
    (value) => {
      value.extra = true;
    },
    "manifest keys must match schema version 2",
  ],
  [
    "short source revision",
    (value) => {
      value.sources.repositories.cli = "abc123";
    },
    "must be a full commit digest",
  ],
  [
    "unknown pull-request lifecycle state",
    (value) => {
      value.sources.pullRequests.sdk.state = "CLOSED";
    },
    "must have an OPEN or MERGED lifecycle state",
  ],
  [
    "merge commit on an open pull request",
    (value) => {
      value.sources.pullRequests.sdk.mergeCommit = "b".repeat(40);
    },
    "OPEN source must not have a merge commit",
  ],
  [
    "missing merged pull-request commit",
    (value) => {
      value.sources.pullRequests.console.mergeCommit = null;
    },
    "MERGED source must have a full merge commit",
  ],
  [
    "missing package",
    (value) => {
      delete value.packages["create-oe"];
    },
    "packages must have the exact roster",
  ],
  [
    "wrong package version",
    (value) => {
      value.packages["@open-e2ee/cli"].version = "1.0.1";
    },
    "must be version 1.0.0",
  ],
  [
    "short package integrity",
    (value) => {
      value.packages["@open-e2ee/cli"].integrity = `sha512-${"A".repeat(84)}`;
    },
    "must have SHA-512 registry integrity",
  ],
  [
    "missing artifact",
    (value) => {
      delete value.artifacts["cli-sbom.cdx.json"];
    },
    "artifacts must have the exact release roster",
  ],
  [
    "invalid digest",
    (value) => {
      value.artifacts["checksums.txt"].sha256 = "not-a-digest";
    },
    "must have a SHA-256 digest",
  ],
  [
    "prohibited identifier field",
    (value) => {
      value.packages["@open-e2ee/cli"].token = "redacted";
    },
    "manifest contains a prohibited key",
  ],
]) {
  test(`rejects ${name}`, () => {
    const value = fixture();
    mutate(value);
    assert.ok(
      validateReleaseManifest(value).some((failure) =>
        failure.includes(expected),
      ),
    );
  });
}

test("keeps the attestation workflow pinned and fail-closed", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release-manifest.yml", import.meta.url),
    "utf8",
  );
  for (const required of [
    "branches: [main]",
    "public/releases/open-e2ee-relay-public-beta-v1.json",
    "id-token: write",
    "attestations: write",
    "npm run build",
    "npm test",
    "npm run release:manifest:verify",
    "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
  ]) {
    assert.ok(
      workflow.includes(required),
      `release workflow is missing ${required}`,
    );
  }
  assert.doesNotMatch(
    workflow,
    /workflow_dispatch|pull_request|branches:\s*\[?\*\*?/,
  );
});

function fixture() {
  const sha = "a".repeat(40);
  const integrity = `sha512-${"A".repeat(86)}==`;
  const digest = "b".repeat(64);
  return {
    schemaVersion: 2,
    releaseId: "open-e2ee-relay-public-beta-v1",
    createdAt: "2026-08-27T00:00:00.000Z",
    sources: {
      pullRequests: Object.fromEntries(
        RELEASE_SOURCE_NAMES.pullRequests.map((name) => [
          name,
          {
            head: sha,
            mergeCommit: name === "console" ? "b".repeat(40) : null,
            state: name === "console" ? "MERGED" : "OPEN",
          },
        ]),
      ),
      repositories: Object.fromEntries(
        RELEASE_SOURCE_NAMES.repositories.map((name) => [name, sha]),
      ),
    },
    packages: Object.fromEntries(
      RELEASE_PACKAGE_NAMES.map((name) => [
        name,
        { version: "1.0.0", integrity },
      ]),
    ),
    artifacts: Object.fromEntries(
      RELEASE_ARTIFACT_NAMES.map((name) => [name, { sha256: digest }]),
    ),
  };
}
