/*
 * Where every part of the stage goes, in both of its compositions.
 *
 * The stage is one drawing of three columns — device A, the relay, device B —
 * and it exists twice: wide for a screen that has room to read left to right,
 * and stacked for one that does not. This module holds the coordinates for
 * both. `DemoStage.astro` holds the markup, once, and renders it against each
 * of these in turn.
 *
 * ------------------------------------------------------ why two of them ---
 *
 * `viewBox` is an attribute, not a CSS property, so no media query can reach
 * it. Every scheme that keeps one composition and moves its parts with custom
 * properties ends in client-side geometry, an SVG2 bet, or letterboxing that
 * breaks at 320px. `SignatureDiagram.astro` settled this on the site already:
 * two `<svg>` elements switched by `display` at 48rem, and `global.css` owns
 * the switch.
 *
 * The property that matters about a pair of compositions is not that there is
 * one of them — it is that both make the same promises. `SignatureDiagram`
 * buys that with `<defs>` and `<use>`, and pays for it by laying its text out
 * twice. This stage cannot use that trick: its devices hold real sentences, its
 * stores and columns are named, and the relay prints what it is holding, so
 * most of it is type, and type does not turn with a drawing. So it buys the
 * same property a stronger way —
 * one set of markup, rendered twice against two coordinate tables. A part that
 * only one composition has is not something a reviewer has to notice; it is
 * a key missing from a `Record` and the build stops.
 *
 * -------------------------------------------------- units, and a warning ---
 *
 * Everything here is `viewBox` units and none of it is CSS pixels. The two
 * agree only at 1:1, and neither composition renders at 1:1 — the wide canvas
 * is 1104 units in a slot that is usually narrower, so a unit is a little under
 * a pixel, and the stacked one runs the other way on a small phone. Any number
 * copied out of here into a stylesheet is wrong by the scale factor. Text
 * inside the SVG is in the same units for the same reason: `font-size: 13px`
 * on `.diagram-label` is thirteen units, and it shrinks with the canvas.
 *
 * ------------------------------------------------------------- the rules ---
 *
 * The checks at the bottom of this file are the grammar in `design/DESIGN.md`
 * made into build failures. They are here rather than in a test because a
 * diagram that violates the grammar should not be renderable, and because the
 * numbers they check are the numbers immediately above them — a reader editing
 * a position sees the rule it has to satisfy without leaving the file.
 */

import {
  BOUNDARY_MIN_GUTTER,
  RATCHET_STEPS,
  STROKE_WIDTH,
  TICK_GAP,
  TICK_LENGTH,
  TICK_SPACING,
  TICK_WIDTH,
} from '@open-e2ee/design/diagram';
import type { Actor } from './trace.ts';

/** The two ends. Derived, so a third column is a type error rather than a gap. */
export type DeviceSide = Exclude<Actor, 'relay'>;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where the envelope is. Four places, and every one of them is a real moment.
 *
 * `at-device` is the ciphertext existing but not yet handed over. The two
 * `crossing` positions straddle a boundary, which is the one instant a still
 * picture can carry unaided. `at-relay` is the row the relay holds.
 *
 * Named for positions rather than for steps because two steps share the relay
 * position — the row is stored and then delivered from the same slot — and a
 * position list that repeated itself would suggest the envelope moved when it
 * did not.
 */
export type EnvelopePosition = 'at-device' | 'crossing-out' | 'at-relay' | 'crossing-in';

/** A line of type, with the anchor it needs. Anchors differ between the two. */
export interface Label {
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
}

/** A run of lines the script fills in: the sentence, or the printed fields. */
export interface TextBlock extends Label {
  readonly lines: number;
  readonly leading: number;
}

export interface DevicePlace {
  /** The outlined form. Readable content lives inside it and nowhere else. */
  readonly outline: Box;
  /** The device's own store, sharing its bottom edge. Never floating. */
  readonly store: Box;
  /** Distance from the store's top edge to its full-width divider. */
  readonly storeDivider: number;
  /** The private key, inside the store, inside the device. Filled and notched. */
  readonly privateKey: Box;
  /** The key this session derived. The same form, because it is the same kind of secret. */
  readonly sessionKey: Box;
  /** The store's own name, in the band above its divider. */
  readonly storeLabel: Label;
  /** The sentence this device holds, in the reader's own words. */
  readonly content: TextBlock;
  /** The session's advance, one step per message this device has carried. */
  readonly ratchet: Box;
  readonly ratchetLabel: Label;
  readonly label: Label;
  /** The accent rule that says "this is the part to look at now". */
  readonly accent: Box;
}

export interface RelayPlace {
  /** An open container, so a reader can see what is in it. */
  readonly outline: Box;
  /** Compartments. Post, collect, keep the copy — the whole of what it does. */
  readonly slots: readonly Box[];
  /** The two public bundles, in the top slot. Outlined, because they are public. */
  readonly bundles: readonly Box[];
  readonly bundleLabel: Label;
  /**
   * The envelope's own metadata, printed beside the row the relay is holding.
   *
   * Four lines, which is fewer than the twelve fields a real envelope carries.
   * That is a drawing decision and not a claim about the envelope: the panel
   * below prints every field with its value and names the two it holds back,
   * and this is the drawing pointing at the ones that make the postal argument
   * — who it is from, who it is for, when, and how big. A reader who wants the
   * whole row has it a few centimetres away.
   *
   * What keeps four lines from becoming a hand-maintained list that drifts is
   * that the script reads each one off the envelope by name and a test fails if
   * a name it asks for is not a key the object has. A renamed field goes red
   * rather than blank.
   *
   * Beside the stored row and nowhere else. The ticks travel with the slab
   * because what the relay can read does not shrink when the envelope moves;
   * the names print only where the relay is holding it, because that is the
   * position at which the reader is being asked what the relay has. A carrier
   * reads the address while it has the letter.
   */
  readonly fields: TextBlock;
  readonly label: Label;
  readonly accent: Box;
}

export interface BoundaryPlace {
  /**
   * Whose boundary this is. The one beside device A is A's, always.
   *
   * The place is named, not the operation. What happens at a boundary depends
   * on which way the message is going — A's boundary seals a message leaving A
   * and opens one arriving at it — so `seal` and `open` are properties of a
   * trip and not of a position. This drawing renders one trip, A to B, which is
   * what the page's layout offers: Alice composes and Bob receives. The word
   * over each boundary therefore follows from this side, and the component
   * makes that step in one place.
   *
   * Naming the field `seal` and `open` would have made the same drawing and
   * been true for exactly as long as the reply is not drawn, at which point the
   * fix is a rename that reaches every use rather than a second argument here.
   */
  readonly side: DeviceSide;
  readonly label: Label;
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface EnvelopePlace {
  readonly slab: Box;
  /** Non-zero means in transit. Upright means at rest. */
  readonly shear: number;
  /** Where the brass ticks start. Centred on the slab's outside edge. */
  readonly ticks: { readonly x: number; readonly y: number; readonly count: number };
  readonly accent: Box;
}

export interface StageComposition {
  /** Distinguishes the two in the document. Both are present; CSS shows one. */
  readonly id: 'wide' | 'stacked';
  readonly width: number;
  readonly height: number;
  readonly devices: Record<DeviceSide, DevicePlace>;
  readonly relay: RelayPlace;
  readonly boundaries: readonly BoundaryPlace[];
  readonly envelopes: Record<EnvelopePosition, EnvelopePlace>;
  /**
   * The accent for a state whose subject is the whole row rather than one part.
   *
   * Two states have that subject: both devices coming up, and a session that
   * exists across both boundaries. The grammar allows one accent per diagram —
   * "the current step" and "the one thing to look at" have to be the same mark
   * — so those states get one rule spanning everything rather than a mark on
   * each device, which would be two.
   *
   * It runs along the drawing: horizontal under the wide composition, vertical
   * down the side of the stacked one. That is the same quarter turn the
   * boundaries take, for the same reason — the direction the message travels is
   * the direction the drawing is read in.
   */
  readonly spanAccent: Box;
}

/*
 * ---------------------------------------------------------------- shapes ---
 *
 * Sizes, shared by both compositions. Only positions differ between them, and
 * that is deliberate: a device that were smaller on a phone would be a second
 * drawing, and the pair would drift the first time either was edited. The
 * stacked composition is taller instead, which costs a reader a scroll and
 * costs the drawing nothing.
 */

/** 3:2 landscape, which is what the element vocabulary fixes a device at. */
const DEVICE = { width: 264, height: 176 } as const;
/** Attached to the device's bottom edge, with the divider a third from its top. */
const STORE = { height: 72, divider: 24 } as const;
/**
 * A key: solid, notched, and never drawn outside a device outline.
 *
 * Two of them sit in each store — the identity this device holds from the
 * moment it comes up, and the key this session derived — and they are the same
 * shape because they are the same kind of secret. The public bundle below is
 * that shape outlined, and the rhyme is the point: the difference between what
 * may travel and what may not is the fill, and it is the only difference.
 */
const PRIVATE_KEY = { width: 46, height: 30, notch: 10, gap: 24 } as const;
/**
 * Not 3:2, so the middle node is not a device at a glance.
 *
 * The vocabulary fixes 3:2 for a device and says nothing about a relay, so the
 * discrimination is free — no rule is bent to get it. Its height is the device
 * and its store together, which is what puts the three columns on one baseline.
 */
const RELAY = { width: 240, height: DEVICE.height + STORE.height } as const;
const SLOT_COUNT = 3;
/*
 * Chosen together so the slot height comes out whole and leaves a slab's ticks
 * a full stroke of clear air inside the rim. Three slots, two gaps and two
 * paddings have to divide 248 exactly; 10 and 9 are the roundest pair that do
 * and still clear the check below.
 */
const SLOT_PADDING = 10;
const SLOT_GAP = 9;
const SLOT_WIDTH = RELAY.width - SLOT_PADDING * 2;
const SLOT_HEIGHT = (RELAY.height - SLOT_PADDING * 2 - SLOT_GAP * (SLOT_COUNT - 1)) / SLOT_COUNT;

/** The envelope. Fits a slot with room around it, so the slot reads as a slot. */
const SLAB = { width: 64, height: 46 } as const;
const SHEAR = 11;
/**
 * Four ticks, on every slab, in every position.
 *
 * What the relay can read does not shrink because the envelope moved, so the
 * ticks do not either. Four rather than three because this slab is wider than
 * the old figure's: `metadataTickRects` lays a run out at a fixed 16-unit
 * spacing, so the count is what fills a slab rather than a number chosen.
 */
const TICK_COUNT = 4;
/** The run `metadataTickRects` lays out, restated so the centring below is checkable. */
const TICK_RUN = TICK_WIDTH + (TICK_COUNT - 1) * TICK_SPACING;
const TICK_INSET = (SLAB.width - TICK_RUN) / 2;
/**
 * How far a slab's ticks reach above its top edge.
 *
 * `metadataTicks` takes the slab's top as its `y` and draws upward from it, so a
 * slab is never as tall as the space it needs. Anything that places a slab
 * inside something else places this run, not `SLAB.height` — the first draft
 * centred the slab on its own height and hung the ticks over the slot's rim.
 */
const TICK_RISE = TICK_LENGTH + TICK_GAP;
const SLAB_RUN = TICK_RISE + SLAB.height;

/** The public bundle: the same notched shape, outlined, because it travels. */
const BUNDLE = PRIVATE_KEY;

/** Upright steps, so a run reads as a run rather than as a row of blocks. */
const RATCHET = { step: 14, height: 22, gap: 14 } as const;
const RATCHET_SPAN = RATCHET_STEPS * RATCHET.step + (RATCHET_STEPS - 1) * RATCHET.gap;

/** How many lines of the sentence a device shows, and how they are spaced. */
const CONTENT = { lines: 3, leading: 20, inset: 20, top: 42 } as const;
/** Room between a slot's edge and what sits in it, so the slot reads as a slot. */
const SLOT_INSET = 8;
/** The baseline a slot's name sits on, measured down from the slot's top edge. */
const SLOT_LABEL_BASELINE = 20;

/** Four lines of metadata, and where they start relative to the slot's edge. */
const FIELD_LINES = 4;
const FIELD_LEADING = 13;
const FIELD_INSET = SLOT_INSET + SLAB.width + 12;

/** Height of the accent rule. One mark per state, and it is the only accent. */
export const ACCENT_HEIGHT = 3;

/**
 * How many characters of the sentence fit on one line inside a device.
 *
 * Derived rather than chosen, but an estimate rather than a measurement. The
 * sentence is set in the sans face — the stylesheet says why it is not mono: a
 * monospaced sentence reads as payload, and this one is the reader's own words
 * — and a proportional face has no single advance to divide by. So this uses
 * 7.8 units a character at 13 units, about 0.6em, which sits well above the
 * ~0.5em that ordinary lowercase prose averages and therefore yields a column
 * count ordinary prose does not fill.
 *
 * It is not an upper bound, and no number here could be one that still left the
 * box usable: a line of capitals would advance nearer 0.95em and could reach
 * the edge. The box is what stops that case. Making this honest costs a line of
 * prose; making it exact would cost measuring text in the browser, which this
 * drawing deliberately does not do.
 */
const SANS_ADVANCE = 7.8;
export const CONTENT_COLUMNS = Math.floor((DEVICE.width - CONTENT.inset * 2) / SANS_ADVANCE);
export const CONTENT_LINES = CONTENT.lines;

/**
 * The same arithmetic for the metadata beside the stored row, and here it is
 * exact rather than estimated.
 *
 * The metadata is mono, where every character advances the same distance, so
 * dividing by an advance is the right instrument rather than an approximation
 * of one. It is set two units smaller than the sentence, and it has only the
 * part of a slot the envelope is not standing in.
 */
const FIELD_ADVANCE = 7.8 * (11 / 13);
export const FIELD_COLUMNS = Math.floor((SLOT_WIDTH - FIELD_INSET) / FIELD_ADVANCE);
export const FIELD_LINE_COUNT = FIELD_LINES;

export const SLAB_SIZE = SLAB;
export const RELAY_SLOT_COUNT = SLOT_COUNT;
export const PRIVATE_KEY_SIZE = PRIVATE_KEY;
export const BUNDLE_SIZE = BUNDLE;
export const RATCHET_SIZE = RATCHET;
export const STORE_DIVIDER = STORE.divider;

/* ------------------------------------------------------------ builders --- */

/**
 * The two keys in a store, in the band below its divider.
 *
 * Centred in that band rather than hung from the divider, so the store reads as
 * a compartment holding things rather than as a header with a shelf under it.
 */
function keys(store: Box): [Box, Box] {
  const band = store.height - STORE.divider;
  const y = store.y + STORE.divider + (band - PRIVATE_KEY.height) / 2;
  const left = store.x + CONTENT.inset;
  return [
    { x: left, y, width: PRIVATE_KEY.width, height: PRIVATE_KEY.height },
    {
      x: left + PRIVATE_KEY.width + PRIVATE_KEY.gap,
      y,
      width: PRIVATE_KEY.width,
      height: PRIVATE_KEY.height,
    },
  ];
}

function slots(x: number, y: number): Box[] {
  return Array.from({ length: SLOT_COUNT }, (_, index) => ({
    x: x + SLOT_PADDING,
    y: y + SLOT_PADDING + index * (SLOT_HEIGHT + SLOT_GAP),
    width: SLOT_WIDTH,
    height: SLOT_HEIGHT,
  }));
}

/**
 * Where a slab sits in a slot, with its ticks inside the slot's edge.
 *
 * The stack is what is centred, and the slab's top follows from it. Every slot
 * that holds a slab goes through here, so the two compositions cannot drift into
 * placing the same object by two different rules.
 */
function slabTop(slot: Box): number {
  return slot.y + (slot.height - SLAB_RUN) / 2 + TICK_RISE;
}

/**
 * Two public bundles side by side in a slot, under the slot's own name.
 *
 * The name is inside the slot rather than above it. There is no band between
 * the relay's top edge and its first slot to hang a caption in — the relay is
 * exactly as tall as a device and its store, and the slots fill it — so a label
 * placed outside crosses the outline. The store beside it labels its contents
 * from the inside for the same reason, which makes this the drawing's one idiom
 * for naming a compartment rather than a second one.
 */
function bundles(slot: Box): Box[] {
  const span = BUNDLE.width * 2 + BUNDLE.gap;
  const left = slot.x + (slot.width - span) / 2;
  const band = slot.height - SLOT_LABEL_BASELINE;
  const top = slot.y + SLOT_LABEL_BASELINE + (band - BUNDLE.height) / 2;
  return [0, BUNDLE.width + BUNDLE.gap].map((offset) => ({
    x: left + offset,
    y: top,
    width: BUNDLE.width,
    height: BUNDLE.height,
  }));
}

/** A slot's name, on the slot's first line. */
function slotLabel(slot: Box): Label {
  return { x: slot.x + SLOT_INSET, y: slot.y + SLOT_LABEL_BASELINE, anchor: 'start' };
}

/** The metadata, in the space the stored row leaves to its right. */
function fields(slot: Box): TextBlock {
  return {
    x: slot.x + FIELD_INSET,
    y: slot.y + 16,
    anchor: 'start',
    lines: FIELD_LINES,
    leading: FIELD_LEADING,
  };
}

/** An envelope at a place, with its ticks and the rule that points at it. */
function envelope(x: number, y: number, shear: number, accentY: number): EnvelopePlace {
  return {
    slab: { x, y, width: SLAB.width, height: SLAB.height },
    shear,
    ticks: { x: x + TICK_INSET, y, count: TICK_COUNT },
    accent: { x, y: accentY, width: SLAB.width, height: ACCENT_HEIGHT },
  };
}

/* -------------------------------------------------------------- the wide --- */

/*
 * 1104 units, matching the signature diagram's full-width slot — a measured
 * number for the same slot rather than an assumed one — at very nearly 3:1,
 * which is the proportion that keeps a stage from eating the page it is on.
 *
 * Left to right: device A and its store, the seal boundary, the relay and its
 * slots, the open boundary, device B and its store. The two devices sit at the
 * same height and the relay spans both bands, so the three columns share a
 * baseline and the drawing reads as one row rather than three drawings.
 */
const WIDE_WIDTH = 1104;
const WIDE_HEIGHT = 372;
const WIDE_MARGIN = 8;
const WIDE_DEVICE_TOP = 72;
const WIDE_STORE_TOP = WIDE_DEVICE_TOP + DEVICE.height;
const WIDE_BOTTOM = WIDE_STORE_TOP + STORE.height;
const WIDE_A_X = WIDE_MARGIN;
const WIDE_B_X = WIDE_WIDTH - WIDE_MARGIN - DEVICE.width;
const WIDE_RELAY_X = (WIDE_WIDTH - RELAY.width) / 2;
const WIDE_A_BOUNDARY_X = (WIDE_A_X + DEVICE.width + WIDE_RELAY_X) / 2;
const WIDE_B_BOUNDARY_X = (WIDE_RELAY_X + RELAY.width + WIDE_B_X) / 2;
const WIDE_ACCENT_Y = WIDE_BOTTOM + 8;
const WIDE_RATCHET_Y = WIDE_ACCENT_Y + 12;
const WIDE_SLOTS = slots(WIDE_RELAY_X, WIDE_DEVICE_TOP);
/** The envelope rides the middle slot's band the whole way across. */
const WIDE_SLAB_Y = slabTop(WIDE_SLOTS[1]);
const WIDE_SLAB_ACCENT_Y = WIDE_SLAB_Y + SLAB.height + 10;

function wideDevice(side: DeviceSide, x: number): DevicePlace {
  const store = { x, y: WIDE_STORE_TOP, width: DEVICE.width, height: STORE.height };
  const [privateKey, sessionKey] = keys(store);
  return {
    outline: { x, y: WIDE_DEVICE_TOP, width: DEVICE.width, height: DEVICE.height },
    store,
    storeDivider: STORE.divider,
    privateKey,
    sessionKey,
    storeLabel: { x: x + CONTENT.inset, y: WIDE_STORE_TOP + 17, anchor: 'start' },
    content: {
      x: x + CONTENT.inset,
      y: WIDE_DEVICE_TOP + CONTENT.top,
      anchor: 'start',
      lines: CONTENT.lines,
      leading: CONTENT.leading,
    },
    ratchet: { x, y: WIDE_RATCHET_Y, width: RATCHET.step, height: RATCHET.height },
    ratchetLabel: {
      x: x + RATCHET_SPAN + 12,
      y: WIDE_RATCHET_Y + RATCHET.height - 4,
      anchor: 'start',
    },
    label: { x: side === 'a' ? x : x + DEVICE.width, y: 40, anchor: side === 'a' ? 'start' : 'end' },
    accent: { x, y: WIDE_ACCENT_Y, width: DEVICE.width, height: ACCENT_HEIGHT },
  };
}

export const WIDE: StageComposition = {
  id: 'wide',
  width: WIDE_WIDTH,
  height: WIDE_HEIGHT,
  devices: { a: wideDevice('a', WIDE_A_X), b: wideDevice('b', WIDE_B_X) },
  relay: {
    outline: { x: WIDE_RELAY_X, y: WIDE_DEVICE_TOP, width: RELAY.width, height: RELAY.height },
    slots: WIDE_SLOTS,
    bundles: bundles(WIDE_SLOTS[0]),
    bundleLabel: slotLabel(WIDE_SLOTS[0]),
    fields: fields(WIDE_SLOTS[1]),
    label: { x: WIDE_RELAY_X + RELAY.width / 2, y: 40, anchor: 'middle' },
    accent: { x: WIDE_RELAY_X, y: WIDE_ACCENT_Y, width: RELAY.width, height: ACCENT_HEIGHT },
  },
  spanAccent: {
    x: WIDE_MARGIN,
    y: WIDE_ACCENT_Y,
    width: WIDE_WIDTH - WIDE_MARGIN * 2,
    height: ACCENT_HEIGHT,
  },
  boundaries: [
    {
      side: 'a',
      label: { x: WIDE_A_BOUNDARY_X, y: 40, anchor: 'middle' },
      x1: WIDE_A_BOUNDARY_X,
      y1: 52,
      x2: WIDE_A_BOUNDARY_X,
      y2: WIDE_BOTTOM + 4,
    },
    {
      side: 'b',
      label: { x: WIDE_B_BOUNDARY_X, y: 40, anchor: 'middle' },
      x1: WIDE_B_BOUNDARY_X,
      y1: 52,
      x2: WIDE_B_BOUNDARY_X,
      y2: WIDE_BOTTOM + 4,
    },
  ],
  envelopes: {
    /* In the clear between the device it left and the boundary it has not yet
       crossed. Touching neither, because it belongs to neither. */
    'at-device': envelope(
      WIDE_A_X + DEVICE.width + 10,
      WIDE_SLAB_Y,
      0,
      WIDE_SLAB_ACCENT_Y,
    ),
    'crossing-out': envelope(WIDE_A_BOUNDARY_X - SLAB.width / 2, WIDE_SLAB_Y, SHEAR, WIDE_SLAB_ACCENT_Y),
    'at-relay': envelope(WIDE_SLOTS[1].x + SLOT_INSET, WIDE_SLAB_Y, 0, WIDE_SLAB_ACCENT_Y),
    'crossing-in': envelope(WIDE_B_BOUNDARY_X - SLAB.width / 2, WIDE_SLAB_Y, SHEAR, WIDE_SLAB_ACCENT_Y),
  },
};

/* ----------------------------------------------------------- the stacked --- */

/*
 * 360 units wide, the width the signature diagram's stacked composition uses
 * and the width a 320px viewport can carry without a sideways scroll.
 *
 * Top to bottom in the order a message travels, which keeps reading order equal
 * to protocol order for a reader who is scrolling rather than scanning. The
 * boundaries run horizontally here and the envelope crosses them downward; it
 * is the same gutter doing the same job a quarter turn round. The devices are
 * not turned, because their content is type.
 */
const STACK_WIDTH = 360;
const STACK_X = (STACK_WIDTH - DEVICE.width) / 2;
const STACK_RELAY_X = (STACK_WIDTH - RELAY.width) / 2;
const STACK_RULE_INSET = 16;

const STACK_A_TOP = 34;
const STACK_A_STORE = STACK_A_TOP + DEVICE.height;
const STACK_A_BOTTOM = STACK_A_STORE + STORE.height;
const STACK_A_RATCHET = STACK_A_BOTTOM + 10;
const STACK_A_ACCENT = STACK_A_RATCHET + RATCHET.height + 8;

const STACK_A_BOUNDARY_Y = STACK_A_ACCENT + 62;
const STACK_RELAY_TOP = STACK_A_BOUNDARY_Y + 52;
const STACK_SLOTS = slots(STACK_RELAY_X, STACK_RELAY_TOP);
const STACK_RELAY_BOTTOM = STACK_RELAY_TOP + RELAY.height;
const STACK_RELAY_ACCENT = STACK_RELAY_BOTTOM + 8;

const STACK_B_BOUNDARY_Y = STACK_RELAY_ACCENT + 54;
const STACK_B_TOP = STACK_B_BOUNDARY_Y + 56;
const STACK_B_STORE = STACK_B_TOP + DEVICE.height;
const STACK_B_BOTTOM = STACK_B_STORE + STORE.height;
const STACK_B_RATCHET = STACK_B_BOTTOM + 10;
const STACK_B_ACCENT = STACK_B_RATCHET + RATCHET.height + 8;
const STACK_HEIGHT = STACK_B_ACCENT + 20;

/** Upright and centred in the column, the way it is at rest anywhere else. */
const STACK_SLAB_X = (STACK_WIDTH - SLAB.width) / 2;

function stackDevice(top: number, ratchetY: number, accentY: number): DevicePlace {
  const store = { x: STACK_X, y: top + DEVICE.height, width: DEVICE.width, height: STORE.height };
  const [privateKey, sessionKey] = keys(store);
  return {
    outline: { x: STACK_X, y: top, width: DEVICE.width, height: DEVICE.height },
    store,
    storeDivider: STORE.divider,
    privateKey,
    sessionKey,
    storeLabel: { x: STACK_X + CONTENT.inset, y: store.y + 17, anchor: 'start' },
    content: {
      x: STACK_X + CONTENT.inset,
      y: top + CONTENT.top,
      anchor: 'start',
      lines: CONTENT.lines,
      leading: CONTENT.leading,
    },
    ratchet: { x: STACK_X, y: ratchetY, width: RATCHET.step, height: RATCHET.height },
    ratchetLabel: { x: STACK_X + RATCHET_SPAN + 12, y: ratchetY + RATCHET.height - 4, anchor: 'start' },
    label: { x: STACK_X, y: top - 12, anchor: 'start' },
    accent: { x: STACK_X, y: accentY, width: DEVICE.width, height: ACCENT_HEIGHT },
  };
}

export const STACKED: StageComposition = {
  id: 'stacked',
  width: STACK_WIDTH,
  height: STACK_HEIGHT,
  devices: {
    a: stackDevice(STACK_A_TOP, STACK_A_RATCHET, STACK_A_ACCENT),
    b: stackDevice(STACK_B_TOP, STACK_B_RATCHET, STACK_B_ACCENT),
  },
  relay: {
    outline: { x: STACK_RELAY_X, y: STACK_RELAY_TOP, width: RELAY.width, height: RELAY.height },
    slots: STACK_SLOTS,
    bundles: bundles(STACK_SLOTS[0]),
    bundleLabel: slotLabel(STACK_SLOTS[0]),
    fields: fields(STACK_SLOTS[1]),
    label: { x: STACK_RELAY_X, y: STACK_RELAY_TOP - 12, anchor: 'start' },
    accent: {
      x: STACK_RELAY_X,
      y: STACK_RELAY_ACCENT,
      width: RELAY.width,
      height: ACCENT_HEIGHT,
    },
  },
  spanAccent: {
    x: 4,
    y: STACK_A_TOP,
    width: ACCENT_HEIGHT,
    height: STACK_B_BOTTOM - STACK_A_TOP,
  },
  boundaries: [
    {
      side: 'a',
      label: { x: STACK_RULE_INSET, y: STACK_A_BOUNDARY_Y - 12, anchor: 'start' },
      x1: STACK_RULE_INSET,
      y1: STACK_A_BOUNDARY_Y,
      x2: STACK_WIDTH - STACK_RULE_INSET,
      y2: STACK_A_BOUNDARY_Y,
    },
    {
      side: 'b',
      label: { x: STACK_RULE_INSET, y: STACK_B_BOUNDARY_Y - 12, anchor: 'start' },
      x1: STACK_RULE_INSET,
      y1: STACK_B_BOUNDARY_Y,
      x2: STACK_WIDTH - STACK_RULE_INSET,
      y2: STACK_B_BOUNDARY_Y,
    },
  ],
  envelopes: {
    'at-device': envelope(STACK_SLAB_X, STACK_A_ACCENT + 12, 0, STACK_A_ACCENT + 12 + SLAB.height + 8),
    'crossing-out': envelope(
      STACK_SLAB_X,
      STACK_A_BOUNDARY_Y - SLAB.height / 2,
      SHEAR,
      STACK_A_BOUNDARY_Y + SLAB.height / 2 + 8,
    ),
    'at-relay': envelope(
      STACK_SLOTS[1].x + SLOT_INSET,
      slabTop(STACK_SLOTS[1]),
      0,
      slabTop(STACK_SLOTS[1]) + SLAB.height + 8,
    ),
    'crossing-in': envelope(
      STACK_SLAB_X,
      STACK_B_BOUNDARY_Y - SLAB.height / 2,
      SHEAR,
      STACK_B_BOUNDARY_Y + SLAB.height / 2 + 8,
    ),
  },
};

export const COMPOSITIONS: readonly StageComposition[] = [WIDE, STACKED];

/* ---------------------------------------------------------- the grammar --- */

function fail(message: string): never {
  throw new Error(`stage geometry: ${message}`);
}

/*
 * A device is 3:2 landscape, and a relay is not.
 *
 * The first is the vocabulary's own figure for a device. The second is the
 * whole of what stops a reader classifying the middle node as another device
 * before looking inside it, which is the habit this drawing exists to break.
 */
if (DEVICE.width * 2 !== DEVICE.height * 3) {
  fail(`a device at ${DEVICE.width}×${DEVICE.height} is not the 3:2 the vocabulary fixes`);
}
if (RELAY.width * 2 === RELAY.height * 3) {
  fail(`the relay at ${RELAY.width}×${RELAY.height} is a device's proportion`);
}

/* A slot has to hold the envelope with room to read as a compartment. */
if (SLOT_HEIGHT <= SLAB.height || SLOT_WIDTH <= SLAB.width) {
  fail(`a ${SLOT_WIDTH}×${SLOT_HEIGHT} slot cannot hold a ${SLAB.width}×${SLAB.height} envelope`);
}
if (!Number.isInteger(SLOT_HEIGHT)) {
  fail(`slots divide the relay into ${SLOT_HEIGHT}-unit fractions`);
}

/* The ticks are centred on the slab's outside edge rather than started at it. */
if (TICK_INSET < 0) {
  fail(`a ${TICK_RUN}-unit run of ticks does not fit a ${SLAB.width}-unit slab`);
}

/*
 * The stored envelope sits inside the slot holding it, ticks and all.
 *
 * The check above compares the slot to `SLAB.height` and passes on a slab whose
 * ticks are standing on the rim, which is what the first draft drew: the
 * metadata run crossed the slot's top edge in the one position where a reader is
 * being asked to look at it. A full stroke of clear air, because half a stroke
 * is the two outlines touching.
 *
 * Measured on the envelope each composition really places rather than on the
 * constants it places it from. A slot large enough for a slab is not the same
 * claim as a slab put in the middle of one, and it was the placement that was
 * wrong: an arithmetic check on the sizes would have passed the drawing that
 * shipped the defect.
 */
for (const composition of [WIDE, STACKED]) {
  const slot = composition.relay.slots[1];
  const { slab, ticks } = composition.envelopes['at-relay'];
  const above = ticks.y - TICK_RISE - slot.y;
  const below = slot.y + slot.height - (slab.y + slab.height);
  if (above < STROKE_WIDTH || below < STROKE_WIDTH) {
    fail(
      `the ${composition.id} composition's stored envelope leaves ${above} units above its ` +
        `ticks and ${below} below its slab, where the grammar wants ${STROKE_WIDTH} of each`,
    );
  }
}

/* And a named slot has to hold its name and its contents, in that order. */
const BUNDLE_CLEARANCE = (SLOT_HEIGHT - SLOT_LABEL_BASELINE - BUNDLE.height) / 2;
if (BUNDLE_CLEARANCE < STROKE_WIDTH) {
  fail(
    `a ${BUNDLE.height}-unit bundle under a name on line ${SLOT_LABEL_BASELINE} leaves ` +
      `${BUNDLE_CLEARANCE} units in a ${SLOT_HEIGHT}-unit slot`,
  );
}

/* The ratchet belongs to its device, so it may not overhang it. */
if (RATCHET_SPAN > DEVICE.width) {
  fail(`a ${RATCHET_SPAN}-unit ratchet run under a ${DEVICE.width}-unit device`);
}
if (RATCHET.height <= RATCHET.step) {
  fail('a ratchet step wider than it is tall is a block, not an upright slab');
}

/*
 * The clear space either side of every boundary, per side and never summed.
 *
 * The gutter is the drawing's claim that encryption happens at a place rather
 * than across a region, and the grammar puts a floor under it. A boundary with
 * ninety units of room on one side and six on the other is not compliant, and a
 * check that added them would say it was — the old figure's first draft did
 * exactly that and passed with the envelope over a device outline.
 *
 * What is measured is the fixed furniture, and in the stacked composition that
 * is not the outline: the ratchet run and the accent rule sit below their
 * device and above the boundary, so measuring to the outline would report a
 * hundred units of clear space with a ratchet standing in it. Each entry
 * measures to whatever really ends that side.
 *
 * The envelope positions are deliberately not measured. An envelope crossing a
 * boundary is the event this stage exists to draw, and a rule that kept it out
 * of the gutter would forbid the drawing from showing its subject.
 */
const gutters: readonly [string, string, number][] = [
  ["wide, device A's", 'device A', WIDE_A_BOUNDARY_X - (WIDE_A_X + DEVICE.width)],
  ["wide, device A's", 'the relay', WIDE_RELAY_X - WIDE_A_BOUNDARY_X],
  ["wide, device B's", 'the relay', WIDE_B_BOUNDARY_X - (WIDE_RELAY_X + RELAY.width)],
  ["wide, device B's", 'device B', WIDE_B_X - WIDE_B_BOUNDARY_X],
  ["stacked, device A's", "device A's accent rule", STACK_A_BOUNDARY_Y - (STACK_A_ACCENT + ACCENT_HEIGHT)],
  ["stacked, device A's", 'the relay', STACK_RELAY_TOP - STACK_A_BOUNDARY_Y],
  ["stacked, device B's", "the relay's accent rule", STACK_B_BOUNDARY_Y - (STACK_RELAY_ACCENT + ACCENT_HEIGHT)],
  ["stacked, device B's", 'device B', STACK_B_TOP - STACK_B_BOUNDARY_Y],
];
for (const [boundary, neighbour, gutter] of gutters) {
  if (gutter < BOUNDARY_MIN_GUTTER) {
    fail(
      `${gutter} units between the ${boundary} boundary and ${neighbour}, under the ` +
        `${BOUNDARY_MIN_GUTTER} the grammar requires`,
    );
  }
}

/*
 * Nothing may reach past the canvas.
 *
 * Checked by walking every box the compositions declare rather than by checking
 * the few that looked risky. The open ratchet steps carry a stroke that
 * straddles their edge, so half of one is added on every side.
 */
const overhang = STROKE_WIDTH / 2;
for (const composition of COMPOSITIONS) {
  const boxes: [string, Box][] = [];
  for (const side of ['a', 'b'] as const) {
    const device = composition.devices[side];
    boxes.push(
      [`device ${side}`, device.outline],
      [`store ${side}`, device.store],
      [`private key ${side}`, device.privateKey],
      [`session key ${side}`, device.sessionKey],
      [`accent ${side}`, device.accent],
      [
        `ratchet ${side}`,
        { ...device.ratchet, width: RATCHET_SPAN, height: RATCHET.height + overhang },
      ],
    );
  }
  boxes.push(
    ['relay', composition.relay.outline],
    ['relay accent', composition.relay.accent],
    ['span accent', composition.spanAccent],
  );
  composition.relay.slots.forEach((slot, index) => boxes.push([`slot ${index + 1}`, slot]));
  composition.relay.bundles.forEach((bundle, index) =>
    boxes.push([`bundle ${index + 1}`, bundle]),
  );
  for (const [position, place] of Object.entries(composition.envelopes)) {
    boxes.push(
      [`envelope ${position}`, { ...place.slab, width: place.slab.width + place.shear }],
      [`envelope accent ${position}`, place.accent],
    );
  }

  for (const [name, box] of boxes) {
    if (box.x < 0 || box.y < 0) {
      fail(`${composition.id}: ${name} starts at ${box.x},${box.y}`);
    }
    if (box.x + box.width > composition.width || box.y + box.height > composition.height) {
      const right = box.x + box.width;
      const bottom = box.y + box.height;
      fail(
        `${composition.id}: ${name} reaches ${right},${bottom} on a ` +
          `${composition.width}×${composition.height} canvas`,
      );
    }
  }
}

/*
 * The metadata prints inside the relay, beside the row it belongs to.
 *
 * The block's origin and its last baseline are checked; its width is not. A run
 * of type has no width until a font has laid it out, and a build-time guess at
 * one would be a number that looks measured and is not — `FIELD_COLUMNS` is the
 * script's own cut and is the honest place for that estimate. What is knowable
 * here is where the lines start and where the last of them lands, and both
 * failures matter: metadata drawn beyond the relay's edge is a claim about the
 * wrong node, and a fifth line added without room for it runs out of the box
 * that gives it its meaning.
 */
for (const composition of COMPOSITIONS) {
  const { outline, fields: block } = composition.relay;
  const lastBaseline = block.y + (block.lines - 1) * block.leading;
  if (block.x < outline.x || block.x > outline.x + outline.width) {
    fail(`${composition.id}: the metadata starts at ${block.x}, outside the relay`);
  }
  if (lastBaseline > outline.y + outline.height) {
    fail(
      `${composition.id}: ${block.lines} lines of metadata reach ${lastBaseline}, past the ` +
        `relay's floor at ${outline.y + outline.height}`,
    );
  }
}

/* And they have room to be read: a name and a short value on one line. */
if (FIELD_COLUMNS < 16) {
  fail(`${FIELD_COLUMNS} columns beside the stored row is not a field name and a value`);
}

/* The wide composition is a stage rather than a panel: wide and short. */
const WIDE_RATIO = WIDE.width / WIDE.height;
if (WIDE_RATIO < 2.6 || WIDE_RATIO > 3.4) {
  fail(`the wide composition is ${WIDE_RATIO.toFixed(2)}:1, outside the 3:1 a stage holds`);
}

/* And the stacked one fits the column it is drawn for. */
if (STACKED.width > 360) {
  fail(`a ${STACKED.width}-unit stacked composition scrolls sideways on a 320px viewport`);
}
