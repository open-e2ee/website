/*
 * The relay, drawn one way.
 *
 * Five drawings in `src/components/diagrams/` showed a relay, and they showed it
 * four different ways: a bare outlined rectangle holding two sheared slabs and
 * no metadata ticks, a pair of brackets at one size, a pair of brackets at
 * another, and an outlined store with hand-rolled ticks. A reader who meets
 * three of them across two articles has no way to know they are the same thing.
 *
 * `DESIGN.md` under *Two relay forms* settles which form each drawing owes. The
 * brackets are the org mark's own construction, so they claim the node is
 * OpenE2EE's: they belong on the product page and nowhere else. Every diagram
 * here is a diagram of the reader's architecture, and the node in the middle of
 * it is the reader's to point at. That form is the unbranded container, and
 * `DESIGN.md` gives it three marks that make it a relay rather than a device:
 *
 *   1. no content bars, in any state — the one claim this form exists to deny;
 *   2. metadata ticks on every slab it holds — what the relay can still see;
 *   3. no filled key glyph inside it, ever.
 *
 * This module is the only place any of the three is drawn, so a diagram cannot
 * express the form and get one of them wrong. Everything it emits comes from
 * `@open-e2ee/design/diagram`; nothing here is a shape the grammar does not
 * already have.
 *
 * `DESIGN.md` names a fourth mark, a trust boundary on each side, which
 * separates a third party from the far end of a trip. That one is a property of
 * the drawing around the form rather than of the form, so it stays with the
 * drawing: `WhereWorkMoves` and `WhoHoldsPlaintext` stand the relay between two
 * gutters, and `WhereQueriesRun` and `ExpoKeyMap` draw it as the far end, which
 * `DESIGN.md` describes as the other legible state rather than as a defect.
 */

import {
  BOUNDARY_STROKE,
  CIPHERTEXT_FILL,
  PLAINTEXT_STROKE,
  STROKE_WIDTH,
  TICK_LENGTH,
  metadataTicks,
  slabPath,
} from '@open-e2ee/design/diagram';

/** Canvas between the container edge and the cargo it holds. */
export const RELAY_PADDING = 24;

/** Canvas between one sealed slab and the next. */
export const RELAY_SLAB_GAP = 18;

/** The tick run is shorter than the grammar's default so three of them fit
    inside a slab narrow enough to stand three-across in a 220-unit store. */
export const RELAY_TICK_SPACING = 14;

/** Room above the cargo for the tick run, and below it for the container edge. */
const HEAD_ROOM = TICK_LENGTH + 32;
const FOOT_ROOM = 22;

const round = (value) => Math.round(value * 1000) / 1000;

function check(condition, message) {
  if (!condition) throw new TypeError(message);
}

/**
 * The unbranded relay: an open container holding sealed slabs, each carrying its
 * own metadata ticks. No content bars and no key, ever — those are the two
 * claims the form is drawn to deny.
 *
 * `cargoX` and `cargoWidth` narrow the region the slabs stand in, for a
 * container that also holds something the caller draws itself. The container
 * itself is unchanged by them, which is the point: one form, one construction.
 *
 * @param {{ x: number, y: number, width: number, height: number, slabs?: number,
 *   ticks?: number, cargoX?: number | null, cargoWidth?: number | null }} options
 */
export function relayContainer({
  x,
  y,
  width,
  height,
  slabs = 2,
  ticks = 3,
  cargoX = null,
  cargoWidth = null,
}) {
  check(width > 0 && height > 0, 'A relay needs a positive width and height.');
  check(slabs >= 1, 'A relay with nothing in it is drawn as the empty container.');
  check(
    height > HEAD_ROOM + FOOT_ROOM,
    'A relay shorter than its tick run and its cargo has no interior.',
  );

  const left = cargoX === null ? x + RELAY_PADDING : cargoX;
  const span = cargoWidth === null ? width - RELAY_PADDING * 2 : cargoWidth;
  const slabWidth = (span - (slabs - 1) * RELAY_SLAB_GAP) / slabs;
  const tickRun = (ticks - 1) * RELAY_TICK_SPACING;
  check(
    slabWidth >= tickRun + 12,
    `A ${round(slabWidth)}-unit slab cannot carry ${ticks} ticks; widen the relay or hold fewer.`,
  );

  const top = y + HEAD_ROOM;
  const cargoHeight = height - HEAD_ROOM - FOOT_ROOM;

  const parts = [
    `<rect x="${round(x)}" y="${round(y)}" width="${round(width)}" height="${round(height)}" ` +
      `fill="none" stroke="${PLAINTEXT_STROKE}" stroke-width="${STROKE_WIDTH}"/>`,
  ];

  for (let index = 0; index < slabs; index += 1) {
    const slabX = left + index * (slabWidth + RELAY_SLAB_GAP);
    parts.push(
      metadataTicks({
        x: slabX + (slabWidth - tickRun) / 2,
        y: top,
        count: ticks,
        spacing: RELAY_TICK_SPACING,
        fill: BOUNDARY_STROKE,
      }),
    );
    parts.push(
      `<path d="${slabPath({ x: slabX, y: top, width: slabWidth, height: cargoHeight })}" ` +
        `fill="${CIPHERTEXT_FILL}"/>`,
    );
  }

  return parts.join('\n');
}

/**
 * A shaft and a head, pointing right or up.
 *
 * Drawn as rectangles rather than as a stroked line so the shaft has a box, and
 * a box is what `scripts/measure-diagram-geometry.mjs` and
 * `tests/diagram-geometry.test.mjs` read to decide what the arrow reaches. An
 * arrow that no measurement can see is an arrow that can point anywhere.
 */
export function arrow({ x, y, length, direction = 'right', head = 12, thickness = 2 }) {
  check(length > 0, 'An arrow needs a positive length.');
  check(direction === 'right' || direction === 'up', "An arrow points 'right' or 'up'.");
  const fill = 'var(--oe-diagram-carrier-stroke)';
  if (direction === 'right') {
    return (
      `<rect x="${round(x)}" y="${round(y - thickness / 2)}" width="${round(length)}" ` +
      `height="${round(thickness)}" fill="${fill}"/>` +
      `<path d="M${round(x + length)} ${round(y - head / 2 - 1)} L${round(x + length + head)} ` +
      `${round(y)} L${round(x + length)} ${round(y + head / 2 + 1)} Z" fill="${fill}"/>`
    );
  }
  return (
    `<rect x="${round(x - thickness / 2)}" y="${round(y - length)}" width="${round(thickness)}" ` +
    `height="${round(length)}" fill="${fill}"/>` +
    `<path d="M${round(x - head / 2 - 1)} ${round(y - length)} L${round(x)} ` +
    `${round(y - length - head)} L${round(x + head / 2 + 1)} ${round(y - length)} Z" fill="${fill}"/>`
  );
}
