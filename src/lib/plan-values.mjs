/*
 * The values in a plan table that are not figures. A row's value function
 * returns one of these, and `PlanValue.astro` renders each as its sign with
 * the word a screen reader hears. Free has no overage, so its overage cell is
 * the em dash DESIGN.md gives a price that does not exist; a license that
 * does not carry a row takes the same dash under the word "Not included". A
 * license row a tier carries takes the check.
 *
 * `NOT_INCLUDED` is a sentinel and not the dash itself, because two values
 * that print the same sign must still say different words.
 */
export const NO_OVERAGE = '—';
export const NO_OVERAGE_LABEL = 'No overage';
export const NOT_INCLUDED = 'not included';
export const NOT_INCLUDED_LABEL = 'Not included';
export const NOT_INCLUDED_SIGN = '—';
export const INCLUDED = '✓';
export const INCLUDED_LABEL = 'Included';
