/*
 * The three marks in the closing band's star field, and where each one sits.
 *
 * The composition is one lockup over two sources: `<mark/> OpenE2EE` across the
 * top, the way the site's own header sets it, with the Open Source Initiative
 * keyhole under it on the left and GitHub's on the right. Read together it says
 * what the band's heading says — this is ours, it is open source, and here is
 * where the source is.
 *
 * WHAT THIS COSTS. Two of the three are drawn against a written rule.
 *
 *   Our own lockup  `design/DESIGN.md` held the mark static in every context,
 *                   forever. This band is the one named exception to that rule,
 *                   and the rule now states the exception, its conditions, and
 *                   what yields to it while the field is moving. Read that
 *                   section, not this summary, before changing the composition.
 *   OSI's keyhole   Its trademark licence: never alter or add elements to the
 *                   logo, and never stray from the colour palette. The site's
 *                   answer to "no implied endorsement" has been that the
 *                   keyhole appears once, at text size, never at badge scale.
 *                   All three go here — this instance takes the page's ink.
 *
 * Both were put to the founder in writing with the alternatives, and both were
 * directed anyway. The first is ours to amend and was amended; the second is
 * not, so `OsiMark.astro` records it as a breach rather than dressing it as a
 * policy.
 *
 * What is preserved, because none of it cost anything: every path is imported
 * from the artwork that ships rather than transcribed, and the field settles
 * into that artwork — which is also what a reader with no script, or with
 * reduced motion, sees at all times.
 *
 * GitHub's guidelines ask that its logo not be distorted, rearranged, or given
 * added graphic effects; the same direction and the same mitigations apply, and
 * the band links to GitHub, which is the use those guidelines name first.
 */

import { readFileSync } from 'node:fs';

import { ICON_VIEW_BOX, iconPaths } from '@open-e2ee/design/icons';

import { OSI_EDGE_WIDTH, OSI_PATH, OSI_VIEW_BOX } from './osi-artwork.mjs';

const read = (specifier) => readFileSync(new URL(import.meta.resolve(specifier)), 'utf8');

/*
 * Our lockup comes out of the artwork `oe-design export` writes, not out of a
 * transcription and not out of `carrierBracketPaths` — that primitive rebuilds
 * the geometry from parameters, so using it here would mean choosing the
 * parameters, and a wrong `arm` would be a wrong logo that still drew. Reading
 * the shipped file means the field follows the lockup if the lockup changes.
 *
 * The mono variant is the one that takes a colour from its context. It carries
 * the symbol as three paths inside one transformed group — the two brackets and
 * the payload — and the wordmark as live text, which is what the package ships
 * and says it ships. `DESIGN.md` has a standing TODO to outline it; until that
 * lands, the field rasterises the same text the fallback draws.
 */
const lockupSvg = read('@open-e2ee/design/assets/lockup/open-e2ee-lockup-horizontal-mono.svg');

const lockupViewBox = lockupSvg.match(/viewBox="([^"]+)"/)?.[1];

const symbolGroup = lockupSvg.match(/<g transform="translate\(([\d.-]+) ([\d.-]+)\) scale\(([\d.]+)\)">([\s\S]*?)<\/g>/);
const symbolPaths = symbolGroup ? [...symbolGroup[4].matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]) : [];

const textNode = lockupSvg.match(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*font-family="([^"]+)"[^>]*font-size="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/);
const runs = textNode
  ? [...textNode[5].matchAll(/<tspan font-weight="(\d+)" letter-spacing="([\d.-]+)">([^<]+)<\/tspan>/g)].map(
      (match) => ({ weight: Number(match[1]), tracking: Number(match[2]), text: match[3] }),
    )
  : [];

/*
 * The lockup is a symbol, a wordmark, and nothing else. A file that stopped
 * parsing as that is a file this composition cannot place, and a silently
 * partial lockup — two brackets and no payload, or a mark with no name beside
 * it — would read as a rendering fault rather than as a build one.
 */
if (!lockupViewBox || symbolPaths.length !== 3 || runs.length !== 2) {
  throw new Error(
    'open-e2ee-lockup-horizontal-mono.svg no longer parses as a viewBox, three symbol paths and two wordmark runs '
      + `(got ${symbolPaths.length} paths and ${runs.length} runs)`,
  );
}

const [githubPath] = iconPaths.github;
if (!githubPath) {
  throw new Error('@open-e2ee/design/icons no longer exports a github path');
}

/*
 * Placement. Every mark is laid out in the composition's own units: `width` and
 * a centre line `cx` across, a top edge `y` down. A mark's own artwork keeps
 * its proportions, and `height` gives a row a common box so two marks of
 * different shapes sit level rather than hanging from their own top edges.
 *
 * `DESIGN.md` puts one bracket stem of clear space on every side of the mark,
 * `0.125` of its width. The horizontal lockup already carries that margin — the
 * symbol is 128 units tall inside a 160-unit box — so the floor below it is the
 * lockup's own bottom edge, and the check further down fails the build if a
 * later nudge lifts the sources above it.
 *
 * The sources are smaller than our symbol, not merely smaller than the lockup.
 * The lockup spans the field, so it is the larger thing by construction, but
 * the eye compares one glyph with another: the symbol lands at 17 units and the
 * two below it at 15. They are what the band points at; the lockup is whose
 * band it is, and it should not be the smallest drawing in its own band.
 */
export const FIELD_WIDTH = 100;
export const CARRIER_CLEAR_SPACE = 0.125;

/**
 * A mark is a list of pieces in its artwork's own coordinates, placed as a
 * whole. The two kinds are what the shipped files contain, and nothing here
 * invents a third.
 *
 * @typedef {{ kind: 'paths', paths: string[], translateX?: number, translateY?: number, scale?: number, strokeWidth?: number }} PathPiece
 * @typedef {{ kind: 'text', x: number, baseline: number, fontFamily: string, fontSize: number, runs: { weight: number, tracking: number, text: string }[] }} TextPiece
 * @typedef {PathPiece | TextPiece} Piece
 * @typedef {{ viewBox: string, cx: number, y: number, width: number, height?: number }} Placed
 * @typedef {Placed & { id: string, pieces: Piece[] }} Mark
 */

/** @type {Mark[]} */
export const marks = [
  {
    id: 'lockup',
    viewBox: lockupViewBox,
    pieces: [
      {
        kind: 'paths',
        paths: symbolPaths,
        translateX: Number(symbolGroup[1]),
        translateY: Number(symbolGroup[2]),
        scale: Number(symbolGroup[3]),
      },
      {
        kind: 'text',
        x: Number(textNode[1]),
        baseline: Number(textNode[2]),
        fontFamily: textNode[3],
        fontSize: Number(textNode[4]),
        runs,
      },
    ],
    cx: 50,
    y: 0,
    width: 100,
  },
  {
    id: 'osi',
    viewBox: OSI_VIEW_BOX,
    /* The edge is artwork rather than decoration, so the silhouette is drawn
       filled *and* stroked. It takes the page's ink here like everything else
       in the field, which is the part of OSI's licence this instance breaks. */
    pieces: [{ kind: 'paths', paths: [OSI_PATH], strokeWidth: OSI_EDGE_WIDTH }],
    cx: 35,
    y: 27,
    width: 15,
    height: 15,
  },
  {
    id: 'github',
    viewBox: ICON_VIEW_BOX,
    pieces: [{ kind: 'paths', paths: [githubPath] }],
    cx: 65,
    y: 27,
    width: 15,
    height: 15,
  },
];

/*
 * The transform that puts one mark's own coordinates into composition units.
 * Shared so the fallback artwork and the sampler cannot disagree about where a
 * mark sits — a field that scattered from one placement and settled into
 * another would look like a bug in the physics.
 *
 * @param {Placed} mark
 */
export function placement(mark) {
  const { viewBox, cx, y, width, height } = mark;
  const [minX, minY, boxWidth, boxHeight] = viewBox.split(/[\s,]+/).map(Number);
  const scale = width / boxWidth;
  const drawn = boxHeight * scale;
  const row = height ?? drawn;
  return {
    scale,
    translateX: cx - width / 2 - minX * scale,
    translateY: y + (row - drawn) / 2 - minY * scale,
    height: row,
  };
}

/* The composition is as tall as what it holds, and the stylesheet has to give
   the field a box of exactly that shape or the marks are squashed. The pairing
   is asserted in `tests/site-content.test.mjs`. */
export const FIELD_HEIGHT = Math.max(...marks.map((mark) => mark.y + placement(mark).height));
export const FIELD_VIEW_BOX = `0 0 ${FIELD_WIDTH} ${FIELD_HEIGHT}`;

/* The clear space our lockup is owed, checked against what the composition
   actually leaves it, so a later nudge to either row fails the build instead of
   quietly closing the gap. */
const lockup = marks.find((mark) => mark.id === 'lockup');
const floor = lockup.y + placement(lockup).height;
for (const source of marks.filter((mark) => mark.id !== 'lockup')) {
  if (source.y < floor) {
    throw new Error(`${source.id} enters the lockup's clear space: ${source.y} is above ${floor}`);
  }
}
