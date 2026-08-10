/*
 * Every claim this site makes about somebody else's project.
 *
 * One module, because the matrix appears on /product and is summarised on the
 * homepage, and a claim about a competitor that says one thing on one page and
 * another on the next is the kind of mistake that is read as dishonesty rather
 * than as drift.
 *
 * Three rules hold here:
 *
 *   Measured, not remembered. Every figure below was read from the GitHub API,
 *   the npm registry API, or the published tarball on MEASURED_ON. Where a
 *   figure is a date, it is the date the API returned, not a rounding of it.
 *
 *   Dated, not "currently". A comparison with no date is a claim that quietly
 *   becomes false. `MEASURED_ON` is printed on the page beside the table, and
 *   `tests/comparison.test.mjs` requires it.
 *
 *   Fair, or it is worthless. libsignal and ts-mls are both very actively
 *   maintained and both say so here. The axes are the ones this SDK was built
 *   to change; they are not a quality ranking, and a reader who needs MLS
 *   should leave this site and use ts-mls.
 *
 * How to re-measure:
 *   gh api repos/OWNER/REPO --jq '.pushed_at, .archived, .license.spdx_id'
 *   curl -s https://registry.npmjs.org/PKG   # .time[dist-tags.latest]
 */

/** The date every figure in this file was read from an API. Not a guess. */
export const MEASURED_ON = '2026-08-03';

/**
 * libsignal's own README, on the maintainers' terms rather than ours. It is the
 * strongest thing this site can say about the gap it fills, and it is stronger
 * for being quoted at length: the second sentence is about API stability, which
 * is the practical half of "unsupported".
 */
export const libsignalReadme = {
  quote:
    'This repository is used by the Signal client apps (Android, iOS, and Desktop) as well as server-side. Use outside of Signal is unsupported.',
  continuation:
    'All APIs and implementations are subject to change without notice, as are the JNI, C, and Node add-on "bridge" layers.',
  attribution: 'signalapp/libsignal, README.md',
  href: 'https://github.com/signalapp/libsignal#readme',
};

/**
 * The columns, in the order they appear. `ours` marks the one column that is
 * not an independent measurement, so the page can say so rather than let a
 * reader assume the whole row was audited by someone else.
 */
export const projects = [
  {
    key: 'oe',
    name: '@open-e2ee/signal-protocol-sdk',
    ours: true,
    href: 'https://github.com/open-e2ee/signal-protocol-js',
  },
  {
    key: 'libsignal',
    name: '@signalapp/libsignal-client',
    href: 'https://github.com/signalapp/libsignal',
  },
  {
    key: 'js',
    name: 'libsignal-protocol-javascript',
    href: 'https://github.com/signalapp/libsignal-protocol-javascript',
  },
  {
    key: 'pr',
    name: '@privacyresearch/libsignal-protocol-typescript',
    href: 'https://github.com/privacyresearchgroup/libsignal-protocol-typescript',
  },
  { key: 'mls', name: 'ts-mls', href: 'https://github.com/LukaJCB/ts-mls' },
];

/**
 * The matrix. Cell order matches `projects`.
 *
 * "Yes" and "No" are answers to the axis, not marks out of ten. Where the
 * honest answer is longer than a word, it is longer than a word.
 */
export const axes = [
  {
    axis: 'Expo / React Native',
    cells: [
      'Yes',
      'No — Node native addon; the 0.99.3 tarball ships binaries for macOS, Linux, and Windows only',
      'No',
      'No documented React Native path',
      'Not stated — browsers, Node, and serverless are the documented targets',
    ],
  },
  {
    axis: 'Browser',
    cells: ['Yes', 'No', 'Yes', 'Yes', 'Yes'],
  },
  {
    axis: 'Maintained',
    cells: [
      'Yes — 0.1.x alpha, active',
      'Yes — very active; repo push 2026-07-31',
      'No — archived, last push 2021-08-04',
      'No — last npm publish 2023-05-06, last repo push 2023-07-18',
      'Yes — very active; repo push 2026-08-03',
    ],
  },
  {
    axis: 'Post-quantum key agreement',
    cells: ['Yes — PQXDH with ML-KEM, default, fails closed', 'Yes', 'No', 'No', 'Yes — ML-KEM ciphersuites'],
  },
  {
    /* The axis we lose. Identity signatures here are classical Ed25519, so the
     * protection is against harvest-now-decrypt-later and not against a quantum
     * adversary forging an identity. ts-mls ships ML-DSA-87 ciphersuites and
     * this table would be worth less if it left that out. */
    axis: 'Post-quantum signatures',
    cells: [
      'No — identities are classical Ed25519',
      'No',
      'No',
      'No',
      'Yes — ML-DSA-87 ciphersuites',
    ],
  },
  {
    axis: 'TypeScript-native',
    cells: ['Yes', 'No — Rust core with TypeScript bindings', 'No — JavaScript', 'Yes', 'Yes'],
  },
  {
    axis: 'Protocol',
    cells: [
      'Signal Protocol',
      'Signal Protocol',
      'Signal Protocol',
      'Signal Protocol',
      'MLS (RFC 9420) — a different protocol',
    ],
  },
  {
    axis: 'Commercial license offered',
    cells: ['Yes', 'No — AGPL-3.0 only', 'No — GPL-3.0', 'No — GPL-3.0', 'Not needed — MIT'],
  },
];

/**
 * The prose beside the table: one paragraph per project, each ending in the
 * thing a reader would actually decide on. `verdict` is deliberately not always
 * "use ours" — for two of the five it is not.
 */
export const notes = [
  {
    key: 'libsignal',
    heading: 'The official implementation',
    body: 'The implementation Signal Messenger itself uses, and by a distance the most scrutinised Signal Protocol code that exists. It is very actively maintained, post-quantum, and AGPL-3.0 — 0.99.3 published 2026-07-31, with the repository pushed the same day. It is also a Rust core reached through a Node native addon: the published 0.99.3 tarball carries six prebuilt binaries, for macOS, Linux, and Windows on arm64 and x64. There is no browser build, no Expo build, and no React Native build, and the README does not describe use outside Signal as a supported case.',
    verdict:
      'If you are shipping a desktop or server application on Node, this is the one to reach for first.',
  },
  {
    key: 'js',
    heading: 'The original JavaScript port',
    body: 'Signal’s own JavaScript port, and the ancestor of most of the browser Signal Protocol code in the wild. The repository is archived: the last push was 2021-08-04 and it is read-only on GitHub. It predates PQXDH, so it is classical X3DH with no post-quantum key agreement, and it is GPL-3.0.',
    verdict: 'Archived means archived. Nothing new should start here.',
  },
  {
    key: 'pr',
    heading: 'The TypeScript rewrite of it',
    body: 'An independent TypeScript rewrite of the archived port, and a genuinely useful one when it was current. Its last npm publish was 0.0.16 on 2023-05-06 and its last repository push was 2023-07-18. It is classical X3DH rather than post-quantum and it is GPL-3.0, and its README documents installation and API use without naming a target runtime — there is no React Native or Expo path in it to follow.',
    verdict: 'Still runs, still unmaintained. Check the dates against your support horizon.',
  },
  {
    key: 'mls',
    heading: 'A different protocol, done well',
    body: 'ts-mls implements MLS (RFC 9420) in TypeScript for browsers, Node, and serverless runtimes, and is MIT-licensed. It is very actively maintained — the repository was pushed 2026-08-03, with 1.6.2 the current stable release from 2026-03-07 and a 2.0.0 release candidate line publishing through 2026-07-18. Its post-quantum coverage goes further than this SDK’s: alongside ML-KEM ciphersuites it offers ML-DSA-87 signatures, where identities here are still classical Ed25519. MLS is not the Signal Protocol — different group semantics, a different key schedule, a different ecosystem.',
    verdict:
      'If MLS suits your product, use ts-mls. That is a real choice and this page is not an argument against it.',
  },
  {
    key: 'oe',
    heading: 'This SDK',
    body: 'An independent TypeScript implementation of the published Signal Protocol specifications, running in Expo, React Native, modern browsers, and Node from one package, with post-quantum PQXDH on by default and failing closed. Storage and transport are yours to compose. It is 0.1.x alpha, it is reviewed by adversarial AI agents but not audited by any independent firm, and it is not wire-compatible with Signal Messenger — each of those is stated at length elsewhere on this site rather than left for you to discover.',
    verdict:
      'The case for it is the row above: the Signal Protocol, in the runtimes the other Signal Protocol libraries do not reach.',
  },
];
