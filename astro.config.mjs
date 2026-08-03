import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import externalLinks from './scripts/external-links.mjs';

export default defineConfig({
  site: 'https://open-e2ee.dev',
  output: 'static',
  vite: {
    build: {
      // The CSP is script-src 'self' with no 'unsafe-inline': every component
      // script must be emitted as an external file, never inlined into HTML.
      assetsInlineLimit: 0,
    },
  },
  /* externalLinks runs last: it rewrites emitted HTML, so it has to see the
     output every other integration has finished producing. */
  integrations: [mdx(), react(), sitemap(), externalLinks()],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },
});
