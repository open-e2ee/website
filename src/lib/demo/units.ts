/*
 * One byte-count formatter for the whole demo band.
 *
 * Every size a reader sees — the envelope's franking mark, a mailbox slab, a
 * caption — is the same measurement wearing the same units, whichever figure
 * printed it. Two formatters are two spellings waiting to drift, `drawing.ts`'s
 * argument, so the wide scene, the mobile figure and the mobile reel all import
 * this one.
 */

/**
 * Powers of 1024, one decimal place once the unit turns, because the figure is
 * for reading rather than for accounting — the trace still holds the exact
 * count. Everything a run produces today fits inside kilobytes; the megabyte
 * arm exists so a bigger envelope some day prints a unit rather than a
 * five-digit KB figure.
 */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
