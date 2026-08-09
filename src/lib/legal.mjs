/*
 * Version identity for the published legal documents.
 *
 * The Startup checkout records a terms URL and version alongside the order, and
 * Section 9 of the terms binds an existing license to the version recorded at
 * checkout. That promise only holds if the recorded URL is immutable, so the
 * dated path below is published as its own page and never edited in place: a
 * new version gets a new date, a new path, and a new constant here.
 */

export const commercialTermsVersion = 'startup-2026-07-23';
export const commercialTermsEffectiveDate = 'July 23, 2026';
export const commercialTermsPath = '/legal/terms/2026-07-23';
export const commercialTermsUrl = `https://open-e2ee.dev${commercialTermsPath}`;

/*
 * The privacy notice is versioned by date. Two versions were published on
 * 2026-08-07: the first added the home page demo's event, and the second added
 * the scenario event, which at that time fired on `/demo`. Reusing the bare
 * date would have left two different notices answering to one version, which is
 * the one thing a version is for, so the second carried a `.2` suffix. That is
 * what the suffix recorded, and the changelog entry for it still reads that way.
 *
 * This version needs no suffix: it is a later day. It exists because the
 * scenarios moved onto the home page and the transmitted string moved with
 * them — `scenario_opened /demo <slug>` became `scenario_opened / <slug>`. No
 * new event, no new category, nothing additional collected; only the page-path
 * token, because the page moved. It is versioned anyway, and the reason is the
 * notice's own standard: section 5 quotes the transmitted words exactly rather
 * than describing them loosely, so changing those words changes the notice. A
 * published notice that quotes a string the site no longer sends is wrong about
 * the one thing it was written to be precise about.
 *
 * The effective date tracks the version and does not run ahead of it. It is a
 * representation about when this notice applies, and the site begins sending
 * the new string the moment this deploys; dating it forward would tell a reader
 * a notice takes effect tomorrow while the string it describes is already going
 * out. The same reasoning kept 2026-08-07.2 on August 7 rather than moving it.
 */
export const privacyVersion = '2026-08-09';
export const privacyEffectiveDate = 'August 9, 2026';
