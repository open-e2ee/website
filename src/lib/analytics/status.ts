import { sanitizeEvent, STATUS_ROUTES, statusPageProperties } from './contract.mjs';
import { createAnalyticsRuntime } from './runtime';

let runtime: ReturnType<typeof createAnalyticsRuntime>;
let renderControls = () => {};
let mounted = false;
let controlsHost: HTMLDivElement | undefined;
let lastPathname: string | undefined;
const navigationPath = () => location.pathname.replace(/\/$/, '') || '/';

function mountStatusAnalytics() {
  runtime ??= createAnalyticsRuntime({
    hostname: 'status.open-e2ee.dev',
    properties: () => { lastPathname = navigationPath(); return statusPageProperties(location, document.referrer); },
    sanitize: (event, allowed) => sanitizeEvent(event, allowed, STATUS_ROUTES, 'status'),
  });
  if (!runtime) return;
  const existing = document.getElementById('oe-status-analytics');
  if (existing === controlsHost && existing?.isConnected) return;
  existing?.remove();
  const host = document.createElement('div');
  host.id = 'oe-status-analytics';
  controlsHost = host;
  const shadow = host.attachShadow({ mode: 'open' });
  // This fixed markup never reads provider incident or subscription content.
  shadow.innerHTML = `
    <style>
      :host { font: 14px/1.5 system-ui,sans-serif; color: #171717; }
      [hidden] { display: none !important; }
      section { position: fixed; inset: auto 16px 16px; z-index: 2147483646; box-sizing: border-box;
        max-width: 640px; max-height: calc(100dvh - 32px); overflow: auto; margin: auto; padding: 20px;
        border: 1px solid #777; background: white; box-shadow: 0 3px 16px #0002; }
      h2 { margin: 0; font-size: 18px; } p { margin: 10px 0; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; align-items: center; }
      button, a { font: inherit; color: inherit; } button { cursor: pointer; }
      .choice { padding: 8px 14px; border: 1px solid #777; background: transparent; }
      button:disabled { opacity: .5; cursor: default; }
      .quiet { border: 0; background: transparent; padding: 8px; text-decoration: underline; }
      #preferences { position: fixed; bottom: 12px; right: 12px; z-index: 2147483645;
        border: 1px solid #777; background: white; padding: 8px 12px; }
      :focus-visible { outline: 2px solid #4338ca; outline-offset: 3px; }
    </style>
    <section hidden aria-labelledby="heading">
      <h2 id="heading">Optional OpenE2EE analytics</h2>
      <p>With your permission, we use PostHog to measure visits and selected actions across the marketing site, documentation, Console, and status pages. If you sign in, we can link these visits to your account through an opaque identifier. PostHog receives no incident text, subscriber inputs, message content, keys, or form text.</p>
      <p id="state" role="status" aria-live="polite"></p>
      <div class="actions">
        <button id="accept" class="choice" type="button">Accept analytics</button>
        <button id="reject" class="choice" type="button">Reject analytics</button>
        <button id="close" class="quiet" type="button">Close</button>
        <a href="https://open-e2ee.dev/legal/privacy#cookies" target="_blank" rel="noopener noreferrer">Privacy notice</a>
      </div>
    </section>
    <button id="preferences" type="button">Analytics preferences</button>`;
  document.body.append(host);
  const panel = shadow.querySelector<HTMLElement>('section')!;
  const preferences = shadow.querySelector<HTMLButtonElement>('#preferences')!;
  const accept = shadow.querySelector<HTMLButtonElement>('#accept')!;
  const reject = shadow.querySelector<HTMLButtonElement>('#reject')!;
  const status = shadow.querySelector<HTMLElement>('#state')!;
  function render(open = false) {
    panel.hidden = !open && (runtime!.blocked() || runtime!.hasChoice());
    preferences.hidden = !panel.hidden;
    accept.disabled = runtime!.blocked();
    status.textContent = runtime!.blocked()
      ? 'Your browser privacy signal keeps optional analytics off.'
      : runtime!.allowed() ? 'Optional analytics are on. Reject analytics to withdraw consent.' : 'Optional analytics are off.';
  }
  accept.addEventListener('click', () => runtime!.choose(true));
  reject.addEventListener('click', () => runtime!.choose(false));
  shadow.querySelector('#close')!.addEventListener('click', () => { panel.hidden = true; preferences.hidden = false; preferences.focus(); });
  preferences.addEventListener('click', () => { render(true); reject.focus(); });
  renderControls = render;
  if (!mounted) { mounted = true; lastPathname = navigationPath(); runtime.mount(() => renderControls()); }
  else render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountStatusAnalytics, { once: true });
else mountStatusAnalytics();

// Better Stack uses Turbo navigation. Retain only an in-memory path comparison.
document.addEventListener('turbo:load', () => {
  mountStatusAnalytics();
  if (runtime && lastPathname !== navigationPath()) {
    lastPathname = navigationPath();
    runtime.capture('$pageview');
  }
});
