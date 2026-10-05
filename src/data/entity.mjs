/**
 * The entities this site describes to search and answer engines, as
 * structured data. src/lib/structured-data.mjs reads every entity value from
 * here, and src/layouts/BaseLayout.astro renders the result.
 *
 * Structured data states only true facts (docs/identity.md, docs/messaging.md
 * §2). It names no person: public authorship is anonymous by founder decision.
 */
export const organization = {
  name: 'OpenE2EE',
  /* docs/identity.md §1: the entity name is for legal identification, so this
   * field is its one place in the structured data. */
  legalName: 'OpenE2EE LLC',
  url: 'https://open-e2ee.dev/',
  /* The carrier mark on the canvas, a square PNG that public/brand serves. */
  logo: '/brand/open-e2ee-app-icon-512.png',
  sameAs: ['https://github.com/open-e2ee', 'https://www.npmjs.com/org/open-e2ee'],
};

export const signalProtocolSdk = {
  name: 'OpenE2EE Signal Protocol SDK',
  codeRepository: 'https://github.com/open-e2ee/signal-protocol-js',
  /* The license in words names both, and the reader picks (docs/messaging.md
   * §4). The LICENSE file states the grant and links the two license texts. */
  license: {
    name: 'MIT or Apache-2.0',
    url: 'https://github.com/open-e2ee/signal-protocol-js/blob/main/LICENSE',
  },
  programmingLanguage: 'TypeScript',
};
