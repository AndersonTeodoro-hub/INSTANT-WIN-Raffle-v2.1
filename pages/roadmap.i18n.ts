import { useLang } from './landing.i18n';
import type { Lang } from './landing.i18n';

// i18n da página /roadmap. Mesmo padrão do app.i18n.ts: objecto de lookup por
// idioma, sem biblioteca, `Lang`/`useLang`/persistência vindos do landing.i18n.
//
// Fonte do texto: ROADMAP.md na raiz do repo. Ao alterar um degrau, alterar lá
// primeiro — o ficheiro é a versão canónica e esta é a sua transcrição.
//
// Interpolação: frases partidas em pre/strong/post à volta da parte em destaque,
// como a landing já faz em `transparency`. Nada de HTML dentro das strings.

interface Para {
  pre: string;
  /** Parte em destaque no meio da frase (opcional). */
  strong?: string;
  post?: string;
}

interface Step {
  /** '01'…'04'. O estado "live" é posicional (LIVE_STEP em Roadmap.tsx). */
  num: string;
  status: string;
  title: string;
  body: Para[];
  bulletsIntro?: string;
  bullets?: { lead: string; rest: string }[];
  note?: string;
  /** Texto antes do endereço do contrato (só no degrau que já está on-chain). */
  verify?: string;
}

export interface RoadmapCopy {
  meta: { title: string; description: string };
  waitlist: { short: string; cta: string };
  hero: { eyebrow: string; title: string; intro: string };
  steps: Step[];
  outro: { closing: string; back: string };
}

const en: RoadmapCopy = {
  meta: {
    title: 'Instant Win — Roadmap',
    description:
      'Proof, not promise. A live provably fair lottery on Arbitrum One, an onchain Event Center for giveaways and airdrops, web2 onboarding, and token economics under legal structuring.',
  },
  waitlist: { short: 'Waitlist', cta: 'Join the waitlist' },
  hero: {
    eyebrow: 'Roadmap',
    title: 'Proof, Not Promise.',
    intro:
      'Every step below follows the same rule: nothing is announced as done until it is verifiable on-chain.',
  },
  steps: [
    {
      num: '01',
      status: 'Live now',
      title: 'Provably Fair Lottery',
      body: [
        {
          pre: 'An immutable, verified smart contract on Arbitrum One. Every draw powered by Chainlink VRF. Every prize claimable directly from the contract — pull-payment, claims can never be blocked, not even by us. 30-minute rounds, 85.7% effective payout.',
        },
      ],
      verify: 'Verify it yourself',
    },
    {
      num: '02',
      status: 'In design',
      title: 'Onchain Event Center',
      body: [
        {
          pre: 'The lottery is the proof of concept. The Event Center is the product: infrastructure for ',
          strong: 'provably fair giveaways, airdrops and promotional campaigns',
          post: ' — for brands, communities and web3 projects.',
        },
      ],
      bulletsIntro: 'Design principles (frozen, implementation in progress):',
      bullets: [
        { lead: 'Free entry for participants', rest: ' — the creator funds the prize, entrants never pay' },
        {
          lead: 'Any ERC-20 prize',
          rest: ' — stablecoins, project tokens, tokenized assets (RWA-ready via compliance-aligned eligibility lists); NFTs next',
        },
        {
          lead: 'Built for real campaign scale',
          rest: ' — from a small community giveaway to large-brand airdrops',
        },
        {
          lead: 'Winner selection always by Chainlink VRF',
          rest: ' — no admin can pick, change or block a winner',
        },
        {
          lead: 'Same guarantees as the lottery',
          rest: ' — immutable contract, pull-payment claims, nothing can ever be trapped',
        },
        { lead: 'Points for real engagement', rest: ' — participation earns platform points from day one' },
      ],
      note: 'Full technical specification will be published together with the verified contract.',
    },
    {
      num: '03',
      status: 'The bridge',
      title: 'Web2 Onboarding',
      body: [
        {
          pre: 'Campaigns open to people who have never touched a wallet: a simple sign-up form, a wallet created invisibly behind it, and a draw that still happens fully on-chain. The supermarket promotion, the product launch, the brand campaign — all provably fair, all verifiable, no crypto knowledge required.',
        },
      ],
    },
    {
      num: '04',
      status: 'Later',
      title: 'Sustainable Token Economics',
      body: [
        {
          pre: 'Utility-based (event fees + burn per use), community-first distribution grounded in real measured engagement. Under legal structuring — no sale, no launch before the structure exists. Announced when real, not before.',
        },
      ],
    },
  ],
  outro: {
    closing: 'Solo-built. Verifiable at every step.',
    back: 'Back to instantwin',
  },
};

/**
 * PT e ES apontam para o inglês de propósito.
 *
 * O ROADMAP.md é a versão canónica e está em inglês; traduzir alegações técnicas
 * ("pull-payment", "85.7% effective payout", "under legal structuring") sem
 * revisão faria a promessa variar por idioma, que é exactamente o que esta
 * página existe para não fazer. Quando houver tradução revista, substitui-se o
 * `en` pelo dicionário próprio — o resto da página não muda.
 */
export const roadmapTranslations: Record<Lang, RoadmapCopy> = { en, pt: en, es: en };

/** Atalho: devolve directamente o dicionário do idioma escolhido. */
export function useRoadmapCopy(): RoadmapCopy {
  const [lang] = useLang();
  return roadmapTranslations[lang];
}
