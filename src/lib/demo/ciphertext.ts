/*
 * The bytes behind `envelope.ciphertext`.
 *
 * A module of its own rather than a helper in the component that uses it,
 * because what it states is a fact about the SDK's output rather than about
 * any drawing: `run.ts` measures every stored row with it, and the byte count
 * the relay prints is this function's answer.
 *
 * ---------------------------------------------------------------- peeling ---
 *
 * `envelope.ciphertext` is base64 of base64. The SDK serializes the encrypted
 * message to a base64 document and the relay row carries that document base64
 * encoded again, so a single `atob` returns 2,649 bytes of *base64 characters*
 * — and a byte count taken from those measures the encoding rather than the
 * ciphertext. That is what the first cut of this figure printed.
 *
 * The peel is adaptive rather than a hard-coded two, so a build of the SDK that
 * stops double-encoding keeps working: a layer is peeled only while the bytes
 * that came out are themselves a well-formed base64 document. Real ciphertext is
 * ~2,000 bytes of AEAD output and the chance of every one of them landing in a
 * 65-character alphabet is nil, so the loop stops at the true bytes.
 */

/* One extra peel over the two the SDK does today, and no more: the guard below
   is a heuristic, and a document that keeps satisfying it forever would spin. */
const MAX_LAYERS = 3;

const decode = (text: string): Uint8Array | null => {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  /* Whole quanta only: trimming to a multiple of four makes a prefix of the
     document decode to a prefix of the bytes, so a truncated envelope still
     measures rather than failing the decode. */
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
