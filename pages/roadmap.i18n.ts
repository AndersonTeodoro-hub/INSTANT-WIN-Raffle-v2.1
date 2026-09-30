import { useLang } from './landing.i18n.js';
import type { Lang } from './landing.i18n.js';

// i18n da página /roadmap. Mesmo padrão do app.i18n.ts: objecto de lookup por
// idioma, sem biblioteca, `Lang`/`useLang`/persistência vindos do landing.i18n.
//
// Fonte do texto: a visão que o owner escreveu a 29/09/2026, nas três línguas,
// palavra por palavra (o topo, os blocos, os degraus, os gráficos, o fecho). O
// ROADMAP.md na raiz ficou para trás: não é a fonte desta página.
//
// Interpolação: frases partidas em pre/strong/post à volta da parte em destaque,
// como a landing já faz em `transparency`. Nada de HTML dentro das strings.

interface Para {
  pre: string;
  /** Parte em destaque no meio da frase (opcional). */
  strong?: string;
  post?: string;
}

/** Um bloco de texto da visão: um título e um parágrafo. */
interface Block {
  title: string;
  body: string;
}

interface Step {
  /** '01'…'05'. O estado "live" é posicional (ONCHAIN_STEPS em Roadmap.tsx). */
  num: string;
  status: string;
  title: string;
  body: Para[];
  bulletsIntro?: string;
  bullets?: { lead: string; rest: string }[];
  note?: string;
  /** Texto antes do endereço do contrato (só no degrau que já está on-chain). */
  verify?: string;
  /**
   * O nome de cada contrato a verificar, pela ordem dos endereços (verifyAddresses
   * em Roadmap.tsx), quando o degrau tem mais do que um: a entrega verificada.
   */
  contracts?: string[];
}

/**
 * Um gráfico da oportunidade: uma barra por cenário (pela ordem de `scenarios`),
 * cada uma com a quota e o valor escritos. O comprimento de cada barra é
 * REVENUE em Roadmap.tsx — estes textos são os números do owner, fixos.
 */
interface Chart {
  title: string;
  bars: { share: string; value: string }[];
  /** A fonte do mercado e a taxa lida do contrato. */
  note: string;
}

export interface RoadmapCopy {
  /** A description da página é a introdução do topo (as palavras do owner). */
  meta: { title: string };
  hero: { eyebrow: string; title: string; intro: string };
  /** Entre o topo e a síntese das fases: o problema, o que construímos. */
  story: Block[];
  /** Síntese das fases lado a lado, acima da lista detalhada. */
  overview: { onchainLabel: string; intendedLabel: string; note: string };
  steps: Step[];
  /** A linha por baixo do último degrau on-chain. */
  proofLine: string;
  opportunity: {
    title: string;
    /** Arranque, crescimento, maturidade: o nome de cada barra. */
    scenarios: string[];
    charts: Chart[];
    /** A escala (logarítmica, 10 M$ a 10 B$), uma marca por década. */
    ticks: string[];
    line: string;
    disclaimer: string;
  };
  /** Depois dos gráficos, antes da forma final: para onde isto vai, porquê agora. */
  ahead: Block[];
  outro: { note: string; ctaLine1: string; ctaLine2: string; ctaButton: string; back: string };
}

const en: RoadmapCopy = {
  meta: { title: 'Roadmap · Keptra' },
  hero: {
    eyebrow: 'Roadmap',
    title: 'The trust layer for every promise.',
    intro:
      'Every day, people are made promises. Your order will arrive. This draw is fair. Your prize will be paid. Today, all of them run on one thing: “trust me.” Keptra replaces “trust me” with proof.',
  },
  story: [
    {
      title: 'The problem nobody solved',
      body: 'Tokenized assets are coming on-chain at scale. Robinhood Chain will issue them. Institutions will mint them. But the moment a promise touches the real world — a product has to arrive, a winner has to be drawn, a prize has to be paid — everything falls back to “trust me.” And the billions of people outside crypto stay outside.',
    },
    {
      title: 'What we built',
      body: 'Keptra is the layer that turns those promises into proof. One infrastructure on Arbitrum One, with Chainlink proving what happens in the real world — and the person on the other side never needs to know what a wallet is. They use their email. Under the hood each person gets a real wallet, created invisibly, signing their own actions. Web2 in, proof out.',
    },
  ],
  overview: {
    onchainLabel: 'Verified on-chain',
    intendedLabel: 'Intended, in this order',
    note: 'No dates.',
  },
  steps: [
    {
      num: '01',
      status: 'Live now',
      title: 'Verified delivery',
      body: [
        {
          pre: "Free shipping made customers smile, easy returns made them loyal. Verified delivery is the next benefit every brand will offer. The customer's payment is held in escrow, a Chainlink oracle proves the delivery from the carrier's tracking, and every proven delivery leaves an on-chain record — evidence against a chargeback.",
        },
      ],
      verify: 'Verify it yourself',
      contracts: ['Escrow', 'Guarantee', 'Pool'],
    },
    {
      num: '02',
      status: 'Live now',
      title: 'Giveaways & Event Center',
      body: [
        {
          pre: 'Any brand, creator or community runs a prize campaign. Prize modules for ERC-20, ERC-721 and ERC-1155, so a campaign can distribute any tokenized asset. One verified person, one entry — no bot farms taking the prize.',
        },
      ],
      verify: 'Verify it yourself',
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
      status: 'Mass adoption',
      title: 'Card payments',
      body: [
        {
          pre: "Next, customers pay by card, exactly as they do today, with the same guarantee. They never touch crypto — they just buy from a brand that offers Keptra. That's how Keptra reaches everyone: not by teaching the world crypto, but by making its guarantees invisible inside every checkout.",
        },
      ],
    },
    {
      num: '05',
      status: 'The last module',
      title: 'Keptra Token',
      body: [
        {
          pre: "The network's own asset, connecting brands, customers and the providers who back the guarantee across every Keptra product. Launched inside the regulated company, never before it.",
        },
      ],
    },
  ],
  proofLine: "Not a demo. Not a testnet. Deployed, verified, running. Don't believe us. Go check.",
  opportunity: {
    title: 'The size of the opportunity',
    scenarios: ['Launch', 'Growth', 'Maturity'],
    charts: [
      {
        title: 'Verified Delivery — revenue by share of global e-commerce',
        bars: [
          { share: '0.1%', value: '$103M/year' },
          { share: '0.5%', value: '$516M/year' },
          { share: '2%', value: '$2.06B/year' },
        ],
        note: 'Global retail e-commerce: $6.88T in 2026 (EMARKETER via Shopify). Keptra fee: 1.5% per sale, read from the contract.',
      },
    ],
    ticks: ['$10M', '$100M', '$1B', '$10B'],
    line: 'Card payments are what moves Keptra from launch to maturity.',
    disclaimer: 'Illustrative scenarios from public market data and on-chain fees — not a forecast or a financial promise.',
  },
  ahead: [
    {
      title: 'Where this goes',
      body: 'From there, Keptra becomes the default trust layer of commerce — every online store, every marketplace, every country. And every real-world asset that has to physically arrive gets a delivery the world can verify.',
    },
    {
      title: 'Why now',
      body: 'The rails for tokenized assets are being laid now. The trust layer between them and real people is not. We built it, it runs, and it works for people who have never heard of a wallet.',
    },
  ],
  outro: {
    note: 'No dates. Each step depends on the one before it. What exists is published with the contract address next to it.',
    ctaLine1: 'Building the trust layer for every promise.',
    ctaLine2: 'Mass adoption starts with card payments. Early conversations with investors and partners are open.',
    ctaButton: 'Talk to us',
    back: 'Back to Keptra',
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
  meta: { title: 'Roadmap · Keptra' },
  hero: {
    eyebrow: 'Roadmap',
    title: 'A camada de confiança para cada promessa.',
    intro:
      'Todos os dias, são feitas promessas às pessoas. A tua encomenda vai chegar. Este sorteio é justo. O teu prémio vai ser pago. Hoje, todas elas assentam numa única coisa: “confia em mim.” A Keptra substitui o “confia em mim” por prova.',
  },
  story: [
    {
      title: 'O problema que ninguém resolveu',
      body: 'Os activos tokenizados estão a chegar à blockchain em grande escala. A Robinhood Chain vai emiti-los. As instituições vão criá-los. Mas no momento em que uma promessa toca o mundo real — um produto tem de chegar, um vencedor tem de ser sorteado, um prémio tem de ser pago — tudo volta ao “confia em mim”. E os milhares de milhões de pessoas fora do cripto continuam de fora.',
    },
    {
      title: 'O que construímos',
      body: 'A Keptra é a camada que transforma essas promessas em prova. Uma infraestrutura na Arbitrum One, com a Chainlink a provar o que acontece no mundo real — e a pessoa do outro lado nunca precisa de saber o que é uma carteira. Usa o email. Por trás, cada pessoa recebe uma carteira real, criada de forma invisível, que assina as suas próprias acções. Entra web2, sai prova.',
    },
  ],
  overview: {
    onchainLabel: 'Verificado on-chain',
    intendedLabel: 'Pretendido, por esta ordem',
    note: 'Sem datas.',
  },
  steps: [
    {
      num: '01',
      status: 'Ao vivo agora',
      title: 'Entrega verificada',
      body: [
        {
          pre: 'Os portes grátis fizeram os clientes sorrir, as devoluções fáceis tornaram-nos fiéis. A entrega verificada é o próximo benefício que todas as marcas vão oferecer. O pagamento do cliente fica retido em escrow, um oráculo Chainlink prova a entrega a partir do tracking da transportadora, e cada entrega provada deixa um registo on-chain — evidência contra um chargeback.',
        },
      ],
      verify: 'Verifique por si mesmo',
      contracts: ['Escrow', 'Garantia', 'Pool'],
    },
    {
      num: '02',
      status: 'Ao vivo agora',
      title: 'Giveaways e Event Center',
      body: [
        {
          pre: 'Qualquer marca, criador ou comunidade faz uma campanha de prémios. Módulos de prémio para ERC-20, ERC-721 e ERC-1155, para que uma campanha possa distribuir qualquer activo tokenizado. Uma pessoa verificada, uma participação — sem fazendas de bots a levar o prémio.',
        },
      ],
      verify: 'Verifique por si mesmo',
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
      status: 'Adopção em massa',
      title: 'Pagamento com cartão',
      body: [
        {
          pre: 'A seguir, os clientes pagam com cartão, exactamente como fazem hoje, com a mesma garantia. Nunca tocam em cripto — simplesmente compram a uma marca que oferece a Keptra. É assim que a Keptra chega a toda a gente: não a ensinar cripto ao mundo, mas a tornar as suas garantias invisíveis dentro de cada checkout.',
        },
      ],
    },
    {
      num: '05',
      status: 'O último módulo',
      title: 'Keptra Token',
      body: [
        {
          pre: 'O activo da própria rede, que liga marcas, clientes e os provedores que sustentam a garantia em todos os produtos Keptra. Lançado dentro da empresa regulada, nunca antes dela.',
        },
      ],
    },
  ],
  proofLine: 'Não é uma demo. Não é uma testnet. Implantado, verificado, a funcionar. Não acredites em nós. Vai confirmar.',
  opportunity: {
    title: 'O tamanho da oportunidade',
    scenarios: ['Arranque', 'Crescimento', 'Maturidade'],
    charts: [
      {
        title: 'Entrega verificada — receita por quota do e-commerce mundial',
        bars: [
          { share: '0,1%', value: '103 M$/ano' },
          { share: '0,5%', value: '516 M$/ano' },
          { share: '2%', value: '2,06 B$/ano' },
        ],
        note: 'E-commerce mundial a retalho: 6,88 biliões $ em 2026 (EMARKETER via Shopify). Taxa Keptra: 1,5% por venda, lida do contrato.',
      },
    ],
    ticks: ['10 M$', '100 M$', '1 B$', '10 B$'],
    line: 'Os pagamentos com cartão são o que leva a Keptra do arranque à maturidade.',
    disclaimer: 'Cenários ilustrativos a partir de dados públicos de mercado e das taxas on-chain — não são uma previsão nem uma promessa financeira.',
  },
  ahead: [
    {
      title: 'Para onde isto vai',
      body: 'A partir daí, a Keptra torna-se a camada de confiança padrão do comércio — cada loja online, cada marketplace, cada país. E cada activo do mundo real que tenha de chegar fisicamente a algum lado ganha uma entrega que o mundo pode verificar.',
    },
    {
      title: 'Porquê agora',
      body: 'Os carris para os activos tokenizados estão a ser construídos agora. A camada de confiança entre eles e as pessoas reais não está. Nós construímo-la, funciona, e funciona para pessoas que nunca ouviram falar de uma carteira.',
    },
  ],
  outro: {
    note: 'Sem datas. Cada passo depende do anterior. O que existe é publicado com o endereço do contrato ao lado.',
    ctaLine1: 'A construir a camada de confiança para cada promessa.',
    ctaLine2: 'A adopção em massa começa com os pagamentos com cartão. Estão abertas conversas iniciais com investidores e parceiros.',
    ctaButton: 'Fale connosco',
    back: 'Voltar à Keptra',
  },
};

const es: RoadmapCopy = {
  meta: { title: 'Roadmap · Keptra' },
  hero: {
    eyebrow: 'Roadmap',
    title: 'La capa de confianza para cada promesa.',
    intro:
      'Cada día, se hacen promesas a las personas. Tu pedido llegará. Este sorteo es justo. Tu premio se pagará. Hoy, todas se apoyan en una sola cosa: “confía en mí.” Keptra sustituye el “confía en mí” por pruebas.',
  },
  story: [
    {
      title: 'El problema que nadie resolvió',
      body: 'Los activos tokenizados están llegando on-chain a gran escala. Robinhood Chain los emitirá. Las instituciones los crearán. Pero en cuanto una promesa toca el mundo real — un producto tiene que llegar, un ganador tiene que ser sorteado, un premio tiene que pagarse — todo vuelve al “confía en mí”. Y los miles de millones de personas fuera de cripto siguen fuera.',
    },
    {
      title: 'Lo que construimos',
      body: 'Keptra es la capa que convierte esas promesas en pruebas. Una infraestructura en Arbitrum One, con Chainlink probando lo que ocurre en el mundo real — y la persona del otro lado nunca necesita saber qué es una wallet. Usa su email. Por dentro, cada persona recibe una wallet real, creada de forma invisible, que firma sus propias acciones. Entra web2, sale prueba.',
    },
  ],
  overview: {
    onchainLabel: 'Verificado on-chain',
    intendedLabel: 'Pretendido, en este orden',
    note: 'Sin fechas.',
  },
  steps: [
    {
      num: '01',
      status: 'En vivo ahora',
      title: 'Entrega verificada',
      body: [
        {
          pre: 'El envío gratis hizo sonreír a los clientes, las devoluciones fáciles los fidelizaron. La entrega verificada es el próximo beneficio que todas las marcas ofrecerán. El pago del cliente queda retenido en escrow, un oráculo de Chainlink prueba la entrega a partir del seguimiento del transportista, y cada entrega probada deja un registro on-chain — evidencia contra un contracargo.',
        },
      ],
      verify: 'Verifícalo tú mismo',
      contracts: ['Escrow', 'Garantía', 'Pool'],
    },
    {
      num: '02',
      status: 'En vivo ahora',
      title: 'Giveaways y Event Center',
      body: [
        {
          pre: 'Cualquier marca, creador o comunidad organiza una campaña de premios. Módulos de premio para ERC-20, ERC-721 y ERC-1155, para que una campaña pueda distribuir cualquier activo tokenizado. Una persona verificada, una participación — sin granjas de bots llevándose el premio.',
        },
      ],
      verify: 'Verifícalo tú mismo',
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
      status: 'Adopción masiva',
      title: 'Pago con tarjeta',
      body: [
        {
          pre: 'Después, los clientes pagan con tarjeta, exactamente como hoy, con la misma garantía. Nunca tocan cripto — simplemente compran a una marca que ofrece Keptra. Así llega Keptra a todos: no enseñando cripto al mundo, sino haciendo invisibles sus garantías dentro de cada checkout.',
        },
      ],
    },
    {
      num: '05',
      status: 'El último módulo',
      title: 'Keptra Token',
      body: [
        {
          pre: 'El activo de la propia red, que conecta marcas, clientes y los proveedores que respaldan la garantía en todos los productos Keptra. Se lanza dentro de la empresa regulada, nunca antes.',
        },
      ],
    },
  ],
  proofLine: 'No es una demo. No es una testnet. Desplegado, verificado, funcionando. No nos creas. Compruébalo.',
  opportunity: {
    title: 'El tamaño de la oportunidad',
    scenarios: ['Arranque', 'Crecimiento', 'Madurez'],
    charts: [
      {
        title: 'Entrega verificada — ingresos por cuota del e-commerce mundial',
        bars: [
          { share: '0,1%', value: '103 M$/año' },
          { share: '0,5%', value: '516 M$/año' },
          // Em milhões: em espanhol "billón" é 10^12.
          { share: '2%', value: '2.060 M$/año' },
        ],
        note: 'E-commerce minorista mundial: 6,88 billones $ en 2026 (EMARKETER vía Shopify). Comisión Keptra: 1,5% por venta, leída del contrato.',
      },
    ],
    ticks: ['10 M$', '100 M$', '1.000 M$', '10.000 M$'],
    line: 'Los pagos con tarjeta son lo que lleva a Keptra del arranque a la madurez.',
    disclaimer: 'Escenarios ilustrativos a partir de datos públicos de mercado y de las comisiones on-chain — no son una previsión ni una promesa financiera.',
  },
  ahead: [
    {
      title: 'Hacia dónde va esto',
      body: 'A partir de ahí, Keptra se convierte en la capa de confianza por defecto del comercio — cada tienda online, cada marketplace, cada país. Y cada activo del mundo real que tenga que llegar físicamente obtiene una entrega que el mundo puede verificar.',
    },
    {
      title: 'Por qué ahora',
      body: 'Los raíles de los activos tokenizados se están construyendo ahora. La capa de confianza entre ellos y las personas reales, no. Nosotros la construimos, funciona, y funciona para personas que nunca han oído hablar de una wallet.',
    },
  ],
  outro: {
    note: 'Sin fechas. Cada paso depende del anterior. Lo que existe se publica con la dirección del contrato al lado.',
    ctaLine1: 'Construyendo la capa de confianza para cada promesa.',
    ctaLine2: 'La adopción masiva empieza con los pagos con tarjeta. Están abiertas las conversaciones iniciales con inversores y socios.',
    ctaButton: 'Habla con nosotros',
    back: 'Volver a Keptra',
  },
};

/**
 * Os três dicionários dizem exactamente a mesma coisa.
 *
 * Regra desta página: uma tradução não suaviza nem reforça um compromisso. As
 * frases que prendem o projecto passam literais, e nenhuma língua ganha uma
 * promessa, data ou adjectivo que as outras não tenham. Os números dos gráficos
 * são os mesmos nas três, cada um escrito como a língua escreve números.
 */
export const roadmapTranslations: Record<Lang, RoadmapCopy> = { en, pt, es };

/** Atalho: devolve directamente o dicionário do idioma escolhido. */
export function useRoadmapCopy(): RoadmapCopy {
  const [lang] = useLang();
  return roadmapTranslations[lang];
}
