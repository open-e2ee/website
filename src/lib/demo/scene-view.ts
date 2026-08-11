/*
 * What the scene does with a cue.
 *
 * `DemoScene.astro` owns every shape and every colour; this module owns where
 * things are and when they change: markup is built once at build time, and the
 * browser only ever renames a state or moves a node it was handed.
 *
 * ---------------------------------------------------------------- travel ---
 *
 * The envelope's journey is the one piece of real animation on the page, and it
 * is a measured transform rather than a keyframe. Anchors are read from the
 * live layout, so the flight is correct at any column width and after any
 * reflow — a keyframe would encode a distance that is only true at one size.
 *
 * Flight time comes from the caller, which gets it from the reading clock in
 * `playback.ts`. It is deliberately not a duration token: tokens collapse to
 * near-zero under `prefers-reduced-motion`, and an envelope that teleports
 * would drop the one fact this animation exists to carry. Reduced motion drops
 * the easing instead, which `DemoScene.astro` handles in CSS.
 */

import type { Actor, Cue, Step } from './trace';

/** A device. The relay is not one, which is why it is not in this union. */
export type Side = 'a' | 'b';

/**
 * A cue, plus the things the scene has to draw that a cue may not carry.
 *
 * `trace.ts` strips every number out of a cue on purpose, so the presentation
 * extras a drawing needs are assembled by the console from the `TraceEvent` and
 * handed over here. Keeping them on a separate type is what stops a measurement
 * from arriving on the paced side of the page by accident.
 */
export interface SceneCue extends Cue {
  /** The sentence to show, and whose screen it belongs on. */
  readonly sentence?: { readonly side: Side; readonly text: string };
  /** Addressing the relay can read. Absent values are drawn as sealed. */
  readonly meta?: { readonly to?: string; readonly from?: string };
  /** How many message keys each device has derived. Turns the notches. */
  readonly ratchet?: Readonly<Record<Side, number>>;
  /**
   * Which ratchet the session selected, as the SDK reported it.
   *
   * Not a count and not a policy this page holds: it comes from the
   * `ProtocolSelectionEvent` raised when the keys were agreed, so the caption
   * under the wheel says what really ran rather than what the switches asked
   * for. Absent until a session exists, and the wheel is captioned plainly
   * until then — there is nothing to report about a ratchet with no session
   * behind it.
   */
  readonly ratchetKind?: 'double' | 'triple';
  /** How many public bundles the relay is holding. */
  readonly bundles?: number;
  /** How many private keys each device holds. */
  readonly keys?: Readonly<Record<Side, number>>;
}

export interface SceneNames {
  readonly a: string;
  readonly b: string;
}

export interface SceneToggles {
  /** Hide the sender from the relay. Draws the `from` field sealed. */
  readonly sealedSender: boolean;
  /**
   * Fail closed on post-quantum key agreement. On by default: it is the high
   * value and the SDK's own default. Off is `compatible`, which still runs
   * PQXDH against a peer that has ML-KEM material — it is not a way to turn the
   * post-quantum handshake off, and `DemoConsole.astro` says so on the page.
   */
  readonly postQuantum: boolean;
  /**
   * The ML-KEM Braid ratchet profile. Off selects the direct ML-KEM mode
   * instead, which is still the post-quantum ratchet. Off by default, as the
   * newest of the two modes.
   */
  readonly braid: boolean;
}

export const DEFAULT_TOGGLES: SceneToggles = {
  sealedSender: true,
  postQuantum: true,
  braid: false,
};

/**
 * The envelope fields sealed sender takes off the relay's copy.
 *
 * The one place in the demo that writes an envelope field name down rather than
 * iterating for it, and the only one that has to: the inspector's other rows are
 * whatever the envelope carries, but this is a *claim* about which of them a
 * sealed send would remove, and a claim has to name its subject.
 *
 * That makes it the demo's one silent-drift risk. A name here that no longer
 * matches the envelope does not throw and does not blank anything — the lens
 * simply marks nothing, the note underneath says "0 struck fields", and a page
 * that has stopped teaching its point still looks entirely correct.
 * `demo-run.test.mjs` holds these names against a real send for that reason.
 *
 * Exported from here rather than kept in the console so that a test can reach
 * it: a constant inside an `.astro` component is unreachable from Node, and one
 * that cannot be tested is one that drifts.
 */
export const SEALED_SENDER_HIDES: readonly string[] = ['senderUserId', 'senderDeviceId'];

export interface SceneView {
  show(cue: SceneCue, flightMs: number): void;
  clear(): void;
  setToggles(toggles: SceneToggles): void;
  /** Put a sentence on a device's screen. Used by the live conversation. */
  say(side: Side, text: string, mine: boolean, pending?: boolean): HTMLElement;
}

/**
 * Where the envelope rests at each stage of its journey.
 *
 * A total `Record` rather than a `Partial` one, and that is the whole guarantee:
 * a step added to `trace.ts` and forgotten here does not compile. A partial map
 * would fall through to `null`, hide the envelope, and draw a reader an empty
 * lane at the new step while every gate stayed green — the CSS valid, the markup
 * valid, and nothing in the type system with an opinion. `null` therefore means
 * *deliberately not on screen*, written down, rather than *not thought about*.
 *
 * Exported so `site-content.test.mjs` can also hold its keys against `STEPS` at
 * run time, which catches the same drift arriving from the other direction: a
 * step removed from the protocol and left behind here.
 */
export const ENVELOPE_AT: Record<Step, 'sender' | 'relay' | 'receiver' | null> = {
  idle: null,
  'devices-ready': null,
  'bundles-published': null,
  'session-established': null,
  encrypted: 'sender',
  'in-transit': 'relay',
  'stored-at-relay': 'relay',
  delivered: 'receiver',
  opened: 'receiver',
};

/** The steps at which the payload is closed to the relay. */
const SEALED_AT = new Set<Step>(['encrypted', 'in-transit', 'stored-at-relay', 'delivered']);

function need<E extends Element>(root: ParentNode, selector: string): E {
  const found = root.querySelector<E>(selector);
  if (!found) throw new Error(`demo scene: the markup is missing ${selector}`);
  return found;
}

export function mountScene(root: HTMLElement, names: SceneNames): SceneView {
  const envelope = need<HTMLElement>(root, '[data-scene-envelope]');
  const payloadText = need<HTMLElement>(root, '[data-scene-envelope-text]');
  const metaTo = need<HTMLElement>(root, '[data-scene-envelope-to]');
  const metaFrom = need<HTMLElement>(root, '[data-scene-envelope-from]');
  const mailbox = need<HTMLElement>(root, '[data-scene-slot="mailbox"]');
  const mailboxBody = need<HTMLElement>(root, '[data-scene-slot-body="mailbox"]');
  const bundleSlot = need<HTMLElement>(root, '[data-scene-slot="bundles"]');
  const bundleBody = need<HTMLElement>(root, '[data-scene-slot-body="bundles"]');

  const phone = (side: Side) => need<HTMLElement>(root, `[data-scene-device="${side}"] .demo-phone`);
  const chat = (side: Side) => need<HTMLElement>(root, `[data-scene-chat="${side}"]`);
  const keyList = (side: Side) => need<HTMLElement>(root, `[data-scene-keys-list="${side}"]`);
  const keyCount = (side: Side) => need<HTMLElement>(root, `[data-scene-keys-count="${side}"]`);
  const notches = (side: Side) => need<HTMLElement>(root, `[data-scene-ratchet-notches="${side}"]`);
  const ratchetCount = (side: Side) =>
    need<HTMLElement>(root, `[data-scene-ratchet-count="${side}"]`);
  const ratchetLabel = (side: Side) =>
    need<HTMLElement>(root, `[data-scene-ratchet-label="${side}"]`);
  const deviceState = (side: Side) =>
    need<HTMLElement>(root, `[data-scene-device-state="${side}"]`);

  let toggles = DEFAULT_TOGGLES;

  for (const side of ['a', 'b'] as const) {
    need<HTMLElement>(root, `[data-scene-name="${side}"]`).textContent = names[side];
  }

  /**
   * Put the envelope over an anchor, in the scene's own coordinates.
   *
   * Both rectangles are read in the same frame, so a page that has scrolled or
   * a column that has reflowed since the last cue lands correctly rather than
   * accumulating drift from a remembered position.
   */
  function moveTo(anchor: HTMLElement): void {
    const scene = root.getBoundingClientRect();
    const target = anchor.getBoundingClientRect();
    const box = envelope.getBoundingClientRect();
    const x = target.left - scene.left + (target.width - box.width) / 2;
    const y = target.top - scene.top + (target.height - box.height) / 2;
    envelope.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function anchorFor(place: 'sender' | 'relay' | 'receiver', cue: SceneCue): HTMLElement {
    /* Which device is the sender is a fact about the cue rather than a fixed
       side, because either device may start a conversation. */
    const from: Side = cue.from === 'b' ? 'b' : 'a';
    const to: Side = from === 'a' ? 'b' : 'a';
    if (place === 'relay') return mailbox;
    return phone(place === 'sender' ? from : to);
  }

  /**
   * How many key shapes stand for a store, however much is in it.
   *
   * A real device publishes two hundred and four public values here — an
   * identity pair, a signed prekey, a last-resort KEM prekey and a hundred
   * one-time prekeys of each kind. Drawing one shape each would be four hundred
   * shapes across the scene, which is not a diagram. The shapes are a motif
   * saying *key material lives here*, and the count beside them is the fact.
   * They are deliberately never a tally, and the caption never invites reading
   * them as one.
   */
  const KEY_MOTIF = 5;

  function fillKeys(side: Side, count: number): void {
    const list = keyList(side);
    list.replaceChildren();
    for (let index = 0; index < Math.min(count, KEY_MOTIF); index += 1) {
      const item = document.createElement('li');
      item.className = 'demo-key';
      list.append(item);
    }
    keyCount(side).textContent = String(count);
  }

  /** Teeth on the wheel. The design system's ratchet length. */
  const TEETH = 4;

  function turnRatchet(side: Side, taken: number): void {
    const list = notches(side);
    /*
     * The teeth cycle rather than fill. `taken` grows for as long as the
     * conversation does, and four teeth that simply lit up in order would be
     * solid from the fourth message on — a wheel that had stopped, which is the
     * one thing this drawing exists to deny. Cycling means the fifth message
     * shows one tooth again, and the wheel is visibly still turning.
     *
     * Rebuilt rather than toggled so a reset cannot leave a stale tooth lit.
     */
    const lit = taken === 0 ? 0 : ((taken - 1) % TEETH) + 1;
    list.replaceChildren();
    for (let index = 0; index < TEETH; index += 1) {
      const item = document.createElement('li');
      item.className = 'demo-ratchet-notch';
      item.dataset.turned = String(index < lit);
      list.append(item);
    }
    /* The total is the number that only ever grows, and it is the one a reader
       can check against how many messages they have sent. */
    ratchetCount(side).textContent = `${taken} key${taken === 1 ? '' : 's'}`;
  }

  /**
   * What the wheel is called before a session has been agreed.
   *
   * Read off the markup at mount rather than written here. A copy in this file
   * would go on saying whatever it said when it was copied, and `clear()` would
   * put back a word the component had stopped using.
   */
  const RATCHET_UNNAMED = ratchetLabel('a').textContent ?? '';

  /**
   * Caption both wheels with the ratchet the session selected.
   *
   * Both, from one event, because there is one session and both devices are in
   * it — the SDK raises the selection on the device that agreed the keys, and
   * what it selected is as true of the far end as of the near one. Captioning
   * only the initiator would draw two devices running different ratchets, which
   * is not a state this protocol has.
   *
   * `null` puts the neutral caption back, for a scene with no session behind it.
   */
  function nameRatchet(kind: 'double' | 'triple' | null): void {
    for (const side of ['a', 'b'] as const) {
      ratchetLabel(side).textContent = kind === null ? RATCHET_UNNAMED : `${kind} ratchet`;
    }
  }

  /*
   * The empty caption is kept and hidden rather than replaced and rebuilt.
   * Writing it here would put the relay's own wording in a second file, where
   * it would go on saying whatever it said when it was copied — the mailbox
   * below already does it this way, and the two slots are the same shape.
   */
  const bundleEmpty = need<HTMLElement>(bundleBody, '.demo-relay-slot-empty');

  function holdBundles(count: number): void {
    bundleBody.replaceChildren(bundleEmpty);
    for (let index = 0; index < Math.min(count, KEY_MOTIF); index += 1) {
      const item = document.createElement('span');
      item.className = 'demo-key';
      item.dataset.public = 'true';
      bundleBody.append(item);
    }
    if (count > 0) {
      const total = document.createElement('span');
      total.className = 'demo-relay-slot-count';
      total.textContent = String(count);
      bundleBody.append(total);
    }
    bundleSlot.dataset.holding = String(count > 0);
    bundleEmpty.toggleAttribute('hidden', count > 0);
  }

  const view: SceneView = {
    show(cue, flightMs) {
      root.dataset.sceneState = cue.step;
      envelope.style.setProperty('--demo-flight-ms', `${Math.max(0, Math.round(flightMs))}ms`);

      if (cue.keys) for (const side of ['a', 'b'] as const) fillKeys(side, cue.keys[side]);
      if (cue.ratchet) for (const side of ['a', 'b'] as const) turnRatchet(side, cue.ratchet[side]);
      /* Set at the step that agreed the keys and left alone after it: every
         later cue in the same session is still that session, and a caption
         cleared between steps would flicker the one fact this line carries. */
      if (cue.ratchetKind) nameRatchet(cue.ratchetKind);
      if (cue.bundles !== undefined) holdBundles(cue.bundles);

      if (cue.step === 'devices-ready') {
        for (const side of ['a', 'b'] as const) deviceState(side).textContent = 'online';
      }

      /* The mailbox holds a row only while the relay actually has one: it is
         filled when the envelope is stored and emptied when the far device has
         collected it, which is what makes the relay read as a mailbox rather
         than as a box the message passes through. */
      const holding = cue.step === 'in-transit' || cue.step === 'stored-at-relay';
      mailbox.dataset.holding = String(holding);
      mailboxBody.querySelector('.demo-relay-slot-empty')?.toggleAttribute('hidden', holding);

      const place = ENVELOPE_AT[cue.step];
      if (place === null) {
        envelope.hidden = true;
        return;
      }

      const sealed = SEALED_AT.has(cue.step);
      envelope.dataset.sealed = String(sealed);
      if (cue.sentence) payloadText.textContent = cue.sentence.text;
      if (cue.meta) {
        metaTo.textContent = cue.meta.to ?? '—';
        metaFrom.textContent = toggles.sealedSender ? '' : (cue.meta.from ?? '—');
        metaFrom.dataset.sealed = String(toggles.sealedSender);
      }

      const anchor = anchorFor(place, cue);
      if (envelope.hidden) {
        /* First appearance: place it without a transition, or it flies in from
           the scene's top-left corner, which is not a journey anything took. */
        envelope.dataset.flying = 'false';
        envelope.hidden = false;
        moveTo(anchor);
        /* Read back so the placement is committed before flight is re-armed. */
        void envelope.offsetWidth;
        envelope.dataset.flying = 'true';
        return;
      }
      envelope.dataset.flying = 'true';
      moveTo(anchor);
    },

    clear() {
      root.dataset.sceneState = 'idle';
      envelope.hidden = true;
      envelope.dataset.flying = 'false';
      envelope.style.removeProperty('transform');
      mailbox.dataset.holding = 'false';
      mailboxBody.querySelector('.demo-relay-slot-empty')?.removeAttribute('hidden');
      holdBundles(0);
      nameRatchet(null);
      for (const side of ['a', 'b'] as const) {
        chat(side).replaceChildren();
        fillKeys(side, 0);
        turnRatchet(side, 0);
        deviceState(side).textContent = 'offline';
      }
    },

    setToggles(next) {
      toggles = next;
      root.dataset.sceneSealedSender = String(next.sealedSender);
      root.dataset.scenePostQuantum = String(next.postQuantum);
      root.dataset.sceneBraid = String(next.braid);
      metaFrom.dataset.sealed = String(next.sealedSender);
    },

    say(side, text, mine, pending = false) {
      const item = document.createElement('li');
      item.className = 'demo-phone-bubble';
      item.dataset.mine = String(mine);
      item.dataset.pending = String(pending);
      item.textContent = text;
      const list = chat(side);
      list.append(item);
      list.scrollTop = list.scrollHeight;
      return item;
    },
  };

  view.setToggles(DEFAULT_TOGGLES);
  return view;
}

/** Which actor is a device, for callers turning a trace event into a cue. */
export function sideOf(actor: Actor): Side | null {
  return actor === 'a' || actor === 'b' ? actor : null;
}
