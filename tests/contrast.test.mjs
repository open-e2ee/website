/*
 * Contrast for the pairs this site invents.
 *
 * The design system re-derives every ratio it publishes, but it can only check
 * pairs it knows about: foreground on canvas, code-foreground on code, each
 * chip on its own surface. A site composes new ones — a metadata color on the
 * code surface, a cipher dump on the sunken pane — and nothing upstream has
 * ever measured those. This file measures them here, against the same token
 * file the stylesheet reads, so a palette change or a token swap fails the
 * build rather than shipping a line nobody can read.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import tokens from '@open-e2ee/design/tokens' with { type: 'json' };
import { codeSurfaces, shellSurface } from '../src/lib/code-theme.mjs';
import { ruleFor } from './css-rules.mjs';

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const toLinear = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [red, green, blue] = channels(hex).map(toLinear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const contrast = (foreground, background) => {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
};

/*
 * `color-mix(in srgb, <a> <p>%, <b>)`, which the stylesheet uses once.
 *
 * sRGB mixing is a per-channel weighted average on the 0-255 values, and the
 * browser rounds each channel to an integer before painting, so this rounds
 * too — an unrounded mix can report a ratio a hair above a floor the rendered
 * pixel is a hair below.
 */
const mix = (a, b, weight) => {
  const parts = [1, 3, 5].map((i) => {
    const left = parseInt(a.slice(i, i + 2), 16);
    const right = parseInt(b.slice(i, i + 2), 16);
    return Math.round(left * weight + right * (1 - weight));
  });
  return `#${parts.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/*
 * Every place the site puts text on something other than the canvas, with the
 * threshold that applies to it. 4.5 is AA for body text; 3 is AA for large
 * text and for the non-text parts of a control.
 */
const composed = [
  ['inline code in prose', 'foreground', 'code', 4.5],
  ['carrier plaintext', 'foreground', 'surface-raised', 4.5],
  ['carrier ciphertext, relay pane', 'muted', 'surface-sunken', 4.5],
  ['carrier ciphertext, device pane', 'muted', 'surface-raised', 4.5],
  ['footer body', 'muted', 'surface', 4.5],
  ['footer link', 'link', 'surface', 4.5],
];

test('meets AA on every color pair the site composes itself', () => {
  for (const [name, foreground, background, floor] of composed) {
    for (const theme of ['light', 'dark']) {
      const palette = tokens.semantic[theme];
      assert.ok(palette[foreground], `${theme}.${foreground} is not a token`);
      assert.ok(palette[background], `${theme}.${background} is not a token`);
      const ratio = contrast(palette[foreground], palette[background]);
      assert.ok(
        ratio >= floor,
        `${theme} ${name}: ${foreground} on ${background} is ${ratio}, needs ${floor}`,
      );
    }
  }
});

/*
 * The two surfaces the palette does not own.
 *
 * The code panel wears VS Code's paper and the install line wears Ghostty's
 * window, and both are the point rather than an accident: a developer should
 * recognize the applications. But the text on them is still ours — the
 * filename header is `--oe-muted`, the copy control is drawn from the shell
 * steps — and no upstream contrast test has any reason to have measured those
 * pairs. `src/lib/code-theme.mjs` is the source for both sides, so a theme
 * swap that moved a background arrives here rather than on the page.
 *
 * Most rows below take no `mode`, because most of these surfaces do not change
 * with the page. Ghostty ships no light theme; the code panel now pins Dark+ in
 * both modes, and pins the four site tokens printed on it along with the paper —
 * so a row that read `tokens.semantic[mode].muted` would be measuring a color
 * `.code-block` overrides, and would pass on light #615d57 while the page paints
 * dark #a19c95. Naming `.dark` is what keeps the row measuring the page.
 *
 * The one row that still varies is the theme pair itself. `.prose pre` inside a
 * blog post follows the page, so Light+ on white has to hold as well as Dark+ on
 * #1e1e1e — and that row is about the upstream themes rather than about anything
 * this repository composes on top of them.
 */
const panel = codeSurfaces.dark.background;
const onPanel = tokens.semantic.dark;

const foreign = [
  ['code block header', () => onPanel.muted, () => panel, 4.5],
  ['code, unhighlighted', (mode) => codeSurfaces[mode].foreground, (mode) => codeSurfaces[mode].background, 4.5],

  /*
   * The gutter, which has no upstream value to borrow.
   *
   * Light+ and Dark+ leave `editorLineNumber.foreground` to the base theme VS
   * Code composes them with, and shiki does not bundle that — checked, both
   * return undefined — so there is nothing here to quote and restating VS
   * Code's default from memory would be a claim this repository cannot verify.
   * The numbers are ours instead, which puts them under this test rather than
   * under a comment.
   *
   * `--oe-code-gutter` is `--oe-muted` mixed 78% toward the editor surface
   * under it, so that a column of numerals stops competing with the syntax
   * colors beside it. That mix is the reason this row cannot just name a
   * token: the value is composed in the stylesheet, and the whole point of
   * composing it is to spend contrast, so it is exactly the kind of value that
   * needs a floor holding it up. Re-derived here from the same two tokens the
   * CSS mixes, so a palette move upstream fails the suite rather than dimming
   * the gutter under the floor on the page.
   *
   * This row is held to 3 rather than 4.5, and it is the only text on the site
   * that is. The previous version of this comment held it at 4.5 and argued
   * that a line number is the thing a reader points at when they tell a
   * colleague which line broke — that argument is about an editor a reader is
   * working in, and this is a seventeen-line quotation on a landing page that
   * nobody can edit or refer to. Nothing on the site references a line number;
   * the only mention is "the ten-line example", which is a count. So the
   * numerals are decoration under WCAG 1.4.3's incidental exemption, and the
   * floor that applies is the 3:1 non-text one.
   *
   * Lowering a floor is how a suite stops catching things, so what it cost is
   * written down. The measured ladder on this surface is 85% = 4.79, 82% =
   * 4.55, 81% = 4.48, 78% = 4.25, 74% = 3.97. 82% was the last AA step and the
   * page shipped there; the owner was shown the ladder with the AA line marked
   * and chose 78%, one stop past it, because at the floor the numbers still
   * read as part of the program. That is a judgment they are entitled to make
   * and this file is not the place to relitigate it — but it is the place to
   * make sure it stays a judgment rather than becoming a slope, which is what
   * the 3 below does — though not tightly, and that is worth being honest
   * about rather than leaving a reader to assume the floor is close. 74% and
   * 70% pass at 3.97 and 3.70, and so do 64% and 60% at 3.33 and 3.10; 59% is
   * the last step that holds, and 58% is where this row starts failing. So the
   * gate below stops a gutter that has gone genuinely invisible, not the next
   * step down from where the page sits.
   */
  ['line numbers', () => mix(onPanel.muted, panel, 0.78), () => panel, 3],

  /*
   * The adapter selector and the example's copy button, which sit on the
   * editor surface and so cannot wear the shell's steps: `shellSurface.prompt`
   * is #9da5b4 and measures 2.48 on this paper, which would make the panel's
   * only controls its least readable text.
   */
  ['adapter select text', () => onPanel.foreground, () => panel, 4.5],
  ['adapter select border', () => onPanel['border-control'], () => panel, 3],
  ['example copy glyph', () => onPanel.muted, () => panel, 4.5],

  /*
   * The focus ring the panel's three controls draw, which is on this list
   * because it is the one that was nearly missed. It is drawn with an offset,
   * so it lands on the panel rather than inside the control, and it is the only
   * pinned value whose job is to be seen against the surface rather than read
   * on it — 1.4.11's 3:1, not 1.4.3's 4.5. Light `--oe-focus` is #4454cc and
   * measures 2.69 here, under even that floor, which is what a ring inheriting
   * the page would have shipped in light mode.
   */
  ['panel focus ring', () => onPanel.focus, () => panel, 3],

  ['install command', () => shellSurface.foreground, () => shellSurface.background, 4.5],
  ['shell prompt', () => shellSurface.prompt, () => shellSurface.background, 4.5],
  ['copy control glyph', () => shellSurface.prompt, () => shellSurface.background, 4.5],
  ['copy control border', () => shellSurface.control, () => shellSurface.background, 3],
];

test('meets AA where the site puts its own text on a borrowed surface', () => {
  for (const [name, foreground, background, floor] of foreign) {
    for (const mode of ['light', 'dark']) {
      const ratio = contrast(foreground(mode), background(mode));
      assert.ok(ratio >= floor, `${mode} ${name}: ${ratio} needs ${floor}`);
    }
  }
});

test('measures the gutter mix the stylesheet actually paints', async () => {
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

  /* The row above re-derives the gutter color from two tokens and a 0.78
   * weight, which is only a measurement of the page while that weight is the
   * one the page uses. Nothing otherwise connects them: someone dimming the
   * numbers by hand would edit the percentage here and leave a green suite
   * measuring a color the site no longer paints. So the number is read back
   * out of the CSS rather than trusted.
   *
   * The operands are checked too. A mix toward `--oe-border` or away from
   * `--oe-editor` would still be 78% and would still parse, and the assertion
   * above would still be measuring the wrong pair. */
  const declaration = css.match(/--oe-code-gutter:\s*([^;]+);/);
  assert.ok(declaration, '--oe-code-gutter is not declared — the gutter row is measuring nothing');
  assert.equal(
    declaration[1].replace(/\s+/g, ' ').trim(),
    'color-mix(in srgb, var(--oe-muted) 78%, var(--oe-editor))',
    'the gutter mix moved; the 0.78 in the contrast row above has to move with it',
  );

  /* And that it is declared inside `.code-block`, which is the whole reason the
   * row above can name one surface. Both operands are pinned on that element;
   * the same declaration hoisted back to `:root` would resolve against the page
   * again, and 78% of light `--oe-muted` on the light canvas is #837f79 at
   * 3.73 — numerals a good deal fainter than the ones this row measures, on a
   * surface the row does not look at.
   *
   * That case is the reason this assertion is here rather than being covered by
   * the row above: the mix would read identically out of the CSS, and 3.73
   * clears the floor of 3, so the contrast row would pass while the page dimmed.
   * It would have failed the old 4.5, which means lowering the floor is what
   * made this positional check load-bearing instead of belt-and-braces. */
  const block = css.indexOf('.code-block {');
  assert.notEqual(block, -1, '.code-block rule not found — the anchor has drifted');
  assert.ok(
    declaration.index > block && declaration.index < css.indexOf('\n}', block),
    'the gutter mix has left .code-block; it now resolves against whichever mode is showing',
  );

  /* And that the numbers wear it. The token can be correct and unused. */
  const gutter = css.indexOf('.code-block .astro-code .line::before {');
  assert.notEqual(gutter, -1, 'the line-number rule not found — the anchor has drifted');
  assert.match(css.slice(gutter, css.indexOf('}', gutter)), /color: var\(--oe-code-gutter\)/);
});

test('keeps text off the token the palette only guarantees for borders', async () => {
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

  /* `subtle` doubles as `border-control` in light mode, and the design system
   * asserts it against the canvas at a floor of 3 — the non-text threshold.
   * It measures 3.93 on the canvas and 4.20 on the editor surface, so any body
   * text wearing it is below AA. The code-block header used to, and the
   * install command is the line most likely to be read at a glance.
   *
   * This checked one rule until the platform strip's group label wore `subtle`
   * too and shipped past a green suite. The anchored form could only ever
   * catch a regression in the single rule that had already regressed once,
   * which is the narrowest possible reading of the invariant: the header of
   * global.css states it for all text, not for `.code-filename`. So the
   * assertion is now the invariant — no rule in the stylesheet paints text in
   * it — and the third-tier rank the strip needed is made with size, case, and
   * letterspacing, exactly as that header prescribes.
   *
   * The `assert.ok` is what keeps this honest rather than decorative: it
   * re-derives the sub-AA number from the token file, so if a palette change
   * ever lifts `subtle` above 4.5 this fails and asks to be reconsidered
   * instead of enforcing a ban whose reason has expired. An earlier version
   * anchored with `indexOf` on a selector that had drifted, handed the
   * assertion one character of whitespace, and passed vacuously for two
   * rounds; a test that cannot fail is worse than no test, because the suite
   * reports it as coverage. */
  assert.ok(contrast(tokens.semantic.light.subtle, tokens.semantic.light.canvas) < 4.5);

  /* The `color` property alone. `--oe-subtle` is the border token, so
     `border-color`, `outline-color`, and `fill` all keep using it legally —
     and a bare /color: var\(--oe-subtle\)/ matches every one of them as a
     substring, which would ban the thing the token is for. The leading
     boundary is what makes this a property rather than a suffix. */
  const wearers = [...css.matchAll(/([^{}]*)\{([^}]*)\}/g)]
    .filter(([, , body]) => /(?:^|[;{\s])color:\s*var\(--oe-subtle\)/.test(body))
    .map(([, selector]) => selector.trim().split('\n').pop().trim());
  assert.deepEqual(wearers, [], 'text painted in --oe-subtle, which is below AA on six of eight surfaces');
});

/*
 * The battery in the lead is the one mark on this site whose color is a choice
 * rather than a license condition, so it is the one whose color this file has
 * to defend.
 *
 * It is a graphic that carries meaning — green is the site's "settled rather
 * than promised" color, standing in for what "batteries included" claims — so
 * WCAG 1.4.11 asks 3:1 against the canvas behind it, not the 4.5:1 the text
 * pairs above are held to.
 *
 * The two canvases are supplied differently and that is the reason this exists.
 * Light takes `--oe-verified`. Dark cannot: the token's dark value is
 * `verify-300`, chosen to carry a run of small text at 10.98:1, and a whole
 * glyph filled with it reads as mint. The stylesheet steps three down the same
 * ramp to `verify-500`. That is a deliberate departure from a semantic token,
 * which is precisely the sort of thing a later tidy-up reverses, so the number
 * that justifies it is checked rather than asserted in a comment.
 */
test('keeps the lead’s battery legible as a graphic on both canvases', async () => {
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

  /* Read out of the stylesheet rather than hard-coded, so this measures what
   * the page paints. A hard-coded pair would still pass after someone changed
   * the rule, which is the vacuous-gate failure this file has had before.
   *
   * Through `ruleFor` rather than a regex on the whole file, because
   * `/\.battery-mark \{[^}]*color: …/` also matches inside
   * `:root.dark .battery-mark { … }`. Here it read the right rule only because
   * the light one happens to come first in the file, which is a property of
   * where somebody put a block rather than of what this is measuring. The same
   * regex in `site-content.test.mjs` did read the dark rule, and passed while
   * the light color was reverted outright. */
  const light = ruleFor(css, '.battery-mark').match(/color:\s*var\(--([\w-]+)\)/)?.[1];
  const dark = ruleFor(css, ':root.dark .battery-mark').match(/color:\s*var\(--([\w-]+)\)/)?.[1];
  assert.ok(light && dark, 'the battery should take a token on each canvas');

  /* `--oe-verified` is semantic and lives under `tokens.semantic`; the ramp
   * steps like `--oe-color-verify-500` are primitives under
   * `tokens.primitives.color`. Resolving both by name keeps this working
   * whichever kind either side ends up using, and returning null rather than
   * guessing is what makes the assertions below fail loudly on a rename. */
  const resolve = (name, theme) => {
    const ramp = name.match(/^oe-color-([a-z]+)-(\d+)$/);
    if (ramp) return tokens.primitives.color[ramp[1]]?.[ramp[2]] ?? null;
    return tokens.semantic[theme][name.replace(/^oe-/, '')] ?? null;
  };

  const onLight = resolve(light, 'light');
  const onDark = resolve(dark, 'dark');
  assert.ok(onLight, `could not resolve --${light}`);
  assert.ok(onDark, `could not resolve --${dark}`);

  const canvasLight = tokens.semantic.light.canvas;
  const canvasDark = tokens.semantic.dark.canvas;
  assert.ok(
    contrast(onLight, canvasLight) >= 3,
    `the battery is ${contrast(onLight, canvasLight).toFixed(2)}:1 on the light canvas`,
  );
  assert.ok(
    contrast(onDark, canvasDark) >= 3,
    `the battery is ${contrast(onDark, canvasDark).toFixed(2)}:1 on the dark canvas`,
  );

  /* And the point of the exception, on each side. Both canvases step off
   * `--oe-verified` now, and they step in opposite directions: dark had to get
   * *deeper* or the mint problem is back, light had to get *lighter* or the
   * founder's ask went unanswered. Asserting the ratio alone would pass on a
   * value that moved the wrong way, or on one that never moved. */
  assert.ok(
    contrast(onDark, canvasDark) < contrast(tokens.semantic.dark.verified, canvasDark),
    'the dark-canvas battery is no deeper than --oe-verified — the step off the token bought nothing',
  );
  assert.ok(
    contrast(onLight, canvasLight) < contrast(tokens.semantic.light.verified, canvasLight),
    'the light-canvas battery is no lighter than --oe-verified — the step off the token bought nothing',
  );

  /* The stylesheet claims `verify-600` is the *whole* of the light canvas's
   * headroom, and a claim like that is exactly the sort this suite has shipped
   * wrong before: true when it was written, quietly false after an upstream
   * re-tune, and never re-checked because it reads as arithmetic. So it is
   * measured. If a lighter step ever clears 3:1 this fails, and the right
   * response is to take it and rewrite the comment — not to delete this. */
  const lighterStep = String(Number(light.match(/(\d+)$/)?.[1]) - 100);
  const lighter = tokens.primitives.color.verify[lighterStep];
  assert.ok(lighter, `expected a verify-${lighterStep} to exist above the light battery`);
  assert.ok(
    contrast(lighter, canvasLight) < 3,
    `verify-${lighterStep} clears 3:1 on light (${contrast(lighter, canvasLight).toFixed(2)}:1) — ` +
      'the battery can go a step lighter and the stylesheet comment is now wrong',
  );
});
