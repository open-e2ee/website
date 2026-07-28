/*
 * Blog social cards.
 *
 * The cards are drawn with no layout engine behind them, so the generator
 * measures every string against the box it draws it in. These tests hold the
 * two things that would otherwise only be noticed on somebody else's timeline:
 * that a title too long for the card fails rather than running under the
 * manifest plate, and that the committed cards match the articles that
 * reference them.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CARD,
  articles,
  assertTemplateParity,
  socialSvg,
  wrapTitle,
} from '../scripts/generate-blog-cards.mjs';

const cardDirectory = fileURLToPath(new URL('../public/social/blog/', import.meta.url));

const card = (title) =>
  socialSvg({
    title,
    description: wrapTitle(title),
    plateRows: ['published · 2026-07-25', 'architecture', 'author · OpenE2EE'],
    footer: 'open-e2ee.dev/blog',
  });

test('draws the design system’s own card exactly as the package ships it', async () => {
  /* The template is a copy of @open-e2ee/design's. This is what stops the copy
   * from drifting: it redraws one of the design repository's cards from that
   * repository's source and compares bytes. */
  assert.ok(await assertTemplateParity());
});

test('sets a title across as many lines as it needs', () => {
  assert.deepEqual(wrapTitle('TLS is not end-to-end encryption'), [
    'TLS is not end-to-end encryption',
  ]);

  const wrapped = wrapTitle(
    'Every message your relay carries, and what it can still read after you encrypt',
  );
  assert.ok(wrapped.length > 1, 'a title past one line should wrap');
  assert.equal(wrapped.join(' '), 'Every message your relay carries, and what it can still read after you encrypt');
});

test('fails on a title that would run under the manifest plate', () => {
  /* Four lines reach the in-transit envelope's metadata ticks. */
  assert.throws(
    () =>
      card(
        'Everything a server operator can still see about a conversation it relays but cannot read, and every disclosure obligation that follows from holding only ciphertext',
      ),
    /metadata ticks/,
  );

  /* A single word wider than the column cannot be wrapped out of trouble. */
  assert.throws(() => card(`Introducing ${'e'.repeat(80)}`), /past its 692 px box/);
});

test('fails on a plate row that would cross the carrier bracket', () => {
  assert.throws(
    () =>
      socialSvg({
        title: 'TLS is not end-to-end encryption',
        description: ['TLS is not end-to-end encryption'],
        plateRows: ['published · 2026-07-25', 'a'.repeat(60), 'author · OpenE2EE'],
        footer: 'open-e2ee.dev/blog',
      }),
    /past its 344 px box/,
  );
});

test('draws both brackets and the ticks on every parcel', () => {
  const svg = card('TLS is not end-to-end encryption');

  /* The carrier is a pair; one bracket alone is a different mark. */
  const brackets = [...svg.matchAll(/<path d="M(800|1240) 104/g)];
  assert.equal(brackets.length, 2, 'both carrier brackets must stand on the canvas');
  assert.ok(svg.includes('viewBox="0 0 1280 640"'));

  /* Metadata is always drawn: three parcels on the plate and one in transit. */
  const ticks = CARD.parcels.reduce((total, parcel) => total + parcel.ticks, CARD.transit.ticks);
  assert.equal([...svg.matchAll(/<rect x="\d+" y="\d+" width="2" height="10"/g)].length, ticks);

  /* Material law: nothing on the card is translucent or gradient-filled. */
  assert.doesNotMatch(svg, /opacity|gradient|rgba|filter=/i);
});

test('publishes a card for every article that references one', async () => {
  const posts = await articles();
  assert.ok(posts.length >= 3, 'the site should have its published articles');

  const published = new Set(await readdir(cardDirectory));
  for (const post of posts) {
    assert.ok(published.has(`${post.slug}.png`), `${post.slug} has no card`);
    assert.equal(
      await readFile(new URL(`${post.slug}.svg`, `file://${cardDirectory}`), 'utf8'),
      post.svg,
      `${post.slug}.svg is stale; run \`npm run blog:cards\``,
    );

    const png = await readFile(new URL(`${post.slug}.png`, `file://${cardDirectory}`));
    assert.equal(png.readUInt32BE(16), CARD.width);
    assert.equal(png.readUInt32BE(20), CARD.height);
  }

  /* Drafts are not built, so a card for one would be published and unreferenced. */
  const expected = new Set(posts.flatMap((post) => [`${post.slug}.svg`, `${post.slug}.png`]));
  assert.deepEqual([...published].filter((name) => !expected.has(name)), []);
});
