import assert from "node:assert/strict";
import test from "node:test";

import {
  deletePreviewWorker,
  getPreviewWorkerName,
} from "../scripts/cleanup-cloudflare-preview.mjs";

test("derives the preview Worker name from a pull request number", () => {
  assert.equal(getPreviewWorkerName("19"), "open-e2ee-website-pr-19");
  assert.throws(
    () => getPreviewWorkerName("19-other"),
    /positive integer/,
  );
});

test("deletes only the derived preview Worker", async () => {
  const requests = [];
  const result = await deletePreviewWorker({
    accountId: "account-id",
    apiToken: "token",
    pullNumber: "19",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({ success: true, errors: [] });
    },
  });

  assert.deepEqual(result, {
    deleted: true,
    workerName: "open-e2ee-website-pr-19",
  });
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://api.cloudflare.com/client/v4/accounts/account-id/workers/scripts/open-e2ee-website-pr-19",
  );
  assert.equal(requests[0].options.method, "DELETE");
  assert.equal(requests[0].options.headers.Authorization, "Bearer token");
});

test("treats an absent preview Worker as a successful cleanup", async () => {
  const result = await deletePreviewWorker({
    accountId: "account-id",
    apiToken: "token",
    pullNumber: "19",
    fetchImpl: async () => new Response(null, { status: 404 }),
  });

  assert.equal(result.deleted, false);
});

test("reports a Cloudflare API error without exposing the token", async () => {
  await assert.rejects(
    deletePreviewWorker({
      accountId: "account-id",
      apiToken: "secret-token",
      pullNumber: "19",
      fetchImpl: async () =>
        Response.json(
          {
            success: false,
            errors: [{ code: 10000, message: "Authentication error" }],
          },
          { status: 403 },
        ),
    }),
    (error) => {
      assert.match(error.message, /10000: Authentication error/);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    },
  );
});
