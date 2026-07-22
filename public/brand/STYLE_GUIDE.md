# OpenE2EE developer brand style guide

This guide defines how to use the OpenE2EE shield and its supporting UI
tokens in developer documentation, SDK sites, dashboards, CLIs, package pages,
and code-adjacent interfaces.

The Tailwind implementation targets **Tailwind CSS 4.3.2**, the latest tagged
release as of 2026-07-13. It uses Tailwind v4's CSS-first theme variables and
class-driven dark-mode variant:

- [Tailwind CSS v4.3 release](https://tailwindcss.com/blog/tailwindcss-v4-3)
- [Tailwind CSS package release](https://www.npmjs.com/package/tailwindcss)
- [Tailwind theme variables](https://tailwindcss.com/docs/theme)
- [Tailwind dark mode](https://tailwindcss.com/docs/dark-mode)
- [Tailwind CLI installation](https://tailwindcss.com/docs/installation/tailwind-cli)

## Brand principles

1. **Technical clarity.** Interfaces should feel precise, quiet, and built for
   sustained developer use.
2. **Security without theater.** Use the shield confidently, but avoid glow,
   metallic effects, gradients, or decorative lock imagery.
3. **Code-native typography.** Use a neutral sans serif for interface text and
   JetBrains Mono for code, identifiers, metadata, and compact labels.
4. **Semantic theming.** Components consume semantic tokens such as `canvas`,
   `surface`, and `foreground`; they do not hard-code light-mode colors.

## Logo system

### Choose the right asset

| Context | Asset |
| --- | --- |
| Light interface | `svg/open-e2ee-shield-light.svg` |
| Dark interface | `svg/open-e2ee-shield-dark.svg` |
| Web UI that follows the OS mode | `open-e2ee-shield-adaptive.svg` |
| 16–64 px light UI | `svg/open-e2ee-shield-light-small.svg` |
| 16–64 px dark UI | `svg/open-e2ee-shield-dark-small.svg` |
| Compact adaptive UI | `open-e2ee-shield-adaptive-small.svg` |

Use explicit light and dark files for email, social images, documentation
generators, and other renderers that may strip SVG media queries.

### Clear space and minimum size

- Preserve clear space equal to **12.5% of the logo width** on every side.
- Use the full mark at **64 px or larger**.
- Use the small mark from **16–63 px**.
- Do not render the mark below **16 px**.
- Keep the shield upright and preserve its original aspect ratio.

### Do not

- Reverse the approved facet direction: the lighter facet stays on the left.
- Add gradients, shadows, glow, bevels, textures, or transparency to the mark.
- Re-typeset, resize independently, or reposition the `O` and `E`.
- Recolor only one glyph or use colors outside the approved palette.
- Put the light-mode mark on a dark surface or the dark-mode mark on a light
  surface.

## Color system

### Logo colors

| Token | Hex | Use |
| --- | --- | --- |
| Navy 950 | `#0B1D36` | Light-mode outer outline |
| Navy 900 | `#142D52` | Dark-mode `OE` lettering |
| Navy 800 | `#19365F` | Darker right facet |
| Navy 700 | `#284D79` | Lighter left facet |
| Blue 500 | `#4C78D0` | Light-mode accent edge |
| Blue 400 | `#5C82D4` | Dark-mode accent edge |
| White | `#FFFFFF` | Dark-mode left facet; light-mode lettering |
| Slate 100 | `#EEF2F7` | Dark-mode right facet |
| Slate 200 | `#D8E2F5` | Dark-mode outer outline |

### Semantic UI colors

Use semantic utilities from `open-e2ee-theme.css` so components switch
modes automatically.

| Purpose | Tailwind utility examples |
| --- | --- |
| App canvas | `bg-canvas text-foreground` |
| Card or panel | `bg-surface border-border` |
| Secondary panel | `bg-surface-subtle` |
| Muted copy | `text-muted` |
| Primary action | `bg-primary text-primary-foreground` |
| Interactive accent | `text-accent`, `border-accent` |
| Keyboard focus | `outline-focus` |
| Code surface | `bg-code text-code-foreground` |
| Status text | `text-success`, `text-warning`, `text-danger` |

Avoid using primitive utilities such as `bg-oe-blue-800` for application
surfaces. Primitive tokens are for brand artwork and exceptional one-off needs;
semantic tokens are the component API.

## Typography

### Interface text

Use `font-brand-sans`, which resolves to Inter when available and then the
platform UI sans-serif stack.

- Page title: `text-3xl font-semibold tracking-tight`
- Section title: `text-xl font-semibold tracking-tight`
- Body: `text-base leading-7`
- Supporting text: `text-sm leading-6 text-muted`

### Developer text

Use `font-brand-mono` for source code, commands, identifiers, key fingerprints,
versions, timestamps, and compact uppercase labels.

- Inline code: `font-brand-mono text-sm`
- Code block: `font-brand-mono text-sm leading-6`
- Metadata label: `font-brand-mono text-xs font-semibold tracking-wider uppercase`

Do not use monospace for long prose; it reduces scanning speed.

## Tailwind CSS setup

The ready-to-use theme is in
[`tailwind/open-e2ee-theme.css`](./tailwind/open-e2ee-theme.css).

### Install Tailwind 4.3.2

For the generic CLI workflow:

```sh
npm install --save-dev tailwindcss@4.3.2 @tailwindcss/cli@4.3.2
npx @tailwindcss/cli -i ./src/app.css -o ./dist/app.css --watch
```

Use the official Vite, PostCSS, or framework integration instead when the host
application already has one.

### Add the theme

Either use the provided file as the app stylesheet:

```css
@import "../path/to/brand/tailwind/open-e2ee-theme.css";
```

Or copy everything after `@import "tailwindcss";` into an existing Tailwind v4
stylesheet that already imports Tailwind.

The theme exposes primitive utilities such as `bg-oe-blue-800`, semantic
utilities such as `bg-canvas`, typography utilities such as
`font-brand-mono`, and brand radius/shadow utilities such as
`rounded-brand-md` and `shadow-brand-sm`.

## Light and dark mode

The theme uses `.dark` on the root element, matching the official Tailwind v4
selector pattern:

```html
<html class="dark">
```

Semantic utilities switch automatically because their values are backed by CSS
variables. A card generally needs no `dark:` duplication:

```html
<article class="rounded-brand-lg border border-border bg-surface p-6 text-foreground">
  <h2 class="text-xl font-semibold tracking-tight">Session established</h2>
  <p class="mt-2 text-sm leading-6 text-muted">
    The component follows the active OpenE2EE theme.
  </p>
</article>
```

Use `dark:` only when layout, visibility, or non-semantic styling genuinely
changes. Logo switching is a valid example:

```html
<img
  class="size-12 dark:hidden"
  src="/brand/svg/open-e2ee-shield-light.svg"
  alt="OpenE2EE"
/>
<img
  class="hidden size-12 dark:block"
  src="/brand/svg/open-e2ee-shield-dark.svg"
  alt="OpenE2EE"
/>
```

For a first-paint-safe light/dark/system preference, run this inline in the
document `<head>` before loading styles:

```html
<script>
  (() => {
    const preference = localStorage.getItem("oe-theme") ?? "system";
    const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = preference === "dark" ||
      (preference === "system" && systemDark);
    document.documentElement.classList.toggle("dark", isDark);
  })();
</script>
```

Store `"light"`, `"dark"`, or `"system"` under `oe-theme`, then rerun the same
logic when the user changes preference. Listen to `matchMedia` changes while
the stored preference is `"system"`.

## Component patterns

### Primary button

```html
<button
  class="rounded-brand-sm bg-primary px-4 py-2 font-brand-mono text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
>
  Create session
</button>
```

### Code panel

```html
<pre class="overflow-x-auto rounded-brand-md bg-code p-4 text-code-foreground">
  <code class="font-brand-mono text-sm leading-6">const client = await SignalClient.create();</code>
</pre>
```

### Status row

```html
<div class="flex items-center justify-between border-b border-border py-3">
  <span class="text-sm text-muted">PQXDH handshake</span>
  <span class="font-brand-mono text-xs font-semibold uppercase tracking-wider text-success">
    verified
  </span>
</div>
```

## Accessibility

- Maintain at least 4.5:1 contrast for normal text and 3:1 for large text and
  meaningful non-text UI.
- Never rely on status color alone; pair it with text or an icon.
- Keep visible keyboard focus using `focus-visible:outline-focus`.
- Respect reduced-motion preferences and avoid decorative continuous motion.
- Give the logo useful alt text when it conveys identity; use `alt=""` when a
  nearby wordmark already provides the same information.
- Test both modes at 200% zoom and with forced-colors/high-contrast modes.

## Release checklist

- Correct light, dark, or adaptive logo selected.
- Lighter facet remains on the left.
- Clear space and minimum size preserved.
- UI uses semantic tokens rather than copied hex colors.
- Light, dark, and system preferences tested without a flash of the wrong mode.
- Keyboard focus, contrast, zoom, and reduced motion verified.
