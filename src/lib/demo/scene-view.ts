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
 * `playback.ts` rather than from a duration token, so the glide is a share of
 * the step it belongs to and pacing keeps one owner.
 *
 * ------------------------------------------------------- reduced motion ---
 *
 * Under `prefers-reduced-motion` the envelope does not travel: `global.css`
 * zeroes every transition duration on the page with `!important`, and a
 * per-journey value written into a custom property does not outrank that. The
 * envelope is placed at each anchor instead of gliding to it.
 *
 * That is the rule and not a hole in it. A teaching sequence keeps every step
 * and drops the transitions between them, so the reader who asked for less
 * motion still gets the envelope at the sender, at the relay and at the
 * receiver — one frame per step, each held for its own full dwell, because
 * `playback.ts` has no reduced-motion branch at all. What is lost is the slide
 * between the three positions, and the slide carries nothing the three frames
 * do not already say.
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
  /**
   * How many public values the relay is holding for each device.
   *
   * Per device rather than pooled, because that is what a relay keeps: a bundle
   * per account, spent by the peer who fetches it. One figure for both drew the
   * relay as a pile, which is a shape the protocol does not have and which
   * cannot show the two facts either side of it — that publishing fills your own
   * shelf, and that sending to someone spends theirs.
   *
   * Both sides on every one of these, and neither derived: each figure is the
   * count that device's own publish reported, and the frame between the two
   * publishes really does draw one shelf filled and one still empty.
   */
  readonly bundles?: Readonly<Record<Side, number>>;
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
  /**
   * How far one device has got through making its keys, as the SDK reported it.
   *
   * `count` of `total` keypairs, and both are figures the recording holds: the
   * SDK reports a finished batch at a time, and `run.ts` counts the batches and
   * knows the total once the device has stopped. Nothing between there and the
   * bar works a number out — a counter that interpolated between two reports
   * would be the page inventing the very thing this step exists to show.
   *
   * One side per cue, because the two devices generate independently and each
   * has a bar of its own. The count is smaller than the count the same device
   * later publishes: identity and signed prekeys are made without a report, and
   * an unreported key is not counted here.
   */
  readonly keygen?: {
    readonly side: Side;
    readonly count: number;
    readonly total: number;
  };
  /**
   * What the ML-KEM braid last reported while this step ran, and who reported it.
   *
   * Chunk counts, from `onBraidProgress` by way of the recording. Nothing here
   * or upstream works them out: the braid's state machine is the only thing that
   * can see a chunk travel, and a page that counted messages instead would be
   * drawing its own arithmetic under the braid's name.
   *
   * Whose counts they are travels with them, because the two devices report
   * different ones. Each side counts what it has carried, and the two can be
   * whole epochs apart, so a figure with no name on it would read as one number
   * the conversation agrees on.
   */
  readonly braid?: {
    readonly side: Side;
    readonly carried: number;
    readonly required: number;
    readonly epoch: string;
  };
  /**
   * The device whose send or receive produced the epoch secret, on the step that
   * produced it.
   *
   * Absent on every other step. The drawing latches it rather than clearing it,
   * because a key that has been produced stays produced.
   */
  readonly braidKeyFrom?: Side;
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

/** The two devices, so nothing below iterates a pair it wrote out by hand. */
const SIDES = ['a', 'b'] as const;

/** What the relay keeps a slot of, per device. */
const SLOT_KINDS = ['bundles', 'mailbox'] as const;
type SlotKind = (typeof SLOT_KINDS)[number];

/**
 * Who a cue's message is for.
 *
 * Asked of the cue rather than worked out from the step, because either device
 * may start a conversation and the relay's mailboxes belong to recipients. The
 * recorded `to` is the answer wherever the recording names a device; the fall
 * back to the far side of `from` is for the steps that name the relay as the
 * destination, where the recipient is still the device that is not sending.
 */
function recipientOf(cue: SceneCue): Side {
  if (cue.to === 'a' || cue.to === 'b') return cue.to;
  return cue.from === 'b' ? 'a' : 'b';
}

/** And who it is from, on the same terms. */
function senderOf(cue: SceneCue): Side {
  if (cue.from === 'a' || cue.from === 'b') return cue.from;
  return recipientOf(cue) === 'a' ? 'b' : 'a';
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
 *
 * `relay` names the rack and not a slot on it, and the coarseness is deliberate.
 * The relay keeps a mailbox per recipient, so *which* mailbox is a fact about
 * the message rather than about the step, and `anchorFor` reads it off the cue.
 * A pair of entries here would put a per-message fact in a per-step table, which
 * is the shape the old drawing had: one mailbox, belonging to nobody.
 */
export const ENVELOPE_AT: Record<Step, 'sender' | 'relay' | 'receiver' | null> = {
  idle: null,
  'generating-keys': null,
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
  const sizeRow = need<HTMLElement>(root, '[data-scene-size]');
  const sizeBar = need<HTMLElement>(root, '[data-scene-size-bar]');
  const sizeFigure = need<HTMLElement>(root, '[data-scene-size-figure]');
  const braidRow = need<HTMLElement>(root, '[data-scene-braid]');
  const braidBar = need<HTMLElement>(root, '[data-scene-braid-bar]');
  const braidFigure = need<HTMLElement>(root, '[data-scene-braid-figure]');
  const braidMark = need<HTMLElement>(root, '[data-scene-braid-mark]');
  const keyGlyphTemplate = need<HTMLTemplateElement>(root, '[data-scene-key-glyph]');
  const spentKey = need<HTMLElement>(root, '[data-scene-spent-key]');

  /*
   * The relay's four slots, addressed by what they hold and whose it is.
   *
   * Both halves of the address are asked for. A selector naming only the shelf
   * would now match two elements and return whichever came first in the markup,
   * which is a drawing that puts every row in device A's mailbox and never
   * fails.
   */
  const slot = (kind: SlotKind, side: Side) =>
    need<HTMLElement>(root, `[data-scene-slot="${kind}"][data-scene-side="${side}"]`);
  const slotBody = (kind: SlotKind, side: Side) =>
    need<HTMLElement>(root, `[data-scene-slot-body="${kind}"][data-scene-side="${side}"]`);

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
  const keygenRow = (side: Side) => need<HTMLElement>(root, `[data-scene-keygen="${side}"]`);
  const keygenBar = (side: Side) => need<HTMLElement>(root, `[data-scene-keygen-bar="${side}"]`);
  const keygenFigure = (side: Side) =>
    need<HTMLElement>(root, `[data-scene-keygen-figure="${side}"]`);

  let toggles = DEFAULT_TOGGLES;

  /* Every place a device is named, named once from one source. The phone's
     header and the two slots the relay keeps for that device all say the same
     word because they are all written here — a slot labelled from the markup
     would go on calling a device by its column name after the session had given
     it another. Asked slot by slot rather than swept for, so a rack that lost a
     label throws at mount instead of shipping an anonymous shelf. */
  for (const side of SIDES) {
    need<HTMLElement>(root, `[data-scene-name="${side}"]`).textContent = names[side];
    for (const kind of SLOT_KINDS) {
      need<HTMLElement>(slot(kind, side), '[data-scene-slot-name]').textContent = names[side];
    }
  }

  /**
   * Where an element has to be translated to sit centred over an anchor, in the
   * scene's own coordinates.
   *
   * All three rectangles are read in the same frame, so a page that has scrolled
   * or a column that has reflowed since the last cue lands correctly rather than
   * accumulating drift from a remembered position.
   */
  function centreOn(element: HTMLElement, anchor: HTMLElement): { x: number; y: number } {
    const scene = root.getBoundingClientRect();
    const target = anchor.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      x: Math.round(target.left - scene.left + (target.width - box.width) / 2),
      y: Math.round(target.top - scene.top + (target.height - box.height) / 2),
    };
  }

  /** Put the envelope over an anchor. */
  function moveTo(anchor: HTMLElement): void {
    const { x, y } = centreOn(envelope, anchor);
    /*
     * Scale is a variable the stylesheet owns and position is a number this
     * function measures, and they compose in one transform because the browser
     * gives an element only one. Writing `translate()` alone here would drop the
     * landing's scale every time the envelope moved.
     */
    envelope.style.transform = `translate(${x}px, ${y}px) scale(var(--demo-envelope-scale, 1))`;
  }

  function anchorFor(place: 'sender' | 'relay' | 'receiver', cue: SceneCue): HTMLElement {
    /* Which device is the sender is a fact about the cue rather than a fixed
       side, because either device may start a conversation. */
    const from = senderOf(cue);
    const to = recipientOf(cue);
    /* At the relay the envelope rests in the mailbox it is addressed to, which
       is the whole reason there are two of them: a row waiting over the
       sender's own mailbox would draw the relay handing the message back. */
    if (place === 'relay') return slot('mailbox', to);
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

  /**
   * One key, stamped from the drawing the component holds.
   *
   * Cloned rather than built here. This module owns where a key is and when it
   * appears; `DemoScene.astro` owns what one looks like, and a path written in
   * this file would be a second drawing free to drift from the first. The whole
   * point the two forms make is that they are one shape, so there is one shape.
   */
  function keyGlyph(): Node {
    return keyGlyphTemplate.content.cloneNode(true);
  }

  /* The travelling prekey is stamped once, at mount, rather than built and
     thrown away per crossing. It is one key and it makes one journey per
     session, so there is nothing for a rebuild to keep in step — and a node that
     exists from mount has a box to be measured against on the frame it is
     wanted, which a node created inside the cue would not. */
  spentKey.append(keyGlyph());

  function fillKeys(side: Side, count: number): void {
    const list = keyList(side);
    list.replaceChildren();
    for (let index = 0; index < Math.min(count, KEY_MOTIF); index += 1) {
      const item = document.createElement('li');
      item.className = 'demo-key';
      item.append(keyGlyph());
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
   * it would go on saying whatever it said when it was copied — the mailboxes
   * below already do it this way, and all four slots are the same shape.
   *
   * Held per slot because `replaceChildren` below drops it, and a caption
   * rescued from the wrong slot would be one element trying to be in two.
   */
  const bundleEmpty: Record<Side, HTMLElement> = {
    a: need<HTMLElement>(slotBody('bundles', 'a'), '.demo-relay-slot-empty'),
    b: need<HTMLElement>(slotBody('bundles', 'b'), '.demo-relay-slot-empty'),
  };

  /**
   * Put each device's published count on that device's own shelf.
   *
   * Both shelves on every call, from the pair the cue carries. Drawing only the
   * side that has just published would leave the other shelf showing whatever it
   * last held, which is right until a reset and wrong immediately after one; and
   * a shelf that took its figure from anything but that device's own publish
   * would be this file doing the relay's accounting.
   *
   * `launching` is the device this call is the publish *of*, and only its keys
   * travel. Both shelves are redrawn on every call, so without it the shelf that
   * published a step ago would send its keys across again on the other device's
   * publish — the same material published twice, which is the one thing a shelf
   * per account exists to say does not happen. The count travels with them: it is
   * what the relay has once they land, and a figure that appeared as they set off
   * would be the relay counting keys it had not been given yet.
   */
  function holdBundles(counts: Readonly<Record<Side, number>>, launching?: Side): void {
    for (const side of SIDES) {
      const body = slotBody('bundles', side);
      const count = counts[side];
      const arriving: HTMLElement[] = [];
      body.replaceChildren(bundleEmpty[side]);
      for (let index = 0; index < Math.min(count, KEY_MOTIF); index += 1) {
        const item = document.createElement('span');
        item.className = 'demo-key';
        item.dataset.public = 'true';
        item.append(keyGlyph());
        body.append(item);
        arriving.push(item);
      }
      if (count > 0) {
        const total = document.createElement('span');
        total.className = 'demo-relay-slot-count';
        total.textContent = String(count);
        body.append(total);
        arriving.push(total);
      }
      slot('bundles', side).dataset.holding = String(count > 0);
      bundleEmpty[side].toggleAttribute('hidden', count > 0);
      if (side === launching) launchKeys(side, arriving);
    }
  }

  /**
   * Light the mailbox the relay is holding a row for, and only that one.
   *
   * `null` empties both, which is every step but the one that stores. The two
   * are written together rather than the holding one alone, because a mailbox
   * left lit from the previous message would draw a relay holding two rows
   * through a run that only ever holds one.
   */
  function holdMailbox(waiting: Side | null): void {
    for (const side of SIDES) {
      const holding = waiting === side;
      slot('mailbox', side).dataset.holding = String(holding);
      slotBody('mailbox', side)
        .querySelector('.demo-relay-slot-empty')
        ?.toggleAttribute('hidden', holding);
    }
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

  /**
   * Draw how far one device has got through making its keys.
   *
   * The fill is `count` of `total` and both are the recording's, so the only
   * arithmetic here is the one that turns two counts into a length. It is the
   * `drawSize` shape rather than the braid's: a total that the count really
   * does settle on, so the bar fills exactly once and there is no over-run case
   * to draw.
   *
   * The figure prints both counts for the reason the size and the braid do. A
   * bar says how far along, and only a number says how far along *what* — and
   * the number is the one the SDK reported, not one this file worked back out
   * of a percentage.
   *
   * The row stays after generation finishes, like the size row. What it holds
   * then is a fact about the run the reader is watching — this device made two
   * hundred keypairs before it said a word — and clearing it at the next step
   * would take that away at the moment it becomes possible to read.
   */
  function drawKeygen(report: NonNullable<SceneCue['keygen']>): void {
    const { side, count, total } = report;
    keygenBar(side).style.width = `${total > 0 ? Math.min(100, (count / total) * 100) : 0}%`;
    keygenFigure(side).textContent = `${count} of ${total} keypairs`;
    keygenRow(side).hidden = false;
  }

  /**
   * Send this device's published keys across to its own shelf.
   *
   * The keys are appended where they belong and then *offset back* to where they
   * came from, so what travels is the real element arriving at its real place —
   * the measured-transform idiom the envelope uses, for the same reason: the
   * columns move with the width of the page, and a journey written in fixed
   * numbers would be a journey to the wrong place at every width but one.
   *
   * Every rectangle is read before any style is written. The two reads and the
   * clutch of writes are one layout pass, and a loop that measured and wrote
   * per key would be five.
   *
   * The offsets are all this function decides. How long a key takes, and which
   * keys leave together, are the stylesheet's — `DemoScene.astro` carries the
   * flight duration and the clumping, and `data-burst` is the index it clumps
   * by. This module owns where a thing is and when it moves, which is the same
   * line the key glyph itself is drawn on the other side of.
   *
   * A device whose key row is empty launches nothing: there is no drawn key for
   * one to have left from, and a key sailing out of an empty row would be a
   * journey the scene never showed the start of.
   */
  function launchKeys(side: Side, arriving: readonly HTMLElement[]): void {
    const sources = [...keyList(side).children] as HTMLElement[];
    if (sources.length === 0 || arriving.length === 0) return;

    const from = sources.map((source) => source.getBoundingClientRect());
    const to = arriving.map((item) => item.getBoundingClientRect());

    arriving.forEach((item, index) => {
      /* Clamped rather than wrapped: the shelf holds the same motif as the key
         row, so the indexes line up, and a shelf that ever held more would have
         its extra keys leave from the last drawn one rather than from the
         start of the row again. */
      const source = from[Math.min(index, from.length - 1)];
      const box = to[index];
      item.style.setProperty('--demo-key-from-x', `${Math.round(source.left - box.left)}px`);
      item.style.setProperty('--demo-key-from-y', `${Math.round(source.top - box.top)}px`);
      item.dataset.burst = String(index);
      item.dataset.flying = 'false';
    });

    /* One read back for the whole clutch, which commits every offset above
       before the flight is armed. Without it the two style changes coalesce
       and the keys are simply already home. */
    void root.offsetWidth;
    for (const item of arriving) item.dataset.flying = 'true';
  }

  /**
   * Send the prekey the key agreement spent from the peer's shelf to the device
   * that asked for it.
   *
   * `null` takes it off the scene, which is every step but the one that agrees a
   * key. A key left standing would be a prekey that is both spent and still in
   * the air, and it would sit over the columns for the whole of the message that
   * follows.
   *
   * Placed at its source, released to its destination — the envelope's mechanism
   * rather than the shelf's. Both places are real and measured in the same frame,
   * so the crossing survives any width; and because the start state is a position
   * rather than a displacement, a reader with motion turned off is shown the key
   * at the device on the frame the step arrives instead of stranded off a slot.
   *
   * The single forced read between the two writes is what keeps them in separate
   * frames. Without it the browser coalesces them and the key is simply already
   * there, which is the same defect the published keys were built around.
   */
  function spendKey(journey: { readonly from: Side; readonly to: Side } | null): void {
    if (journey === null) {
      spentKey.hidden = true;
      return;
    }
    /* Unhidden before either rectangle is taken: a `hidden` element has no box,
       and a journey measured from one is a journey from the scene's corner. */
    spentKey.dataset.flying = 'false';
    spentKey.hidden = false;
    const start = centreOn(spentKey, slot('bundles', journey.from));
    const end = centreOn(spentKey, phone(journey.to));
    spentKey.style.transform = `translate(${start.x}px, ${start.y}px)`;
    void root.offsetWidth;
    spentKey.dataset.flying = 'true';
    spentKey.style.transform = `translate(${end.x}px, ${end.y}px)`;
  }

  /**
   * Draw how far the braid's key has travelled, and print the counts.
   *
   * Both numbers are the braid's own. The only thing worked out here is the
   * length of the bar, and it is deliberately a fill against the count as last
   * reported rather than a share of a fixed whole: `chunksRequired` is not a
   * total the carried count settles on — it grows as the epoch opens transfers,
   * and a sender carries parity beyond it — so a carried count really can pass
   * it. That case is drawn full and marked, the way an oversized row is above,
   * and the figure stays the authority on how far past.
   *
   * The figure prints the two counts rather than a percentage of them, for the
   * reason `drawSize` prints a byte count: a length is comparable at a glance
   * and only a figure makes it checkable against what the braid reported.
   *
   * Named with the device that reported. Each side counts the chunks it has
   * carried and the two can be whole epochs apart, so an unattributed figure
   * would claim a number the conversation agreed on and neither side reported.
   */
  function drawBraid(report: NonNullable<SceneCue['braid']>): void {
    const filled = report.required > 0 ? (report.carried / report.required) * 100 : 0;
    braidBar.style.width = `${Math.min(100, filled)}%`;
    braidBar.dataset.over = String(report.carried > report.required);
    braidFigure.textContent = `${names[report.side]} ${report.carried} of ${report.required} chunks`;
    braidRow.hidden = false;
  }

  /**
   * Say whose send or receive produced the epoch secret.
   *
   * Latched, and left latched until the scene is cleared. The report carrying
   * this is also the report on which the braid has already reset its counters,
   * so the fill beside it drops to near nothing on the same cue — a mark that
   * cleared with the counts would show for one step and take the run's one
   * completion away with it.
   *
   * It names the device and stops there. Which epoch the secret closed is not
   * something the report states: the epoch travelling with it is the one that
   * has just begun, so the mark does not name one.
   */
  function markBraidKey(side: Side): void {
    braidMark.textContent = `${names[side]} produced the epoch key`;
    braidMark.dataset.sceneBraidKey = side;
    braidMark.hidden = false;
  }

  const view: SceneView = {
    show(cue, flightMs) {
      root.dataset.sceneState = cue.step;
      /* On the scene rather than on the envelope, because the envelope is no
         longer the only thing that flies: the published keys cross the same gap
         on the same step's clock, and one property both inherit is what keeps
         the two journeys from being timed separately. */
      root.style.setProperty('--demo-flight-ms', `${Math.max(0, Math.round(flightMs))}ms`);
      /* A cue that arrives while the last one is still folding away cancels the
         fold: the envelope belongs to whichever message is current. */
      setLanding(false);

      if (cue.keys) for (const side of ['a', 'b'] as const) fillKeys(side, cue.keys[side]);
      if (cue.ratchet) for (const side of ['a', 'b'] as const) turnRatchet(side, cue.ratchet[side]);
      /* Set at the step that agreed the keys and left alone after it: every
         later cue in the same session is still that session, and a caption
         cleared between steps would flicker the one fact this line carries. */
      if (cue.ratchetKind) nameRatchet(cue.ratchetKind);
      if (cue.keygen) drawKeygen(cue.keygen);
      /* The publishing device is the one whose keys travel, and the recording
         named it: the actor of a publish step is the device that published.
         Not `senderOf`, which answers a question about a message — on a step
         with nothing travelling between devices it falls back to a side, and
         the fallback would send device A's keys across on both publishes. */
      if (cue.bundles !== undefined) {
        const publisher = cue.actor === 'a' || cue.actor === 'b' ? cue.actor : undefined;
        holdBundles(cue.bundles, cue.step === 'bundles-published' ? publisher : undefined);
      }
      /*
       * A key crosses back on the step that agrees a session, and only when that
       * step brought shelf counts with it.
       *
       * The counts are the condition rather than the step's name alone, because
       * they are what says the relay was re-read: `run.ts` keeps an unobserved
       * reading out of the recording, and a key flying off a shelf whose figure
       * had not moved would be a spend the drawing invented.
       *
       * Both devices come off the cue's own `from` and `to`, which this step
       * always carries — it is recorded as the initiator agreeing a key *with*
       * the responder. So neither `senderOf` nor `recipientOf` reaches its
       * fallback here, which matters: on a step with nothing travelling between
       * devices the fallback answers for both sides and would send a key off
       * whichever shelf it happened to pick.
       *
       * Off the responder's shelf and to the initiator's phone, which is the
       * direction the protocol went: the initiating device fetched the bundle,
       * and the material it took was the other account's.
       */
      spendKey(
        cue.step === 'session-established' && cue.bundles !== undefined
          ? { from: recipientOf(cue), to: senderOf(cue) }
          : null,
      );
      /* The size arrives on the step that stores the row and stays after it,
         for the reason the row below the column does: the far device collecting
         empties the mailbox and the relay still has what it kept. */
      if (cue.bytes !== undefined) drawSize(cue.bytes);
      /* The braid arrives on the step whose send or receive raised the report
         and stays after it, for the same reason the size does. The braid reports
         on some steps and not on others, so a row emptied between cues would
         spend most of the run showing nothing. */
      if (cue.braid) drawBraid(cue.braid);
      if (cue.braidKeyFrom) markBraidKey(cue.braidKeyFrom);

      /* One device per cue, and the device the recording named. Each client
         boots on its own and reports itself ready on its own, so there are two
         of these cues; stamping both sides on each of them drew the pair coming
         up together on the first and drew nothing at all on the second, which
         spent a whole dwell on a frame the reader had already seen. */
      if (cue.step === 'devices-ready' && (cue.actor === 'a' || cue.actor === 'b')) {
        deviceState(cue.actor).textContent = 'online';
      }

      /* The mailbox holds a row only while the relay actually has one: it is
         filled when the envelope is stored and emptied when the far device has
         collected it, which is what makes the relay read as a mailbox rather
         than as a box the message passes through.

         Stored, and not a step earlier. An envelope in transit is one the relay
         has not got yet, and a slot that lit as the envelope set off would be
         claiming a row while the count printed under this column still read
         nothing — the relay contradicting itself within an inch. It also draws
         better this way: the slot lights as the envelope lands in it.

         Which mailbox is the one the cue is addressed to. The relay is holding
         the row *for* the far device, so a row appearing over the sender's own
         mailbox would draw the message going nowhere. */
      holdMailbox(cue.step === 'stored-at-relay' ? recipientOf(cue) : null);

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
      holdMailbox(null);
      holdBundles({ a: 0, b: 0 });
      spendKey(null);
      /* Back to the state the markup ships in, width and all: a bar left at its
         last length under a hidden row would be the size of a message from a
         run that has been thrown away. */
      sizeRow.hidden = true;
      sizeBar.style.removeProperty('width');
      sizeBar.dataset.over = 'false';
      sizeFigure.textContent = '';
      /* The mark is latched for the life of a run and this is the one place it
         comes off. A run that has been thrown away has produced no key, and a
         mark left standing would credit the new run with the old one's. */
      braidRow.hidden = true;
      braidBar.style.removeProperty('width');
      braidBar.dataset.over = 'false';
      braidFigure.textContent = '';
      braidMark.hidden = true;
      braidMark.textContent = '';
      delete braidMark.dataset.sceneBraidKey;
      nameRatchet(null);
      for (const side of ['a', 'b'] as const) {
        chat(side).replaceChildren();
        /* Back to the state the markup ships in, for the reason the size bar is:
           a bar left at its last length would say the fresh device had already
           made the keys the run has yet to make. */
        keygenRow(side).hidden = true;
        keygenBar(side).style.removeProperty('width');
        keygenFigure(side).textContent = '';
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
