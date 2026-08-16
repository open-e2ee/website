/*
 * The Open Source Initiative keyhole, as artwork.
 *
 * The path lives here rather than in `OsiMark.astro` because two places draw
 * it now: that component, at text size in the landing page's lead, and the
 * star field in the closing band. A logo transcribed twice is a logo that
 * drifts, and drift is the one failure mode a trademark licence has no
 * tolerance for. `OsiMark.astro` carries the conditions this artwork is drawn
 * under and why this shape rather than the outline variant; read that file
 * before changing anything here.
 *
 * The palette is not a choice. OSI's licence says never stray from it, so the
 * two colours are named constants rather than tokens: `--oe-muted` would be
 * the violation, not the fix.
 */

/* The mark alone, cropped tight — `#shape` from the public-domain full-logo
   SVG on Wikimedia Commons. Not simple-icons' `opensourceinitiative`, which is
   the outline variant and renders as a smudge at text size. */
export const OSI_VIEW_BOX = '1.88 0 466.32 448.94';

export const OSI_PATH =
  'm262.006 307.1224c32.25781-11.98047 49.09765-35.05078 49.09765-74.75781s-33.46093-74.69531-75.26953-74.76563c-44.12109-0.0703-77.40234 34.91407-76.87109 74.76563s19.53906 66.36328 49.95703 75.94922l-53.88672 132.5703c-72.12109-18.67187-145.4727-103.7539-145.4727-208.5195 0-124.0859 99.70313-224.6797 224.6719-224.6797s226.2734 100.5937 226.2734 224.6797c0 106.3945-72.65625 190.293-146.3164 208.8906zm0 0';

/* OSI's published values, not the source file's #3da638 over #1c511c. */
export const OSI_BODY = '#3DA639';
export const OSI_EDGE = '#1E531D';

/* The edge is part of the artwork, not a decoration added to it: the shape is
   drawn filled and stroked, and anything sampling the silhouette has to stroke
   it too or it samples a mark 15 units narrower than the one on the page. */
export const OSI_EDGE_WIDTH = 15.3697;
