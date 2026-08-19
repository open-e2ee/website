/*
 * The FLIP box morph, drawn once.
 *
 * Both demo figures reshape their envelope the same way: freeze the
 * element's box where the move starts — position as an inline transform,
 * size as inline width and height — commit the freeze with a forced read,
 * arm whatever keys the transition, and write the target box, so position,
 * width and height cross in one transition and the tile *reshapes* between
 * two boxes instead of jumping or traveling as a scaled copy of itself.
 * Two copies of that idiom are two idioms waiting to drift, so the
 * freeze-and-release lives here and both scenes call it.
 *
 * This module owns the idiom and nothing else. Which transform anchors the
 * box (the wide scene's corner, the mobile figure's center), what arms the
 * transition (a data attribute the stylesheet keys, an inline duration),
 * and what a finished morph settles into are the calling scene's to own —
 * the seam is the mechanism, not the choreography.
 */

/**
 * One end of a morph: where the box sits and how big it is, in px. A
 * transform left undefined leaves the element's own in place — the
 * resize-only swap the mobile tile plays between its two faces.
 */
export interface MorphFrame {
  transform?: string;
  width: number;
  height: number;
}

function writeFrame(element: HTMLElement, frame: MorphFrame): void {
  if (frame.transform !== undefined) element.style.transform = frame.transform;
  element.style.width = `${frame.width}px`;
  element.style.height = `${frame.height}px`;
}

/**
 * Pin the box on `from`, commit it, let `arm` flip the state that starts
 * the clock, then write `to`. The read between the writes is the whole
 * trick: without the forced layout the two writes coalesce into one style
 * and the transition never sees the starting box.
 */
export function freezeAndRelease(
  element: HTMLElement,
  from: MorphFrame,
  to: MorphFrame,
  arm?: () => void,
): void {
  writeFrame(element, from);
  void element.offsetWidth;
  arm?.();
  writeFrame(element, to);
}

/**
 * Whether this `transitionend` is a morph landing. Any of the three box
 * properties ends one, because a morph may not run all three: a target
 * the element's own width runs no width transition at all.
 */
export function endsMorph(event: TransitionEvent): boolean {
  return (
    event.propertyName === 'transform' ||
    event.propertyName === 'width' ||
    event.propertyName === 'height'
  );
}

/**
 * Hand a frozen box back to the stylesheet. Every resting state sizes the
 * element itself, so a settle — finished or interrupted — must not leave
 * an inline size on it.
 */
export function releaseBox(element: HTMLElement): void {
  element.style.removeProperty('width');
  element.style.removeProperty('height');
}
