import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import basicSsl from '@vitejs/plugin-basic-ssl';
import externalLinks from './scripts/external-links.mjs';
import { codeThemes } from './src/lib/code-theme.mjs';

export default defineConfig({
  site: 'https://open-e2ee.dev',
  output: 'static',
  vite: {
    build: {
      // The CSP is script-src 'self' with no 'unsafe-inline': every component
      // script must be emitted as an external file, never inlined into HTML.
      assetsInlineLimit: 0,
    },
    /* DEV_SSL=1 serves `astro dev` over https with a self-signed cert, for
       testing from other devices on the LAN: a `http://192.168.x.x` origin is
       not a secure context, so `crypto.subtle` does not exist there and the
       SDK cannot encrypt. Opt-in because the cert is untrusted (one browser
       warning per device) and plain-http localhost covers everything else. */
    plugins: process.env.DEV_SSL ? [basicSsl()] : [],
  },
  /* externalLinks runs last: it rewrites emitted HTML, so it has to see the
     output every other integration has finished producing. */
  integrations: [mdx(), react(), sitemap(), externalLinks()],
  /* The same themes and the same switch as the hand-placed `<Code>` blocks on
     the landing page and /product — see `src/lib/code-theme.mjs`. `themes` is
     spread rather than restated so the two can never drift apart.

     `defaultColor: false` is what makes the switch work. Without it Shiki
     picks the light palette at build time and writes it as a literal color,
     which is why every blog code block rendered dark-on-white inside a
     near-black page: there was no `--shiki-dark` for the theme class to
     choose. With it, both palettes ship as custom properties and `global.css`
     decides. */
  markdown: {
    shikiConfig: {
      themes: { ...codeThemes },
      defaultColor: false,
    },
  },
});
