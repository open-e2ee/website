/*
 * The narrow screen's demo: a recording, projected down to what a phone can
 * hold.
 *
 * Under 60rem the console disappears — no controls, no log, no readings — and
 * what remains has to make the one claim the demo exists for: the same
 * conversation is sentences on the phones and only ciphertext on the relay.
 * This module owns that projection. `DemoMobile.astro` runs the scripted
 * conversation once through the real SDK at full speed, hands the finished
 * recording here, and gets back a flat list of frames it can loop forever at
 * reading pace. Nothing here touches the DOM and nothing here runs protocol:
 * it reads `TraceEvent`s and returns captions and placements.
 *
 * The two-clock rule survives the trip. A frame carries `bytes` — the one
 * measurement the drawing cannot do without, `SceneCue.bytes`'s own exception,
 * because a sealed slab printing a size must print the size the recording
 * measured — and no duration. The dwells live in `MOBILE_DWELL_MS`, keyed by
 * frame kind, presentation numbers with a presentation owner.
 *
 * The overture tells the registration story whole, one step per frame per
 * device: register, generate keys, publish the prekey bundle, then the key
 * agreement that names the ratchet the SDK selected. What it drops from the
 * console is the apparatus, not the protocol — no repeat publishes (every
 * send tops the shelf back up), because the same step said twice teaches
 * nothing a loop this small can afford.
 *
 * Three frames carry the recording's own device-cost measures alongside their
 * placements — key generation on the last `generating-keys` report (`run.ts`
 * accumulates the windows and attaches the total there), encryption on each
 * `encrypted`, decryption on a steady-state `opened`. A first opening's span
 * is the key agreement's too (`establishMs`), and the phone module has no
 * agreement row to mark that sharing on, so the frame carries nothing and the
 * reading fills when a later arrival prices decryption alone.
 */

import type { TraceEvent } from './trace.ts';
import { humanBytes } from './units.ts';

/** A device. The relay is not one — same rule as `scene-view.ts`. */
export type MobileSide = 'a' | 'b';

export interface MobileNames {
  readonly a: string;
  readonly b: string;
}

/**
 * One frame of the loop: what to place, and the caption line under it.
 *
 * Every number on a frame is one the recording measured: `bytes` off a real
 * envelope, `keys` off the SDK's own key-generation and publish reports.
 * Every other field is a string or a side — the console's five-field cue
 * invariant, narrowed to the fields this drawing needs.
 */
export type MobileFrame =
  /** Loop start: both screens dark, the mailboxes bare. */
  | { readonly kind: 'reset'; readonly caption: string }
  /** A device registers: the relay opens its account and mailbox. */
  | { readonly kind: 'register'; readonly side: MobileSide; readonly caption: string }
  /** The device generates its identity and prekeys, locally. */
  | {
      readonly kind: 'keygen';
      readonly side: MobileSide;
      readonly keys?: number;
      /** The whole generation's measured cost — the run's accumulated total,
          off the same report that carries the final count. */
      readonly ms?: number;
      readonly caption: string;
    }
  /** The public halves go up: a prekey bundle lands in the owner's mailbox. */
  | {
      readonly kind: 'publish';
      readonly side: MobileSide;
      readonly keys?: number;
      readonly caption: string;
    }
  /** The session exists, on the ratchet the SDK reports it selected. */
  | {
      readonly kind: 'session';
      readonly ratchet: 'double' | 'triple';
      /** The prekey the agreement consumed: one key leaves the responder's
          published bundle for the initiator's ratchet. */
      readonly spend?: { readonly from: MobileSide; readonly to: MobileSide };
      readonly caption: string;
    }
  /** A sentence, on its author's own screen — and the sealing: the two
      message keys lock the envelope, which wears the sealed size. */
  | {
      readonly kind: 'sent';
      readonly side: MobileSide;
      readonly text: string;
      readonly bytes?: number;
      /** Sealing this message on this device, to the transport hand-off. */
      readonly encryptMs?: number;
      readonly caption: string;
    }
  /** The sealed envelope travels device → the recipient's mailbox. */
  | {
      readonly kind: 'cross';
      readonly from: MobileSide;
      readonly to: MobileSide;
      readonly bytes?: number;
      readonly caption: string;
    }
  /** The relay files the row it cannot open, in the recipient's mailbox. */
  | {
      readonly kind: 'stored';
      readonly to: MobileSide;
      readonly bytes?: number;
      readonly caption: string;
    }
  /** The envelope travels mailbox → its owner's device. */
  | {
      readonly kind: 'deliver';
      readonly to: MobileSide;
      readonly bytes?: number;
      readonly caption: string;
    }
  /** The device decrypts: the sentence appears on the second screen. */
  | {
      readonly kind: 'opened';
      readonly side: MobileSide;
      readonly text: string;
      /** Opening one arrived envelope, arrival to plaintext. Absent on a
          first opening, whose one interval is the key agreement's span. */
      readonly decryptMs?: number;
      readonly caption: string;
    };

/**
 * How long each kind of frame is held, in milliseconds of presentation.
 *
 * Constants and not duration tokens, for `playback.ts`'s reason: `tokens.css`
 * collapses the tokens under `prefers-reduced-motion`, and a reader who asked
 * for less motion should lose the motion, not the time to read each frame.
 */
export const MOBILE_DWELL_MS: Readonly<Record<MobileFrame['kind'], number>> = {
  reset: 2200,
  register: 1800,
  keygen: 1900,
  publish: 1900,
  /* The session and the message frames carry the console's own dwells —
     `STEP_DWELL_MS` in `playback.ts` — because the two figures tell one story
     and a reader who has watched either has learned its pace. The overture
     frames above keep their own: the console spreads that stretch over steps
     this reel does not have. */
  session: 3200,
  sent: 3200,
  cross: 2200,
  stored: 1800,
  deliver: 1400,
  /* The one departure from the console's table: the opened frame pays the
     packet's expansion and the tile's fold into the bubble inside its own
     dwell — beats the wide scene spreads over neighbouring steps — so it
     holds 200ms longer than the console's `opened` to fit them around the
     key flights. Sized like the console sizes its dwells: the sum of the
     frame's beats, not a round number. */
  opened: 3800,
};

/**
 * The conversation the loop runs, in order. Short lines, because a bubble on
 * a narrow pane has one line to be legible in — and a conversation someone
 * would plainly want private, because that is the product.
 */
export const MOBILE_SCRIPT: readonly { readonly from: MobileSide; readonly text: string }[] = [
  { from: 'a', text: 'Did the results come back?' },
  { from: 'b', text: 'Just now. All clear.' },
  { from: 'a', text: 'Can you send them over?' },
  { from: 'b', text: 'On the way.' },
];

const side = (actor: TraceEvent['actor'] | TraceEvent['from']): MobileSide | null =>
  actor === 'a' || actor === 'b' ? actor : null;

/**
 * A finished recording as a loop of frames.
 *
 * A projection and nothing else, `toCue`'s discipline: every sentence comes
 * off the event that carried it, every byte count off the event's own measure,
 * every key count off the event's own detail, and nothing is invented between
 * events. Events the drawing has no frame for — partial key-generation
 * reports, transit intervals, repeat publishes — are passed over rather than
 * summarised, because a caption describing an event it was not derived from
 * is the drift this demo was built to make impossible.
 */
export function buildMobileReel(
  events: readonly TraceEvent[],
  names: MobileNames,
): MobileFrame[] {
  const frames: MobileFrame[] = [
    {
      kind: 'reset',
      caption: 'A real run, recorded in this tab and replayed at reading pace.',
    },
  ];
  const published = new Set<MobileSide>();

  for (const event of events) {
    const detail = (event.detail ?? {}) as Record<string, unknown>;

    if (event.step === 'registered') {
      const who = side(event.actor);
      if (who) {
        frames.push({
          kind: 'register',
          side: who,
          caption: `${names[who]}’s device registers — the relay opens a mailbox.`,
        });
      }
    }

    if (event.step === 'generating-keys') {
      const who = side(event.actor);
      /* One frame per device: the last report, the one whose running count
         has reached the run's total. */
      if (who && detail.keypairs === detail.total) {
        frames.push({
          kind: 'keygen',
          side: who,
          ...(typeof detail.total === 'number' ? { keys: detail.total } : {}),
          ...(typeof event.measures?.keygenMs === 'number'
            ? { ms: event.measures.keygenMs }
            : {}),
          caption:
            typeof detail.total === 'number'
              ? `${names[who]} generates ${detail.total} key pairs, on the device.`
              : `${names[who]} generates keys, on the device.`,
        });
      }
    }

    if (event.step === 'bundles-published') {
      const who = side(event.actor);
      if (who && !published.has(who)) {
        published.add(who);
        frames.push({
          kind: 'publish',
          side: who,
          ...(typeof detail.publicKeys === 'number' ? { keys: detail.publicKeys } : {}),
          caption:
            typeof detail.publicKeys === 'number'
              ? `${names[who]} uploads ${detail.publicKeys} public prekeys. Nothing private leaves.`
              : `${names[who]} uploads the prekey bundle — public keys only.`,
        });
      }
    }

    if (event.step === 'session-established') {
      const selection = detail.selection as { usedTripleRatchet?: unknown } | undefined;
      const ratchet = selection?.usedTripleRatchet === true ? 'triple' : 'double';
      /* The agreement consumes one of the responder's published prekeys —
         the wide scene's spend, in its direction: the key leaves the
         recipient's bundle for the initiator's ratchet. */
      const initiator = side(event.from);
      const responder = side(event.to);
      frames.push({
        kind: 'session',
        ratchet,
        ...(initiator && responder ? { spend: { from: responder, to: initiator } } : {}),
        caption: `PQXDH spends a prekey — the ${ratchet} ratchet runs on both devices.`,
      });
    }

    if (event.step === 'encrypted') {
      const from = side(event.from);
      const to = side(event.to);
      const text = typeof detail.text === 'string' ? detail.text : null;
      if (from && to && text !== null) {
        const bytes =
          typeof event.measures?.ciphertextBytes === 'number'
            ? event.measures.ciphertextBytes
            : undefined;
        frames.push({
          kind: 'sent',
          side: from,
          text,
          ...(bytes === undefined ? {} : { bytes }),
          ...(typeof event.measures?.encryptMs === 'number'
            ? { encryptMs: event.measures.encryptMs }
            : {}),
          caption: `${names[from]}’s message keys seal the envelope — the ratchet steps.`,
        });
        frames.push({
          kind: 'cross',
          from,
          to,
          ...(bytes === undefined ? {} : { bytes }),
          caption: 'Only ciphertext leaves the phone.',
        });
      }
    }

    if (event.step === 'stored-at-relay') {
      const to = side(event.to);
      if (to) {
        const bytes =
          typeof event.measures?.ciphertextBytes === 'number'
            ? event.measures.ciphertextBytes
            : undefined;
        frames.push({
          kind: 'stored',
          to,
          ...(bytes === undefined ? {} : { bytes }),
          caption:
            bytes === undefined
              ? `${names[to]}’s mailbox holds a row the relay cannot read.`
              : `${names[to]}’s mailbox holds ${humanBytes(bytes)} the relay cannot read.`,
        });
      }
    }

    if (event.step === 'opened') {
      const to = side(event.to);
      const opened = detail.decrypted as { content?: unknown } | undefined;
      const text = typeof opened?.content === 'string' ? opened.content : null;
      if (to && text !== null) {
        /* The envelope the relay filed is the envelope that arrives, so the
           delivery wears the size the storing step measured — the last row
           filed in this recipient's mailbox, because the relay hands rows
           over in the order it took them. */
        const stored = [...frames]
          .reverse()
          .find((f) => f.kind === 'stored' && f.to === to);
        frames.push({
          kind: 'deliver',
          to,
          ...(stored?.kind === 'stored' && stored.bytes !== undefined
            ? { bytes: stored.bytes }
            : {}),
          caption: `${names[to]}’s device fetches the envelope.`,
        });
        frames.push({
          kind: 'opened',
          side: to,
          text,
          ...(typeof event.measures?.decryptMs === 'number'
            ? { decryptMs: event.measures.decryptMs }
            : {}),
          caption: `${names[to]}’s message keys open the envelope — decrypted on the device.`,
        });
      }
    }
  }

  return frames;
}
