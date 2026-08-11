/*
 * What the scene does with a cue.
 *
 * `DemoScene.astro` owns every shape and every colour; this module owns where
 * things are and when they change. The split is the same one `stage-view.ts`
 * held: markup is built once at build time, and the browser only ever renames
 * a state or moves a node it was handed.
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
  /** Post-quantum key agreement. High value, so it is on by default. */
  readonly postQuantum: boolean;
  /** ML-KEM braid. Off by default — it is the newest and least settled. */
  readonly braid: boolean;
}

export const DEFAULT_TOGGLES: SceneToggles = {
  sealedSender: true,
  postQuantum: true,
  braid: false,
};

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
 * Keyed by step so that adding a step to the protocol forces a decision here
 * rather than silently leaving the envelope where it was. `null` means the
 * envelope is not on screen at that step.
 */
const ENVELOPE_AT: Partial<Record<Step, 'sender' | 'relay' | 'receiver' | null>> = {
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
  const notches = (side: Side) => need<HTMLElement>(root, `[data-scene-ratchet-notches="${side}"]`);
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

  function fillKeys(side: Side, count: number): void {
    const list = keyList(side);
    list.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const item = document.createElement('li');
      item.className = 'demo-key';
      list.append(item);
    }
  }

  function turnRatchet(side: Side, taken: number): void {
    const list = notches(side);
    /* Four is the design system's ratchet length, and the notches are rebuilt
       rather than toggled so a reset cannot leave a stale one lit. */
    list.replaceChildren();
    for (let index = 0; index < 4; index += 1) {
      const item = document.createElement('li');
      item.className = 'demo-ratchet-notch';
      item.dataset.turned = String(index < taken);
      list.append(item);
    }
  }

  function holdBundles(count: number): void {
    bundleBody.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      const item = document.createElement('span');
      item.className = 'demo-key';
      item.dataset.public = 'true';
      bundleBody.append(item);
    }
    bundleSlot.dataset.holding = String(count > 0);
    if (count === 0) {
      const empty = document.createElement('span');
      empty.className = 'demo-relay-slot-empty';
      empty.textContent = 'no bundles published';
      bundleBody.append(empty);
    }
  }

  const view: SceneView = {
    show(cue, flightMs) {
      root.dataset.sceneState = cue.step;
      envelope.style.setProperty('--demo-flight-ms', `${Math.max(0, Math.round(flightMs))}ms`);

      if (cue.keys) for (const side of ['a', 'b'] as const) fillKeys(side, cue.keys[side]);
      if (cue.ratchet) for (const side of ['a', 'b'] as const) turnRatchet(side, cue.ratchet[side]);
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

      const place = ENVELOPE_AT[cue.step] ?? null;
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
