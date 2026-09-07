import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount, useReadContract, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2, ExternalLink, ShieldAlert } from 'lucide-react';
import { CONTRACTS } from '../constants';
import { GIVEAWAY_MANAGER_V2_ABI, ERC20_META_ABI, GiveawayV2Status, GiveawayV2PrizeKind } from '../lib/giveaway-v2-abi';
import { Button } from '../components/Button';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { LangSwitch } from '../components/LangSwitch';
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
  type EntryStatusResult,
} from '../lib/eventcenter';

const ARBISCAN = 'https://arbiscan.io';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const POLL_MS = 6000;

const ACTIVE_STATUSES = ['AWAITING_CONTACT', 'VERIFIED', 'ELIGIBLE', 'FUNDING', 'SUBMITTED'];

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

/** Login por email + código, e o painel de conta uma vez com sessão. */
function AccountPanel({
  loggedIn,
  email,
  onLoggedIn,
  onSignedOut,
}: {
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
    const res = await requestCode(emailInput.trim());
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
      <div className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-3">
        <p className="text-sm text-gray-400">
          {c.signedInAs} {email ? <span className="text-white font-mono">{email}</span> : null}
        </p>
        {notice && <p className="text-sm text-success">{notice}</p>}
        {error && <ErrorBanner message={error} />}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="text-sm px-4 py-2" onClick={signOut} isLoading={busy}>
            {c.signOut}
          </Button>
          <Button variant="outline" className="text-sm px-4 py-2" onClick={exportData} isLoading={busy}>
            {c.exportData}
          </Button>
          <Button variant="danger" className="text-sm px-4 py-2" onClick={eraseData} isLoading={busy}>
            {c.deleteData}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-4">
      <div>
        <h3 className="font-bold text-white mb-1">{c.loginTitle}</h3>
        <p className="text-sm text-gray-400">{c.loginBody}</p>
      </div>
      {error && <ErrorBanner message={error} />}
      {step === 'email' ? (
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder={c.emailPlaceholder}
            className="flex-1 min-h-[48px] rounded-lg border border-dark-border bg-dark-input px-4 text-white placeholder:text-gray-600"
          />
          <Button variant="primary" onClick={sendCode} isLoading={busy} className="sm:w-auto">
            {c.sendCode}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">{c.codeSentTitle}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              className="flex-1 min-h-[48px] rounded-lg border border-dark-border bg-dark-input px-4 text-white font-mono tracking-widest"
            />
            <Button variant="primary" onClick={verify} isLoading={busy} className="sm:w-auto">
              {c.verify}
            </Button>
          </div>
          <button type="button" onClick={sendCode} className="text-sm text-gray-500 hover:text-white underline">
            {c.resend}
          </button>
        </div>
      )}
    </div>
  );
}

function ParticipatePanel({ giveawayId, onStatus }: { giveawayId: bigint; onStatus: (s: EntryStatusResult) => void }) {
  const c = useEventsCopy().detail.participate;
  const [status, setStatus] = useState<EntryStatusResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);

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

  useEffect(() => {
    if (!status || !ACTIVE_STATUSES.includes(status.status)) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.status]);

  const enter = async () => {
    setError(null);
    setBusy(true);
    const res = await entryStart(giveawayId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
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

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-4">
      <h3 className="font-bold text-white">{c.title}</h3>
      {status.status === 'NONE' ? (
        <>
          <p className="text-sm text-gray-400">{c.intro}</p>
          {error && <ErrorBanner message={error} />}
          <Button variant="success" onClick={enter} isLoading={busy} className="w-full sm:w-auto">
            {c.ctaEnter}
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-300">{label[status.status] ?? status.status}</p>
          {status.status === 'AWAITING_CONTACT' && telegramUrl && (
            <a
              href={telegramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-lg bg-brand text-black font-extrabold"
            >
              {c.openTelegram}
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {status.txHash && (
            <a
              href={`${ARBISCAN}/tx/${status.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 rounded-lg border border-dark-border bg-black/40 px-4 py-3 font-mono text-xs text-success hover:border-success/40"
            >
              <span>{c.txLabel}: {status.txHash.slice(0, 10)}…{status.txHash.slice(-8)}</span>
              <ExternalLink className="w-4 h-4 shrink-0" />
            </a>
          )}
        </>
      )}
      <p className="text-xs text-gray-500 leading-relaxed">{c.walletGapNotice}</p>
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
    <div className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-4">
      <h3 className="font-bold text-white">{c.title}</h3>
      <p className="text-sm text-gray-400">{custody.requiresOwnWallet ? c.requiresOwnWallet : c.belowThreshold}</p>
      {!custody.requiresOwnWallet && custody.custodyExpiresAt && (
        <p className="text-xs text-gray-500">
          {c.expiresOn} {new Date(custody.custodyExpiresAt).toLocaleDateString()}
        </p>
      )}
      {error && <ErrorBanner message={error} />}
      {confirmed ? (
        <p className="text-sm text-success font-mono break-all">
          {c.confirmed} {proposed}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder={c.destinationPlaceholder}
              className="flex-1 min-h-[48px] rounded-lg border border-dark-border bg-dark-input px-4 text-white font-mono text-sm"
            />
            {address && (
              <button
                type="button"
                onClick={() => setAddr(address)}
                className="text-xs text-gray-500 hover:text-white underline whitespace-nowrap self-center"
              >
                {address.slice(0, 6)}…{address.slice(-4)}
              </button>
            )}
          </div>
          {proposed && proposed.toLowerCase() === addr.trim().toLowerCase() ? (
            <>
              <p className="text-xs text-gray-500">{c.confirmExplainer}</p>
              <Button variant="success" onClick={confirm} isLoading={busy} className="w-full sm:w-auto">
                {c.confirmCta}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={propose} isLoading={busy} className="w-full sm:w-auto">
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
    query: { enabled: giveawayId !== null },
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
  const decimals = isNft ? 6 : ((meta?.[0]?.result as number | undefined) ?? 18);
  const symbol = isNft ? 'USDC' : ((meta?.[1]?.result as string | undefined) ?? '?');
  const displayAmount = isNft ? g?.declaredValue : g?.prizeAmount;

  const { data: winners } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'getWinners',
    args: giveawayId !== null ? [giveawayId, 0n, BigInt(g?.winnersCount ?? 0)] : undefined,
    query: { enabled: giveawayId !== null && g?.status === GiveawayV2Status.SETTLED },
  });

  useEffect(() => {
    document.title = c.list.metaTitle;
  }, [c]);

  if (giveawayId === null) return <div className="min-h-screen bg-black" />;

  const acceptsEntries =
    g?.status === GiveawayV2Status.OPEN &&
    effectiveEndTime !== undefined &&
    BigInt(Math.floor(Date.now() / 1000)) < (effectiveEndTime as bigint) &&
    (slotsRemaining as bigint | undefined) !== undefined &&
    (slotsRemaining as bigint) > 0n;

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />

      <header className="sticky top-0 z-20 border-b border-dark-border/60 bg-black/70 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 min-h-[64px] flex items-center justify-between gap-3">
          <Link to="/events" className="text-sm text-gray-400 hover:text-white">
            {c.detail.back}
          </Link>
          <div className="flex items-center gap-3">
            <PublicNavLinks />
            <LangSwitch />
          </div>
        </div>
      </header>

      <main className="flex-1 relative z-10 container mx-auto px-4 sm:px-6 max-w-3xl py-10 space-y-6">
        {paused === true && <ErrorBanner message={c.detail.pausedBanner} />}

        {isLoading && (
          <div className="flex items-center gap-3 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" /> {c.detail.loading}
          </div>
        )}

        {!isLoading && (!g || g.status === GiveawayV2Status.NONE) && <ErrorBanner message={c.detail.notFound} />}

        {g && g.status !== GiveawayV2Status.NONE && (
          <>
            <div className="rounded-xl border border-dark-border bg-dark-card p-6 space-y-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500">#{giveawayId.toString()}</p>
              <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500">{c.detail.prizeLabel}</p>
              <p className="font-mono text-3xl font-bold text-brand break-all">
                {formatUnits(displayAmount ?? 0n, decimals)} {symbol}
              </p>
              <dl className="grid grid-cols-2 gap-4 pt-2">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{c.detail.winnersLabel}</dt>
                  <dd className="font-mono text-lg text-white">{g.winnersCount}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{c.detail.slotsLabel}</dt>
                  <dd className="font-mono text-lg text-white">
                    {slotsRemaining !== undefined ? (slotsRemaining as bigint).toString() : '…'}/{g.slotCap}
                  </dd>
                </div>
              </dl>
              <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500 pt-2">{c.detail.contractLabel}</p>
              <a
                href={`${ARBISCAN}/address/${CONTRACTS.GIVEAWAY_MANAGER_V2}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between gap-2 rounded-lg border border-dark-border bg-black/40 px-4 py-3 font-mono text-xs text-gray-300 hover:border-gray-600"
              >
                <span className="break-all">{CONTRACTS.GIVEAWAY_MANAGER_V2}</span>
                <ExternalLink className="w-4 h-4 shrink-0" />
              </a>
            </div>

            {g.status === GiveawayV2Status.SETTLED && (
              <div className="rounded-xl border border-dark-border bg-dark-card p-6">
                <h3 className="font-bold text-white mb-3">{c.detail.previousWinners.title}</h3>
                {Array.isArray(winners) && winners.length > 0 ? (
                  <ul className="space-y-1 font-mono text-sm text-gray-300">
                    {(winners as `0x${string}`[]).map((w, i) => (
                      <li key={`${w}-${i}`}>
                        #{i + 1} {w}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">{c.detail.previousWinners.empty}</p>
                )}
              </div>
            )}

            <AccountPanel
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

            {loggedIn && sessionChecked && (
              <>
                {!acceptsEntries && g.status === GiveawayV2Status.OPEN && (
                  <ErrorBanner message={c.detail.participate.full} />
                )}
                <ParticipatePanel giveawayId={giveawayId} onStatus={setEntryStatusResult} />
                {entryStatusResult?.custody && (
                  <PrizePanel giveawayId={giveawayId} custody={entryStatusResult.custody} />
                )}
              </>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-dark-border py-8 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4 space-y-4 text-center">
          <PublicFooterNav />
        </div>
      </footer>
    </div>
  );
};
