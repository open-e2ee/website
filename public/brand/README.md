# Signal Protocol developer shield

This directory contains an original solid-color shield monogram for Signal
Protocol, designed for developer documentation, SDKs, CLIs, and code-adjacent
interfaces.

The `S` and `P` use outlined JetBrains Mono ExtraBold glyphs on a shared
monospaced grid. Their visible top and bottom edges are mathematically aligned.
They are SVG paths rather than text, so the production logo has no runtime font
dependency and renders consistently everywhere.

## Files

- `STYLE_GUIDE.md` — logo, color, typography, accessibility, and Tailwind CSS
  light/dark-mode guidance.
- `tailwind/signal-protocol-theme.css` — copy-ready Tailwind CSS 4.3.2 theme
  with primitive and semantic brand tokens.
- `signal-protocol-shield-adaptive.svg` — automatically selects light or dark
  colors with `prefers-color-scheme`.
- `signal-protocol-shield-adaptive-small.svg` — simplified adaptive mark for
  favicon and compact UI use.
- `svg/signal-protocol-shield-light.svg` — explicit light-mode SVG.
- `svg/signal-protocol-shield-dark.svg` — explicit dark-mode SVG.
- `svg/*-small.svg` — explicit variants without the secondary accent stroke,
  optimized for 16–64 px use.
- `png/{32,64,128,512,1024}/` — transparent PNG exports.
- `signal-protocol-shield-mode-sheet.svg` and `.png` — presentation sheet.

The individual logo files have transparent backgrounds. Intended backgrounds:

| Mode | Background | Left facet | Right facet | Lettering |
| --- | --- | --- | --- | --- |
| Light | `#F6F8FC` | `#284D79` | `#19365F` | `#FFFFFF` |
| Dark | `#070B13` | `#FFFFFF` | `#EEF2F7` | `#142D52` |

All artwork uses two flat solid-color facets divided on the shield centerline.
There are no gradients or external font files.

The production mark intentionally has no inner shield contour or built-in drop
shadow. The monogram is shifted 8 px above geometric center for optical balance.
PNG exports at 32 and 64 px are generated from the simplified small-size SVGs.

The monogram uses glyph outlines derived from JetBrains Mono, distributed
under the SIL Open Font License 1.1.

## Regenerating exports

From the repository root:

```sh
node docs/assets/brand/generate-assets.mjs
```

The generator requires `rsvg-convert` for PNG output. The SVG files remain the
source of truth.
