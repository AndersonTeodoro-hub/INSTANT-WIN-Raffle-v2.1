import React, { useEffect, useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { requestCode, verifyCode, type AccountStatus, type Role } from '../../lib/keptra/api';
import { useKeptra } from './KeptraProvider';
import { Button, Card, Field, Loading, Notice, ReadError, inputClass } from './ui';

/*
 * 6.2.1: sign in with email and a code, as today; then create the passkey at the
 * first action that needs one. A screen that needs the account wraps its content
 * in <RequireAccount>, which walks the person through both, in that order, and
 * hands the content the account status once they are done.
 */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

export function SignInPanel({ intro }: { intro?: string }) {
  const { refresh } = useKeptra();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError('Enter a valid email address.');
    setBusy(true);
    const result = await requestCode(email.trim());
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setStep('code');
  };

  const verify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('The code is the six digits in the email.');
    setBusy(true);
    const result = await verifyCode(email.trim(), code.trim());
    setBusy(false);
    if (!result.ok) return setError('That code is not valid. Check the email, or ask for a new one.');
    await refresh();
  };

  return (
    <Card className="max-w-xl">
      <div className="flex items-center gap-3">
        <Mail className="h-5 w-5 text-gray-300" aria-hidden="true" />
        <h2 className="font-display text-2xl font-bold tracking-tight">Sign in</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">{intro ?? 'Sign in with your email. We send a six-digit code; no password.'}</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void (step === 'email' ? send() : verify());
        }}
      >
        {step === 'email' ? (
          <Field id="signin-email" label="Email" error={error}>
            <input id="signin-email" type="email" autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
        ) : (
          <Field id="signin-code" label={`Code sent to ${email.trim()}`} error={error}>
            <input
              id="signin-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              className={`${inputClass} font-mono tracking-[0.3em]`}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
            />
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" busy={busy}>
            {step === 'email' ? 'Send code' : 'Sign in'}
          </Button>
          {step === 'code' && (
            <Button tone="quiet" onClick={() => void send()}>
              Send a new code
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

export function PasskeyPanel() {
  const { createAccountPasskey, passkeyReady } = useKeptra();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="max-w-xl">
      <div className="flex items-center gap-3">
        <KeyRound className="h-5 w-5 text-gray-300" aria-hidden="true" />
        <h2 className="font-display text-2xl font-bold tracking-tight">Create your passkey</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">
        Your Keptra account is controlled by a passkey on this device — Face ID, a fingerprint or your screen lock. Every payment, claim or confirmation is signed with
        it. Keptra never holds it and cannot move your money.
      </p>
      {!passkeyReady && (
        <div className="mt-4">
          <Notice tone="warning">Passkeys work only on keptra.io. Open this page on keptra.io to create yours.</Notice>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <Button
        className="mt-5"
        busy={busy}
        disabled={!passkeyReady}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const result = await createAccountPasskey();
          setBusy(false);
          if (!result.ok) setError(result.error);
        }}
      >
        Create passkey
      </Button>
    </Card>
  );
}

/** C4: an account is shown as a destination only once it exists on-chain, configured; until then, one signature sets it up. */
export function AccountSetup({ role, status }: { role: Role; status: AccountStatus }) {
  const { relay } = useKeptra();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = status.accounts.find((item) => item.role === role);
  if (account === undefined || account.configured) return null;
  return (
    <Notice tone="warning" title={role === 'CREATOR' ? 'Set up your business account' : 'Set up your account'}>
      <p>
        One signature creates your {role === 'CREATOR' ? 'business ' : ''}account on Arbitrum One with its recovery protection switched on. Keptra pays the network fee.
      </p>
      {error && <p className="mt-2 text-red-200">{error}</p>}
      <Button
        className="mt-3"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const outcome = await relay(role === 'CREATOR' ? { kind: 'configure', role: 'CREATOR' } : { kind: 'configure' });
          setBusy(false);
          if (outcome.status === 'refused') setError(outcome.error);
        }}
      >
        Set up with passkey
      </Button>
    </Notice>
  );
}

/**
 * The content, once the person is signed in and has a passkey. V3: a session read
 * that failed is not "signed out" — it is an error with "Try again"; after a good
 * read, a later failure keeps the content and says so above it.
 */
export function RequireAccount({ intro, children }: { intro?: string; children: (status: AccountStatus) => React.ReactNode }) {
  const { signedIn, status, statusError, refresh } = useKeptra();
  // P6-9: the account is read by the pages that show it, not by every page of the site.
  useEffect(() => {
    if (signedIn === null) void refresh();
  }, [signedIn, refresh]);
  const failed = statusError === null ? null : <ReadError what="Your account" error={statusError} onRetry={() => void refresh()} />;
  if (status === null && failed !== null) return failed;
  if (signedIn === null) return <Loading label="Checking your session…" />;
  if (!signedIn || status === null) return <SignInPanel intro={intro} />;
  if (status.passkeys.length === 0) return <PasskeyPanel />;
  return (
    <>
      {failed && <div className="mb-6">{failed}</div>}
      {children(status)}
    </>
  );
}
