/*
 * The two values in the Relay plan table that are not figures. A row's value
 * function returns one of these, and `PlanValue.astro` renders each as its
 * sign with the word a screen reader hears. Free has no overage, so its
 * overage cell is the em dash DESIGN.md gives a price that does not exist. The
 * project commercial SDK license is on every plan, so its cell is the check.
 */
export const NO_OVERAGE = '\u2014';
export const NO_OVERAGE_LABEL = 'No overage';
export const INCLUDED = '\u2713';
export const INCLUDED_LABEL = 'Included';
