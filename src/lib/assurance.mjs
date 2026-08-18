/*
 * The concrete numbers an evaluator asks for, in one place.
 *
 * These are transcribed from the SDK repository, not estimated here, and each
 * carries the date it was measured — a trust page that says "extensively
 * tested" is worth less than one that says a count of assertions on a stated
 * date, and a figure with no date rots silently. When the SDK publishes a newer run,
 * update this file and the date with it; `tests/assurance-figures.test.mjs`
 * exists so the pages cannot quietly disagree with each other.
 *
 * Sources:
 *   docs/ASSURANCE.md   — the check run, what it covers, what is not published
 *   README.md           — dependency count, spec revisions, reporting window
 *   SECURITY.md         — the vulnerability response commitment
 */

export const SDK_REPO = 'https://github.com/open-e2ee/signal-protocol-js';
const BLOB = `${SDK_REPO}/blob/main`;

export const docs = {
  assurance: `${BLOB}/docs/ASSURANCE.md`,
  securityModel: `${BLOB}/docs/SECURITY.md`,
  protocolPolicy: `${BLOB}/docs/PROTOCOL_POLICY.md`,
  deviations: `${BLOB}/docs/DEVIATIONS.md`,
  architecture: `${BLOB}/ARCHITECTURE.md`,
  reporting: `${BLOB}/SECURITY.md`,
  comparison: `${SDK_REPO}#how-it-compares`,
  license: `${BLOB}/LICENSE`,
  thirdParty: `${BLOB}/THIRD_PARTY_NOTICES.md`,
};

/** Most recent full run of the automated checks, from docs/ASSURANCE.md. */
export const checks = {
  measuredOn: '2026-08-17',
  modules: 389,
  assertions: '6,922',
  passed: '6,920',
  skipped: 2,
  failed: 0,
};

/** Direct production dependencies, from the README. */
export const dependencies = {
  direct: 6,
  resolved: 6,
  names: [
    '@noble/ciphers',
    '@noble/curves',
    '@noble/hashes',
    '@noble/post-quantum',
    'async-lock',
    'unique-names-generator',
  ],
  /* There is no transitive entry to name. The only edges inside the tree are
     the `@noble` packages depending on one another, so the resolved count
     equals the direct one and every package an install pulls in is already
     named above. (`protobufjs` is a development dependency, where the wire
     tests use it as an independent oracle, so it is not in this closure.) */
};

/**
 * Response commitment, which must match SECURITY.md exactly.
 *
 * The acknowledgment window widened from 48 hours to 72 hours on 2026-08-09; the
 * 7-day initial assessment is unchanged. The SDK's own SECURITY.md and README
 * agree as of that date, through signal-protocol-js-internal#127 and the export
 * that carried it to signal-protocol-js#5 — this file is the site's copy of that
 * policy, not its source, so a future change starts there and arrives here.
 */
export const reporting = {
  address: 'security@open-e2ee.dev',
  acknowledgment: '72 hours',
  assessment: '7 days',
};

/**
 * The published specifications the implementation profile is pinned to.
 * Mirrored from the README table, which is the maintained source.
 */
export const specifications = [
  { name: 'X3DH', href: 'https://signal.org/docs/specifications/x3dh/', revision: 'Revision 1, 2016-11-04' },
  {
    name: 'PQXDH',
    href: 'https://signal.org/docs/specifications/pqxdh/',
    revision: 'Revision 3, 2023-05-24 (last updated 2024-01-23)',
  },
  {
    name: 'Double Ratchet',
    href: 'https://signal.org/docs/specifications/doubleratchet/',
    revision: 'Revision 4, 2025-11-04',
  },
  { name: 'Sesame', href: 'https://signal.org/docs/specifications/sesame/', revision: 'Revision 2, 2017-04-14' },
  {
    name: 'ML-KEM Braid',
    href: 'https://signal.org/docs/specifications/mlkembraid/',
    revision: 'Revision 1, 2025-02-21 (last updated 2025-09-26)',
  },
  {
    name: 'FIPS 203 (ML-KEM)',
    href: 'https://csrc.nist.gov/pubs/fips/203/final',
    revision: 'Final, 2024-08-13',
  },
  { name: 'RFC 8032 (Ed25519)', href: 'https://www.rfc-editor.org/rfc/rfc8032.html', revision: '—' },
];
