/*
 * The site's shared Tailwind recipes, declared once.
 *
 * A recipe is a class string that more than one surface writes. It is a
 * constant rather than a stylesheet rule because the utilities are the styling
 * layer now: a rule in a stylesheet is a second place a surface can be dressed
 * from, and the chrome rewrite removed the first one.
 *
 * Every color here is a role from `@open-e2ee/design/roles.css`. The role layer
 * erases the stock Tailwind palette, so a utility that names a color names a
 * role or it names nothing.
 *
 * The console holds the same vocabulary at `src/components/ui`. A reader who
 * has learned a label, a metadata figure, or a ruled table in one product reads
 * the same thing in the other.
 *
 * A class string that one surface writes is not here. It is written where that
 * surface is, because a constant with one caller hides the markup it dresses.
 */

/* ------------------------------------------------------------- measure --- */

/*
 * The page's horizontal bounds. 73.75rem is `--oe-content-wide`, and the gutter
 * narrows below 34rem, where 1.5rem of each side is a sixth of a phone.
 */
export const CONTAINER = 'mx-auto w-full max-w-[73.75rem] px-6 max-[34rem]:px-4';

/*
 * The reading measure, `--oe-content-measure`.
 *
 * The `100%` term keeps a wide child from pushing the page sideways, and the
 * token term restores the measure. The cap is important because `STACK` guards
 * its children with `max-w-full` at variant precedence, which outranks a plain
 * utility on the child; a ceiling that loses to the floor above it caps
 * nothing. Measured before the ratchet: eight paragraphs across `/`, `/product`
 * and `/security` rendered at the full container width without it.
 *
 * The cap stays on the element that carries the font it is measured in. `ch`
 * resolves against that font, so 68ch on a 60px heading is wider than any
 * screen and a cap pushed down to the children stops capping the one line that
 * most needs it.
 */
export const MEASURE = 'max-w-[min(100%,var(--oe-content-measure))]!';

/*
 * The measure and the container on one element.
 *
 * Composed naively they cap the container's own box and then center that, so a
 * page hero starts a quarter of the way across the page while the wordmark
 * above it and every band below it start at the gutter. The width stays as the
 * measure sets it; only the left edge moves, to the one the container would
 * have had: 73.75rem is `--oe-content-wide`, the cap `CONTAINER` sets, so the
 * expression is that container's own auto margin written out.
 *
 * `CONTAINER` is not composed in, and the start margin is `ms-` rather than
 * `mx-`. Both would set `margin-inline`, and two utilities that set one
 * property resolve by the order of the generated sheet rather than by the
 * order of the class list — Tailwind emits `.mx-auto` after the arbitrary
 * `mx-[…]`, so the composition centered the narrow box and the restated edge
 * never applied. Nothing here sets `margin-inline`, so there is no order to
 * depend on. The wide cap is left out for the same reason it would be inert:
 * `MEASURE` carries `!` and overrides it.
 */
export const CONTAINER_MEASURE = `w-full px-6 max-[34rem]:px-4 ${MEASURE} ms-[max(0px,calc((100%-73.75rem)/2))] me-auto`;

/* --------------------------------------------------------------- bands --- */

/* A horizontal rule of a section, with the space that separates two of them. */
export const BAND = 'rule-t py-[clamp(3rem,2rem+4vw,5.5rem)]';

/* A band that steps back from the canvas onto the panel ground. */
export const BAND_SURFACE = 'bg-ground-panel';

/* The heading and the sentence under it that open a band. */
export const BAND_HEAD = 'mb-8 flex max-w-[62ch] flex-col gap-3';

/* The opening block of a page that is not the homepage. */
export const PAGE_HERO =
  'pt-[clamp(2.5rem,1.75rem+4vw,4.5rem)] pb-[clamp(2rem,1.5rem+2vw,3rem)] [&>*>*+*]:mt-4';

/*
 * A column of blocks.
 *
 * `*:min-w-0` is what keeps 320px free of sideways scroll: a flex item defaults
 * to `min-width: auto`, so a wide child — a code block, a diagram, a table —
 * pushes the page sideways rather than scrolling inside its own container.
 */
export const STACK = 'flex flex-col items-start gap-4 *:min-w-0 *:max-w-full';

/* ------------------------------------------------------------- voices --- */

/*
 * Metadata beside prose: a column heading, a version stamp, the terms under a
 * call to action. Third-tier text is made with the face, the size, and the
 * letterspacing rather than with a paler color.
 */
export const METADATA =
  'font-[family-name:var(--oe-metadata-font-family)] text-[length:var(--oe-metadata-size)] font-medium tracking-[var(--oe-metadata-tracking)]';

/* Mono is for values: packages, versions, identifiers, fingerprints, fields. */
export const LABEL = `block ${METADATA} text-text-3`;

/* The sentence under a page heading. */
export const LEAD =
  'text-[clamp(1.0625rem,1rem+0.3vw,1.25rem)] leading-[1.55] text-text-3 max-w-[56ch]';

/*
 * What the SDK is ready for, under the thing it is claimed about. Ruled off
 * above so it reads as a qualification of the block rather than as its last
 * sentence.
 */
export const MATURITY = `w-full max-w-[58ch] rule-t pt-3 ${METADATA} text-text-3`;

/* A navigation link that darkens under the pointer rather than moving. */
export const QUIET_LINK = 'text-text-3 no-underline hover:text-text-1';

/* ------------------------------------------------------------ controls --- */

/*
 * The controls themselves — buttons, the theme toggle, icons, the visually
 * hidden label, and the focus ring — come from `@open-e2ee/design`. What is
 * here is how this site arranges them.
 */
export const ACTIONS = 'flex flex-wrap items-start gap-4';

/*
 * The activation call to action carries its promise underneath it, not in a
 * tooltip. The anchor wraps both the filled button and the sublabel, so the
 * link underline would otherwise paint twice: once through the button label and
 * once as a stray rule under the terms out on the canvas.
 */
export const CTA_PRIMARY = 'inline-flex flex-col items-start gap-2 no-underline';

/*
 * The sublabel hangs under the button without setting the anchor's width. A
 * flex child at `w-0` adds nothing to its parent's intrinsic width, and
 * `min-w-full` then hands it the button's width to hang from, with its words
 * running past that edge on one line. Without this, a sublabel wider than its
 * button widens the anchor, and the secondary control beside it lands a
 * sublabel's width away instead of one gap: "Start free" over "Development
 * environment · no card" put the next button 159px out.
 */
export const CTA_SUBLABEL = `${METADATA} w-0 min-w-full whitespace-nowrap text-text-3`;

export const TEXT_LINKS = 'flex flex-wrap gap-4 text-[0.9375rem]';

/*
 * The offer at the end of a reading page.
 *
 * A panel, not another ruled row. A post already ends in furniture — the older
 * and newer links, the standing disclosure — and an offer drawn as one more
 * rule reads as one more thing to skip. The same panel closes the journal
 * index, which had three rows and then 471 px of chrome.
 *
 * `rule` rather than the border pair it wraps: the site draws every hairline
 * at one weight and one color through the published utility.
 */
export const NEXT_STEP =
  'flex w-full max-w-[58ch] flex-col items-start gap-4 rule bg-ground-panel px-8 py-7 max-[34rem]:px-6';

/* ---------------------------------------------------------------- rows --- */

/*
 * A deck of ruled rows, two columns wide until 48rem.
 *
 * The row rules ride on the deck as child-combinator variants. A row carries no
 * class of its own, so a deck's markup is a list of plain `li` elements, and the
 * combinator stops the rules at one level: a deck nested inside a row keeps its
 * own rows.
 *
 * The first paragraph of a row is its label. 54ch is the body cap, set for a
 * half-width column.
 */
export const ROWS =
  'grid list-none grid-cols-2 gap-x-[clamp(2rem,1rem+3vw,4rem)] gap-y-0 p-0 max-[48rem]:grid-cols-1 ' +
  '[&>li]:rule-t [&>li]:py-6 ' +
  '[&>li>h3]:mb-2 [&>li>p]:max-w-[54ch] [&>li>p]:text-text-3 [&>li>p:first-child]:mb-2';

export const ROWS_SINGLE =
  'grid list-none grid-cols-1 gap-y-0 p-0 ' +
  '[&>li]:rule-t [&>li]:py-6 ' +
  '[&>li>h3]:mb-2 [&>li>p]:max-w-[54ch] [&>li>p]:text-text-3 [&>li>p:first-child]:mb-2';

/*
 * A row that spans both columns. It is for the last row of an odd-numbered
 * deck, which sits alone on its line with the other half already empty, so the
 * span costs no vertical space and the row's rule reads as the band closing
 * rather than as a column ending early. The body drops the 54ch cap and takes
 * the row: keeping the cap leaves a strip of text with a third of the row blank
 * beside it.
 */
export const ROW_WIDE = 'col-span-full';

/* ---------------------------------------------------------------- data --- */

/*
 * A ruled comparison table. `min-w-[32rem]` is what makes the scroll container
 * above it do something: a table that shrinks to a phone stops being readable
 * long before it stops fitting.
 */
export const DATA_TABLE =
  'w-full min-w-[32rem] border-collapse text-[0.9375rem] ' +
  '[&_th]:rule-b [&_th]:pt-3 [&_th]:pr-4 [&_th]:pb-3 [&_th]:text-left [&_th]:align-top ' +
  '[&_td]:rule-b [&_td]:pt-3 [&_td]:pr-4 [&_td]:pb-3 [&_td]:text-left [&_td]:align-top [&_td]:text-text-3 ' +
  '[&_thead_th]:border-b-border-3 [&_thead_th]:font-[family-name:var(--oe-metadata-font-family)] [&_thead_th]:text-[length:var(--oe-metadata-size)] [&_thead_th]:font-medium [&_thead_th]:tracking-[var(--oe-metadata-tracking)] [&_thead_th]:text-text-3 ' +
  '[&_tbody_th]:font-medium ' +
  '[&_th_small]:mt-2 [&_th_small]:block [&_th_small]:max-w-[32ch] [&_th_small]:text-[0.8rem] [&_th_small]:leading-[1.4] [&_th_small]:font-normal [&_th_small]:text-text-3';

/*
 * A term-and-definition deck. HTML allows a div to group each pair inside a
 * `dl`, and pages use that grouping; `display: contents` keeps the term and the
 * definition as direct grid items so they land in the two columns rather than
 * sharing one cell. Below 44rem the deck is one column and the definition loses
 * its rule, which would otherwise draw a line between a term and its own
 * answer.
 */
export const DEFINITION_ROWS =
  'm-0 grid grid-cols-[minmax(10rem,16rem)_minmax(0,1fr)] gap-0 max-[44rem]:grid-cols-1 [&>div]:contents ' +
  '[&_dt]:rule-t [&_dt]:py-4 [&_dt]:text-text-1 [&_dt]:[overflow-wrap:anywhere] [&_dt]:font-[family-name:var(--oe-metadata-font-family)] [&_dt]:text-[length:var(--oe-metadata-size)] [&_dt]:font-medium [&_dt]:tracking-[var(--oe-metadata-tracking)] ' +
  '[&_dd]:m-0 [&_dd]:rule-t [&_dd]:py-4 [&_dd]:text-text-3 max-[44rem]:[&_dd]:border-t-0 max-[44rem]:[&_dd]:pt-0';

/*
 * Evidence rows: one figure, one sentence saying what it counts. The same deck
 * as `DEFINITION_ROWS`, with the term set as a numeral in the heading face,
 * because the number is the argument.
 */
export const FIGURE_ROWS =
  'm-0 grid grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)] gap-0 max-[44rem]:grid-cols-1 [&>div]:contents ' +
  '[&_dt]:rule-t [&_dt]:py-4 [&_dt]:text-text-1 [&_dt]:font-[family-name:var(--oe-heading-font-family)] [&_dt]:text-[1.75rem] [&_dt]:leading-[1.1] [&_dt]:font-[var(--oe-heading-weight)] [&_dt]:tracking-[var(--oe-heading-tracking-display)] [&_dt]:tabular-nums ' +
  '[&_dd]:m-0 [&_dd]:rule-t [&_dd]:py-4 [&_dd]:text-text-3 max-[44rem]:[&_dd]:border-t-0 max-[44rem]:[&_dd]:pt-0';

export const VERDICT = 'mt-3 text-text-1';

/* -------------------------------------------------------------- legal --- */

/*
 * Legal documents read in the editorial column, like a post: the obligations
 * are prose and belong in the serif. What surrounds them is not prose — a
 * contents list, a version pin, a conspicuous notice — so that scaffolding
 * stays in the operating faces and at operating size.
 */
export const LEGAL_PIN = 'mt-4 text-[0.9375rem] leading-[1.55] text-text-3';

export const LEGAL_TOC =
  'rule-y py-4 [&>ol]:m-0 [&>ol]:font-[family-name:var(--oe-font-sans)] [&>ol]:text-[0.9375rem] [&>ol]:leading-[1.5] [&>ol]:text-text-3';

/*
 * Disclaimers and liability limits are capitalized because that is what makes
 * them conspicuous at law. Capitals at prose size in the serif are a wall; the
 * sans, a step smaller, stays conspicuous and stays readable.
 */
export const LEGAL_NOTICE =
  'font-[family-name:var(--oe-font-sans)] text-[0.9375rem] leading-[1.6]';

/* ----------------------------------------------------------- editorial --- */

/*
 * Header and body share one column so the article reads as a single measure,
 * rather than two `ch`-derived widths that differ because the fonts differ.
 */
export const ARTICLE_COLUMN =
  'max-w-[calc(32rem+var(--oe-space-6)*2)] [&_.prose]:max-w-full';

export const ARTICLE_HEADER =
  'pt-[clamp(2.5rem,2rem+3vw,4rem)] pb-8 [&>h1]:my-4 [&>h1]:text-[clamp(1.875rem,1.25rem+2vw,2.625rem)]';

export const ARTICLE_META = `mt-6 flex flex-wrap gap-3 rule-t pt-4 ${METADATA} text-text-3`;

export const BACK_LINK = 'text-sm no-underline hover:underline';

/*
 * A note the reader must not miss, ruled on the leading edge in the color this
 * site uses where something is settled rather than promised.
 *
 * This is the one hairline here that the rule utility cannot draw. Tailwind
 * emits an arbitrary-value utility such as border-l-[3px] before a custom
 * utility, so the rule shorthand would land last and erase the leading edge.
 * The border utilities keep this drawing.
 */
export const CALLOUT =
  'max-w-[68ch] border border-border-1 border-l-[3px] border-l-[var(--oe-sealed)] bg-ground-panel px-6 py-4 [&_p]:text-text-3';

export const CALLOUT_LABEL = `${LABEL} mb-2 text-[var(--oe-sealed)]`;
