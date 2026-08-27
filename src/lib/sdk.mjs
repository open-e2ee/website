import sdkManifest from '@open-e2ee/signal-protocol-sdk/package.json' with { type: 'json' };

/*
 * What this site is allowed to say about the SDK's version, read from the copy
 * of the SDK it actually has installed.
 *
 * Every version statement on the site used to be typed. That put the site one
 * release behind on the day 0.2.0 shipped and three behind by 0.2.3, across
 * two landing pages, the comparison matrix, and two journal posts — and no
 * check could catch it, because a hand-typed number is indistinguishable from a
 * correct one. `package.json` pins the dependency, `npm ci` installs it, and
 * this module is the only place that reads it.
 */

/** The version of the SDK this build of the site has installed. */
export const sdkVersion = sdkManifest.version;

/**
 * The release line, `0.2.3` → `0.2.x`. The maturity claim is the line and not
 * the patch: a patch changes nothing a reader was told about API or format
 * stability, so naming it would churn every page for no new fact.
 */
export const sdkLine = sdkVersion.split('.').slice(0, 2).concat('x').join('.');

/**
 * The canonical maturity statement from `docs/messaging.md` §4: the release
 * line, with no stage adjective. Composed here so /product, /security, the
 * comparison matrix, and the journal cannot state different versions.
 */
export const maturityLine = sdkLine;
