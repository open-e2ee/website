/*
 * When the SDK is allowed to arrive, and what the page says while it has not.
 *
 * This module is the only part of the demo that ships in the homepage's
 * pre-interaction payload, so it deliberately knows nothing about the protocol:
 * everything that touches `@open-e2ee/signal-protocol-sdk` lives behind the
 * dynamic `import()` below, in `./driver`. LD0 measured that payload at 713 KB
 * gzip of real network transfer, against a homepage budget of 10 KB before a
 * reader asks for anything (invariant 7). One static import from a page script
 * would spend the whole budget at first paint.
 *
 * The states are explicit because invariant 6 makes them load-bearing: the
 * recorded capture panel is the no-JS, unsupported-browser and load-failure
 * state, and a page can only leave it in place if the loader admits that the
 * chunk never came. A rejected `import()` that disappears into an unhandled
 * rejection would leave a spinner on the page forever, which is the "broken
 * live demo rendering as a broken page" that invariant forbids.
 */

import type { DemoSession, DemoSessionOptions } from './driver';

/** The shape of the chunk. Type-only, so importing it costs no bytes here. */
export interface DemoDriverModule {
  startDemoSession(options?: DemoSessionOptions): Promise<DemoSession>;
}

export type DemoLoaderState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; module: DemoDriverModule }
  | { status: 'failed'; error: Error };

export interface DemoLoader {
  /** What the page should be showing right now. */
  readonly state: DemoLoaderState;
  /**
   * Watch the state. The listener is called immediately with the current
   * state, so a subscriber that arrives after loading began still renders the
   * right thing, and again on every change.
   *
   * @returns a function that stops delivery to this listener
   */
  subscribe(listener: (state: DemoLoaderState) => void): () => void;
  /**
   * Fetch the chunk. Safe to call from both activation triggers and from
   * repeat interactions: one import is shared by every concurrent caller and
   * reused once it resolves. A failed load is not cached — the next call tries
   * again, because a chunk lost to a flaky connection is worth asking for
   * twice.
   */
  load(): Promise<DemoDriverModule>;
}

/**
 * @param importDriver - how to fetch the driver chunk. The default is the
 *   real dynamic import; tests pass their own, because a node process has no
 *   chunk to fetch or to block. The specifier is proven in a real browser by
 *   `scripts/demo-driver-check.mjs`.
 */
export function createDemoLoader(
  importDriver: () => Promise<DemoDriverModule> = () => import('./driver'),
): DemoLoader {
  let state: DemoLoaderState = { status: 'idle' };
  let inFlight: Promise<DemoDriverModule> | null = null;
  const listeners = new Set<(state: DemoLoaderState) => void>();

  /* One listener that throws must not strand the others or the state machine:
   * LD2 renders from these callbacks, and a render error is the page's
   * problem, not the loader's. */
  const deliver = (listener: (state: DemoLoaderState) => void, next: DemoLoaderState) => {
    try {
      listener(next);
    } catch {
      /* the subscriber's own failure, reported through its own surface */
    }
  };

  const publish = (next: DemoLoaderState) => {
    state = next;
    for (const listener of [...listeners]) deliver(listener, next);
  };

  return {
    get state() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      deliver(listener, state);
      return () => listeners.delete(listener);
    },

    load() {
      if (state.status === 'ready') return Promise.resolve(state.module);
      if (inFlight) return inFlight;

      publish({ status: 'loading' });
      inFlight = importDriver().then(
        (module) => {
          inFlight = null;
          publish({ status: 'ready', module });
          return module;
        },
        (cause: unknown) => {
          inFlight = null;
          const error = cause instanceof Error ? cause : new Error(String(cause), { cause });
          publish({ status: 'failed', error });
          throw error;
        },
      );
      return inFlight;
    },
  };
}
