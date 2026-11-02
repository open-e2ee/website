export const PROJECT_KEY = 'phc_mprqLWYwNPudDiCKthLDxg87Qm5sma42a7LVNkXcnBWi';
export const CONSENT_COOKIE = 'oe_analytics_consent';
export const ANALYTICS_COOKIE = `ph_${PROJECT_KEY}_posthog`;
export const CTA_NAMES = new Set(['quickstart_open', 'runtime_select', 'github_open', 'signup_start', 'enterprise_contact', 'install_copy']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CAMPAIGNS = {
  utm_source: new Set(['hackernews', 'reddit', 'stackoverflow', 'devto', 'github', 'newsletter']),
  utm_medium: new Set(['referral', 'social', 'email', 'community']),
  utm_campaign: new Set(['sdk-launch', 'relay-launch', 'discovery-2026']),
};

export function privacySignal(nav) {
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes';
}

export function hasConsent(doc, nav) {
  return !privacySignal(nav) && doc.cookie.split(';').some((part) => part.trim() === `${CONSENT_COOKIE}=v1.accepted`);
}

export function pageProperties(location, referrer, routes) {
  const path = location.pathname.replace(/\/$/, '') || '/';
  const props = { surface: 'website', page_path: routes.has(path) ? path : '/other' };
  try {
    const host = new URL(referrer).hostname;
    if (/^[a-z0-9.-]{1,253}$/.test(host)) props.referrer_host = host;
  } catch {}
  const query = new URLSearchParams(location.search);
  for (const [name, values] of Object.entries(CAMPAIGNS)) {
    const value = query.get(name);
    if (values.has(value)) props[name] = value;
  }
  return props;
}

export function sanitizeEvent(event, allowed, routes) {
  if (!allowed || !event || !UUID.test(event.uuid ?? '') || !['$pageview', 'website_cta'].includes(event.event)) return null;
  const input = event.properties ?? {};
  const path = routes.has(input.page_path) ? input.page_path : '/other';
  const properties = { surface: 'website', page_path: path, $host: 'open-e2ee.dev', $pathname: path, $current_url: `https://open-e2ee.dev${path}` };
  if (event.event === 'website_cta') {
    if (!CTA_NAMES.has(input.cta)) return null;
    properties.cta = input.cta;
    if (input.cta === 'runtime_select' && ['expo', 'browser', 'node'].includes(input.runtime)) properties.runtime = input.runtime;
  }
  if (/^[a-z0-9.-]{1,253}$/.test(input.referrer_host ?? '')) {
    properties.referrer_host = input.referrer_host;
    properties.$referring_domain = input.referrer_host;
    properties.$referrer = `https://${input.referrer_host}`;
  }
  for (const [name, values] of Object.entries(CAMPAIGNS)) if (values.has(input[name])) properties[name] = input[name];
  for (const name of ['distinct_id', '$device_id']) {
    if (UUID.test(input[name] ?? '') || (name === 'distinct_id' && /^oea_[0-9a-f]{64}$/.test(input[name] ?? ''))) properties[name] = input[name];
  }
  for (const name of ['$session_id', '$window_id']) if (UUID.test(input[name] ?? '')) properties[name] = input[name];
  if (!properties.distinct_id) return null;
  if (input.internal === true) properties.internal = true;
  properties.$process_person_profile = input.$process_person_profile === true;
  properties.$geoip_disable = true;
  properties.$lib = 'web';
  properties.$lib_version = '1.444.4';
  properties.token = PROJECT_KEY;
  return { uuid: event.uuid, event: event.event, properties, ...(event.timestamp instanceof Date && Number.isFinite(event.timestamp.getTime()) ? { timestamp: event.timestamp } : {}) };
}

export function classifyCta(target, location) {
  if (target.closest('[data-install-copy]')) return { cta: 'install_copy' };
  const link = target.closest('a[href]');
  if (!link) return null;
  let url;
  try { url = new URL(link.href, location.href); } catch { return null; }
  if (['docs.open-e2ee.dev', 'console.open-e2ee.dev'].includes(url.hostname)) {
    const runtime = /^\/start\/(expo|browser|node)\/?$/.exec(url.pathname);
    if (runtime) return { cta: 'runtime_select', runtime: runtime[1] };
    if (url.pathname.replace(/\/$/, '') === '/start/quickstart') return { cta: 'quickstart_open' };
    if (url.hostname === 'console.open-e2ee.dev') return { cta: url.searchParams.get('plan') === 'enterprise' ? 'enterprise_contact' : 'signup_start' };
  }
  if (url.origin === 'https://calendar.app.google' && url.pathname === '/ZpFdxaL9HZh9J7x97') return { cta: 'enterprise_contact' };
  if (url.hostname === 'github.com' && /^\/open-e2ee(?:\/|$)/.test(url.pathname)) return { cta: 'github_open' };
  return null;
}
