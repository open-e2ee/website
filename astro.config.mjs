import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';

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
  integrations: [mdx(), react(), sitemap()],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },
});
