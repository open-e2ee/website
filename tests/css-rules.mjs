/*
 * Find one CSS rule by its exact selector.
 *
 * This is a shared module rather than a regex at each call site because
 * `/\.foo \{[^}]*\}/` is not a way to find the rule for `.foo`, and this suite
 * has learned that three separate times now — each time as a gate that passed
 * while measuring the wrong block.
 *
 * A selector appears as a *substring* of other selectors. `.battery-mark {`
 * is inside the grouped `.osi-mark, .ts-mark, .battery-mark {` and inside
 * `:root.dark .battery-mark {`. The first trap made a per-mark margin check
 * read the shared rule it was meant to be independent of. The second was worse:
 * an assertion that the light canvas takes a step on the verify ramp was being
 * satisfied by the dark rule two blocks below it, so reverting the light colour
 * outright failed nothing. Both were found by mutation and neither was
 * visible by reading the assertion.
 *
 * A regex per call site kept producing a new dress for the same bug, so the
 * knowledge lives here instead. Ordering is the other half of it: matching the
 * first occurrence in file order happens to be correct while the light rule
 * precedes the dark one, and stops being correct the day somebody moves a
 * block. Equality on a normalised selector does not care.
 *
 * Comments are stripped first — several comments in this stylesheet contain
 * braces, and a naive matcher swallows them into whichever selector precedes
 * them.
 *
 * This was a regex until it was caught doing the thing it exists to prevent.
 * `/([^{}]*)\{([^}]*)\}/g` cannot see the *first* rule inside any `@media`
 * block: `[^}]*` runs from the block's opening brace to the first `}` in the
 * file, so the media prelude and that rule are returned as one entry whose
 * selector is `@media (min-width: 40rem)` and whose body is `.first { color:
 * red;`. Later rules in the same block come back correctly, which is why the
 * blind spot survived this long. `ruleFor` answered "found 0" for such a
 * selector, and a `.filter(r => r.selector === ...)` gate found nothing.
 *
 * Measured on this stylesheet with a `.code-adapters { display: none }` written
 * as the first rule of a media block: the regex counts one `.code-adapters`
 * and the walker counts two, so a `ruleFor` gate passed on the desktop rule
 * while the override sat above it. No existing gate was reading a swallowed
 * rule — the suite is unchanged at 129 passing with the walker in place, which
 * it would not be if one had been.
 *
 * So it is a brace walker now. At-rules that take a block are descended into
 * rather than returned, which is what makes a rule inside a media query
 * indistinguishable from one outside it — the caller is asking "what does this
 * selector declare", and this module's whole job is that the answer is not
 * quietly the wrong block. A caller that needs the condition as well should
 * match the query in the source, as the install-command gate does.
 */

const walk = (css, out) => {
  let prelude = '';
  let i = 0;
  while (i < css.length) {
    const char = css[i];
    if (char === '{') {
      let depth = 1;
      let end = i + 1;
      while (end < css.length && depth > 0) {
        if (css[end] === '{') depth += 1;
        else if (css[end] === '}') depth -= 1;
        end += 1;
      }
      const block = css.slice(i + 1, end - 1);
      const selector = prelude.trim().replace(/\s+/g, ' ');
      /* `@media` and friends wrap rules; `@font-face` and `@page` declare. The
         stylesheet has only `@media` and statement-form `@import`, so the
         distinction is drawn by whether the block contains a rule rather than
         by an allow-list that would need maintaining. */
      if (selector.startsWith('@') && /\{/.test(block)) walk(block, out);
      else out.push({ selector, body: block });
      prelude = '';
      i = end;
      continue;
    }
    /* A statement at-rule — `@import ...;` — ends without a block. */
    if (char === ';' && prelude.trimStart().startsWith('@')) {
      prelude = '';
      i += 1;
      continue;
    }
    if (char === '}') {
      prelude = '';
      i += 1;
      continue;
    }
    prelude += char;
    i += 1;
  }
  return out;
};

const rulesIn = (css) => walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), []);

/* Every rule in the stylesheet, selectors normalised to one line. Rules inside
   `@media` blocks are included, at their own selector. */
export const cssRules = rulesIn;

/*
 * The body of the one rule with this exact selector.
 *
 * Throws when there is no such rule or more than one, rather than returning
 * null or the first: a selector that has silently split into two rules is the
 * state most of these assertions exist to catch, and a helper that quietly
 * picked one would hide it. `assert` is deliberately not imported here — the
 * caller gets a plain Error, which `node:test` reports the same way.
 */
export const ruleFor = (css, selector) => {
  const found = rulesIn(css).filter((rule) => rule.selector === selector);
  if (found.length !== 1) {
    throw new Error(`expected exactly one \`${selector}\` rule, found ${found.length}`);
  }
  return found[0].body;
};
