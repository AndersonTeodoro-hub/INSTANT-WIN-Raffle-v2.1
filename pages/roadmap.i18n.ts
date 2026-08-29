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

/*
 * Português europeu (o site serve Portugal): "lotaria", "levantar", "ronda",
 * "utilizador". Difere do dicionário pt da landing, que está em pt-BR — nota
 * levantada para revisão, não corrigida aqui: esta passagem não toca na landing.
 *
 * Vocabulário do sector fica em inglês nos três idiomas, como já ficava na
 * landing: pull-payment, on-chain, wallet, VRF, ERC-20, giveaway, airdrop,
 * onboarding, stablecoin, compliance, RWA, NFT, burn.
 *
 * "Claims" traduz-se (levantamentos) quando é o substantivo do dinheiro a sair,
 * porque é aí que a frase é um compromisso e tem de se ler sem ambiguidade.
 */
const pt: RoadmapCopy = {
  meta: {
    title: 'Instant Win — Roadmap',
    description:
      'Prova, não promessa. Uma lotaria comprovadamente justa em funcionamento na Arbitrum One, um Event Center on-chain para giveaways e airdrops, onboarding web2, e economia de token sob estruturação legal.',
  },
  waitlist: { short: 'Lista de espera', cta: 'Entrar na lista de espera' },
  hero: {
    eyebrow: 'Roadmap',
    title: 'Prova, não promessa.',
    intro:
      'Cada passo abaixo segue a mesma regra: nada é anunciado como pronto até ser verificável on-chain.',
  },
  steps: [
    {
      num: '01',
      status: 'Ao vivo agora',
      title: 'Lotaria Comprovadamente Justa',
      body: [
        {
          pre: 'Um smart contract imutável e verificado na Arbitrum One. Cada sorteio com tecnologia Chainlink VRF. Cada prémio pode ser levantado diretamente do contrato — pull-payment, os levantamentos nunca podem ser bloqueados, nem por nós. Rondas de 30 minutos, 85.7% de pagamento efetivo.',
        },
      ],
      verify: 'Verifique por si mesmo',
    },
    {
      num: '02',
      status: 'Em design',
      title: 'Event Center on-chain',
      body: [
        {
          pre: 'A lotaria é a prova de conceito. O Event Center é o produto: infraestrutura para ',
          strong: 'giveaways, airdrops e campanhas promocionais comprovadamente justos',
          post: ' — para marcas, comunidades e projetos web3.',
        },
      ],
      bulletsIntro: 'Princípios de design (congelados, implementação em curso):',
      bullets: [
        { lead: 'Entrada gratuita para os participantes', rest: ' — o criador financia o prémio, quem entra nunca paga' },
        {
          lead: 'Qualquer prémio em ERC-20',
          rest: ' — stablecoins, tokens de projeto, ativos tokenizados (prontos para RWA através de listas de elegibilidade alinhadas com compliance); NFTs a seguir',
        },
        {
          lead: 'Construído para escala real de campanha',
          rest: ' — de um pequeno giveaway de comunidade a airdrops de grandes marcas',
        },
        {
          lead: 'Seleção de vencedores sempre por Chainlink VRF',
          rest: ' — nenhum admin pode escolher, alterar ou bloquear um vencedor',
        },
        {
          lead: 'As mesmas garantias da lotaria',
          rest: ' — contrato imutável, levantamentos pull-payment, nada pode alguma vez ficar preso',
        },
        { lead: 'Pontos por envolvimento real', rest: ' — participar dá pontos da plataforma desde o primeiro dia' },
      ],
      note: 'A especificação técnica completa será publicada juntamente com o contrato verificado.',
    },
    {
      num: '03',
      status: 'A ponte',
      title: 'Onboarding Web2',
      body: [
        {
          pre: 'Campanhas abertas a pessoas que nunca tocaram numa wallet: um simples formulário de inscrição, uma wallet criada de forma invisível por trás dele, e um sorteio que continua a acontecer inteiramente on-chain. A promoção do supermercado, o lançamento de produto, a campanha de marca — tudo comprovadamente justo, tudo verificável, sem exigir conhecimentos de cripto.',
        },
      ],
    },
    {
      num: '04',
      status: 'Mais tarde',
      title: 'Economia de Token Sustentável',
      body: [
        {
          pre: 'Baseada em utilidade (taxas de eventos + burn por utilização), distribuição que põe a comunidade em primeiro lugar e assenta em envolvimento real medido. Sob estruturação legal — sem venda, sem lançamento antes de a estrutura existir. Anunciada quando for real, não antes.',
        },
      ],
    },
  ],
  outro: {
    closing: 'Construído a solo. Verificável em cada passo.',
    back: 'Voltar a instantwin',
  },
};

const es: RoadmapCopy = {
  meta: {
    title: 'Instant Win — Roadmap',
    description:
      'Prueba, no promesa. Una lotería demostrablemente justa en funcionamiento en Arbitrum One, un Event Center on-chain para giveaways y airdrops, onboarding web2, y economía de token bajo estructuración legal.',
  },
  waitlist: { short: 'Lista de espera', cta: 'Unirse a la lista de espera' },
  hero: {
    eyebrow: 'Roadmap',
    title: 'Prueba, no promesa.',
    intro:
      'Cada paso de abajo sigue la misma regla: nada se anuncia como listo hasta que sea verificable on-chain.',
  },
  steps: [
    {
      num: '01',
      status: 'En vivo ahora',
      title: 'Lotería Demostrablemente Justa',
      body: [
        {
          pre: 'Un smart contract inmutable y verificado en Arbitrum One. Cada sorteo con tecnología Chainlink VRF. Cada premio se puede reclamar directamente del contrato — pull-payment, los retiros nunca pueden bloquearse, ni siquiera por nosotros. Rondas de 30 minutos, 85.7% de pago efectivo.',
        },
      ],
      verify: 'Verifícalo tú mismo',
    },
    {
      num: '02',
      status: 'En diseño',
      title: 'Event Center on-chain',
      body: [
        {
          pre: 'La lotería es la prueba de concepto. El Event Center es el producto: infraestructura para ',
          strong: 'giveaways, airdrops y campañas promocionales demostrablemente justos',
          post: ' — para marcas, comunidades y proyectos web3.',
        },
      ],
      bulletsIntro: 'Principios de diseño (congelados, implementación en curso):',
      bullets: [
        { lead: 'Entrada gratuita para los participantes', rest: ' — el creador financia el premio, quien entra nunca paga' },
        {
          lead: 'Cualquier premio en ERC-20',
          rest: ' — stablecoins, tokens de proyecto, activos tokenizados (listos para RWA mediante listas de elegibilidad alineadas con compliance); NFTs a continuación',
        },
        {
          lead: 'Construido para escala real de campaña',
          rest: ' — desde un pequeño giveaway de comunidad hasta airdrops de grandes marcas',
        },
        {
          lead: 'Selección de ganadores siempre por Chainlink VRF',
          rest: ' — ningún admin puede elegir, cambiar o bloquear a un ganador',
        },
        {
          lead: 'Las mismas garantías que la lotería',
          rest: ' — contrato inmutable, retiros pull-payment, nada puede quedar nunca atrapado',
        },
        { lead: 'Puntos por participación real', rest: ' — participar otorga puntos de la plataforma desde el primer día' },
      ],
      note: 'La especificación técnica completa se publicará junto con el contrato verificado.',
    },
    {
      num: '03',
      status: 'El puente',
      title: 'Onboarding Web2',
      body: [
        {
          pre: 'Campañas abiertas a personas que nunca han tocado una wallet: un simple formulario de registro, una wallet creada de forma invisible detrás de él, y un sorteo que sigue ocurriendo enteramente on-chain. La promoción del supermercado, el lanzamiento de producto, la campaña de marca — todo demostrablemente justo, todo verificable, sin necesidad de conocimientos de cripto.',
        },
      ],
    },
    {
      num: '04',
      status: 'Más adelante',
      title: 'Economía de Token Sostenible',
      body: [
        {
          pre: 'Basada en utilidad (comisiones de eventos + burn por uso), distribución que pone a la comunidad primero y se apoya en participación real medida. Bajo estructuración legal — sin venta, sin lanzamiento antes de que la estructura exista. Anunciada cuando sea real, no antes.',
        },
      ],
    },
  ],
  outro: {
    closing: 'Construido en solitario. Verificable en cada paso.',
    back: 'Volver a instantwin',
  },
};

/**
 * Os três dicionários dizem exactamente a mesma coisa.
 *
 * Regra desta página: uma tradução não suaviza nem reforça um compromisso. As
 * frases que prendem o projecto — "we ship in order", "under legal structuring",
 * "no sale", "claims can never be blocked" — passam literais, e nenhuma língua
 * ganha uma promessa, data ou adjectivo que o inglês não tenha. Números,
 * endereços e limites ficam idênticos ao inglês em todas as línguas.
 *
 * O inglês continua a ser a versão canónica (ROADMAP.md); ao alterar um degrau,
 * alterar lá, depois aqui, nas três.
 */
export const roadmapTranslations: Record<Lang, RoadmapCopy> = { en, pt, es };

/** Atalho: devolve directamente o dicionário do idioma escolhido. */
export function useRoadmapCopy(): RoadmapCopy {
  const [lang] = useLang();
  return roadmapTranslations[lang];
}
