/**
 * The site is static. This Worker exists for one route: the measurement
 * endpoint that public/measure.js posts to. Everything else is handed to the
 * asset server unchanged, so `_headers`, `_redirects`, and the 404 page keep
 * behaving exactly as they did before a Worker existed.
 *
 * What is stored is the whole privacy claim, so it is enforced here rather
 * than trusted to the client: an event name from a fixed list, a path scrubbed
 * to a shape that cannot carry a payload, and one label from a fixed list. No
 * cookie is set or read, no identifier is derived, and the client address is
 * never written to the dataset. A request the client can shape is a request an
 * attacker can shape, so nothing here is echoed back or stored unvalidated.
 */

/*
 * The events the site measures. Anything else is dropped.
 *
 * Exported because this is the only copy that decides anything, and the tests
 * and the smoke harness both need to ask what it holds. They used to keep
 * their own lists, which agreed with this one right up until an event was
 * added here and nowhere else — at which point the collector accepts a name
 * no page sends, and a metric that reports nothing looks identical to one
 * nobody triggered.
 */
export const EVENTS = new Set([
  'demo_run',
  'quickstart_open',
  'runtime_select',
  'install_copy',
  'guide_finish',
  'github_open',
  'security_view',
  'pricing_view',
  'signup_start',
  'enterprise_contact',
  'scenario_opened',
]);

/*
 * The only labels any event carries. Free text is never stored.
 *
 * The scenario slugs are here one at a time, as each scenario ships. A label
 * accepted before the page that sends it exists would make an unopened
 * scenario and an unbuilt one look the same in the dataset — which is the
 * question `/demo` is measured to answer.
 */
export const LABELS = new Set([
  'expo',
  'browser',
  'node',
  'flip-a-byte',
  'add-a-second-device',
  'run-out-of-prekeys',
  'reinstall-a-device',
]);

const COLLECT_PATH = '/e';
const MAX_BODY_BYTES = 128;

/*
 * Declared here rather than pulled from @cloudflare/workers-types, which
 * redefines Request, Response and friends globally and would fight the DOM lib
 * the rest of this project is written against. Two shapes are all this needs.
 */
interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Absent until the Analytics Engine dataset is bound; see wrangler.jsonc. */
  MEASUREMENTS?: {
    writeDataPoint(point: { indexes?: string[]; blobs?: string[]; doubles?: number[] }): void;
  };
}

/**
 * Reduces a client-supplied path to something safe to store: our own routes
 * are lowercase, hyphenated and slash-separated, so anything else is either a
 * mistake or an attempt to smuggle a value into the dataset.
 */
function scrubPath(value: string): string {
  const path = value.split('?')[0].split('#')[0];
  if (!path.startsWith('/') || path.length > 96) return '/other';
  return /^[a-z0-9/_.-]*$/.test(path.slice(1)) ? path : '/other';
}

export async function collect(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
  }

  /* Browsers set Origin on beacons and cross-origin posts alike. Requiring it
   * to be ours costs nothing and drops casual cross-site noise; it is not a
   * security control, because anything off-browser can send whatever it likes.
   * The endpoint is unauthenticated by nature, so the dataset is a popularity
   * signal, never a source of truth. */
  const origin = request.headers.get('origin');
  if (origin && new URL(request.url).origin !== origin) {
    return new Response('Forbidden', { status: 403 });
  }

  const body = (await request.text()).slice(0, MAX_BODY_BYTES);
  const [event, path = '/', label = ''] = body.split(' ');

  if (EVENTS.has(event)) {
    env.MEASUREMENTS?.writeDataPoint({
      /* One index, because Analytics Engine samples per index and the event
       * name is the dimension every question starts from. */
      indexes: [event],
      blobs: [event, scrubPath(path), LABELS.has(label) ? label : ''],
      doubles: [1],
    });
  }

  /* 204 whatever happened. The client cannot act on the answer, and a body
   * that varied with validation would tell a prober what we accept. */
  return new Response(null, {
    status: 204,
    headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === COLLECT_PATH) return collect(request, env);
    return env.ASSETS.fetch(request);
  },
};
