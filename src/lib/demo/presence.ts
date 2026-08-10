/*
 * Which tabs are here. Nothing else.
 *
 * `./broadcast-relay` already carries a channel between the tabs, and this
 * deliberately does not use it. That channel is an implementation of the SDK's
 * relay interface, and every message on it is a call a relay really serves —
 * which is the whole reason the two-tab section is worth believing. "A tab
 * opened" is not a call a relay serves, so smuggling it down that wire would
 * make the demo's most load-bearing claim slightly false in order to save a
 * file.
 *
 * So presence gets a channel of its own, and it carries one fact: a tab with
 * this name has a live session, or has closed one. The stage never draws a peer
 * from anything else — not from the pairing press, not from a timer, not from
 * losing the relay election. A tab announces itself only after its own client
 * is up, so a label that says the other tab is here means a device that can
 * actually receive.
 *
 * A tab that is killed rather than closed sends no farewell, and the label it
 * left behind stays until the reader reloads. That is the honest failure
 * direction for a demo: it can be one tab late to notice a departure, and it
 * cannot invent an arrival.
 */

/** The other tab, as it described itself. */
export interface PresencePeer {
  readonly me: string;
  readonly role: 'host' | 'guest';
}

export interface PresenceOptions {
  /** Scopes the channel the way `broadcastRelay` scopes its own. */
  name?: string;
  me: string;
  role: 'host' | 'guest';
  onJoin(peer: PresencePeer): void;
  onLeave(peer: PresencePeer): void;
}

export interface Presence {
  /** Say this tab is here. Safe to call more than once. */
  announce(): void;
  /** Say this tab is going, and stop listening. */
  close(): void;
}

const CHANNEL_PREFIX = 'oe-demo-presence:';

interface Note {
  kind: 'here' | 'gone';
  me: string;
  role: 'host' | 'guest';
  /* Set on an answer, so two tabs greeting each other stop after one round
     instead of answering each other forever. */
  reply: boolean;
}

const asNote = (value: unknown): Note | null => {
  if (typeof value !== 'object' || value === null) return null;
  const note = value as Partial<Note>;
  if (note.kind !== 'here' && note.kind !== 'gone') return null;
  if (typeof note.me !== 'string' || note.me.length === 0) return null;
  if (note.role !== 'host' && note.role !== 'guest') return null;
  return { kind: note.kind, me: note.me, role: note.role, reply: note.reply === true };
};

export function openPresence({
  name = 'demo',
  me,
  role,
  onJoin,
  onLeave,
}: PresenceOptions): Presence {
  const channel = new BroadcastChannel(CHANNEL_PREFIX + name);
  const here = new Map<string, PresencePeer>();

  channel.addEventListener('message', (event: MessageEvent) => {
    const note = asNote(event.data);
    if (!note || note.me === me) return;

    if (note.kind === 'here') {
      if (!here.has(note.me)) {
        here.set(note.me, { me: note.me, role: note.role });
        onJoin({ me: note.me, role: note.role });
      }
      /* A tab that arrives second has to learn about the one already there,
         and only the one already there can tell it. */
      if (!note.reply) {
        channel.postMessage({ kind: 'here', me, role, reply: true } satisfies Note);
      }
      return;
    }

    const going = here.get(note.me);
    if (going) {
      here.delete(note.me);
      onLeave(going);
    }
  });

  return {
    announce() {
      channel.postMessage({ kind: 'here', me, role, reply: false } satisfies Note);
    },
    close() {
      channel.postMessage({ kind: 'gone', me, role, reply: false } satisfies Note);
      channel.close();
    },
  };
}
