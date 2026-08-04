import tokens from '@open-e2ee/design/tokens' with { type: 'json' };

/*
 * Syntax colors for the code the site shows, in the site's own palette.
 *
 * design/DESIGN.md has no syntax rule, so this is a product decision, and the
 * decision is restraint. Two roles carry color; everything else stays at the
 * code foreground:
 *
 *   comment  the `muted` step, because a comment is an aside and reads as one
 *   string   the brass ramp, because it is the only hue this brand owns that
 *            is not the action color
 *
 * Not the accent. DESIGN.md's color table reserves `ultra` for "Links, focus,
 * the accent. One accent per view", and the hero already spends it on the
 * primary button and three links. Coloring string literals with it would put
 * link-colored text inside a panel where nothing is clickable, next to the one
 * button the fold is for.
 *
 * Brass here is the primitive `seal-*`, not the semantic `--oe-sealed`. The
 * semantic token means the trust boundary — "what the relay can see" — and the
 * longest string in this snippet is the message plaintext, which is the one
 * thing the relay cannot see. Taking the primitive says brass and claims
 * nothing, which is the split DESIGN.md draws: "Semantic tokens are the public
 * surface; primitives are for artwork."
 *
 * The values come from the pinned package rather than being copied out of it,
 * so a palette edit upstream moves these with it instead of leaving the page
 * asserting a contrast ratio that is no longer true. Measured on the `code`
 * surface, both modes clear AA for body text:
 *
 *   comment   5.80 light   6.80 dark
 *   string    5.53 light   9.94 dark
 *   base     11.48 light  13.22 dark
 */
const { seal } = tokens.primitives.color;
const { light, dark } = tokens.semantic;

const step = (ramp, key, name) => {
  const value = ramp[key];
  if (!value) throw new Error(`code-theme: @open-e2ee/design no longer ships ${name}`);
  return value;
};

const theme = (name, type, scheme, comment, string) => ({
  name,
  type,
  fg: scheme['code-foreground'],
  bg: scheme.code,
  settings: [
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: comment },
    },
    {
      /* The quoted body and its quotes, so a literal is one continuous mark
         rather than a colored middle between two foreground quotes. */
      scope: ['string', 'string.quoted', 'punctuation.definition.string'],
      settings: { foreground: string },
    },
  ],
});

export const codeThemes = {
  light: theme('open-e2ee-light', 'light', light, light.muted, step(seal, '700', 'seal-700')),
  dark: theme('open-e2ee-dark', 'dark', dark, dark.muted, step(seal, '300', 'seal-300')),
};

/* Exported for the test that re-derives the ratios above. */
export const codeSurfaces = {
  light: { background: light.code, foreground: light['code-foreground'] },
  dark: { background: dark.code, foreground: dark['code-foreground'] },
};
