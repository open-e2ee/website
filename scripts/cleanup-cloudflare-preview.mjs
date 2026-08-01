import { pathToFileURL } from "node:url";

const WORKER_PREFIX = "open-e2ee-website-pr-";

export function getPreviewWorkerName(pullNumber) {
  if (!/^[1-9]\d*$/.test(String(pullNumber))) {
    throw new Error("PREVIEW_PULL_NUMBER must be a positive integer.");
  }

  return `${WORKER_PREFIX}${pullNumber}`;
}

export async function deletePreviewWorker({
  accountId,
  apiToken,
  pullNumber,
  fetchImpl = fetch,
}) {
  if (!accountId) {
    throw new Error("Set CLOUDFLARE_ACCOUNT_ID.");
  }
  if (!apiToken) {
    throw new Error("Set CLOUDFLARE_API_TOKEN.");
  }

  const workerName = getPreviewWorkerName(pullNumber);
  const endpoint = new URL(
    `/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(workerName)}`,
    "https://api.cloudflare.com",
  );
  const response = await fetchImpl(endpoint, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (response.status === 404) {
    return { deleted: false, workerName };
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    const details = payload?.errors
      ?.map((error) => `${error.code}: ${error.message}`)
      .join(", ");
    throw new Error(
      `Cloudflare rejected the preview cleanup (${response.status})${details ? `: ${details}` : "."}`,
    );
  }

  return { deleted: true, workerName };
}

async function main() {
  const result = await deletePreviewWorker({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: process.env.CLOUDFLARE_API_TOKEN,
    pullNumber: process.env.PREVIEW_PULL_NUMBER,
  });
  const action = result.deleted ? "Deleted" : "Did not find";
  console.log(`${action} Cloudflare preview Worker ${result.workerName}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
