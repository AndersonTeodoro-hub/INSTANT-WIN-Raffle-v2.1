import { useSyncExternalStore } from 'react';

// i18n da landing. As strings do jogo (/play/*) vivem em ./app.i18n.ts e
// partilham o `Lang`, o `useLang` e o localStorage daqui — mudar o idioma num
// lado muda no outro. No i18n library: um objecto de lookup por idioma mais um
// hook minúsculo chegam para três idiomas.

export type Lang = 'en' | 'pt' | 'es';
export const LANGS: Lang[] = ['en', 'pt', 'es'];
const STORAGE_KEY = 'iw-lang';

// Technical terms kept in English across all languages (industry convention):
// Chainlink VRF, USDC, Arbitrum One, on-chain, wallet, smart contract, open-source.
export type SceneCaptionKey = 'mark' | 'payout' | 'modules' | 'again' | 'entry' | 'prize' | 'pick';

/**
 * A página inicial conta a Keptra primeiro (pedido do owner de 27/09/2026): 01 a
 * Keptra, 02 para marcas, 03 para clientes, 04 o pool de garantia, 05 os
 * módulos, 06 o convite a provedores. Os textos do owner estão aqui tal como
 * foram dados, nas três línguas; o que se escreveu à volta deles (rótulos do
 * diagrama, do capítulo 04, legendas) está marcado como tal.
 */
export interface LandingCopy {
  /** O título do separador da página inicial: o produto e a página. */
  metaTitle: string;
  header: {
    enterApp: string;
    ariaLanguage: string;
    /** O módulo principal (decisão do owner de 27/09/2026): a primeira entrada do cabeçalho público, com link para "/". */
    mainModule: string;
  };
  /**
   * O endereço de contacto escrito ao lado dos botões mailto: (components/ContactEmail.tsx):
   * copiar, a confirmação de 2 s, e o que se diz se o browser não deixar copiar (o endereço
   * fica seleccionado).
   */
  contact: { copy: string; copied: string; selected: string };
  /** 01 — a primeira tela. Texto do owner. */
  hero: {
    title: string;
    sub: string;
    /** "<a quem> — <a acção>": duas linhas no botão, lido como uma frase. */
    ctaBrands: string;
    ctaCustomers: string;
    /** A faixa: {capital} é o capital do pool lido na cadeia, nunca um literal. */
    band: string;
    seePool: string;
  };
  /** Os rótulos do diagrama da primeira tela (components/proof/EscrowFlow.tsx). */
  flow: {
    customer: string;
    store: string;
    escrow: string;
    oracle: string;
    proven: string;
    /**
     * Por baixo do diagrama, o texto do owner de 27/09/2026 (commit B8): até quando o
     * pagamento fica no escrow, e o que faz uma contestação. Tomou o lugar das três camadas.
     */
    note: string;
  };
  /**
   * Os diagramas dos capítulos 02 a 04 (decisão do owner de 27/09/2026, commit B:
   * components/proof/BrandFlow, PurchaseFlow, PoolFlow). Cliente, loja, escrow, oráculo
   * e entrega provada vêm de `flow`; aqui fica só o que é novo.
   */
  diagrams: {
    brand: {
      brand: string;
      proof: string;
      proofKept: string;
      shipped: string;
      /** Os cinco passos do owner, por ordem: oferta, pagamento, envio, prova, a marca recebe. */
      steps: [string, string, string, string, string];
    };
    /**
     * O 03, uma compra (commit B8): pagamento no escrow, entrega, 5 dias para contestar,
     * árbitro, e o dinheiro sai do escrow para quem o árbitro decidir. Os passos são os
     * do owner, por essa ordem; os rótulos do desenho foram escritos à volta deles.
     */
    purchase: { delivered: string; window: string; arbiter: string; decides: string; steps: [string, string, string, string, string] };
    pool: {
      providers: string;
      capital: string;
      covered: string;
      limit: string;
      repay: string;
      /** Lidos pelos leitores de ecrã: o desenho está escondido deles. */
      steps: [string, string, string];
    };
  };
  /**
   * 02 e 03 — o texto do owner; a primeira frase é o título, o resto o corpo. No
   * 02, por baixo, as duas frases do owner de 27/09/2026 (commit B): a prova contra
   * um chargeback, e o pagamento com cartão que vem a seguir. O título do 03 é o do
   * commit B8: a loja só recebe com a confirmação ou 5 dias sem contestação.
   */
  brands: { title: string; body: string; proof: string; next: string };
  customers: { title: string; body: string };
  /** 04 — o pool, discreto, com prova: cada número é uma leitura on-chain. */
  pool: {
    label: string;
    title: string;
    body: string;
    capital: string;
    active: string;
    free: string;
    /** Um número cuja leitura falhou: nunca um número inventado. */
    notRead: string;
    contract: string;
  };
  /**
   * 05 — a grelha de cartões: a entrega verificada à frente (decisão do owner de
   * 27/09/2026, commit B) e os três módulos da Keptra. A ordem dos `items` casa com
   * `MODULES` em Landing.tsx, que é onde vivem o nome do módulo, a rota e o estado.
   * Aqui fica só o que se traduz — e o nome, quando se traduz (a entrega
   * verificada). `obligation` é a frase do owner.
   */
  modules: {
    eyebrow: string;
    title: string;
    obligation: string;
    items: { name?: string; badge: string; body: string; cta: string }[];
  };
  /** 06 — o fecho: o convite a provedores. Título, texto e botão do owner. */
  providers: {
    label: string;
    title: string;
    body: string;
    cta: string;
    /** Debaixo do botão: é um pedido, nunca um depósito. */
    note: string;
  };
  /** O filme (components/film/Film.tsx): os controlos e as legendas das formas. */
  film: {
    /** Botão que pára o movimento contínuo da cena e dos diagramas (WCAG 2.2.2). */
    pause: string;
    play: string;
    /** Legenda da forma: "<markOfRound> 42" / "<markOfCampaign> 2" (a /giveaways e a /roadmap). */
    markOfRound: string;
    markOfCampaign: string;
    markPending: string;
    /**
     * A legenda junto da forma: o que ela representa naquele capítulo, em
     * linguagem simples (components/film/Chapter.tsx SceneCaption). `entry`,
     * `prize`, `pick` e `payout` são só da /giveaways.
     */
    captions: Record<SceneCaptionKey, string>;
  };
  footer: {
    contractsLabel: string;
    responsible: string;
    /** Versão curta para o rodapé das páginas do jogo (/play/*). */
    responsibleShort: string;
    disclaimer: string;
  };
}

const en: LandingCopy = {
  metaTitle: 'Keptra — Verified delivery',
  header: { enterApp: 'Enter App', ariaLanguage: 'Language', mainModule: 'Verified delivery' },
  contact: { copy: 'Copy', copied: 'Copied', selected: 'Selected' },
  hero: {
    title: 'A brand that can prove it, cares.',
    sub: 'Keptra lets any store give its customers something no one else does: a delivery guarantee that is verified, not promised. Payment waits in escrow, an independent oracle confirms the delivery, and only then the store gets paid. No wallets, no crypto knowledge — for the store or the customer.',
    ctaBrands: 'For brands — Offer verified delivery',
    ctaCustomers: 'For customers — Buy with a guarantee you can check',
    band: 'Backed by a public guarantee pool: {capital} USDC, verified on Arbitrum One.',
    seePool: 'See the pool',
  },
  flow: {
    customer: 'Customer',
    store: 'Store',
    escrow: 'escrow',
    oracle: 'Independent oracle',
    proven: 'Delivery proven',
    note: 'Your payment stays in escrow until you confirm the delivery or 5 days pass without a contest. If you contest, an arbiter decides — and the money is still there.',
  },
  diagrams: {
    brand: {
      brand: 'Brand',
      proof: 'On-chain proof',
      proofKept: 'kept',
      shipped: 'Shipped with tracking',
      steps: ['Offer published', 'Paid into escrow', 'Shipped with tracking', 'Delivery proven', 'Brand paid'],
    },
    purchase: {
      delivered: 'Delivered',
      window: '5 days to contest',
      arbiter: 'Arbiter',
      decides: 'decides',
      steps: ['Payment in escrow', 'Delivery', '5 days to contest', 'Arbiter', 'The money leaves escrow, to whoever the arbiter decides'],
    },
    pool: {
      providers: 'Providers',
      capital: 'Pool capital',
      covered: 'Guarantees, up to the limit',
      limit: 'limit',
      repay: 'Brands pay back what the pool paid',
      steps: [
        'Providers put their capital into the pool.',
        "The pool covers brands' guarantees up to its limit.",
        'A brand pays back what the pool paid for it.',
      ],
    },
  },
  brands: {
    title: 'The stores that can show proof stand apart.',
    body: 'Transparency your customers can verify is care they can feel — and Keptra makes it a checkbox at checkout, not a project.',
    proof: 'Every delivery leaves an on-chain proof — evidence you can use against a chargeback.',
    next: 'Next: your customers pay by card, as they always do — and delivery stays guaranteed. Company being incorporated to connect card payments.',
  },
  customers: {
    title: 'Online or in store: the store is paid only when you confirm the delivery or 5 days pass without a contest — until then, the money is in escrow.',
    body: "You never need to understand how; you can always check that it's true.",
  },
  pool: {
    label: 'Guarantee pool',
    title: 'The guarantee, in public.',
    body: 'The escrow and pool contracts are on Arbitrum One, verified on Sourcify and Arbiscan.',
    capital: 'Capital',
    active: 'Active guarantees',
    free: 'Free capacity',
    notRead: 'Not read',
    contract: 'Pool contract',
  },
  modules: {
    eyebrow: 'Inside Keptra',
    title: 'One standard of proof, everywhere.',
    obligation: 'Every order is a tokenized obligation — bond, coverage and settlement on-chain. Commerce as a real-world asset.',
    items: [
      {
        name: 'Verified delivery',
        badge: 'LIVE',
        body: "Payment waits in escrow until the customer confirms the delivery or 5 days pass without a contest; a contest goes to an arbiter, with the money still in escrow. Prizes brands promise are backed by the brand's bond and, by tier, a risk reserve and the pool.",
        cta: 'For brands',
      },
      {
        badge: 'LIVE',
        body: '3 winners every 30-minute round, tickets from 1 USDC. Immutable verified contract, Chainlink VRF, prizes claimed on-chain.',
        cta: 'Open the lottery',
      },
      {
        badge: 'LIVE',
        body: 'Free entry for participants, any ERC-20 as the prize, winners drawn by Chainlink VRF. For brands, communities and creators.',
        cta: 'See the giveaway flow',
      },
      {
        badge: 'LIVE',
        body: 'Every campaign in one place, each draw with its proof. Entering needs no wallet and no crypto knowledge.',
        cta: 'Open the Event Center',
      },
    ],
  },
  providers: {
    label: 'Pool providers',
    title: 'Be part of the guarantee.',
    body: "The pool's capital comes from providers who back every order. Providers earn a share of every protection fee.",
    cta: 'Become a provider',
    note: 'Opens an email request. Keptra approves every provider — nothing is deposited from this page.',
  },
  film: {
    pause: 'Pause motion',
    play: 'Play motion',
    markOfRound: 'Drawn from the VRF transaction of round',
    markOfCampaign: 'Drawn from the VRF seed of campaign',
    markPending: 'Waiting for the first settled draw.',
    captions: {
      mark: 'This shape is drawn from the proof of the latest draw. Every draw has its own, and no one can fake it.',
      payout: 'The prize, in amber, goes from the contract to the winner\'s wallet.',
      modules: 'The three modules, each drawn from its latest draw. Giveaways and the Event Center run on one contract, so they share a shape. Green is live.',
      again: 'The shape of the latest draw, once more: the proof, drawn.',
      entry: 'An entry. The participant pays nothing for it.',
      prize: 'A coin: the prize, in any token, held by the contract until the draw.',
      pick: 'The tangle is chance; the shape is the result. The green lines are the winners.',
    },
  },
  footer: {
    contractsLabel: 'Verified Contracts · Arbitrum One',
    responsible: "18+. Play responsibly. This is a game of chance — never play with funds you can't afford to lose.",
    responsibleShort: 'Play responsibly. 18+',
    disclaimer: 'Nothing on this page is financial advice. This site is an open-source interface to on-chain smart contracts.',
  },
};

const pt: LandingCopy = {
  metaTitle: 'Keptra — Entrega verificada',
  header: { enterApp: 'Abrir app', ariaLanguage: 'Idioma', mainModule: 'Entrega verificada' },
  contact: { copy: 'Copiar', copied: 'Copiado', selected: 'Seleccionado' },
  hero: {
    title: 'Uma marca que consegue provar, cuida.',
    sub: 'A Keptra permite a qualquer loja dar aos seus clientes algo que mais ninguém dá: uma garantia de entrega verificada, não prometida. O pagamento espera num escrow, um oráculo independente confirma a entrega, e só então a loja recebe. Sem carteiras, sem saber de cripto — nem a loja, nem o cliente.',
    ctaBrands: 'Para marcas — Ofereça entrega verificada',
    ctaCustomers: 'Para clientes — Compre com uma garantia que pode conferir',
    band: 'Apoiado por um pool de garantia público: {capital} USDC, verificado na Arbitrum One.',
    seePool: 'Ver o pool',
  },
  flow: {
    customer: 'Cliente',
    store: 'Loja',
    escrow: 'escrow',
    oracle: 'Oráculo independente',
    proven: 'Entrega provada',
    note: 'O seu pagamento fica no escrow até confirmar a entrega ou passarem 5 dias sem a contestar. Se contestar, um árbitro decide — e o dinheiro ainda lá está.',
  },
  diagrams: {
    brand: {
      brand: 'Marca',
      proof: 'Prova on-chain',
      proofKept: 'que fica',
      shipped: 'Enviado com tracking',
      steps: ['Oferta publicada', 'Pago para o escrow', 'Enviado com tracking', 'Entrega provada', 'A marca recebe'],
    },
    purchase: {
      delivered: 'Entregue',
      window: '5 dias para contestar',
      arbiter: 'Árbitro',
      decides: 'decide',
      steps: ['Pagamento no escrow', 'Entrega', '5 dias para contestar', 'Árbitro', 'O dinheiro sai do escrow para quem o árbitro decidir'],
    },
    pool: {
      providers: 'Provedores',
      capital: 'Capital do pool',
      covered: 'Garantias, até ao limite',
      limit: 'limite',
      repay: 'As marcas devolvem o que o pool pagou',
      steps: [
        'Os provedores põem o seu capital no pool.',
        'O pool cobre as garantias das marcas até ao seu limite.',
        'Uma marca devolve o que o pool pagou por ela.',
      ],
    },
  },
  brands: {
    title: 'As lojas que conseguem mostrar prova destacam-se.',
    body: 'Transparência que os seus clientes podem verificar é cuidado que eles sentem — e a Keptra torna isso numa opção no checkout, não num projecto.',
    proof: 'Cada entrega deixa uma prova on-chain — uma evidência que pode usar para contestar um chargeback.',
    next: 'A seguir: os seus clientes pagam com cartão, como sempre — e a entrega continua garantida. Empresa em constituição para ligar os pagamentos com cartão.',
  },
  customers: {
    title: 'Online ou na loja: a loja só recebe quando confirmar a entrega ou passarem 5 dias sem a contestar — até lá, o dinheiro está no escrow.',
    body: 'Nunca precisa de perceber como; pode sempre conferir que é verdade.',
  },
  pool: {
    label: 'Pool de garantia',
    title: 'A garantia, em público.',
    body: 'Os contratos do escrow e do pool estão na Arbitrum One, verificados no Sourcify e no Arbiscan.',
    capital: 'Capital',
    active: 'Garantias activas',
    free: 'Capacidade livre',
    notRead: 'Não lido',
    contract: 'Contrato do pool',
  },
  modules: {
    eyebrow: 'Dentro da Keptra',
    title: 'Um só padrão de prova, em tudo.',
    obligation: 'Cada encomenda é uma obrigação tokenizada — caução, cobertura e liquidação on-chain. O comércio como activo do mundo real.',
    items: [
      {
        name: 'Entrega verificada',
        badge: 'AO VIVO',
        body: 'O pagamento espera num escrow até o cliente confirmar a entrega ou passarem 5 dias sem contestação; uma contestação vai a um árbitro, com o dinheiro ainda no escrow. Os prémios que as marcas prometem são garantidos pela caução da marca e, conforme o escalão, por uma reserva de risco e pelo pool.',
        cta: 'Para marcas',
      },
      {
        badge: 'AO VIVO',
        body: '3 vencedores em cada ronda de 30 minutos, bilhetes a partir de 1 USDC. Contrato imutável e verificado, Chainlink VRF, prémios levantados on-chain.',
        cta: 'Abrir a lotaria',
      },
      {
        badge: 'AO VIVO',
        body: 'Entrada gratuita para os participantes, qualquer ERC-20 como prémio, vencedores sorteados pelo Chainlink VRF. Para marcas, comunidades e criadores.',
        cta: 'Ver o fluxo de criação',
      },
      {
        badge: 'AO VIVO',
        body: 'Todas as campanhas num só lugar, cada sorteio com a sua prova. Para participar não é preciso wallet nem conhecimentos de cripto.',
        cta: 'Abrir o Event Center',
      },
    ],
  },
  providers: {
    label: 'Provedores do pool',
    title: 'Faça parte da garantia.',
    body: 'O capital do pool vem de provedores que sustentam cada encomenda. Os provedores recebem uma parte de cada taxa de protecção.',
    cta: 'Tornar-me provedor',
    note: 'Abre um pedido por email. A Keptra aprova cada provedor — nada é depositado a partir desta página.',
  },
  film: {
    pause: 'Pausar movimento',
    play: 'Retomar movimento',
    markOfRound: 'Desenhada a partir da transacção do VRF da ronda',
    markOfCampaign: 'Desenhada a partir da semente do VRF da campanha',
    markPending: 'À espera do primeiro sorteio liquidado.',
    captions: {
      mark: 'Esta forma é desenhada a partir da prova do último sorteio. Cada sorteio tem a sua, e ninguém consegue falsificá-la.',
      payout: 'O prémio, em âmbar, sai do contrato para a wallet de quem ganhou.',
      modules: 'Os três módulos, cada um desenhado a partir do seu último sorteio. Os Giveaways e o Event Center funcionam no mesmo contrato, por isso têm a mesma forma. Verde é o que está no ar.',
      again: 'A forma do último sorteio, outra vez: a prova, desenhada.',
      entry: 'Uma inscrição. Quem participa não paga nada por ela.',
      prize: 'Uma moeda: o prémio, em qualquer token, guardado pelo contrato até ao sorteio.',
      pick: 'O emaranhado é o acaso; a forma é o resultado. As linhas verdes são os vencedores.',
    },
  },
  footer: {
    contractsLabel: 'Contratos verificados · Arbitrum One',
    responsible: '18+. Jogue com responsabilidade. Este é um jogo de azar — nunca jogue com dinheiro que não pode perder.',
    responsibleShort: 'Jogue com responsabilidade. 18+',
    disclaimer: 'Nada nesta página constitui aconselhamento financeiro. Este site é uma interface open-source para smart contracts on-chain.',
  },
};

const es: LandingCopy = {
  metaTitle: 'Keptra — Entrega verificada',
  header: { enterApp: 'Abrir app', ariaLanguage: 'Idioma', mainModule: 'Entrega verificada' },
  contact: { copy: 'Copiar', copied: 'Copiado', selected: 'Seleccionado' },
  hero: {
    title: 'Una marca que puede probarlo, cuida.',
    sub: 'Keptra permite a cualquier tienda dar a sus clientes algo que nadie más da: una garantía de entrega verificada, no prometida. El pago espera en un escrow, un oráculo independiente confirma la entrega, y solo entonces la tienda cobra. Sin wallets, sin saber de cripto — ni la tienda, ni el cliente.',
    ctaBrands: 'Para marcas — Ofrece entrega verificada',
    ctaCustomers: 'Para clientes — Compra con una garantía que puedes comprobar',
    band: 'Respaldado por un pool de garantía público: {capital} USDC, verificado en Arbitrum One.',
    seePool: 'Ver el pool',
  },
  flow: {
    customer: 'Cliente',
    store: 'Tienda',
    escrow: 'escrow',
    oracle: 'Oráculo independiente',
    proven: 'Entrega probada',
    note: 'Tu pago se queda en el escrow hasta que confirmes la entrega o pasen 5 días sin impugnarla. Si la impugnas, un árbitro decide — y el dinero sigue ahí.',
  },
  diagrams: {
    brand: {
      brand: 'Marca',
      proof: 'Prueba on-chain',
      proofKept: 'que queda',
      shipped: 'Enviado con seguimiento',
      steps: ['Oferta publicada', 'Pagado al escrow', 'Enviado con seguimiento', 'Entrega probada', 'La marca cobra'],
    },
    purchase: {
      delivered: 'Entregado',
      window: '5 días para impugnar',
      arbiter: 'Árbitro',
      decides: 'decide',
      steps: ['Pago en el escrow', 'Entrega', '5 días para impugnar', 'Árbitro', 'El dinero sale del escrow hacia quien el árbitro decida'],
    },
    pool: {
      providers: 'Proveedores',
      capital: 'Capital del pool',
      covered: 'Garantías, hasta el límite',
      limit: 'límite',
      repay: 'Las marcas devuelven lo que pagó el pool',
      steps: [
        'Los proveedores ponen su capital en el pool.',
        'El pool cubre las garantías de las marcas hasta su límite.',
        'Una marca devuelve lo que el pool pagó por ella.',
      ],
    },
  },
  brands: {
    title: 'Las tiendas que pueden mostrar prueba se distinguen.',
    body: 'La transparencia que tus clientes pueden verificar es cuidado que sienten — y Keptra la convierte en una opción en el checkout, no en un proyecto.',
    proof: 'Cada entrega deja una prueba on-chain — una evidencia que puedes usar para disputar un contracargo.',
    next: 'Próximamente: tus clientes pagan con tarjeta, como siempre — y la entrega sigue garantizada. Empresa en constitución para conectar los pagos con tarjeta.',
  },
  customers: {
    title: 'Online o en tienda: la tienda solo cobra cuando confirmas la entrega o pasan 5 días sin impugnarla — hasta entonces, el dinero está en el escrow.',
    body: 'Nunca necesitas entender cómo; siempre puedes comprobar que es verdad.',
  },
  pool: {
    label: 'Pool de garantía',
    title: 'La garantía, en público.',
    body: 'Los contratos del escrow y del pool están en Arbitrum One, verificados en Sourcify y Arbiscan.',
    capital: 'Capital',
    active: 'Garantías activas',
    free: 'Capacidad libre',
    notRead: 'No leído',
    contract: 'Contrato del pool',
  },
  modules: {
    eyebrow: 'Dentro de Keptra',
    title: 'Un solo estándar de prueba, en todo.',
    obligation: 'Cada pedido es una obligación tokenizada — fianza, cobertura y liquidación on-chain. El comercio como activo del mundo real.',
    items: [
      {
        name: 'Entrega verificada',
        badge: 'EN VIVO',
        body: 'El pago espera en un escrow hasta que el cliente confirma la entrega o pasan 5 días sin impugnación; una impugnación va a un árbitro, con el dinero aún en el escrow. Los premios que prometen las marcas están garantizados por la fianza de la marca y, según el nivel, por una reserva de riesgo y el pool.',
        cta: 'Para marcas',
      },
      {
        badge: 'EN VIVO',
        body: '3 ganadores por ronda de 30 minutos, boletos desde 1 USDC. Contrato inmutable y verificado, Chainlink VRF, premios reclamados on-chain.',
        cta: 'Abrir la lotería',
      },
      {
        badge: 'EN VIVO',
        body: 'Entrada gratuita para los participantes, cualquier ERC-20 como premio, ganadores sorteados con Chainlink VRF. Para marcas, comunidades y creadores.',
        cta: 'Ver el flujo de creación',
      },
      {
        badge: 'EN VIVO',
        body: 'Todas las campañas en un solo lugar, cada sorteo con su prueba. Para participar no hace falta wallet ni saber de cripto.',
        cta: 'Abrir el Event Center',
      },
    ],
  },
  providers: {
    label: 'Proveedores del pool',
    title: 'Forma parte de la garantía.',
    body: 'El capital del pool viene de proveedores que respaldan cada pedido. Los proveedores reciben una parte de cada tarifa de protección.',
    cta: 'Quiero ser proveedor',
    note: 'Abre una solicitud por correo. Keptra aprueba a cada proveedor — desde esta página no se deposita nada.',
  },
  film: {
    pause: 'Pausar movimiento',
    play: 'Reanudar movimiento',
    markOfRound: 'Dibujada a partir de la transacción del VRF de la ronda',
    markOfCampaign: 'Dibujada a partir de la semilla del VRF de la campaña',
    markPending: 'Esperando el primer sorteo liquidado.',
    captions: {
      mark: 'Esta forma se dibuja a partir de la prueba del último sorteo. Cada sorteo tiene la suya, y nadie puede falsificarla.',
      payout: 'El premio, en ámbar, sale del contrato hacia la wallet de quien ganó.',
      modules: 'Los tres módulos, cada uno dibujado a partir de su último sorteo. Los Giveaways y el Event Center funcionan en el mismo contrato, por eso comparten la forma. El verde es lo que está en marcha.',
      again: 'La forma del último sorteo, otra vez: la prueba, dibujada.',
      entry: 'Una participación. Quien participa no paga nada por ella.',
      prize: 'Una moneda: el premio, en cualquier token, guardado por el contrato hasta el sorteo.',
      pick: 'La maraña es el azar; la forma es el resultado. Las líneas verdes son los ganadores.',
    },
  },
  footer: {
    contractsLabel: 'Contratos verificados · Arbitrum One',
    responsible: 'Solo 18+. Juega con responsabilidad. Este es un juego de azar — nunca juegues con dinero que no puedas permitirte perder.',
    responsibleShort: 'Juega con responsabilidad. 18+',
    disclaimer: 'Nada en esta página constituye asesoramiento financiero. Este sitio es una interfaz open-source hacia smart contracts on-chain.',
  },
};

export const translations: Record<Lang, LandingCopy> = { en, pt, es };

export const LANG_LABEL: Record<Lang, string> = { en: 'EN', pt: 'PT', es: 'ES' };

/**
 * Idioma inicial. SEMPRE 'en' — produto global, inglês por defeito.
 *
 * Não há detecção por `navigator.language`: a única coisa que muda o idioma é a
 * escolha explícita do utilizador, e é essa escolha (e só essa) que fica em
 * localStorage. Um visitante com o browser em pt-BR vê inglês até carregar em PT.
 */
function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'pt' || stored === 'es') return stored;
  } catch {
    /* localStorage indisponível (modo privado) — fica o default */
  }
  return 'en';
}

/*
 * Store partilhado por todos os `useLang()`.
 *
 * A Landing, a Navbar do jogo e o rodapé chamam o hook em sítios diferentes da
 * árvore. Com um `useState` por chamada, mudar o idioma na Navbar deixava o
 * rodapé na língua anterior até haver reload. `useSyncExternalStore` (React 18)
 * mantém todas as instâncias no mesmo valor sem precisar de Context.
 */
let currentLang: Lang = readStoredLang();
const langListeners = new Set<() => void>();

/*
 * O documento declara a língua do conteúdo: desde que o site carrega (a língua
 * guardada) e a cada escolha. Todas as páginas seguem o selector — as do Keptra
 * também, desde a decisão do owner de 27/09/2026 (T17 revista) —, por isso a língua
 * escolhida é a do conteúdo em qualquer página, e o leitor de ecrã lê-o com a voz
 * certa. Antes vivia num efeito de useLang, e só se aplicava quando uma página que
 * o chamava abria.
 */
function declareLang(lang: Lang): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}
declareLang(currentLang);

function subscribeLang(onChange: () => void): () => void {
  langListeners.add(onChange);
  return () => {
    langListeners.delete(onChange);
  };
}

function getLangSnapshot(): Lang {
  return currentLang;
}

/** Escolha explícita do utilizador: persiste e notifica todas as instâncias. */
export function setLang(next: Lang): void {
  if (next === currentLang) return;
  currentLang = next;
  declareLang(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignora falha de persistência */
  }
  langListeners.forEach((notify) => notify());
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribeLang, getLangSnapshot, getLangSnapshot);
  return [lang, setLang];
}
