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
import { formatUsdc, formatUtc, parseUsdc } from '../../lib/keptra/format';
import { CHAIN_FAILED } from '../../lib/keptra/reads';

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
  useEffect(() => {
    document.title = 'Account · Keptra';
  }, []);
  return (
    <KeptraShell>
      <PageTitle eyebrow="Keptra account" title="Your account" />
      <RequireAccount intro="Sign in to manage your Keptra account.">{(status) => <AccountBody status={status} />}</RequireAccount>
    </KeptraShell>
  );
}

function AccountBody({ status }: { status: AccountStatus }) {
  const { refresh } = useKeptra();
  const pending = status.accounts.filter((account) => account.recoveryPendingUntil !== null);
  return (
    <div className="space-y-8">
      {pending.map((account) => (
        <CancelRecovery key={account.role} account={account} />
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-400">
        <p>
          Signed in as <span className="font-mono text-white">{status.email ?? '—'}</span> · {status.passkeys.length} passkey{status.passkeys.length === 1 ? '' : 's'}
          {status.phoneVerified ? ' · phone verified' : ''}
        </p>
        <Button
          tone="quiet"
          onClick={async () => {
            await signOut();
            await refresh();
          }}
        >
          Sign out
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
  const title = account.role === 'PARTICIPANT' ? 'Personal account' : 'Business account';
  return (
    <Card>
      <SectionTitle aside={account.configured ? <Badge tone="success">Active</Badge> : <Badge>Not set up</Badge>}>{title}</SectionTitle>
      <p className="text-sm text-gray-400">
        {account.role === 'PARTICIPANT' ? 'Buying, entering draws, claiming and redeeming prizes.' : 'Selling, prize obligations and campaigns, as a store or a brand.'}
      </p>
      {!account.configured ? (
        <div className="mt-4">
          <AccountSetup role={account.role} status={status} />
        </div>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-5">
            <Stat label="USDC" value={balance !== null ? formatUsdc(balance) : failed ? 'Not read' : '…'} />
            <div>
              <dt className="text-xs text-gray-400">Recovery</dt>
              <dd className="mt-1 flex items-center gap-2 text-sm">
                {account.recoveryEnabled ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-success" aria-hidden="true" /> On
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-4 w-4 text-brand" aria-hidden="true" /> Off
                  </>
                )}
              </dd>
            </div>
          </dl>
          {failed && (
            <div className="mt-4">
              <ReadError what="The balance" error={CHAIN_FAILED} onRetry={() => void refetch()} />
            </div>
          )}
          <div className="mt-5">
            <p className="text-xs text-gray-400">Address on Arbitrum One</p>
            <p className="mt-1 break-all font-mono text-sm text-white">{account.address}</p>
            {account.address && <AddressLink address={account.address} label="View on Arbiscan" />}
            <p className="mt-2 text-xs text-gray-400">To add money, send USDC on Arbitrum One to this address.</p>
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
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> Send a prize
      </Button>
    );
  }
  const send = async () => {
    setMessage(null);
    if (giveawayId === null || prize === undefined) return setMessage({ tone: 'error', text: 'Enter the number of the campaign you won.' });
    if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) return setMessage({ tone: 'error', text: 'Enter an Arbitrum One address (0x…).' });
    let value = 1n;
    if (!isNft) {
      const places = Number(decimals.data ?? 18);
      const clean = amount.trim();
      if (!new RegExp(`^\\d{1,24}(\\.\\d{1,${places}})?$`).test(clean)) return setMessage({ tone: 'error', text: 'Enter the amount to send.' });
      const [whole, fraction = ''] = clean.split('.');
      value = BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0') || '0');
    }
    setBusy(true);
    const outcome = await relay({ kind: 'transfer', giveawayId: giveawayId.toString(), to: to.trim(), amount: value.toString() });
    setBusy(false);
    if (outcome.status === 'refused') setMessage({ tone: 'error', text: outcome.error });
    if (outcome.status === 'done') setMessage({ tone: 'success', text: 'Sent.' });
  };
  return (
    <form
      className="w-full space-y-4 rounded-xl border border-dark-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <Field id="prize-campaign" label="Campaign number" hint="The Event Center campaign whose prize you claimed.">
        <input id="prize-campaign" inputMode="numeric" className={`${inputClass} font-mono`} value={campaign} onChange={(event) => setCampaign(event.target.value)} />
      </Field>
      {(read.isError || decimals.isError) && (
        <ReadError
          what="The campaign's prize"
          error={CHAIN_FAILED}
          onRetry={() => void (read.isError ? read.refetch() : decimals.refetch())}
        />
      )}
      <Field id="prize-to" label="Send to (Arbitrum One address)">
        <input id="prize-to" className={`${inputClass} font-mono text-sm`} value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" />
      </Field>
      {!isNft && (
        <Field id="prize-amount" label="Amount" hint="Exactly this amount of the prize token is sent.">
          <input id="prize-amount" inputMode="decimal" className={`${inputClass} font-mono`} value={amount} onChange={(event) => setAmount(event.target.value)} />
        </Field>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" busy={busy}>
          Review and send
        </Button>
        <Button tone="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

/** A6, C6, D1 (U9): without the current guardian the account has no recovery, and the page says so and offers to add it. */
function RecoveryOff({ role }: { role: Role }) {
  const { relay } = useKeptra();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Notice tone="warning" title="This account has no recovery">
      <p>If this device is lost, the account cannot be recovered. Add Keptra's current recovery key back with your passkey.</p>
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
          if (outcome.status === 'refused') setError(outcome.error);
        }}
      >
        Turn recovery back on
      </Button>
    </Notice>
  );
}

/** 6.3.3, R-2, T19 (U12): a change of access pending on-chain, cancelled with the passkey this device holds. */
function CancelRecovery({ account }: { account: AccountView }) {
  const { relay } = useKeptra();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done) return <Notice tone="success">The change of access was cancelled. Your passkey keeps control of the account.</Notice>;
  return (
    <Notice tone="error" title="A change of access to your account is pending">
      <p>
        Someone asked to replace the passkey of your {account.role === 'CREATOR' ? 'business' : 'personal'} account. If nothing is done, the new passkey takes over on{' '}
        {formatUtc(Math.floor(Date.parse(account.recoveryPendingUntil ?? '') / 1000))}. If it was not you, cancel it now.
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
          if (outcome.status === 'refused') setError(outcome.error);
          if (outcome.status === 'done') setDone(true);
        }}
      >
        <KeyRound className="h-4 w-4" aria-hidden="true" /> Cancel it with my passkey
      </Button>
    </Notice>
  );
}

/** C7 and T12 (U17): USDC out of either account, exactly the amount typed, to an address the person gives. */
function SendUsdc({ role, onSent }: { role: Role; onSent: () => void }) {
  const { relay } = useKeptra();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const id = role.toLowerCase();

  if (!open) {
    return (
      <Button tone="secondary" onClick={() => setOpen(true)}>
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" /> Send USDC
      </Button>
    );
  }
  const send = async () => {
    setMessage(null);
    const value = parseUsdc(amount);
    if (!/^0x[0-9a-fA-F]{40}$/.test(to.trim())) return setMessage({ tone: 'error', text: 'Enter an Arbitrum One address (0x…).' });
    if (value === null || value === 0n) return setMessage({ tone: 'error', text: 'Enter an amount in USDC, up to six decimals.' });
    setBusy(true);
    const outcome = await relay({ kind: 'transferUsdc', to: to.trim(), amount: value.toString(), ...(role === 'CREATOR' ? { role: 'CREATOR' } : {}) });
    setBusy(false);
    if (outcome.status === 'refused') setMessage({ tone: 'error', text: outcome.error });
    if (outcome.status === 'done') {
      setMessage({ tone: 'success', text: 'Sent.' });
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
      <Field id={`to-${id}`} label="Send to (Arbitrum One address)">
        <input id={`to-${id}`} className={`${inputClass} font-mono text-sm`} value={to} onChange={(event) => setTo(event.target.value)} placeholder="0x…" />
      </Field>
      <Field id={`amount-${id}`} label="Amount in USDC" hint="Exactly this amount is sent.">
        <input id={`amount-${id}`} inputMode="decimal" className={`${inputClass} font-mono`} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
      </Field>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" busy={busy}>
          Review and send
        </Button>
        <Button tone="secondary" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
    </form>
  );
}

/** 6.6.2 and 6.6.3 (U14): the passkey authorises moving the earlier wallet's balances into the account. */
function MigrationCard({ status }: { status: AccountStatus }) {
  const { signChallenge, refresh } = useKeptra();
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const words = { PENDING: 'Waiting for your authorisation', AUTHORIZED: 'Authorised — the move runs within the hour', DONE: 'Done', NONE: '' };

  const authorise = async (kind: Role) => {
    setBusy(kind);
    setError(null);
    const challenge = await migrationChallenge(kind);
    if (!challenge.ok) {
      setBusy(null);
      return setError(challenge.error);
    }
    try {
      const assertion = await signChallenge(challenge.challenge);
      const result = await authorizeMigration(kind, assertion);
      if (!result.ok) setError(result.error);
    } catch {
      setError('The passkey did not sign. You can try again.');
    }
    setBusy(null);
    await refresh();
  };

  return (
    <Card>
      <SectionTitle>Move your earlier wallet</SectionTitle>
      <p className="text-sm text-gray-400">
        Before Keptra accounts, the platform kept a wallet for you. Authorise with your passkey and its balances move into your account; after that, that wallet is never
        used again. Balances tied to an open entry, prize or campaign wait until it ends.
      </p>
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
              <p className="font-semibold text-white">{kind === 'PARTICIPANT' ? 'Personal wallet' : 'Creator wallet'}</p>
              <p className="mt-1 text-sm text-gray-400">{words[status.migration[kind]]}</p>
              {status.migration[kind] === 'PENDING' && (
                <Button className="mt-3" busy={busy === kind} onClick={() => void authorise(kind)}>
                  Authorise with passkey
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
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <SectionTitle>Your data</SectionTitle>
      <p className="text-sm text-gray-400">Download what Keptra holds about you, or erase it. Erasure is refused while your accounts still hold money, vouchers or open orders.</p>
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
            if (!result.ok) return setMessage({ tone: 'error', text: result.error });
            const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'keptra-data.json';
            link.click();
            URL.revokeObjectURL(url);
            setMessage({ tone: 'success', text: 'Downloaded.' });
          }}
        >
          Download my data
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
                if (!result.ok) return setMessage({ tone: 'warning', text: result.error });
                setMessage({ tone: 'success', text: result.deferredNote ?? 'Your data was erased.' });
                await refresh();
              }}
            >
              Yes, erase my data
            </Button>
            <Button tone="secondary" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <Button tone="danger" onClick={() => setConfirming(true)}>
            Erase my data
          </Button>
        )}
      </div>
    </Card>
  );
}
