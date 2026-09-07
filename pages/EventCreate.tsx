import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAccount, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { encodeAbiParameters, formatUnits, parseEventLogs, parseUnits } from 'viem';
import { ShieldAlert, CheckCircle2 } from 'lucide-react';
import { CONTRACTS, USDC_ABI } from '../constants';
import {
  ERC20_META_ABI,
  ERC721_ABI,
  ERC1155_ABI,
  GIVEAWAY_MANAGER_V2_ABI,
  GiveawayV2PrizeKind,
} from '../lib/giveaway-v2-abi';
import { Button } from '../components/Button';
import { ConnectWallet } from '../components/ConnectWallet';
import { PublicNavLinks, PublicFooterNav } from '../components/PublicNav';
import { LangSwitch } from '../components/LangSwitch';
import { useEventsCopy } from './events.i18n';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

const inputClass =
  'w-full min-h-[48px] rounded-lg border border-dark-border bg-dark-input px-4 text-white placeholder:text-gray-600 focus:outline-none focus:border-gray-500';

/** Aprovação ERC-20 (approve por montante) — módulo de prémio ou núcleo, taxa ou slots. */
function Erc20Approval({
  token,
  spender,
  amountNeeded,
  label,
  doneLabel,
}: {
  token: `0x${string}`;
  spender: `0x${string}`;
  amountNeeded: bigint;
  label: string;
  doneLabel: string;
}) {
  const { address } = useAccount();
  const { data: allowance, refetch } = useReadContract({
    address: token,
    abi: USDC_ABI,
    functionName: 'allowance',
    args: address ? [address, spender] : undefined,
    query: { enabled: !!address },
  });
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) refetch();
  }, [isSuccess, refetch]);

  const done = amountNeeded === 0n || ((allowance as bigint | undefined) ?? 0n) >= amountNeeded;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dark-border bg-black/30 px-4 py-3">
      <span className="text-sm text-gray-300 flex items-center gap-2">
        {done && <CheckCircle2 className="w-4 h-4 text-success shrink-0" />}
        {done ? doneLabel : label}
      </span>
      {!done && (
        <Button
          variant="outline"
          className="text-sm px-4 py-2"
          isLoading={isPending || confirming}
          onClick={() => writeContract({ address: token, abi: USDC_ABI, functionName: 'approve', args: [spender, amountNeeded] })}
        >
          {label}
        </Button>
      )}
      {error && <span className="text-xs text-red-400">{error.message.slice(0, 80)}</span>}
    </div>
  );
}

/** Aprovação ERC-721/1155 (setApprovalForAll) — o módulo de prémio puxa os itens. */
function NftApproval({
  collection,
  abi,
  operator,
  label,
  doneLabel,
}: {
  collection: `0x${string}`;
  abi: typeof ERC721_ABI | typeof ERC1155_ABI;
  operator: `0x${string}`;
  label: string;
  doneLabel: string;
}) {
  const { address } = useAccount();
  const { data: approved, refetch } = useReadContract({
    address: collection,
    abi,
    functionName: 'isApprovedForAll',
    args: address ? [address, operator] : undefined,
    query: { enabled: !!address && ADDRESS_RE.test(collection) },
  });
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) refetch();
  }, [isSuccess, refetch]);

  const done = approved === true;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dark-border bg-black/30 px-4 py-3">
      <span className="text-sm text-gray-300 flex items-center gap-2">
        {done && <CheckCircle2 className="w-4 h-4 text-success shrink-0" />}
        {done ? doneLabel : label}
      </span>
      {!done && (
        <Button
          variant="outline"
          className="text-sm px-4 py-2"
          isLoading={isPending || confirming}
          onClick={() => writeContract({ address: collection, abi, functionName: 'setApprovalForAll', args: [operator, true] })}
        >
          {label}
        </Button>
      )}
      {error && <span className="text-xs text-red-400">{error.message.slice(0, 80)}</span>}
    </div>
  );
}

type PrizeType = 'token' | 'erc721' | 'erc1155';

export const EventCreate: React.FC = () => {
  const copy = useEventsCopy();
  const c = copy.create;
  const { isConnected } = useAccount();
  const navigate = useNavigate();

  const [prizeType, setPrizeType] = useState<PrizeType>('token');
  const [tokenAddress, setTokenAddress] = useState<string>(CONTRACTS.USDC);
  const [amount, setAmount] = useState('1000');
  const [collection, setCollection] = useState('');
  const [tokenIds, setTokenIds] = useState('');
  const [items, setItems] = useState<{ id: string; amount: string }[]>([{ id: '', amount: '1' }]);
  const [declaredValue, setDeclaredValue] = useState('100');
  const [winnersInput, setWinnersInput] = useState('10');
  const [durationValue, setDurationValue] = useState('7');
  const [durationUnit, setDurationUnit] = useState<'hours' | 'days'>('days');
  const [slotCap, setSlotCap] = useState('50000');

  useEffect(() => {
    document.title = c.metaTitle;
  }, [c]);

  const module =
    prizeType === 'token'
      ? CONTRACTS.ERC20_PRIZE_MODULE
      : prizeType === 'erc721'
        ? CONTRACTS.ERC721_PRIZE_MODULE
        : CONTRACTS.ERC1155_PRIZE_MODULE;

  const { data: paused } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'paused',
  });

  const { data: moduleRegistered } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'isModuleRegistered',
    args: [module],
  });

  const { data: limits } = useReadContracts({
    contracts: [
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'MIN_DURATION' },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'MAX_DURATION' },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'MIN_PARTICIPANTS' },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'MAX_PARTICIPANTS' },
      { address: CONTRACTS.GIVEAWAY_MANAGER_V2, abi: GIVEAWAY_MANAGER_V2_ABI, functionName: 'MAX_WINNERS' },
    ],
  });
  const [minDuration, maxDuration, minParticipants, maxParticipants, maxWinners] = (limits ?? []).map(
    (r) => r?.result as bigint | undefined,
  );

  const isNft = prizeType !== 'token';
  const tokenAddr = (ADDRESS_RE.test(tokenAddress.trim()) ? tokenAddress.trim() : CONTRACTS.USDC) as `0x${string}`;
  const collectionAddr = (ADDRESS_RE.test(collection.trim()) ? collection.trim() : '0x0000000000000000000000000000000000000000') as `0x${string}`;

  const { data: tokenDecimalsData } = useReadContract({
    address: tokenAddr,
    abi: ERC20_META_ABI,
    functionName: 'decimals',
    query: { enabled: prizeType === 'token' },
  });
  const tokenDecimals = prizeType === 'token' ? ((tokenDecimalsData as number | undefined) ?? 6) : 6;

  const prizeAmountUnits = useMemo(() => {
    try {
      if (prizeType === 'token') return parseUnits(amount || '0', tokenDecimals);
      if (prizeType === 'erc721') {
        return BigInt(
          tokenIds
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean).length,
        );
      }
      return items.reduce((sum, it) => sum + (BigInt(it.amount || '0') || 0n), 0n);
    } catch {
      return 0n;
    }
  }, [prizeType, amount, tokenDecimals, tokenIds, items]);

  const declaredValueUnits = isNft ? parseUnits(declaredValue || '0', 6) : 0n;
  const winnersCount = isNft ? Number(prizeAmountUnits) : Number(winnersInput) || 0;

  const durationSeconds = useMemo(() => {
    const n = Number(durationValue);
    if (!Number.isFinite(n) || n <= 0) return 0n;
    const hours = durationUnit === 'days' ? n * 24 : n;
    return BigInt(Math.round(hours * 3600));
  }, [durationValue, durationUnit]);

  const slotCapNum = Number(slotCap) || 0;

  const { data: currentFee } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'currentFee',
    args: [isNft ? GiveawayV2PrizeKind.NFT : GiveawayV2PrizeKind.TOKEN, isNft ? declaredValueUnits : prizeAmountUnits],
    query: { enabled: prizeAmountUnits > 0n || declaredValueUnits > 0n },
  });

  const { data: slotCost } = useReadContract({
    address: CONTRACTS.GIVEAWAY_MANAGER_V2,
    abi: GIVEAWAY_MANAGER_V2_ABI,
    functionName: 'currentSlotCost',
    args: [BigInt(slotCapNum)],
    query: { enabled: slotCapNum > 0 },
  });

  const fee = (currentFee as bigint | undefined) ?? 0n;
  const slots = (slotCost as bigint | undefined) ?? 0n;
  const feeTokenIsUsdc = isNft || tokenAddr.toLowerCase() === (CONTRACTS.USDC as string).toLowerCase();

  const prizeData = useMemo(() => {
    try {
      if (prizeType === 'token') {
        return encodeAbiParameters(
          [{ type: 'address' }, { type: 'uint256' }],
          [tokenAddr, prizeAmountUnits],
        );
      }
      if (prizeType === 'erc721') {
        const ids = tokenIds
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
          .map((v) => BigInt(v));
        return encodeAbiParameters([{ type: 'address' }, { type: 'uint256[]' }], [collectionAddr, ids]);
      }
      const ids = items.map((it) => BigInt(it.id || '0'));
      const amounts = items.map((it) => BigInt(it.amount || '0'));
      return encodeAbiParameters(
        [{ type: 'address' }, { type: 'uint256[]' }, { type: 'uint256[]' }],
        [collectionAddr, ids, amounts],
      );
    } catch {
      return '0x' as `0x${string}`;
    }
  }, [prizeType, tokenAddr, prizeAmountUnits, tokenIds, collectionAddr, items]);

  const { writeContract, data: hash, isPending, error: writeError } = useWriteContract();
  const { data: receipt, isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  const createdId = useMemo(() => {
    if (!receipt) return null;
    try {
      const [event] = parseEventLogs({ abi: GIVEAWAY_MANAGER_V2_ABI, eventName: 'GiveawayCreated', logs: receipt.logs });
      return (event?.args as { giveawayId?: bigint } | undefined)?.giveawayId ?? null;
    } catch {
      return null;
    }
  }, [receipt]);

  useEffect(() => {
    if (createdId !== null) navigate(`/events/${createdId.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdId]);

  const canSubmit =
    isConnected &&
    paused === false &&
    moduleRegistered === true &&
    prizeAmountUnits > 0n &&
    durationSeconds > 0n &&
    slotCapNum > 0 &&
    winnersCount > 0 &&
    (!isNft || declaredValueUnits > 0n);

  const create = () => {
    writeContract({
      address: CONTRACTS.GIVEAWAY_MANAGER_V2,
      abi: GIVEAWAY_MANAGER_V2_ABI,
      functionName: 'createGiveaway',
      args: [module, prizeData, prizeAmountUnits, declaredValueUnits, durationSeconds, winnersCount, slotCapNum],
    });
  };

  return (
    <div className="min-h-screen bg-black text-white font-sans flex flex-col overflow-x-hidden">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] bg-action/10 rounded-full blur-[120px] pointer-events-none z-0" />

      <header className="sticky top-0 z-20 border-b border-dark-border/60 bg-black/70 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 min-h-[64px] flex items-center justify-between gap-3">
          <Link to="/events" className="text-sm text-gray-400 hover:text-white">
            ← {copy.nav.link}
          </Link>
          <div className="flex items-center gap-3">
            <PublicNavLinks />
            <LangSwitch />
            <ConnectWallet />
          </div>
        </div>
      </header>

      <main className="flex-1 relative z-10 container mx-auto px-4 sm:px-6 max-w-2xl py-10 space-y-6">
        <div>
          <h1 className="font-display font-bold text-3xl sm:text-4xl mb-2">{c.title}</h1>
          <p className="text-gray-400 leading-relaxed">{c.intro}</p>
        </div>

        {!isConnected && <ErrorBanner message={c.connectPrompt} />}
        {paused === true && <ErrorBanner message={c.pausedBanner} />}
        {moduleRegistered === false && <ErrorBanner message={c.moduleNotRegistered} />}

        {isConnected && (
          <>
            <div className="space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500">{c.prizeType.label}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['token', 'erc721', 'erc1155'] as PrizeType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPrizeType(t)}
                    className={`min-h-[44px] rounded-lg border px-3 text-sm font-bold ${
                      prizeType === t ? 'border-gray-400 bg-white/[0.04] text-white' : 'border-dark-border text-gray-400'
                    }`}
                  >
                    {t === 'token' ? c.prizeType.token : t === 'erc721' ? c.prizeType.nft721 : c.prizeType.nft1155}
                  </button>
                ))}
              </div>
            </div>

            {prizeType === 'token' && (
              <div className="space-y-3">
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.token.addressLabel}</label>
                  <input value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} className={`${inputClass} font-mono text-sm`} />
                  <p className="mt-2 text-sm text-gray-500">{c.token.addressHint}</p>
                </div>
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.token.amountLabel}</label>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${inputClass} font-mono text-lg`} />
                </div>
              </div>
            )}

            {prizeType === 'erc721' && (
              <div className="space-y-3">
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.nft721.collectionLabel}</label>
                  <input value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="0x…" className={`${inputClass} font-mono text-sm`} />
                </div>
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.nft721.idsLabel}</label>
                  <textarea rows={4} value={tokenIds} onChange={(e) => setTokenIds(e.target.value)} className={`${inputClass} font-mono text-sm py-3`} />
                  <p className="mt-2 text-sm text-gray-500">{c.nft721.idsHint}</p>
                </div>
              </div>
            )}

            {prizeType === 'erc1155' && (
              <div className="space-y-3">
                <div>
                  <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.nft1155.collectionLabel}</label>
                  <input value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="0x…" className={`${inputClass} font-mono text-sm`} />
                </div>
                <div className="space-y-2">
                  <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500">{c.nft1155.itemsLabel}</label>
                  {items.map((it, i) => (
                    <div key={i} className="flex gap-2">
                      <input
                        placeholder={c.nft1155.idLabel}
                        value={it.id}
                        onChange={(e) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
                        className={`${inputClass} font-mono text-sm`}
                      />
                      <input
                        placeholder={c.nft1155.amountLabel}
                        value={it.amount}
                        onChange={(e) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                        className={`${inputClass} font-mono text-sm w-32`}
                      />
                      {items.length > 1 && (
                        <button type="button" onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))} className="text-gray-500 hover:text-white px-2">
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={() => setItems((arr) => [...arr, { id: '', amount: '1' }])} className="text-sm text-gray-400 hover:text-white underline">
                    {c.nft1155.addRow}
                  </button>
                  <p className="text-sm text-gray-500">{c.nft1155.itemsHint}</p>
                </div>
              </div>
            )}

            {isNft && (
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.declaredValueLabel}</label>
                <input value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} inputMode="decimal" className={`${inputClass} font-mono text-lg`} />
                <p className="mt-2 text-sm text-gray-500">{c.declaredValueHint}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.durationLabel}</label>
                <div className="flex gap-3">
                  <input value={durationValue} onChange={(e) => setDurationValue(e.target.value)} inputMode="numeric" className={`${inputClass} font-mono flex-1`} />
                  <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as 'hours' | 'days')} className={`${inputClass} w-28`}>
                    <option value="hours">{c.durationHours}</option>
                    <option value="days">{c.durationDays}</option>
                  </select>
                </div>
                {minDuration !== undefined && maxDuration !== undefined && (
                  <p className="mt-1 text-xs text-gray-500">
                    {Number(minDuration) / 3600}–{Number(maxDuration) / 3600}h
                  </p>
                )}
              </div>
              <div>
                <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.slotCapLabel}</label>
                <input value={slotCap} onChange={(e) => setSlotCap(e.target.value)} inputMode="numeric" className={`${inputClass} font-mono`} />
                {minParticipants !== undefined && maxParticipants !== undefined && (
                  <p className="mt-1 text-xs text-gray-500">
                    {minParticipants.toString()}–{maxParticipants.toString()}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block font-mono text-[11px] uppercase tracking-widest text-gray-500 mb-2">{c.winnersLabel}</label>
              {isNft ? (
                <>
                  <p className="font-mono text-lg text-white">{winnersCount || '—'}</p>
                  <p className="text-sm text-gray-500">{c.winnersAutoNft}</p>
                </>
              ) : (
                <input value={winnersInput} onChange={(e) => setWinnersInput(e.target.value)} inputMode="numeric" className={`${inputClass} font-mono text-lg`} />
              )}
              {maxWinners !== undefined && winnersCount > Number(maxWinners) && (
                <ErrorBanner message={`${c.winnersLabel} > ${maxWinners.toString()}`} />
              )}
            </div>

            <div className="rounded-xl border border-dark-border bg-black/30 p-4 space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-widest text-gray-500">{c.costTitle}</p>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{c.costFee}</span>
                <span className="font-mono text-white">
                  {formatUnits(fee, isNft ? 6 : tokenDecimals)} {isNft ? 'USDC' : ''}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{c.costSlots}</span>
                <span className="font-mono text-white">{formatUnits(slots, 6)} USDC</span>
              </div>
            </div>

            <div className="space-y-3">
              {prizeType === 'token' && (
                <Erc20Approval
                  token={tokenAddr}
                  spender={CONTRACTS.ERC20_PRIZE_MODULE}
                  amountNeeded={prizeAmountUnits}
                  label={c.approveModuleCta}
                  doneLabel={c.approveModuleDone}
                />
              )}
              {prizeType === 'erc721' && ADDRESS_RE.test(collection.trim()) && (
                <NftApproval
                  collection={collectionAddr}
                  abi={ERC721_ABI}
                  operator={CONTRACTS.ERC721_PRIZE_MODULE}
                  label={c.approveModuleCta}
                  doneLabel={c.approveModuleDone}
                />
              )}
              {prizeType === 'erc1155' && ADDRESS_RE.test(collection.trim()) && (
                <NftApproval
                  collection={collectionAddr}
                  abi={ERC1155_ABI}
                  operator={CONTRACTS.ERC1155_PRIZE_MODULE}
                  label={c.approveModuleCta}
                  doneLabel={c.approveModuleDone}
                />
              )}

              {feeTokenIsUsdc ? (
                <Erc20Approval
                  token={CONTRACTS.USDC}
                  spender={CONTRACTS.GIVEAWAY_MANAGER_V2}
                  amountNeeded={fee + slots}
                  label={c.approveFeeCta}
                  doneLabel={c.approveFeeDone}
                />
              ) : (
                <>
                  <Erc20Approval
                    token={tokenAddr}
                    spender={CONTRACTS.GIVEAWAY_MANAGER_V2}
                    amountNeeded={fee}
                    label={c.approveFeeCta}
                    doneLabel={c.approveFeeDone}
                  />
                  <Erc20Approval
                    token={CONTRACTS.USDC}
                    spender={CONTRACTS.GIVEAWAY_MANAGER_V2}
                    amountNeeded={slots}
                    label={c.approveSlotsCta}
                    doneLabel={c.approveSlotsDone}
                  />
                </>
              )}
            </div>

            {writeError && <ErrorBanner message={writeError.message.slice(0, 200)} />}
            {isSuccess && !createdId && <p className="text-sm text-success">{c.success}</p>}

            <Button variant="success" className="w-full py-4" disabled={!canSubmit} isLoading={isPending || confirming} onClick={create}>
              {isPending || confirming ? c.submitting : c.submitCta}
            </Button>
          </>
        )}
      </main>

      <footer className="border-t border-dark-border py-8 bg-black/80 backdrop-blur-sm relative z-10">
        <div className="container mx-auto px-4 text-center">
          <PublicFooterNav />
        </div>
      </footer>
    </div>
  );
};
