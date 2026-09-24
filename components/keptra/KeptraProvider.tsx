import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { accountStatus, registerPasskey, type AccountStatus, type Assertion } from '../../lib/keptra/api';
import { runAction, type ActionSummary, type RelayAction, type RelayOutcome } from '../../lib/keptra/relay';
import { createPasskey, passkeyOrigin, signHash } from '../../lib/keptra/webauthn';
import { summaryWords } from '../../lib/keptra/format';
import { trapTarget } from '../../lib/keptra/focus';
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
  /** V3: the bridge did not answer the session's read (anything but "not signed in"); the page shows it with "Try again". */
  readonly statusError: string | null;
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
  const [statusError, setStatusError] = useState<string | null>(null);
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
      setStatusError(null);
    } else if (result.status === 401) {
      statusRef.current = null;
      setStatus(null);
      setSignedIn(false);
      setStatusError(null);
    } else {
      // V3: no answer about the session — what was read stays, and the page says this read failed.
      setStatusError(result.error);
    }
  }, []);

  // P6-9 (B14): no read on mount — the provider wraps every page of the site, and
  // only the pages behind RequireAccount show the account. They ask (below); a
  // signature asks when it needs the passkeys and nobody has read them yet.

  const signChallenge = useCallback(
    async (hash: `0x${string}`) => {
      if (statusRef.current === null) await refresh();
      return signHash(navigator.credentials, hash, statusRef.current?.passkeys ?? []);
    },
    [refresh],
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
      // P6-9: what the action changed is re-read only where the account was read.
      if (statusRef.current !== null) void refresh();
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
    () => ({ signedIn, status, statusError, refresh, passkeyReady, relay, signChallenge, createAccountPasskey }),
    [signedIn, status, statusError, refresh, passkeyReady, relay, signChallenge, createAccountPasskey],
  );

  return (
    <KeptraContext.Provider value={value}>
      {children}
      {pending && <SignSheet summary={pending.summary} onAnswer={answer} />}
    </KeptraContext.Provider>
  );
}

/** What Tab can reach inside the sheet, in order. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * C12 and T2: before the passkey, the transaction in plain words — the action,
 * what moves, where it goes — as the bridge computed it. A dialog: focus on the
 * decision, Escape or the backdrop cancel, nothing is sent without the yes.
 *
 * V5 (B1): while it is open Tab and Shift+Tab stay inside it (focus.ts), and when
 * it closes the focus goes back to the button that opened it — which kept the
 * focus while the bridge prepared, since a busy Button is not disabled (ui.tsx).
 */
function SignSheet({ summary, onAnswer }: { summary: ActionSummary; onAnswer: (yes: boolean) => void }) {
  const words = summaryWords(summary);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The provider hands a new onAnswer on every render; the sheet opens and closes once.
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') answerRef.current(false);
      if (event.key !== 'Tab' || dialogRef.current === null) return;
      const controls = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const target = trapTarget(controls, document.activeElement instanceof HTMLElement ? document.activeElement : null, event.shiftKey);
      if (target !== null) {
        event.preventDefault();
        target.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  /*
   * Motion (the moment of signature): the sheet rises from the bottom edge on a
   * phone (the drawer curve) and settles in the centre on a computer; the
   * backdrop fades with it. Reduced motion keeps only the fade (index.css).
   */
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overscroll-contain sm:items-center sm:p-6" role="presentation">
      <button type="button" tabIndex={-1} aria-label="Cancel" className="iw-sheet-backdrop absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={() => onAnswer(false)} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-title"
        className="iw-sheet iw-surface-raised relative w-full max-w-lg !rounded-b-none p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:!rounded-panel sm:pb-6"
      >
        <div aria-hidden="true" className="mx-auto -mt-2 mb-4 h-1 w-10 rounded-full bg-dark-line sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-control border border-dark-line bg-black/40">
              <ShieldCheck className="h-5 w-5 text-white" />
            </span>
            <h2 id="sign-title" className="font-display text-2xl font-bold tracking-tight text-white">
              {words.action}
            </h2>
          </div>
          <button type="button" onClick={() => onAnswer(false)} className="iw-btn min-h-[44px] min-w-[44px] text-gray-400 hover:text-white" aria-label="Cancel">
            <X className="mx-auto h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-3 text-sm text-gray-400">Check what this transaction does. Your passkey signs it only after you continue.</p>
        <dl className="mt-5 overflow-hidden rounded-card border border-dark-border bg-black/30 text-sm">
          <div className="grid grid-cols-[7rem_1fr] gap-3 px-4 py-3">
            <dt className="text-gray-400">Action</dt>
            <dd className="text-white">{words.action}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 border-t border-dark-border px-4 py-3">
            <dt className="text-gray-400">Amount</dt>
            <dd className="font-mono text-base font-semibold text-white tabular-nums">{words.amounts.length === 0 ? 'Nothing moves' : words.amounts.join(' and ')}</dd>
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-3 border-t border-dark-border px-4 py-3">
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
