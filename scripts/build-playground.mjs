/*
 * Builds /playground from `playground/`, the browser example that this
 * website owns.
 *
 *   node scripts/build-playground.mjs
 *
 * Vite bundles the example against the installed SDK and this site's page
 * relay into `public/playground/`. The page markup goes to
 * `build-artifacts/playground.json`, which `src/pages/playground.astro` renders
 * inside the site layout, so the bundle's own `index.html` is deleted.
 */
import { readFileSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const site = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve('@open-e2ee/signal-protocol-sdk/package.json')), 'utf8'),
);
const source = resolve(site, 'playground');
const output = resolve(site, 'public/playground');
const vite = fileURLToPath(new URL('./bin/vite.js', import.meta.resolve('vite/package.json')));
const result = spawnSync(process.execPath, [vite, 'build', source, '--outDir', output, '--base', '/playground/', '--emptyOutDir'], {
  cwd: site,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

const html = readFileSync(join(output, 'index.html'), 'utf8');
const main = html.match(/<main id="sdk-example">([\s\S]*?)<\/main>/);
if (!main) throw new Error('The playground must expose one main element with id sdk-example.');
const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1]);
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
if (styles.length !== 1 || scripts.length !== 1) throw new Error('The playground must emit one stylesheet and one entry script.');
const generated = join(site, 'build-artifacts');
mkdirSync(generated, { recursive: true });
writeFileSync(join(generated, 'playground.json'), JSON.stringify({ markup: main[1], styles, scripts }) + '\n');
unlinkSync(join(output, 'index.html'));

console.log(`Built the playground against ${manifest.name}@${manifest.version}.`);
