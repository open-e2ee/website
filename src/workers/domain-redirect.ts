const CANONICAL_ORIGIN = "https://open-e2ee.dev";

const HOST_ORIGIN_OVERRIDES = new Map([
  ["docs.signal-protocol.dev", "https://docs.open-e2ee.dev"],
  ["console.signal-protocol.dev", "https://console.open-e2ee.dev"],
]);

export const REDIRECT_HOSTS = new Set([
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
]);

export function redirectRequest(request: Request): Response {
  const source = new URL(request.url);
  if (!REDIRECT_HOSTS.has(source.hostname.toLowerCase())) {
    return new Response("Not found", { status: 404 });
  }
  const destinationOrigin =
    HOST_ORIGIN_OVERRIDES.get(source.hostname.toLowerCase()) ?? CANONICAL_ORIGIN;
  const destination = `${destinationOrigin}${source.pathname}${source.search}`;

  return Response.redirect(destination, 308);
}

export default {
  fetch: redirectRequest,
} satisfies { fetch(request: Request): Response };
