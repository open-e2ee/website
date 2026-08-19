/*
 * The one place in this repository where a British spelling is the right thing
 * to write. Two guards read this file, and neither can hold the words itself
 * without matching its own source.
 *
 * `scripts/audit-build.mjs` reads `dist` and guards what a page shows a
 * reader. `tests/spelling.test.mjs` reads the tracked source and guards the
 * half the audit cannot see: comments, test prose, and identifiers, none of
 * which render. The source held about 450 British forms while every built page
 * passed. Among them were 95 `colour`, 81 `licence`, 41 `centre`, and the
 * diagram geometry `centreOf`, `holeCentreY`, and `emittedColours`.
 *
 * Both guards drew their words from a literal of their own until this file
 * existed, and each file excluded itself to keep from matching its own table.
 * That put the explanatory prose of two large files outside every scan. The
 * tables live here now, one file is excluded instead of two, and
 * `the two tables agree on every rejected word` proves they have not drifted.
 *
 * The families are the ones that shipped somewhere in the org, not a general
 * list. A copy pass found "programme" in the FIPS row, "scrutinised" on
 * /product, "catalogues" and "prioritises" in one article, "flavoured" in
 * another, and "travelling" and "labelled" inside SVG `<desc>` text that only
 * a screen reader reads. Later entries came from the source pass: artefact,
 * judgement, acknowledgement, sceptic, centre, grey, candour, and the rest of
 * the -ise verbs.
 *
 * "artefact" is the one pair here whose British form is also correct inside
 * standards prose. Nothing on the site quotes such prose today, which is what
 * makes the rule safe. Quote a standard that spells it "artefact" and exempt
 * that quotation rather than rewriting it.
 */

/*
 * What the built output may not contain. This runs over minified scripts as
 * well as pages, so every entry carries a boundary at each end. Concatenation
 * there makes word-shaped collisions that never appear in source: unbounded,
 * `centRetryRequests` reads as "centre". It is the same trap as `analyses`
 * reading as "analyse".
 *
 * These also run over built dependency code, so a word inside a bundled
 * package would fail a build over text no reader sees. Measured rather than
 * assumed: across every built script today the only matches were this
 * project's own files, and they are fixed. A dependency that trips it later
 * should be allowlisted loudly rather than dropping the guard.
 *
 * Two exclusions are deliberate. "cancelled" is absent because the SDK ships
 * `Cancelled` as a media-attachment error code, and a guard that fails a build
 * over a dependency's identifier gets dropped rather than fixed. `analyses` is
 * absent from the -ise pattern because it is also the American plural noun.
 *
 * `aria-labelledby` needs no exception. The word boundary after "labelled"
 * does not hold inside it, because `d` and `b` are both word characters. That
 * trailing boundary is the whole exclusion, so the doubled-l family carries no
 * leading one. A leading `\b` would pass "mislabelled" and "unlabelled", and
 * both shipped here. The -mme family stops at the plural for the same reason:
 * "programmed" is the American past tense of "program", not a British form.
 */
export const SPELLING = [
  /\b(?:licence|defence|offence|pretence)(?:s|d)?\b/i,
  /\b(?:behaviour|colour|flavour|favour|honour|candour|neighbour|endeavour|rumour|valour)(?:s|ed|al|ing|able)?\b/i,
  /\b(?:catalogu|organis|prioritis|recognis|scrutinis|summaris|generalis|characteris|standardis|normalis|serialis|authoris|optimis|initialis|stylis)(?:e|es|ed|ing|ation|ations)\b/i,
  /\b(?:artefact|judgement|acknowledgement)s?\b/i,
  /\bsceptic(?:al|ism|s)?\b/i,
  /\b(?:centre|centred|centres)\b/i,
  /\b(?:grey|greys|greyscale)\b/i,
  /\banalys(?:e|ed|ing)\b/i,
  /\bprogrammes?\b/i,
  /(?:labell|modell|signall|travell)(?:ed|ing|er|ers)\b/i,
];

/*
 * What the tracked source may not contain. Source is not minified, so the
 * -our and -ce families need no leading boundary here and catch prefixed forms
 * such as "recolour". The families that a boundary protects keep it, for the
 * same reasons the built-output table gives.
 */
export const PATTERN =
  /colour|licence|defence|offence|pretence|behaviour|honour|candour|flavour|favour|neighbour|rumour|endeavour|artefact|acknowledgement|judgement|sceptic|\bprogrammes?\b|\b(?:centre|centred|centres)\b|\b(?:grey|greys|greyscale)\b|\banalys(?:e|ed|ing)\b|(?:labell|modell|signall|travell)(?:ed|ing|er|ers)\b|(?:generalis|characteris|organis|recognis|standardis|prioritis|scrutinis|summaris|normalis|serialis|authoris|optimis|initialis|catalogu|stylis)(?:e|ed|es|ing|ation|ations)/i;

/*
 * Copy this site dropped, quoted back so nobody restores it. Respelling a
 * quotation makes the record false. In `product.astro` it also deletes the
 * subject: that comment counts three spellings of one word, and flattening
 * them to `license` leaves it counting three identical strings. Empty this
 * list and the source scan goes red on both files, which is what keeps the
 * list from going stale.
 */
export const QUOTATIONS = [
  'Three spellings of "licence"',
  'licence offered" where the cell',
  '"A licence row is not a',
  'these are the documents it summarises"',
  'rendered "Which licence your product needs" directly above a',
];

/* Every word both tables must reject. */
export const REJECTED = [
  'colour',
  'recolour',
  'grey',
  'greyscale',
  'centre',
  'centred',
  'licence',
  'candour',
  'travelling',
  'labelled',
  'mislabelled',
  'unlabelled',
  'remodelled',
  'organise',
  'recognised',
  'characterisation',
  'artefact',
  'judgement',
  'acknowledgement',
  'sceptical',
  'programme',
  'analyse',
  'initialised',
  'uninitialised',
];

/*
 * Words `PATTERN` rejects that `SPELLING` deliberately allows. The built-output
 * table is bounded at the front, so a prefixed form reaches it only as part of
 * a longer token, which is the collision the boundary exists to prevent.
 */
export const SOURCE_ONLY = ['recolour', 'uninitialised'];

/*
 * Correct words that a looser table would swallow, and the reason each one is
 * here. `centRetryRequests` is the collision minification produced in `run.js`.
 * `analyses` is the American plural noun. `aria-labelledby` names an ARIA
 * attribute. `programmed` and `programmer` are American inflections of
 * "program". `optimistic` and `generalist` merely contain -is-.
 */
export const ALLOWED = [
  'color',
  'gray',
  'grayscale',
  'greyhound',
  'center',
  'license',
  'organization',
  'recognized',
  'characteristics',
  'generalist',
  'optimistic',
  'artifact',
  'judgment',
  'acknowledgment',
  'skeptical',
  'program',
  'programmer',
  'programmed',
  'analyses',
  'analysis',
  'labeled',
  'traveled',
  'initialized',
  'aria-labelledby',
  'centRetryRequests',
];
