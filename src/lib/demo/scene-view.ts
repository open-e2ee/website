/*
 * What the scene does with a cue.
 *
 * `DemoScene.astro` owns every shape and every color; this module owns where
 * things are and when they change: markup is built once at build time, and the
 * browser only ever renames a state or moves a node it was handed.
 *
 * ---------------------------------------------------------------- travel ---
 *
 * Everything that flies is measured from the live layout rather than keyframed,
 * so a journey is correct at any column width and after any reflow — a keyframe
 * would encode a distance that is only true at one size. The envelope glides on
 * a measured transform. The keys ride an `offset-path` routed along the network
 * links, because a key that cut diagonally across the scene drew a channel the
 * system does not have: material moves between a device and the relay on the
 * wire, so the drawing takes the wire.
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

import type { Actor, Cue, Step } from './trace.ts';
/* The freeze-and-release both morphs ride comes from the same module the
   mobile figure's morphs do, so the idiom cannot fork between the scenes. */
import { endsMorph, freezeAndRelease, releaseBox } from './box-morph.ts';
/* One tooth per key's click under the pawl: the angle comes from the same
   module that draws the teeth, so the two cannot disagree. */
import { DEGREES_PER_KEY } from './drawing.ts';
import { humanBytes } from './units.ts';

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
   * How many bytes the sealed envelope is, off the trace's own measure.
   *
   * Carried on the cue rather than read when the cue plays, for the reason the
   * ratchet count above is: the protocol runs well ahead of the reader, and a
   * drawing that reached for the current row would print, under this message,
   * the size of whichever one the relay had taken most recently. It arrives on
   * the sealing step — the run measures the bytes the relay has already been
   * handed — and again on the storing step off the relay's own copy, and never
   * on a step where the count would be a guess. The envelope wears it for the
   * rest of the journey; it is the braid switch's visible effect, because the
   * braided assembly is a bigger envelope.
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
   * The braid's progress, pre-formatted: how many chunks of the post-quantum
   * key material this envelope carries against how many the whole rekey needs.
   *
   * A string rather than a pair of counts, by the cue contract's rule: every
   * number on a cue lives on a named measured field, and this is a caption the
   * console assembled from the trace's `BraidReport`. It arrives on the step
   * that sealed the envelope and the strip holds it for the rest of the
   * journey, the metadata's idiom.
   */
  readonly chunk?: string;
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

export interface SceneView {
  show(cue: SceneCue, flightMs: number): void;
  clear(): void;
  /**
   * A transport has drained: end the claims that only a next cue would end.
   *
   * Almost everything a cue leaves on screen is a fact that outlives it — a
   * held mailbox, a count, a turned wheel. The lit network link and busy
   * shelf are the exception: they say material is crossing *now*, and with no
   * next cue coming they would go on saying so over a still scene. The
   * transport knows it ran dry; the scene only knows what it was last told,
   * so the transport says so here. `scope` is the sides that transport was
   * telling a story about — a registration lane rests only its own device's
   * wire and shelf, because the other lane may still be playing.
   */
  settle(scope?: readonly Side[]): void;
  setToggles(toggles: SceneToggles): void;
  /**
   * Put a sentence on a device's screen. Used by the live conversation.
   * `arriving` holds the bubble invisible while the envelope above it is still
   * decrypting and folding; the reveal is the stylesheet's, on the fold's own
   * clock.
   */
  say(side: Side, text: string, mine: boolean, pending?: boolean, arriving?: boolean): HTMLElement;
}

/** The two devices, so nothing below iterates a pair it wrote out by hand. */
const SIDES = ['a', 'b'] as const;

/**
 * The envelope's two keyholes, by the key agreement family each stands for.
 * The markup's `LOCKS` list in `DemoScene.astro` names the same pair; a kind
 * added to one and not the other throws at mount, `need`'s rule.
 */
const LOCK_KINDS = ['ec', 'pq'] as const;
type LockKind = (typeof LOCK_KINDS)[number];

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
  registered: null,
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

/*
 * The steps at which the payload is closed to the relay. The two key-turning
 * steps are entered in the state the previous one left, because the keys are
 * still in the air when the cue shows and it is their landing — not the cue —
 * that changes the payload: `opened` is in the set even though it is the step
 * the payload opens on (a tile that unsealed at cue start showed the message
 * decrypted before anything had decrypted it), and `encrypted` is out of it
 * even though it is the step the payload seals on (a tile that appeared
 * already dark showed the message encrypted while the keys that seal it were
 * still flying in).
 */
const SEALED_AT = new Set<Step>(['in-transit', 'stored-at-relay', 'delivered', 'opened']);

/*
 * The steps that tell one device's registration story. Each device registers
 * on its own press, so these cues play on a per-device lane rather than on
 * the shared reel — the reader may press the second button while the first
 * story is still being told, and the two stories run beside each other. A
 * lane's cue may only touch its own device's half of the scene: the writes
 * `show` makes for it are scoped to the lane, so one story's cue cannot rest
 * a wire, park a burst, or rewrite a bar the other story is animating.
 * Conversation steps are never concurrent — the composers stay closed until
 * both lanes have finished — so every other cue keeps the whole scene.
 */
const REGISTRATION_STEPS = new Set<Step>([
  'registered',
  'generating-keys',
  'devices-ready',
  'bundles-published',
]);

/**
 * Which registration lane a cue plays on, or `null` for the shared reel.
 * One derivation, used by the console to pick a transport and by `show` to
 * scope its writes — two copies of this rule would let a cue play on a lane
 * while the scene wrote it as if it owned the whole stage.
 */
export function registrationLaneOf(cue: Pick<SceneCue, 'step' | 'actor'>): Side | null {
  return REGISTRATION_STEPS.has(cue.step) && (cue.actor === 'a' || cue.actor === 'b')
    ? cue.actor
    : null;
}

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
  const keyGlyphTemplate = need<HTMLTemplateElement>(root, '[data-scene-key-glyph]');
  const spentKey = need<HTMLElement>(root, '[data-scene-spent-key]');
  const messageKeys = Object.fromEntries(
    LOCK_KINDS.map((kind) => [
      kind,
      need<HTMLElement>(root, `[data-scene-message-key="${kind}"]`),
    ]),
  ) as Record<LockKind, HTMLElement>;
  const keyhole = (kind: LockKind) => need<SVGElement>(root, `[data-scene-keyhole="${kind}"]`);
  const chunkStrip = need<HTMLElement>(root, '[data-scene-envelope-chunk]');

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
  const keysRow = (side: Side) => need<HTMLElement>(root, `[data-scene-keys="${side}"]`);
  const keyAnchor = (side: Side) => need<HTMLElement>(root, `[data-scene-keys-anchor="${side}"]`);
  const keyBar = (side: Side) => need<HTMLElement>(root, `[data-scene-keys-bar="${side}"]`);
  const keyCount = (side: Side) => need<HTMLElement>(root, `[data-scene-keys-count="${side}"]`);
  const wheel = (side: Side) => need<SVGElement>(root, `[data-scene-ratchet-wheel="${side}"]`);
  const wheelTurn = (side: Side) => need<SVGElement>(root, `[data-scene-ratchet-turn="${side}"]`);
  const train = (side: Side) => need<HTMLElement>(root, `[data-scene-ratchet-train="${side}"]`);
  const feeder = (side: Side, kind: LockKind) =>
    need<SVGElement>(root, `[data-scene-ratchet-feeder="${side}"][data-kind="${kind}"]`);
  const ratchetCount = (side: Side) =>
    need<HTMLElement>(root, `[data-scene-ratchet-count="${side}"]`);
  const ratchetLabel = (side: Side) =>
    need<HTMLElement>(root, `[data-scene-ratchet-label="${side}"]`);
  const deviceState = (side: Side) =>
    need<HTMLElement>(root, `[data-scene-device-state="${side}"]`);
  const envelopeSize = need<HTMLElement>(root, '[data-scene-envelope-size]');
  const link = (side: Side) => need<HTMLElement>(root, `[data-scene-link="${side}"]`);
  const account = (side: Side) => need<HTMLElement>(root, `[data-scene-account="${side}"]`);

  let toggles = DEFAULT_TOGGLES;

  /* Every place a device is named, named once from one source. The phone's
     header and the relay account kept for that device say the same word because
     both are written here — a heading left to the markup would go on calling a
     device by its column name after the session had given it another. Asked by
     side rather than swept for, so a rack that lost its heading throws at mount
     instead of shipping an anonymous account. */
  for (const side of SIDES) {
    need<HTMLElement>(root, `[data-scene-name="${side}"]`).textContent = names[side];
    need<HTMLElement>(root, `[data-scene-slot-name="${side}"]`).textContent = names[side];
  }
  /* The stamp the headers' "'s device" suffix waits for: until the session
     has named the phones they carry the neutral column labels, and "Device
     A's device" is not a sentence the drawing should say. */
  root.dataset.named = 'true';

  /**
   * Where an element has to be translated to sit centered over an anchor, in the
   * scene's own coordinates.
   *
   * Both rectangles are read in the same frame, so a page that has scrolled
   * or a column that has reflowed since the last cue lands correctly rather than
   * accumulating drift from a remembered position.
   */
  function centerOn(element: HTMLElement, anchor: Element): { x: number; y: number } {
    const scene = root.getBoundingClientRect();
    const target = anchor.getBoundingClientRect();
    /*
     * The element's own box is its layout size, not its client rect: the rect
     * is measured through the current transform, and a seal that fires while
     * the previous message's fold still has the envelope at landing scale
     * would center the shrunken box and draw the full-size tile low and to
     * the right of every anchor for the rest of the flight.
     */
    return {
      x: Math.round(target.left - scene.left + (target.width - element.offsetWidth) / 2),
      y: Math.round(target.top - scene.top + (target.height - element.offsetHeight) / 2),
    };
  }

  /** An anchor's center point, in the scene's own coordinates. */
  function centerOf(anchor: Element): { x: number; y: number } {
    const scene = root.getBoundingClientRect();
    const box = anchor.getBoundingClientRect();
    return {
      x: Math.round(box.left - scene.left + box.width / 2),
      y: Math.round(box.top - scene.top + box.height / 2),
    };
  }

  /**
   * The route a key takes between a device's column and the relay: out to the
   * network link, along it, and in to the destination — three right-angled
   * legs rather than a diagonal, because the link is the one edge in the scene
   * that is not a trust boundary and material moves on it, not across the gap.
   *
   * The points are centers and the path is in the scene's coordinates, which
   * are also each traveler's own: the travelers are absolutely positioned at
   * the scene's origin, and `offset-anchor` defaults to the element's center,
   * so a path point puts the middle of the key on the wire. All three anchors
   * are measured in the same frame, `centerOn`'s rule.
   */
  function wirePath(from: Element, to: Element, side: Side): string {
    const a = centerOf(from);
    const b = centerOf(to);
    const wire = centerOf(link(side)).y;
    return `path("M ${a.x} ${a.y} L ${a.x} ${wire} L ${b.x} ${wire} L ${b.x} ${b.y}")`;
  }

  /**
   * Put the envelope over an anchor, and say whether that was a move.
   *
   * The answer is what lets a caller treat "already there" differently from
   * "underway": a write that lands on the tile's current position starts no
   * transition and fires no `transitionend`, so a glow armed for it would
   * have nothing to put it out.
   */
  function moveTo(anchor: HTMLElement): boolean {
    const { x, y } = centerOn(envelope, anchor);
    /*
     * Scale is a variable the stylesheet owns and position is a number this
     * function measures, and they compose in one transform because the browser
     * gives an element only one. Writing `translate()` alone here would drop the
     * landing's scale every time the envelope moved.
     */
    const next = `translate(${x}px, ${y}px) scale(var(--demo-envelope-scale, 1))`;
    const moved = envelope.style.transform !== next;
    envelope.style.transform = next;
    return moved;
  }

  /* Where the last wire crossing was headed, in scene coordinates. The
     envelope rides `offset-path` for its two crossings and rests on
     `transform` the rest of the time; this remembers the destination so the
     cue after a crossing can hand the position back to `transform` without a
     visible jump. */
  let crossingDest: { x: number; y: number } | null = null;

  /**
   * Put a finished — or interrupted — crossing down.
   *
   * The offset properties come off and the destination they were aimed at
   * becomes the resting transform, so the next move starts from where the
   * crossing ended rather than from wherever `transform` last pointed. Settled
   * on the next cue instead of on `transitionend`, the keyholes' interrupt
   * rule: a landing is an event and an interrupted flight never fires one, so
   * a reader who steps ahead mid-crossing must still find the envelope where
   * the step they landed on requires it.
   */
  function settleCrossing(): void {
    /* Whatever the last cue set moving has stopped by now — a landing that
       fired cleared this itself, and an interrupted flight never fires one.
       Unconditional where the position hand-back below is not, because the
       in-column glides move the tile without a `crossingDest`. */
    envelope.dataset.crossing = 'false';
    if (crossingDest === null) return;
    envelope.dataset.flying = 'false';
    envelope.style.transform = `translate(${crossingDest.x}px, ${crossingDest.y}px) scale(var(--demo-envelope-scale, 1))`;
    envelope.style.removeProperty('offset-path');
    envelope.style.removeProperty('offset-distance');
    crossingDest = null;
    /* Read back so the put-down is committed before this cue arms a flight. */
    void envelope.offsetWidth;
  }

  /**
   * Send the envelope across the gap on the wire, the travelers' idiom: the
   * message moves on the network's one drawn edge, not on a diagonal through
   * the trust boundary. The route is written while the envelope rests at its
   * start and the release is a single write of the distance, the spent key's
   * mechanism. The resting translate is zeroed for the ride — `offset`
   * composes on top of `transform`, so a translate left in place would carry
   * the whole path with it — and the scale variable stays, because the fold
   * must remain free to take it.
   */
  function rideWire(from: Element, to: HTMLElement, side: Side): void {
    envelope.dataset.flying = 'false';
    envelope.style.transform = 'translate(0px, 0px) scale(var(--demo-envelope-scale, 1))';
    envelope.style.removeProperty('offset-distance');
    envelope.style.setProperty('offset-path', wirePath(from, to, side));
    crossingDest = centerOn(envelope, to);
    void envelope.offsetWidth;
    envelope.dataset.flying = 'true';
    /* The glow rides exactly the move: armed by the release, dropped by the
       landing's `transitionend` — `data-flying` cannot key it, since that
       stays armed while the tile rests between cues. */
    envelope.dataset.crossing = 'true';
    envelope.style.setProperty('offset-distance', '100%');
  }

  /* The bubble a running fold is becoming. Held so the landing — or an
     interrupting cue — can make the trade: the tile leaves, and the bubble
     stops holding its place in the chat invisibly. */
  let morphingBubble: HTMLElement | null = null;

  /**
   * A morph between the tile and a bubble's box, on the shared
   * freeze-and-release (`box-morph.ts`). Corners rather than centers,
   * because the far end of a morph is another element's box, not an anchor
   * to hover over: the envelope is absolutely positioned at the scene's
   * origin, so translating by a rect's offset puts the tile's corner
   * exactly on the rect's. The arm step flips `data-flying` and stamps the
   * kind, which is what keys the stylesheet's morph transition.
   */
  function morphBetween(kind: 'from-bubble' | 'to-bubble', from: DOMRect, to: DOMRect): void {
    const scene = root.getBoundingClientRect();
    const place = (box: DOMRect): string =>
      `translate(${Math.round(box.left - scene.left)}px, ${Math.round(box.top - scene.top)}px)` +
      ' scale(var(--demo-envelope-scale, 1))';
    const frame = (box: DOMRect): { transform: string; width: number; height: number } => ({
      transform: place(box),
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
    envelope.dataset.flying = 'false';
    /* A morph is a gesture at a device, not travel, so it carries no glow. */
    envelope.dataset.crossing = 'false';
    freezeAndRelease(envelope, frame(from), frame(to), () => {
      envelope.dataset.flying = 'true';
      envelope.dataset.morph = kind;
    });
  }

  /**
   * The sealing morph: the typed message becomes the envelope. The tile sets
   * off from the sender bubble's own box and grows into the rest `show` has
   * just placed it at, under the fade the state selector plays
   * (`demo-envelope-appear`) — it materialises over the bubble as it takes
   * its own shape. Measured before the freeze, because the freeze writes the
   * box this reads.
   */
  function sealFromBubble(bubble: HTMLElement): void {
    const rest = envelope.getBoundingClientRect();
    morphBetween('from-bubble', bubble.getBoundingClientRect(), rest);
  }

  /**
   * The opening morph, the seal's gesture reversed: after the reveal beat
   * the tile leaves its rest beside the phone and folds onto the box of the
   * bubble it becomes, and the landing makes the trade. The beat is the
   * `to-bubble` rule's `transition-delay` in `DemoScene.astro`, `setLanding`'s
   * arrangement and for its reason: CSS spends the wait, this module counts
   * none of it.
   */
  function openIntoBubble(bubble: HTMLElement): void {
    morphingBubble = bubble;
    morphBetween('to-bubble', envelope.getBoundingClientRect(), bubble.getBoundingClientRect());
  }

  /**
   * Put a finished — or interrupted — morph down.
   *
   * The inline box goes back to the stylesheet, and a fold that was becoming
   * a bubble completes the trade: the tile leaves and the bubble is revealed.
   * Fired by the landing's `transitionend`, and called again on every cue and
   * on `clear`, the keyholes' interrupt rule: a cancelled transition fires no
   * landing, and a bubble left holding its place invisibly forever would be a
   * message the run swallowed.
   */
  function settleMorph(): void {
    const kind = envelope.dataset.morph;
    if (kind === undefined && morphingBubble === null) return;
    delete envelope.dataset.morph;
    releaseBox(envelope);
    if (kind === 'to-bubble') envelope.hidden = true;
    if (morphingBubble !== null) {
      delete morphingBubble.dataset.arriving;
      morphingBubble = null;
    }
  }

  function anchorFor(place: 'sender' | 'relay' | 'receiver', cue: SceneCue): HTMLElement {
    /* Which device is the sender is a fact about the cue rather than a fixed
       side, because either device may start a conversation. */
    const from = senderOf(cue);
    const to = recipientOf(cue);
    /* At the relay the envelope rests in the mailbox it is addressed to, which
       is the whole reason there are two of them: a row waiting over the
       sender's own mailbox would draw the relay handing the message back.
       The bay's *body*, not the bay: the body is the part below the caption
       (the stylesheet stretches it to fill the bay), so the envelope sits in
       the box without covering the word "mailbox". */
    if (place === 'relay') return slotBody('mailbox', to);
    if (place === 'sender') return phone(from);
    /* The tile rests beside the phone through the whole arrival, the opening
       included: its move into the conversation is the fold onto the bubble's
       own box (`openIntoBubble`), aimed at a measured rect rather than an
       anchor — so the anchor's only job here is the rest, and the keyholes
       `turnKeys` aims off it stay on the tile. */
    return phone(to);
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

  /* The landing puts the envelope's traveling glow out. Both properties,
     because the tile makes two kinds of move: wire crossings ride
     `offset-distance` and in-column glides ride `transform`. An interrupted
     flight never fires this — `settleCrossing` clears the flag on the next
     cue instead, the keyholes' interrupt rule. A morph's landing settles the
     morph instead, on any of its three box properties: a bubble the tile's
     own width would run no width transition at all. */
  envelope.addEventListener('transitionend', (event) => {
    /* The tile's own landings only. `transitionend` bubbles, and the face's
       children run transitions of their own — a keyhole's turn ending during
       the fold's wait would read as the morph's landing and cut the fold to
       a jump. */
    if (event.target !== envelope) return;
    if (envelope.dataset.morph !== undefined) {
      if (endsMorph(event)) settleMorph();
      return;
    }
    if (event.propertyName !== 'offset-distance' && event.propertyName !== 'transform') return;
    envelope.dataset.crossing = 'false';
  });

  /* The traveling prekey is stamped once, at mount, rather than built and
     thrown away per crossing. It is one key and it makes one journey per
     session, so there is nothing for a rebuild to keep in step — and a node that
     exists from mount has a box to be measured against on the frame it is
     wanted, which a node created inside the cue would not. */
  spentKey.append(keyGlyph());

  /* Landing is where the prekey does its work: it is absorbed into the ratchet
     wheel it was flown to, and the wheel lights as deriving — the material's
     next appearance is the message keys that wheel makes. A key that merely
     stood at the device for the rest of the dwell read as delivered and then
     lost, not used. The side comes off the key itself, the message keys'
     `landLocked` idiom, because the landing outlives the cue that launched
     it. */
  spentKey.addEventListener('transitionend', (event) => {
    if (event.propertyName !== 'offset-distance' || spentKey.dataset.flying !== 'true') return;
    const side = spentKey.dataset.landSide;
    spentKey.hidden = true;
    spentKey.dataset.flying = 'false';
    spentKey.style.removeProperty('offset-path');
    spentKey.style.removeProperty('offset-distance');
    delete spentKey.dataset.landSide;
    if (side === 'a' || side === 'b') setDeriving(side);
  });

  /**
   * Light the wheel that is deriving, and only that one. `null` puts both out.
   * The glow spans the flight of the message keys the wheel is making, so it is
   * lit where the pair launches and put out where the last of them lands.
   */
  /** Light the one network link a cue moves material over, and put the other
      out. The stylesheet owns what lit looks like; the dwell is the duration —
      the wire carries traffic for exactly the step it serves, and the next
      cue's write is what ends it, the scene's no-clock rule. `flow` is which
      way the material is going — a push toward the relay or a pull toward the
      device — and it drives the direction the stylesheet's traffic pulse
      sweeps in. Written only with a lit side and removed everywhere else, so
      a dark wire never carries a stale direction into its next lighting.
      `scope` is which wires this cue owns — a registration lane's cue may
      rest only its own, `REGISTRATION_STEPS`' rule. */
  function setLinkTraffic(
    side: Side | null,
    flow?: 'to-relay' | 'to-device',
    scope: readonly Side[] = SIDES,
  ): void {
    for (const s of scope) {
      link(s).dataset.active = String(s === side);
      if (s === side && flow !== undefined) link(s).dataset.flow = flow;
      else delete link(s).dataset.flow;
    }
  }

  /** Light the bundle shelf traffic is touching, and only that one — the
      wire's own rule, worn by the bay: a publish fills the publisher's shelf,
      a spend takes from the responder's, and every other cue rests both it
      owns, on the wire's own `scope`. `holding` is a different fact — a
      shelf with keys on it holds them for the whole run — so busyness gets
      its own attribute rather than a second meaning. */
  function setBundleTraffic(side: Side | null, scope: readonly Side[] = SIDES): void {
    for (const s of scope) slot('bundles', s).dataset.busy = String(s === side);
  }

  /** Light the private-key store while its own device is writing it — the
      generating cues, when the bar is the thing moving. The shelf's
      distinction, worn by the row: busyness is not fullness, the store
      holds keys for the whole run and the accent marks only the writes. */
  function setKeyTraffic(side: Side | null, scope: readonly Side[] = SIDES): void {
    for (const s of scope) keysRow(s).dataset.busy = String(s === side);
  }

  function setDeriving(side: Side | null): void {
    for (const s of SIDES) train(s).dataset.deriving = String(s === side);
  }

  /* The message keys are stamped once at mount for the spent key's reasons —
     and each leaves the scene the moment its flight lands, the burst's rule:
     the reel holds each step for a reading dwell, and a key that waited for
     the next cue would stand glowing on the envelope for the whole of it.
     Landing is also when the key does its work: the keyhole it aimed at takes
     the state the launch wrote on the key, so the hole turns as the key
     arrives rather than on the page's guess about when that would be. The
     wheel's glow goes out with the last landing. */
  for (const kind of LOCK_KINDS) {
    const key = messageKeys[kind];
    key.append(keyGlyph());
    key.addEventListener('transitionend', (event) => {
      if (event.propertyName !== 'transform' || key.dataset.flying !== 'true') return;
      const landLocked = key.dataset.landLocked ?? 'false';
      keyhole(kind).dataset.locked = landLocked;
      keyhole(kind).dataset.turning = 'true';
      key.hidden = true;
      key.dataset.flying = 'false';
      key.style.removeProperty('transform');
      delete key.dataset.landLocked;
      if (LOCK_KINDS.every((k) => messageKeys[k].hidden)) {
        setDeriving(null);
        /* The payload changes when the second key has turned its hole, not
           when the cue shows: the sealing and the opening the reader is
           watching are both the keys' doing, so the dark face may not appear
           while the locking pair is still flying in, and the plaintext may
           not appear while the unlocking pair is. The landing's own direction
           says which way the payload goes. Sealing is also when the size mark
           first exists to show — `show()` wrote the text and left it hidden
           over the plaintext. */
        envelope.dataset.sealed = landLocked;
        if (landLocked === 'true') envelopeSize.hidden = envelopeSize.textContent === '';
      }
    });
  }

  /*
   * The publish burst's travelers, stamped once at mount like the spent key
   * and for its reasons: they exist from the frame the scene does, so they have
   * boxes to be measured against on the frame they are wanted, and each is the
   * component's one key drawing rather than a second one. `data-burst` is the
   * clump the stylesheet files each traveler into, fixed per element because
   * the burst's shape is the burst's, not a fact about any particular publish.
   * A pool per device, because the two registration lanes may both be telling
   * their stories at once: a shared pool handed one device's burst to the
   * other's publish, and the second launch stole the first mid-flight.
   */
  const flyers: Record<Side, HTMLElement[]> = {
    a: [...root.querySelectorAll<HTMLElement>("[data-scene-flying-key='a']")],
    b: [...root.querySelectorAll<HTMLElement>("[data-scene-flying-key='b']")],
  };
  for (const side of SIDES)
    flyers[side].forEach((flyer, index) => {
      flyer.append(keyGlyph());
      flyer.dataset.burst = String(index);
      /* Each traveler leaves the scene the moment its flight lands. The reel
         pauses on the publish cue until the visitor sends, so a traveler that
         waited for the next cue would stand glowing on the shelf's anchor for
         the whole pause — five keys drawn over one. The shelf's bar and count
         already hold what was delivered. */
      flyer.addEventListener('transitionend', (event) => {
        if (event.propertyName !== 'offset-distance' || flyer.dataset.flying !== 'true') return;
        flyer.hidden = true;
        flyer.dataset.flying = 'false';
        flyer.style.removeProperty('offset-path');
        flyer.style.removeProperty('offset-distance');
      });
    });

  /* One key beside each bar, saying what the bar is an amount of. Stamped at
     mount: these anchors are also where every traveling key sets off from or
     lands, so a store's glyph and its journeys are one drawing. */
  for (const side of SIDES) keyAnchor(side).append(keyGlyph());

  /*
   * What each bar's length is drawn against: the most that store has held this
   * run. There is no fixed capacity to fill against — a store holds what the
   * protocol put there — so the scale is the run's own high-water mark, reset
   * with the run. Both figures are the recording's; the only arithmetic here is
   * the one that turns two counts into a length, which is the rule every bar
   * in this scene follows.
   */
  const most: Record<'keys' | 'shelf', Record<Side, number>> = {
    keys: { a: 0, b: 0 },
    shelf: { a: 0, b: 0 },
  };

  /**
   * A count against what it is counted out of.
   *
   * `x / y` while the count is short of the scale — filling during generation,
   * or dipped after a spend — and the plain number once the two agree, because
   * `200 / 200` states a limit the store does not have. The slash carries a
   * space each side so the figure cannot read as a date or a fraction.
   */
  function outOf(count: number, scale: number): string {
    return count < scale ? `${count} / ${scale}` : String(count);
  }

  function fillKeys(side: Side, count: number): void {
    most.keys[side] = Math.max(most.keys[side], count);
    const scale = most.keys[side];
    keyBar(side).style.width = `${scale > 0 ? (count / scale) * 100 : 0}%`;
    keyCount(side).textContent = outOf(count, scale);
  }

  /**
   * Turn the wheel one tooth per message key derived, and only ever forward.
   *
   * The rotation is `taken * 60°` without a modulo, so the angle is a running
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
    const gear = wheel(side);
    /* The swell rides only a real click: parity keys the CSS animation, and
       writing it for the mount's zero or a cue that repeats a count would
       pulse a wheel that took no step. */
    if (taken > 0 && gear.dataset.turns !== String(taken))
      gear.dataset.pulse = String(taken % 2);
    wheelTurn(side).style.transform = `rotate(${taken * DEGREES_PER_KEY}deg)`;
    gear.dataset.turns = String(taken);
    /* The total is the number that only ever grows, and it is the one a reader
       can check against how many messages they have sent. "Message keys" and
       not bare "keys", because the device's key store sits one row up and an
       unqualified count here would read as a second opinion about it — these
       are the keys the chain wheel has made, one per turn. "Derived" is the
       protocol's own verb: a message key comes out of a key-derivation
       function, it is not generated fresh. */
    ratchetCount(side).textContent =
      taken === 1 ? '1 message key derived' : `${taken} message keys derived`;
  }

  /**
   * Click one family wheel forward a tooth. A click is a ratchet step — the
   * moment that family folds a fresh secret into the session — so the caller
   * clicks only when the protocol took one, not once per message; the chain
   * wheel owns the per-message turn. The angle is a running total off the
   * wheel's own `data-turns`, the chain wheel's idiom and for its reason: no
   * count this is derived from ever decreases while a session lives.
   *
   * A wheel out of gear does not click. A double-ratchet session still flies
   * a post-quantum key — the agreement's contribution locks every message —
   * but no post-quantum *ratchet* stepped to make it, and a turning idle
   * wheel would claim one had.
   */
  function clickFeeder(side: Side, kind: LockKind): void {
    const gear = feeder(side, kind);
    if (gear.dataset.engaged === 'false') return;
    const taken = Number(gear.dataset.turns ?? '0') + 1;
    gear.dataset.turns = String(taken);
    gear.dataset.pulse = String(taken % 2);
    need<SVGElement>(gear, '.demo-ratchet-turn').style.transform =
      `rotate(${taken * DEGREES_PER_KEY}deg)`;
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
    const turns = [
      wheelTurn(side) as SVGElement & { dataset: DOMStringMap },
      ...LOCK_KINDS.map((kind) => need<SVGElement>(feeder(side, kind), '.demo-ratchet-turn')),
    ];
    for (const turn of turns) turn.dataset.rewind = 'true';
    turnRatchet(side, 0);
    delete wheel(side).dataset.pulse;
    for (const kind of LOCK_KINDS) {
      const gear = feeder(side, kind);
      delete gear.dataset.turns;
      delete gear.dataset.pulse;
      need<SVGElement>(gear, '.demo-ratchet-turn').style.removeProperty('transform');
    }
    void wheel(side).getBoundingClientRect();
    for (const turn of turns) delete turn.dataset.rewind;
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
      /* The caption's claim, drawn: a double ratchet is the same train with
         the post-quantum wheel out of gear, and a scene with no session puts
         the wheel back to neutral. */
      const pq = feeder(side, 'pq');
      if (kind === 'double') pq.dataset.engaged = 'false';
      else delete pq.dataset.engaged;
    }
  }

  /*
   * The shelves' meters, built once at mount into the slot bodies the markup
   * ships empty but for their captions. Built here rather than written in the
   * markup because the two bundle slots and the two mailboxes are one shape in
   * `DemoScene.astro`, and only the bundle pair holds an amount. The empty
   * caption is the markup's own — the relay's wording stays in the relay's
   * file — and it trades places with the meter as the count leaves zero.
   */
  const shelfMeter = Object.fromEntries(
    SIDES.map((side) => {
      const body = slotBody('bundles', side);
      const anchor = document.createElement('span');
      anchor.className = 'demo-key';
      anchor.dataset.public = 'true';
      anchor.append(keyGlyph());
      const track = document.createElement('span');
      track.className = 'demo-relay-slot-track';
      const bar = document.createElement('span');
      bar.className = 'demo-relay-slot-bar';
      track.append(bar);
      const count = document.createElement('span');
      count.className = 'demo-relay-slot-count';
      const parts = [anchor, track, count];
      for (const part of parts) part.hidden = true;
      body.append(...parts);
      return [
        side,
        { empty: need<HTMLElement>(body, '.demo-relay-slot-empty'), anchor, bar, count, parts },
      ] as const;
    }),
  ) as Record<
    Side,
    {
      empty: HTMLElement;
      anchor: HTMLElement;
      bar: HTMLElement;
      count: HTMLElement;
      parts: HTMLElement[];
    }
  >;

  /**
   * Put each device's published count on that device's own shelf.
   *
   * Every shelf the cue owns, from the pair the cue carries. Drawing only the
   * side that has just published would leave the other shelf showing whatever it
   * last held, which is right until a reset and wrong immediately after one; and
   * a shelf that took its figure from anything but that device's own publish
   * would be this file doing the relay's accounting. `scope` narrows the write
   * for a registration lane's cue, whose snapshot of the *other* shelf may be
   * older than what the other lane has already drawn.
   *
   * `launching` is the device this call is the publish *of*, and only its burst
   * flies. Both shelves are drawn on every call, so without it the shelf that
   * published a step ago would send its burst across again on the other
   * device's publish — the same material published twice, which is the one
   * thing a shelf per account exists to say does not happen.
   */
  function holdBundles(
    counts: Readonly<Record<Side, number>>,
    launching?: Side,
    scope: readonly Side[] = SIDES,
  ): void {
    for (const side of scope) {
      const count = counts[side];
      most.shelf[side] = Math.max(most.shelf[side], count);
      const scale = most.shelf[side];
      const meter = shelfMeter[side];
      /* A meter this very write reveals has no rendered frame for the width
         transition to leave from — it would appear already full. Unhide
         first and force one empty-width frame, so the fill sweeps in on the
         flight clock the way the device's own bar does. */
      const revealed = meter.anchor.hidden && count > 0;
      for (const part of meter.parts) part.hidden = count === 0;
      if (revealed) {
        meter.bar.style.width = '0%';
        void meter.bar.offsetWidth;
      }
      meter.bar.style.width = `${scale > 0 ? (count / scale) * 100 : 0}%`;
      meter.count.textContent = outOf(count, scale);
      slot('bundles', side).dataset.holding = String(count > 0);
      meter.empty.toggleAttribute('hidden', count > 0);
      if (side === launching) launchKeys(side);
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
   * Draw how far one device has got through making its keys, on the store's own
   * row.
   *
   * The fill is `count` of `total` and both are the recording's, so the only
   * arithmetic here is the one that turns two counts into a length. Written
   * into the same bar and count the settled store uses, because it is the same
   * material: generation is the store filling, and a separate "generating" row
   * drew the device's keys twice and left a reader asking which of the two bars
   * was the keys.
   *
   * The scale is seeded with the total, so the bar fills toward the whole batch
   * rather than always reading full — a bar scaled to the count so far is a bar
   * at 100% for the entire generation, which draws a store that was never not
   * full. The count prints `so far / total` while they differ and settles to
   * the plain amount when they meet, `outOf`'s rule.
   */
  function drawKeygen(report: NonNullable<SceneCue['keygen']>): void {
    const { side, count, total } = report;
    most.keys[side] = Math.max(most.keys[side], total);
    const scale = most.keys[side];
    keyBar(side).style.width = `${scale > 0 ? (count / scale) * 100 : 0}%`;
    keyCount(side).textContent = outOf(count, scale);
  }

  /**
   * Send a burst of keys from this device's key glyph to its shelf's.
   *
   * One journey, five travelers: the burst sets off from the one key beside
   * the device's bar and lands on the one key beside the shelf's, because those
   * two glyphs are what stand for the stores — a reader tracks material leaving
   * the place that says *private keys* and arriving at the place the relay
   * counts it. Both ends are measured from the live boxes in the same frame,
   * the spent key's mechanism in the other direction, so the crossing survives
   * any width.
   *
   * The positions are all this function decides. How long a traveler takes,
   * which leave together, and the glow that carries the eye are the
   * stylesheet's — `data-burst` was filed at mount and never changes. This
   * module owns where a thing is and when it moves, which is the same line the
   * key glyph itself is drawn on the other side of.
   *
   * Unhidden before anything is measured: a `hidden` element has no box, and a
   * journey measured from one is a journey from the scene's corner. The route
   * is written first and the travelers rest at its start — `offset-distance`
   * 0% is the resting state — and the forced read between the writes is what
   * commits that placement, so the release runs the wire rather than jumping
   * to the shelf.
   */
  function launchKeys(side: Side): void {
    const route = wirePath(keyAnchor(side), shelfMeter[side].anchor, side);
    for (const flyer of flyers[side]) {
      flyer.dataset.flying = 'false';
      flyer.hidden = false;
      flyer.style.removeProperty('offset-distance');
      flyer.style.setProperty('offset-path', route);
    }
    void root.offsetWidth;
    for (const flyer of flyers[side]) {
      flyer.dataset.flying = 'true';
      flyer.style.setProperty('offset-distance', '100%');
    }
  }

  /**
   * Take the burst off the scene, which is every cue but the one that
   * publishes. A traveler left standing would sit over the shelf for the rest
   * of the run, drawing material that is both delivered and still in the air —
   * the spent key's rule, applied to five. Scoped like the traffic setters: a
   * registration lane's cue parks only its own device's burst, because the
   * other lane's may still be crossing.
   */
  function hideFlyers(scope: readonly Side[] = SIDES): void {
    for (const side of scope)
      for (const flyer of flyers[side]) {
        flyer.hidden = true;
        flyer.dataset.flying = 'false';
        flyer.style.removeProperty('offset-path');
        flyer.style.removeProperty('offset-distance');
      }
  }

  /**
   * Send the prekey the key agreement spent from the peer's shelf to the
   * ratchet wheel of the device that asked for it — the wheel and not the
   * phone, because the wheel is what the fetched material becomes: the landing
   * absorbs the key and lights the wheel as deriving, the mount listener's
   * work, and the glow then runs into the first message's derivation.
   *
   * `null` takes it off the scene, which is every step but the one that agrees a
   * key. A key left standing would be a prekey that is both spent and still in
   * the air, and it would sit over the columns for the whole of the message that
   * follows.
   *
   * Routed and released rather than displaced: the route is written while the
   * key rests at its start — `offset-distance` 0% is the resting state, and it
   * carries no transition at all — and the release is a single write of the
   * distance. Both ends are real and measured in the same frame, so the
   * crossing survives any width; and because the resting state is a position
   * rather than a displacement, a reader with motion turned off is shown the
   * key at the device on the frame the step arrives instead of stranded off a
   * slot.
   *
   * The forced read between the two writes is what makes the route the place
   * the release sets off from. It is read off the key itself rather than off
   * the scene. Both halves are load-bearing: without the read the browser sees
   * one change and the key is simply already at the device, and with a
   * transition on the resting state the placement animates too and the flight
   * sets off from wherever that had reached, which is nowhere in particular.
   */
  function spendKey(journey: { readonly from: Side; readonly to: Side } | null): void {
    if (journey === null) {
      spentKey.hidden = true;
      spentKey.dataset.flying = 'false';
      spentKey.style.removeProperty('offset-path');
      spentKey.style.removeProperty('offset-distance');
      delete spentKey.dataset.landSide;
      return;
    }
    /* Unhidden before either rectangle is taken: a `hidden` element has no box,
       and a journey measured from one is a journey from the scene's corner. */
    spentKey.dataset.flying = 'false';
    spentKey.hidden = false;
    spentKey.style.removeProperty('offset-distance');
    /* Off the shelf's own key glyph — the thing that stands for the store the
       material really came off — and to the wheel of the device that asked for
       it, along that device's own link: the fetch came over the wire. */
    spentKey.style.setProperty(
      'offset-path',
      wirePath(shelfMeter[journey.from].anchor, wheel(journey.to), journey.to),
    );
    spentKey.dataset.landSide = journey.to;
    void spentKey.offsetWidth;
    spentKey.dataset.flying = 'true';
    spentKey.style.setProperty('offset-distance', '100%');
    /* Lit here as well as by the landing: under reduced motion the flight is
       a near-zero snap whose `transitionend` — and with it the absorption —
       arrives only after a rendered frame, and the glow belongs to the cue,
       not to whenever the browser next paints. */
    if (prefersStill()) setDeriving(journey.to);
  }

  /**
   * Whether this reader asked for less motion — asked at flight time rather
   * than held from mount, so a setting flipped mid-session governs the next
   * flight rather than the next visit.
   */
  const prefersStill = (): boolean =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Set both keyholes at once. The pair lock and unlock together or not at all.
      Asserting the state also puts out the worked light: a cue that writes the
      holes directly interrupted whatever turn was running, and a cancelled
      transition fires no `transitionend` to put it out. */
  function setKeyholes(locked: boolean): void {
    for (const kind of LOCK_KINDS) {
      keyhole(kind).dataset.locked = String(locked);
      delete keyhole(kind).dataset.turning;
    }
  }

  /* The worked light goes out when the barrel stops — the turn's own end,
     not the landing's, so the accent spans exactly the quarter turn the
     reader is watching. */
  for (const kind of LOCK_KINDS) {
    const turn = keyhole(kind).querySelector<SVGGElement>('.demo-keyhole-turn');
    turn?.addEventListener('transitionend', (event) => {
      if (event.propertyName !== 'transform') return;
      delete keyhole(kind).dataset.turning;
    });
  }

  /**
   * Take the message keys off the scene, which is every cue but the two that
   * derive one — the spent key's rule, applied to the pair. A key left
   * standing would sit glowing over the envelope for the whole of the next
   * dwell, and a `landLocked` left on it would turn a keyhole on some later
   * landing that never happened.
   */
  function hideMessageKeys(): void {
    for (const kind of LOCK_KINDS) {
      const key = messageKeys[kind];
      key.hidden = true;
      key.dataset.flying = 'false';
      key.style.removeProperty('transform');
      delete key.dataset.landLocked;
    }
    setDeriving(null);
  }

  /**
   * Send both message keys from a device's ratchet wheel to the envelope's two
   * keyholes, and turn the holes as the keys land.
   *
   * These are the keys that actually lock a message, and neither is half of a
   * keypair: the ratchet derives fresh symmetric material per message, on each
   * end, and that material answers to both key agreement families — which is
   * what the two holes stand for. The sender's wheel glows and its keys seal
   * the envelope; the receiver's wheel makes the matching pair to open it. The
   * flight is what ties the wheel to the envelope — without it the wheel is an
   * odometer.
   *
   * They never cross the gap between columns. The sender's flight ends at the
   * envelope while the envelope is still at the sender, and the receiver's
   * starts only once the envelope has arrived, so no frame shows a secret in
   * transit — the one thing the protocol never does.
   *
   * The keyholes are aimed at where the envelope is *going*, not where it is:
   * the envelope was set moving in this same cue, so a hole measured directly
   * would be measured mid-glide. The destination is the envelope's own target
   * over `anchor`, and a hole's offset inside the envelope does not change
   * with the envelope's position, so the sum is the hole's landing place.
   *
   * Landing is where the lock state lands too — the mount listener applies
   * each key's `landLocked` to its own hole. A reader who asked for less
   * motion gets the state without the flight: the keys are `display: none`
   * there and a zeroed transition fires no `transitionend`, so a hole gated on
   * one would never turn.
   */
  function turnKeys(side: Side, locked: boolean, anchor: Element, stepped: boolean): void {
    /* The family wheels click in either mode, but only when their ratchets
       really stepped — on the first message of a direction run, where the DH
       ratchet folds in a fresh agreement and the post-quantum epoch advances
       with it. On the later messages of a run the two stand still while the
       chain wheel turns alone: the keys still fly, because every message key
       answers to both families, but a click is a ratchet step and the
       protocol took none. */
    if (stepped) for (const kind of LOCK_KINDS) clickFeeder(side, kind);
    if (prefersStill()) {
      setKeyholes(locked);
      /* No flight means no landing to deliver the seal or the unseal, so both
         happen here — without this a reduced-motion reader spends the whole
         `opened` dwell looking at a tile that never opens, and the whole
         `encrypted` dwell looking at plaintext that never seals. The size mark
         follows the seal, as it does at the landing. */
      envelope.dataset.sealed = String(locked);
      if (locked) envelopeSize.hidden = envelopeSize.textContent === '';
      return;
    }
    /* Unhidden before anything is measured: a `hidden` element has no box, and
       a journey measured from one is a journey from the scene's corner. */
    for (const kind of LOCK_KINDS) {
      messageKeys[kind].dataset.flying = 'false';
      messageKeys[kind].hidden = false;
    }
    const envAt = centerOn(envelope, anchor);
    /* The rect may be caught mid-fold at the previous message's landing scale,
       which shrinks every distance measured through it — the same contamination
       `centerOn` guards against. The ratio of layout size to rect size is that
       scale, and dividing it back out turns each hole's rect offset into a
       layout offset. About the center, because that is the transform origin:
       the center is the one point the scale does not move. */
    const envBox = envelope.getBoundingClientRect();
    const envScaleX = envBox.width / envelope.offsetWidth;
    const envScaleY = envBox.height / envelope.offsetHeight;
    /* Each key sets off from the wheel of its own family — the labeled wheel
       is the key's provenance, and launching both from one point would spend
       the legend the captions just paid for. */
    for (const kind of LOCK_KINDS) {
      const key = messageKeys[kind];
      const start = centerOn(key, feeder(side, kind));
      key.style.transform = `translate(${start.x}px, ${start.y}px)`;
    }
    void root.offsetWidth;
    for (const kind of LOCK_KINDS) {
      const key = messageKeys[kind];
      const hole = keyhole(kind).getBoundingClientRect();
      const holeCenterX =
        envelope.offsetWidth / 2 +
        (hole.left + hole.width / 2 - (envBox.left + envBox.width / 2)) / envScaleX;
      const holeCenterY =
        envelope.offsetHeight / 2 +
        (hole.top + hole.height / 2 - (envBox.top + envBox.height / 2)) / envScaleY;
      const x = envAt.x + holeCenterX - key.offsetWidth / 2;
      const y = envAt.y + holeCenterY - key.offsetHeight / 2;
      key.dataset.landLocked = String(locked);
      key.dataset.flying = 'true';
      key.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    setDeriving(side);
  }

  /*
   * Who sealed, and who was opened from, last — the state behind the family
   * wheels' schedule. `null` means no message yet, so the first message of a
   * run always reads as a turn of direction, which it is: the agreement that
   * created the session is the step it rides in on.
   */
  let lastSealedBy: Side | null = null;
  let lastOpenedFrom: Side | null = null;

  const view: SceneView = {
    show(cue, flightMs) {
      /* Which sides this cue may write. A registration lane's cue owns its
         own device's column, wire and shelves and nothing else — the other
         lane may be mid-story on its own transport. Everything below that
         touches per-side state takes this scope; the writes both lanes make
         identically (keyholes, mailbox rest, envelope) stay whole-scene,
         because identical writes cannot stomp. */
      const lane = registrationLaneOf(cue);
      const scope: readonly Side[] = lane ? [lane] : SIDES;
      root.dataset.sceneState = cue.step;
      /* On the scene rather than on the envelope, because the envelope is no
         longer the only thing that flies: the published keys cross the same gap
         on the same step's clock, and one property both inherit is what keeps
         the two journeys from being timed separately. */
      root.style.setProperty('--demo-flight-ms', `${Math.max(0, Math.round(flightMs))}ms`);
      /* A cue that arrives while the last one is still folding away cancels the
         fold: the envelope belongs to whichever message is current. */
      setLanding(false);
      /* And one that arrives during — or after — a wire crossing hands the
         envelope's position back to `transform` before anything below moves
         or measures it. A morph the reader stepped past settles the same
         way, its visibility trade included. */
      settleCrossing();
      settleMorph();

      /* Generation first and the settled count second, so a cue that carries
         both lands on the store's true amount: the keygen report counts only
         the batches the SDK announced, and the settled figure includes the
         identity and signed keys made without one. */
      if (cue.keygen) drawKeygen(cue.keygen);
      if (cue.keys) for (const side of scope) fillKeys(side, cue.keys[side]);
      if (cue.ratchet) for (const side of scope) turnRatchet(side, cue.ratchet[side]);
      /* Set at the step that agreed the keys and left alone after it: every
         later cue in the same session is still that session, and a caption
         cleared between steps would flicker the one fact this line carries. */
      if (cue.ratchetKind) nameRatchet(cue.ratchetKind);
      /* The publishing device is the one whose burst flies, and the recording
         named it: the actor of a publish step is the device that published.
         Not `senderOf`, which answers a question about a message — on a step
         with nothing traveling between devices it falls back to a side, and
         the fallback would send device A's burst across on both publishes.
         Every other cue takes the burst off the scene, the spent key's rule:
         a flight belongs to the step that launched it. */
      const publisher =
        cue.step === 'bundles-published' && (cue.actor === 'a' || cue.actor === 'b')
          ? cue.actor
          : undefined;
      if (!publisher) hideFlyers(scope);
      if (cue.bundles !== undefined) holdBundles(cue.bundles, publisher, scope);
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
       * fallback here, which matters: on a step with nothing traveling between
       * devices the fallback answers for both sides and would send a key off
       * whichever shelf it happened to pick.
       *
       * Off the responder's shelf and to the initiator's wheel, which is the
       * direction the protocol went: the initiating device fetched the bundle,
       * and the material it took was the other account's.
       */
      const spend =
        cue.step === 'session-established' && cue.bundles !== undefined
          ? { from: recipientOf(cue), to: senderOf(cue) }
          : null;
      /* The message keys belong to the steps whose seal or unseal derived
         them, the spent key's rule: every other cue takes the pair off the
         scene and writes the keyholes' state directly — the launch itself
         waits until the envelope has been placed below. Written on every
         non-deriving cue rather than trusted to the landings, because a
         landing is an event and an interrupted flight never fires one: a
         reader who skips a step ahead still finds the holes in the state the
         step they landed on requires. */
      if (cue.step !== 'encrypted' && cue.step !== 'opened') {
        hideMessageKeys();
        setKeyholes(SEALED_AT.has(cue.step));
      }
      /* Launched after the block above, not before it: `hideMessageKeys` puts
         both wheels out, and under reduced motion the spend lights the
         initiator's wheel in the same frame it is called — a launch ahead of
         the sweep would be lit and swept dark in one cue. */
      spendKey(spend);

      /* The device the relay has just accepted. One side per cue, the device
         the recording named, because each device registers on its own — the
         reader pressed this one's button. Three writes, one fact: the wire
         to the relay is now a standing connection, the relay's account for
         this device exists — the slots the rest of the run fills — and the
         device is online. The connection and the account persist for the run;
         only `clear()` takes them down. */
      const registering =
        cue.step === 'registered' && (cue.actor === 'a' || cue.actor === 'b')
          ? cue.actor
          : null;
      if (registering !== null) {
        link(registering).dataset.connected = 'true';
        account(registering).dataset.registered = 'true';
        /* The activation control folds away with the same write: the phone's
           attribute is the state, and the stylesheet hides the button a
           second press could only repeat. */
        phone(registering).dataset.activated = 'true';
        const state = deviceState(registering);
        state.textContent = 'online';
        /* The word and the dot are one fact written twice — the text for the
           reader, the attribute for the stylesheet's color — so they change
           in the same statement or the dot lies. */
        state.dataset.online = 'true';
      }

      /* Which wire is carrying this cue's material, and which way it is
         going. A registration is the connection's own first crossing; then
         two pushes and two pulls: a publish pushes the burst up the
         publisher's own link, agreeing a session pulls the far bundle down
         the initiator's, sending pushes the envelope up the sender's, and
         delivery pulls it down the recipient's. `stored-at-relay` lights
         nothing on purpose — the message is at rest, and a wire lit while
         nothing moves would say the network is busier than it is. `spend.to`
         is the initiator, the device that fetched. */
      if (publisher) setLinkTraffic(publisher, 'to-relay', scope);
      else if (registering) setLinkTraffic(registering, 'to-relay', scope);
      else if (spend) setLinkTraffic(spend.to, 'to-device', scope);
      else if (cue.step === 'in-transit') setLinkTraffic(senderOf(cue), 'to-relay', scope);
      else if (cue.step === 'delivered') setLinkTraffic(recipientOf(cue), 'to-device', scope);
      else setLinkTraffic(null, undefined, scope);

      /* The shelf lights when its prekeys are touched: a publish fills the
         publisher's, a session-agreement spends from the responder's
         (`spend.from` — the device whose bundle was fetched). Every other
         cue rests the shelves it owns. */
      setBundleTraffic(publisher ?? spend?.from ?? null, scope);

      /* And the device's own store, while the generation cues are filling
         it. `lane` is the generating device — these are registration steps,
         so the cue's actor and its lane are the same side. */
      setKeyTraffic(cue.step === 'generating-keys' ? lane : null, scope);

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
        /* The strip and the size empty with the envelope they caption: a
           figure held into the next session would describe an envelope that
           no longer exists. */
        chunkStrip.hidden = true;
        chunkStrip.textContent = '';
        envelopeSize.hidden = true;
        envelopeSize.textContent = '';
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
      /* Overwritten only when a cue carries one, the metadata's idiom: the
         report arrives on the sealing step and the strip holds it for the
         rest of the journey. A run with the braid off never sends one, and
         the strip never appears. */
      if (cue.chunk) {
        chunkStrip.textContent = cue.chunk;
        chunkStrip.hidden = false;
      }
      /* The size rides the same idiom, but drawn only from the moment the
         tile is sealed: the figure is the sealed envelope's, so on the sealing
         step the text is written here and the seal's own landing unhides it
         (reduced motion unhides it in `turnKeys`). It stays through the
         opening — what the envelope weighed does not stop being true when it
         is opened — and leaves with the tile. */
      if (cue.bytes !== undefined) envelopeSize.textContent = humanBytes(cue.bytes);
      envelopeSize.hidden = envelopeSize.textContent === '' || !sealed;

      const anchor = anchorFor(place, cue);
      if (envelope.hidden || cue.step === 'encrypted') {
        /* First appearance, and every sealing step. A hidden tile placed
           with a transition would fly in from the scene's top-left corner,
           and a new message would glide in from wherever the last one folded
           away — neither is a journey anything took, so the placement
           itself never animates. On a sealing step this placement is the
           morph's measuring frame: the console speaks the sentence right
           after this cue, and `say` sets the tile off from that bubble's
           own box into this rest (`sealFromBubble`). A reader who asked for
           less motion gets the placement alone. */
        envelope.dataset.flying = 'false';
        envelope.hidden = false;
        moveTo(anchor);
        /* Read back so the placement is committed before flight is
           re-armed. */
        void envelope.offsetWidth;
        envelope.dataset.flying = 'true';
      } else if (cue.step === 'in-transit' || cue.step === 'delivered') {
        /* The two steps that cross the gap ride the wire, the way every key
           does: out to the relay on the sender's link and in to the device
           on the receiver's — at its one size, because the tile is the
           reader's only fixed object and a message is not replaced at the
           boundary, it is wrapped. The start is the previous step's resting
           anchor rather than the envelope's own box, so an interrupted glide
           still sets off from the place the story last put the message. */
        rideWire(
          cue.step === 'in-transit' ? phone(senderOf(cue)) : slot('mailbox', recipientOf(cue)),
          anchor,
          cue.step === 'in-transit' ? senderOf(cue) : recipientOf(cue),
        );
      } else {
        envelope.dataset.flying = 'true';
        /* An in-column glide is still the tile underway, so it carries the
           traveling glow, and the landing's `transitionend` puts it out.
           Only when it *is* a glide: a cue whose anchor is where the tile
           already rests — the relay dwell after the flight that landed
           there — moves nothing, and a resting tile does not glow. */
        if (moveTo(anchor)) envelope.dataset.crossing = 'true';
      }

      /*
       * Arrival, the reduced-motion half. The envelope shows its plaintext for
       * a beat, then leaves as the bubble appears — the message becomes the
       * message. With motion on, that whole gesture is the fold `say` arms
       * onto the bubble's own box (`openIntoBubble`); a reader who asked for
       * less motion gets no morph, so the leaving is this placed fold instead,
       * and the bubble's reveal stays the stylesheet's delayed write on the
       * same arithmetic. Set at once and delayed in CSS either way, so the
       * beat costs this module no clock.
       */
      if (cue.step === 'opened' && prefersStill()) setLanding(true);

      /* The derivation, launched last: the keyholes are aimed off the anchor
         the envelope has just been sent to, so the keys land on the holes —
         and measuring before the envelope was set moving would aim the
         flights at wherever the last step left things. The sender's wheel
         locks, the receiver's unlocks; each pair stays inside its own
         column.

         Whether the family wheels click rides on the message's direction: a
         DH ratchet steps only when the conversation turns around — the SDK's
         SPQR module keeps its epochs in step with those same DH steps — so a
         run of same-direction messages turns the chain wheel alone. Tracked
         per stream, sealing and opening each against its own predecessor,
         because the two replays of one message must agree about whether it
         opened a run. */
      if (cue.step === 'encrypted') {
        const sender = senderOf(cue);
        turnKeys(sender, true, anchor, lastSealedBy !== sender);
        lastSealedBy = sender;
      }
      if (cue.step === 'opened') {
        const sender = senderOf(cue);
        turnKeys(recipientOf(cue), false, anchor, lastOpenedFrom !== sender);
        lastOpenedFrom = sender;
      }
    },

    clear() {
      root.dataset.sceneState = 'idle';
      setLanding(false);
      settleMorph();
      envelope.hidden = true;
      envelope.dataset.flying = 'false';
      envelope.dataset.crossing = 'false';
      envelope.style.removeProperty('transform');
      envelope.style.removeProperty('offset-path');
      envelope.style.removeProperty('offset-distance');
      crossingDest = null;
      setLinkTraffic(null);
      setBundleTraffic(null);
      setKeyTraffic(null);
      holdMailbox(null);
      /* Scales first: a run that has been thrown away has held nothing, and a
         high-water mark left standing would draw the next run's first count as
         a fraction of the old run's most. */
      for (const side of SIDES) {
        most.keys[side] = 0;
        most.shelf[side] = 0;
      }
      holdBundles({ a: 0, b: 0 });
      hideFlyers();
      spendKey(null);
      hideMessageKeys();
      setKeyholes(false);
      chunkStrip.hidden = true;
      chunkStrip.textContent = '';
      envelopeSize.hidden = true;
      envelopeSize.textContent = '';
      nameRatchet(null);
      /* A rewound reel replays every cue, and each replayed message must make
         the same click-or-not call it made the first time — state carried
         over would read the first replayed message against the last live
         one. */
      lastSealedBy = null;
      lastOpenedFrom = null;
      for (const side of ['a', 'b'] as const) {
        chat(side).replaceChildren();
        fillKeys(side, 0);
        /* Back to the state the markup ships in, width and all: a bar left at
           its last length would say the fresh device had already made the keys
           the run has yet to make. */
        keyBar(side).style.removeProperty('width');
        rewindRatchet(side);
        const state = deviceState(side);
        state.textContent = 'offline';
        state.dataset.online = 'false';
        /* The registration's three writes, undone together: the wire drops,
           the relay forgets the account, and the activation control comes
           back — the state the markup ships in. */
        link(side).dataset.connected = 'false';
        account(side).dataset.registered = 'false';
        delete phone(side).dataset.activated;
      }
    },

    settle(scope: readonly Side[] = SIDES) {
      setLinkTraffic(null, undefined, scope);
      setBundleTraffic(null, scope);
      setKeyTraffic(null, scope);
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

    say(side, text, mine, pending = false, arriving = false) {
      const item = document.createElement('li');
      item.className = 'demo-phone-bubble';
      item.dataset.mine = String(mine);
      item.dataset.pending = String(pending);
      /* Stamped here and cleared by the fold's landing when a morph runs;
         under reduced motion — where none does — the reveal stays the delayed
         write the stylesheet makes on the fold's own arithmetic, so the scene
         keeps owning no clock. */
      if (arriving) item.dataset.arriving = 'true';
      item.textContent = text;
      const list = chat(side);
      list.append(item);
      list.scrollTop = list.scrollHeight;
      /* The envelope's two morphs are armed from here rather than from `show`
         because their far end is this bubble's own box, and the console
         speaks each sentence right after the cue that places the tile — by
         this line the tile is already at its rest, and the bubble is the one
         measurement that was missing. */
      if (!prefersStill() && !envelope.hidden) {
        if (mine && root.dataset.sceneState === 'encrypted') sealFromBubble(item);
        else if (arriving) openIntoBubble(item);
      }
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
