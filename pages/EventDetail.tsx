import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useKeptra } from '../components/keptra/KeptraProvider';
import { KEPTRA_VOUCHER, keptraConfigured } from '../lib/keptra/contracts';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { Check, Loader2, ExternalLink } from 'lucide-react';
import { CONTRACTS } from '../constants';
import { GIVEAWAY_MANAGER_V2_ABI, ERC20_META_ABI, GiveawayV2Status, GiveawayV2PrizeKind } from '../lib/giveaway-v2-abi';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { EventShell } from '../components/EventShell';
import { ProofSeal } from '../components/Proof';
import { EventStatus } from './EventCenter';
import { Step } from '../components/Step';
import { ShareButton } from '../components/ShareButton';
import { BrandByline, IdentityBanner, useCampaignIdentity } from '../components/CampaignIdentity';
import { useEventsCopy } from './events.i18n';
import {
  confirmDestination,
  entryStart,
  entryStatus,
  privacyErase,
  privacyExport,
  proposeDestination,
  requestCode,
  revokeSession,
  verifyCode,
  type EntryOutcome,
  type EntryStatusResult,
} from '../lib/eventcenter';

const ARBISCAN = 'https://arbiscan.io';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const POLL_MS = 6000;

const ACTIVE_STATUSES = ['AWAITING_CONTACT', 'VERIFIED', 'ELIGIBLE', 'FUNDING', 'SUBMITTED'];

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Contagem decrescente até um instante que já foi lido da cadeia.
 *
 * Não lê nada: recebe o `effectiveEndTime` que a página já tem e conta no
 * cliente, como o relógio da lotaria. Serve as duas chaves de i18n que existiam
 * desde o início e nunca tinham chegado ao ecrã — a página não dizia a ninguém
 * quanto tempo faltava para as entradas fecharem.
 */
function useCountdown(target: bigint | undefined): number | null {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (target === undefined) {
      setLeft(null);
      return;
    }
    const end = Number(target);
    const tick = () => setLeft(Math.max(0, end - Math.floor(Date.now() / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target]);

  return left;
}

/** Dias e horas enquanto falta mais de um dia; relógio a seguir. */
function formatWindow(seconds: number): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${pad(h)}h`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Login por email + código, e o painel de conta uma vez com sessão. */
function AccountPanel({
  giveawayId,
  loggedIn,
  email,
  onLoggedIn,
  onSignedOut,
}: {
  /** §17 L8: para o email do código nomear a campanha e a marca. */
  giveawayId: bigint;
  loggedIn: boolean;
  email: string | null;
  onLoggedIn: (email: string) => void;
  onSignedOut: () => void;
}) {
  const c = useEventsCopy().detail.account;
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [emailInput, setEmailInput] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    if (!/^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/.test(emailInput.trim())) {
      setError(c.invalidEmail);
      return;
    }
    setBusy(true);
    const res = await requestCode(emailInput.trim(), giveawayId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setStep('code');
  };

  const verify = async () => {
    setError(null);
    if (!/^[0-9]{6}$/.test(code.trim())) {
      setError(c.invalidCode);
      return;
    }
    setBusy(true);
    const res = await verifyCode(emailInput.trim(), code.trim());
    setBusy(false);
    if (!res.ok) {
      setError(c.invalidCode);
      return;
    }
    onLoggedIn(emailInput.trim());
  };

  const signOut = async () => {
    setBusy(true);
    await revokeSession();
    setBusy(false);
    onSignedOut();
  };

  const exportData = async () => {
    setBusy(true);
    const res = await privacyExport();
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'instant-win-event-center-data.json';
    a.click();
    URL.revokeObjectURL(url);
    setNotice(c.exportDone);
  };

  const eraseData = async () => {
    if (!window.confirm(c.deleteConfirm)) return;
    setBusy(true);
    const res = await privacyErase();
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(c.deleteDone);
    onSignedOut();
  };

  if (loggedIn) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-300">
          {c.signedInAs} {email ? <span className="font-mono text-white">{email}</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
          <button type="button" onClick={signOut} disabled={busy} className="min-h-[32px] hover:text-white underline underline-offset-2 disabled:opacity-50">
            {c.signOut}
          </button>
          <button type="button" onClick={exportData} disabled={busy} className="min-h-[32px] hover:text-white underline underline-offset-2 disabled:opacity-50">
            {c.exportData}
          </button>
          <button type="button" onClick={eraseData} disabled={busy} className="min-h-[32px] text-red-400/70 hover:text-red-400 underline underline-offset-2 disabled:opacity-50">
            {c.deleteData}
          </button>
          {notice && <span className="text-success">{notice}</span>}
          {error && <span className="text-red-400">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-[58ch] text-sm leading-relaxed text-gray-400">{c.loginBody}</p>
      {error && <Banner message={error} />}
      {step === 'email' ? (
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder={c.emailPlaceholder}
            aria-label={c.emailLabel}
            className="flex-1 min-h-[52px] rounded-xl border border-dark-border bg-dark-input px-4 text-white placeholder:text-gray-400 focus:border-gray-500"
          />
          <Button variant="connect" onClick={sendCode} isLoading={busy} className="min-h-[52px] rounded-xl sm:w-auto sm:px-8">
            {c.sendCode}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-300">{c.codeSentTitle}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              aria-label={c.codeLabel}
              className="flex-1 min-h-[52px] rounded-xl border border-dark-border bg-dark-input px-4 font-mono text-lg tracking-[0.3em] text-white tabular-nums focus:border-gray-500"
            />
            <Button variant="connect" onClick={verify} isLoading={busy} className="min-h-[52px] rounded-xl sm:w-auto sm:px-8">
              {c.verify}
            </Button>
          </div>
          <button type="button" onClick={sendCode} className="min-h-[44px] text-sm text-gray-400 hover:text-white underline underline-offset-2">
            {c.resend}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * What the draw did to this visitor, said plainly. The page had no way of saying
 * it: a winner was shown a panel headed "Your prize", and so was everybody else,
 * because that panel was gated on a custody row written at entry time.
 *
 * A loss is not a blank. Somebody who entered, waited and lost is owed a
 * sentence saying so, and the winners list above is how they check it.
 */
function OutcomePanel({
  outcome,
  awaiting,
  selfCustody,
  passkey,
  giveawayId,
  isVoucher,
}: {
  outcome: EntryOutcome | null;
  awaiting: boolean;
  selfCustody: boolean;
  /** SPEC-BLOCO-03 6.2.3: a Keptra account's prize, claimed with the passkey. */
  passkey: boolean;
  giveawayId: bigint;
  /** P6-8 (B13): the prize is a Keptra voucher — the NFT of the voucher contract, not any NFT. */
  isVoucher: boolean;
}) {
  const c = useEventsCopy().detail.outcome;
  const k = useEventsCopy().detail.keptra;
  const { relay } = useKeptra();
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  if (awaiting) {
    return (
      <p className="flex items-center gap-3 iw-surface p-5 text-sm text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
        <span>{c.pending}</span>
      </p>
    );
  }

  // VOID is a cancelled campaign: no draw took place, so there is no result to
  // report here. The status badge at the top of the page already says CANCELLED,
  // and a second panel repeating it would only look like something went wrong.
  if (outcome === null || outcome === 'VOID') return null;

  if (outcome === 'LOST') {
    return (
      <div className="iw-surface p-6">
        <h2 className="font-display text-2xl font-bold tracking-tight text-white">{c.lostTitle}</h2>
        <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-gray-400">{c.lostBody}</p>
      </div>
    );
  }

  // A self-custody winner is told something different: the bridge holds no key
  // for their address and the destination form below is not shown to them, so
  // the instruction they need is the email's — call claimPrize from that wallet.
  return (
    <div className="rounded-xl border border-brand/30 bg-brand/[0.06] p-6">
      <h2 className="font-display text-3xl font-bold tracking-tight text-brand">{c.wonTitle}</h2>
      <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-gray-200">
        {passkey ? (claimed ? k.claimed : k.claimBody) : selfCustody ? c.wonBodySelf : c.wonBody}
      </p>
      {passkey && !claimed && (
        <div className="mt-4 space-y-2">
          {claimError && <Banner message={claimError} />}
          <Button
            variant="success"
            isLoading={claiming}
            className="min-h-[52px] w-full rounded-xl sm:w-auto sm:px-8"
            onClick={async () => {
              setClaiming(true);
              setClaimError(null);
              const result = await relay({ kind: 'claim', giveawayId: giveawayId.toString() });
              setClaiming(false);
              if (result.status === 'refused') setClaimError(result.error);
              if (result.status === 'done') setClaimed(true);
            }}
          >
            {k.claimCta}
          </Button>
        </div>
      )}
      {/* P6-8: the voucher's text only for a voucher prize, and only once it is claimed. */}
      {passkey && isVoucher && claimed && (
        <div className="mt-4 rounded-lg border border-dark-border p-4">
          <p className="text-sm text-gray-300">{k.voucherBody}</p>
          <Link to="/orders" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand underline underline-offset-4">
            {k.voucherCta}
          </Link>
        </div>
      )}
    </div>
  );
}

function ParticipatePanel({
  giveawayId,
  awaitingOutcome,
  onStatus,
}: {
  giveawayId: bigint;
  awaitingOutcome: boolean;
  onStatus: (s: EntryStatusResult) => void;
}) {
  const c = useEventsCopy().detail.participate;
  const k = useEventsCopy().detail.keptra;
  const { relay, passkeyReady } = useKeptra();
  const [status, setStatus] = useState<EntryStatusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);
  // SPEC-BLOCO-03 6.2.1: a participant with no Keptra account and no earlier wallet sets one up first.
  const [needsAccount, setNeedsAccount] = useState(false);

  const refresh = async () => {
    const res = await entryStatus(giveawayId);
    if (res.ok) {
      setStatus(res);
      onStatus(res);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [giveawayId]);

  /*
   * Two reasons to keep asking, and both of them end. ACTIVE_STATUSES is the
   * entry still moving through its funnel; the second is the window this panel
   * had no idea existed — entry CONFIRMED, campaign settled on chain, result not
   * yet written down. It stops the moment outcome is not null, and never starts
   * for a campaign that was cancelled or is still running.
   */
  useEffect(() => {
    if (!status) return;
    if (!ACTIVE_STATUSES.includes(status.status) && !awaitingOutcome) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status, awaitingOutcome]);

  const enter = async () => {
    setError(null);
    setBusy(true);
    const res = await entryStart(giveawayId);
    setBusy(false);
    if (!res.ok) {
      // entry/start: 'Create your passkey first.' — the account page walks them through it.
      if (res.status === 409 && /passkey/i.test(res.error)) setNeedsAccount(true);
      else setError(res.error);
      return;
    }
    if (res.url) {
      setTelegramUrl(res.url);
      window.open(res.url, '_blank', 'noopener,noreferrer');
    }
    refresh();
  };

  if (!status) return null;

  const label: Record<string, string> = {
    AWAITING_CONTACT: c.statusAwaitingContact,
    VERIFIED: c.statusVerified,
    ELIGIBLE: c.statusEligible,
    FUNDING: c.statusFunding,
    SUBMITTED: c.statusSubmitted,
    CONFIRMED: c.statusConfirmed,
    FAILED: c.statusFailed,
  };

  const confirmed = status.status === 'CONFIRMED';

  // A4: a Keptra entry is signed with the passkey once its root is published (ELIGIBLE).
  const confirmWithPasskey = async () => {
    setError(null);
    setBusy(true);
    const result = await relay({ kind: 'enter', giveawayId: giveawayId.toString() });
    setBusy(false);
    if (result.status === 'refused') setError(result.error);
    refresh();
  };

  return (
    <div className="space-y-4">
      {needsAccount && (
        <div className="rounded-lg border border-brand/30 bg-brand/[0.06] p-4">
          <p className="text-sm text-gray-200">{k.passkeyNeeded}</p>
          <Link to="/account" className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand underline underline-offset-4">
            {k.setUpCta}
          </Link>
        </div>
      )}
      {status.passkey === true && status.status === 'ELIGIBLE' && (
        <div className="space-y-3 rounded-lg border border-brand/30 bg-brand/[0.06] p-4">
          <p className="text-sm text-gray-200">{passkeyReady ? k.confirmEntryBody : k.wrongOrigin}</p>
          {error && <Banner message={error} />}
          {passkeyReady && (
            <Button variant="connect" onClick={confirmWithPasskey} isLoading={busy} className="min-h-[52px] w-full rounded-xl sm:w-auto sm:px-8">
              {k.confirmEntryCta}
            </Button>
          )}
        </div>
      )}
      {status.status === 'NONE' ? (
        <>
          <p className="max-w-[58ch] text-sm leading-relaxed text-gray-400">{c.intro}</p>
          {error && <Banner message={error} />}
          <Button variant="connect" onClick={enter} isLoading={busy} className="min-h-[52px] w-full rounded-xl sm:w-auto sm:px-8">
            {c.ctaEnter}
          </Button>
        </>
      ) : (
        <>
          <p
            className={`text-base ${
              confirmed ? 'font-bold text-success' : 'text-gray-200'
            }`}
          >
            {label[status.status] ?? status.status}
          </p>
          {status.status === 'AWAITING_CONTACT' && (
            <div className="space-y-2">
              {error && <Banner message={error} />}
              <Button
                variant="connect"
                onClick={enter}
                isLoading={busy}
                className="min-h-[52px] w-full rounded-xl sm:w-auto sm:px-8"
              >
                {telegramUrl ? c.openTelegramAgain : c.openTelegram}
                <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
              </Button>
              <p className="text-xs text-gray-400">{c.telegramExpiredHint}</p>
            </div>
          )}
          {status.txHash && (
            <a
              href={`${ARBISCAN}/tx/${status.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-lg border border-dark-border px-4 py-3 font-mono text-xs text-success hover:border-success/40 transition-colors"
            >
              <span className="truncate">
                {c.txLabel} {short(status.txHash)}
              </span>
              <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
            </a>
          )}
        </>
      )}
      <p className="max-w-[62ch] text-xs leading-relaxed text-gray-400">{status.passkey === true ? k.notice : c.walletGapNotice}</p>
    </div>
  );
}

function PrizePanel({ giveawayId, custody }: { giveawayId: bigint; custody: NonNullable<EntryStatusResult['custody']> }) {
  const c = useEventsCopy().detail.prize;
  const { address } = useAccount();
  const [addr, setAddr] = useState(custody.destinationAddress ?? '');
  const [proposed, setProposed] = useState(custody.destinationAddress);
  const [confirmed, setConfirmed] = useState(custody.destinationConfirmed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const propose = async () => {
    setError(null);
    const value = addr.trim().toLowerCase();
    if (!ADDRESS_RE.test(value)) {
      setError(c.invalidAddress);
      return;
    }
    setBusy(true);
    const res = await proposeDestination(giveawayId, value);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setProposed(res.destinationAddress);
    setConfirmed(false);
  };

  const confirm = async () => {
    if (!proposed) return;
    setBusy(true);
    setError(null);
    const res = await confirmDestination(giveawayId, proposed);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setConfirmed(true);
  };

  return (
    <div className="space-y-4">
      <p className="max-w-[58ch] text-sm leading-relaxed text-gray-400">
        {custody.requiresOwnWallet ? c.requiresOwnWallet : c.belowThreshold}
      </p>
      {!custody.requiresOwnWallet && custody.custodyExpiresAt && (
        <p className="text-xs text-gray-400">
          {c.expiresOn} {new Date(custody.custodyExpiresAt).toLocaleDateString()}
        </p>
      )}
      {error && <Banner message={error} />}
      {confirmed ? (
        <p className="flex items-start gap-2 font-mono text-sm text-success break-all">
          <Check className="w-4 h-4 shrink-0 mt-0.5" strokeWidth={3} aria-hidden="true" />
          <span>
            {c.confirmed} {proposed}
          </span>
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder={c.destinationPlaceholder}
              aria-label={c.destinationLabel}
              className="flex-1 min-h-[52px] rounded-xl border border-dark-border bg-dark-input px-4 font-mono text-sm text-white focus:border-gray-500"
            />
            {address && (
              <button
                type="button"
                onClick={() => setAddr(address)}
                className="min-h-[44px] shrink-0 self-center font-mono text-xs text-gray-400 hover:text-white underline underline-offset-2 whitespace-nowrap"
              >
                {short(address)}
              </button>
            )}
          </div>
          {proposed && proposed.toLowerCase() === addr.trim().toLowerCase() ? (
            <>
              <p className="max-w-[58ch] text-xs leading-relaxed text-gray-400">{c.confirmExplainer}</p>
              <Button variant="success" onClick={confirm} isLoading={busy} className="min-h-[52px] w-full rounded-xl sm:w-auto sm:px-8">
                {c.confirmCta}
              </Button>
            </>
          ) : (
            <Button variant="connect" onClick={propose} isLoading={busy} className="min-h-[52px] w-full rounded-xl sm:w-auto sm:px-8">
              {c.proposeCta}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export const EventDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const c = useEventsCopy();
  const giveawayId = useMemo(() => {
    try {
      return id ? BigInt(id) : null;
    } catch {
      return null;
    }
  }, [id]);

  const [loggedIn, setLoggedIn] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [entryStatusResult, setEntryStatusResult] = useState<EntryStatusResult | null>(null);

  useEffect(() => {
    if (giveawayId === null) return;
    entryStatus(giveawayId).then((res) => {
      setSessionChecked(true);
      setLoggedIn(res.ok);
      if (res.ok) setEntryStatusResult(res);
    });
  }, [giveawayId]);

  const { data: paused } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'paused',
  });

  const { data: giveaway, isLoading } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getGiveaway',
    args: giveawayId !== null ? [giveawayId] : undefined,
    query: {
      enabled: giveawayId !== null,
      /*
       * The draw arrives on its own, without a reload. This read used to happen
       * once, so a page open while the campaign settled went on showing a
       * countdown, and the winners block — gated on SETTLED — never appeared for
       * the people most likely to be watching.
       *
       * A function rather than a number so the interval can stop: SETTLED and
       * CANCELLED are terminal on the contract.
       */
      refetchInterval: (query: { state: { data: unknown } }) => {
        const status = (query.state.data as { status?: number } | undefined)?.status;
        if (status === undefined) return POLL_MS;
        return status === GiveawayV2Status.SETTLED || status === GiveawayV2Status.CANCELLED
          ? false
          : POLL_MS;
      },
    },
  });

  const { data: effectiveEndTime } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'effectiveEndTime',
    args: giveawayId !== null ? [giveawayId] : undefined,
    query: { enabled: giveawayId !== null },
  });

  const { data: slotsRemaining } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'slotsRemaining',
    args: giveawayId !== null ? [giveawayId] : undefined,
    query: { enabled: giveawayId !== null },
  });

  const g = giveaway as any;

  const feeTokenAddress = (g?.feeToken ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
  const { data: meta } = useReadContracts({
    contracts: [
      { address: feeTokenAddress, abi: ERC20_META_ABI, functionName: 'decimals' },
      { address: feeTokenAddress, abi: ERC20_META_ABI, functionName: 'symbol' },
    ],
    query: { enabled: !!g },
  });

  const isNft = g?.prizeKind === GiveawayV2PrizeKind.NFT;
  // SPEC-BLOCO-03 P6-7: without the token's decimals read, no amount is shown —
  // never one computed with decimals nobody read.
  const readDecimals = meta?.[0]?.status === 'success' ? (meta[0].result as number) : null;
  const decimals = isNft ? 6 : readDecimals;
  const amountShown = decimals === null ? (meta?.[0]?.status === 'failure' ? 'Not read' : '…') : formatUnits(displayAmountOf(g, isNft) ?? 0n, decimals);
  const symbol = isNft ? 'USDC' : ((meta?.[1]?.result as string | undefined) ?? '?');

  const { data: winners } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getWinners',
    args: giveawayId !== null ? [giveawayId, 0n, BigInt(g?.winnersCount ?? 0)] : undefined,
    query: { enabled: giveawayId !== null && g?.status === GiveawayV2Status.SETTLED },
  });

  // §17: a identidade publicada, lida à ponte. Sem ela a página é a de sempre (L9).
  const { data: identity } = useCampaignIdentity(giveawayId);

  useEffect(() => {
    document.title = identity ? `${identity.name} · ${c.list.metaTitle}` : c.list.metaTitle;
  }, [c, identity]);

  /*
   * Is this winner the visitor? Two addresses can be, and both deserve to see
   * their own name: the wallet wagmi reports, and the address the bridge entry
   * was made with, which entry/status returns to them and to nobody else.
   * Compared case-insensitively — getWinners returns whatever casing the
   * contract stored and useAccount returns EIP-55.
   */
  const { address: connected } = useAccount();
  const isMine = (winner: string) => {
    const address = winner.toLowerCase();
    return (
      address === connected?.toLowerCase() ||
      address === entryStatusResult?.walletAddress?.toLowerCase()
    );
  };

  const settled = g?.status === GiveawayV2Status.SETTLED;
  const outcome = entryStatusResult?.outcome ?? null;

  /*
   * The gap between the draw landing on chain and the pipeline recording what it
   * did to this entry — one pass of the cron, so seconds to a few minutes. The
   * panel below keeps asking across it and stops the moment an answer arrives,
   * which is why this is not simply "poll while settled".
   */
  const awaitingOutcome =
    settled && entryStatusResult?.status === 'CONFIRMED' && outcome === null;

  /** Relógio das entradas, a partir do instante que já foi lido acima. */
  const secondsLeft = useCountdown(effectiveEndTime as bigint | undefined);

  if (giveawayId === null) return <div className="min-h-screen bg-black" />;

  const acceptsEntries =
    g?.status === GiveawayV2Status.OPEN &&
    effectiveEndTime !== undefined &&
    BigInt(Math.floor(Date.now() / 1000)) < (effectiveEndTime as bigint) &&
    (slotsRemaining as bigint | undefined) !== undefined &&
    (slotsRemaining as bigint) > 0n;

  const left = slotsRemaining as bigint | undefined;
  const taken = g && left !== undefined ? g.slotCap - Number(left) : null;
  const filledPct = taken !== null && g?.slotCap > 0 ? Math.min(100, (taken / g.slotCap) * 100) : 0;
  const entryStep = entryStatusResult?.status;

  return (
    <EventShell back={{ to: '/events', label: c.nav.link }}>
      <div className="space-y-6">
        {paused === true && <Banner message={c.detail.pausedBanner} tone="notice" />}

        {isLoading && (
          <p className="flex items-center gap-3 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" /> {c.detail.loading}
          </p>
        )}

        {!isLoading && (!g || g.status === GiveawayV2Status.NONE) && <Banner message={c.detail.notFound} />}

        {g && g.status !== GiveawayV2Status.NONE && (
          <>
            {/* ============ O CONVITE ============ */}

            {/* O convite é o painel principal do ecrã: a única superfície elevada. */}
            <div className="iw-surface-raised overflow-hidden">
              {/* §17: o banner da campanha abre a página, quando existe. */}
              {identity && <IdentityBanner identity={identity} className="border-b border-dark-border" />}
              <div className="p-5 sm:p-7">

              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <EventStatus
                    status={g.status}
                    label={
                      c.list.status[
                        (['NONE', 'OPEN', 'CLOSED', 'DRAW_REQUESTED', 'SEED_RECEIVED', 'SETTLED', 'CANCELLED'] as const)[
                          g.status
                        ] as keyof typeof c.list.status
                      ] ?? ''
                    }
                  />
                  {identity ? (
                    <>
                      {/* Com identidade, o nome da campanha é o assunto da página e
                          passa a ser o h1; o prémio fica logo abaixo, com o mesmo peso
                          de cor. */}
                      <h1 className="mt-3 font-display font-bold text-white tracking-tight leading-[1.02] text-[clamp(2.1rem,7vw,3.25rem)] break-words">
                        {identity.name}
                      </h1>
                      <div className="mt-1">
                        <BrandByline identity={identity} by={c.detail.identity.byBrand} newTab={c.detail.identity.opensNewTab} />
                      </div>
                      <p className="mt-5 text-sm text-gray-400">{c.detail.prizeLabel}</p>
                      <p className="font-mono font-bold text-brand tracking-tighter leading-[0.95] tabular-nums text-[clamp(2.25rem,9vw,3.5rem)] break-all">
                        {amountShown}
                        <span className="block font-display text-xl tracking-wide text-gray-400">{symbol}</span>
                      </p>
                    </>
                  ) : (
                    <>
                      {/* O prémio é o assunto da página, por isso é o h1. A página
                          não tinha nenhum: começava em h3 e um leitor de ecrã não
                          tinha por onde se orientar. */}
                      <p className="mt-3 text-sm text-gray-400">{c.detail.prizeLabel}</p>
                      <h1 className="font-mono font-bold text-brand tracking-tighter leading-[0.95] tabular-nums text-[clamp(2.75rem,11vw,4.5rem)] break-all">
                        {amountShown}
                        <span className="block font-display text-xl tracking-wide text-gray-400">{symbol}</span>
                      </h1>
                    </>
                  )}
                </div>
                <ShareButton
                  className="shrink-0 text-gray-400 hover:text-white"
                  url={`${window.location.origin}/events/${giveawayId.toString()}`}
                />
              </div>

              {identity ? (
                <>
                  {/* A mensagem do criador, junto do prémio. */}
                  <figure className="mt-6 border-l border-dark-line pl-4">
                    <figcaption className="text-xs uppercase tracking-[0.14em] text-gray-400">
                      {c.detail.identity.messageFrom} {identity.brand}
                    </figcaption>
                    <blockquote className="mt-2 max-w-[62ch] whitespace-pre-line text-base leading-relaxed text-gray-200">
                      {identity.message}
                    </blockquote>
                  </figure>

                  {/* A prova fica, discreta: o endereço que o contrato regista. */}
                  <p className="mt-5 flex flex-wrap items-baseline gap-x-2 text-xs text-gray-400">
                    {c.detail.identity.creatorProof}
                    <a
                      href={`${ARBISCAN}/address/${g.creator}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-gray-400 underline decoration-dark-border underline-offset-4 hover:text-white hover:decoration-gray-500"
                    >
                      {short(g.creator)}
                    </a>
                  </p>
                </>
              ) : (
                /* Quem pagou o prémio tem nome, e o nome liga à prova. */
                <p className="mt-5 flex flex-wrap items-baseline gap-x-2 text-sm text-gray-400">
                  {c.detail.byCreator}
                  <a
                    href={`${ARBISCAN}/address/${g.creator}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-gray-300 underline decoration-dark-border underline-offset-4 hover:text-white hover:decoration-gray-500"
                  >
                    {short(g.creator)}
                  </a>
                </p>
              )}

              <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-gray-300">
                {c.detail.freeToEnter}
              </p>
              </div>
            </div>

            {/* Lugares e tempo: o que decide se ainda vale a pena entrar. */}
            <div className="iw-surface grid gap-4 sm:grid-cols-3 p-5">
              <div className="sm:col-span-2">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-gray-400">{c.detail.entriesLabel}</span>
                  <span className="font-mono text-sm text-white tabular-nums">
                    {taken !== null ? taken.toLocaleString('en-US') : '…'}
                    <span className="text-gray-400"> / {g.slotCap.toLocaleString('en-US')}</span>
                  </span>
                </p>
                <div aria-hidden="true" className="mt-3 h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={`iw-meter h-full rounded-full ${acceptsEntries ? 'bg-white/80' : 'bg-gray-600'}`}
                    style={{ transform: `scaleX(${filledPct / 100})` }}
                  />
                </div>
              </div>
              <div className="sm:border-l sm:border-dark-border sm:pl-5">
                {/* `null` é "ainda não sei", não "fechou": dizer que as entradas
                    fecharam enquanto a leitura não chegou seria mentir a quem
                    ainda podia entrar. */}
                <p className="text-sm text-gray-400">
                  {secondsLeft === null || secondsLeft > 0 ? c.detail.timeLeftLabel : c.detail.endedLabel}
                </p>
                <p className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
                  {secondsLeft === null ? '…' : secondsLeft > 0 ? formatWindow(secondsLeft) : '—'}
                </p>
                <p className="mt-3 text-sm text-gray-400">
                  {c.detail.winnersLabel}{' '}
                  <span className="font-mono text-white tabular-nums">{g.winnersCount}</span>
                </p>
              </div>
            </div>

            {/* ============ QUEM GANHOU ============ */}

            {g.status === GiveawayV2Status.SETTLED && (
              <div className="iw-surface p-5 sm:p-6">
                {/* O resultado do sorteio está provado on-chain: o selo desenha-se ao lado do título. */}
                <h2 className="flex items-center gap-2.5 font-display text-2xl font-bold tracking-tight text-white">
                  <ProofSeal className="h-5 w-5 text-success" />
                  {c.detail.previousWinners.title}
                </h2>
                {Array.isArray(winners) && winners.length > 0 ? (
                  <ol className="mt-4 divide-y divide-dark-border border-y border-dark-border">
                    {(winners as `0x${string}`[]).map((w, i) => {
                      // The one thing this list never did: tell you that one of
                      // these rows is you. A winner had to recognise their own
                      // address among strangers' to find out they had won.
                      const mine = isMine(w);
                      return (
                        <li
                          key={`${w}-${i}`}
                          style={{ ['--i' as string]: Math.min(i, 8) }}
                          className={`iw-rise flex flex-wrap items-center gap-x-3 gap-y-1 py-3 ${
                            mine ? '-mx-3 px-3 bg-brand/[0.07]' : ''
                          }`}
                        >
                          <span className="font-mono text-xs text-gray-400 tabular-nums w-5 shrink-0">
                            {i + 1}
                          </span>
                          <span
                            className={`font-mono text-sm break-all min-w-0 ${
                              mine ? 'text-brand' : 'text-gray-300'
                            }`}
                          >
                            {w}
                          </span>
                          {mine && (
                            <span className="shrink-0 rounded-full bg-brand px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
                              {c.detail.previousWinners.you}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-gray-400">{c.detail.previousWinners.empty}</p>
                )}
              </div>
            )}

            {/* ============ A SUA PARTICIPAÇÃO ============ */}

            {loggedIn && sessionChecked && (
              <OutcomePanel
                outcome={outcome}
                awaiting={awaitingOutcome}
                selfCustody={entryStatusResult?.selfCustody === true}
                passkey={entryStatusResult?.passkey === true}
                giveawayId={giveawayId}
                isVoucher={isNft && typeof g?.prizeToken === 'string' && keptraConfigured() && g.prizeToken.toLowerCase() === KEPTRA_VOUCHER.toLowerCase()}
              />
            )}

            <div className="iw-surface p-5 sm:p-7">
              <h2 className="font-display text-2xl font-bold tracking-tight text-white">
                {c.detail.yourEntry}
              </h2>

              <ol className="mt-6">
                <Step index={1} title={c.detail.steps.identity} done={loggedIn}>
                  <AccountPanel
                    giveawayId={giveawayId}
                    loggedIn={loggedIn}
                    email={email}
                    onLoggedIn={(e) => {
                      setEmail(e);
                      setLoggedIn(true);
                    }}
                    onSignedOut={() => {
                      setLoggedIn(false);
                      setEntryStatusResult(null);
                      setEmail(null);
                    }}
                  />
                </Step>

                <Step
                  index={2}
                  title={c.detail.steps.entry}
                  done={entryStep === 'CONFIRMED'}
                  last={!(loggedIn && sessionChecked && entryStatusResult?.custody && entryStatusResult.selfCustody !== true)}
                >
                  {loggedIn && sessionChecked ? (
                    <>
                      {/* Condição inalterada: o aviso de esgotado continua a
                          depender só de `acceptsEntries` e do estado OPEN. */}
                      {!acceptsEntries && g.status === GiveawayV2Status.OPEN && (
                        <div className="mb-4">
                          <Banner message={c.detail.participate.full} tone="notice" />
                        </div>
                      )}
                      <ParticipatePanel
                        giveawayId={giveawayId}
                        awaitingOutcome={awaitingOutcome}
                        onStatus={setEntryStatusResult}
                      />
                    </>
                  ) : (
                    <p className="text-sm text-gray-400">{c.detail.participate.intro}</p>
                  )}
                </Step>

                {loggedIn && sessionChecked && entryStatusResult?.custody && entryStatusResult.selfCustody !== true && (
                  <Step index={3} title={c.detail.steps.prize} done={entryStatusResult.custody.destinationConfirmed} last>
                    <PrizePanel giveawayId={giveawayId} custody={entryStatusResult.custody} />
                  </Step>
                )}
              </ol>
            </div>

            {/* ============ A PROVA ============ */}

            <div className="rounded-card border border-dark-border p-5 sm:p-6">
              <p className="max-w-[66ch] text-sm leading-relaxed text-gray-400">{c.detail.proofLine}</p>
              <a
                href={`${ARBISCAN}/address/${CONTRACTS.GIVEAWAY_MANAGER_V2}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-between gap-3 min-h-[44px] font-mono text-[11px] text-gray-400 hover:text-success transition-colors"
              >
                <span className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                  <span className="text-gray-400">{c.detail.contractLabel}</span>
                  <span className="break-all">{CONTRACTS.GIVEAWAY_MANAGER_V2}</span>
                </span>
                <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
              </a>
            </div>
          </>
        )}
      </div>
    </EventShell>
  );
};

/** The amount a campaign's page shows: the declared value of an NFT prize, the prize amount of a token one. */
function displayAmountOf(g: { declaredValue?: bigint; prizeAmount?: bigint } | undefined, isNft: boolean): bigint | undefined {
  return isNft ? g?.declaredValue : g?.prizeAmount;
}
