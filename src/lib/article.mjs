/*
 * What an article is, apart from how it is drawn.
 *
 * The layout reads these, and so does tests/article-layout.test.mjs. Two
 * answers to "how long is this" — one in the layout and one in the test — is
 * the shape a drift takes, so both read the same function.
 */

/*
 * A reading pace, in words a minute.
 *
 * 200 is the low end of the measured adult range for technical prose, and the
 * low end is the honest one here: an article on this journal carries code
 * blocks and diagrams that a reader stops at. The figure is a floor on the
 * time, not a prediction of it.
 */
export const WORDS_PER_MINUTE = 200;

/*
 * The prose of an MDX body, without the parts a reader does not read at prose
 * pace.
 *
 * Fenced code, JSX tags, and the import block at the top are all in `body` and
 * none of them is a sentence. Counting them inflates the figure by the length
 * of the longest code block, which on this journal is most of a minute.
 */
export function proseWords(body) {
  const prose = body
    .replace(/^import[^\n]*$/gm, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<[^>]+>/g, ' ');
  return prose.split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word));
}

/** Minutes to read a body, rounded up, never zero. */
export function readingMinutes(body) {
  return Math.max(1, Math.ceil(proseWords(body).length / WORDS_PER_MINUTE));
}

/*
 * The journal's order: newest first, and the identifier breaks a tie.
 *
 * Every article on this journal published on the same day, so the date alone
 * leaves the order to whatever the loader returns. The index and the previous
 * and next links read this one function, because an index that disagrees with
 * the link under the article sends a reader back to the page they just left.
 */
export function byPublication(a, b) {
  const gap = b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf();
  return gap !== 0 ? gap : a.id.localeCompare(b.id);
}

/*
 * The article before and the article after, in reading order.
 *
 * `next` is the newer article and `previous` is the older one, which is the
 * direction the index reads in. Either is undefined at the end of the list.
 */
export function neighbors(posts, id) {
  const ordered = [...posts].sort(byPublication);
  const at = ordered.findIndex((post) => post.id === id);
  if (at === -1) return { next: undefined, previous: undefined };
  return { next: ordered[at - 1], previous: ordered[at + 1] };
}
