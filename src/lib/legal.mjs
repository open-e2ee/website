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
 * The privacy notice is versioned by date, and 2026-08-07 is already published
 * — it is the version that added the home page demo's event. The scenario event
 * on the homepage demo is a second change on the same calendar day, and reusing the date
 * would leave two different notices answering to one version, which is the one
 * thing a version is for.
 *
 * The version string is what disambiguates them, so it carries the suffix. The
 * effective date does not move: it is a representation about when these terms
 * apply, and the site starts collecting the eleventh event the moment this
 * deploys. Dating it forward would have the page tell a reader that a notice
 * takes effect tomorrow while the event it describes is already being
 * collected — and `docs/launch.md` records the event as live on 2026-08-07.
 */
export const privacyVersion = '2026-08-07.2';
export const privacyEffectiveDate = 'August 7, 2026';
