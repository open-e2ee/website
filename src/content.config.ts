import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    author: z.string().default('OpenE2EE'),
    draft: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    /*
     * Share card for this article. Omitted, the site-wide card is used, which
     * is correct but makes four different essays look like one page in a
     * timeline. The build audit warns when a referenced card is not published,
     * rather than failing: the cards are generated in the design repository on
     * its own schedule, so a missing one is a gap to close, not a deploy to
     * block.
     */
    image: z.string().optional(),
  }),
});

export const collections = { blog };
