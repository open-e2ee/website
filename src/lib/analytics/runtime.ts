import type { CaptureResult, PostHog } from 'posthog-js';
import { ANALYTICS_COOKIE, CONSENT_COOKIE, PROJECT_KEY, hasConsent, privacySignal } from './contract.mjs';

type PrivacyNavigator = Navigator & { globalPrivacyControl?: boolean };
type AnalyticsPolicy = {
  hostname: string;
  properties: () => Record<string, unknown>;
  sanitize: (event: CaptureResult, allowed: boolean) => CaptureResult | null;
};

export function createAnalyticsRuntime(policy: AnalyticsPolicy) {
  // Excluded hosts must not read, clear, or replace shared production state.
  if (location.origin !== `https://${policy.hostname}`) return;
  const nav = navigator as PrivacyNavigator;
  let notify = () => {};
  let sdk: PostHog | undefined;
  let loading: Promise<void> | undefined;
  let generation = 0;
  let active = false;
  let stopSessionCleanup: (() => void) | undefined;

  function clearState() {
    for (const name of [ANALYTICS_COOKIE, `${ANALYTICS_COOKIE}_cpm`, `__ph_opt_in_out_${PROJECT_KEY}`]) {
      for (const domain of ['', '; Domain=.open-e2ee.dev', `; Domain=${location.hostname}`]) {
        document.cookie = `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax${domain}`;
      }
      for (const kind of ['localStorage', 'sessionStorage'] as const) {
        try {
          const storage = window[kind];
          for (const key of Object.keys(storage)) if (key.includes(PROJECT_KEY)) storage.removeItem(key);
        } catch {}
      }
    }
  }

  function clearUrlCache() {
    // The SDK can cache entry URLs before before_send. Its public removal APIs
    // clear that cache before transport and after initialization.
    sdk?.unregister('$client_session_props');
    sdk?.unregister('$initial_person_info');
    sdk?.unregister('ph_keyword');
    sdk?.unregister_for_session('ph_keyword');
  }

  function allowed() { return hasConsent(document, nav); }

  function stop() {
    generation++;
    active = false;
    stopSessionCleanup?.();
    stopSessionCleanup = undefined;
    if (sdk) {
      sdk.set_config({ disable_persistence: true });
      sdk.opt_out_capturing();
    }
    clearState();
  }

  async function start() {
    if (!allowed() || active) return;
    if (sdk) {
      if (!document.cookie.includes(`${ANALYTICS_COOKIE}=`)) sdk.reset(true);
      sdk.set_config({ disable_persistence: false });
      sdk.opt_in_capturing({ captureEventName: false });
      stopSessionCleanup = sdk.onSessionId(clearUrlCache);
      active = true;
      capture('$pageview');
      return;
    }
    if (loading) return loading;
    const current = generation;
    let failed = false;
    loading = (async () => {
      const { default: posthog } = await import('posthog-js/no-external');
      if (!allowed() || current !== generation) return;
      sdk = posthog;
      active = true;
      posthog.init(PROJECT_KEY, {
        api_host: 'https://us.i.posthog.com', ui_host: 'https://us.posthog.com',
        persistence: 'localStorage+cookie', cookieWinsOnConflict: true, cookie_persisted_properties: ['internal'], cross_subdomain_cookie: true, secure_cookie: true, cookie_expiration: 180,
        opt_out_capturing_persistence_type: 'cookie',
        person_profiles: 'identified_only', autocapture: false, rageclick: false, capture_pageview: false, capture_pageleave: false,
        disable_session_recording: true, capture_heatmaps: false, disable_surveys: true, disable_surveys_automatic_display: true, capture_exceptions: false,
        disable_conversations: true, disable_product_tours: true, disable_web_experiments: true,
        opt_in_site_apps: false, enable_recording_console_log: false, disableDeviceModel: true,
        capture_performance: false, capture_dead_clicks: false, capture_webmcp: false,
        advanced_disable_flags: true, advanced_disable_feature_flags: true,
        disable_external_dependency_loading: true, request_batching: false, disable_compression: true,
        save_referrer: false, save_campaign_params: false, store_google: false, custom_campaign_params: [],
        mask_personal_data_properties: true, disable_capture_url_hashes: true,
        opt_out_useragent_filter: true, respect_dnt: true, debug: false,
        before_send: (event) => {
          clearUrlCache();
          return policy.sanitize(event, allowed());
        },
        loaded: () => { clearUrlCache(); capture('$pageview'); },
      });
      stopSessionCleanup = posthog.onSessionId(clearUrlCache);
      clearUrlCache();
    })().catch(() => { failed = true; stop(); }).finally(() => {
      loading = undefined;
      if (!failed && current !== generation && allowed() && !active) void start();
    });
    return loading;
  }

  function capture(name: string, extra = {}) {
    if (!allowed()) { if (sdk) stop(); return; }
    if (sdk && !document.cookie.includes(`${ANALYTICS_COOKIE}=`)) sdk.reset(true);
    sdk?.capture(name, { ...policy.properties(), ...extra });
  }

  function choice(accepted: boolean) {
    document.cookie = `${CONSENT_COOKIE}=v1.${accepted && !privacySignal(nav) ? 'accepted' : 'rejected'}; Domain=.open-e2ee.dev; Path=/; Secure; SameSite=Lax; Max-Age=15552000`;
    if (allowed()) void start(); else stop();
    notify();
  }

  function synchronize() {
    if (!allowed() && (sdk || privacySignal(nav) || document.cookie.includes(`${CONSENT_COOKIE}=v1.rejected`) || document.cookie.includes(ANALYTICS_COOKIE))) stop();
    else if (allowed() && !active) void start();
    else if (allowed() && sdk && !document.cookie.includes(`${ANALYTICS_COOKIE}=`)) sdk.reset(true);
    notify();
  }
  return {
    allowed,
    capture,
    choose: choice,
    blocked: () => privacySignal(nav),
    hasChoice: () => /(?:^|;\s*)oe_analytics_consent=v1\.(accepted|rejected)(?:;|$)/.test(document.cookie),
    mount(onChange: () => void) {
      notify = onChange;
      window.addEventListener('focus', synchronize);
      window.addEventListener('pageshow', synchronize);
      document.addEventListener('visibilitychange', synchronize);
      if (privacySignal(nav) || document.cookie.includes(`${CONSENT_COOKIE}=v1.rejected`) || document.cookie.includes(ANALYTICS_COOKIE)) {
        if (!allowed()) stop();
      }
      notify();
      void start();
    },
  };
}
