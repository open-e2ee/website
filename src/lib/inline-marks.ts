/*
 * The sizes and the baseline offsets of the marks that sit inside a line of
 * text. `OsiMark.astro`, `TypeScriptMark.astro` and `BatteryMark.astro` write
 * them; `BoxMark.astro` answers the same two questions for itself, because the
 * line it sits on is twice their size.
 */

/*
 * The three marks in the lead, one per clause. Each component carries why it is
 * drawn the way it is — `OsiMark.astro` the trademark conditions and the
 * palette, `BatteryMark.astro` the geometry — and what is settled here is how
 * big the three are and where they sit on the line, because those are the two
 * questions that can only be answered by looking at all of them at once.
 *
 * WHERE THEY SIT was guessed at and is now measured. `text-bottom` sat every
 * box on the descender line, which hung the marks low: it aligns the bottom of
 * the box with the bottom of the font's descent, so a glyph with no descender
 * floats down into the space one would have used. What "aligned with the text"
 * actually looked like was the 🔋 these marks replaced. At the lead's 19.43px
 * that emoji spanned 20px above the baseline and 5px below, putting its center
 * 7.5px up — a third of a pixel off the middle of the cap band, which reaches
 * 14.04px. So the target is 7.5/19.43 = 0.386em above the baseline, and a box
 * of height S has its bottom edge 0.386em - S/2 from it. The calc() is what
 * keeps that true when one mark is resized; three hand-set offsets would not
 * survive the next change to the sizes here. All three paths are centered in
 * their own viewBox, so centring the box centers the ink.
 *
 * HOW MUCH AIR each one carries had to be settled before any of the sizes here
 * meant anything, and it was measured rather than assumed. The keyhole and the
 * TypeScript tile both paint to all four edges of their own boxes — the
 * keyhole's viewBox looks like it has 7.68 units of slack on every side, and
 * that slack is exactly the half-stroke, so the painted mark fills it. The
 * battery was drawn on a 24-unit square and is 12 units wide, so half its box
 * was empty: 6.3px of built-in padding on each side, on top of the word space,
 * against 0 for the other two. That is the whole of why it looked pushed away
 * from the word after it. `BatteryMark.astro` now crops its viewBox to the ink,
 * which is what lets one inline margin here apply to all three and mean the
 * same thing on each.
 *
 * So `--oe-mark-size` is the painted height of the mark, not the height of a box
 * with unknown slack in it. That is the only reading under which the three
 * numbers can be compared at all.
 *
 * HOW BIG started as a rule and is now a rule with a correction on it. Equal
 * boxes do not read as equal marks: to a first approximation what the eye
 * matches is how much ink each one puts on the line. The keyhole is round and
 * inks 66.8% of its box, so at 1.15em it lays down 1.15² x 0.668 = 0.883em², and
 * that is the target the square gets measured against.
 *
 * The rule put the TypeScript tile at 0.941em — it inks 99.8%, everything but
 * its four rounded corners — and it was set at 0.95 and looked visibly the small
 * one. The correction is the interesting part, because it generalizes: the
 * primary logo is a *figure on a field*, white letters printed on a blue tile,
 * and the reader sizes the figure. The letterform is half the tile's height, so
 * at 0.95em its caps came out at 0.48em against the lead's own 0.72em cap band.
 * Ink area treats the tile and the letters as the same substance and they are
 * not. 1.05em is where the mark stops reading as the small one, chosen off a
 * five-step ladder rendered at the lead's real size. The rule holds for a mark
 * that is all figure, like the keyhole; a mark with a field around its figure
 * needs a box above what the rule says.
 *
 * The battery is on neither. It is a tall narrow glyph, so equal ink area would
 * demand a mark half again as tall as the cap band. Height is its constraint:
 * 1.08em, which lands between the keyhole's painted 1.107em and the tile's 1.05.
 *
 * THE MARGIN is one number for all three and it exists so that the gap around a
 * mark does not depend on which mark it is. 0.15em, chosen off a ladder of five
 * on the rendered page: at 0 the marks weld to the words, and by 0.25em each one
 * has drifted away from the clause it belongs to. It is `margin-inline` rather
 * than a trailing space so it applies to both edges of all three at once —
 * before the fix the gaps ran 4.9px, 4.9px and 11.2px for the same markup.
 *
 * GREEN, and only this one. The two marks beside it are locked to brand color
 * by a license or by nominative use; this one is ours, so it can carry meaning,
 * and it takes the green this site uses where something is settled rather than
 * promised — which is the claim "batteries included" makes.
 *
 * Both canvases now name a ramp step directly, and neither uses the semantic
 * token. That is a deliberate exception on both sides rather than a shortcut.
 * `--oe-verified` is tuned for a run of small text; a whole glyph filled with it
 * is a different object, too pale on dark at `verify-300` (10.98:1, reads as
 * mint) and heavier than it needs to be on light at `verify-700` (5.67:1). So:
 * `verify-500` at 6.6:1 on dark, `verify-600` at 3.85:1 on light.
 *
 * `verify-600` is the whole of the headroom the light canvas has, and the number
 * is why the ramp stops there rather than anywhere prettier. WCAG 1.4.11 asks
 * 3:1 of a meaningful graphic, and against `#faf7f3` the next step up the ramp
 * is `verify-500` at 2.74 — under the floor. One step of lightening was
 * available and it was taken. A second is not available at all, and if a lighter
 * green is ever wanted here the thing that has to move first is the claim that
 * this glyph carries meaning, not the ratio.
 *
 * The cap in `tests/site-content.test.mjs` is the other half of the keyhole's
 * size. A mark at badge scale reads as certification, and OSI certifies
 * licenses rather than products — the "no implied endorsement" condition,
 * expressed as a number.
 */

/*
 * Each of the three carries `data-mark`, and the name is the mark. The class
 * list is now utilities, so a rendered mark has no name in it: the attribute is
 * what lets a reader of the built page, or a test of it, say which drawing is
 * on the line. `Header.astro` names its sheet the same way.
 */

/* Every mark: an inline box with no leading, and one inline margin for all
   three so the gap around a mark does not depend on which mark it is. */
export const INLINE_MARK = 'mx-[0.15em] inline-block leading-[0]';

/*
 * The drawing inside it. `--oe-mark-size` is the painted height, and
 * `--oe-mark-aspect` is how much narrower than tall the ink is. The vertical
 * offset is the formula above: a box of height S sits with its bottom edge
 * 0.386em - S/2 from the baseline.
 */
export const INLINE_MARK_SVG =
  'inline h-[var(--oe-mark-size)] w-[calc(var(--oe-mark-size)*var(--oe-mark-aspect,1))] align-[calc(0.386em_-_var(--oe-mark-size)/2)]';
