/*
 * How `/demo` prints a scenario's result, for each kind of result there is.
 *
 * This is the other half of `catalog.ts`'s split, arrived at the same way. The
 * catalogue holds the words a reader sees before pressing anything, so it is
 * imported at build time; this holds the words a reader sees *after*, so it is
 * fetched when they press, beside the runner whose result it prints. Neither
 * half can run before the reader asks for it, and only the catalogue's half
 * ships before they do.
 *
 * It lived in the page's own `<script>` until a third scenario made the cost of
 * that visible: rendering is the bulk of what the page has to say, roughly four
 * kilobytes of it per scenario, and all of it was arriving on the initial path
 * of a page whose whole design is that nothing arrives until it is asked for.
 * `demo-smoke.mjs` has a tripwire on that path to catch the SDK turning up
 * uninvited, and the third scenario tripped it — not with the SDK, but with
 * prose about the SDK. Moving the prose behind the press is the fix that keeps
 * the tripwire measuring what it was set to measure.
 *
 * Every scenario's renderer follows the same rule, which is the page's central
 * one: each sentence is conditional on what the run produced, and a run that
 * produced no evidence for a claim prints what it does have instead. See each
 * function for the specific absences it is not allowed to assume.
 *
 * The imports here are types only, so this module carries no SDK. A value
 * import from a scenario would put the driver — and the 713 KB behind it — into
 * a chunk that three buttons share, which would undo the split above for two
 * scenarios a reader never pressed.
 */

import type { SecondDeviceResult } from './scenarios/add-a-second-device.ts';
import type { FlipAByteResult } from './scenarios/flip-a-byte.ts';
import type { ScenarioLogRecord } from './scenarios/log.ts';
import type { Attempt, ReinstallResult } from './scenarios/reinstall-a-device.ts';
import type { RunOutOfPreKeysResult } from './scenarios/run-out-of-prekeys.ts';

/** Rendering a scenario's own kind of result, once its module has arrived. */
export type Describe = (value: unknown) => string;

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const hex = (byte: number) => `0x${byte.toString(16).padStart(2, '0')}`;
const count = (value: number) => value.toLocaleString('en-US');

/* Every figure on this page comes out of a run, so the grammar around one has
   to follow the number rather than the number a sentence was written for. */
const deviceCount = (value: number) => `${count(value)} device${value === 1 ? '' : 's'}`;

/*
 * Everything printed here is read off the result, and every claim is
 * conditional on what the run actually produced. The two lines this page
 * exists to be able to write — no garbage plaintext, no silent drop — are
 * checks against the observed values, not sentences waiting to be shown. A
 * run where the plaintext came back wrong has to print that instead.
 */
export function renderFlipAByte(output: HTMLElement, result: FlipAByteResult, describePayload: Describe) {
  output.replaceChildren();

  /* The three rendered collections carry data attributes as well as classes.
     `demo-smoke.mjs` reads them, and a harness that found them by class name
     would break the next time this page is restyled — which is the one kind
     of change that must never turn a scenario's evidence red. */
  const happened = el('ol', undefined, 'scenario-steps');
  happened.dataset.scenarioSteps = '';
  const step = (text: string) => happened.append(el('li', text));

  step(
    `One byte changed on the way into the relay: byte ${count(result.flip.at)} of ` +
      `${count(result.flip.of)}, ${hex(result.flip.before)} to ${hex(result.flip.after)}.`,
  );
  if (result.accepted) {
    step(
      `The sender was told it worked: message ${result.accepted.messageId}, accepted for ` +
        `${result.accepted.recipientDeviceCount} device. Nothing on the sending side knows ` +
        `anything is wrong.`,
    );
  }
  if (result.refusal) {
    step(
      `The receiving device refused it — ${result.refusal.errorCode}: ` +
        `${result.refusal.errorMessage}`,
    );
  } else {
    step('The receiving device reported no error at all, which is not what should happen here.');
  }
  if (result.delivered === null) {
    step('Nothing was ever delivered, so this run has no recovery to show.');
  } else if (result.delivered === result.sentence) {
    step(
      `It asked the sender for the message again, and the resend arrived intact` +
        (result.roundTripMs === null
          ? '.'
          : `, ${result.roundTripMs.toFixed(1)} ms after send.`),
    );
  } else {
    step('Something other than the sent message was delivered. That is a defect, not a demo.');
  }

  output.append(el('h3', 'What happened'), happened);

  /* The point of the scenario, and the half that a log alone does not make.
     Both entries are assertions about this run's values. */
  const notHappened = el('ul', undefined, 'scenario-nots');
  notHappened.dataset.scenarioNots = '';

  /* Three outcomes, not two. "Nothing was delivered" used to be folded in
     with "the right thing was delivered", so a run that lost the recovery
     race printed "the only text that reached the application is
     byte-for-byte the sentence that was sent" about an application that
     received no text at all. That is the one direction this page must never
     round in: a claim of fail-closed, made on the strength of a run that
     produced no evidence for it. A run with nothing to show says so. */
  const garbage = el('li');
  if (result.delivered === result.sentence) {
    garbage.textContent =
      'No garbage plaintext. The corrupted copy produced no output at all — the only text ' +
      'that reached the application is byte-for-byte the sentence that was sent.';
  } else if (result.delivered === null) {
    garbage.textContent =
      'Nothing reached the application at all: the corrupted copy produced no output, and no ' +
      'resend arrived before this scenario stopped waiting. So this run cannot say that no ' +
      'garbage plaintext reached it — it can only say that nothing did.';
  } else {
    garbage.textContent =
      'Garbage plaintext reached the application. This is the failure this page exists to ' +
      'show cannot happen, and on this run it did.';
  }
  notHappened.append(
    garbage,
    el(
      'li',
      result.refusal
        ? 'No silent drop. The failure was named, the session was archived, and the sender was ' +
            'asked to send it again — all of it in the log below.'
        : 'No refusal was recorded, so this run cannot say the drop was not silent.',
    ),
  );
  output.append(el('h3', 'What did not happen'), notHappened);

  appendLog(output, result.records, result.debugRecords, 'both devices', describePayload);
}

/*
 * Everything printed here is read off the result, and every claim is
 * conditional on what the run produced. The scenario's own subject is an
 * absence — a message the new device does not have — so the page checks the
 * absence rather than announcing it: a run where the message turned up on
 * the new device has to say that instead, however little sense it would
 * make.
 */
export function renderSecondDevice(
  output: HTMLElement,
  result: SecondDeviceResult,
  describePayload: Describe,
) {
  output.replaceChildren();

  const happened = el('ol', undefined, 'scenario-steps');
  happened.dataset.scenarioSteps = '';
  const step = (text: string) => happened.append(el('li', text));

  step(
    `Before the link, the account had one device. “${result.before.text}” was accepted for ` +
      `${deviceCount(result.before.recipientDeviceCount)} — message ${result.before.messageId}.`,
  );
  step(`The primary device showed a link: ${result.linked.qrCodeUrl}`);
  step(
    `The second device scanned it, answered with an ephemeral key of its own, and decrypted ` +
      `the account identity the primary sent back. The relay linked it as device ` +
      `${count(result.linked.deviceId)}, described as ${result.linked.platform}.`,
  );
  step(
    `The sender then fetched device ${count(result.linked.deviceId)}'s prekey bundle and ` +
      `established a session with it — the two calls at the end of the program above.`,
  );
  if (result.after) {
    step(
      `“${result.after.text}” was accepted for ` +
        `${deviceCount(result.after.recipientDeviceCount)} — message ${result.after.messageId}.`,
    );
  } else {
    step(
      'The message sent after the link never reached every device before this scenario ' +
        'stopped waiting, so this run has nothing to compare.',
    );
  }
  output.append(el('h3', 'What happened'), happened);

  /*
   * The arithmetic, checked rather than asserted — and in three states, not
   * two. "The device holds no scroll-back at all" and "the device holds a
   * scroll-back without that message in it" are different runs, and only the
   * second is evidence of anything. Folding the first into the second is how
   * a page ends up printing a confident caption about a scroll-back it was
   * never given, so the absent case says that it is absent.
   */
  const newDevice = result.scrollback.find((device) => device.deviceId === result.linked.deviceId);
  const carriedOver = newDevice ? newDevice.messages.includes(result.before.text) : null;

  const notHappened = el('ul', undefined, 'scenario-nots');
  notHappened.dataset.scenarioNots = '';
  notHappened.append(
    el(
      'li',
      carriedOver === null
        ? 'This run produced no scroll-back for the device it linked, so it cannot say what ' +
            'that device can read. Nothing below is evidence about the message sent before ' +
            'the link.'
        : carriedOver
          ? 'The message sent before the link is on the new device. Nothing in the protocol ' +
              'can produce that, so either this scenario or the SDK is wrong — and this run ' +
              'is not evidence of either.'
          : 'No history followed the device. The message sent before the link is not on it, ' +
              'because this device’s keys did not exist when that message was encrypted and ' +
              'there was nothing to encrypt it to. That is arithmetic, not a decision.',
    ),
    el(
      'li',
      newDevice
        ? `No back-fill. The new device holds the ` +
            `${count(newDevice.messages.length)} message${newDevice.messages.length === 1 ? '' : 's'} ` +
            `sent while it existed, and the device that was already there kept everything it ` +
            `had. Nothing re-encrypted the older message to the newer key.`
        : 'The new device never joined the session, so this run cannot say anything about ' +
            'what it can read.',
    ),
  );
  output.append(el('h3', 'What did not happen'), notHappened);

  /* Both scroll-backs, side by side. This is the scenario's whole argument,
     and it is rendered from what each device's own client decrypted. */
  const devices = el('div', undefined, 'scenario-devices');
  devices.dataset.scenarioScrollback = '';
  for (const device of result.scrollback) {
    const pane = el('div', undefined, 'scenario-device');
    pane.dataset.scenarioDevice = String(device.deviceId);
    const messages = el('ol', undefined, 'scenario-device-messages');
    for (const message of device.messages) messages.append(el('li', message));
    pane.append(
      el('h4', `${device.label} (device ${count(device.deviceId)})`),
      device.messages.length === 0 ? el('p', 'Nothing at all.', 'muted') : messages,
    );
    devices.append(pane);
  }
  output.append(el('h3', 'What each device can read'), devices);

  appendLog(output, result.records, result.debugRecords, 'all three devices', describePayload);
}

/*
 * Everything printed here is read off the result, and the scenario's subject
 * is again an absence — this time an absence of any complaint. That makes the
 * rendering rule sharper than usual: the page may only say the SDK stayed
 * quiet on a run where the SDK actually stayed quiet. A run that produced a
 * warning has to print the warning, and a run whose handshake the SDK never
 * described has to say it cannot tell. Neither is a case anyone expects to
 * see; both are cases where announcing the expected story would be a lie.
 */
export function renderRunOutOfPreKeys(
  output: HTMLElement,
  result: RunOutOfPreKeysResult,
  describePayload: Describe,
) {
  output.replaceChildren();

  const happened = el('ol', undefined, 'scenario-steps');
  happened.dataset.scenarioSteps = '';
  const step = (text: string) => happened.append(el('li', text));

  step(
    `The receiving account published ${count(result.before.ec)} X25519 and ` +
      `${count(result.before.kem)} ML-KEM one-time prekeys, beside the signed and last-resort ` +
      `keys that are not consumed by use.`,
  );
  step(
    `One ordinary conversation spent one of each: the relay was left holding ` +
      `${count(result.afterFirstConversation.ec)} and ` +
      `${count(result.afterFirstConversation.kem)}.` +
      (result.healthy.usedKemPreKeyType
        ? ` The SDK recorded that handshake as “${result.healthy.usedKemPreKeyType}”.`
        : ''),
  );

  /* The bundle is the evidence that the stash is gone, so a bundle that still
     carried one-time keys has to be reported as such — the rest of this
     scenario would be describing a state the run never reached. */
  const emptied =
    result.bundle !== null &&
    result.bundle.ecOneTimePreKey === null &&
    result.bundle.kemOneTimePreKey === null;
  if (emptied && result.bundle) {
    step(
      `Then the stash ran out. The relay published a bundle for the same device with no ` +
        `one-time prekey of either type — id ` +
        `${count(result.bundle.kemLastResortPreKey ?? 0)}, public key ` +
        `${result.bundle.kemLastResortFingerprint}, the last-resort key, was what it had ` +
        `instead — and ${count(result.exhausted.ec)} and ${count(result.exhausted.kem)} left ` +
        `to give.`,
    );
  } else {
    step(
      'The relay was asked to stop serving one-time prekeys and went on serving them, so this ' +
        'run never reached the state it is about.',
    );
  }
  step(
    `${result.contact}, who had never written to this account before, established a session ` +
      `against that bundle.` +
      (result.delivered === result.sentence
        ? ` The first message of the new conversation — “${result.sentence}” — arrived.`
        : ' The message never arrived, so this run cannot say the conversation worked.'),
  );
  if (result.fallback.usedKemPreKeyType) {
    step(
      `The SDK's own account of that handshake: usedOneTimePreKey ` +
        `${String(result.fallback.usedOneTimePreKey)}, usedKemPreKeyType ` +
        `“${result.fallback.usedKemPreKeyType}”.`,
    );
  } else {
    step('The SDK reported no key agreement for that handshake, so this run cannot say which ' +
      'key it used.');
  }
  output.append(el('h3', 'What happened'), happened);

  const notHappened = el('ul', undefined, 'scenario-nots');
  notHappened.dataset.scenarioNots = '';

  /*
   * The finding, and the only form of it this page is allowed to print: the
   * list of warnings the run produced, checked, rather than the sentence
   * somebody expected to be able to write about it.
   *
   * It is printed beside what the SDK *did* log in the same window, because
   * "no warning" on its own is a weak thing to have checked — an SDK that said
   * nothing at all would satisfy it, and so would a broken filter. The numbers
   * beside it are what make it a finding: the SDK is not quiet during the
   * exhausted handshake, it is voluble in a channel an application is not
   * watching, and it never once raises its voice to a level one is.
   */
  const quiet = el('li');
  if (result.warnings.length === 0) {
    const atInfo =
      result.whileEmpty.records === 0
        ? 'nothing at info either'
        : `${count(result.whileEmpty.records)} at info and nothing above it`;
    quiet.textContent =
      `No warning. Across the whole exhausted handshake the SDK logged nothing at warn or ` +
      `error — ${atInfo}. What it logged instead was ` +
      `${count(result.whileEmpty.breadcrumbs)} breadcrumbs, of which ` +
      `${count(result.whileEmpty.namingFallback)} name the last-resort fallback outright. The ` +
      `SDK is not keeping this from you; it is saying it in a trace channel, never at a level ` +
      `that asks you to act. ` +
      `And it is not an error to run out — the session establishes, the message arrives, and ` +
      `the only thing that changed is that the first messages of this conversation rest on a ` +
      `key reused across every sender who arrives while the stash is empty.`;
  } else {
    quiet.textContent =
      `The SDK did warn: ${result.warnings.map((record) => record.message).join('; ')}. That ` +
      `is a better outcome than this scenario was built to show, and the page has been left ` +
      `behind by the SDK.`;
  }

  /*
   * `checkPreKeyStatus()` answers `-1` rather than a count when it declines,
   * so the two cases are told apart here. Printing -1 as though it were a
   * number of prekeys would be inventing a reading the SDK refused to give.
   *
   * Which branch a reader gets is decided by whether this tab has pressed the
   * button before. The throttle is a module-level map keyed by account and
   * device with a twelve-hour window, so it outlives the client that tripped
   * it: the second press builds a brand new client over brand new storage and
   * is refused anyway. Both branches are the same finding — the call tells the
   * application nothing about the server being empty — and the second is the
   * more emphatic one, so it is printed rather than engineered away.
   */
  const health = el('li');
  if (result.health === null) {
    health.textContent =
      'The health check returned nothing on this run, so it cannot be shown either way.';
  } else if (result.health.oneTimePreKeysRemaining < 0) {
    health.textContent =
      'No signal from the health check — and on this press, not even a number. Something in ' +
      'this tab has asked once already, and checkPreKeyStatus() answers at most once every ' +
      'twelve hours per account, so it returned -1 with needsReplenishment false: the shape of ' +
      'good news. The throttle is kept per account rather than per client, so the fresh client ' +
      'this press built, over storage it had never seen, was refused on the strength of a ' +
      'question the last press asked.';
  } else {
    health.textContent =
      `No signal from the health check. checkPreKeyStatus() reported ` +
      `${count(result.health.oneTimePreKeysRemaining)} remaining and needsReplenishment ` +
      `${String(result.health.needsReplenishment)}, while the relay held ` +
      `${count(result.exhausted.ec)}. It counts the prekeys this device still has in its own ` +
      `storage, and the server is the side that runs out.`;
  }
  notHappened.append(quiet, health);
  output.append(el('h3', 'What did not happen'), notHappened);

  /* The measurement, cited as the market research cites it and linked to the
     paper, because a page that tells a reader this happens in production
     owes them the means to check. */
  const context = el('p', undefined, 'scenario-context');
  context.dataset.scenarioContext = '';
  context.append(
    document.createTextNode(
      'This is the industry’s failure mode, not a property of this SDK. A 2025 measurement ' +
        'study of WhatsApp found 13% of companion devices lacked a one-time prekey at scan ' +
        'time — the same state as above, in production, at that scale. Nothing tells the ' +
        'application; whether it notices is a thing you build. ',
    ),
  );
  const citation = el('a', 'Gegenhuber et al., arXiv:2511.20252');
  citation.href = 'https://arxiv.org/abs/2511.20252';
  citation.target = '_blank';
  citation.rel = 'noopener';
  context.append(citation);
  output.append(context);

  appendLog(output, result.records, result.debugRecords, 'all three accounts', describePayload);
}

/** An error the run kept, quoted with the code it carried. */
const quoteFailure = (attempt: Attempt) =>
  attempt.ok
    ? ''
    : `${attempt.code ?? attempt.name}: ${attempt.message}` +
      (attempt.cause ? ` — ${attempt.cause}` : '');

/*
 * The reinstall, and the difference between what the protocol noticed and what
 * the application was told.
 *
 * The scenario this renders was planned around a "safety number changed" event.
 * There is no such event, so there is no branch here that prints one. What
 * there is instead is a rule this renderer follows more strictly than the
 * others: every claim about an absence is printed from the collection that is
 * empty, beside the collection that is not. "No hook fired" is printed from the
 * fired list, next to how many were registered and on which devices; "no safety
 * number" is printed from the error `verify()` actually threw. A run where the
 * SDK started reporting any of this would print the report rather than the
 * finding, and the page would have been overtaken by the SDK — which is the
 * outcome this shape is designed to make visible rather than to hide.
 */
export function renderReinstallADevice(
  output: HTMLElement,
  result: ReinstallResult,
  describePayload: Describe,
) {
  output.replaceChildren();

  const happened = el('ol', undefined, 'scenario-steps');
  happened.dataset.scenarioSteps = '';
  const step = (text: string) => happened.append(el('li', text));

  step(
    result.established.delivered === result.established.sentence
      ? `${result.sender} and ${result.recipient} were already talking: “${result.established.sentence}” ` +
        `was sent, encrypted to ${result.recipient}'s device, and arrived.`
      : `The opening message never arrived, so this run never had the working conversation the ` +
        `rest of it is supposed to interrupt.`,
  );

  if (result.before) {
    step(
      `At that point the two of them could have compared safety numbers: ` +
        `${result.before.numeric.split(' ').length} groups, ` +
        `${result.before.numeric.replace(/ /g, '').length} digits, half belonging to each side. ` +
        `The SDK put the trust at “${result.before.trustState ?? 'unreported'}” — generating a ` +
        `number never promotes it.`,
    );
  }

  step(
    `Then ${result.recipient}'s device was destroyed and built again on device-local storage ` +
      `that had never held anything: no identity, no session, no prekeys. That is a reinstall, ` +
      `a replaced handset, or a restore that did not carry the keys.`,
  );

  /* The refusal is quoted rather than described. It is the relay's sentence and
     the page has no business paraphrasing it. */
  if (!result.publish.ok) {
    step(
      `Building the client did not fail — it came up offline and said so at warn. Asking it to ` +
        `publish is what surfaced the reason, and the reason came from the relay: ` +
        `${quoteFailure(result.publish)}. A reinstalled device cannot quietly become the account.`,
    );
  } else {
    step(
      `The rebuilt device published itself over the account identity without being challenged, ` +
        `which is not what this run is meant to show and is worth more attention than the rest ` +
        `of this page.`,
    );
  }

  if (result.rotate.ok) {
    step(
      `It got back on the only way the SDK allows: rotateAccountIdentity, holding a commitment ` +
        `over the identity the relay was already serving. That identity is public — anyone who ` +
        `can read the relay can compute the commitment — so the check stops two devices ` +
        `rotating over each other. It does not establish which of them is holding the phone.`,
    );
  } else {
    step(`The rebuilt device could not rotate onto the account: ${quoteFailure(result.rotate)}.`);
  }

  step(
    result.stranded.resolved
      ? `And ${result.sender}, told nothing, wrote again. send() resolved.` +
        (result.stranded.delivered === null
          ? ` Nothing arrived.`
          : ` The message arrived anyway, so this run has no stranded message to show.`)
      : `${result.sender}'s send was rejected outright. That is a louder outcome than this ` +
        `scenario was built to show — the sending application would have found out at the ` +
        `call — and the page has been left behind by the SDK.`,
  );

  output.append(el('h3', 'What happened'), happened);

  const notHappened = el('ul', undefined, 'scenario-nots');
  notHappened.dataset.scenarioNots = '';

  /*
   * The finding. Printed from the empty list beside the full one, for the same
   * reason the prekey scenario prints its breadcrumb counts: "nothing fired" is
   * worth nothing on its own, because a run that registered nothing would
   * satisfy it just as well.
   */
  const noEvent = el('li');
  if (result.hooks.fired.length === 0) {
    noEvent.textContent =
      `No event. Every one of the ${count(result.hooks.registered.length)} hooks the SDK offers ` +
      `was registered on ${result.hooks.devices.join(' and ')} as soon as each of them ` +
      `existed, and between the reinstall and the end of that send not one of them fired. ` +
      `There is no onIdentityChanged to register: the SDK's hook surface has no entry for this ` +
      `event, and the hooks it does have stayed quiet through all of it.`;
  } else {
    noEvent.textContent =
      `The SDK did notify the application: ${result.hooks.fired.join(', ')}. That is a better ` +
      `outcome than this scenario was built to show, and the page has been left behind by the SDK.`;
  }

  /* The call an application would build a banner from, and what it does. */
  const noNumber = el('li');
  if (!result.asked.ok) {
    noNumber.textContent =
      `And no safety number to show. verify() — the call that produces the number a “safety ` +
      `number changed” banner would display — does not return a changed number here. It ` +
      `throws: ${quoteFailure(result.asked)}. The application cannot render the comparison ` +
      `until it has already decided to accept the change it was trying to ask the user about.`;
  } else {
    noNumber.textContent =
      `verify() returned a safety number rather than refusing, so on this run the application ` +
      `did have a changed number it could have shown.`;
  }

  /*
   * The counterweight, and the difference from the prekey scenario. There the
   * SDK never raised its voice; here it does, on the sending side, at error —
   * just nowhere an application is required to be looking, and only after the
   * receiving device's automatic retry forced the issue.
   */
  const notSilent = el('li');
  if (result.loud.length > 0) {
    notSilent.textContent =
      `It is not that the SDK said nothing. Across the reinstall it logged ` +
      `${count(result.loud.length)} records at warn or error` +
      (result.codes.length === 1 ? `, all of them carrying ${result.codes[0]}` : '') +
      (result.codes.length > 1
        ? `, carrying ${count(result.codes.length)} different error codes between them — ` +
          `${result.codes.join(', ')}. Each record carries one of those, so an application ` +
          `grepping its logs for any single one of them finds a fraction of this`
        : '') +
      `. All of it went to the logger. None of it reached a hook, a return value, or a ` +
      `rejected promise — the three places an application is built to look.`;
  } else {
    notSilent.textContent =
      `The SDK logged nothing at warn or error across the whole reinstall, so on this run even ` +
      `the log had nothing to offer.`;
  }

  notHappened.append(noEvent, noNumber, notSilent);
  output.append(el('h3', 'What did not happen'), notHappened);

  /* The recovery, which is the part the docs promise and the part that shows
     why the ceremony is the hard bit. */
  const recovered = el('ol', undefined, 'scenario-steps');
  recovered.dataset.scenarioRecovery = '';
  const recoveryStep = (text: string) => recovered.append(el('li', text));

  if (result.accepted.ok) {
    recoveryStep(
      `acceptIdentityRotation is the explicit decision, made out of band, that the SDK will ` +
        `never make on the application's behalf. It discards every session bound to the ` +
        `identity that is gone.`,
    );
    recoveryStep(
      result.recovered !== null
        ? `Delivery resumed straight after` +
          (result.strandedArrivedLater
            ? `, and “${result.stranded.sentence}” turned up too — it had been stuck, not lost.`
            : `, though the stranded message never did arrive.`)
        : `Delivery did not resume, so this run cannot show the recovery working.`,
    );
  } else {
    recoveryStep(`Accepting the identity change failed: ${quoteFailure(result.accepted)}.`);
  }

  /* The halves are the whole point of printing the number at all. */
  if (result.before && result.after) {
    const localHeld = result.before.localHalf === result.after.localHalf;
    const remoteMoved = result.before.remoteHalf !== result.after.remoteHalf;
    recoveryStep(
      localHeld && remoteMoved
        ? `And the safety number changed — in half of itself. ${result.sender}'s own six groups ` +
          `are identical before and after (${result.after.localHalf}); ${result.recipient}'s six ` +
          `went from ${result.before.remoteHalf} to ${result.after.remoteHalf}. That is the ` +
          `comparison a user is asked to make: ` +
          `${result.after.numeric.replace(/ /g, '').length} digits of which ` +
          `${result.after.remoteHalf.replace(/ /g, '').length} moved, read aloud, against a ` +
          `number they last saw weeks ago.`
        : `The safety number after the change does not split the way this page expects — ` +
          `${localHeld ? 'the far side’s half held still' : 'the near side’s half moved'} — so ` +
          `the comparison is printed rather than described: before ${result.before.numeric}, ` +
          `after ${result.after.numeric}.`,
    );
  }

  output.append(el('h3', 'What it took to recover'), recovered);

  /* Named as the market research names it, linked to the source, because a
     page that tells a reader this is the industry's problem owes them the
     means to check. */
  const context = el('p', undefined, 'scenario-context');
  context.dataset.scenarioContext = '';
  context.append(
    document.createTextNode(
      'This is trust on first use, and first contact is unverified. Keybase renames the model ' +
        'to fit what actually happens: not Trust On First Use but “TADA — Trust After Device ' +
        'Additions”, because every phone upgrade re-runs the decision. Week one you add a ' +
        '“safety number changed” banner and build a warning-fatigue machine — “Checking is ' +
        'infeasible, since it happens way too often. Checking sucks. Even a cursory poll of ' +
        'our security-conscious friends shows that no one bothers.” Whether an identity ' +
        'change reaches a human, and what you ask them to do about it, is a thing you build. ',
    ),
  );
  const citation = el('a', 'Keybase, “Chat apps are softer than TOFU”');
  citation.href = 'https://keybase.io/blog/chat-apps-softer-than-tofu';
  citation.target = '_blank';
  citation.rel = 'noopener';
  context.append(citation);
  output.append(context);

  appendLog(output, result.records, result.debugRecords, 'all three devices', describePayload);
}

/*
 * The SDK's own records, under the heading that promises them.
 *
 * Shared by every scenario, and so is the sentence about the debug records:
 * a page that counted them without printing them, and did not say so, would
 * be showing a reader a log it had quietly edited.
 */
function appendLog(
  output: HTMLElement,
  records: ScenarioLogRecord[],
  debugRecords: number,
  devices: string,
  describePayload: Describe,
) {
  const log = el('div', undefined, 'scenario-log');
  log.dataset.scenarioLog = '';
  for (const record of records) log.append(line(record, describePayload));
  output.append(
    el('h3', 'What the SDK said'),
    el(
      'p',
      `${count(records.length)} records at info and above, collected from ${devices}, in the ` +
        `order they were logged. The SDK emitted ${count(debugRecords)} more at debug, which ` +
        `are counted here and not printed.`,
      'muted',
    ),
    log,
  );
}

function line(record: ScenarioLogRecord, describePayload: Describe) {
  const row = el('p', undefined, `scenario-log-line scenario-log-${record.level}`);
  row.dataset.scenarioLogLine = record.level;
  row.append(
    el('span', record.role, 'scenario-log-role'),
    el('span', record.level, 'scenario-log-level'),
    el('span', record.message, 'scenario-log-message'),
  );
  const payload = record.payload.map(describePayload).join(' ');
  if (payload) row.append(el('span', payload, 'scenario-log-payload'));
  return row;
}
