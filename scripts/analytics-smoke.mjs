import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { Cdp, launchChrome, productionHeaders, serve } from './chrome-harness.mjs';
import { ANALYTICS_COOKIE, CONSENT_COOKIE, PROJECT_KEY } from '../src/lib/analytics/contract.mjs';

const { server, origin } = await serve(new URL('../dist', import.meta.url).pathname, productionHeaders());
const chrome = await launchChrome('oe-analytics-');
let cdp;
try {
  const version = await (await fetch(`http://127.0.0.1:${chrome.port}/json/version`)).json();
  cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  const errors = [];
  const external = [];
  const events = [];
  const requests = [];
  cdp.on((message) => {
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params;
      const sessionId = message.sessionId;
      requests.push(request.url);
      void (async () => {
        const url = new URL(request.url);
        let response;
        if (['https://open-e2ee.dev', 'https://stage.open-e2ee.dev', origin].includes(url.origin)) {
          if (url.pathname === '/e') response = new Response(null, { status: 204 });
          else response = await fetch(`${origin}${url.pathname}${url.search}`);
        } else {
          external.push(request);
          assert.equal(url.origin, 'https://us.i.posthog.com', `unexpected external request ${request.url}`);
          assert.equal(url.pathname, '/e/', `unexpected PostHog endpoint ${request.url}`);
          if (request.method !== 'OPTIONS') {
            assert.ok(request.postData, 'PostHog event body must be inspectable');
            const parsed = JSON.parse(request.postData);
            events.push(...(Array.isArray(parsed) ? parsed : parsed.batch ?? [parsed]));
          }
          response = new Response('{}', { headers: { 'access-control-allow-origin': 'https://open-e2ee.dev', 'access-control-allow-headers': '*', 'content-type': 'application/json' } });
        }
        await cdp.send('Fetch.fulfillRequest', { requestId, responseCode: response.status, responseHeaders: [...response.headers].map(([name, value]) => ({ name, value })), body: Buffer.from(await response.arrayBuffer()).toString('base64') }, sessionId);
      })().catch((error) => { errors.push(error); void cdp.send('Fetch.failRequest', { requestId, errorReason: 'Failed' }, sessionId); });
    }
  });
  async function page(signal) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('click', event => { if (event.target.closest?.('a')) event.preventDefault(); }, true);` }, sessionId);
    if (signal) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator, ${JSON.stringify(signal)}, {get:()=>${signal === 'doNotTrack' ? "'1'" : 'true'}});` }, sessionId);
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const wait = async (expression) => {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (errors.length) throw errors[0];
        if (await evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${expression}`);
    };
    const navigate = async (path, base = 'https://open-e2ee.dev') => {
      await cdp.send('Page.navigate', { url: `${base}${path}` }, sessionId);
      await wait(`location.href === ${JSON.stringify(`${base}${path}`)} && document.readyState === 'complete' && !!document.querySelector('[data-analytics-accept]')`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    };
    return { browserContextId, sessionId, evaluate, wait, navigate };
  }
  const current = await page();
  await current.navigate('/?email=secret%40example.com&utm_source=reddit&utm_campaign=secret#secret-key');
  assert.equal(external.length, 0, 'no PostHog requests before consent');
  assert.equal(requests.some((url) => url.includes('module.no-external')), false, 'no SDK download before consent');
  assert.equal(await current.evaluate(`document.cookie.includes('${CONSENT_COOKIE}')`), false);
  assert.equal(await current.evaluate(`Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(k=>k.includes('${PROJECT_KEY}'))`), false);
  assert.equal(await current.evaluate(`document.querySelector('[data-analytics-panel]').hidden`), false);
  if (process.env.ANALYTICS_SCREENSHOT) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, current.sessionId);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' }, current.sessionId);
    writeFileSync(process.env.ANALYTICS_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  await current.evaluate(`document.querySelector('[data-analytics-accept]').click()`);
  await current.wait(`document.cookie.includes('${ANALYTICS_COOKIE}')`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (errors.length) throw errors[0];
  assert.equal(events.length, 1, 'one explicit pageview after consent');
  const firstId = events[0].properties.distinct_id;
  assert.equal(events[0].event, '$pageview');
  assert.equal(events[0].properties.page_path, '/');
  assert.equal(events[0].properties.utm_source, 'reddit');
  assert.equal(events[0].properties.utm_campaign, undefined);
  assert.equal(JSON.stringify(events).includes('secret'), false);
  assert.equal(await current.evaluate(`decodeURIComponent(document.cookie).includes('secret') || Object.values(localStorage).concat(Object.values(sessionStorage)).some(value => value.includes('secret'))`), false, 'raw entry URLs do not remain in analytics storage');
  const allowedKeys = new Set(['internal', '$geoip_disable', '$host', '$pathname', '$current_url', '$referring_domain', '$referrer', '$session_id', '$window_id', 'surface', 'page_path', 'referrer_host', 'utm_source', 'utm_medium', 'utm_campaign', 'cta', 'runtime', 'distinct_id', '$device_id', '$process_person_profile', '$lib', '$lib_version', 'token']);
  for (const event of events) for (const key of Object.keys(event.properties)) assert.ok(allowedKeys.has(key), `unapproved property ${key}`);
  await current.evaluate(`document.querySelector('a[href*="github.com/open-e2ee"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(events.at(-1).event, 'website_cta');
  assert.equal(events.at(-1).properties.cta, 'github_open');
  await current.navigate('/pricing/?token=secret');
  assert.equal(events.at(-1).properties.page_path, '/pricing');
  assert.equal(events.at(-1).properties.distinct_id, firstId, 'anonymous identity persists across regular navigation');
  await current.evaluate(`document.querySelector('a[href="https://calendar.app.google/ZpFdxaL9HZh9J7x97"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(events.at(-1).properties.cta, 'enterprise_contact', 'the existing meeting CTA emits its bounded action');
  // Simulate SDK cookie changes from a signed-in sibling, without identifying on the website.
  const sharedCookie = JSON.parse(await current.evaluate(`decodeURIComponent(document.cookie.split('; ').find(value => value.startsWith('${ANALYTICS_COOKIE}=' )).split('=').slice(1).join('='))`));
  for (const [account, internal] of [[`oea_${'a'.repeat(64)}`, true], [`oea_${'b'.repeat(64)}`, false]]) {
    const next = { ...sharedCookie, distinct_id: account, $user_state: 'identified', internal };
    await cdp.send('Storage.setCookies', { browserContextId: current.browserContextId, cookies: [{ name: ANALYTICS_COOKIE, value: encodeURIComponent(JSON.stringify(next)), domain: '.open-e2ee.dev', path: '/', secure: true, sameSite: 'Lax' }] });
    await current.evaluate(`window.dispatchEvent(new Event('focus'));document.querySelector('a[href*="github.com/open-e2ee"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(events.at(-1).properties.distinct_id, account, 'existing tab adopts sibling account identity');
    assert.equal(events.at(-1).properties.internal, internal ? true : undefined, 'server internal mark follows the current sibling identity');
  }
  const anonymousAfterSignout = '019a4321-5678-7000-8000-123456789abc';
  await cdp.send('Storage.setCookies', { browserContextId: current.browserContextId, cookies: [{ name: ANALYTICS_COOKIE, value: encodeURIComponent(JSON.stringify({ ...sharedCookie, distinct_id: anonymousAfterSignout, $device_id: anonymousAfterSignout, $user_state: 'anonymous' })), domain: '.open-e2ee.dev', path: '/', secure: true, sameSite: 'Lax' }] });
  await current.evaluate(`window.dispatchEvent(new Event('focus'));document.querySelector('a[href*="github.com/open-e2ee"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(events.at(-1).properties.distinct_id, anonymousAfterSignout, 'existing tab adopts sibling anonymous reset');
  assert.equal(events.at(-1).properties.internal, undefined, 'sibling reset removes stale internal mark');
  await cdp.send('Storage.setCookies', { browserContextId: current.browserContextId, cookies: [{ name: ANALYTICS_COOKIE, value: '', expires: 1, domain: '.open-e2ee.dev', path: '/', secure: true }] });
  await current.evaluate(`window.dispatchEvent(new Event('focus'));document.querySelector('a[href*="github.com/open-e2ee"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.notEqual(events.at(-1).properties.distinct_id, anonymousAfterSignout, 'deleted sibling identity cannot resurrect');
  assert.match(events.at(-1).properties.distinct_id, /^[0-9a-f-]{36}$/);
  await cdp.send('Storage.setCookies', { browserContextId: current.browserContextId, cookies: [
    { name: CONSENT_COOKIE, value: 'v1.rejected', domain: '.open-e2ee.dev', path: '/', secure: true, sameSite: 'Lax' },
    { name: ANALYTICS_COOKIE, value: '', expires: 1, domain: '.open-e2ee.dev', path: '/', secure: true },
  ] });
  const beforeSignout = events.length;
  await current.evaluate(`window.dispatchEvent(new Event('focus'));document.querySelector('a[href*="github.com/open-e2ee"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(events.length, beforeSignout, 'Console signout stops optional collection in an existing sibling tab');
  assert.equal(await current.evaluate(`Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(k=>k.includes('${PROJECT_KEY}'))`), false);
  await current.evaluate(`document.querySelector('[data-analytics-preferences]').click();document.querySelector('[data-analytics-accept]').click()`);
  await current.wait(`document.cookie.includes('${ANALYTICS_COOKIE}')`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.match(events.at(-1).properties.distinct_id, /^[0-9a-f-]{36}$/, 'reacceptance after signout starts anonymous');
  await current.evaluate(`document.querySelector('[data-analytics-preferences]').click();document.querySelector('[data-analytics-reject]').click()`);
  await current.wait(`!document.cookie.includes('${ANALYTICS_COOKIE}')`);
  const countAfterReject = events.length;
  await current.evaluate(`document.querySelector('a[href*="github.com/open-e2ee"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));`);
  await current.navigate('/security/');
  assert.equal(events.length, countAfterReject, 'no collection after withdrawal or on subsequent navigation');
  assert.equal(await current.evaluate(`Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(k=>k.includes('${PROJECT_KEY}'))`), false, 'analytics persistent state cleared');
  assert.equal(await current.evaluate(`document.cookie.split(';').some(part => part.includes('${PROJECT_KEY}'))`), false, 'all analytics cookies including metadata are cleared');
  const cookies = (await cdp.send('Storage.getCookies', { browserContextId: current.browserContextId })).cookies;
  const consent = cookies.find(({ name }) => name === CONSENT_COOKIE);
  assert.equal(consent.value, 'v1.rejected');
  assert.equal(consent.domain, '.open-e2ee.dev');
  assert.equal(consent.secure, true);
  assert.equal(consent.sameSite, 'Lax');
  assert.ok(consent.expires - Date.now() / 1000 > 15551000);
  const rejectPage = await page();
  await rejectPage.navigate('/');
  await rejectPage.evaluate(`document.querySelector('[data-analytics-reject]').click()`);
  await rejectPage.navigate('/pricing/');
  assert.equal(events.length, countAfterReject, 'initial rejection sends no optional events');
  assert.equal(await rejectPage.evaluate(`document.cookie.includes('${ANALYTICS_COOKIE}')`), false);
  // A sibling app changes the shared cookie while this page stays open.
  await current.evaluate(`document.querySelector('[data-analytics-preferences]').click();document.querySelector('[data-analytics-accept]').click()`);
  await current.wait(`document.cookie.includes('${ANALYTICS_COOKIE}')`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.notEqual(events.at(-1).properties.distinct_id, firstId, 'reacceptance starts a new anonymous identity');
  await cdp.send('Storage.setCookies', { browserContextId: current.browserContextId, cookies: [{ name: CONSENT_COOKIE, value: 'v1.rejected', domain: '.open-e2ee.dev', path: '/', secure: true, sameSite: 'Lax' }] });
  const beforeSiblingReject = events.length;
  await current.evaluate(`window.dispatchEvent(new Event('focus'));document.querySelector('a[href*="github.com/open-e2ee"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(events.length, beforeSiblingReject, 'sibling withdrawal blocks new events');
  assert.equal(await current.evaluate(`document.cookie.includes('${ANALYTICS_COOKIE}')`), false);
  const afterAllActions = events.length;
  for (const signal of ['doNotTrack', 'globalPrivacyControl']) {
    const protectedPage = await page(signal);
    await cdp.send('Storage.setCookies', { browserContextId: protectedPage.browserContextId, cookies: [
      { name: CONSENT_COOKIE, value: 'v1.accepted', domain: '.open-e2ee.dev', path: '/', secure: true, sameSite: 'Lax' },
      { name: ANALYTICS_COOKIE, value: 'old', domain: '.open-e2ee.dev', path: '/', secure: true, sameSite: 'Lax' },
    ] });
    await protectedPage.navigate('/');
    assert.equal(events.length, afterAllActions, `${signal} overrides accepted consent`);
    assert.equal(await protectedPage.evaluate(`document.cookie.includes('${ANALYTICS_COOKIE}')`), false, `${signal} clears analytics cookie`);
    await protectedPage.evaluate(`document.querySelector('[data-analytics-preferences]').click()`);
    assert.equal(await protectedPage.evaluate(`document.querySelector('[data-analytics-accept]').disabled`), true);
  }
  for (const base of ['https://stage.open-e2ee.dev', origin]) {
    const excluded = await page();
    await cdp.send('Storage.setCookies', { browserContextId: excluded.browserContextId, cookies: [
      { name: CONSENT_COOKIE, value: 'v1.accepted', domain: '.open-e2ee.dev', path: '/', secure: true, sameSite: 'Lax' },
      { name: ANALYTICS_COOKIE, value: 'preserve-production-state', domain: '.open-e2ee.dev', path: '/', secure: true, sameSite: 'Lax' },
    ] });
    const requestsBefore = requests.length;
    await excluded.navigate('/', base);
    assert.equal(events.length, afterAllActions, 'local and stage pages send no optional events');
    assert.equal(requests.slice(requestsBefore).some(url => url.includes('module.no-external')), false, 'local and stage do not load SDK');
    assert.equal(await excluded.evaluate(`document.querySelector('[data-analytics-panel]').hidden`), true);
    const kept = (await cdp.send('Storage.getCookies', { browserContextId: excluded.browserContextId })).cookies.find(({ name }) => name === ANALYTICS_COOKIE);
    assert.equal(kept.value, 'preserve-production-state', 'excluded hosts preserve production analytics state');
  }
  if (errors.length) throw errors[0];
  console.log('Analytics browser smoke passed: no SDK or PostHog traffic before consent; bounded pageviews and CTA; stable anonymous ID across navigation; withdrawal clears state; DNT and GPC override acceptance. All network requests intercepted; no live analytics sent.');
} finally {
  cdp?.socket.close();
  chrome.child.kill('SIGTERM');
  server.close();
  await new Promise(resolve => chrome.child.exitCode !== null ? resolve() : chrome.child.once('exit', resolve));
  rmSync(chrome.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
