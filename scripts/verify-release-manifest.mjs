import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const RELEASE_PACKAGE_NAMES = [
  "@open-e2ee/signal-protocol-sdk",
  "@open-e2ee/cli",
  "create-oe",
  "@open-e2ee/cli-darwin-arm64",
  "@open-e2ee/cli-darwin-x64",
  "@open-e2ee/cli-linux-arm64",
  "@open-e2ee/cli-linux-x64",
  "@open-e2ee/cli-win32-arm64",
  "@open-e2ee/cli-win32-x64",
];

export const RELEASE_ARTIFACT_NAMES = [
  "sdk-sbom.cdx.json",
  "cli-sbom.cdx.json",
  "checksums.txt",
  "oe_1.0.0_darwin_arm64.tar.gz",
  "oe_1.0.0_darwin_amd64.tar.gz",
  "oe_1.0.0_linux_arm64.tar.gz",
  "oe_1.0.0_linux_amd64.tar.gz",
  "oe_1.0.0_windows_arm64.tar.gz",
  "oe_1.0.0_windows_amd64.tar.gz",
];

export const RELEASE_SOURCE_NAMES = {
  pullRequests: ["sdk", "website", "console"],
  repositories: ["relay", "sdkInternal", "sdkPublic", "cli", "design"],
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error(
      "usage: node scripts/verify-release-manifest.mjs <release-manifest.json>",
    );
  }

  const manifest = JSON.parse(
    await readFile(path.resolve(manifestPath), "utf8"),
  );
  const failures = validateReleaseManifest(manifest);
  if (failures.length > 0) {
    throw new Error(
      `Public release manifest verification failed:\n- ${failures.join("\n- ")}`,
    );
  }

  process.stdout.write("Public release manifest contract passed\n");
}

export function validateReleaseManifest(value) {
  const failures = [];
  const expect = (condition, message) => {
    if (!condition) failures.push(message);
  };

  expect(isRecord(value), "manifest must be an object");
  if (!isRecord(value)) return failures;
  expect(
    exactKeys(value, [
      "schemaVersion",
      "releaseId",
      "createdAt",
      "sources",
      "packages",
      "artifacts",
    ]),
    "manifest keys must match schema version 1",
  );
  expect(value.schemaVersion === 1, "schemaVersion must be 1");
  expect(
    value.releaseId === "open-e2ee-relay-public-beta-v1",
    "releaseId must name the public beta release",
  );
  expect(
    isCanonicalTime(value.createdAt),
    "createdAt must be canonical UTC time",
  );
  expect(!containsProhibitedKey(value), "manifest contains a prohibited key");

  expect(
    exactKeys(value.sources, ["pullRequests", "repositories"]),
    "sources must contain exact pull-request and repository groups",
  );
  for (const [group, names] of Object.entries(RELEASE_SOURCE_NAMES)) {
    const entries = value.sources?.[group];
    expect(
      exactKeys(entries, names),
      `sources.${group} must have the exact roster`,
    );
    for (const name of names) {
      expect(
        /^[a-f0-9]{40}$/.test(entries?.[name] ?? ""),
        `sources.${group}.${name} must be a full commit digest`,
      );
    }
  }

  expect(
    exactKeys(value.packages, RELEASE_PACKAGE_NAMES),
    "packages must have the exact roster",
  );
  for (const name of RELEASE_PACKAGE_NAMES) {
    const entry = value.packages?.[name];
    expect(
      exactKeys(entry, ["version", "integrity"]),
      `package ${name} has invalid keys`,
    );
    expect(entry?.version === "1.0.0", `package ${name} must be version 1.0.0`);
    expect(
      isSha512Integrity(entry?.integrity),
      `package ${name} must have SHA-512 registry integrity`,
    );
  }

  expect(
    exactKeys(value.artifacts, RELEASE_ARTIFACT_NAMES),
    "artifacts must have the exact release roster",
  );
  for (const name of RELEASE_ARTIFACT_NAMES) {
    const entry = value.artifacts?.[name];
    expect(exactKeys(entry, ["sha256"]), `artifact ${name} has invalid keys`);
    expect(
      /^[a-f0-9]{64}$/.test(entry?.sha256 ?? ""),
      `artifact ${name} must have a SHA-256 digest`,
    );
  }

  return failures;
}

function exactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCanonicalTime(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function isSha512Integrity(value) {
  if (typeof value !== "string" || !value.startsWith("sha512-")) {
    return false;
  }
  const encoded = value.slice("sha512-".length);
  if (!/^[A-Za-z0-9+/]{86}==$/.test(encoded)) return false;
  const digest = Buffer.from(encoded, "base64");
  return digest.length === 64 && digest.toString("base64") === encoded;
}

function containsProhibitedKey(value) {
  if (Array.isArray(value)) return value.some(containsProhibitedKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /^(accountId|zoneId|token|credential|secret|cookie|browserStorage|providerSubject|deviceId|messageId|attachmentId|groupId)$/i.test(
        key,
      ) || containsProhibitedKey(child),
  );
}
