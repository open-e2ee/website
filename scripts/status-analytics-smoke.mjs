import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { Cdp, launchChrome } from './chrome-harness.mjs';
import { ANALYTICS_COOKIE, CONSENT_COOKIE, PROJECT_KEY } from '../src/lib/analytics/contract.mjs';

const ASSET = 'https://open-e2ee.dev/analytics/status-v1.js';
const nativeContent = '<main id="provider-status">secret-incident-title</main><form id="subscriber"><input name="email" value="secret@example.com"><button type="button" id="provider-control">Get updates</button></form>';
const fixture = (canonical) => `<!doctype html><html><head><title>secret-incident-title</title><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${nativeContent}<script type="module" async src="${canonical ? ASSET : '/fixture/status-v1.js'}" referrerpolicy="no-referrer"></script></body></html>`;
const headerSource = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
function assetHeaders(path) {
  let selected = false;
  const headers = { 'content-type': 'text/javascript' };
  for (const line of headerSource.split('\n')) {
    if (/^\S/.test(line)) selected = line === path || (line.endsWith('*') && path.startsWith(line.slice(0, -1)));
    else if (selected) { const match = /^\s+([^:]+):\s*(.+)$/.exec(line); if (match) headers[match[1]] = match[2]; }
  }
  return headers;
}
const chrome = await launchChrome('oe-status-analytics-');
const closed = once(chrome.child, 'close');
let cdp;
let originalError;
try {
  const version = await (await fetch(`http://127.0.0.1:${chrome.port}/json/version`)).json();
  cdp = await Cdp.connect(version.webSocketDebuggerUrl);
  const events = [];
  const requests = [];
  const errors = [];
  const failedAssets = new Map();
  cdp.on((message) => {
    if (message.method !== 'Fetch.requestPaused') return;
    void (async () => {
      const { requestId, request } = message.params;
      const sessionId = message.sessionId;
      requests.push(request.url);
      const url = new URL(request.url);
      let body;
      let headers = {};
      let code = 200;
      if (url.origin === 'https://us.i.posthog.com') {
        assert.equal(url.pathname, '/e/');
        if (request.method !== 'OPTIONS') {
          assert.ok(request.postData);
          const parsed = JSON.parse(request.postData);
          events.push(...(Array.isArray(parsed) ? parsed : parsed.batch ?? [parsed]));
        }
        body = '{}';
        headers = { 'access-control-allow-origin': 'https://status.open-e2ee.dev', 'access-control-allow-headers': '*' };
      } else if (url.origin === 'https://open-e2ee.dev' || url.pathname === '/fixture/status-v1.js') {
        const path = url.pathname === '/fixture/status-v1.js' ? '/analytics/status-v1.js' : url.pathname;
        assert.ok(path.startsWith('/analytics/'), `unapproved asset request ${request.url}`);
        if (failedAssets.get(sessionId) === 'hang') return;
        if (failedAssets.has(sessionId) && (failedAssets.get(sessionId) === 'all' || !path.endsWith('/status-v1.js'))) { code = 503; body = ''; }
        else body = await readFile(new URL(`../dist${path}`, import.meta.url));
        headers = assetHeaders(path);
        assert.equal(headers['Access-Control-Allow-Origin'], 'https://status.open-e2ee.dev');
        if (path.endsWith('status-v1.js')) assert.equal(headers['Cache-Control'], 'public, max-age=300, must-revalidate');
        else assert.equal(headers['Cache-Control'], 'public, max-age=31536000, immutable');
      } else {
        assert.ok(['status.open-e2ee.dev', 'open-e2ee.betteruptime.com', 'stage.status.open-e2ee.dev', '127.0.0.1'].includes(url.hostname), `unapproved request ${request.url}`);
        body = fixture(url.origin === 'https://status.open-e2ee.dev');
        headers = { 'content-type': 'text/html', 'Content-Security-Policy': "default-src 'self'; script-src 'self' https://open-e2ee.dev; style-src 'unsafe-inline'; connect-src https://us.i.posthog.com" };
      }
      await cdp.send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: Object.entries(headers).map(([name, value]) => ({ name, value })), body: Buffer.from(body).toString('base64') }, sessionId);
    })().catch((error) => { errors.push(error); void cdp.send('Fetch.failRequest', { requestId: message.params.requestId, errorReason: 'Failed' }, message.sessionId).catch(() => {}); });
  });
  async function page({ signal, excluded, failure } = {}) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext');
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded',()=>{window.providerReady=true;document.querySelector('#provider-control')?.addEventListener('click',()=>window.providerOpened=true);});` }, sessionId);
    const seed = excluded || signal ? `localStorage.setItem('${ANALYTICS_COOKIE}','preserve');sessionStorage.setItem('${ANALYTICS_COOKIE}','preserve');` : '';
    if (seed || signal) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: seed + (signal ? `Object.defineProperty(navigator,'${signal}',{get:()=>${signal === 'doNotTrack' ? "'1'" : 'true'}});` : '') }, sessionId);
    if (failure) failedAssets.set(sessionId, failure);
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
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${expression}`);
    };
    const navigate = async (url) => {
      await cdp.send('Page.navigate', { url }, sessionId);
      await wait(`location.href === ${JSON.stringify(url)} && window.providerReady === true`);
      await new Promise(resolve => setTimeout(resolve, 200));
    };
    const shadow = `document.querySelector('#oe-status-analytics')?.shadowRoot`;
    return { browserContextId, sessionId, evaluate, wait, navigate, shadow };
  }
  const p = await page();
  await p.navigate('https://status.open-e2ee.dev/incident/raw-private-482?email=secret@example.com#secret');
  await p.wait(`${p.shadow}?.querySelector('#accept')`);
  assert.equal(events.length, 0);
  assert.equal(requests.some(url => url.includes('module.no-external')), false, 'SDK not downloaded before consent');
  assert.equal(await p.evaluate(`document.cookie.includes('${CONSENT_COOKIE}') || Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(key=>key.includes('${PROJECT_KEY}'))`), false);
  if (process.env.STATUS_ANALYTICS_SCREENSHOT) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, p.sessionId);
    const clip = await p.evaluate(`(()=>{const r=${p.shadow}.querySelector('section').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1};})()`);
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', clip }, p.sessionId);
    await writeFile(process.env.STATUS_ANALYTICS_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
  }
  await p.evaluate(`${p.shadow}.querySelector('#accept').click()`);
  await p.wait(`document.cookie.includes('${ANALYTICS_COOKIE}')`);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(events.length, 1);
  assert.equal(events[0].properties.page_path, '/incident/:incident');
  const identity = events[0].properties.distinct_id;
  const session = events[0].properties.$session_id;
  const sdkRequests = requests.filter(url => url.includes('module.no-external'));
  assert.equal(sdkRequests.length, 1);
  assert.ok(sdkRequests[0].startsWith('https://open-e2ee.dev/analytics/status-v1/'));
  assert.equal(await p.evaluate(`Object.values(localStorage).concat(Object.values(sessionStorage)).join('').includes('raw-private-482')`), false);
  await p.evaluate(`document.querySelector('#provider-control').addEventListener('click',()=>document.querySelector('#subscriber').dataset.open='yes');document.querySelector('#provider-control').click()`);
  assert.equal(await p.evaluate(`document.querySelector('#subscriber').dataset.open`), 'yes');
  assert.equal(await p.evaluate(`document.querySelector('input').value`), 'secret@example.com');
  for (const [path, bucket] of [['/incidents', '/incidents'], ['/incident/raw-next-591', '/incident/:incident']]) {
    const before = events.length;
    await p.evaluate(`history.pushState({},'',${JSON.stringify(path)});document.body.innerHTML=${JSON.stringify(nativeContent)};document.dispatchEvent(new Event('turbo:load'));document.dispatchEvent(new Event('turbo:load'));`);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(events.length, before + 1, 'one pageview per Turbo route transition');
    await p.evaluate(`history.replaceState({},'',${JSON.stringify(path + '/?ignored=secret#ignored')});document.dispatchEvent(new Event('turbo:load'));`);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(events.length, before + 1, 'trailing slash, query, and hash do not duplicate the normalized route');
    assert.equal(events.at(-1).properties.page_path, bucket);
    assert.equal(events.at(-1).properties.distinct_id, identity);
    assert.equal(events.at(-1).properties.$session_id, session);
    assert.equal(await p.evaluate(`document.querySelectorAll('#oe-status-analytics').length`), 1);
    assert.equal(await p.evaluate(`document.querySelector('input').value`), 'secret@example.com');
  }
  await p.evaluate(`window.cachedStatusBody=document.body.cloneNode(true);history.pushState({},'','/maintenance');document.body.innerHTML=${JSON.stringify(nativeContent)};document.dispatchEvent(new Event('turbo:load'));`);
  await new Promise(resolve => setTimeout(resolve, 150));
  const beforeRestore = events.length;
  await p.evaluate(`history.pushState({},'','/incident/raw-restored-591');document.body.replaceWith(window.cachedStatusBody.cloneNode(true));`);
  assert.equal(await p.evaluate(`!!document.querySelector('#oe-status-analytics').shadowRoot`), false, 'Turbo snapshot loses ShadowRoot');
  await p.evaluate(`document.dispatchEvent(new Event('turbo:load'));document.dispatchEvent(new Event('turbo:load'));`);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(events.length, beforeRestore + 1, 'one pageview on cached history restoration');
  assert.equal(events.at(-1).properties.distinct_id, identity);
  assert.equal(events.at(-1).properties.$session_id, session);
  assert.equal(await p.evaluate(`document.querySelectorAll('#oe-status-analytics').length`), 1);
  await p.evaluate(`${p.shadow}.querySelector('#preferences').click()`);
  assert.equal(await p.evaluate(`${p.shadow}.querySelector('section').hidden`), false, 'restored reopen control works');
  await p.evaluate(`${p.shadow}.querySelector('#reject').click()`);
  assert.equal(await p.evaluate(`document.cookie.includes('${ANALYTICS_COOKIE}')`), false, 'restored withdrawal control clears identity');
  await p.evaluate(`${p.shadow}.querySelector('#preferences').click();${p.shadow}.querySelector('#accept').click()`);
  await p.wait(`document.cookie.includes('${ANALYTICS_COOKIE}')`);
  await new Promise(resolve => setTimeout(resolve, 150));
  const shared = JSON.parse(await p.evaluate(`decodeURIComponent(document.cookie.split('; ').find(part=>part.startsWith('${ANALYTICS_COOKIE}=' )).split('=').slice(1).join('='))`));
  const account = `oea_${'a'.repeat(64)}`;
  await cdp.send('Storage.setCookies', { browserContextId: p.browserContextId, cookies: [{ name: ANALYTICS_COOKIE, value: encodeURIComponent(JSON.stringify({ ...shared, distinct_id: account, $user_state: 'identified', internal: true })), domain: '.open-e2ee.dev', path: '/', secure: true }] });
  await p.evaluate(`history.pushState({},'','/maintenance');document.dispatchEvent(new Event('turbo:load'));`);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(events.at(-1).properties.distinct_id, account, 'status adopts the shared account identity');
  assert.equal(events.at(-1).properties.internal, true);
  const beforeInput = events.length;
  await p.evaluate(`document.querySelector('input').value='subscriber-edited-secret@example.com';document.querySelector('input').dispatchEvent(new Event('input',{bubbles:true}));`);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(events.length, beforeInput, 'subscriber input produces no event');
  assert.equal(await p.evaluate(`document.querySelector('input').value`), 'subscriber-edited-secret@example.com');
  await p.evaluate(`${p.shadow}.querySelector('#preferences').click();${p.shadow}.querySelector('#reject').click()`);
  const count = events.length;
  await p.evaluate(`history.pushState({},'','/incidents');document.dispatchEvent(new Event('turbo:load'));window.dispatchEvent(new Event('focus'));`);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(events.length, count);
  assert.equal(await p.evaluate(`document.cookie.includes('${PROJECT_KEY}') || Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(key=>key.includes('${PROJECT_KEY}'))`), false);
  for (const signal of ['doNotTrack', 'globalPrivacyControl']) {
    const protectedPage = await page({ signal });
    await cdp.send('Storage.setCookies', { browserContextId: protectedPage.browserContextId, cookies: [{ name: CONSENT_COOKIE, value: 'v1.accepted', domain: '.open-e2ee.dev', path: '/', secure: true }, { name: ANALYTICS_COOKIE, value: 'old', domain: '.open-e2ee.dev', path: '/', secure: true }] });
    await protectedPage.navigate('https://status.open-e2ee.dev/');
    assert.equal(events.length, count);
    assert.equal(await protectedPage.evaluate(`document.cookie.includes('${PROJECT_KEY}') || Object.keys(localStorage).concat(Object.keys(sessionStorage)).some(key=>key.includes('${PROJECT_KEY}'))`), false);
    assert.equal(await protectedPage.evaluate(`${protectedPage.shadow}.querySelector('#accept').disabled`), true);
  }
  for (const origin of ['https://open-e2ee.betteruptime.com', 'https://stage.status.open-e2ee.dev', 'https://status.open-e2ee.dev:8443', 'http://127.0.0.1']) {
    const excluded = await page({ excluded: true });
    await excluded.navigate(`${origin}/`);
    assert.equal(await excluded.evaluate(`localStorage.getItem('${ANALYTICS_COOKIE}')`), 'preserve');
    assert.equal(await excluded.evaluate(`!!document.querySelector('#oe-status-analytics')`), false);
    assert.equal(events.length, count);
  }
  for (const mode of ['all', 'sdk', 'hang']) {
    const failure = await page({ failure: mode });
    await cdp.send('Storage.setCookies', { browserContextId: failure.browserContextId, cookies: [{ name: CONSENT_COOKIE, value: 'v1.accepted', domain: '.open-e2ee.dev', path: '/', secure: true }] });
    await failure.navigate('https://status.open-e2ee.dev/');
    assert.equal(await failure.evaluate(`document.querySelector('#provider-status').textContent`), 'secret-incident-title');
    assert.equal(await failure.evaluate(`document.querySelector('input').value`), 'secret@example.com');
    await failure.evaluate(`document.querySelector('#provider-control').click()`);
    assert.equal(await failure.evaluate(`window.providerOpened`), true, 'provider initialization works while optional entry remains pending');
    assert.equal(events.length, count);
  }
  const allowed = new Set(['surface','page_path','$host','$pathname','$current_url','referrer_host','$referring_domain','$referrer','utm_source','utm_medium','utm_campaign','distinct_id','$device_id','$session_id','$window_id','internal','$process_person_profile','$geoip_disable','$lib','$lib_version','token']);
  for (const event of events) {
    assert.equal(event.event, '$pageview');
    assert.equal(event.properties.surface, 'status');
    assert.equal(event.properties.$host, 'status.open-e2ee.dev');
    for (const key of Object.keys(event.properties)) assert.ok(allowed.has(key), `unapproved status field ${key}`);
    assert.doesNotMatch(JSON.stringify(event), /secret|raw-private|raw-next|raw-restored|subscriber/);
  }
  if (errors.length) throw errors[0];
  console.log('Status analytics smoke passed: consent and privacy gates, CORS/hash loading, bounded pageviews, two Turbo replacements, stable identity/session, no incident/subscriber data, withdrawal, excluded hosts, and asset-failure availability. All requests intercepted; no live analytics sent.');
} catch (error) {
  originalError = error;
  throw error;
} finally {
  const timer = setTimeout(() => chrome.child.kill('SIGTERM'), 10000);
  try { await cdp?.send('Browser.close'); } catch {}
  let closeDeadline;
  await Promise.race([closed, new Promise(resolve => { closeDeadline = setTimeout(resolve, 12000); })]);
  clearTimeout(closeDeadline);
  clearTimeout(timer);
  cdp?.socket.close();
  try { await rm(chrome.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
  catch (error) { if (!originalError) throw error; }
}
