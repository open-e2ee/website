/*
 * The demo's two icons, drawn once.
 *
 * The wide scene and the mobile figure are one demo at two widths, and the
 * claim that makes their objects legible — a key is a key, a ratchet only
 * turns forward — lives in the shapes. Two copies of a path are two shapes
 * waiting to drift, so the geometry lives here and both components stamp it.
 * This module owns coordinates and nothing else: no DOM, no styles, no
 * protocol. What each shape *means* — filled against outlined, the pawl
 * outside the turning group — is the stamping component's argument to make.
 */

/*
 * The key: a faceted hexagonal bow, a straight shaft and two square teeth, in
 * the diagram grammar's own language — flat, orthogonal, no curve. Filled it
 * is a private key, outlined it is the published half; the fill is the only
 * thing that ever changes, which is why there is exactly one path.
 */
export const KEY_GLYPH_VIEWBOX = '0 0 26 15';
export const KEY_GLYPH_PATH =
  'M10 5.5 H25 V13 H22 V8.5 H18 V13 H15 V8.5 H10 L7.5 12 H3 L0.5 7 L3 2 H7.5 Z';

/*
 * The ratchet wheel, drawn from its own definition rather than from typed
 * coordinates: a filled ring of sawteeth with a hole through it, a single
 * spoke, a hub, and a pawl resting on the teeth from outside.
 *
 * Six teeth and not eight: a click is one tooth passing under the pawl, so
 * the tooth count IS the turn angle, and 45° of an all-but-symmetric ring
 * read as a shiver at 24px. At six the teeth are big enough to be seen
 * carrying the rotation themselves and each click swings the hand 60°.
 */
export const TEETH = 6;
export const DEGREES_PER_KEY = 360 / TEETH;

export const WHEEL_VIEWBOX = '0 0 24 24';
export const WHEEL = { cx: 12, cy: 12, outer: 9.8, inner: 7.4, hole: 4.9 } as const;

const at = (radius: number, degrees: number): string => {
  const radians = (degrees * Math.PI) / 180;
  return `${(WHEEL.cx + radius * Math.cos(radians)).toFixed(2)},${(
    WHEEL.cy +
    radius * Math.sin(radians)
  ).toFixed(2)}`;
};

/* Out at a tooth tip, in along the tooth's back, then straight out again: the
   radial edge is the face the pawl catches. The second subpath is the hole,
   cut by fill-rule so the ring is a ring and not a disc. */
export const WHEEL_PATH =
  `M${at(WHEEL.outer, 0)} ${Array.from({ length: TEETH }, (_, index) => {
    const angle = ((index + 1) * 360) / TEETH;
    return `L${at(WHEEL.inner, angle)} L${at(WHEEL.outer, angle)}`;
  }).join(' ')} Z ` +
  `M${WHEEL.cx + WHEEL.hole} ${WHEEL.cy} ` +
  `A${WHEEL.hole} ${WHEEL.hole} 0 1 0 ${WHEEL.cx - WHEEL.hole} ${WHEEL.cy} ` +
  `A${WHEEL.hole} ${WHEEL.hole} 0 1 0 ${WHEEL.cx + WHEEL.hole} ${WHEEL.cy} Z`;

/* The hand on the dial — what makes a turn visible after it has happened,
   because a toothed ring is rotationally symmetric — and the hub it swings
   from. Both live inside the turning group. */
export const WHEEL_SPOKE_PATH = 'M12 12 L12 7.6';
export const WHEEL_HUB = { cx: 12, cy: 12, r: 1.6 } as const;

/* The pawl and its pin, resting on the teeth from outside the turning group:
   the wheel rotates under a finger that does not, which is the mechanism the
   icon is named for. */
export const WHEEL_PAWL_PATH = 'M18.8 1 L12.6 2.6 L14.6 5 Z';
export const WHEEL_PAWL_PIN = { cx: 18.8, cy: 1, r: 1.1 } as const;

/*
 * The keyhole: a round barrel over a flared ward, the shape a key glyph is
 * for. It never changes shape — `data-locked` is the state and the quarter
 * turn is the animation, both the stamping component's to own; this module
 * holds only what must not fork between the wide envelope and the mobile one.
 */
export const KEYHOLE_VIEWBOX = '0 0 24 24';
export const KEYHOLE_BARREL = { cx: 12, cy: 9, r: 5.5 } as const;
export const KEYHOLE_WARD_PATH = 'M10.4 12.5 L8 21 H16 L13.6 12.5 Z';
