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
 * what the suffix recorded. Its changelog entry still records the suffix and the
 * event, but no longer says the event fired on `/demo`: the route is gone, and
 * an entry that named it would send a reader looking for a page.
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
 * representation about when this notice applies, and dating it forward would
 * tell a reader a notice takes effect tomorrow while the string it describes is
 * already going out.
 *
 * Here the notice trails the string rather than leading it: the fold shipped one
 * pull request ahead of this, so the site has been sending `scenario_opened /`
 * since that deployed. What was stale in that window is worth naming exactly,
 * because it was never the quotation. The fold changed the sent string and the
 * quoted string in one commit, so section 5 quoted the right words throughout.
 * Everything around the quotation is what lagged: the stamp still read
 * 2026-08-07.2 and August 7, no changelog entry described the change, and both
 * the event list and the previous entry still sent readers to `the demo page`,
 * which that same commit deleted. A reader in the window found an accurate
 * quotation under an out-of-date version, pointing at a page that was gone. What
 * bounds that is the two merges landing 76 minutes apart on 2026-08-09, each
 * deploying on push — the window is shorter than the day this version names, so
 * no dated notice was ever wrong for a whole day of its own effect. The reverse
 * order is the one that cannot be bounded that way: a notice published ahead of
 * the string describes transmission that is not happening yet, and it keeps
 * describing it for as long as the second deploy is delayed. So a wider gap
 * would need the notice to go first. The same reasoning kept 2026-08-07.2 on
 * August 7 rather than moving it.
 */
export const privacyVersion = '2026-08-09';
export const privacyEffectiveDate = 'August 9, 2026';
