/*
 * The chrome a reader crosses.
 *
 * The website, the documentation host, and the console are three hosts in one
 * session. The six measures around the content — the header, the footer, the
 * theme control, the focus ring, the type scale, and the spacing base — are one
 * set, not three.
 *
 * Three hosts cannot be compared from inside one repository, and a test that
 * reached into a sibling clone would pass here and fail in CI. So each measure
 * is asserted the only way that survives the repository boundary: the shared
 * design package holds one definition, and this host reads it and writes no
 * literal of its own. Two hosts that both read one definition cannot differ.
 * The console repository holds the same assertions against its own source.
 *
 * A grep for the token alone would not do it. A file can name the token in one
 * place and keep the old literal in another, and the header did exactly that:
 * `min-h-16` in the component and a second `4rem` in the stylesheet's
 * `scroll-margin-top`. Each test below therefore asserts the token is read AND
 * that the literal it replaced is gone.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { STORAGE_KEY } from '@open-e2ee/design/theme';
import tokens from '@open-e2ee/design/tokens' with { type: 'json' };
import { cssRules, ruleFor } from './css-rules.mjs';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const installed = (path) =>
  readFile(new URL(`../node_modules/@open-e2ee/design/${path}`, import.meta.url), 'utf8');

const chrome = tokens.components.chrome;

/*
 * The declared value of one `--oe-chrome-*` custom property in the installed
 * token layer. Reading the stylesheet rather than the JSON is the point: the
 * JSON is what the package meant, and the CSS is what a host actually gets.
 *
 * The whole file is searched, and the declaration must be unique. `ruleFor`
 * cannot be used here because `tokens.css` carries three `:root` rules — the
 * base, `:root.dark`, and the reduced-motion override — and a measure declared
 * a second time under one of them is exactly the drift this file is about.
 */
async function declaredChromeToken(name) {
  const css = await installed('packages/design/dist/css/tokens.css');
  const found = [...css.matchAll(new RegExp(`--oe-chrome-${name}:\\s*([^;]+);`, 'g'))];
  assert.equal(found.length, 1, `tokens.css declares --oe-chrome-${name} ${found.length} times`);
  return found[0][1].trim();
}

test('the header height is one shared token and no host literal', async () => {
  assert.equal(await declaredChromeToken('header-height'), '4rem');
  assert.equal(chrome['header-height'], '4rem');

  assert.equal(await declaredChromeToken('header-height-compact'), '3rem');

  /* The site names the height it draws at each width in one variable, and
     that variable reads the two chrome tokens: the full height above the
     sheet breakpoint and the compact height below it. */
  const global = await read('src/styles/global.css');
  const declared = [...global.matchAll(/--oe-site-header-height:\s*([^;]+);/g)].map((m) =>
    m[1].trim(),
  );
  assert.deepEqual(declared, [
    'var(--oe-chrome-header-height)',
    'var(--oe-chrome-header-height-compact)',
  ]);
  assert.match(
    global,
    /@media \(max-width: 62rem\) \{\s*:root \{\s*--oe-site-header-height: var\(--oe-chrome-header-height-compact\);/,
    'the compact height applies below the sheet breakpoint',
  );

  const header = await read('src/components/Header.astro');
  assert.match(header, /min-h-\[var\(--oe-site-header-height\)\]/);
  assert.doesNotMatch(
    header,
    /\b(?:min-)?h-(?:12|16)\b|min-h-\[var\(--oe-chrome-header-height(?:-compact)?\)\]/,
    'the header states a height beside the site variable',
  );

  /* The sticky header sets the offset every in-page link needs. A second
     literal here is the same measure written twice, which is how the two
     drifted apart the first time. */
  const target = ruleFor(global, ':target');
  assert.match(target, /calc\(var\(--oe-site-header-height\) \+ var\(--oe-space-6\)\)/);
  assert.doesNotMatch(target, /\d+rem/, ':target restates the header height as a literal');
});

test('the footer padding is one shared pair of tokens and no host literal', async () => {
  assert.equal(await declaredChromeToken('footer-padding-block-start'), '3rem');
  assert.equal(await declaredChromeToken('footer-padding-block-end'), '2rem');

  const footer = await read('src/components/Footer.astro');
  assert.match(footer, /pt-\[var\(--oe-chrome-footer-padding-block-start\)\]/);
  assert.match(footer, /pb-\[var\(--oe-chrome-footer-padding-block-end\)\]/);
  const opening = footer.slice(footer.indexOf('<footer'), footer.indexOf('>', footer.indexOf('<footer')));
  assert.doesNotMatch(opening, /\b[pm][tby]-\d+\b/, 'the footer states its own padding step');
});

test('the theme control is the shared module on every host', async () => {
  const toggle = await read('src/components/ThemeToggle.astro');
  assert.match(toggle, /from '@open-e2ee\/design\/theme'/);
  for (const name of ['getStoredTheme', 'setTheme', 'watchSystemTheme']) {
    assert.match(toggle, new RegExp(`\\b${name}\\b`), `the toggle does not use ${name}`);
  }
  /* Reading or writing storage directly is how a host acquires a second theme
     contract while still importing the module. */
  assert.doesNotMatch(toggle, /localStorage/, 'the toggle touches storage outside the module');
});

test('the focus ring is the one rule the shared role layer carries', async () => {
  const roles = await installed('packages/design/dist/css/roles.css');
  const rings = cssRules(roles).filter((rule) => rule.selector === ':focus-visible');
  assert.equal(rings.length, 1, 'the role layer no longer carries exactly one focus ring');
  assert.match(rings[0].body, /box-shadow/);

  /* A host may extend the ring for one control. It may not declare a bare
     `:focus-visible`, which would replace the shared ring site-wide. */
  for (const path of ['src/styles/global.css', 'src/styles/code.css']) {
    const own = cssRules(await read(path)).filter((rule) => rule.selector === ':focus-visible');
    assert.equal(own.length, 0, `${path} declares a focus ring of its own`);
  }
});

test('the type scale is four shared tokens and no host literal', async () => {
  const steps = [
    ['h1', 'title-size', 'clamp(2.125rem, 1.35rem + 3.4vw, 3.75rem)'],
    ['h2', 'section-size', 'clamp(1.625rem, 1.25rem + 1.6vw, 2.25rem)'],
    ['h3', 'subsection-size', '1.125rem'],
    ['h4', 'minor-size', '1rem'],
  ];
  const global = await read('src/styles/global.css');
  for (const [selector, token, value] of steps) {
    assert.equal(await declaredChromeToken(token), value);
    const body = ruleFor(global, selector);
    const size = body.match(/font-size:\s*([^;]+);/);
    assert.ok(size, `${selector} declares no font-size`);
    assert.equal(size[1].trim(), `var(--oe-chrome-${token})`);
  }
});

test('the spacing base is the shared scale and no host scale', async () => {
  const css = await installed('packages/design/dist/css/tokens.css');
  const steps = [...css.matchAll(/--oe-space-(\d+):\s*([^;]+);/g)];
  assert.equal(steps.length, 9, 'the shared spacing scale is no longer nine steps');
  assert.equal(steps[0][2].trim(), '0.25rem', 'the 4 px base moved');

  for (const path of ['src/styles/global.css', 'src/styles/code.css']) {
    assert.doesNotMatch(
      await read(path),
      /--oe-space-\d+\s*:/,
      `${path} declares a spacing step of its own`,
    );
  }
});

test('the lockup renders at the one shared size', async () => {
  assert.equal(await declaredChromeToken('lockup-size'), '1.25rem');

  const lockup = await read('src/components/Lockup.astro');
  assert.match(lockup, /text-\[length:var\(--oe-chrome-lockup-size\)\]/);
  assert.doesNotMatch(lockup, /\btext-(?:xs|sm|base|lg|xl|2xl)\b/, 'the lockup sets its own size');

  /* The mark sizes from the wordmark through the brand manifest's ratio, so
     one token fixes the whole composition. A host that hard-codes a pixel mark
     beside a token wordmark draws a different lockup at the same size. */
  const manifest = JSON.parse(await installed('packages/design/dist/assets/manifest.json'));
  const written = Number(/\[&_\.oe-mark\]:h-\[([\d.]+)em\]/.exec(lockup)?.[1]);
  assert.equal(written, manifest.lockups.symbolFontRatio);

});

test('one theme choice persists under the shared key', async () => {
  assert.equal(STORAGE_KEY, 'oe-theme');

  /*
   * The pre-paint resolver is the one place the key is restated. It runs
   * before any module loads, and the site's CSP is `script-src 'self'` with no
   * inline script, so it cannot import the constant it must agree with. The
   * two canvas hexes in the same file are held to `tokens.css` for the same
   * reason.
   */
  const init = await read('public/theme-init.js');
  const key = init.match(/var KEY = '([^']+)';/);
  assert.ok(key, 'the pre-paint resolver states no storage key');
  assert.equal(key[1], STORAGE_KEY, 'the pre-paint resolver reads a different key');

  /*
   * Every other mention is that file or a comment. A quoted literal in code is
   * a second theme contract, so comments are stripped before the search rather
   * than the pattern being narrowed: the toggle's own header names the key in
   * backticks, and a pattern loose enough to miss that would also miss a
   * literal written in backticks.
   */
  const toggle = (await read('src/components/ThemeToggle.astro'))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const quoted = [...toggle.matchAll(/['"`]oe-theme['"`]/g)];
  assert.equal(quoted.length, 0, 'the toggle restates the storage key');
});
