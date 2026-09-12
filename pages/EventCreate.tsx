import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAccount, useReadContract, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { encodeAbiParameters, formatUnits, parseEventLogs, parseUnits } from 'viem';
import { CheckCircle2 } from 'lucide-react';
import { CONTRACTS, USDC_ABI } from '../constants';
import {
  ERC20_META_ABI,
  ERC721_ABI,
  ERC1155_ABI,
  GIVEAWAY_MANAGER_V2_ABI,
  GiveawayV2PrizeKind,
} from '../lib/giveaway-v2-abi';
import { Button } from '../components/Button';
import { Banner } from '../components/Banner';
import { EventShell } from '../components/EventShell';
import { Step } from '../components/Step';
import { useEventsCopy } from './events.i18n';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

const inputClass =
  'w-full min-h-[52px] rounded-xl border border-dark-border bg-dark-input px-4 text-white placeholder:text-gray-400 focus:border-gray-500';

const labelClass = 'block text-sm text-gray-400 mb-2';

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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dark-border px-4 py-3">
      <span className="flex items-center gap-2 min-w-0 text-sm text-gray-300">
        {done && <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />}
        {done ? doneLabel : label}
      </span>
      {!done && (
        <Button
          variant="outline"
          className="shrink-0 px-4 py-2 text-sm"
          isLoading={isPending || confirming}
          onClick={() => writeContract({ address: token, abi: USDC_ABI, functionName: 'approve', args: [spender, amountNeeded] })}
        >
          {label}
        </Button>
      )}
      {error && <span className="w-full text-xs text-red-400">{error.message.slice(0, 80)}</span>}
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dark-border px-4 py-3">
      <span className="flex items-center gap-2 min-w-0 text-sm text-gray-300">
        {done && <CheckCircle2 className="w-4 h-4 text-success shrink-0" aria-hidden="true" />}
        {done ? doneLabel : label}
      </span>
      {!done && (
        <Button
          variant="outline"
          className="shrink-0 px-4 py-2 text-sm"
          isLoading={isPending || confirming}
          onClick={() => writeContract({ address: collection, abi, functionName: 'setApprovalForAll', args: [operator, true] })}
        >
          {label}
        </Button>
      )}
      {error && <span className="w-full text-xs text-red-400">{error.message.slice(0, 80)}</span>}
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

  /*
   * Estado visual das etapas, derivado do que já está calculado acima. Nenhuma
   * destas expressões entra em `canSubmit` nem em nada que assine: servem só
   * para o marcador da etapa fechar em verde quando ela está preenchida.
   */
  const prizeStageDone = prizeAmountUnits > 0n && (!isNft || declaredValueUnits > 0n);
  const rulesStageDone = durationSeconds > 0n && slotCapNum > 0 && winnersCount > 0;

  return (
    <EventShell width="narrow" back={{ to: '/events', label: copy.nav.link }} wallet>
      <h1 className="font-display font-bold text-[clamp(2.1rem,6vw,3rem)] leading-tight tracking-tight">
        {c.title}
      </h1>
      <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-gray-400">{c.intro}</p>

      <div className="mt-8 space-y-3">
        {!isConnected && <Banner message={c.connectPrompt} tone="notice" />}
        {paused === true && <Banner message={c.pausedBanner} tone="notice" />}
        {moduleRegistered === false && <Banner message={c.moduleNotRegistered} />}
      </div>

      {isConnected && (
        <ol className="mt-10">

          {/* ============ 1. O PRÉMIO ============ */}
          <Step index={1} title={c.stages.prize} done={prizeStageDone} headingLevel={2}>
            <div className="space-y-5">
              <div>
                <p className={labelClass}>{c.prizeType.label}</p>
                <div className="grid grid-cols-3 gap-2">
                  {(['token', 'erc721', 'erc1155'] as PrizeType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPrizeType(t)}
                      aria-pressed={prizeType === t}
                      className={`min-h-[48px] rounded-lg border px-3 text-sm transition-colors ${
                        prizeType === t
                          ? 'border-gray-400 bg-white/[0.05] font-bold text-white'
                          : 'border-dark-border text-gray-400 hover:text-white'
                      }`}
                    >
                      {t === 'token' ? c.prizeType.token : t === 'erc721' ? c.prizeType.nft721 : c.prizeType.nft1155}
                    </button>
                  ))}
                </div>
              </div>

              {prizeType === 'token' && (
                <>
                  <div>
                    <label className={labelClass} htmlFor="token-address">{c.token.addressLabel}</label>
                    <input id="token-address" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} className={`${inputClass} font-mono text-sm`} />
                    <p className="mt-2 text-xs text-gray-400">{c.token.addressHint}</p>
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="token-amount">{c.token.amountLabel}</label>
                    <input id="token-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={`${inputClass} font-mono text-2xl tabular-nums`} />
                  </div>
                </>
              )}

              {prizeType === 'erc721' && (
                <>
                  <div>
                    <label className={labelClass} htmlFor="c721">{c.nft721.collectionLabel}</label>
                    <input id="c721" value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="0x…" className={`${inputClass} font-mono text-sm`} />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="ids721">{c.nft721.idsLabel}</label>
                    <textarea id="ids721" rows={4} value={tokenIds} onChange={(e) => setTokenIds(e.target.value)} className={`${inputClass} font-mono text-sm py-3`} />
                    <p className="mt-2 text-xs text-gray-400">{c.nft721.idsHint}</p>
                  </div>
                </>
              )}

              {prizeType === 'erc1155' && (
                <>
                  <div>
                    <label className={labelClass} htmlFor="c1155">{c.nft1155.collectionLabel}</label>
                    <input id="c1155" value={collection} onChange={(e) => setCollection(e.target.value)} placeholder="0x…" className={`${inputClass} font-mono text-sm`} />
                  </div>
                  <div>
                    <p className={labelClass}>{c.nft1155.itemsLabel}</p>
                    <div className="space-y-2">
                      {items.map((it, i) => (
                        <div key={i} className="flex gap-2">
                          <input
                            placeholder={c.nft1155.idLabel}
                            aria-label={c.nft1155.idLabel}
                            value={it.id}
                            onChange={(e) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
                            className={`${inputClass} font-mono text-sm`}
                          />
                          <input
                            placeholder={c.nft1155.amountLabel}
                            aria-label={c.nft1155.amountLabel}
                            value={it.amount}
                            onChange={(e) => setItems((arr) => arr.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                            className={`${inputClass} font-mono text-sm !w-28 shrink-0`}
                          />
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setItems((arr) => arr.filter((_, j) => j !== i))}
                              aria-label={c.nft1155.removeRow}
                              className="shrink-0 min-w-[44px] text-gray-400 hover:text-white"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => setItems((arr) => [...arr, { id: '', amount: '1' }])} className="mt-2 min-h-[44px] text-sm text-gray-400 hover:text-white underline underline-offset-2">
                      {c.nft1155.addRow}
                    </button>
                    <p className="mt-1 text-xs text-gray-400">{c.nft1155.itemsHint}</p>
                  </div>
                </>
              )}

              {isNft && (
                <div>
                  <label className={labelClass} htmlFor="declared">{c.declaredValueLabel}</label>
                  <input id="declared" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} inputMode="decimal" className={`${inputClass} font-mono text-2xl tabular-nums`} />
                  <p className="mt-2 max-w-[58ch] text-xs leading-relaxed text-gray-400">{c.declaredValueHint}</p>
                </div>
              )}
            </div>
          </Step>

          {/* ============ 2. AS REGRAS ============ */}
          <Step index={2} title={c.stages.rules} done={rulesStageDone} headingLevel={2}>
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass} htmlFor="duration">{c.durationLabel}</label>
                  <div className="flex gap-2">
                    <input id="duration" value={durationValue} onChange={(e) => setDurationValue(e.target.value)} inputMode="numeric" className={`${inputClass} font-mono flex-1 min-w-0 tabular-nums`} />
                    <select
                      value={durationUnit}
                      onChange={(e) => setDurationUnit(e.target.value as 'hours' | 'days')}
                      aria-label={c.durationLabel}
                      className={`${inputClass} !w-28 shrink-0`}
                    >
                      <option value="hours">{c.durationHours}</option>
                      <option value="days">{c.durationDays}</option>
                    </select>
                  </div>
                  {minDuration !== undefined && maxDuration !== undefined && (
                    <p className="mt-2 font-mono text-xs text-gray-400 tabular-nums">
                      {Number(minDuration) / 3600}–{Number(maxDuration) / 3600}h
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelClass} htmlFor="slotcap">{c.slotCapLabel}</label>
                  <input id="slotcap" value={slotCap} onChange={(e) => setSlotCap(e.target.value)} inputMode="numeric" className={`${inputClass} font-mono tabular-nums`} />
                  {minParticipants !== undefined && maxParticipants !== undefined && (
                    <p className="mt-2 font-mono text-xs text-gray-400 tabular-nums">
                      {minParticipants.toString()}–{maxParticipants.toString()}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="winners">{c.winnersLabel}</label>
                {isNft ? (
                  <>
                    <p className="font-mono text-2xl text-white tabular-nums">{winnersCount || '—'}</p>
                    <p className="mt-1 text-xs text-gray-400">{c.winnersAutoNft}</p>
                  </>
                ) : (
                  <input id="winners" value={winnersInput} onChange={(e) => setWinnersInput(e.target.value)} inputMode="numeric" className={`${inputClass} font-mono text-2xl tabular-nums`} />
                )}
                {maxWinners !== undefined && winnersCount > Number(maxWinners) && (
                  <div className="mt-3">
                    <Banner message={`${c.winnersLabel} > ${maxWinners.toString()}`} />
                  </div>
                )}
              </div>

              <p className="max-w-[58ch] text-xs leading-relaxed text-gray-400">{c.slotCapHint}</p>
            </div>
          </Step>

          {/* ============ 3. FINANCIAR E LANÇAR ============ */}
          <Step index={3} title={c.stages.funding} headingLevel={2} last>
            <div className="space-y-5">
              <dl className="rounded-xl border border-dark-border bg-dark-card p-4">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-gray-400">{c.costFee}</dt>
                  <dd className="font-mono text-white tabular-nums">
                    {formatUnits(fee, isNft ? 6 : tokenDecimals)} {isNft ? 'USDC' : ''}
                  </dd>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
                  <dt className="text-gray-400">{c.costSlots}</dt>
                  <dd className="font-mono text-white tabular-nums">{formatUnits(slots, 6)} USDC</dd>
                </div>
                {feeTokenIsUsdc && (
                  <div className="mt-3 pt-3 border-t border-dark-border flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-gray-300">{c.costTotal}</dt>
                    <dd className="font-mono text-lg font-bold text-brand tabular-nums">
                      {formatUnits(fee + slots, 6)} USDC
                    </dd>
                  </div>
                )}
              </dl>

              <div className="space-y-2">
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

              {writeError && <Banner message={writeError.message.slice(0, 200)} />}
              {isSuccess && !createdId && <Banner message={c.success} tone="success" />}

              <Button
                variant="connect"
                className="w-full min-h-[56px] rounded-xl text-base"
                disabled={!canSubmit}
                isLoading={isPending || confirming}
                onClick={create}
              >
                {isPending || confirming ? c.submitting : c.submitCta}
              </Button>
            </div>
          </Step>
        </ol>
      )}
    </EventShell>
  );
};
