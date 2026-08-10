/*
 * The bytes behind `envelope.ciphertext`, and the short strip of them the
 * figure prints.
 *
 * Two things live here rather than in `figure.ts`, because both of them are
 * facts about the SDK's output rather than about the drawing, and because
 * `demo-smoke.mjs` has to reproduce the strip exactly to prove the figure is
 * printing the row the panel beside it is printing. One function, imported by
 * both, is the only version of that arithmetic that cannot drift.
 *
 * ---------------------------------------------------------------- peeling ---
 *
 * `envelope.ciphertext` is base64 of base64. The SDK serialises the encrypted
 * message to a base64 document and the relay row carries that document base64
 * encoded again, so a single `atob` returns 2,649 bytes of *base64 characters*
 * — and a hex strip taken from those is a hex dump of the letters `eyJ0...`,
 * which changes only when the outer envelope's length changes. That is what the
 * first cut of this figure printed.
 *
 * The peel is adaptive rather than a hard-coded two, so a build of the SDK that
 * stops double-encoding keeps working: a layer is peeled only while the bytes
 * that came out are themselves a well-formed base64 document. Real ciphertext is
 * ~2,000 bytes of AEAD output and the chance of every one of them landing in a
 * 65-character alphabet is nil, so the loop stops at the true bytes.
 *
 * --------------------------------------------------------------- the window ---
 *
 * The strip does not start at byte 0, and that is measured rather than chosen.
 * Two sends on one warm session share a prekey header: bytes 0-146 are byte for
 * byte identical between them, as are 148-152, 329-334, 368-391 and the whole
 * tail from 400 to the end. The block that genuinely differs per message is
 * 153-328. A strip taken from the head of the envelope is therefore constant
 * for the whole run — it looks like a still image of ciphertext, which is the
 * opposite of the claim the figure is making.
 *
 * `HEX_OFFSET` sits inside the measured block with room either side of it.
 * `demo-smoke.mjs` sends twice and fails the run if the two strips match, so
 * this stays true rather than staying written down.
 */

/** Where the strip starts, in decoded bytes. Inside the per-message block. */
export const HEX_OFFSET = 160;

/*
 * The strip's length, and how it wraps.
 *
 * Eighteen bytes is what the relay lane holds at a legible size —
 * `DemoFigure.astro` ships three `tspan`s and explains the arithmetic. Anything
 * beyond that is dropped, because the extra lines have nowhere to go.
 */
export const HEX_BYTES = 18;
export const HEX_PER_LINE = 6;

/* One extra peel over the two the SDK does today, and no more: the guard below
   is a heuristic, and a document that keeps satisfying it forever would spin. */
const MAX_LAYERS = 3;

const decode = (text: string): Uint8Array | null => {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  /* Whole quanta only. The panel prints an excerpt of the envelope rather than
     all of it, and the harness decodes that excerpt: trimming to a multiple of
     four is what makes a prefix of the document decode to a prefix of the
     bytes, which is what lets the two agree about byte 160. */
  const whole = clean.slice(0, clean.length - (clean.length % 4));
  if (whole.length === 0) return null;
  try {
    const binary = atob(whole);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
};

const BASE64_BYTE = (byte: number) =>
  (byte >= 0x41 && byte <= 0x5a) ||
  (byte >= 0x61 && byte <= 0x7a) ||
  (byte >= 0x30 && byte <= 0x39) ||
  byte === 0x2b ||
  byte === 0x2f ||
  byte === 0x3d;

const isDocument = (bytes: Uint8Array) => bytes.length >= 4 && bytes.every(BASE64_BYTE);

const asText = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** The real bytes of an envelope's ciphertext field, however many times it was encoded. */
export function ciphertextBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value !== 'string' || value.length === 0) return null;

  let bytes = decode(value);
  if (!bytes) return null;
  for (let layer = 1; layer < MAX_LAYERS && isDocument(bytes); layer += 1) {
    const inner = decode(asText(bytes));
    if (!inner) break;
    bytes = inner;
  }
  return bytes;
}

/** The strip the relay lane prints: `HEX_BYTES` bytes from `HEX_OFFSET`, wrapped. */
export function hexStrip(value: unknown): string[] {
  const bytes = ciphertextBytes(value);
  if (!bytes) return [];

  /* A short envelope still prints bytes rather than nothing: the window slides
     back to the end of what there is. The demo's own envelopes are two
     kilobytes and never take this path; a smaller one would otherwise show an
     empty lane under a caption saying the lane holds the ciphertext. */
  const from = Math.min(HEX_OFFSET, Math.max(0, bytes.length - HEX_BYTES));
  const window = [...bytes.subarray(from, from + HEX_BYTES)].map((byte) =>
    byte.toString(16).padStart(2, '0'),
  );

  const lines: string[] = [];
  for (let at = 0; at < window.length; at += HEX_PER_LINE) {
    lines.push(window.slice(at, at + HEX_PER_LINE).join(' '));
  }
  return lines;
}
