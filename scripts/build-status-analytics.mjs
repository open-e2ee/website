import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
await build({
  configFile: false,
  publicDir: false,
  root,
  build: {
    outDir: 'public/analytics',
    emptyOutDir: true,
    assetsInlineLimit: 0,
    lib: {
      entry: fileURLToPath(new URL('../src/lib/analytics/status.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'status-v1.js',
    },
    rollupOptions: { output: { chunkFileNames: 'status-v1/[name]-[hash].js' } },
  },
});
