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
  /** How many message keys each device has derived. Turns the wheel. */
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
  /**
   * How many bytes of ciphertext the relay stored, off the trace's own measure.
   *
   * Carried on the cue rather than read when the cue plays, for the reason the
   * ratchet count above is: the protocol runs well ahead of the reader, and a
   * drawing that reached for the current row would size this message's envelope
   * to whichever one the relay had taken most recently. It arrives only on the
   * step that stores a row, because that is the only step at which a byte count
   * is a fact rather than a guess about one.
   */
  readonly bytes?: number;
  /** How many private keys each device holds. */
  readonly keys?: Readonly<Record<Side, number>>;
}

export interface SceneNames {
  readonly a: string;
  readonly b: string;
}

/*
 * The two switches the reader may throw.
 *
 * Post-quantum protection is not among them, and its absence is a decision
 * rather than an omission. The SDK's post-quantum setting is `required` or
 * `compatible`, and `compatible` is not "off" — it still runs PQXDH against any
 * peer carrying ML-KEM material, which both devices here do. A checkbox marked
 * post-quantum would therefore have drawn a difference the run does not contain.
 * The demo runs `required` and shows the protection where it is real: in the
 * PQXDH key agreement, and in the wheel captioned with the ratchet the SDK
 * reports it selected.
 */
export interface SceneToggles {
  /** Hide the sender from the relay. Draws the `from` field sealed. */
  readonly sealedSender: boolean;
  /**
   * Braid: carry the post-quantum key material in bounded chunks rather than
   * whole.
   *
   * What gets broken up is the ML-KEM material, not the reader's sentence. The
   * braid mode moves an encapsulation key through Reed-Solomon chunks of
   * thirty-two bytes, one riding along with each message, so a rekey completes
   * across a conversation instead of demanding one large message from a link
   * that may not carry it. Off sends the key whole in a single message, which is
   * the direct mode — post-quantum either way.
   */
  readonly braid: boolean;
}

export const DEFAULT_TOGGLES: SceneToggles = {
  sealedSender: true,
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

/**
 * The rule the stored row's size is drawn against, in bytes.
 *
 * Fixed, and that is the whole of why it exists. The comparison this drawing is
 * for is between two runs — the same sentence sent with the braid switch off
 * and with it on — and a rule that took its length from the largest row of the
 * run it was drawing would give those two runs different rules. The wider bar
 * would still be wider, but by the wrong amount: two runs whose envelopes stand
 * at nine to one would be drawn at closer to five. A fixed rule means the same
 * byte count is the same width in every run the page ever draws, which is the
 * only way a reader can compare one against a run they have already seen.
 *
 * Four kilobytes because everything a run produces fits under it with room to
 * spare: the largest envelope is the one that agrees the keys, at around three
 * and a tenth, and the sentences after it are smaller in both settings. A row
 * that ever passed the rule is drawn full and marked rather than quietly
 * clipped — `drawSize` below, and the figure beside the bar is the true count
 * either way.
 */
const SIZE_RULE_BYTES = 4096;

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
  const sizeRow = need<HTMLElement>(root, '[data-scene-size]');
  const sizeBar = need<HTMLElement>(root, '[data-scene-size-bar]');
  const sizeFigure = need<HTMLElement>(root, '[data-scene-size-figure]');

  const phone = (side: Side) => need<HTMLElement>(root, `[data-scene-device="${side}"] .demo-phone`);
  const chat = (side: Side) => need<HTMLElement>(root, `[data-scene-chat="${side}"]`);
  const keyList = (side: Side) => need<HTMLElement>(root, `[data-scene-keys-list="${side}"]`);
  const keyCount = (side: Side) => need<HTMLElement>(root, `[data-scene-keys-count="${side}"]`);
  const wheel = (side: Side) => need<SVGElement>(root, `[data-scene-ratchet-wheel="${side}"]`);
  const wheelTurn = (side: Side) => need<SVGElement>(root, `[data-scene-ratchet-turn="${side}"]`);
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
    /*
     * Scale is a variable the stylesheet owns and position is a number this
     * function measures, and they compose in one transform because the browser
     * gives an element only one. Writing `translate()` alone here would drop the
     * landing's scale every time the envelope moved.
     */
    envelope.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(var(--demo-envelope-scale, 1))`;
  }

  function anchorFor(place: 'sender' | 'relay' | 'receiver', cue: SceneCue): HTMLElement {
    /* Which device is the sender is a fact about the cue rather than a fixed
       side, because either device may start a conversation. */
    const from: Side = cue.from === 'b' ? 'b' : 'a';
    const to: Side = from === 'a' ? 'b' : 'a';
    if (place === 'relay') return mailbox;
    if (place === 'sender') return phone(from);
    /* Opened is where the envelope stops being a separate object: it comes to
       rest over the conversation it is about to become, so the shrink lands in
       the right place rather than in the middle of the phone. */
    return cue.step === 'opened' ? chat(to) : phone(to);
  }

  /**
   * Arm or disarm the fold into the bubble.
   *
   * A state, not a timer. The opened envelope has to stay readable for a beat
   * before it shrinks away, and the obvious way to buy that beat is a scheduled
   * callback here — which would give the drawing a second opinion about pacing,
   * the exact seam `playback.ts` owns and `demo-playback.test.mjs` checks this
   * file for by reading it. So the wait is a `transition-delay` in
   * `DemoScene.astro` and this only says which state the envelope is in. CSS
   * spends the time; nothing in this module counts it.
   */
  function setLanding(on: boolean): void {
    envelope.dataset.landing = String(on);
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
  const DEGREES_PER_KEY = 360 / TEETH;

  /**
   * Turn the wheel one tooth per message key derived, and only ever forward.
   *
   * The rotation is `taken * 90°` without a modulo, so the angle is a running
   * total rather than a position on a dial. That is the whole of what makes the
   * drawing honest: there is no value of `taken` for which the wheel returns to
   * a state it has already held, because the number it is derived from never
   * decreases while a session lives.
   *
   * The wheel this replaced was four teeth that lit in order and cleared on the
   * fifth message. It cycled, which meant it emptied — and a ratchet that can
   * empty is a ratchet that can go back, which is the single property the
   * double ratchet is built to deny. It also meant the fourth and the eighth
   * message drew the same picture.
   *
   * `data-turns` is written here and nowhere in the shipped markup. The wheel
   * renders identically before and after mount, so a demo whose script never
   * ran would otherwise be indistinguishable from one that ran and reported
   * nothing; the attribute's presence is what `demo-smoke.mjs` reads to tell
   * those two apart.
   */
  function turnRatchet(side: Side, taken: number): void {
    wheelTurn(side).style.transform = `rotate(${taken * DEGREES_PER_KEY}deg)`;
    wheel(side).dataset.turns = String(taken);
    /* The total is the number that only ever grows, and it is the one a reader
       can check against how many messages they have sent. */
    ratchetCount(side).textContent = `${taken} key${taken === 1 ? '' : 's'}`;
  }

  /**
   * Put a wheel back to zero for a scene that is starting over.
   *
   * The only place the angle may decrease, and it must not be *animated* down:
   * a reset that spun the wheel backwards would show, once, the exact motion the
   * rest of this file exists to prove impossible. The transition is suppressed
   * for the frame that carries the change, and the forced layout read between
   * the two writes is what makes the browser treat them as separate frames
   * rather than collapsing them into one.
   */
  function rewindRatchet(side: Side): void {
    const turn = wheelTurn(side) as SVGElement & { dataset: DOMStringMap };
    turn.dataset.rewind = 'true';
    turnRatchet(side, 0);
    void wheel(side).getBoundingClientRect();
    delete turn.dataset.rewind;
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

  /**
   * Draw the size of the row the relay has just stored, and name it.
   *
   * The width is the measurement and nothing else — the bytes the trace counted
   * on this envelope, against the fixed rule above. Nothing about which setting
   * produced them reaches this function, and that is deliberate: the switch is
   * an instruction, the byte count is what the wire carried, and only the
   * second is a fact the relay could report. A drawing that read the switch
   * would go on drawing a difference on the day the protocol stopped making
   * one.
   *
   * Drawn *and* named. The bar is what makes two runs comparable at a glance
   * and the figure is what makes the bar checkable, and a reader who wants to
   * know what a length means should never have to measure it against anything.
   */
  function drawSize(bytes: number): void {
    sizeBar.style.width = `${Math.min(100, (bytes / SIZE_RULE_BYTES) * 100)}%`;
    sizeBar.dataset.over = String(bytes > SIZE_RULE_BYTES);
    sizeFigure.textContent = `${bytes.toLocaleString('en-US')} bytes`;
    sizeRow.hidden = false;
  }

  const view: SceneView = {
    show(cue, flightMs) {
      root.dataset.sceneState = cue.step;
      envelope.style.setProperty('--demo-flight-ms', `${Math.max(0, Math.round(flightMs))}ms`);
      /* A cue that arrives while the last one is still folding away cancels the
         fold: the envelope belongs to whichever message is current. */
      setLanding(false);

      if (cue.keys) for (const side of ['a', 'b'] as const) fillKeys(side, cue.keys[side]);
      if (cue.ratchet) for (const side of ['a', 'b'] as const) turnRatchet(side, cue.ratchet[side]);
      /* Set at the step that agreed the keys and left alone after it: every
         later cue in the same session is still that session, and a caption
         cleared between steps would flicker the one fact this line carries. */
      if (cue.ratchetKind) nameRatchet(cue.ratchetKind);
      if (cue.bundles !== undefined) holdBundles(cue.bundles);
      /* The size arrives on the step that stores the row and stays after it,
         for the reason the row below the column does: the far device collecting
         empties the mailbox and the relay still has what it kept. */
      if (cue.bytes !== undefined) drawSize(cue.bytes);

      if (cue.step === 'devices-ready') {
        for (const side of ['a', 'b'] as const) deviceState(side).textContent = 'online';
      }

      /* The mailbox holds a row only while the relay actually has one: it is
         filled when the envelope is stored and emptied when the far device has
         collected it, which is what makes the relay read as a mailbox rather
         than as a box the message passes through.

         Stored, and not a step earlier. An envelope in transit is one the relay
         has not got yet, and a slot that lit as the envelope set off would be
         claiming a row while the count printed under this column still read
         nothing — the relay contradicting itself within an inch. It also draws
         better this way: the slot lights as the envelope lands in it. */
      const holding = cue.step === 'stored-at-relay';
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
      } else {
        envelope.dataset.flying = 'true';
        moveTo(anchor);
      }

      /*
       * Arrival. The envelope shows its plaintext for a beat, then shrinks into
       * the conversation as the bubble appears — the message becomes the
       * message. It used to come to rest beside the receiving phone and stay
       * there for the rest of the run, drawing a sentence that had been
       * delivered and was also still in the air.
       *
       * Set at once and delayed in CSS, so the beat costs this module no clock.
       */
      if (cue.step === 'opened') setLanding(true);
    },

    clear() {
      root.dataset.sceneState = 'idle';
      setLanding(false);
      envelope.hidden = true;
      envelope.dataset.flying = 'false';
      envelope.style.removeProperty('transform');
      mailbox.dataset.holding = 'false';
      mailboxBody.querySelector('.demo-relay-slot-empty')?.removeAttribute('hidden');
      holdBundles(0);
      /* Back to the state the markup ships in, width and all: a bar left at its
         last length under a hidden row would be the size of a message from a
         run that has been thrown away. */
      sizeRow.hidden = true;
      sizeBar.style.removeProperty('width');
      sizeBar.dataset.over = 'false';
      sizeFigure.textContent = '';
      nameRatchet(null);
      for (const side of ['a', 'b'] as const) {
        chat(side).replaceChildren();
        fillKeys(side, 0);
        rewindRatchet(side);
        deviceState(side).textContent = 'offline';
      }
    },

    /*
     * The braid setting is not written to the scene, and there is nothing left
     * here that would read it if it were. What the switch does is change the
     * size of every envelope the relay stores, and the column now draws that
     * size from the count the trace took — so the setting reaches the drawing
     * as its effect, measured, rather than as a state the drawing is told to
     * assume. The attribute this used to stamp had no reader at all.
     */
    setToggles(next) {
      toggles = next;
      root.dataset.sceneSealedSender = String(next.sealedSender);
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
  /* Stamp both wheels at zero on mount. The shipped markup carries no
     `data-turns`, so this is the moment a mounted scene becomes distinguishable
     from one whose script never arrived — and it has to happen at mount rather
     than at the first cue, or a scene that mounted and was never started reads
     as a scene that failed to mount. */
  for (const side of ['a', 'b'] as const) turnRatchet(side, 0);
  return view;
}

/** Which actor is a device, for callers turning a trace event into a cue. */
export function sideOf(actor: Actor): Side | null {
  return actor === 'a' || actor === 'b' ? actor : null;
}
