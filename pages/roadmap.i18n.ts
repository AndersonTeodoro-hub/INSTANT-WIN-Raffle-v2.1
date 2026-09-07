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
  waitlist: { short: string };
  hero: { eyebrow: string; title: string; intro: string };
  steps: Step[];
  outro: { note: string; ctaLine1: string; ctaLine2: string; ctaButton: string; back: string };
}

const en: RoadmapCopy = {
  meta: {
    title: 'Instant Win — Roadmap',
    description:
      'Proof, not promise. A live provably fair lottery on Arbitrum One, an onchain Event Center for giveaways and airdrops, web2 onboarding, and token economics under legal structuring.',
  },
  waitlist: { short: 'Waitlist' },
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
          pre: '30-minute rounds on an immutable contract on Arbitrum One. Every draw by Chainlink VRF, every prize claimed straight from the contract. Verifiable on Arbiscan.',
        },
      ],
      verify: 'Verify it yourself',
    },
    {
      num: '02',
      status: 'Building',
      title: 'Event Center',
      body: [
        {
          pre: 'Campaigns anyone can create and anyone can enter, with the winner picked by VRF and the prize held by a verified contract until it is claimed. Prize modules for ERC-20, ERC-721 and ERC-1155 are already deployed and verified, so a campaign can distribute any tokenized asset, including the ones issued on Robinhood Chain. Entering needs no wallet and no crypto knowledge.',
        },
      ],
    },
    {
      num: '03',
      status: 'Next',
      title: 'Regulated company',
      body: [
        {
          pre: 'To operate this at scale we intend to become a regulated company. The order is fixed and will not be skipped: a legal entity first, then licensing.',
        },
      ],
    },
    {
      num: '04',
      status: 'Only then',
      title: 'Platform instrument',
      body: [
        {
          pre: 'Any token or shareholding instrument for the platform exists only inside that structure. Never before it.',
        },
      ],
    },
  ],
  outro: {
    note: 'No dates. Each step depends on the one before it. What exists is published with the contract address next to it.',
    ctaLine1: 'Building the rails for transparent, on-chain distribution of tokenized assets.',
    ctaLine2: 'Early conversations with investors and partners are open.',
    ctaButton: 'Talk to us',
    back: 'Back to instantwin',
  },
};

/*
 * Português europeu (o site serve Portugal): "lotaria", "levantar", "ronda",
 * "utilizador". Difere do dicionário pt da landing, que está em pt-BR — nota
 * levantada para revisão, não corrigida aqui: esta passagem não toca na landing.
 *
 * Vocabulário do sector fica em inglês nos três idiomas, como já ficava na
 * landing: pull-payment, on-chain, wallet, VRF, ERC-20, airdrop, onboarding,
 * stablecoin, compliance, RWA, NFT, burn. "Giveaway"/"giveaways" já não está
 * nesta lista: passou a traduzir-se (sorteio/sorteios, sorteo/sorteos).
 *
 * "Claims" traduz-se (levantamentos) quando é o substantivo do dinheiro a sair,
 * porque é aí que a frase é um compromisso e tem de se ler sem ambiguidade.
 */
const pt: RoadmapCopy = {
  meta: {
    title: 'Instant Win — Roadmap',
    description:
      'Prova, não promessa. Uma lotaria comprovadamente justa em funcionamento na Arbitrum One, um Event Center on-chain para sorteios e airdrops, onboarding web2, e economia de token sob estruturação legal.',
  },
  waitlist: { short: 'Lista de espera' },
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
          pre: 'Rondas de 30 minutos num contrato imutável na Arbitrum One. Cada sorteio pelo Chainlink VRF, cada prémio levantado diretamente do contrato. Verificável no Arbiscan.',
        },
      ],
      verify: 'Verifique por si mesmo',
    },
    {
      num: '02',
      status: 'Em construção',
      title: 'Event Center',
      body: [
        {
          pre: 'Campanhas que qualquer pessoa pode criar e qualquer pessoa pode participar, com o vencedor escolhido por VRF e o prémio guardado por um contrato verificado até ser levantado. Os módulos de prémio para ERC-20, ERC-721 e ERC-1155 já estão implementados e verificados, por isso uma campanha pode distribuir qualquer ativo tokenizado, incluindo os emitidos na Robinhood Chain. Participar não exige wallet nem conhecimentos de cripto.',
        },
      ],
    },
    {
      num: '03',
      status: 'A seguir',
      title: 'Empresa regulada',
      body: [
        {
          pre: 'Para operar isto à escala, pretendemos tornar-nos uma empresa regulada. A ordem é fixa e não será saltada: primeiro uma entidade legal, depois o licenciamento.',
        },
      ],
    },
    {
      num: '04',
      status: 'Só depois',
      title: 'Instrumento da plataforma',
      body: [
        {
          pre: 'Qualquer token ou instrumento de participação da plataforma existe apenas dentro dessa estrutura. Nunca antes dela.',
        },
      ],
    },
  ],
  outro: {
    note: 'Sem datas. Cada passo depende do anterior. O que existe é publicado com o endereço do contrato ao lado.',
    ctaLine1: 'A construir os trilhos para a distribuição transparente e on-chain de ativos tokenizados.',
    ctaLine2: 'Estão abertas conversas iniciais com investidores e parceiros.',
    ctaButton: 'Fale connosco',
    back: 'Voltar a instantwin',
  },
};

const es: RoadmapCopy = {
  meta: {
    title: 'Instant Win — Roadmap',
    description:
      'Prueba, no promesa. Una lotería demostrablemente justa en funcionamiento en Arbitrum One, un Event Center on-chain para sorteos y airdrops, onboarding web2, y economía de token bajo estructuración legal.',
  },
  waitlist: { short: 'Lista de espera' },
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
          pre: 'Rondas de 30 minutos en un contrato inmutable en Arbitrum One. Cada sorteo mediante Chainlink VRF, cada premio reclamado directamente del contrato. Verificable en Arbiscan.',
        },
      ],
      verify: 'Verifícalo tú mismo',
    },
    {
      num: '02',
      status: 'En construcción',
      title: 'Event Center',
      body: [
        {
          pre: 'Campañas que cualquiera puede crear y cualquiera puede participar, con el ganador elegido por VRF y el premio custodiado por un contrato verificado hasta que se reclama. Los módulos de premio para ERC-20, ERC-721 y ERC-1155 ya están desplegados y verificados, por lo que una campaña puede distribuir cualquier activo tokenizado, incluidos los emitidos en Robinhood Chain. Participar no requiere wallet ni conocimientos de cripto.',
        },
      ],
    },
    {
      num: '03',
      status: 'Siguiente',
      title: 'Empresa regulada',
      body: [
        {
          pre: 'Para operar esto a escala, tenemos la intención de convertirnos en una empresa regulada. El orden es fijo y no se saltará: primero una entidad legal, después la licencia.',
        },
      ],
    },
    {
      num: '04',
      status: 'Solo entonces',
      title: 'Instrumento de la plataforma',
      body: [
        {
          pre: 'Cualquier token o instrumento de participación de la plataforma existe únicamente dentro de esa estructura. Nunca antes de ella.',
        },
      ],
    },
  ],
  outro: {
    note: 'Sin fechas. Cada paso depende del anterior. Lo que existe se publica con la dirección del contrato al lado.',
    ctaLine1: 'Construyendo los rieles para la distribución transparente y on-chain de activos tokenizados.',
    ctaLine2: 'Están abiertas conversaciones iniciales con inversores y socios.',
    ctaButton: 'Habla con nosotros',
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
