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
 * on `/demo` is a second change on the same calendar day, and reusing the date
 * would leave two different notices answering to one version, which is the one
 * thing a version is for. So this change is dated to the day it takes effect
 * rather than the day it was written.
 */
export const privacyVersion = '2026-08-08';
export const privacyEffectiveDate = 'August 8, 2026';
