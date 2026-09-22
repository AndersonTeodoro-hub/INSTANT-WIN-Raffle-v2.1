import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { accountStatus, registerPasskey, type AccountStatus, type Assertion } from '../../lib/keptra/api';
import { runAction, type ActionSummary, type RelayAction, type RelayOutcome } from '../../lib/keptra/relay';
import { createPasskey, passkeyOrigin, signHash } from '../../lib/keptra/webauthn';
import { summaryWords } from '../../lib/keptra/format';
import { AddressLink, Button } from './ui';

/*
 * The account, the passkey and the relay, for every Keptra screen.
 *
 * relay(action) is the one way a screen moves value (6.2.2): the bridge prepares
 * the transaction and its summary, the sheet below shows the summary (C12, T2),
 * and only after "Sign with passkey" does the device ask for the passkey.
 */

interface KeptraContextValue {
  /** null while the first read is in flight. */
  readonly signedIn: boolean | null;
  readonly status: AccountStatus | null;
  readonly refresh: () => Promise<void>;
  /** A1: this page may ask for a Keptra passkey (on keptra.io, WebAuthn available). */
  readonly passkeyReady: boolean;
  readonly relay: (action: RelayAction) => Promise<RelayOutcome>;
  /** The passkey's signature over a challenge the bridge issued (the migration's, 6.6.2). */
  readonly signChallenge: (hash: `0x${string}`) => Promise<Assertion>;
  /** 6.2.1: create this device's passkey and register it under the session. */
  readonly createAccountPasskey: () => Promise<{ ok: true } | { ok: false; error: string }>;
}

const KeptraContext = createContext<KeptraContextValue | null>(null);

export function useKeptra(): KeptraContextValue {
  const value = useContext(KeptraContext);
  if (value === null) throw new Error('useKeptra outside KeptraProvider');
  return value;
}

interface PendingConfirm {
  readonly summary: ActionSummary;
  readonly resolve: (yes: boolean) => void;
}

export function KeptraProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const statusRef = useRef<AccountStatus | null>(null);

  const passkeyReady = useMemo(
    () => typeof window !== 'undefined' && passkeyOrigin(window.location.origin, typeof window.PublicKeyCredential !== 'undefined'),
    [],
  );

  const refresh = useCallback(async () => {
    const result = await accountStatus();
    if (result.ok) {
      statusRef.current = result;
      setStatus(result);
      setSignedIn(true);
    } else {
      // Not signed in (401), or the bridge did not answer: either way the page offers the sign-in, whose own call says what is wrong.
      statusRef.current = null;
      setStatus(null);
      setSignedIn(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signChallenge = useCallback(
    (hash: `0x${string}`) => signHash(navigator.credentials, hash, statusRef.current?.passkeys ?? []),
    [],
  );

  const relay = useCallback(
    async (action: RelayAction): Promise<RelayOutcome> => {
      if (!passkeyReady) {
        return { status: 'refused', error: 'Passkeys work only on keptra.io. Open this page on keptra.io to sign.', code: 0 };
      }
      const outcome = await runAction(action, {
        confirm: (summary) => new Promise<boolean>((resolve) => setPending({ summary, resolve })),
        sign: signChallenge,
      });
      void refresh();
      return outcome;
    },
    [passkeyReady, refresh, signChallenge],
  );

  const createAccountPasskey = useCallback(async () => {
    if (!passkeyReady) return { ok: false as const, error: 'Passkeys work only on keptra.io. Open this page on keptra.io to continue.' };
    try {
      const key = await createPasskey(navigator.credentials, statusRef.current?.email ?? 'Keptra account');
      const registered = await registerPasskey(key);
      if (!registered.ok) return { ok: false as const, error: registered.error };
      await refresh();
      return { ok: true as const };
    } catch (error) {
      const cancelled = error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
      return { ok: false as const, error: cancelled ? 'The passkey was not created. You can try again.' : 'This device could not create a passkey.' };
    }
  }, [passkeyReady, refresh]);

  const answer = (yes: boolean) => {
    pending?.resolve(yes);
    setPending(null);
  };

  const value = useMemo(
    () => ({ signedIn, status, refresh, passkeyReady, relay, signChallenge, createAccountPasskey }),
    [signedIn, status, refresh, passkeyReady, relay, signChallenge, createAccountPasskey],
  );

  return (
    <KeptraContext.Provider value={value}>
      {children}
      {pending && <SignSheet summary={pending.summary} onAnswer={answer} />}
    </KeptraContext.Provider>
  );
}

/**
 * C12 and T2: before the passkey, the transaction in plain words — the action,
 * what moves, where it goes — as the bridge computed it. A dialog: focus on the
 * decision, Escape or the backdrop cancel, nothing is sent without the yes.
 */
function SignSheet({ summary, onAnswer }: { summary: ActionSummary; onAnswer: (yes: boolean) => void }) {
  const words = summaryWords(summary);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onAnswer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAnswer]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <button type="button" aria-label="Cancel" className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in-up" onClick={() => onAnswer(false)} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-title"
        className="relative w-full max-w-lg rounded-t-2xl border border-dark-border bg-dark-card p-6 shadow-2xl animate-fade-in-up sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 text-brand" aria-hidden="true" />
            <h2 id="sign-title" className="font-display text-2xl font-bold tracking-tight text-white">
              {words.action}
            </h2>
          </div>
          <button type="button" onClick={() => onAnswer(false)} className="min-h-[44px] min-w-[44px] text-gray-400 hover:text-white" aria-label="Cancel">
            <X className="mx-auto h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-400">Check what this transaction does. Your passkey signs it only after you continue.</p>
        <dl className="mt-5 divide-y divide-dark-border border-y border-dark-border text-sm">
          <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
            <dt className="text-gray-400">Action</dt>
            <dd className="text-white">{words.action}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
            <dt className="text-gray-400">Amount</dt>
            <dd className="font-mono text-white tabular-nums">{words.amounts.length === 0 ? 'Nothing moves' : words.amounts.join(' and ')}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 py-3">
            <dt className="text-gray-400">Destination</dt>
            <dd className="min-w-0 text-white">
              {words.destination === null ? (
                'None'
              ) : (
                <>
                  <span className="block">{words.destination.words}</span>
                  <AddressLink address={words.destination.address} label={words.destination.named ?? undefined} />
                </>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button tone="secondary" onClick={() => onAnswer(false)}>
            Cancel
          </Button>
          <Button ref={confirmRef} onClick={() => onAnswer(true)}>
            Sign with passkey
          </Button>
        </div>
      </div>
    </div>
  );
}
