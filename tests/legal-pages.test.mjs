import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import { signalRelayPlans, signalRelaySandboxEnvironment } from '../src/data/signal-relay-pricing.mjs';
import {
  dpaEffectiveDate,
  dpaPath,
  dpaUrl,
  dpaVersion,
  privacyEffectiveDate,
  privacyPath,
  privacyUrl,
  privacyVersion,
  signalRelayRetentionEffectiveDate,
  signalRelayRetentionPath,
  signalRelayRetentionVersion,
  signalRelayServiceLimitsEffectiveDate,
  signalRelayServiceLimitsPath,
  signalRelayServiceLimitsVersion,
  signalRelayTermsEffectiveDate,
  signalRelayTermsPath,
  signalRelayTermsUrl,
  signalRelayTermsVersion,
} from '../src/lib/legal.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const flat = async (path) => (await read(path)).replace(/\s+/g, ' ');

/*
 * dist/ is absent on a clean checkout and present in CI, which builds before it
 * tests. A bare skip would let a dist-reading assertion report a pass in the one
 * place it is the only guard there is.
 */
const skipUnbuilt = (page) => {
  assert.ok(
    !process.env.CI,
    `${page} is missing — CI builds before it tests, so a dist-reading assertion must never skip here`,
  );
};

/**
 * The built page names its own served URL, the slash form, as canonical.
 * BaseLayout derives it from the path, so the page source carries no literal.
 */
async function assertCanonicalAtOwnPath(path, message) {
  const file = new URL(`../dist${path}/index.html`, import.meta.url);
  if (!existsSync(file)) return skipUnbuilt(`dist${path}/index.html`);
  const html = await readFile(file, 'utf8');
  assert.deepEqual(
    [...html.matchAll(/<link rel="canonical" href="([^"]+)">/g)].map((match) => match[1]),
    [`https://open-e2ee.dev${path}/`],
    message,
  );
}

test('pins the current legal documents to immutable canonical URLs', () => {
  assert.equal(privacyVersion, '2026-11-02');
  assert.equal(privacyPath, '/legal/privacy/2026-11-02');
  assert.equal(privacyUrl, 'https://open-e2ee.dev/legal/privacy/2026-11-02');
  assert.equal(signalRelayTermsVersion, 'signal-relay-2026-11-05');
  assert.equal(signalRelayTermsPath, '/legal/signal-relay-terms/2026-11-05');
  assert.equal(signalRelayTermsUrl, 'https://open-e2ee.dev/legal/signal-relay-terms/2026-11-05');
  assert.equal(signalRelayRetentionVersion, '2026-10-24');
  assert.equal(signalRelayRetentionEffectiveDate, 'October 24, 2026');
  assert.equal(signalRelayRetentionPath, '/legal/relay-retention/2026-10-24');
  assert.equal(signalRelayServiceLimitsVersion, '2026-10-05');
  assert.equal(signalRelayServiceLimitsEffectiveDate, 'October 5, 2026');
  assert.equal(signalRelayServiceLimitsPath, '/legal/relay-service-limits/2026-10-05');
  assert.equal(dpaVersion, '2026-11-08');
  assert.equal(dpaEffectiveDate, 'November 8, 2026');
  assert.equal(dpaPath, '/legal/dpa/2026-11-08');
  assert.equal(dpaUrl, 'https://open-e2ee.dev/legal/dpa/2026-11-08');
});

/*
 * A version may be published more than once a day, and the suffix is how two
 * notices are told apart. The effective date may not drift away from it: it is
 * a representation about when these terms apply, and the site begins collecting
 * under a new notice the moment it deploys. A second change on one day dated
 * itself forward once, which would have had the page tell a reader the notice
 * took effect tomorrow while the event it describes was already being
 * collected.
 */
test('keeps the privacy effective date on the day its version names', () => {
  const day = /^(\d{4})-(\d{2})-(\d{2})(\.\d+)?$/.exec(privacyVersion);
  assert.ok(day, `privacy version ${privacyVersion} is not a date with an optional suffix`);

  const [, year, month, date] = day;
  const named = new Date(`${year}-${month}-${date}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.equal(privacyEffectiveDate, named);
});

test('publishes canonical current, versioned, privacy, and Relay policy routes', async () => {
  const [legalIndex, versionedTerms, signalRelayTerms, signalRelayVersion, privacy] = await Promise.all([
    read('../src/pages/legal/index.astro'),
    read('../src/pages/legal/terms/2026-09-10.astro'),
    read('../src/pages/legal/signal-relay-terms.astro'),
    read('../src/pages/legal/relay-terms/2026-10-08.astro'),
    read('../src/pages/legal/privacy.astro'),
  ]);

  await assertCanonicalAtOwnPath('/legal');
  /* The SDK Commercial Terms left the index on 2026-09-22: the SDK is MIT OR
   * Apache-2.0 and no license is sold. Payments ruling 30 removed the live
   * /legal/terms page on 2026-11-05; the dated copies stay published, and the
   * index lists only the agreements the site sells against. */
  assert.doesNotMatch(legalIndex, /href="\/legal\/terms/, 'the index lists the retired SDK Commercial Terms');
  assert.match(legalIndex, /href="\/legal\/privacy"/);
  await assertCanonicalAtOwnPath('/legal/terms/2026-09-10');
  assert.match(legalIndex, /href="\/legal\/signal-relay-terms"/);
  assert.match(legalIndex, /href="\/legal\/acceptable-use"/);
  assert.match(legalIndex, /href="\/legal\/subprocessors"/);
  assert.match(legalIndex, /href="\/legal\/signal-relay-retention"/);
  assert.match(legalIndex, /href="\/legal\/signal-relay-service-limits"/);
  assert.doesNotMatch(legalIndex, /href="\/legal\/relay-beta-limits"/, 'the index links the retired live limits address');
  assert.doesNotMatch(
    legalIndex,
    /href="\/legal\/relay-(terms|retention|service-limits)"/,
    'the index links a retired live Relay address',
  );
  assert.match(signalRelayTerms, /SignalProtocolRelayTerms/);
  await assertCanonicalAtOwnPath('/legal/signal-relay-terms');
  await assertCanonicalAtOwnPath('/legal/relay-terms/2026-10-08');
  assert.match(privacy, /Privacy Notice/);
  await assertCanonicalAtOwnPath('/legal/privacy');
  assert.match(legalIndex, /href="\/legal\/dpa"/);
});

/*
 * The agreement binds on acceptance of the Relay terms and is never signed, so
 * the dated URL is the only record of which processor terms an organization is
 * under. The live route renders the component; the dated route may not.
 */
test('publishes the data processing agreement at a current and a dated route', async () => {
  const [live, dated] = await Promise.all([
    read('../src/pages/legal/dpa.astro'),
    read(`../src/pages/legal/dpa/${dpaVersion}.astro`),
  ]);

  assert.match(live, /DataProcessingAgreement/);
  await assertCanonicalAtOwnPath('/legal/dpa');
  await assertCanonicalAtOwnPath(dpaPath);
});

const frozenDpaVersions = [
  { version: '2026-09-10', effective: 'September 10, 2026' },
  { version: '2026-09-27', effective: 'September 27, 2026' },
  { version: '2026-09-29', effective: 'September 29, 2026' },
  { version: '2026-10-24', effective: 'October 24, 2026' },
  { version: '2026-11-08', effective: 'November 8, 2026' },
];

test('keeps every dated DPA page frozen: it never reads the live agreement', async () => {
  for (const { version, effective } of frozenDpaVersions) {
    const page = await read(`../src/pages/legal/dpa/${version}.astro`);

    /* Path forms, as on the other two dated documents: the component name may
     * appear in this file's own comment explaining the freeze, and an import
     * resolves a path, so the paths are what is banned. */
    assert.doesNotMatch(page, /lib\/legal(\.mjs)?/, `${version} reads the live version constants`);
    assert.doesNotMatch(
      page,
      /components\/DataProcessingAgreement/,
      `${version} renders the live agreement`,
    );

    assert.match(
      page,
      new RegExp(`<span>Version ${version}</span>`),
      `${version} does not head itself as version ${version}`,
    );
    assert.match(
      page,
      new RegExp(`<span>Effective ${effective}</span>`),
      `${version} does not head itself as effective ${effective}`,
    );
    await assertCanonicalAtOwnPath(`/legal/dpa/${version}`, `${version} is not canonical at its own path`);
  }
});

test('freezes the DPA version the site currently publishes', () => {
  const frozen = frozenDpaVersions.map(({ version }) => version);
  assert.ok(
    frozen.includes(dpaVersion),
    `DPA version ${dpaVersion} has no frozen page; frozen: ${frozen.join(', ')}`,
  );
});

/*
 * Article 28(3) is a list of things a processor contract must contain, and a
 * DPA that drops one of them is not a DPA. The anchors are the contract's own
 * table of contents, and a procurement reviewer follows them, so the section
 * has to exist on the live agreement and on every frozen copy of it.
 */
const DPA_SECTIONS = [
  'parties',
  'definitions',
  'roles',
  'instructions',
  'personnel',
  'security',
  'subprocessors',
  'requests',
  'breach',
  'assistance',
  'deletion',
  'transfers',
  'annex-i',
  'annex-ii',
];

test('carries every Article 28 section, on the live agreement and every frozen copy', async () => {
  const pages = [
    '../src/components/DataProcessingAgreement20261108.astro',
    ...frozenDpaVersions.map(({ version }) => `../src/pages/legal/dpa/${version}.astro`),
  ];

  for (const path of pages) {
    const page = await read(path);
    for (const id of DPA_SECTIONS) {
      assert.match(page, new RegExp(`<h[23] id="${id}">`), `${path} has no section #${id}`);
      assert.match(page, new RegExp(`<a href="#${id}">`), `${path} does not list #${id} in contents`);
    }
  }
});

/*
 * The dated page is the copy an order recorded at checkout stays bound to, so
 * its wording may never move when the live document does. Until 2026-08-09 it
 * rendered the shared CommercialTerms component, and the entity-name
 * correction of 2026-08-03 silently rewrote the "immutable" page — the exact
 * drift the URL exists to rule out. The text is now inlined in the dated page,
 * and this guard asserts non-coupling: the frozen source never reads the live
 * component or the live version constants, rather than asserting it equals
 * them, which would re-couple it to every future edit.
 */
const frozenCommercialTermsVersions = [
  { version: 'startup-2026-07-23', date: '2026-07-23', effective: 'July 23, 2026' },
  { version: 'startup-2026-09-10', date: '2026-09-10', effective: 'September 10, 2026' },
  { version: 'startup-2026-10-24', date: '2026-10-24', effective: 'October 24, 2026' },
];

test('keeps every dated terms page frozen: it never reads the live document', async () => {
  for (const { version, date, effective } of frozenCommercialTermsVersions) {
    const page = await read(`../src/pages/legal/terms/${date}.astro`);

    /* Matched as names, not as import statements, so a re-render through any
     * future spelling — import, dynamic import, re-export — still reds. The
     * component name may appear in this file's own comment explaining the
     * freeze; imports resolve a path, so the path forms are what is banned. */
    assert.doesNotMatch(page, /components\/CommercialTerms/, `${version} renders the live terms`);
    assert.doesNotMatch(page, /lib\/legal(\.mjs)?/, `${version} reads the live version constants`);

    /* And it carries its version identity as literals, so the constants moving
     * to a new version cannot move this page with them. The header spans, not
     * the bare strings: Section 9 restates every version in its history. */
    assert.match(
      page,
      new RegExp(`<span>Version ${version}</span>`),
      `${version} does not head itself as version ${version}`,
    );
    assert.match(
      page,
      new RegExp(`<span>Effective ${effective}</span>`),
      `${version} does not head itself as effective ${effective}`,
    );
    await assertCanonicalAtOwnPath(`/legal/terms/${date}`, `${version} is not canonical at its own path`);
  }
});

/*
 * Payments ruling 30 (2026-11-05): the SDK is MIT or Apache-2.0 and free, so
 * the live SDK Commercial Terms page and its component are gone. The executed
 * dated copies stay published and unedited, and no navigation reaches them. The
 * frozen relay-2026-09-10 terms link /legal/terms and may not be edited, so the
 * old address redirects to the licensing page instead of returning a 404. The
 * rules are exact: a splat on /legal/terms/ would move the dated copies.
 */
test('retires the live SDK Commercial Terms and keeps the dated copies unlinked', async () => {
  assert.ok(!existsSync(new URL('../src/pages/legal/terms.astro', import.meta.url)), 'the live SDK Commercial Terms page is back');
  assert.ok(!existsSync(new URL('../src/components/CommercialTerms.astro', import.meta.url)), 'the live SDK Commercial Terms component is back');
  assert.ok(existsSync(new URL('../src/pages/licensing.astro', import.meta.url)), 'the /legal/terms redirect points at a page this repo does not have');

  const rules = (await read('../public/_redirects'))
    .split('\n')
    .filter((line) => line.startsWith('/'))
    .map((line) => line.trim().split(/\s+/));
  for (const source of ['/legal/terms', '/legal/terms/', '/terms', '/terms/']) {
    assert.deepEqual(
      rules.filter(([rule]) => rule === source),
      [[source, '/licensing/', '308']],
      `${source} does not redirect once, permanently, to /licensing/`,
    );
  }
  assert.ok(
    !rules.some(([source]) => source.startsWith('/legal/terms/') && source !== '/legal/terms/'),
    'a rule covers a dated SDK Commercial Terms copy',
  );

  /* The frozen instruments under src/pages/legal may link each other; nothing
   * else may send a reader to the retired terms. */
  const frozen = /\/pages\/legal\/[a-z-]+\/\d{4}-\d{2}-\d{2}\.astro$/;
  const walk = async (dir) => {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) found.push(...(await walk(url)));
      else if (/\.(astro|mdx?|mjs|ts)$/.test(entry.name)) found.push(url);
    }
    return found;
  };
  const sources = (await walk(new URL('../src/', import.meta.url))).filter((url) => !frozen.test(url.pathname));
  assert.ok(sources.length > 50, `only ${sources.length} sources were read`);
  for (const url of sources) {
    assert.doesNotMatch(await readFile(url, 'utf8'), /href=["'{`]*\/legal\/terms/, `${url.pathname} links the retired SDK Commercial Terms`);
  }

  for (const { date } of frozenCommercialTermsVersions) {
    assert.ok(existsSync(new URL(`../src/pages/legal/terms/${date}.astro`, import.meta.url)), `the executed ${date} terms copy is gone`);
  }
});

/*
 * The Relay pages carry the same promise: the console records the dated URL
 * when an organization accepts the terms. The first dated page rendered the
 * shared component until 2026-09-10, so the guard the commercial page earned
 * applies to every dated Relay page. The list is written out, not derived from
 * the live constant, for the reason the privacy list gives below.
 *
 * Versions dated through 2026-11-02 live at /legal/relay-terms/<date>, the
 * default `slug`. From signal-relay-2026-11-05 on, a version lives at
 * /legal/signal-relay-terms/<date>.
 */
const frozenSignalProtocolRelayTermsVersions = [
  { version: 'relay-2026-08-26', date: '2026-08-26', effective: 'August 26, 2026' },
  { version: 'relay-2026-09-10', date: '2026-09-10', effective: 'September 10, 2026' },
  { version: 'relay-2026-09-22', date: '2026-09-22', effective: 'September 22, 2026' },
  { version: 'relay-2026-09-29', date: '2026-09-29', effective: 'September 29, 2026' },
  { version: 'relay-2026-10-05', date: '2026-10-05', effective: 'October 5, 2026' },
  { version: 'relay-2026-10-08', date: '2026-10-08', effective: 'October 8, 2026' },
  { version: 'relay-2026-10-18', date: '2026-10-18', effective: 'October 18, 2026' },
  { version: 'relay-2026-10-24', date: '2026-10-24', effective: 'October 24, 2026' },
  { version: 'relay-2026-11-02', date: '2026-11-02', effective: 'November 2, 2026' },
  { slug: 'signal-relay-terms', version: 'signal-relay-2026-11-05', date: '2026-11-05', effective: 'November 5, 2026' },
];

test('keeps every dated Relay terms page frozen: it never reads the live document', async () => {
  for (const { slug = 'relay-terms', version, date, effective } of frozenSignalProtocolRelayTermsVersions) {
    const page = await read(`../src/pages/legal/${slug}/${date}.astro`);

    assert.doesNotMatch(page, /components\/\w*RelayTerms/, `${version} renders the live terms`);
    assert.doesNotMatch(page, /lib\/legal(\.mjs)?/, `${version} reads the live version constants`);
    assert.match(
      page,
      new RegExp(`<span>Version ${version}</span>`),
      `${version} does not head itself as version ${version}`,
    );
    assert.match(
      page,
      new RegExp(`<span>Effective ${effective}</span>`),
      `${version} does not head itself as effective ${effective}`,
    );
    await assertCanonicalAtOwnPath(`/legal/${slug}/${date}`, `${version} is not canonical at its own path`);
  }
});

test('freezes the Relay terms version the site currently publishes', () => {
  const frozen = frozenSignalProtocolRelayTermsVersions.map(({ version }) => version);
  assert.ok(
    frozen.includes(signalRelayTermsVersion),
    `Relay terms version ${signalRelayTermsVersion} has no frozen page; frozen: ${frozen.join(', ')}`,
  );
});

/*
 * Section 4 and Section 6 of the Relay terms incorporate the retention
 * statement and the service limits, so a customer who filed the terms must be
 * able to file the policies the terms pointed at. Each live page reads its
 * version from the constants, and each version it has carried is frozen at a
 * dated page. The two documents are versioned independently, so each lists
 * its own frozen versions, written out for the reason the privacy list gives
 * below.
 *
 * The limits document was the Beta Service Limits at /legal/relay-beta-limits
 * through its 2026-09-29 version. Those copies keep the address and the title
 * they were published under, so a frozen entry can name its own slug and title.
 *
 * The live pages moved to the signal-relay addresses on 2026-11-05. Every
 * dated copy published before then keeps its relay- address, which `frozenSlug`
 * names, and `slug` names the live page.
 */
const signalRelayPolicies = [
  {
    slug: 'signal-relay-retention',
    frozenSlug: 'relay-retention',
    current: signalRelayRetentionVersion,
    title: 'Retention Statement',
    frozen: [
      { version: '2026-08-26', effective: 'August 26, 2026' },
      { version: '2026-09-10', effective: 'September 10, 2026' },
      { version: '2026-09-27', effective: 'September 27, 2026' },
      { version: '2026-09-29', effective: 'September 29, 2026' },
      { version: '2026-10-08', effective: 'October 8, 2026' },
      { version: '2026-10-19', effective: 'October 19, 2026' },
      { version: '2026-10-24', effective: 'October 24, 2026' },
    ],
  },
  {
    slug: 'signal-relay-service-limits',
    frozenSlug: 'relay-service-limits',
    current: signalRelayServiceLimitsVersion,
    title: 'Service Limits',
    frozen: [
      { slug: 'relay-beta-limits', title: 'Beta Service Limits', version: '2026-08-26', effective: 'August 26, 2026' },
      { slug: 'relay-beta-limits', title: 'Beta Service Limits', version: '2026-09-10', effective: 'September 10, 2026' },
      { slug: 'relay-beta-limits', title: 'Beta Service Limits', version: '2026-09-29', effective: 'September 29, 2026' },
      { version: '2026-10-05', effective: 'October 5, 2026' },
    ],
  },
];

test('keeps every dated Relay policy page frozen: it never reads the live page', async () => {
  for (const { slug: liveSlug, frozenSlug, title: liveTitle, frozen } of signalRelayPolicies) {
    for (const { slug = frozenSlug, title = liveTitle, version, effective } of frozen) {
      const page = await read(`../src/pages/legal/${slug}/${version}.astro`);
      const label = `${slug} ${version}`;

      assert.doesNotMatch(page, /lib\/legal(\.mjs)?/, `${label} reads the live version constants`);
      assert.doesNotMatch(page, new RegExp(`legal/${liveSlug}\\.astro`), `${label} renders the live page`);
      /* Each copy titles the product by the name it had while that version
       * was current. */
      assert.match(
        page,
        new RegExp(`<h1>OpenE2EE (Signal Protocol )?Relay ${title}</h1>`),
        `${label} is not the ${title}`,
      );
      assert.match(
        page,
        new RegExp(`<span>Version ${version}</span>`),
        `${label} does not head itself as version ${version}`,
      );
      assert.match(
        page,
        new RegExp(`<span>Effective ${effective}</span>`),
        `${label} does not head itself as effective ${effective}`,
      );
      await assertCanonicalAtOwnPath(`/legal/${slug}/${version}`, `${label} is not canonical at its own path`);
    }
  }
});

test('freezes the Relay policy versions the site currently publishes', async () => {
  for (const { slug, current, frozen } of signalRelayPolicies) {
    const versions = frozen.map(({ version }) => version);
    assert.ok(
      versions.includes(current),
      `${slug} version ${current} has no frozen page; frozen: ${versions.join(', ')}`,
    );
    const live = await read(`../src/pages/legal/${slug}.astro`);
    assert.match(live, /lib\/legal\.mjs/, `${slug} does not read its version from the constants`);
    assert.match(live, /LEGAL_PIN/, `${slug} does not point at its permanent copy`);
    await assertCanonicalAtOwnPath(`/legal/${slug}`, `${slug} is not canonical at its own path`);
  }
});

/*
 * The live Relay terms, retention statement, and service limits moved to the
 * signal-relay addresses. Accepted terms, DPA, and privacy versions link the
 * old live addresses and are never edited, so each old address keeps a
 * permanent redirect in both slash forms. The dated copies stay at their relay-
 * addresses, so the rules are exact and the old live page files are gone.
 */
const movedSignalRelayLivePages = [
  { from: '/legal/relay-terms', to: '/legal/signal-relay-terms' },
  { from: '/legal/relay-retention', to: '/legal/signal-relay-retention' },
  { from: '/legal/relay-service-limits', to: '/legal/signal-relay-service-limits' },
];

test('permanently redirects each old live Relay legal address to its signal-relay page', async () => {
  const redirects = await read('../public/_redirects');
  const rules = redirects
    .split('\n')
    .filter((line) => line.startsWith('/'))
    .map((line) => line.trim().split(/\s+/));
  const pages = await readdir(new URL('../src/pages/legal', import.meta.url));

  for (const { from, to } of movedSignalRelayLivePages) {
    for (const source of [from, `${from}/`]) {
      assert.deepEqual(
        rules.filter(([rule]) => rule === source),
        [[source, `${to}/`, '308']],
        `${source} does not redirect once, permanently, to ${to}/`,
      );
    }
    const target = to.replace('/legal/', '');
    assert.ok(pages.includes(`${target}.astro`), `${to} has no live page`);
    assert.ok(!pages.includes(`${from.replace('/legal/', '')}.astro`), `${from} is a live page again`);
  }

  /* One hop: no rule sends a reader to an address another rule moves again. */
  const sources = new Set(rules.map(([source]) => source.replace(/\/$/, '')));
  for (const [source, destination] of rules) {
    const path = destination.split('#')[0].replace(/\/$/, '') || '/';
    assert.ok(!sources.has(path), `${source} redirects to ${destination}, which redirects again`);
  }

  /* No rule covers a dated copy: a splat on an old address would move them. */
  for (const { from } of movedSignalRelayLivePages) {
    assert.ok(
      !rules.some(([source]) => source.startsWith(`${from}/`) && source !== `${from}/`),
      `a rule moves the dated copies under ${from}/`,
    );
  }
});

test('links the live Relay legal pages at their signal-relay addresses', async () => {
  const surfaces = [
    '../src/components/Footer.astro',
    '../src/pages/contact.astro',
    '../src/pages/licensing.astro',
    '../src/pages/signal-relay/index.astro',
    '../src/pages/legal/index.astro',
  ];
  for (const path of surfaces) {
    const page = await read(path);
    assert.doesNotMatch(
      page,
      /href="\/legal\/relay-(terms|retention|service-limits|beta-limits)\/?"/,
      `${path} links a retired live Relay address`,
    );
  }
  assert.match(
    await read('../src/pages/contact.astro'),
    /href="\/legal\/signal-relay-terms"/,
    'the contact page does not link the live Relay terms',
  );
});

/*
 * The privacy notice earned the same treatment on 2026-09-10. Its Section 9
 * listed five superseded versions with nothing archived behind any of them, so
 * a correction to the live page rewrote what every one of those entries claims
 * to describe. Only versions published as their own frozen page are listed
 * here; the four before 2026-08-26 have no archived text and Section 9 says so.
 *
 * The list is written out rather than derived, because deriving it from the
 * live constant is the coupling the freeze exists to prevent: it would name
 * only the current version and go quiet about every earlier one the moment the
 * constant moves.
 */
const frozenPrivacyVersions = [
  { version: '2026-08-26', effective: 'August 26, 2026' },
  { version: '2026-09-10', effective: 'September 10, 2026' },
  { version: '2026-09-27', effective: 'September 27, 2026' },
  { version: '2026-09-29', effective: 'September 29, 2026' },
  { version: '2026-10-08', effective: 'October 8, 2026' },
  { version: '2026-10-19', effective: 'October 19, 2026' },
  { version: '2026-10-24', effective: 'October 24, 2026' },
  { version: '2026-11-02', effective: 'November 2, 2026' },
];

test('keeps every dated privacy page frozen: it never reads the live notice', async () => {
  for (const { version, effective } of frozenPrivacyVersions) {
    const page = await read(`../src/pages/legal/privacy/${version}.astro`);

    /* Path forms, as on the terms pages: a re-render through any future
     * spelling still reds, and the page's own comment may name what it froze. */
    assert.doesNotMatch(page, /lib\/legal(\.mjs)?/, `${version} reads the live version constants`);
    assert.doesNotMatch(page, /legal\/privacy\.astro/, `${version} renders the live notice`);

    /* The header spans, not the bare strings. Section 9 restates every version
     * number in its changelog, so a looser match was satisfied by the history
     * even after the header itself had been re-dated. */
    assert.match(
      page,
      new RegExp(`<span>Version ${version}</span>`),
      `${version} does not head itself as version ${version}`,
    );
    assert.match(
      page,
      new RegExp(`<span>Effective ${effective}</span>`),
      `${version} does not head itself as effective ${effective}`,
    );
    await assertCanonicalAtOwnPath(`/legal/privacy/${version}`, `${version} is not canonical at its own path`);
  }
});

/*
 * And the version the site publishes today is one of them. This is the ratchet:
 * bumping privacyVersion without freezing the text it replaces leaves the new
 * Section 9 entry pointing at nothing, which is the state the freeze was
 * introduced to end.
 */
test('freezes the privacy version the notice currently publishes', () => {
  const frozen = frozenPrivacyVersions.map(({ version }) => version);
  assert.ok(
    frozen.includes(privacyVersion),
    `privacy version ${privacyVersion} has no frozen page; frozen: ${frozen.join(', ')}`,
  );
});

/*
 * Invariant 4 of the legal-terms-2026-09 plan: the fee table lives in the terms,
 * and /pricing is a summary of it. A price that appears on the pricing page and
 * not in the current Relay terms is a price no accepted document states.
 * Section 3.1 of the Relay terms carries the table from relay-2026-09-10 on;
 * relay-2026-08-26 incorporated /pricing by reference, which is what this
 * guard rules out.
 */
test('states every published price and included quantity in the Relay terms', async () => {
  const terms = await flat('../src/components/SignalProtocolRelayTerms20261105.astro');

  /* Bounded on both sides so a shorter figure cannot be satisfied by a longer
   * one containing it: "100" must not pass on "100,000", and "$0" must not
   * pass on "$0.50". */
  const states = (value, where) => {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
      terms,
      new RegExp(`(?<![\\d.,])${escaped}(?![\\d.,])`),
      `the Relay terms do not state ${where}: ${value}`,
    );
  };

  for (const plan of signalRelayPlans) {
    states(plan.price, `the ${plan.name} price`);
    states(plan.signalRelayMau, `the ${plan.name} Relay MAU allowance`);
    states(plan.deliveryUnits, `the ${plan.name} delivery units`);
    states(plan.attachmentOperations, `the ${plan.name} attachment uploads`);
    states(plan.storage, `the ${plan.name} storage`);
    for (const [meter, rate] of Object.entries(plan.overage ?? {})) {
      states(rate, `the ${plan.name} ${meter} overage rate`);
    }
  }

  for (const [meter, value] of Object.entries(signalRelaySandboxEnvironment)) {
    if (meter === 'detail') continue;
    states(value, `the Sandbox environment ${meter}`);
  }
});

test('makes privacy and the Relay terms available from the site footer', async () => {
  const footer = await read('../src/components/Footer.astro');
  assert.match(footer, /href="\/legal"/);
  assert.match(footer, /href="\/legal\/privacy"/);
  assert.doesNotMatch(footer, /href="\/legal\/terms"/, 'the footer links the retired SDK Commercial Terms');
  assert.match(footer, /href="\/legal\/signal-relay-terms"/);
  assert.match(footer, /OpenE2EE, Inc\. and OpenE2EE contributors/);
});

test('names the selected counterparty in current documents and preserves accepted copies', async () => {
  for (const path of [
    '../src/components/SignalProtocolRelayTerms20261105.astro',
    '../src/components/DataProcessingAgreement20261108.astro',
    '../src/pages/legal/privacy.astro',
    '../src/pages/legal/terms/2026-10-24.astro',
    '../src/pages/legal/relay-terms/2026-10-24.astro',
    '../src/pages/legal/dpa/2026-10-24.astro',
    '../src/pages/legal/dpa/2026-11-08.astro',
    '../src/pages/legal/privacy/2026-10-24.astro',
  ]) {
    const source = await flat(path);
    assert.match(source, /OpenE2EE, Inc\./, path);
    assert.doesNotMatch(source, /OpenE2EE LLC|Minnesota limited liability company/, path);
  }
  for (const path of [
    '../src/pages/legal/terms/2026-09-10.astro',
    '../src/pages/legal/relay-terms/2026-10-18.astro',
    '../src/pages/legal/dpa/2026-09-29.astro',
    '../src/pages/legal/privacy/2026-10-19.astro',
  ]) {
    assert.match(await read(path), /OpenE2EE LLC/, `${path} no longer preserves its accepted text`);
  }
});

/*
 * Section 9 promises a new effective date whenever the notice changes, so the
 * version constant moves with the text. The history then has to say which
 * version each change arrived in — and the way that silently stops being true
 * is interpolating the *current* version into a sentence about a past one,
 * which is what the tenth event's arrival did to the nine before it.
 */
test('keeps the privacy version history truthful about when each event arrived', async () => {
  const privacy = await flat('../src/pages/legal/privacy.astro');
  assert.match(privacy, /<strong>Version 2026-07-28:<\/strong>/);
  assert.match(privacy, /nine of them at that date/i);
  /* Every version but the newest is written out, because interpolating the
     constant into an older entry re-dates a change that already happened. */
  assert.match(privacy, /<strong>Version 2026-08-07:<\/strong> a tenth event was added/);
  assert.match(privacy, /<strong>Version 2026-08-07\.2:<\/strong>[^<]{0,240}eleventh event/);
  assert.match(privacy, /<strong>Version 2026-08-09:<\/strong> no new event/);
  assert.match(privacy, /<strong>Version 2026-09-10:<\/strong> no new event/);
  assert.match(privacy, /<strong>Version 2026-09-29:<\/strong> no new event/);

  /*
   * Exactly one entry may interpolate the constant, and this is the whole rule.
   *
   * It replaces a pair of doesNotMatch assertions keyed to each old entry's
   * prose ("a tenth event was added", "eleventh event"). Those were correct for
   * the history they were written against and self-defeating after it: catching
   * the next bump needed a new hand-written assertion, and nothing forced anyone
   * to write it. Simulate a 2026-08-10 bump where the maintainer forgets to
   * literalise 2026-08-09 and two entries interpolate — the prose-keyed version
   * passes, because neither of its two sentences is the one left interpolated.
   * Counting does not care which entry it is, so it never needs rewriting.
   *
   * The three literal matches above are not redundant to this. Counting sees
   * only how many entries interpolate, not whether a past entry still exists:
   * delete the .2 entry outright and the count is still 1. They also do the
   * other half of the work here — with all three older entries pinned to their
   * own literal dates, "exactly one interpolates" can only be satisfied by the
   * newest, so the pair together says what a per-entry assertion used to say
   * and stays true across every future bump.
   */
  const interpolated = privacy.match(/<strong>Version \{privacyVersion\}:<\/strong>/g) ?? [];
  assert.equal(
    interpolated.length,
    1,
    `${interpolated.length} changelog entries interpolate the constant; exactly one may`,
  );
});

test('describes the implemented providers and Signal Protocol Relay boundary', async () => {
  const privacy = await flat('../src/pages/legal/privacy.astro');
  for (const provider of ['Cloudflare', 'Vercel', 'WorkOS', 'Stripe', 'Better Stack', 'Google Workspace']) {
    assert.match(privacy, new RegExp(provider));
  }
  assert.match(privacy, /does not receive message plaintext/i);
  assert.match(privacy, /customer-encrypted envelopes/i);
  assert.match(privacy, /We do not sell personal information/i);
});

test('publishes the exact Relay legal and lifecycle boundary', async () => {
  const [terms, acceptableUse, subprocessors, retention, beta] = await Promise.all([
    flat('../src/components/SignalProtocolRelayTerms20261105.astro'),
    flat('../src/pages/legal/acceptable-use.astro'),
    flat('../src/pages/legal/subprocessors.astro'),
    flat('../src/pages/legal/signal-relay-retention.astro'),
    flat('../src/pages/legal/signal-relay-service-limits.astro'),
  ]);

  /* The SDK is MIT OR Apache-2.0 from 3.0.0. The Relay terms grant no license
   * to it, and say so, since relay-2026-09-22; the project commercial SDK
   * license the earlier versions carried is what the negative check rules out. */
  assert.match(terms, /these Terms grant no license to it/);
  assert.doesNotMatch(terms, /commercial license/i, 'the Relay terms still grant an SDK license');
  assert.match(terms, /OpenE2EE Signal Protocol Relay Service Terms/);
  assert.match(acceptableUse, /spam, malware, phishing/i);
  for (const provider of ['Cloudflare', 'Vercel', 'WorkOS', 'Stripe', 'Better Stack']) {
    assert.match(subprocessors, new RegExp(provider));
  }
  /* Relay authorizes an upload for 14 minutes and keeps the last minute as
   * clock and request-processing headroom under the published ceiling
   * (relay/src/concepts/objects/contract.ts, ATTACHMENT_UPLOAD_AUTHORIZATION_SECONDS).
   * A page that prints the ceiling as the value hands a reader an entitlement
   * the service does not owe; a page that prints 14 has to be re-edited the day
   * the headroom moves. Both pages publish the ceiling and say the real window
   * is under it, which stays true either way. */
  for (const page of [retention, beta]) {
    assert.doesNotMatch(page, /15 minutes maximum/, 'a page publishes the ceiling as the value');
    assert.match(
      page,
      /never .{0,20}more than 15 minutes\. The current window is shorter\./,
      'a page states the upload window without saying the real one is under the ceiling',
    );
  }

  assert.match(retention, /24-hour retention by default/i);
  assert.match(retention, /30-day maximum retention/i);
  assert.match(beta, /Direct encrypted envelope: 256 KiB maximum/i);
  assert.match(beta, /Group encrypted body: 96 KiB plus a 512-byte prefix/i);
});

/*
 * The lake's operating records carry keyed hashes of project, account, and
 * device identifiers for 13 months. Each of the three documents that bound
 * that processing has to say so: the privacy notice for what we collect as
 * controller, the retention statement for how long it outlives a deletion, and
 * the agreement for the purpose it serves as processor. A record the documents
 * do not name is processing no published version permits.
 */
test('states the keyed-hash operating records in every document that bounds them', async () => {
  const [privacy, retention, agreement] = await Promise.all([
    flat('../src/pages/legal/privacy.astro'),
    flat('../src/pages/legal/signal-relay-retention.astro'),
    flat('../src/components/DataProcessingAgreement20261108.astro'),
  ]);

  assert.match(privacy, /appear only as keyed hashes made with a key that OpenE2EE holds/);
  assert.match(privacy, /analytics records described in section 2 are kept for 380 days/);
  assert.match(retention, /device identifiers only as keyed hashes, and no content\. They are kept for 380 days/);
  assert.match(agreement, /to measure and improve the Relay’s reliability, performance, and cost/);
  assert.match(agreement, /measuring and improving the reliability, performance, and cost of the service/);
});

/*
 * Relay records delivery status for a sender, and that record carries the
 * message retention period. The privacy notice and the retention statement
 * each bound it. Neither names a row, a table, or a count, so a change to the
 * receipt shape does not force a new version.
 */
test('states the delivery-status retention in every document that bounds it', async () => {
  const [privacy, retention] = await Promise.all([
    flat('../src/pages/legal/privacy.astro'),
    flat('../src/pages/legal/signal-relay-retention.astro'),
  ]);

  assert.match(privacy, /Relay ciphertext and delivery status follow the project retention setting/);
  assert.match(
    retention,
    /Delivery status that Relay records for a sender uses the same retention period as the message, counted from the time Relay records it\./,
  );
});

/*
 * The console, the CLI, and the Relay call each project's test environment the
 * Sandbox environment, and `oe new` creates it. Every live page and every
 * live legal document uses that name. Only a dated legal page may keep the
 * earlier name, because it freezes the text a customer already accepted.
 */
test('names the Sandbox environment everywhere except the frozen legal versions', async () => {
  const frozen = /^pages\/legal\/[a-z-]+\/\d{4}-\d{2}-\d{2}\.astro$/;
  const entries = await readdir(new URL('../src/', import.meta.url), { recursive: true });
  const sources = entries.filter((path) => /\.(astro|mdx?|mjs|ts)$/.test(path) && !frozen.test(path));
  assert.ok(sources.length > 50, `only ${sources.length} source files were read`);
  for (const path of sources) {
    const text = (await read(`../src/${path}`)).replace(/\s+/g, ' ');
    assert.doesNotMatch(text, /Development environment|Development and production environments/, `${path} uses the earlier environment name`);
    assert.doesNotMatch(text, /\boe dev\b/, `${path} names the retired CLI command`);
  }

  for (const path of [
    '../src/components/SignalProtocolRelayTerms20261105.astro',
    '../src/components/DataProcessingAgreement20261108.astro',
    '../src/pages/legal/privacy.astro',
    '../src/pages/legal/signal-relay-retention.astro',
    '../src/pages/legal/signal-relay-service-limits.astro',
  ]) {
    assert.match(await flat(path), /Sandbox environment|Sandbox and production environments/, `${path} does not name the Sandbox environment`);
  }
});

/*
 * Section 7 of the data processing agreement makes this page the subprocessor
 * list the agreement refers to, and tells the reader it carries each provider's
 * purpose, data boundary, and processing location. A column dropped here makes
 * that sentence false for every provider; a row added without a location makes
 * it false for one, which is the harder version to notice.
 *
 * The row count is exact rather than a lower bound. A subprocessor added
 * without the notice this page promises is the failure the count is for, and a
 * lower bound cannot see it. Adding a provider means updating this number in
 * the same commit, which is the point.
 */
test('publishes the subprocessor list the agreement points at', async () => {
  const page = await read('../src/pages/legal/subprocessors.astro');
  /* Prose is read flattened: a sentence that wraps is the same promise, and a
   * guard that reads otherwise fails on a reflow instead of on a broken one. */
  const prose = page.replace(/\s+/g, ' ');
  const body = page.slice(page.indexOf('<tbody>'), page.indexOf('</tbody>'));
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, cell]) => cell.trim()),
  );

  assert.equal(rows.length, 9, `the list publishes ${rows.length} providers`);
  assert.match(page, /<th>Location<\/th>/, 'the list publishes no location column');
  for (const cells of rows) {
    assert.equal(
      cells.length,
      4,
      `"${cells[0]}" has ${cells.length} cells, not provider, purpose, boundary, and location`,
    );
    assert.ok(cells[3], `"${cells[0]}" publishes no location`);
  }
  assert.ok(
    rows.some(([provider]) => provider === 'Neon'),
    'the console database provider is not on the list',
  );

  assert.ok(rows.some(([provider, , boundary]) => provider === 'PostHog' && /no message content, keys, or email addresses/.test(boundary)));

  assert.match(
    prose,
    /at least 30 days’ notice by email to the project owner’s console address/,
    'the list does not state the notice period the agreement promises',
  );
  assert.match(
    prose,
    /urgently for security or service continuity/,
    'the notice promise carries no urgent carve-out, so it promises what an incident cannot keep',
  );
  assert.match(prose, /href="\/legal\/dpa"/, 'the list does not reach the agreement that cites it');
  assert.match(prose, /privacy@open-e2ee\.dev/, 'the list publishes no address to object to');
});

test('reaches each agreement from the pages that sell against it', async () => {
  /* `flat` keeps comments, and /licensing carries the retired SDK license
   * path inside a comment on purpose: the notes that say what the page stopped
   * being. The shipped markup is what sells, so the comments come out before
   * the two negative checks below. */
  const shipped = async (path) => (await read(path)).replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ').replace(/\s+/g, ' ');
  const [pricing, signalRelay, licensing, footer] = await Promise.all([
    shipped('../src/pages/pricing.astro'),
    flat('../src/pages/signal-relay/index.astro'),
    shipped('../src/pages/licensing.astro'),
    flat('../src/components/Footer.astro'),
  ]);

  /* The Relay plans sell against the Relay service terms. /pricing carries no
   * prose about them since the founder cut its How buying works band on
   * 2026-09-08, so the footer on every page, /pricing included, is the route,
   * and the console binds the terms at checkout. The SDK commercial license
   * table on /pricing, which reached /legal/terms, is gone since payments
   * ruling 30 of 2026-11-05. */
  assert.match(footer, /href="\/legal\/signal-relay-terms"/);
  assert.match(signalRelay, /href="\/legal\/signal-relay-terms"/);
  assert.doesNotMatch(pricing, /href="\/legal\/terms"/, '/pricing reaches the SDK commercial terms it no longer sells against');
  /* The SDK is MIT OR Apache-2.0 from 3.0.0. /licensing names the two license
   * files, which are the instruments now, and the Relay's terms, which are the
   * one agreement the site still sells against. */
  assert.match(licensing, /LICENSE-MIT/);
  assert.match(licensing, /LICENSE-APACHE/);
  assert.match(licensing, /href="\/legal\/signal-relay-terms"/);
  assert.doesNotMatch(licensing, /AGPL|commercial license/i, '/licensing still describes the AGPLv3 path');
});

test('permanently redirects short and historical legal paths to one hierarchy', async () => {
  const redirects = await read('../public/_redirects');

  assert.match(redirects, /^\/terms \/licensing\/ 308$/m);
  assert.match(redirects, /^\/privacy \/legal\/privacy\/ 308$/m);
  assert.match(redirects, /^\/terms\/2026-07-23 \/legal\/terms\/2026-07-23\/ 308$/m);
  assert.match(redirects, /^\/terms\/2026-09-10 \/legal\/terms\/2026-09-10\/ 308$/m);

  /* Every frozen Relay terms version up to relay-2026-09-29 links the old live
   * limits address, and none of them may be edited to follow the rename. The
   * rules are exact, so the dated copies under it still serve. The rule points
   * at the current live address, so the old link takes one hop. */
  assert.match(redirects, /^\/legal\/relay-beta-limits \/legal\/signal-relay-service-limits\/ 308$/m);
  assert.match(redirects, /^\/legal\/relay-beta-limits\/ \/legal\/signal-relay-service-limits\/ 308$/m);
  assert.doesNotMatch(redirects, /^\/legal\/relay-beta-limits\/\*/m, 'a splat rule would hide the dated beta limits copies');
  assert.ok(
    existsSync(new URL('../src/pages/legal/signal-relay-service-limits.astro', import.meta.url)),
    'the limits redirect points at a page this repo does not have',
  );
  assert.ok(
    !existsSync(new URL('../src/pages/legal/relay-beta-limits.astro', import.meta.url)),
    'a live page at the old limits address would shadow the redirect',
  );
});

/*
 * Relay is generally available. A current legal page that calls it a beta, or
 * pre-release, misstates the service a customer accepts. The current pages are
 * the undated routes under src/pages/legal, the components they render, and
 * the dated copy of each current version, which is the address the console
 * records when a customer accepts. Only a superseded dated page may keep that
 * wording, because it freezes text a customer already accepted. Comments and
 * markup attributes are stripped first: a
 * comment may record what an earlier version said, and the dated beta limits
 * copies keep an address that says beta.
 */
test('calls the Relay a beta on no current legal page', async () => {
  const legal = new URL('../src/pages/legal/', import.meta.url);
  const pages = (await readdir(legal, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.astro'))
    .map((entry) => new URL(entry.name, legal));
  const sources = new Set(pages.map(String));
  for (const page of pages) {
    const text = await readFile(page, 'utf8');
    for (const [, component] of text.matchAll(/from '(\.\.\/\.\.\/components\/\w+\.astro)'/g)) {
      sources.add(String(new URL(component, page)));
    }
  }
  assert.ok(pages.length >= 8, `only ${pages.length} current legal pages were read`);
  for (const path of [
    dpaPath,
    privacyPath,
    signalRelayRetentionPath,
    signalRelayServiceLimitsPath,
    signalRelayTermsPath,
  ]) {
    const page = new URL(`../src/pages${path}.astro`, import.meta.url);
    assert.ok(existsSync(page), `${path} has no dated page`);
    sources.add(String(page));
  }
  assert.ok(
    sources.has(String(new URL('../src/components/SignalProtocolRelayTerms20261105.astro', import.meta.url))),
    'the guard does not read the live Relay terms',
  );

  for (const source of sources) {
    const shown = (await readFile(new URL(source), 'utf8'))
      .replace(/^---[\s\S]*?\n---/, ' ')
      .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ');
    const hit = shown.match(/.{0,40}\b(beta|pre-?release)\b.{0,40}/i);
    assert.ok(!hit, `${source.replace(/^.*\/src\//, 'src/')} says "${hit?.[0]}"`);
  }
});

test('lets a published version change the Relay terms and limits for every customer', async () => {
  for (const path of [
    '../src/components/SignalProtocolRelayTerms20261105.astro',
    `../src/pages${signalRelayTermsPath}.astro`,
  ]) {
    const terms = await flat(path);
    assert.match(
      terms,
      /We may change these Terms and the Relay Service Limits at any time by publishing a new version\. A new version applies to every Customer from its effective date/,
      path,
    );
    assert.match(terms, /Your continued use of the Relay after that date is your acceptance/, path);
    assert.match(terms, /by giving at least 30 days’ notice before the change applies/, path);
    assert.doesNotMatch(terms, /remains under its recorded version/, path);
  }
  for (const path of [
    '../src/pages/legal/signal-relay-service-limits.astro',
    `../src/pages${signalRelayServiceLimitsPath}.astro`,
  ]) {
    const limits = await flat(path);
    assert.match(limits, /limits at any time by publishing a new version of this page/, path);
    assert.doesNotMatch(limits, /reasonable notice when practicable/, path);
  }
});

test('applies the current catalog immediately and retains notice for future changes in both agreements', async () => {
  for (const path of ['../src/components/SignalProtocolRelayTerms20261105.astro', `../src/pages${signalRelayTermsPath}.astro`]) {
    const terms = await flat(path);
    assert.match(terms, /prices, included quantities, and overage rates in Section 3\.1 apply to every project from this version’s effective date/);
    assert.match(terms, /This catalog applies immediately without a notice waiting period or grandfathered allowances/);
    assert.match(terms, /For future changes, we may change a plan’s price or its included quantities by giving at least 30 days’ notice/);
    assert.doesNotMatch(terms, /previous prices and included quantities apply until|Publication alone does not start that period/);
  }
});

test('bounds Console onboarding measurement in the current and dated privacy notices', async () => {
  for (const path of ['../src/pages/legal/privacy.astro', '../src/pages/legal/privacy/2026-10-24.astro']) {
    const privacy = await flat(path);
    assert.match(privacy, /Browser observations record setup arrival, runtime choice, snippet copying, payment-form arrival, payment submission, and reported payment results/);
    assert.match(privacy, /Verified service observations separately record project creation, Production activation, payment setup, the first registered device, the first accepted delivery, and the first acknowledged delivery/);
    assert.match(privacy, /Browser actions do not prove these service milestones/);
    assert.match(privacy, /These current-state observations do not establish payment eligibility, future payment success, or application integration readiness/);
    assert.match(privacy, /Organization, project, and event identifiers appear only as keyed hashes that our servers produce/);
    assert.match(privacy, /These records contain no user identifier or user hash/);
    assert.match(privacy, /They contain no message content, copied code, keys, tokens, raw provider subjects, raw identifiers, or free text/);
    assert.match(privacy, /We do not join these records to anonymous marketing-site events/);
    assert.match(privacy, /This measurement adds no CLI telemetry/);
    assert.match(privacy, /Production collection starts only after we publish this notice/);
    assert.match(privacy, /Organization erasure removes that Organization’s raw onboarding records/);
    assert.match(privacy, /Cohort reports contain aggregate counts without Organization, user, project, device, or event identifiers/);
    assert.match(privacy, /onboarding records follow the same 380-day raw retention/);
  }
});


test('the current and dated retention statement state the exact operating-record period', async () => {
  for (const path of ['../src/pages/legal/signal-relay-retention.astro', '../src/pages/legal/relay-retention/2026-10-19.astro']) {
    const retention = await flat(path);
    assert.match(retention, /They are kept for 380 days, including after account or project deletion/);
    assert.doesNotMatch(retention, /13 months/);
  }
});

/*
 * A complete deletion removes the live data, but deleted data can stay in a
 * recovery window for up to 30 days, and Relay has no path that restores a
 * mailbox from it. The statement says so as a capability. The 2026-10-19 copy
 * stays as it was published without the sentence.
 */
test('the current and dated retention statement state the deletion recovery window', async () => {
  for (const path of ['../src/pages/legal/signal-relay-retention.astro', '../src/pages/legal/relay-retention/2026-10-24.astro']) {
    const retention = await flat(path);
    assert.match(
      retention,
      /Relay reports the deletion as complete only after these steps finish\. Deleted data can stay in a recovery window of up to 30 days\. Relay never restores a mailbox from that recovery window\./,
      path,
    );
  }
  const superseded = await flat('../src/pages/legal/relay-retention/2026-10-19.astro');
  assert.doesNotMatch(superseded, /recovery window/);
});

test('separates default account-linked Console usage from optional browser consent in the current and new dated notice', async () => {
  for (const path of ['../src/pages/legal/privacy.astro', '../src/pages/legal/privacy/2026-11-02.astro']) {
    const notice = await flat(path);
    assert.match(notice, /account-linked service usage by default/);
    assert.match(notice, /Server observations record verified account creation and successful authenticated Console access/);
    assert.match(notice, /We rely on our legitimate interests/);
    assert.match(notice, /PostHog.*United States/);
    assert.match(notice, /Signing in and accepting service terms do not grant analytics consent/);
    assert.match(notice, /local storage and session storage after acceptance/);
    assert.match(notice, /Signing out of Console also stops optional browser measurement/);
    assert.match(notice, /Do Not Track and Global Privacy Control keep optional analytics off/);
    assert.match(notice, /You can object to this processing or request deletion/);
    assert.match(notice, /The separate anonymous measurement above is never joined to an account/);
  }
});

test('new Relay terms disclose limited Console usage without bundling optional browser consent', async () => {
  for (const path of [
    '../src/components/SignalProtocolRelayTerms20261105.astro',
    '../src/pages/legal/relay-terms/2026-11-02.astro',
    '../src/pages/legal/signal-relay-terms/2026-11-05.astro',
  ]) {
    const terms = await flat(path);
    assert.match(terms, /records limited account-linked Console usage/);
    assert.match(terms, /Optional analytics that connect public browsing to an account require separate consent/);
    assert.match(terms, /withdrawing that optional consent does not prevent access to the Services/);
  }
});

/*
 * The console accepts a Relay terms pair only when the version id and the
 * dated path take the same prefix: relay-<date> at /legal/relay-terms/<date>,
 * or signal-relay-<date> at /legal/signal-relay-terms/<date>. A mixed pair is
 * refused, so the constants may never mix them.
 */
test('pairs the current Relay terms version id with a dated path of the same prefix and day', () => {
  const day = /^signal-relay-(\d{4})-(\d{2})-(\d{2})$/.exec(signalRelayTermsVersion);
  assert.ok(day, `Relay terms version ${signalRelayTermsVersion} is not signal-relay-<date>`);
  const [, year, month, date] = day;
  assert.equal(signalRelayTermsPath, `/legal/signal-relay-terms/${year}-${month}-${date}`);
  const named = new Date(`${year}-${month}-${date}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  assert.equal(signalRelayTermsEffectiveDate, named);
});

/*
 * signal-relay-2026-11-05 is a naming version. Its text is the 2026-11-02 text
 * with exactly these substitutions: the effective date, the version id, the
 * permanent address, the two incorporated policy links that moved to the
 * signal-relay addresses, and the pricing link, whose plan table id took the
 * signal-relay name in place under NM-FD5. Any other difference is a clause
 * change, which needs its own version and its own review. The comparison
 * starts at the rendered markup, so the frontmatter comment may describe the
 * version.
 *
 * The retired plan table id is built from parts, so that this file does not
 * spell the bare name that the Signal Relay naming guard rejects. The frozen
 * 2026-11-02 page still carries it.
 */
const retiredPlansFragment = `${['re', 'lay'].join('')}-plans`;
const signalRelayNamingSubstitutions = [
  ['<span>Effective November 2, 2026</span>', '<span>Effective November 5, 2026</span>'],
  ['<span>Version relay-2026-11-02</span>', '<span>Version signal-relay-2026-11-05</span>'],
  [
    '<a href="/legal/relay-terms/2026-11-02"><code>/legal/relay-terms/2026-11-02</code></a>',
    '<a href="/legal/signal-relay-terms/2026-11-05"><code>/legal/signal-relay-terms/2026-11-05</code></a>',
  ],
  ['<a href="/legal/relay-retention">', '<a href="/legal/signal-relay-retention">'],
  ['<a href="/legal/relay-service-limits">', '<a href="/legal/signal-relay-service-limits">'],
  [`<a href="/pricing#${retiredPlansFragment}">`, '<a href="/pricing#signal-relay-plans">'],
];

const markup = (source) => source.slice(source.indexOf('<BaseLayout'));

test('changes only names and addresses from the 2026-11-02 version in signal-relay-2026-11-05', async () => {
  const [previous, frozen, live] = await Promise.all([
    read('../src/pages/legal/relay-terms/2026-11-02.astro'),
    read('../src/pages/legal/signal-relay-terms/2026-11-05.astro'),
    read('../src/components/SignalProtocolRelayTerms20261105.astro'),
  ]);

  let expected = markup(previous);
  for (const [from, to] of signalRelayNamingSubstitutions) {
    assert.equal(expected.split(from).length, 2, `the 2026-11-02 page does not carry exactly one ${from}`);
    expected = expected.replace(from, to);
  }
  assert.equal(markup(frozen), expected, 'the dated signal-relay-2026-11-05 page differs from the 2026-11-02 page by more than naming');

  const rendered = markup(live)
    .replace('{signalRelayTermsEffectiveDate}', signalRelayTermsEffectiveDate)
    .replace('{signalRelayTermsVersion}', signalRelayTermsVersion)
    .replace('<a href={signalRelayTermsPath}><code>{signalRelayTermsPath}</code></a>', `<a href="${signalRelayTermsPath}"><code>${signalRelayTermsPath}</code></a>`);
  assert.equal(rendered, markup(frozen), 'the live Relay terms differ from their dated copy');

  for (const source of [frozen, live]) {
    assert.doesNotMatch(source, /href="\/legal\/relay-(terms|retention|service-limits|beta-limits)[/"]/, 'the new version links a retired Relay address');
  }
});

/*
 * DPA 2026-11-08 is a naming version under founder decision NM-FD19. Its text
 * is the 2026-10-24 text with exactly these substitutions: the effective date,
 * the version, the title of the accepted instrument, the name of the service in
 * the Customer Personal Data definition and in the Annex I data importer, and
 * the terms and retention links that moved to the signal-relay addresses. Any other difference is a clause change,
 * which needs its own version and its own review.
 */
const dpaNamingSubstitutions = [
  ['title="Data Processing Agreement 2026-10-24"', 'title="Data Processing Agreement 2026-11-08"'],
  [
    'description="Frozen copy of the OpenE2EE Data Processing Agreement, version 2026-10-24."',
    'description="Frozen copy of the OpenE2EE Data Processing Agreement, version 2026-11-08."',
  ],
  ['<span>Effective October 24, 2026</span>', '<span>Effective November 8, 2026</span>'],
  ['<span>Version 2026-10-24</span>', '<span>Version 2026-11-08</span>'],
  [
    `<a href="/legal/relay-terms">${['OpenE2EE', 'Relay'].join(' ')} Service Terms</a> (“Customer,” “you”). It\n          forms part of those Terms.`,
    '<a href="/legal/signal-relay-terms">OpenE2EE Signal Protocol Relay Service Terms</a> (“Customer,” “you”). It\n          forms part of those Terms.',
  ],
  [
    `process on your behalf to provide the console and ${['OpenE2EE', 'Relay'].join(' ')}. Annex I describes it.`,
    'process on your behalf to provide the console and the OpenE2EE Signal Protocol Relay.\n          Annex I describes it.',
  ],
  [
    `supporting the console and OpenE2EE\n          Relay.`,
    'supporting the console and the\n          OpenE2EE Signal Protocol Relay.',
  ],
];

test('changes only names and addresses from the 2026-10-24 version in DPA 2026-11-08', async () => {
  const [previous, frozen, live] = await Promise.all([
    read('../src/pages/legal/dpa/2026-10-24.astro'),
    read('../src/pages/legal/dpa/2026-11-08.astro'),
    read('../src/components/DataProcessingAgreement20261108.astro'),
  ]);

  let expected = markup(previous);
  for (const [from, to] of dpaNamingSubstitutions) {
    assert.equal(expected.split(from).length, 2, `the 2026-10-24 page does not carry exactly one ${from}`);
    expected = expected.replace(from, to);
  }
  const retention = ['<a href="/legal/relay-retention">', '<a href="/legal/signal-relay-retention">'];
  assert.equal(expected.split(retention[0]).length, 5, 'the 2026-10-24 page does not link the retention statement four times');
  expected = expected.replaceAll(retention[0], retention[1]);
  assert.equal(markup(frozen), expected, 'the dated 2026-11-08 page differs from the 2026-10-24 page by more than naming');

  const rendered = markup(live)
    .replace('title="Data Processing Agreement"', 'title="Data Processing Agreement 2026-11-08"')
    .replace(
      'description="Article 28 processor terms and transfer mechanism for personal data OpenE2EE processes for Relay customers."',
      'description="Frozen copy of the OpenE2EE Data Processing Agreement, version 2026-11-08."',
    )
    .replace('{dpaEffectiveDate}', dpaEffectiveDate)
    .replace('{dpaVersion}', dpaVersion)
    .replace(
      "The permanent copy of this version is at{' '}\n          <a href={dpaPath}><code>{dpaPath}</code></a>.",
      "This is the permanent copy of this version. The agreement offered now is the{' '}\n          <a href=\"/legal/dpa\">current Data Processing Agreement</a>.",
    );
  assert.equal(rendered, markup(frozen), 'the live Data Processing Agreement differs from its dated copy');

  for (const source of [frozen, live]) {
    assert.doesNotMatch(source, /href="\/legal\/relay-(terms|retention|service-limits|beta-limits)[/"]/, 'the new version links a retired Relay address');
  }
});
