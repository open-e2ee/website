import { organization, signalProtocolSdk } from '../data/entity.mjs';

const CONTEXT = 'https://schema.org';
const organizationId = `${organization.url}#organization`;
const websiteId = `${organization.url}#website`;
const logo = new URL(organization.logo, organization.url).href;

/* The organization as a publisher on a page other than the home page. The
 * legal name stays on the home page's full node. */
const publisher = {
  '@type': 'Organization',
  '@id': organizationId,
  name: organization.name,
  url: organization.url,
  logo,
};

/**
 * The JSON-LD for one page.
 *
 * `kind` names the page's entity. `page` holds the facts the layout already
 * states: the canonical URL, the title and description, the social card, and
 * the published and modified dates.
 *
 * @param {'home' | 'product' | 'article'} kind
 * @param {{ url: URL, title: string, description: string, image: URL,
 *   publishedTime?: Date, modifiedTime?: Date }} page
 */
export function structuredData(kind, page) {
  const url = page.url.href;
  switch (kind) {
    case 'home':
      return {
        '@context': CONTEXT,
        '@graph': [
          {
            '@type': 'Organization',
            '@id': organizationId,
            name: organization.name,
            legalName: organization.legalName,
            url: organization.url,
            logo,
            sameAs: organization.sameAs,
          },
          {
            '@type': 'WebSite',
            '@id': websiteId,
            name: organization.name,
            url: organization.url,
            publisher: { '@id': organizationId },
          },
        ],
      };
    case 'product':
      return {
        '@context': CONTEXT,
        '@type': 'SoftwareSourceCode',
        name: signalProtocolSdk.name,
        url,
        codeRepository: signalProtocolSdk.codeRepository,
        license: { '@type': 'CreativeWork', ...signalProtocolSdk.license },
        programmingLanguage: signalProtocolSdk.programmingLanguage,
        publisher,
      };
    case 'article':
      if (!page.publishedTime) throw new Error(`${url}: an article needs its published date`);
      return {
        '@context': CONTEXT,
        '@type': 'BlogPosting',
        headline: page.title,
        description: page.description,
        url,
        mainEntityOfPage: url,
        image: page.image.href,
        datePublished: page.publishedTime.toISOString(),
        ...(page.modifiedTime && { dateModified: page.modifiedTime.toISOString() }),
        publisher,
      };
    default:
      throw new Error(`unknown structured data kind: ${kind}`);
  }
}

/**
 * JSON for a `<script type="application/ld+json">` block. A `<` in any value
 * becomes `<`, so a `</script>` or `<!--` cannot end or corrupt the block.
 * JSON parsers read the escape back as the same character.
 */
export function serializeJsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
