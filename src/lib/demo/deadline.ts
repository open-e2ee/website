/*
 * Waiting on a relay, with an end to it.
 *
 * Every demo surface here ends up awaiting something a relay owes it — the
 * stored envelope, the decrypted message, an answer from the tab that holds
 * the relay. In one tab over `inMemoryRelay()` all of those have already
 * arrived by the time they are awaited, because that relay delivers to its
 * subscriber inside `send()`. Nothing that crosses anything can promise that.
 *
 * A bare `await` on a relay is therefore the worst failure this site has
 * available. It is not an exception, not a rejection, not a console line: it
 * is a spinner that runs until the reader closes the tab, and it shipped once
 * already. So the wait lives here, bounded, and reaching the bound is an
 * ordinary rejection that the surface above renders like any other failure.
 *
 * Loud and early beats silent and stuck. A deadline that fires when it should
 * not costs a reader one confusing message; one that never fires costs them
 * the page.
 */

/**
 * Wait for `promise`, or reject saying what never came.
 *
 * @param what named in the failure, so the message says which wait ended
 */
export function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`the relay never delivered ${what} (waited ${ms}ms)`)),
      ms,
    );
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}
