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
import { ProofSeal } from './Proof';
import { useAppCopy } from '../pages/app.i18n';
import { CountUp } from './proof/CountUp';
import { ProofMark } from './proof/ProofMark';
import { MoneyPath } from './proof/MoneyPath';
import { useFirstSight } from './proof/DrawReveal';
import { shortProof } from '../lib/proof/mark';

const LOG_CHUNK = 9_000n;
const MAX_CHUNKS = 30;
const ARBISCAN_TX = 'https://arbiscan.io/tx/';
// SPEC-BLOCO-03 T9: the app is at keptra.io.
const SITE = 'https://keptra.io';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Recibo de vitória. Aparece quando há prémio por reclamar ou quando um claim
 * acabou de confirmar. Celebra-se a prova, não a sorte: a primeira vez que este
 * aparelho vê a vitória, o valor conta até ao que o contrato creditou e a forma
 * do sorteio ganho grava-se a partir da transacção do VRF que o liquidou; depois
 * do claim confirmado on-chain, o percurso do prémio — do contrato à wallet — com
 * a transacção que o prova. Sem confettis nem sons: é um comprovativo. Âmbar só
 * no valor e no percurso do prémio; verde só na prova on-chain.
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
  // A vitória celebra-se uma vez por sorteio ganho, e o claim uma vez por transacção.
  const firstWin = useFirstSight(win?.txHash ? `win-${win.txHash}` : null);
  const firstClaim = useFirstSight(claimTxHash ? `claim-${claimTxHash}` : null);

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
    <div className="iw-surface-raised iw-swap !rounded-card p-5 mb-4">
      <div className="flex items-start gap-4">
        {win?.txHash && (
          <ProofMark
            proof={win.txHash}
            size={84}
            draw={firstWin}
            label={`${c.proof.markRound} ${win.roundId.toString()}`}
            className="hidden min-[400px]:block"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="font-mono text-sm text-white truncate">{name}</p>
            {win?.rank ? (
              <span className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 shrink-0">
                {rankLabel[win.rank] ?? `#${win.rank}`}
              </span>
            ) : null}
          </div>

          <p className="font-mono text-4xl sm:text-5xl font-bold text-brand tabular-nums leading-none">
            <CountUp key={firstWin ? 'first' : 'known'} value={amount} decimals={6} from0={firstWin && !claimTxHash} delay={firstWin ? 350 : 0} duration={1300} />
            <span className="ml-2 font-sans text-base text-gray-400 font-normal">USDC</span>
          </p>

          {win?.roundId !== undefined && (
            <p className="font-mono text-[11px] text-gray-400 mt-2">{c.winCard.round} {win.roundId.toString()}</p>
          )}
        </div>
      </div>

      {claimTxHash ? (
        // O claim confirmou on-chain: o prémio saiu do contrato para a wallet.
        <div className="mt-4 border-t border-dark-border pt-4">
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <ProofSeal className="h-4 w-4" /> {c.winCard.claimed}
          </p>
          <MoneyPath
            tone="prize"
            animate={firstClaim}
            className="mt-4"
            nodes={[
              { label: c.winCard.contract, detail: <span className="font-mono">{short(CONTRACTS.RAFFLE_MANAGER)}</span> },
              { label: c.winCard.yourWallet, detail: address ? <span className="font-mono">{short(address)}</span> : undefined },
            ]}
          />
          <a
            href={`${ARBISCAN_TX}${claimTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex min-h-[44px] items-center gap-2 text-sm text-gray-300 transition-colors hover:text-success"
          >
            {c.winCard.claimTx} <span className="font-mono text-success">{shortProof(claimTxHash)}</span>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      ) : (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-dark-border pt-3">
          <span className="flex items-center gap-2 text-xs font-medium text-success">
            <ProofSeal className="w-4 h-4" /> {c.winCard.verified}
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
      )}

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
