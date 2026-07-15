const CANONICAL_ORIGIN = "https://signal-protocol.dev";

export function redirectRequest(request: Request): Response {
  const source = new URL(request.url);
  const destination = `${CANONICAL_ORIGIN}${source.pathname}${source.search}`;

  return Response.redirect(destination, 308);
}

export default {
  fetch: redirectRequest,
} satisfies { fetch(request: Request): Response };
