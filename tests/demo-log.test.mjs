/*
 * `log-view.ts` is DOM-free, so it is tested here rather than through a
 * mounted `DemoLog.astro`. What it is trusted to get right is the same thing
 * `demo-run.test.mjs` checks of `run.ts`: the shape really is the shape
 * `run.ts` appends, not a shape this file made up and forgot to keep in sync.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { CODE_SNIPPETS } from '../src/lib/demo/code-snippets.ts';
import { formatEvent, matches, summarize } from '../src/lib/demo/log-view.ts';
import { STEPS } from '../src/lib/demo/trace.ts';

/** An `encrypted` event, shaped the way `run.ts`'s `exchange()` really appends one. */
function encryptedEvent(overrides = {}) {
  return {
    step: 'encrypted',
    actor: 'a',
    from: 'a',
    to: 'b',
    atMs: 1250.75,
    measures: { encryptMs: 12.3 },
    detail: { text: 'Dinner at 7. I got us the table by the window.' },
    ...overrides,
  };
}

test('formatEvent reports elapsed time since the run started, to one decimal', () => {
  const row = formatEvent(encryptedEvent({ atMs: 1500 }), 1000);
  assert.equal(row.at, '500.0');
});

test('formatEvent keeps a real, possibly negative, delta rather than clamping one', () => {
  /* `stored-at-relay` can be timestamped before `encrypted` on an in-memory
     relay — trace.ts says why — so a row before the run's first event is a
     true row, not a bug this file should hide by flooring at zero. */
  const row = formatEvent(encryptedEvent({ atMs: 900 }), 1000);
  assert.equal(row.at, '-100.0');
});

test('matches: an empty or whitespace query matches every row', () => {
  const row = formatEvent(encryptedEvent(), 0);
  assert.equal(matches(row, ''), true);
  assert.equal(matches(row, '   '), true);
});

test('matches: case-insensitive substring over step, actor and summary', () => {
  /* A row built by hand, with a distinct token in each field, so a match
     against one field cannot be mistaken for a match against another. */
  const row = { at: '0.0', step: 'devices-ready', actor: 'relay', summary: 'a fresh prekey bundle' };

  assert.equal(matches(row, 'DEVICES'), true, 'did not match the step, differently cased');
  assert.equal(matches(row, 'RELAY'), true, 'did not match the actor, differently cased');
  assert.equal(matches(row, 'PREKEY'), true, 'did not match the summary, differently cased');
});

test('matches: a query that matches nothing returns false', () => {
  const row = formatEvent(encryptedEvent(), 0);
  assert.equal(matches(row, 'nonexistent-xyz'), false);
});

test('summarize reads the real detail and measures shapes run.ts records', () => {
  const summary = summarize(encryptedEvent());
  assert.match(summary, /Dinner at 7/);
  assert.match(summary, /12\.3/);
});

test('summarize does not throw when a nullable detail is absent', () => {
  /* `session-established`'s `selection` is nullable in the trace itself — the
     callback it is read from may simply not fire — and a summary that assumed
     otherwise would throw on exactly the run worth seeing. */
  assert.doesNotThrow(() =>
    summarize({
      step: 'session-established',
      actor: 'a',
      from: 'a',
      to: 'b',
      atMs: 0,
      measures: { establishMs: 4 },
      detail: { selection: null },
    }),
  );
});

/*
 * The handshake and the ongoing ratchet are two separate choices, and the
 * selection event reports them separately. The summary used to name only the
 * handshake, which left "PQXDH" standing in for a ratchet it says nothing
 * about — and the ratchet is the half a reader is looking for after being told
 * the protocol is quantum-safe.
 */
test('the key-agreement line names the ratchet as well as the handshake', () => {
  const established = (selection) => ({
    step: 'session-established',
    actor: 'a',
    from: 'a',
    to: 'b',
    atMs: 0,
    measures: { establishMs: 4 },
    detail: { selection },
  });

  const triple = summarize(
    established({ usedPQXDH: true, usedClassicalFallback: false, usedTripleRatchet: true }),
  );
  assert.match(triple, /PQXDH/);
  assert.match(triple, /triple ratchet/);

  /* The other answer is printed as readily. A line that could only ever say
     "triple" would be a claim wearing a reading's clothes. */
  const double = summarize(
    established({ usedPQXDH: true, usedClassicalFallback: false, usedTripleRatchet: false }),
  );
  assert.match(double, /double ratchet/);

  /* Said nothing is not the same as said no: an event with no opinion about the
     ratchet leaves the line quiet rather than captioning it "double". */
  const quiet = summarize(established({ usedPQXDH: true, usedClassicalFallback: false }));
  assert.doesNotMatch(quiet, /ratchet/);
});

test('code-snippets.ts has an entry for every step the trace can record', () => {
  for (const step of STEPS) {
    assert.ok(step in CODE_SNIPPETS, `no code snippet entry for step ${step}`);
  }
});

test('a step nothing in the app calls is marked as a note, not a fabricated call', () => {
  for (const step of ['idle', 'in-transit', 'stored-at-relay', 'delivered']) {
    assert.equal(
      CODE_SNIPPETS[step].kind,
      'note',
      `${step} is not caused by an app call and should not claim to be one`,
    );
  }
});

test('every step caused by an app call has a snippet naming a real SDK identifier', () => {
  /* Loose on purpose: this is not re-parsing TypeScript, just refusing a
     snippet that forgot to mention any call at all. */
  for (const step of ['generating-keys', 'devices-ready', 'bundles-published',
    'session-established', 'encrypted', 'opened']) {
    const snippet = CODE_SNIPPETS[step];
    assert.equal(snippet.kind, 'call', `${step} should show the call that causes it`);
    assert.match(snippet.code, /client/i, `${step}'s snippet does not mention the client at all`);
  }
});
