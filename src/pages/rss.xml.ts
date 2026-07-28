import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

/*
 * The engineering journal, subscribable.
 *
 * The audience for these articles is the part of the developer world that
 * still runs a reader and specifically does not want an email list, and until
 * now the only way to know a new one existed was to visit the site. Drafts are
 * filtered the same way /blog filters them, so an unpublished piece cannot
 * reach a reader through the back door.
 */
export async function GET(context: APIContext) {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf(),
  );

  return rss({
    title: 'OpenE2EE — Engineering journal',
    description:
      'Writing about JavaScript cryptography, protocol implementation, interoperability, and building encrypted applications.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedAt,
      link: `/blog/${post.id}/`,
      author: post.data.author,
      categories: post.data.tags,
    })),
    customData: '<language>en-us</language>',
  });
}
