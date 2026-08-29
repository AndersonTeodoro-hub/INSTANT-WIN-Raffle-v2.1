import { useLang } from './landing.i18n';
import type { Lang } from './landing.i18n';

// i18n da página /giveaways. Mesmo padrão do roadmap.i18n.ts: objecto de lookup
// por idioma, sem biblioteca, `Lang`/`useLang`/persistência vindos do landing.i18n.
//
// Fonte do texto: ROADMAP.md (secção 02 — Onchain Event Center) e as constantes
// reais do GiveawayManager V1 em constants.ts. Nada aqui promete o que o
// contrato não faz, e nenhuma frase tem data.
//
// Números: NÃO se escrevem à mão neste ficheiro. Os limites (5%, 1.000, 100.000,
// 1h–30d) vivem em GIVEAWAY_LIMITS e a página compõe os valores a partir de lá —
// aqui ficam só os rótulos. É a única forma de a copy não divergir do contrato.

interface Bullet {
  lead: string;
  rest: string;
}

export interface GiveawaysCopy {
  meta: { title: string; description: string };
  waitlist: { short: string; cta: string; headline: string; body: string };
  hero: { eyebrow: string; title: string; intro: string; bullets: Bullet[] };
  proof: {
    eyebrow: string;
    title: string;
    verifyLabel: string;
    matchLabel: string;
    /** Rótulos das constantes; a ordem casa com SPECS em Giveaways.tsx. */
    specs: string[];
    discipline: string;
  };
  wizard: {
    eyebrow: string;
    title: string;
    intro: string;
    banner: string;
    stepOf: string;
    stepNames: string[];
    back: string;
    next: string;
    restart: string;
    prize: {
      title: string;
      hint: string;
      tokenLabel: string;
      tokenUsdc: string;
      tokenCustom: string;
      addressLabel: string;
      decimalsLabel: string;
      amountLabel: string;
      amountHint: string;
    };
    timing: {
      title: string;
      hint: string;
      durationLabel: string;
      unitHours: string;
      unitDays: string;
      endsLabel: string;
      winnersLabel: string;
      winnersHint: string;
    };
    eligibility: {
      title: string;
      hint: string;
      openTitle: string;
      openBody: string;
      allowTitle: string;
      allowBody: string;
      allowLabel: string;
      allowPlaceholder: string;
      allowCount: string;
      merkleNote: string;
    };
    review: {
      title: string;
      hint: string;
      rowToken: string;
      rowPrize: string;
      rowFee: string;
      rowTotal: string;
      rowDuration: string;
      rowEnds: string;
      rowWinners: string;
      rowShare: string;
      rowEligibility: string;
      openValue: string;
      allowValue: string;
      dustNote: string;
      clampNote: string;
    };
    submit: {
      title: string;
      body: string;
      cta: string;
      note: string;
    };
    errors: {
      amountInvalid: string;
      amountDust: string;
      addressInvalid: string;
      decimalsInvalid: string;
      durationRange: string;
      winnersRange: string;
      allowEmpty: string;
      allowTooMany: string;
      allowInvalid: string;
    };
  };
  participants: { eyebrow: string; title: string; body: string };
  outro: { back: string };
}

const en: GiveawaysCopy = {
  meta: {
    title: 'Instant Win — Giveaways',
    description:
      'Provably fair giveaways on Arbitrum One. Free entry for participants, any ERC-20 as the prize, winners drawn by Chainlink VRF. Deployed and verified contract, campaign creation in preview.',
  },
  waitlist: {
    short: 'Waitlist',
    cta: 'Join the waitlist',
    headline: 'Want to enter giveaways, not run them?',
    body: 'One waitlist covers the whole Event Center. Join it and you hear first when campaigns open to entrants.',
  },
  hero: {
    eyebrow: 'Event Center · Module 02',
    title: 'Giveaways, provably fair.',
    intro:
      'Most giveaway platforms are web2 products with crypto branding: you are asked to trust that the draw happened. Here the draw is the proof. A creator funds a prize, entrants join for free, and Chainlink VRF picks the winners on-chain where anyone can check the result.',
    bullets: [
      {
        lead: 'Free entry for participants',
        rest: ' — the creator funds the prize up front. Entrants never pay, and no participant funds are ever collected.',
      },
      {
        lead: 'Any ERC-20 as the prize',
        rest: ' — stablecoins, project tokens, tokenized assets. One wallet, one entry.',
      },
      {
        lead: 'Winners drawn by Chainlink VRF',
        rest: ' — no admin can pick, change or block a winner, not even us.',
      },
      {
        lead: 'Prizes claimed from the contract',
        rest: ' — pull-payment, exactly like the lottery. Claims are never pausable and nothing can be trapped.',
      },
      {
        lead: 'For brands, communities and creators',
        rest: ' — open campaigns, or an eligibility list when entries need to be restricted.',
      },
    ],
  },
  proof: {
    eyebrow: 'Proof',
    title: 'This is not a mockup.',
    verifyLabel: 'GiveawayManager · Arbitrum One',
    matchLabel: 'Verified · Exact Match',
    specs: [
      'Platform fee',
      'Winners per campaign',
      'Participants per campaign',
      'Prize asset',
      'Campaign duration',
    ],
    discipline:
      'Deployed and verified on Arbitrum One. Campaign creation opens after our lottery’s public launch — we ship in order.',
  },
  wizard: {
    eyebrow: 'Campaign creation',
    title: 'Walk the flow.',
    intro:
      'The exact steps a creator will take, with the real limits the contract enforces. Nothing here connects a wallet or sends a transaction — it is a preview you can click through end to end.',
    banner: 'PREVIEW MODE · no wallet, no transaction, nothing leaves this page',
    stepOf: 'of',
    stepNames: ['Prize', 'Timing', 'Eligibility', 'Review', 'Early access'],
    back: 'Back',
    next: 'Continue',
    restart: 'Start over',
    prize: {
      title: 'What is the prize?',
      hint: 'The creator deposits the full prize plus the platform fee when the campaign is created. The contract records the amount actually received, so fee-on-transfer tokens are handled correctly.',
      tokenLabel: 'Prize token',
      tokenUsdc: 'USDC',
      tokenCustom: 'Other ERC-20',
      addressLabel: 'Token address',
      decimalsLabel: 'Decimals',
      amountLabel: 'Prize amount',
      amountHint: 'Split equally between the winners you choose in the next step.',
    },
    timing: {
      title: 'How long, and how many winners?',
      hint: 'Entries close at the end time. Closing is permissionless: automation calls it, but anyone can — a campaign can never be held open.',
      durationLabel: 'Entry window',
      unitHours: 'hours',
      unitDays: 'days',
      endsLabel: 'Entries would close',
      winnersLabel: 'Number of winners',
      winnersHint: 'If fewer people enter than the number of winners, the contract clamps it to the actual participants.',
    },
    eligibility: {
      title: 'Who can enter?',
      hint: 'One wallet, one entry, in both modes.',
      openTitle: 'Open to any wallet',
      openBody:
        'Anyone on Arbitrum One can enter. Open campaigns accept sybil entries by design — that is the creator’s informed choice.',
      allowTitle: 'Eligibility list',
      allowBody:
        'Only the wallets you list can enter. This is the sybil defence for brands, and the compliance tool for transfer-restricted tokens.',
      allowLabel: 'Eligible wallets',
      allowPlaceholder: '0x… one address per line',
      allowCount: 'eligible wallets',
      merkleNote:
        'The list becomes a Merkle root off-chain. Only 32 bytes go on-chain — the contract never publishes the addresses themselves.',
    },
    review: {
      title: 'Review the campaign.',
      hint: 'Every figure below is computed with the same integer maths the contract uses.',
      rowToken: 'Prize token',
      rowPrize: 'Prize pool',
      rowFee: 'Platform fee (5%)',
      rowTotal: 'You would deposit',
      rowDuration: 'Entry window',
      rowEnds: 'Entries close',
      rowWinners: 'Winners',
      rowShare: 'Share per winner',
      rowEligibility: 'Eligibility',
      openValue: 'Open to any wallet',
      allowValue: 'Eligibility list',
      dustNote:
        'An indivisible remainder goes to the first winner drawn — deterministic, and the full prize is always distributed.',
      clampNote: 'Winners are clamped to the number of actual participants at close.',
    },
    submit: {
      title: 'Campaign creation opens after public launch.',
      body: 'The contract is deployed and verified, but creation stays closed until the lottery is publicly launched — we ship in order, and we do not open a revenue product on top of an unlaunched one. Request early access to be in the first group when it opens.',
      cta: 'Request early access',
      note: 'Nothing you typed was stored or sent. This preview keeps everything inside the page.',
    },
    errors: {
      amountInvalid: 'Enter a prize amount greater than zero, with no more decimals than the token has.',
      amountDust: 'Prize too small: the 5% fee would round to zero, and the contract rejects it.',
      addressInvalid: 'Enter a valid contract address (0x followed by 40 hex characters).',
      decimalsInvalid: 'Decimals must be between 0 and 36.',
      durationRange: 'The contract accepts 1 hour to 30 days.',
      winnersRange: 'The contract accepts 1 to 1,000 winners.',
      allowEmpty: 'Add at least one eligible wallet, or switch to an open campaign.',
      allowTooMany: 'The contract caps a campaign at 100,000 participants.',
      allowInvalid: 'Some lines are not valid addresses.',
    },
  },
  participants: {
    eyebrow: 'For entrants',
    title: 'Not running a campaign?',
    body: 'Entering a giveaway will always be free. There is one waitlist for the whole Event Center — the lottery, giveaways and everything after.',
  },
  outro: { back: 'Back to instantwin' },
};

/**
 * PT e ES apontam para o inglês, exactamente pela razão documentada na /roadmap:
 * esta página faz afirmações técnicas sobre código deployado ("Exact Match",
 * "pull-payment", "5% platform fee", "Merkle root") e sobre o que o produto
 * ainda NÃO faz. Traduzi-las sem revisão faria a promessa variar por idioma —
 * o oposto do que a página existe para provar. Quando houver tradução revista,
 * substitui-se o `en` pelo dicionário próprio e mais nada muda.
 */
export const giveawaysTranslations: Record<Lang, GiveawaysCopy> = { en, pt: en, es: en };

/** Atalho: devolve directamente o dicionário do idioma escolhido. */
export function useGiveawaysCopy(): GiveawaysCopy {
  const [lang] = useLang();
  return giveawaysTranslations[lang];
}
