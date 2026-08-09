import React, { useState } from 'react';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { formatUnits } from 'viem';
import {
  CONTRACTS,
  USERNAME_ABI,
  RAFFLE_DEPLOY_BLOCK,
  PRIZE_AWARDED_EVENT,
} from '../constants';
import { Button } from './Button';
import { Share2, Check, ExternalLink } from 'lucide-react';
import { useAppCopy } from '../pages/app.i18n';

const LOG_CHUNK = 9_000n;
const MAX_CHUNKS = 30;
const ARBISCAN_TX = 'https://arbiscan.io/tx/';
const SITE = 'https://instntwin.com';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Recibo de vitória. Aparece quando há prémio por reclamar ou quando um claim
 * acabou de confirmar. Deliberadamente sem animação: é um comprovativo, não uma
 * máquina de casino. Âmbar só no valor; verde só na prova on-chain.
 */
export const WinCard: React.FC<{
  /** Fallback quando não se encontra o evento (ex.: fatia dev, ou log fora da janela). */
  fallbackAmount: bigint;
  /** Hash do claim acabado de confirmar, se existir. */
  claimTxHash?: `0x${string}`;
}> = ({ fallbackAmount, claimTxHash }) => {
  const { address } = useAccount();
  const client = usePublicClient();
  const [copied, setCopied] = useState(false);
  const c = useAppCopy();
  const rankLabel: Record<number, string> = {
    1: c.winCard.firstPlace,
    2: c.winCard.secondPlace,
    3: c.winCard.thirdPlace,
  };

  const { data: username } = useReadContract({
    address: CONTRACTS.USERNAME_REGISTRY,
    abi: USERNAME_ABI,
    functionName: 'walletToUsername',
    args: address ? [address] : undefined,
    query: { enabled: !!address, staleTime: 300_000 },
  });

  // Procura o PrizeAwarded mais recente desta wallet. `winner` é indexado, por
  // isso o filtro é feito pelo nó e não por nós.
  const { data: win } = useQuery({
    queryKey: ['myPrize', address],
    enabled: !!client && !!address,
    retry: 2,
    staleTime: 60_000,
    queryFn: async () => {
      const latest = await client!.getBlockNumber();
      let to = latest;

      for (let i = 0; i < MAX_CHUNKS && to >= RAFFLE_DEPLOY_BLOCK; i++) {
        const candidate = to > LOG_CHUNK ? to - LOG_CHUNK + 1n : 0n;
        const from = candidate > RAFFLE_DEPLOY_BLOCK ? candidate : RAFFLE_DEPLOY_BLOCK;

        const logs = await client!.getLogs({
          address: CONTRACTS.RAFFLE_MANAGER,
          event: PRIZE_AWARDED_EVENT,
          args: { winner: address },
          fromBlock: from,
          toBlock: to,
        });

        if (logs.length > 0) {
          const l = logs[logs.length - 1];
          return {
            roundId: l.args.roundId as bigint,
            rank: Number(l.args.rank),
            amount: l.args.amount as bigint,
            txHash: l.transactionHash as `0x${string}`,
          };
        }

        if (from <= RAFFLE_DEPLOY_BLOCK) break;
        to = from - 1n;
      }
      return null;
    },
  });

  const amount = win?.amount ?? fallbackAmount;
  const proofTx = claimTxHash ?? win?.txHash;
  const name = username && (username as string).length > 0 ? `@${username}` : address ? short(address) : '';

  const shareText = `${c.winCard.sharePre} ${formatUnits(amount, 6)} ${c.winCard.sharePost} ${SITE}`;

  const handleShare = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ text: shareText });
        return;
      }
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* utilizador cancelou a partilha, ou clipboard indisponível: sem estado de erro */
    }
  };

  return (
    <div className="bg-dark-input border border-dark-border rounded-xl p-5 mb-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="font-mono text-sm text-white truncate">{name}</p>
        {win?.rank ? (
          <span className="font-mono text-[10px] uppercase tracking-widest text-gray-400 border border-gray-700 rounded px-2 py-0.5 shrink-0">
            {rankLabel[win.rank] ?? `#${win.rank}`}
          </span>
        ) : null}
      </div>

      <p className="font-mono text-4xl sm:text-5xl font-bold text-brand tabular-nums leading-none">
        {formatUnits(amount, 6)}
        <span className="ml-2 font-sans text-base text-gray-600 font-normal">USDC</span>
      </p>

      {win?.roundId !== undefined && (
        <p className="font-mono text-[11px] text-gray-500 mt-2">{c.winCard.round} {win.roundId.toString()}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-dark-border pt-3">
        <span className="flex items-center gap-2 font-mono text-[11px] text-success uppercase tracking-widest">
          <Check className="w-4 h-4 shrink-0" strokeWidth={3} /> {c.winCard.verified}
        </span>
        {proofTx && (
          <a
            href={`${ARBISCAN_TX}${proofTx}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={c.winCard.ariaViewTx}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] -mr-2 text-gray-400 hover:text-white transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>

      <Button
        variant="outline"
        className="w-full min-h-[44px] mt-3"
        onClick={handleShare}
      >
        {copied ? (
          <>
            <Check className="w-4 h-4" /> {c.winCard.copied}
          </>
        ) : (
          <>
            <Share2 className="w-4 h-4" /> {c.winCard.share}
          </>
        )}
      </Button>
    </div>
  );
};
