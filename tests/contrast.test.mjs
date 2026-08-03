/*
 * Contrast for the pairs this site invents.
 *
 * The design system re-derives every ratio it publishes, but it can only check
 * pairs it knows about: foreground on canvas, code-foreground on code, each
 * chip on its own surface. A site composes new ones — a metadata colour on the
 * code surface, a cipher dump on the sunken pane — and nothing upstream has
 * ever measured those. This file measures them here, against the same token
 * file the stylesheet reads, so a palette change or a token swap fails the
 * build rather than shipping a line nobody can read.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import tokens from '@open-e2ee/design/tokens' with { type: 'json' };

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
 * Every place the site puts text on something other than the canvas, with the
 * threshold that applies to it. 4.5 is AA for body text; 3 is AA for large
 * text and for the non-text parts of a control.
 */
const composed = [
  ['code block header', 'muted', 'code', 4.5],
  ['inline code in prose', 'foreground', 'code', 4.5],
  ['carrier plaintext', 'foreground', 'surface-raised', 4.5],
  ['carrier ciphertext, relay pane', 'muted', 'surface-sunken', 4.5],
  ['carrier ciphertext, device pane', 'muted', 'surface-raised', 4.5],
  ['footer body', 'muted', 'surface', 4.5],
  ['footer link', 'link', 'surface', 4.5],
];

test('meets AA on every colour pair the site composes itself', () => {
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

test('keeps text off the token the palette only guarantees for borders', async () => {
  const css = await readFile(new URL('../src/styles/global.css', import.meta.url), 'utf8');

  /* `subtle` doubles as `border-control` in light mode, and the design system
   * asserts it against the canvas at a floor of 3 — the non-text threshold.
   * It measures 3.72 on the code surface and 3.93 on the canvas, so any body
   * text wearing it is below AA. The code-block header used to, and the
   * install command is the line most likely to be read at a glance. */
  assert.ok(contrast(tokens.semantic.light.subtle, tokens.semantic.light.canvas) < 4.5);
  assert.doesNotMatch(
    css.slice(css.indexOf('.code-filename,')),
    /^[^}]*color: var\(--oe-subtle\)/,
  );
});
