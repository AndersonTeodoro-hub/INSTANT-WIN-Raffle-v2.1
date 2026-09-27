import { useEffect, useState } from 'react';
import { useReadContract } from 'wagmi';
import { ArrowUpRight, KeyRound, ShieldAlert, ShieldCheck } from 'lucide-react';
import { CONTRACTS } from '../../constants';
import { ERC20_META_ABI, GIVEAWAY_MANAGER_V2_ABI, GiveawayV2PrizeKind } from '../../lib/giveaway-v2-abi';
import { KeptraShell } from '../../components/keptra/KeptraShell';
import { useKeptra } from '../../components/keptra/KeptraProvider';
import { AccountSetup, RequireAccount } from '../../components/keptra/SignIn';
import { useUsdcBalance } from '../../components/keptra/hooks';
import { AddressLink, Badge, Button, Card, Field, Notice, PageTitle, ReadError, SectionTitle, Stat, inputClass } from '../../components/keptra/ui';
import {
  authorizeMigration,
  migrationChallenge,
  privacyErase,
  privacyExport,
  signOut,
  type AccountStatus,
  type AccountView,
  type Role,
} from '../../lib/keptra/api';
import { decimalText, formatUsdc, formatUtc, parseUsdc } from '../../lib/keptra/format';
import { CHAIN_FAILED } from '../../lib/keptra/reads';
import { around, fill, useKeptraCopy } from '../keptra.i18n';

/*
 * /account — the recovery notices land here (mail.ts: /account), and so does
 * anybody who opens keptra.io from the Telegram warning (telegram.ts).
 *
 * The two accounts (A10), each with its address once it exists (C4), its USDC,
 * and whether recovery is on against the chain's current guardian (A6, C6, U9); a
 * change of access pending on-chain, cancellable with the passkey at any moment
 * (6.3.3, U12, T19); the migration of a derived wallet (6.6, U14); sending USDC
 * out, exactly the amount typed (C7, U17); and the privacy rights (D7, T13).
 */

export function AccountPage() {
  const { t } = useKeptraCopy();
  useEffect(() => {
    document.title = t.account.metaTitle;
  }, [t]);
  return (
    <KeptraShell>
      <PageTitle eyebrow={t.account.eyebrow} title={t.account.title} />
      <RequireAccount intro={t.account.intro}>{(status) => <AccountBody status={status} />}</RequireAccount>
    </KeptraShell>
  );
}

function AccountBody({ status }: { status: AccountStatus }) {
  const { refresh } = useKeptra();
  const { t } = useKeptraCopy();
  const [signedInBefore, signedInAfter] = around(t.account.signedInAs, 'email');
  const pending = status.accounts.filter((account) => account.recoveryPendingUntil !== null);
  return (
    <div className="space-y-8">
      {pending.map((account) => (
        <CancelRecovery key={account.role} account={account} />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400">
        <p>
          {signedInBefore}
          <span className="font-mono text-white">{status.email ?? '—'}</span>
          {signedInAfter} · {fill(status.passkeys.length === 1 ? t.account.passkeysOne : t.account.passkeysMany, { n: status.passkeys.length })}
          {status.phoneVerified ? ` · ${t.account.phoneVerified}` : ''}
        </p>
        <Button
          tone="quiet"
          onClick={async () => {
            await signOut();
            await refresh();
          }}
        >
          {t.account.signOut}
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {(['PARTICIPANT', 'CREATOR'] as const).map((role) => {
          const account = status.accounts.find((item) => item.role === role);
          return account ? <AccountCard key={role} account={account} status={status} /> : null;
        })}
      </div>
      {(status.migration.PARTICIPANT !== 'NONE' || status.migration.CREATOR !== 'NONE') && <MigrationCard status={status} />}
      <PrivacyCard />
    </div>
  );
}

function AccountCard({ account, status }: { account: AccountView; status: AccountStatus }) {
  const { balance, failed, refetch } = useUsdcBalance(account.address);
  const { t, lang } = useKeptraCopy();
  const title = account.role === 'PARTICIPANT' ? t.account.personal : t.account.business;
  return (
    <Card>
      <SectionTitle aside={account.configured ? <Badge tone="success">{t.account.active}</Badge> : <Badge>{t.account.notSetUp}</Badge>}>{title}</SectionTitle>
      <p className="text-sm text-gray-400">{account.role === 'PARTICIPANT' ? t.account.personalBody : t.account.businessBody}</p>
      {!account.configured ? (
        <div className="mt-4">
          <AccountSetup role={account.role} status={status} />
        </div>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-5">
            <Stat label="USDC" value={balance !== null ? formatUsdc(balance, lang) : failed ? t.ui.notRead : '…'} />
            <div>
              <dt className="text-xs text-gray-400">{t.account.recovery}</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm">
                {account.recoveryEnabled ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" /> {t.account.on}
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-4 w-4 text-gray-300" aria-hidden="true" /> {t.account.off}
                  </>
                )}
              </dd>
            </div>
          </dl>
          {failed && (
            <div className="mt-4">
              <ReadError what={t.what.balance} error={CHAIN_FAILED} onRetry={() => void refetch()} />
            </div>
          )}
          <div className="mt-5">
            <p className="text-xs text-gray-400">{t.account.addressLabel}</p>
            <p className="mt-1 break-all font-mono text-sm text-white">{account.address}</p>
            {account.address && <AddressLink address={account.address} label={t.account.viewOnArbiscan} />}
            <p className="mt-2 text-xs text-gray-400">{t.account.addMoney}</p>
          </div>
          {!account.recoveryEnabled && (
            <div className="mt-4">
              <RecoveryOff role={account.role} />
            </div>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <SendUsdc role={account.role} onSent={() => void refetch()} />
            {account.role === 'PARTICIPANT' && <SendPrize />}
          </div>
        </>
      )}
    </Card>
  );
}

/** 6.5 and C7 (U17): a prize the account won, sent on — the token's exact amount, or the one item of an NFT prize. */
function SendPrize() {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const [open, setOpen] = useState(false);
  const [campaign, setCampaign] = useState('');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const giveawayId = /^\d{1,20}$/.test(campaign.trim()) ? BigInt(campaign.trim()) : null;
  const read = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getGiveaway',
    args: [giveawayId ?? 0n],
    query: { enabled: open && giveawayId !== null },
  });
  const prize = read.data as { prizeKind?: number; feeToken?: `0x${string}` } | undefined;
  const isNft = prize?.prizeKind === GiveawayV2PrizeKind.NFT;
  const decimals = useReadContract({
    address: prize?.feeToken,
    abi: ERC20_META_ABI,
    functionName: 'decimals',
    query: { enabled: open && prize?.feeToken !== undefined && !isNft },
  });

  if (!open) {
    return (
      <Button tone="secondary" onClick={() => setOpen(true)}>
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> {t.account.sendPrize}
      </Button>
    );
  }
  const send = async () => {
    setMessage(null);
    if (giveawayId === null || prize === undefined) return setMessage({ tone: 'error', text: t.account.campaignNeeded });
    if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) return setMessage({ tone: 'error', text: t.account.addressNeeded });
    let value = 1n;
    if (!isNft) {
      // P6-7: without the token's decimals read, no amount is computed — never with decimals nobody read.
      if (decimals.data === undefined) return setMessage({ tone: 'error', text: decimals.isError ? t.account.tokenUnread : t.account.tokenReading });
      const places = Number(decimals.data);
      // The language's own decimal sign, and no thousands separator (lib/keptra/format.ts decimalText).
      const clean = decimalText(amount, lang);
      if (clean === null || !new RegExp(`^\\d{1,24}(\\.\\d{1,${places}})?$`).test(clean)) {
        return setMessage({ tone: 'error', text: amount.trim() === '' ? t.account.amountNeeded : t.ui.amountFormat });
      }
      const [whole, fraction = ''] = clean.split('.');
      value = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0') || '0');
    }
    setBusy(true);
    const outcome = await relay({ kind: 'transfer', giveawayId: giveawayId.toString(), to: to.trim(), amount: value.toString() });
    setBusy(false);
    if (outcome.status === 'refused') setMessage({ tone: 'error', text: say(outcome.error) });
    if (outcome.status === 'done') setMessage({ tone: 'success', text: t.account.sent });
  };
  return (
    <form
      className="w-full space-y-4 rounded-xl border border-dark-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Field id="prize-campaign" label={t.account.campaignNumber} hint={t.account.campaignHint}>
        <input id="prize-campaign" inputMode="numeric" className={`${inputClass} font-mono`} value={campaign} onChange={(event) => setCampaign(event.target.value)} />
      </Field>
      {(read.isError || decimals.isError) && (
        <ReadError
          what={t.what.campaignPrize}
          error={CHAIN_FAILED}
          onRetry={() => void (read.isError ? read.refetch() : decimals.refetch())}
        />
      )}
      <Field id="prize-to" label={t.account.sendTo}>
        <input id="prize-to" className={`${inputClass} font-mono text-sm`} value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" />
      </Field>
      {!isNft && decimals.data !== undefined && (
        <Field id="prize-amount" label={t.account.amount} hint={t.account.amountHint}>
          <input id="prize-amount" inputMode="decimal" className={`${inputClass} font-mono`} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" busy={busy}>
          {t.account.review}
        </Button>
        <Button tone="secondary" onClick={() => setOpen(false)}>
          {t.account.close}
        </Button>
      </div>
    </form>
  );
}

/** A6, C6, D1 (U9): without the current guardian the account has no recovery, and the page says so and offers to add it. */
function RecoveryOff({ role }: { role: Role }) {
  const { relay } = useKeptra();
  const { t, say } = useKeptraCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Notice tone="warning" title={t.account.recoveryOffTitle}>
      <p>{t.account.recoveryOffBody}</p>
      {error && <p className="mt-2 text-red-200">{error}</p>}
      <Button
        className="mt-3"
        tone="secondary"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const outcome = await relay(role === 'CREATOR' ? { kind: 'configure', role: 'CREATOR' } : { kind: 'configure' });
          setBusy(false);
          if (outcome.status === 'refused') setError(say(outcome.error));
        }}
      >
        {t.account.recoveryOn}
      </Button>
    </Notice>
  );
}

/** 6.3.3, R-2, T19 (U12): a change of access pending on-chain, cancelled with the passkey this device holds. */
function CancelRecovery({ account }: { account: AccountView }) {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done) return <Notice tone="success">{t.account.cancelled}</Notice>;
  return (
    <Notice tone="error" title={t.account.pendingTitle}>
      <p>
        {fill(account.role === 'CREATOR' ? t.account.pendingBusiness : t.account.pendingPersonal, {
          date: formatUtc(Math.floor(Date.parse(account.recoveryPendingUntil ?? '') / 1000), lang),
        })}
      </p>
      {error && <p className="mt-2">{error}</p>}
      <Button
        className="mt-3"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const outcome = await relay(account.role === 'CREATOR' ? { kind: 'cancelRecovery', role: 'CREATOR' } : { kind: 'cancelRecovery' });
          setBusy(false);
          if (outcome.status === 'refused') setError(say(outcome.error));
          if (outcome.status === 'done') setDone(true);
        }}
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" /> {t.account.cancelIt}
      </Button>
    </Notice>
  );
}

/** C7 and T12 (U17): USDC out of either account, exactly the amount typed, to an address the person gives. */
function SendUsdc({ role, onSent }: { role: Role; onSent: () => void }) {
  const { relay } = useKeptra();
  const { t, lang, say } = useKeptraCopy();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const id = role.toLowerCase();

  if (!open) {
    return (
      <Button tone="secondary" onClick={() => setOpen(true)}>
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> {t.account.sendUsdc}
      </Button>
    );
  }
  const send = async () => {
    setMessage(null);
    const value = parseUsdc(amount, lang);
    if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) return setMessage({ tone: 'error', text: t.account.addressNeeded });
    if (value === null && amount.trim() !== '') return setMessage({ tone: 'error', text: t.ui.amountFormat });
    if (value === null || value === 0n) return setMessage({ tone: 'error', text: t.account.usdcAmountNeeded });
    setBusy(true);
    const outcome = await relay({ kind: 'transferUsdc', to: to.trim(), amount: value.toString(), ...(role === 'CREATOR' ? { role: 'CREATOR' } : {}) });
    setBusy(false);
    if (outcome.status === 'refused') setMessage({ tone: 'error', text: say(outcome.error) });
    if (outcome.status === 'done') {
      setMessage({ tone: 'success', text: t.account.sent });
      setAmount('');
      onSent();
    }
  };
  return (
    <form
      className="w-full space-y-4 rounded-xl border border-dark-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Field id={`to-${id}`} label={t.account.sendTo}>
        <input id={`to-${id}`} className={`${inputClass} font-mono text-sm`} value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" />
      </Field>
      <Field id={`amount-${id}`} label={t.account.amountUsdc} hint={t.account.exactAmount}>
        <input
          id={`amount-${id}`}
          inputMode="decimal"
          className={`${inputClass} font-mono`}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder={t.account.amountPlaceholder}
        />
      </Field>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" busy={busy}>
          {t.account.review}
        </Button>
        <Button tone="secondary" onClick={() => setOpen(false)}>
          {t.account.close}
        </Button>
      </div>
    </form>
  );
}

/** 6.6.2 and 6.6.3 (U14): the passkey authorises moving the earlier wallet's balances into the account. */
function MigrationCard({ status }: { status: AccountStatus }) {
  const { signChallenge, refresh } = useKeptra();
  const { t, say } = useKeptraCopy();
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = { ...t.account.migration, NONE: '' };

  const authorise = async (kind: Role) => {
    setBusy(kind);
    setError(null);
    const challenge = await migrationChallenge(kind);
    if (!challenge.ok) {
      setBusy(null);
      return setError(say(challenge.error));
    }
    try {
      const assertion = await signChallenge(challenge.challenge);
      const result = await authorizeMigration(kind, assertion);
      if (!result.ok) setError(say(result.error));
    } catch {
      setError(t.account.passkeyFailed);
    }
    setBusy(null);
    await refresh();
  };

  return (
    <Card>
      <SectionTitle>{t.account.migrationTitle}</SectionTitle>
      <p className="text-sm text-gray-400">{t.account.migrationBody}</p>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <ul className="mt-5 grid gap-4 md:grid-cols-2">
        {(['PARTICIPANT', 'CREATOR'] as const)
          .filter((kind) => status.migration[kind] !== 'NONE')
          .map((kind) => (
            <li key={kind} className="rounded-xl border border-dark-border p-4">
              <p className="font-semibold text-white">{kind === 'PARTICIPANT' ? t.account.personalWallet : t.account.creatorWallet}</p>
              <p className="mt-1 text-sm text-gray-400">{words[status.migration[kind]]}</p>
              {status.migration[kind] === 'PENDING' && (
                <Button className="mt-3" busy={busy === kind} onClick={() => void authorise(kind)}>
                  {t.account.authorise}
                </Button>
              )}
            </li>
          ))}
      </ul>
    </Card>
  );
}

/** D7 and T13: export everything; erase only when nothing is left in the accounts, and say what is left. */
function PrivacyCard() {
  const { refresh } = useKeptra();
  const { t, say } = useKeptraCopy();
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <SectionTitle>{t.account.dataTitle}</SectionTitle>
      <p className="text-sm text-gray-400">{t.account.dataBody}</p>
      {message && (
        <div className="mt-4">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button
          tone="secondary"
          onClick={async () => {
            const result = await privacyExport();
            if (!result.ok) return setMessage({ tone: 'error', text: say(result.error) });
            const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'keptra-data.json';
            link.click();
            URL.revokeObjectURL(url);
            setMessage({ tone: 'success', text: t.account.downloaded });
          }}
        >
          {t.account.download}
        </Button>
        {confirming ? (
          <>
            <Button
              tone="danger"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                const result = await privacyErase();
                setBusy(false);
                setConfirming(false);
                if (!result.ok) return setMessage({ tone: 'warning', text: say(result.error) });
                setMessage({ tone: 'success', text: result.deferredNote ?? t.account.erased });
                await refresh();
              }}
            >
              {t.account.confirmErase}
            </Button>
            <Button tone="secondary" onClick={() => setConfirming(false)}>
              {t.account.keep}
            </Button>
          </>
        ) : (
          <Button tone="danger" onClick={() => setConfirming(true)}>
            {t.account.erase}
          </Button>
        )}
      </div>
    </Card>
  );
}
