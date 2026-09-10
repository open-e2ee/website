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
 * OpenE2EE Relay has a separate service agreement from the SDK commercial
 * license. Keep its accepted version at a permanent URL so a later
 * service-terms update cannot rewrite an existing order.
 */
export const relayTermsVersion = 'relay-2026-08-26';
export const relayTermsEffectiveDate = 'August 26, 2026';
export const relayTermsPath = '/legal/relay-terms/2026-08-26';
export const relayTermsUrl = `https://open-e2ee.dev${relayTermsPath}`;

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
 * The 2026-08-09 version needs no suffix: it is a later day. It exists because
 * the scenarios moved onto the home page and the transmitted string moved with
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
 * This version removes an event. The scenarios left the site, so nothing can
 * send `scenario_opened` and nothing can carry a scenario slug; both the event
 * and the four labels left the collector in the commit that deleted them. The
 * same standard applies as when the string changed: section 5 said the site
 * measured eleven things and quoted a message it no longer sends.
 *
 * Order matters differently in this direction, and it is the safe one. A notice
 * that still describes a removed event over-states what is collected, and a
 * reader who acts on it is protected by more than the notice promises. The
 * dangerous direction is the reverse — a notice published ahead of the string
 * describes transmission that is not happening yet, and keeps describing it for
 * as long as the second deploy is delayed. That is why 2026-08-07.2 stayed on
 * August 7, and why a removal and its notice ship in one commit rather than one
 * leading the other.
 *
 * From 2026-08-26 onward each version also has a page of its own under
 * /legal/privacy, and the constant below has to name a version that has one.
 * The guard in tests/legal-pages.test.mjs is the ratchet: moving this line
 * without freezing the text it replaces fails, because the changelog entry the
 * bump writes would point at nothing.
 *
 * The 2026-09-10 version changes no event and no category. It names the console
 * database provider that the previous version's list walked past, says where
 * the anonymous measurement runs rather than calling it our own infrastructure,
 * routes privacy requests to a mailbox of their own, gives a legal-notice
 * address, points at the data processing agreement, and uses one name for the
 * relay service. A notice is versioned for a correction as well as for a
 * collection change: section 5's standard is that the words this page publishes
 * are the thing being represented, and six of them were wrong.
 */
export const privacyVersion = '2026-09-10';
export const privacyEffectiveDate = 'September 10, 2026';
export const privacyPath = `/legal/privacy/${privacyVersion}`;
export const privacyUrl = `https://open-e2ee.dev${privacyPath}`;

/*
 * The data processing agreement is auto-incorporated: it binds when a customer
 * accepts the Relay terms, and no signature is exchanged. That makes the
 * version identity the only record of which processor terms an organization is
 * under, so it is pinned the same way the two commercial documents are. A
 * customer that files this agreement in a procurement review files the dated
 * URL, and an edit to /legal/dpa must never reach it.
 */
export const dpaVersion = '2026-09-10';
export const dpaEffectiveDate = 'September 10, 2026';
export const dpaPath = '/legal/dpa/2026-09-10';
export const dpaUrl = `https://open-e2ee.dev${dpaPath}`;
