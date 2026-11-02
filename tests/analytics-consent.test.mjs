import assert from 'node:assert/strict';
import test from 'node:test';
import { PROJECT_KEY, hasConsent, privacySignal, pageProperties, sanitizeEvent, classifyCta } from '../src/lib/analytics/contract.mjs';

const routes = new Set(['/', '/pricing', '/blog/tls-is-not-end-to-end-encryption']);
const anonymous = '019a4321-1234-7000-8000-123456789abc';
const event = (properties = {}, name = '$pageview') => ({ event: name, uuid: anonymous, properties: { distinct_id: anonymous, page_path: '/pricing', ...properties } });

test('acceptance requires the exact shared cookie and no browser privacy signal', () => {
  for (const cookie of ['', 'oe_analytics_consent=v1.rejected', 'oe_analytics_consent=v2.accepted', 'other_oe_analytics_consent=v1.accepted']) {
    assert.equal(hasConsent({ cookie }, {}), false);
  }
  assert.equal(hasConsent({ cookie: 'theme=dark; oe_analytics_consent=v1.accepted' }, {}), true);
  for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: '1' }, { doNotTrack: 'yes' }]) {
    assert.equal(privacySignal(nav), true);
    assert.equal(hasConsent({ cookie: 'oe_analytics_consent=v1.accepted' }, nav), false);
  }
});

test('page properties use known routes, referrer host, and fixed public campaign labels', () => {
  const properties = pageProperties({ pathname: '/pricing/', search: '?email=secret@example.com&utm_source=reddit&utm_medium=social&utm_campaign=secret' }, 'https://www.reddit.com/private/message?token=secret', routes);
  assert.deepEqual(properties, { surface: 'website', page_path: '/pricing', referrer_host: 'www.reddit.com', utm_source: 'reddit', utm_medium: 'social' });
  assert.deepEqual(pageProperties({ pathname: '/secret@example.com', search: '?utm_source=secret' }, 'not a URL', routes), { surface: 'website', page_path: '/other' });
});

test('before_send drops nonconsented and automatic events and reconstructs only the allowed fields', () => {
  assert.equal(sanitizeEvent(event(), false, routes), null);
  for (const name of ['$autocapture', '$identify', '$exception', '$snapshot', 'demo_run']) assert.equal(sanitizeEvent(event({}, name), true, routes), null);
  const output = sanitizeEvent(event({ email: 'secret@example.com', $current_url: 'https://open-e2ee.dev/?secret', $set: { email: 'secret' }, page_path: '/secret', referrer_host: 'example.org', utm_source: 'reddit', utm_content: 'secret' }), true, routes);
  assert.deepEqual(Object.keys(output).sort(), ['event', 'properties', 'uuid']);
  assert.deepEqual(output.properties, { surface: 'website', page_path: '/other', $host: 'open-e2ee.dev', $pathname: '/other', $current_url: 'https://open-e2ee.dev/other', referrer_host: 'example.org', $referring_domain: 'example.org', $referrer: 'https://example.org', utm_source: 'reddit', distinct_id: anonymous, $process_person_profile: false, $geoip_disable: true, $lib: 'web', $lib_version: '1.444.4', token: PROJECT_KEY });
  assert.equal(sanitizeEvent(event({ distinct_id: 'secret@example.com' }), true, routes), null);
  assert.equal(sanitizeEvent(event({ cta: 'secret' }, 'website_cta'), true, routes), null);
  assert.equal(sanitizeEvent({ ...event(), uuid: 'secret@example.com' }, true, routes), null);
  const session = sanitizeEvent(event({ $session_id: anonymous, $window_id: anonymous, internal: true }), true, routes);
  assert.equal(session.properties.$session_id, anonymous);
  assert.equal(session.properties.$window_id, anonymous);
  assert.equal(session.properties.internal, true);
  const account = `oea_${'a'.repeat(64)}`;
  assert.equal(sanitizeEvent(event({ distinct_id: account }), true, routes).properties.distinct_id, account);
});

test('CTA properties use selected actions without copied text, keys, paths, or link queries', () => {
  const target = (href, copy = false) => ({ closest: (selector) => selector === '[data-install-copy]' ? copy : href ? { href } : null });
  const location = { href: 'https://open-e2ee.dev/' };
  assert.deepEqual(classifyCta(target('https://console.open-e2ee.dev/signup?secret=token'), location), { cta: 'signup_start' });
  assert.deepEqual(classifyCta(target('https://docs.open-e2ee.dev/start/browser?key=secret'), location), { cta: 'runtime_select', runtime: 'browser' });
  assert.deepEqual(classifyCta(target('https://calendar.app.google/ZpFdxaL9HZh9J7x97?secret=ignored'), location), { cta: 'enterprise_contact' });
  assert.equal(classifyCta(target('https://calendar.app.google/other'), location), null);
  assert.deepEqual(classifyCta(target(null, true), location), { cta: 'install_copy' });
  assert.equal(classifyCta(target('https://evil.example/?next=console.open-e2ee.dev'), location), null);
});
