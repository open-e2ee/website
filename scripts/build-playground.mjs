import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const site = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = fileURLToPath(import.meta.resolve('@open-e2ee/signal-protocol-sdk/package.json'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const source = join(dirname(manifestPath), 'examples/browser');
const output = resolve(site, 'public/playground');
const vite = fileURLToPath(new URL('./bin/vite.js', import.meta.resolve('vite/package.json')));
const result = spawnSync(process.execPath, [vite, 'build', source, '--outDir', output, '--base', '/playground/', '--emptyOutDir'], {
  cwd: site,
  stdio: 'inherit',
});
if (result.status !== 0) process.exit(result.status ?? 1);

const html = readFileSync(join(output, 'index.html'), 'utf8');
const main = html.match(/<main id="sdk-example">([\s\S]*?)<\/main>/);
if (!main) throw new Error('The SDK example must expose one main element with id sdk-example.');
const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((match) => match[1]);
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]);
if (styles.length !== 1 || scripts.length !== 1) throw new Error('The SDK example must emit one stylesheet and one entry script.');
const generated = join(site, 'build-artifacts');
mkdirSync(generated, { recursive: true });
writeFileSync(join(generated, 'playground.json'), JSON.stringify({ markup: main[1], styles, scripts }) + '\n');
unlinkSync(join(output, 'index.html'));

const files = ['index.html' , 'vite.config.ts', ...readdirSync(join(source, 'src')).sort().map((file) => `src/${file}`)];
const sha256 = Object.fromEntries(files.map((file) => [file, createHash('sha256').update(readFileSync(join(source, file))).digest('hex')]));
writeFileSync(join(output, 'source.json'), JSON.stringify({
  package: manifest.name,
  version: manifest.version,
  source: `https://github.com/open-e2ee/signal-protocol-js/tree/v${manifest.version}/examples/browser`,
  sha256,
}, null, 2) + '\n');
console.log(`Built the public browser example from ${manifest.name}@${manifest.version}.`);
