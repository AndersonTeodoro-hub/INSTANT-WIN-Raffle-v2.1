import React, { useEffect, useState } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { requestCode, verifyCode, type AccountStatus, type Role } from '../../lib/keptra/api';
import { useKeptra } from './KeptraProvider';
import { Button, Card, Field, Loading, Notice, ReadError, inputClass } from './ui';
import { fill, useKeptraCopy } from '../../pages/keptra.i18n';

/*
 * 6.2.1: sign in with email and a code, as today; then create the passkey at the
 * first action that needs one. A screen that needs the account wraps its content
 * in <RequireAccount>, which walks the person through both, in that order, and
 * hands the content the account status once they are done.
 */

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

export function SignInPanel({ intro }: { intro?: string }) {
  const { refresh } = useKeptra();
  const { t, say } = useKeptraCopy();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) return setError(t.signIn.invalidEmail);
    setBusy(true);
    const result = await requestCode(email.trim());
    setBusy(false);
    if (!result.ok) return setError(say(result.error));
    setStep('code');
  };

  const verify = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError(t.signIn.codeFormat);
    setBusy(true);
    const result = await verifyCode(email.trim(), code.trim());
    setBusy(false);
    if (!result.ok) return setError(t.signIn.codeInvalid);
    await refresh();
  };

  return (
    <Card className="max-w-xl">
      <div className="flex items-center gap-3">
        <Mail className="h-5 w-5 text-gray-300" aria-hidden="true" />
        <h2 className="font-display text-2xl font-bold tracking-tight">{t.signIn.signIn}</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">{intro ?? t.signIn.intro}</p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void (step === 'email' ? send() : verify());
        }}
      >
        {step === 'email' ? (
          <Field id="signin-email" label={t.signIn.email} error={error}>
            <input id="signin-email" type="email" autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.signIn.emailPlaceholder} />
          </Field>
        ) : (
          <Field id="signin-code" label={fill(t.signIn.codeSentTo, { email: email.trim() })} error={error}>
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
            {step === 'email' ? t.signIn.sendCode : t.signIn.signIn}
          </Button>
          {step === 'code' && (
            <Button tone="quiet" onClick={() => void send()}>
              {t.signIn.sendNewCode}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

export function PasskeyPanel() {
  const { createAccountPasskey, passkeyReady } = useKeptra();
  const { t, say } = useKeptraCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="max-w-xl">
      <div className="flex items-center gap-3">
        <KeyRound className="h-5 w-5 text-gray-300" aria-hidden="true" />
        <h2 className="font-display text-2xl font-bold tracking-tight">{t.signIn.passkeyTitle}</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-400">{t.signIn.passkeyBody}</p>
      {!passkeyReady && (
        <div className="mt-4">
          <Notice tone="warning">{t.signIn.passkeyOnlyHere}</Notice>
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
          if (!result.ok) setError(say(result.error));
        }}
      >
        {t.signIn.createPasskey}
      </Button>
    </Card>
  );
}

/** C4: an account is shown as a destination only once it exists on-chain, configured; until then, one signature sets it up. */
export function AccountSetup({ role, status }: { role: Role; status: AccountStatus }) {
  const { relay } = useKeptra();
  const { t, say } = useKeptraCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const account = status.accounts.find((item) => item.role === role);
  if (account === undefined || account.configured) return null;
  // A step of the way in, not a problem: no alert language (triangle, warning tone) — a card with its one action.
  return (
    // A plain region, not a card: it also sits inside the account page's cards.
    <div className="max-w-xl rounded-card border border-dark-line bg-white/[0.02] p-5">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-gray-300" aria-hidden="true" />
        <h2 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{role === 'CREATOR' ? t.signIn.setupBusinessTitle : t.signIn.setupTitle}</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-gray-300">{role === 'CREATOR' ? t.signIn.setupBusinessBody : t.signIn.setupBody}</p>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <Button
        className="mt-5"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const outcome = await relay(role === 'CREATOR' ? { kind: 'configure', role: 'CREATOR' } : { kind: 'configure' });
          setBusy(false);
          if (outcome.status === 'refused') setError(say(outcome.error));
        }}
      >
        {t.signIn.setupCta}
      </Button>
    </div>
  );
}

/**
 * The content, once the person is signed in and has a passkey. V3: a session read
 * that failed is not "signed out" — it is an error with "Try again"; after a good
 * read, a later failure keeps the content and says so above it.
 */
export function RequireAccount({ intro, children }: { intro?: string; children: (status: AccountStatus) => React.ReactNode }) {
  const { signedIn, status, statusError, refresh } = useKeptra();
  const { t } = useKeptraCopy();
  // P6-9: the account is read by the pages that show it, not by every page of the site.
  useEffect(() => {
    if (signedIn === null) void refresh();
  }, [signedIn, refresh]);
  const failed = statusError === null ? null : <ReadError what={t.what.yourAccount} error={statusError} onRetry={() => void refresh()} />;
  if (status === null && failed !== null) return failed;
  if (signedIn === null) return <Loading label={t.signIn.checking} />;
  if (!signedIn || status === null) return <SignInPanel intro={intro} />;
  if (status.passkeys.length === 0) return <PasskeyPanel />;
  return (
    <>
      {failed && <div className="mb-6">{failed}</div>}
      {children(status)}
    </>
  );
}
