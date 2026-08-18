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
import { sdkLine } from './sdk.mjs';

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
      `Yes — ${sdkLine}, active`,
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
 * The one line per alternative that the table cannot carry: what to do about
 * it. Two of the four send the reader somewhere that is not this SDK, and
 * `tests/comparison.test.mjs` requires that.
 *
 * A `body` field stood beside each of these, one paragraph per project,
 * including one for this SDK. Every fact in all five was already a cell in the
 * table above them: "Rust core reached through a Node native addon" is the
 * TypeScript-native cell, "no browser build, no Expo build, and no React
 * Native build" is two more, and the dates are the Maintained row. The verdicts
 * are what survived, and there is no entry for this SDK because the table is
 * the case for it.
 */
export const notes = [
  {
    key: 'libsignal',
    heading: 'The official implementation',
    verdict: 'If you ship a desktop or server application on Node, reach for this one first.',
  },
  {
    key: 'js',
    heading: 'The original JavaScript port',
    verdict: 'Archived on 2021-08-04. Do not start here.',
  },
  {
    key: 'pr',
    heading: 'The TypeScript rewrite of it',
    verdict:
      'Still runs, last published 2023-05-06. Check the dates against your support horizon.',
  },
  {
    key: 'mls',
    heading: 'A different protocol, done well',
    verdict: 'If MLS suits your product, use ts-mls.',
  },
];
