/**
 * The same ciphertext with one byte flipped near its end, where the message
 * authentication code covers it. The receiving device fails to authenticate
 * the message and asks the sender for a retry. A replaced ciphertext does not
 * do that: the SDK refuses a malformed envelope and asks for nothing.
 *
 * The envelope carries base64 of a base64 string, so both layers are undone
 * and redone.
 */
export function flipOneByte(ciphertext) {
  const bytes = [...atob(atob(ciphertext))];
  const index = bytes.length - 20;
  bytes[index] = String.fromCharCode(bytes[index].charCodeAt(0) ^ 1);
  return btoa(btoa(bytes.join('')));
}
