#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

const modes = {
  light: {
    background: '#F6F8FC',
    shieldLeft: '#284D79',
    shieldRight: '#19365F',
    outline: '#0B1D36',
    accent: '#4C78D0',
    ink: '#FFFFFF',
    label: '#10233F',
  },
  dark: {
    background: '#070B13',
    shieldLeft: '#FFFFFF',
    shieldRight: '#EEF2F7',
    outline: '#D8E2F5',
    accent: '#5C82D4',
    ink: '#142D52',
    label: '#F7F9FC',
  },
};

const shieldPath =
  'M256 36C305 61 355 74 420 79V238C420 340 355 418 256 470C157 418 92 340 92 238V79C157 74 207 61 256 36Z';

// Geometric O and E letterforms for OpenE2EE. They are paths, not text, so
// the mark has no runtime font dependency.
const oGlyphPath = 'M148 174H244V338H148ZM174 199V313H218V199Z';
const eGlyphPath = 'M270 174H370V199H298V240H360V265H298V313H370V338H270Z';

function logoMarkup(colors, { small = false, idSuffix = '' } = {}) {
  const rightHalfId = `shield-right-half${idSuffix}`;
  return `
  <defs>
    <clipPath id="${rightHalfId}">
      <rect x="256" width="256" height="512"/>
    </clipPath>
  </defs>
  <g>
    <path d="${shieldPath}" fill="${colors.shieldLeft}"/>
    <path d="${shieldPath}" fill="${colors.shieldRight}" clip-path="url(#${rightHalfId})"/>
    <path d="${shieldPath}" fill="none" stroke="${small ? colors.accent : colors.outline}" stroke-width="${small ? 10 : 14}" stroke-linejoin="round"/>
    ${small ? '' : `<path d="${shieldPath}" fill="none" stroke="${colors.accent}" stroke-width="4" stroke-linejoin="round"/>`}
    <path d="${oGlyphPath}" fill="${colors.ink}" fill-rule="evenodd"/>
    <path d="${eGlyphPath}" fill="${colors.ink}"/>
  </g>`;
}

function standaloneSvg(mode, colors, { small = false } = {}) {
  const sizeLabel = small ? 'small-size ' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">OpenE2EE ${sizeLabel}shield logo — ${mode} mode</title>
  <desc id="desc">A split-color shield containing aligned O and E letterforms.</desc>
  <metadata>Mode: ${mode}; small-size: ${small}; intended background: ${colors.background}; no gradients; no font dependency.</metadata>${logoMarkup(colors, { small })}
</svg>
`;
}

function adaptiveSvg({ small = false } = {}) {
  const light = modes.light;
  const dark = modes.dark;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">Adaptive OpenE2EE ${small ? 'small-size ' : ''}shield logo</title>
  <desc id="desc">A split-color shield containing aligned O and E letterforms. Colors adapt to light or dark mode.</desc>
  <style>
    :root { --shield-left: ${light.shieldLeft}; --shield-right: ${light.shieldRight}; --outline: ${light.outline}; --accent: ${light.accent}; --ink: ${light.ink}; }
    @media (prefers-color-scheme: dark) {
      :root { --shield-left: ${dark.shieldLeft}; --shield-right: ${dark.shieldRight}; --outline: ${dark.outline}; --accent: ${dark.accent}; --ink: ${dark.ink}; }
    }
  </style>
  ${logoMarkup({ shieldLeft: 'var(--shield-left)', shieldRight: 'var(--shield-right)', outline: 'var(--outline)', accent: 'var(--accent)', ink: 'var(--ink)' }, { small, idSuffix: '-adaptive' })}
</svg>
`;
}

function modeSheetSvg() {
  const width = 1240;
  const height = 680;
  const cards = Object.entries(modes).map(([mode, colors], index) => {
    const x = 40 + index * 600;
    return `
  <g transform="translate(${x} 40)">
    <rect width="560" height="600" rx="42" fill="${colors.background}"/>
    <g transform="translate(82 42) scale(0.77)">${logoMarkup(colors, { idSuffix: `-${mode}` })}</g>
    <text x="36" y="558" fill="${colors.label}" font-family="JetBrains Mono, IBM Plex Mono, SFMono-Regular, Consolas, monospace" font-size="22" font-weight="700" letter-spacing="1.5">${mode.toUpperCase()} MODE</text>
  </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">OpenE2EE developer shield logo</title>
  <desc id="desc">Solid-color light and dark mode variants.</desc>
  <rect width="${width}" height="${height}" fill="#111418"/>${cards.join('')}
</svg>
`;
}

mkdirSync(join(root, 'svg'), { recursive: true });
mkdirSync(join(root, 'png'), { recursive: true });

for (const [mode, colors] of Object.entries(modes)) {
  const basename = `open-e2ee-shield-${mode}`;
  const svgPath = join(root, 'svg', `${basename}.svg`);
  writeFileSync(svgPath, standaloneSvg(mode, colors));
  const smallSvgPath = join(root, 'svg', `${basename}-small.svg`);
  writeFileSync(smallSvgPath, standaloneSvg(mode, colors, { small: true }));

  for (const size of [32, 64, 128, 512, 1024]) {
    const outputDir = join(root, 'png', String(size));
    mkdirSync(outputDir, { recursive: true });
    execFileSync('rsvg-convert', [
      '--width',
      String(size),
      '--height',
      String(size),
      '--output',
      join(outputDir, `${basename}.png`),
      size <= 64 ? smallSvgPath : svgPath,
    ]);
  }

}

writeFileSync(join(root, 'open-e2ee-shield-adaptive.svg'), adaptiveSvg());
writeFileSync(join(root, 'open-e2ee-shield-adaptive-small.svg'), adaptiveSvg({ small: true }));
writeFileSync(join(root, 'open-e2ee-shield-mode-sheet.svg'), modeSheetSvg());
execFileSync('rsvg-convert', [
  '--width',
  '1440',
  '--output',
  join(root, 'open-e2ee-shield-mode-sheet.png'),
  join(root, 'open-e2ee-shield-mode-sheet.svg'),
]);
console.log('Generated 6 SVG logo files, a mode sheet, and 10 PNG exports.');
