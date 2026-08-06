/*
 * Syntax colours for the code the site shows: VS Code's own, unmodified.
 *
 * This file used to build a five-role theme out of the OpenE2EE palette —
 * comment, punctuation, keyword, string, and bold function names, all drawn
 * from the pinned design package so a palette edit upstream moved the page
 * with it. That was internally coherent and it answered the wrong question.
 * A snippet on a landing page is not a piece of the site's artwork; it is a
 * sample of the reader's own editor, and the reader is a TypeScript developer
 * who has one. Colouring `const` in our brass rather than the blue they see
 * every day makes them decode the panel before they can read the program.
 * Recognition is the feature. A stock theme buys it for free.
 *
 * Light+ and Dark+ are the ones to take, and the reason is recognition
 * rather than contrast. VS Code 1.114 moved its own factory default to the
 * 2026 themes, built on GitHub's Primer palette — so "the current default"
 * and "the thing developers recognise" have come apart, and this panel wants
 * the second. Light+ and Dark+ are what a decade of screenshots, tutorials
 * and StackOverflow answers have looked like. Shiki 4.3.1 does not bundle the
 * 2026 themes at all, so the live alternative was `github-light-default` and
 * `github-dark-default`, which approximate the same palette.
 *
 * Contrast did not decide it, and the earlier draft of this comment claiming
 * otherwise was measuring the GitHub colours against our old warm surface
 * instead of against their own. Taken with their own backgrounds, as this
 * change takes Light+/Dark+ with theirs, every candidate clears AA on both
 * snippets: Light+ bottoms at 4.60 and Dark+ at 5.00, against 4.55 and 6.15
 * for the GitHub pair. That is a tie in light and a loss in dark. The tests
 * below therefore guard the floor rather than the choice — they would have
 * passed either theme, and the choice above is a judgement about what a
 * TypeScript developer's eye already knows.
 *
 * One candidate did fail, and it is the one the blog was already using:
 * `github-dark` prints comments at 3.05 on its own background. Every article
 * on this site has been shipping a sub-AA comment colour.
 *
 * Naming them rather than inlining them is deliberate: shiki resolves these
 * from `@shikijs/themes`, so a highlighter upgrade brings VS Code's own
 * corrections with it instead of freezing a copy of them here.
 *
 * The cost is a real one and worth stating. Dark+ paints `const` and `await`
 * in `#569CD6` and Light+ in `#0000FF`, and DESIGN.md reserves the accent for
 * links and focus. Neither value is a step on the `ultra` ramp — a test below
 * proves it, so the palette's actual rule is not broken — but a saturated
 * blue does appear in a panel where nothing is clickable. That is the price
 * of looking like the reader's editor, and it is the whole point.
 */

/* Shiki bundles both under these ids. Referenced by name so the highlighter
   owns the values; `codeSurfaces` below is the only place this repository
   restates any of them, and a test re-derives it from the theme JSON.

   Annotated against shiki's own union rather than left to inference, which a
   `.mjs` file widens to `string`. That is what `<Code themes>` rejects, and
   the annotation is worth more than the cast it replaces: a mistyped id is
   now an `astro check` error rather than a highlighter that silently falls
   back at build time. */
/** @type {{ light: import('shiki').BundledTheme, dark: import('shiki').BundledTheme }} */
export const codeThemes = {
  light: 'light-plus',
  dark: 'dark-plus',
};

/*
 * The editor's own paper, which code on this site wears instead of `--oe-code`.
 *
 * Light+ against our warm `#f4f1eb` printed numeric literals at 4.08 — the
 * one AA failure in either snippet — and `#ffffff` takes the same colour to
 * 4.60. Adopting the theme's background is therefore not decoration; it is
 * the thing that makes the theme legible. It also costs less separation than
 * it looks: `#ffffff` on our canvas measures 1.07 where `--oe-code` measured
 * 1.06, so the panel is if anything a shade more distinct than before, and
 * the border was always what drew its edge.
 *
 * Which of the two a given block wears is no longer just the page's mode, and
 * this comment used to imply it was. `.code-block` — the hero panel and
 * /product's recorded file — pins the dark pair in both modes, because it is a
 * quoted editor window stacked against a quoted terminal and the two share an
 * edge. `.prose pre` in a blog post still follows the page, because a snippet
 * inside body text is evidence read at the page's own brightness. So the light
 * pair below is live, and it is live for the articles rather than for the
 * landing page. `global.css` owns that split and argues it; the values stay
 * here because both surfaces still have to exist and both still have to be
 * checked.
 *
 * These two pairs are checked against `@shikijs/themes` by
 * `tests/site-content.test.mjs`, which also asserts that `global.css` carries
 * the same values. Nothing here is trusted from this comment.
 */
export const codeSurfaces = {
  light: { background: '#ffffff', foreground: '#000000' },
  dark: { background: '#1e1e1e', foreground: '#d4d4d4' },
};

/*
 * The shell, which is a different application and says so.
 *
 * Ghostty's defaults, read out of `src/config/Config.zig`: `background` is
 * `#282C34` and `foreground` is `#FFFFFF`. Both, in both modes — Ghostty
 * ships `theme: ?Theme = null` and has no light variant, so a light-mode
 * terminal that turned white would be a terminal nobody has. White on the
 * fill measures 14.00.
 *
 * `prompt` and `control` are ours, not Ghostty's, and the panel is otherwise
 * bare: no titlebar, no cursor. Both were drawn for one round and removed,
 * which turns out to be the more faithful quotation — Ghostty is a native
 * window that inherits the desktop's furniture and draws none of its own, and
 * its cursor belongs to a live shell session rather than to a command printed
 * on a page. The prompt glyph's colour comes from the user's shell rather than
 * from the terminal, so it is ours by the same logic.
 *
 * They are dimmed steps of one neutral, at 5.65 and 3.05 on the fill — AA for
 * the prompt, which is a character a reader looks at, and the 3:1 non-text
 * floor for `control`, which only outlines the copy button at rest.
 */
export const shellSurface = {
  background: '#282c34',
  foreground: '#ffffff',
  prompt: '#9da5b4',
  control: '#6e7681',
};
