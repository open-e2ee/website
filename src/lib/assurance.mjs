/*
 * The concrete numbers an evaluator asks for, in one place.
 *
 * These are transcribed from the SDK repository, not estimated here, and each
 * carries the date it was measured — a trust page that says "extensively
 * tested" is worth less than one that says 5,875 assertions on a stated date,
 * and a figure with no date rots silently. When the SDK publishes a newer run,
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
  measuredOn: '2026-07-24',
  modules: 351,
  assertions: '5,875',
  passed: '5,874',
  skipped: 1,
  failed: 0,
};

/** Direct production dependencies, from the README. */
export const dependencies = {
  direct: 7,
  resolved: 8,
  names: [
    '@noble/ciphers',
    '@noble/curves',
    '@noble/hashes',
    '@noble/post-quantum',
    'async-lock',
    'protobufjs',
    'unique-names-generator',
  ],
  /* The eighth is `long`, pulled in by protobufjs. */
  transitive: 'long',
};

/** Response commitment, which must match SECURITY.md exactly. */
export const reporting = {
  address: 'security@open-e2ee.dev',
  acknowledgment: '48 hours',
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
