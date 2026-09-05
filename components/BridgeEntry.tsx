import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './Button';
import {
  confirmDestination,
  entryStatus,
  proposeDestination,
  requestCode,
  startEntry,
  verifyCode,
  type EntryState,
} from '../lib/bridgeV2Client';

/**
 * The participant side of Bridge V2, as the 05/09/2026 decision describes it.
 *
 * Four steps, in order: prove the email, open the bot with the green button,
 * share the contact there, and watch this page reflect the state.
 *
 * R1 and R2 constrain what this may render. The button is an ordinary link to
 * t.me — not a Telegram Web App, not a Mini App, and nothing that embeds one.
 * The URL is built by the server from configuration, so the bot's name is not
 * written anywhere in this repository.
 *
 * D2 governs the wording after a code request. The server answers identically
 * whether the address is new, known, or refused, so this shows one message for
 * all of them; a message that distinguished them would undo the requirement.
 */

type Phase = 'email' | 'code' | 'entry';

interface Props {
  giveawayId: string;
}

const POLL_MS = 5000;

export const BridgeEntry: React.FC<Props> = ({ giveawayId }) => {
  const [phase, setPhase] = useState<Phase>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [state, setState] = useState<EntryState | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [destination, setDestination] = useState('');

  const refresh = useCallback(async () => {
    const result = await entryStatus(giveawayId);
    if (result.ok) {
      setState(result);
      setPhase('entry');
    }
  }, [giveawayId]);

  // A session may already exist from an earlier visit, in which case the email
  // steps are skipped entirely.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The bot confirms out of band, so the page has to ask rather than be told.
  // Polling stops once the entry reaches a state nothing will move it out of.
  useEffect(() => {
    const status = state?.status;
    if (status === undefined) return undefined;
    if (status === 'CONFIRMED' || status === 'FAILED' || status === 'NONE') return undefined;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [state?.status, refresh]);

  async function onRequestCode(): Promise<void> {
    setBusy(true);
    setNotice(null);
    const result = await requestCode(email);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    // One message for every outcome. See D2 above.
    setNotice('If that address can receive a code, one is on its way.');
    setPhase('code');
  }

  async function onVerify(): Promise<void> {
    setBusy(true);
    setNotice(null);
    const result = await verifyCode(email, code);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    setCode('');
    await refresh();
  }

  async function onStart(): Promise<void> {
    setBusy(true);
    setNotice(null);
    const result = await startEntry(giveawayId);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    if (result.url !== undefined) setLinkUrl(result.url);
    await refresh();
  }

  async function onPropose(): Promise<void> {
    setBusy(true);
    setNotice(null);
    const result = await proposeDestination(giveawayId, destination);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    await refresh();
  }

  async function onConfirm(address: string): Promise<void> {
    setBusy(true);
    setNotice(null);
    const result = await confirmDestination(giveawayId, address);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    await refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {notice !== null && <p className="text-sm text-gray-400">{notice}</p>}

      {phase === 'email' && (
        <div className="flex flex-col gap-3">
          <label className="text-sm text-gray-300" htmlFor="bridge-email">
            Email address
          </label>
          <input
            id="bridge-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-lg bg-gray-900 border border-gray-700 px-4 py-3 text-white"
          />
          <Button onClick={() => void onRequestCode()} isLoading={busy} disabled={email.length === 0}>
            Send code
          </Button>
        </div>
      )}

      {phase === 'code' && (
        <div className="flex flex-col gap-3">
          <label className="text-sm text-gray-300" htmlFor="bridge-code">
            Verification code
          </label>
          <input
            id="bridge-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="rounded-lg bg-gray-900 border border-gray-700 px-4 py-3 text-white tracking-widest"
          />
          <Button onClick={() => void onVerify()} isLoading={busy} disabled={code.length === 0}>
            Confirm email
          </Button>
        </div>
      )}

      {phase === 'entry' && state !== null && (
        <EntryPanel
          state={state}
          busy={busy}
          linkUrl={linkUrl}
          destination={destination}
          onDestinationChange={setDestination}
          onStart={() => void onStart()}
          onPropose={() => void onPropose()}
          onConfirm={(address) => void onConfirm(address)}
        />
      )}
    </div>
  );
};

interface PanelProps {
  state: EntryState;
  busy: boolean;
  linkUrl: string | null;
  destination: string;
  onDestinationChange: (value: string) => void;
  onStart: () => void;
  onPropose: () => void;
  onConfirm: (address: string) => void;
}

/**
 * The state the page reflects, which is step 4 of the decision.
 *
 * Every status the entry machine can hold has a line here, so a participant is
 * never looking at a page that has nothing to say about where they are.
 */
const EntryPanel: React.FC<PanelProps> = ({
  state,
  busy,
  linkUrl,
  destination,
  onDestinationChange,
  onStart,
  onPropose,
  onConfirm,
}) => {
  if (state.status === 'NONE' || state.status === 'AWAITING_CONTACT') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-300">
          One more step: confirm your phone number so this entry counts once.
        </p>
        {linkUrl === null ? (
          <Button variant="success" onClick={onStart} isLoading={busy}>
            Confirm participation
          </Button>
        ) : (
          <a href={linkUrl} target="_blank" rel="noreferrer noopener">
            <Button variant="success" className="w-full">
              Open Telegram to confirm
            </Button>
          </a>
        )}
      </div>
    );
  }

  if (state.status === 'FAILED') {
    return <p className="text-sm text-red-400">This entry could not be completed.</p>;
  }

  if (state.status === 'CONFIRMED') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-green-400">You are in.</p>
        {state.txHash != null && (
          <p className="text-xs text-gray-500 break-all">Transaction: {state.txHash}</p>
        )}
        {state.custody != null && state.custody.requiresOwnWallet && (
          <DestinationForm
            custody={state.custody}
            busy={busy}
            destination={destination}
            onDestinationChange={onDestinationChange}
            onPropose={onPropose}
            onConfirm={onConfirm}
          />
        )}
      </div>
    );
  }

  // VERIFIED, ELIGIBLE, FUNDING and SUBMITTED are all "in progress" to the
  // participant. The difference between them is operational, not something they
  // can act on, and D5 keeps internal capacity out of what is shown.
  return <p className="text-sm text-gray-300">Confirmed. Completing your entry.</p>;
};

interface DestinationProps {
  custody: NonNullable<EntryState['custody']>;
  busy: boolean;
  destination: string;
  onDestinationChange: (value: string) => void;
  onPropose: () => void;
  onConfirm: (address: string) => void;
}

/**
 * E2 and E4. A prize at or above the threshold, and any non-fungible prize, must
 * go to a wallet the winner controls.
 *
 * Two steps, because E4 requires the address to be shown back before anything
 * moves: the first records it, the second confirms exactly what was shown.
 */
const DestinationForm: React.FC<DestinationProps> = ({
  custody,
  busy,
  destination,
  onDestinationChange,
  onPropose,
  onConfirm,
}) => {
  const proposed = custody.destinationAddress;

  if (custody.destinationConfirmed && proposed !== null) {
    return (
      <p className="text-sm text-gray-300 break-all">Destination confirmed: {proposed}</p>
    );
  }

  if (proposed !== null) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-300 break-all">
          Confirm this is your wallet: {proposed}
        </p>
        <Button variant="success" isLoading={busy} onClick={() => onConfirm(proposed)}>
          Yes, this is my wallet
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm text-gray-300" htmlFor="bridge-destination">
        Your wallet address
      </label>
      <input
        id="bridge-destination"
        value={destination}
        onChange={(event) => onDestinationChange(event.target.value)}
        className="rounded-lg bg-gray-900 border border-gray-700 px-4 py-3 text-white"
      />
      <Button onClick={onPropose} isLoading={busy} disabled={destination.length === 0}>
        Use this address
      </Button>
    </div>
  );
};
