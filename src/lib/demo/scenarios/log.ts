/*
 * What the SDK said, kept as it said it.
 *
 * Every scenario on `/demo` prints the receiving side's own log rather than a
 * description of it, and for the same reason: `onDecryptionError` is documented
 * as "called when decryption fails" and is never reached on the relay
 * subscription path, so the `ILogger` each client is given is the only surface
 * on which the interesting half of a run is visible at all. That was found once
 * — an early draft of the corrupted-message scenario registered the hook, got an
 * empty callback list, and would have shipped a page that showed nothing at the
 * moment it had the most to show — and it is a fact about the SDK rather than
 * about any one scenario, which is why the capture lives here.
 *
 * A record is kept whole: the message, and whatever the SDK passed beside it, in
 * the order it passed it. Nothing is reshaped into a form the page finds
 * convenient, because the page's claim is that this is the SDK talking.
 */

import type { ILogger } from '@open-e2ee/signal-protocol-sdk';

/** The levels a scenario keeps. `debug` is counted, not kept — see below. */
export type ScenarioLevel = 'info' | 'warn' | 'error';

export interface ScenarioLogRecord {
  /**
   * Which device spoke, in the scenario's own words for its devices.
   *
   * A free string rather than a fixed pair: the accounts in a scenario are the
   * scenario's business, and one that links a second device has three of them
   * to tell apart.
   */
  role: string;
  level: ScenarioLevel;
  message: string;
  /** Whatever the SDK passed alongside the message, in the order it passed it. */
  payload: unknown[];
}

export interface ScenarioLog {
  /** Every record at info and above, from every device, in logging order. */
  readonly records: ScenarioLogRecord[];
  /** How many records the SDK emitted at debug, which are not kept. */
  readonly debugRecords: number;
  /** A logger to hand one client, tagging everything it says with `role`. */
  for(role: string): ILogger;
}

/**
 * One log for a whole scenario, with a logger per device writing into it.
 *
 * `debug` is accepted and counted rather than left off. The SDK fills a missing
 * method in with its own default, which would put sixty-odd lines in the
 * reader's console that the page then does not account for.
 */
export function captureScenarioLog(): ScenarioLog {
  const records: ScenarioLogRecord[] = [];
  let debugRecords = 0;

  return {
    records,
    get debugRecords() {
      return debugRecords;
    },
    for(role: string): ILogger {
      const at =
        (level: ScenarioLevel) =>
        (message: string, ...payload: unknown[]) => {
          records.push({ role, level, message, payload: payload.filter((p) => p !== undefined) });
        };
      return {
        debug: () => {
          debugRecords += 1;
        },
        info: at('info'),
        warn: at('warn'),
        error: at('error'),
      };
    },
  };
}

/** A payload rendered as text, without letting a cyclic object throw. */
export function describePayload(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
