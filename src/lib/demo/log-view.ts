/*
 * The event log's logic, with no DOM in it.
 *
 * `DemoLog.astro` is the only thing here that touches an element, and it is
 * thin because of it: everything a reader can see the log do — the row a
 * `TraceEvent` becomes, whether a row survives a filter — is a plain function
 * of a `TraceEvent` and a string, so it is tested here rather than through a
 * mounted component.
 */

import type { Actor, Step, TraceEvent } from './trace.ts';

/** One row of the log, already turned into the text a reader sees. */
export interface LogRow {
  /** Milliseconds since the run started, to one decimal. Real time, not a display frame. */
  readonly at: string;
  readonly step: Step;
  readonly actor: Actor;
  readonly summary: string;
  readonly measures?: TraceEvent['measures'];
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`;
}

/** A sentence trimmed to one line; the code pane and the bubble show it in full. */
function excerpt(text: string, max = 60): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * One human sentence for an event, read from the `detail`/`measures` shapes
 * `run.ts` actually appends — not a description of what a step generically
 * means, which is how a summary quietly stops matching the recording.
 */
export function summarise(event: TraceEvent): string {
  const measures = event.measures ?? {};

  switch (event.step) {
    case 'idle':
      return 'Nothing recorded yet.';

    case 'devices-ready': {
      const detail = event.detail as { userId?: string; deviceId?: number } | undefined;
      const who = detail?.userId ?? event.actor;
      return `${who} came up as device ${detail?.deviceId ?? '?'} (${ms(measures.bootMs ?? 0)}).`;
    }

    case 'bundles-published':
      return `Published its prekey bundle to the relay (${ms(measures.publishMs ?? 0)}).`;

    case 'session-established': {
      /* `selection` is nullable in the trace itself — see run.ts — and a
         summary that assumed it existed would throw on the one run where the
         callback did not fire, which is exactly the run worth seeing. */
      const detail = event.detail as
        | {
            selection?: {
              usedPQXDH?: boolean;
              usedClassicalFallback?: boolean;
              usedTripleRatchet?: boolean;
            } | null;
          }
        | undefined;
      const selection = detail?.selection;
      const agreement = selection
        ? selection.usedClassicalFallback
          ? 'classical fallback'
          : selection.usedPQXDH
            ? 'PQXDH'
            : 'key agreement'
        : 'key agreement';
      /* The handshake and the ongoing ratchet are two separate choices and the
         event reports them separately, so the line names both rather than
         letting "PQXDH" stand in for a ratchet it says nothing about. Omitted
         when the event did not say, which is not the same as saying no. */
      const ratchet =
        typeof selection?.usedTripleRatchet === 'boolean'
          ? `, ${selection.usedTripleRatchet ? 'triple' : 'double'} ratchet`
          : '';
      return `Session established with ${event.to ?? 'the other device'} — ${agreement}${ratchet} (${ms(measures.establishMs ?? 0)}).`;
    }

    case 'encrypted': {
      const detail = event.detail as { text?: string } | undefined;
      const text = typeof detail?.text === 'string' ? excerpt(detail.text) : '';
      return `Encrypted "${text}" (${ms(measures.encryptMs ?? 0)}).`;
    }

    case 'in-transit':
      return `Envelope travelling to the relay, addressed to ${event.to ?? 'the other device'}.`;

    case 'stored-at-relay':
      return `Relay stored the envelope (${measures.ciphertextBytes ?? 0} bytes).`;

    case 'delivered':
      return `Relay handed the envelope to ${event.to ?? 'the other device'}.`;

    case 'opened': {
      const detail = event.detail as { decrypted?: { content?: string } } | undefined;
      const text = typeof detail?.decrypted?.content === 'string' ? excerpt(detail.decrypted.content) : '';
      return `Decrypted "${text}" (round trip ${ms(measures.roundTripMs ?? 0)}).`;
    }

    default: {
      /* Exhaustive by construction: a step added to the union without a case
         above is a type error here, not a blank row a reader finds. */
      const unreachable: never = event.step;
      throw new Error(`log-view: no summary for step ${unreachable}`);
    }
  }
}

/** A `TraceEvent`, as the row the log displays. */
export function formatEvent(event: TraceEvent, startedAtMs: number): LogRow {
  return {
    at: (event.atMs - startedAtMs).toFixed(1),
    step: event.step,
    actor: event.actor,
    summary: summarise(event),
    ...(event.measures === undefined ? {} : { measures: event.measures }),
  };
}

/**
 * Whether a row survives a search query.
 *
 * An empty or whitespace-only query matches everything, so clearing the
 * search box is what it looks like — showing the whole log — rather than a
 * query nothing can match.
 */
export function matches(row: LogRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [row.step, row.actor, row.summary].some((field) => field.toLowerCase().includes(needle));
}
