/*
 * Per-article social cards.
 *
 * Every published article's frontmatter points at /social/blog/<slug>.png,
 * so each article needs a card of its own or it falls back to the site-wide one
 * and every share of every article looks identical.
 *
 * The cards are drawn in @open-e2ee/design's social-card system: the same
 * canvas, the same manifest plate, the same carrier drawn whole with both
 * brackets on the canvas. The design package exports the diagram grammar and
 * the tokens but not the card template itself, so the template is reproduced
 * here — and then held to the original by `assertTemplateParity`, which redraws
 * one of the design repository's own cards from its own source and compares it
 * byte for byte with the file the package ships. If the design system's card
 * changes, that check fails here before a blog card is written in the old
 * shape.
 *
 *   node scripts/generate-blog-cards.mjs           write SVG + PNG
 *   node scripts/generate-blog-cards.mjs --check    verify what is committed
 *
 * `--check` re-renders and compares, so it needs no rasterizer and runs in the
 * build. Writing PNGs needs rsvg-convert, the same rasterizer the design
 * repository uses; the output is committed, as the site's other public assets
 * are, so neither a deploy nor a checkout has to have that binary.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TICK_GAP,
  TICK_LENGTH,
  carrierBrackets,
  metadataTicks,
  slabPath,
} from '@open-e2ee/design/diagram';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const blogSource = join(websiteRoot, 'src', 'content', 'blog');
/*
 * Not under public/brand. That directory is a mirror of @open-e2ee/design,
 * locked to a digest by `oe-design check` and deleted wholesale by
 * `oe-design export` on every `npm run dev`. A card written there would fail
 * the build and then quietly disappear. These cards are the website's own.
 */
const cardDirectory = join(websiteRoot, 'public', 'social', 'blog');
const cardPath = (slug) => `/social/blog/${slug}.png`;
const checkOnly = process.argv.includes('--check');

/*
 * The design package publishes its tokens and its diagram grammar. The font
 * metrics and the measuring functions are not in its `exports`; they are
 * reachable only because the dependency is installed from the repository
 * tarball. Nothing may be guessed if that stops being true — a card laid out
 * with an approximated ruler would collide silently — so the read is guarded.
 */
const designRoot = new URL('../../../', import.meta.resolve('@open-e2ee/design/tokens'));
const designInternal = (path) => {
  const url = new URL(path, designRoot);
  if (!existsSync(url)) {
    throw new Error(
      `@open-e2ee/design does not carry ${path}. Blog cards are laid out with the design system's own font metrics and measuring functions, which ship only in the repository tarball this project installs. Install @open-e2ee/design from its GitHub tarball, or move the card template into the design repository.`,
    );
  }
  return url;
};

const readJsonFile = async (url) => JSON.parse(await readFile(url, 'utf8'));

const tokens = await readJsonFile(new URL('packages/design/dist/tokens.json', designRoot));
const typeMetrics = await readJsonFile(designInternal('brand/source/public-sans-metrics.json'));
const { monoWidth, textWidth } = await import(designInternal('scripts/lib.mjs').href);

const light = tokens.semantic.light;
const geometry = tokens.geometry;

/* Font stacks quote family names; SVG attributes are already double-quoted. */
const svgFont = (stack) => stack.replaceAll('"', "'");
const sansStack = svgFont(tokens.primitives.font.sans);
const monoStack = svgFont(tokens.primitives.font.mono);

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const round2 = (value) => Number(value.toFixed(2));
const descenderRatio = typeMetrics.descender / typeMetrics.unitsPerEm;

const measure = (text, options) =>
  options.mono === true
    ? monoWidth(text, options.size)
    : textWidth(typeMetrics, text, options);

/*
 * Generated SVG has no layout engine behind it, so every string drawn is
 * measured against the box drawn for it. A title that would run under the
 * manifest plate fails the build instead of shipping.
 */
function fitText(text, options, limit, context) {
  const width = measure(text, options);
  if (width > limit) {
    throw new Error(
      `${context}: ${JSON.stringify(text)} measures ${width.toFixed(1)} px, ${(width - limit).toFixed(1)} px past its ${limit} px box.`,
    );
  }
  return width;
}

/* Geometry of the 1280x640 card, as @open-e2ee/design lays it out. */
export const CARD = {
  width: 1280,
  height: 640,
  /* Carrier: 800..1240, so the right bracket sits 40 px inside the canvas. */
  carrier: { x: 800, y: 104, width: 440, height: 432, thickness: 24, arm: 88 },
  parcelX: 856,
  columnX: 88,
  columnWidth: 692,
  parcels: [
    { y: 150, width: 264, height: 64, ticks: 7 },
    { y: 268, width: 330, height: 88, ticks: 9 },
    { y: 412, width: 215, height: 56, ticks: 6 },
  ],
  transit: { x: 692, y: 440, width: 76, height: 116, shear: 12, ticks: 4 },
  labelGutter: 16,
  labelBaselineOffset: 24,
  labelSize: 15,
  wordmarkBaseline: 166,
  wordmarkSize: 85,
  descriptionSize: 28,
  descriptionLeading: 40,
  footerBaseline: 556,
};

/* Labels stop a gutter short of the right bracket's inner face. */
const LABEL_LIMIT =
  CARD.carrier.x +
  CARD.carrier.width -
  CARD.carrier.thickness -
  CARD.labelGutter -
  CARD.parcelX;

const markMarkup = (fill, indent) =>
  [geometry.full.carrierLeftPath, geometry.full.carrierRightPath, geometry.full.payloadPath]
    .map((path) => `${indent}<path d="${path}" fill="${fill}"/>`)
    .join('\n');

/*
 * The card, for a subject that speaks for the org rather than a product: mark
 * and wordmark, a rule, a description block, a mono footer, and the manifest
 * plate on the right. Blog cards never carry a product line, so the template
 * implements only the path they use.
 */
export function socialSvg({ title, description, plateRows, footer }) {
  const plate = CARD.parcels
    .map((parcel, index) => {
      const row = plateRows[index];
      fitText(row, { size: CARD.labelSize, mono: true }, LABEL_LIMIT, `${title} plate row ${index + 1}`);
      return `
    <path d="${slabPath({ x: CARD.parcelX, y: parcel.y, width: parcel.width, height: parcel.height })}" fill="${light['diagram-ciphertext-fill']}"/>
    ${metadataTicks({ x: CARD.parcelX + 4, y: parcel.y, count: parcel.ticks, fill: light['diagram-boundary'] })}
    <text x="${CARD.parcelX}" y="${parcel.y + parcel.height + CARD.labelBaselineOffset}" fill="${light.subtle}" font-family="${monoStack}" font-size="${CARD.labelSize}">${escapeXml(row)}</text>`;
    })
    .join('');

  const ruleY = 240;
  const descriptionTop = ruleY + 60;

  const descriptionLines = description
    .map((line, index) => {
      fitText(line, { size: CARD.descriptionSize }, CARD.columnWidth, `${title} description line ${index + 1}`);
      return `
  <text x="${CARD.columnX}" y="${descriptionTop + index * CARD.descriptionLeading}" fill="${light.muted}" font-family="${sansStack}" font-size="${CARD.descriptionSize}" font-weight="500">${escapeXml(line)}</text>`;
    })
    .join('');

  /*
   * The description block runs down the card towards the in-transit envelope.
   * Its ticks are the first thing it would touch, and they are drawn above the
   * envelope, so the clearance is measured to them and not to the envelope.
   */
  const descriptionBottom =
    descriptionTop +
    (description.length - 1) * CARD.descriptionLeading +
    descenderRatio * CARD.descriptionSize;
  const transitTickTop = CARD.transit.y - TICK_LENGTH - TICK_GAP;
  if (descriptionBottom > transitTickTop) {
    throw new Error(
      `${title}: the description block reaches ${descriptionBottom.toFixed(1)} px, into the in-transit envelope's metadata ticks at ${transitTickTop} px.`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(title)}</title>
  <desc id="desc">The OpenE2EE mark and wordmark beside a manifest plate: two open carrier brackets holding three opaque parcels, each marked with brass metadata ticks, with a fourth parcel in transit outside the carrier.</desc>
  <rect width="${CARD.width}" height="${CARD.height}" fill="${light.canvas}"/>
  <g>
    ${carrierBrackets({ ...CARD.carrier, fill: light['diagram-carrier-stroke'] }).replaceAll('\n', '\n    ')}
    <path d="${slabPath(CARD.transit)}" fill="${light['diagram-ciphertext-fill']}"/>
    ${metadataTicks({ x: CARD.transit.x + 16, y: CARD.transit.y, count: CARD.transit.ticks, fill: light['diagram-boundary'] })}${plate}
  </g>
  <g transform="translate(88 88) scale(0.1875)">
${markMarkup(light.foreground, '    ')}
  </g>
  <text x="220" y="${CARD.wordmarkBaseline}" fill="${light.foreground}" font-family="${sansStack}" font-size="${CARD.wordmarkSize}">
    <tspan font-weight="500" letter-spacing="-0.85">Open</tspan><tspan font-weight="800" letter-spacing="-1.28">E2EE</tspan>
  </text>
  <rect x="${CARD.columnX}" y="${round2(ruleY)}" width="${CARD.columnWidth}" height="1" fill="${light.border}"/>${descriptionLines}
  <text x="${CARD.columnX}" y="${CARD.footerBaseline}" fill="${light.subtle}" font-family="${monoStack}" font-size="19">${escapeXml(footer)}</text>
</svg>
`;
}

/*
 * The template above is a copy, and a copy can drift from what it copied.
 * Redraw a card the design repository ships — one with no product line, so it
 * exercises this template's whole path — from that repository's own source, and
 * hold it to the file the package publishes.
 */
export async function assertTemplateParity() {
  const source = await readJsonFile(designInternal('brand/source/social-cards.json'));
  /* The design build fills {version} and friends from its own repository, which
   * this one cannot see, so the reference has to be a card without them. */
  const reference = source.cards.find(
    (card) =>
      !card.product &&
      ![...card.description, ...card.plateRows, card.footer].some((copy) => copy.includes('{')),
  );
  if (!reference) {
    throw new Error(
      'No product-free card without substitutions in @open-e2ee/design’s social-cards.json to check this template against.',
    );
  }

  const published = await readFile(
    new URL(`packages/design/dist/assets/social/${reference.slug}.svg`, designRoot),
    'utf8',
  );
  const redrawn = socialSvg({
    title: reference.title,
    description: reference.description,
    plateRows: reference.plateRows,
    footer: reference.footer,
  });

  if (redrawn !== published) {
    throw new Error(
      `The blog card template no longer draws @open-e2ee/design’s ${reference.slug} card the way the package ships it. The design system’s social card has changed; update CARD and socialSvg in ${basename(fileURLToPath(import.meta.url))} to match it.`,
    );
  }
  return reference.slug;
}

/*
 * Frontmatter. Only the fields the card draws are read, and each is required to
 * be the shape the card needs, because a card is generated once and then looked
 * at by nobody until it is on somebody else's timeline.
 */
function readFrontmatter(text, file) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`${file}: no frontmatter block.`);

  const fields = {};
  let listKey = null;
  for (const raw of match[1].split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;

    const item = raw.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      fields[listKey].push(unquote(item[1]));
      continue;
    }

    const entry = raw.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!entry) throw new Error(`${file}: cannot read frontmatter line ${JSON.stringify(raw)}.`);
    const [, key, value] = entry;
    if (value.trim() === '') {
      listKey = key;
      fields[key] = [];
    } else {
      listKey = null;
      fields[key] = unquote(value);
    }
  }
  return fields;
}

const unquote = (value) => {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])([\s\S]*)\1$/);
  return quoted ? quoted[2].replaceAll(`${quoted[1]}${quoted[1]}`, quoted[1]) : trimmed;
};

/*
 * The title is the only copy on the card that changes per article, and it is
 * long-form English rather than a fitted phrase, so it wraps. Greedy, on word
 * boundaries, measured with the same metrics the card is drawn with; a line
 * that still will not fit, or a fourth line, is a failure and not a squeeze.
 */
export function wrapTitle(title, limit = CARD.columnWidth) {
  const lines = [];
  let current = '';
  for (const word of title.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate, { size: CARD.descriptionSize }) > limit) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/*
 * Plate rows are annotations on drawn parcels, and DESIGN.md requires every one
 * of them to be true of what the card describes. These three are the article's
 * own frontmatter, read back: the date it was published, what it is about, and
 * who wrote it. Nothing here is computed about the article's contents, because
 * the build cannot check a claim about prose.
 */
function plateRowsFor(fields, file) {
  const published = String(fields.publishedAt ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) {
    throw new Error(`${file}: publishedAt must be a YYYY-MM-DD date, not ${JSON.stringify(published)}.`);
  }

  const tags = (fields.tags ?? []).map((tag) => tag.toLowerCase());
  if (tags.length === 0) throw new Error(`${file}: needs at least one tag for the card's plate.`);

  /* As many whole tags as the label box holds, in the order the article lists
   * them. The first one has to fit on its own or the plate has no subject. */
  let topics = tags[0];
  fitText(topics, { size: CARD.labelSize, mono: true }, LABEL_LIMIT, `${file} first tag`);
  for (const tag of tags.slice(1)) {
    const candidate = `${topics} · ${tag}`;
    if (measure(candidate, { size: CARD.labelSize, mono: true }) > LABEL_LIMIT) break;
    topics = candidate;
  }

  const author = String(fields.author ?? '').trim();
  if (!author) throw new Error(`${file}: needs an author for the card's plate.`);

  return [`published · ${published}`, topics, `author · ${author}`];
}

export async function articles() {
  const files = (await readdir(blogSource)).filter((name) => name.endsWith('.mdx')).sort();
  const posts = [];
  for (const name of files) {
    const file = join(blogSource, name);
    const fields = readFrontmatter(await readFile(file, 'utf8'), name);
    /* Drafts are not built, so a card for one would be an unreferenced file. */
    if (String(fields.draft) === 'true') continue;

    const slug = name.replace(/\.mdx$/, '');
    const expected = cardPath(slug);
    if (fields.image !== expected) {
      throw new Error(
        `${name}: frontmatter image is ${JSON.stringify(fields.image)}, but this script writes ${expected}. Point the article at its own card or rename the file.`,
      );
    }
    if (!fields.title) throw new Error(`${name}: needs a title.`);

    posts.push({
      slug,
      name,
      title: fields.title,
      svg: socialSvg({
        title: fields.title,
        description: wrapTitle(fields.title),
        plateRows: plateRowsFor(fields, name),
        footer: 'open-e2ee.dev/blog',
      }),
    });
  }
  if (posts.length === 0) throw new Error(`No published articles found in ${blogSource}.`);
  return posts;
}

/* PNG header: 8-byte signature, then the IHDR length and tag, then the size. */
function pngSize(bytes) {
  if (bytes.length < 24 || bytes.readUInt32BE(12) !== 0x49484452) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}


/* Re-render every card and compare with what is committed. Comparison is on the
 * SVG, which this file produces byte for byte; the PNG is checked for existence
 * and size only, because it comes from a rasterizer whose output may legitimately
 * differ between versions. */
async function check(posts, reference) {
  const problems = [];
  for (const post of posts) {
    const svgPath = join(cardDirectory, `${post.slug}.svg`);
    const pngPath = join(cardDirectory, `${post.slug}.png`);

    if (!existsSync(svgPath)) {
      problems.push(`${post.slug}.svg is missing`);
    } else if ((await readFile(svgPath, 'utf8')) !== post.svg) {
      problems.push(
        `${post.slug}.svg is stale — the article or the design system has changed since it was drawn`,
      );
    }

    if (!existsSync(pngPath)) {
      problems.push(`${post.slug}.png is missing`);
    } else {
      const size = pngSize(await readFile(pngPath));
      if (!size) {
        problems.push(`${post.slug}.png is not a PNG`);
      } else if (size.width !== CARD.width || size.height !== CARD.height) {
        problems.push(
          `${post.slug}.png is ${size.width}x${size.height}, not ${CARD.width}x${CARD.height}`,
        );
      }
    }
  }

  /* A card left behind by a renamed, deleted, or drafted article is a file the
   * site publishes and nothing points at. */
  const kept = new Set(posts.flatMap((post) => [`${post.slug}.svg`, `${post.slug}.png`]));
  if (existsSync(cardDirectory)) {
    for (const name of await readdir(cardDirectory)) {
      if (!kept.has(name)) problems.push(`${name} belongs to no published article`);
    }
  }

  if (problems.length > 0) {
    console.error(`Blog social cards are out of date (${problems.length}):`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error('Run `npm run blog:cards` and commit the result.');
    process.exitCode = 1;
    return;
  }
  console.log(
    `Blog social cards up to date: ${posts.length} articles, template matches @open-e2ee/design ${reference}.`,
  );
}

async function write(posts) {
  await mkdir(cardDirectory, { recursive: true });
  for (const post of posts) {
    const svgPath = join(cardDirectory, `${post.slug}.svg`);
    const pngPath = join(cardDirectory, `${post.slug}.png`);
    await writeFile(svgPath, post.svg);
    execFileSync('rsvg-convert', [
      '--width',
      String(CARD.width),
      '--height',
      String(CARD.height),
      '--output',
      pngPath,
      svgPath,
    ]);
    console.log(`${post.slug} — ${post.title}`);
  }
  console.log(`Wrote ${posts.length} blog social cards to ${cardDirectory}.`);
}

/* The test suite imports the template and its guards; only the command line
 * reads the articles and touches files. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reference = await assertTemplateParity();
  const posts = await articles();
  await (checkOnly ? check(posts, reference) : write(posts));
}
