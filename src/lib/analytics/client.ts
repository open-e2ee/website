import { classifyCta, pageProperties, sanitizeEvent } from './contract.mjs';
import { createAnalyticsRuntime } from './runtime';

export function mountAnalytics(routes: Set<string>) {
  const runtime = createAnalyticsRuntime({
    hostname: 'open-e2ee.dev',
    properties: () => pageProperties(location, document.referrer, routes),
    sanitize: (event, allowed) => sanitizeEvent(event, allowed, routes),
  });
  if (!runtime) return;
  const panel = document.querySelector<HTMLElement>('[data-analytics-panel]');
  const status = document.querySelector<HTMLElement>('[data-analytics-status]');

  function render(open = false) {
    if (!panel) return;
    panel.hidden = !open && (runtime!.blocked() || runtime!.hasChoice());
    if (status) status.textContent = runtime!.blocked()
      ? 'Your browser privacy signal keeps optional analytics off.'
      : runtime!.allowed() ? 'Optional analytics are on. Reject analytics to withdraw consent.' : 'Optional analytics are off.';
    const accept = panel.querySelector<HTMLButtonElement>('[data-analytics-accept]');
    if (accept) accept.disabled = runtime!.blocked();
  }

  document.querySelector('[data-analytics-accept]')?.addEventListener('click', () => runtime.choose(true));
  document.querySelector('[data-analytics-reject]')?.addEventListener('click', () => runtime.choose(false));
  document.querySelectorAll('[data-analytics-preferences]').forEach((button) => button.addEventListener('click', () => {
    render(true);
    panel?.querySelector<HTMLButtonElement>('[data-analytics-reject]')?.focus();
  }));
  document.querySelector('[data-analytics-close]')?.addEventListener('click', () => { if (panel) panel.hidden = true; });
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !runtime.allowed()) return;
    const action = classifyCta(event.target, location);
    if (action) runtime.capture('website_cta', action);
  }, true);
  runtime.mount(() => render());
}
