import { useEffect, useSyncExternalStore } from 'react';

// i18n da landing. As strings do jogo (/play/*) vivem em ./app.i18n.ts e
// partilham o `Lang`, o `useLang` e o localStorage daqui — mudar o idioma num
// lado muda no outro. No i18n library: um objecto de lookup por idioma mais um
// hook minúsculo chegam para três idiomas.

export type Lang = 'en' | 'pt' | 'es';
export const LANGS: Lang[] = ['en', 'pt', 'es'];
const STORAGE_KEY = 'iw-lang';

// Technical terms kept in English across all languages (industry convention):
// Chainlink VRF, USDC, Arbitrum One, on-chain, wallet, smart contract, open-source.
export type SceneCaptionKey = 'mark' | 'ticket' | 'draw' | 'seal' | 'reveal' | 'payout' | 'escrow' | 'modules' | 'again' | 'entry' | 'prize' | 'pick';

export interface LandingCopy {
  /** O título do separador da página inicial: o produto e a página. */
  metaTitle: string;
  header: { enterApp: string; ariaLanguage: string };
  hero: { badge: string; headlineTop: string; headlineBottom: string; sub: string; cta: string };
  /**
   * Os três módulos do Event Center. A ordem casa com `MODULES` em Landing.tsx,
   * que é onde vivem o nome do módulo, a rota e o estado — mesma convenção dos
   * STEP_ICONS. Aqui fica só o que se traduz.
   */
  modules: {
    eyebrow: string;
    title: string;
    sub: string;
    /** Sufixo do badge da lottery enquanto `PRELAUNCH` for true. */
    prelaunchTag: string;
    items: { badge: string; body: string; cta: string }[];
  };
  /** Cabeçalho do bloco que reúne a prova da lottery (how/why/transparency/FAQ). */
  lottery: { eyebrow: string; title: string; intro: string };
  how: {
    eyebrow: string;
    title: string;
    steps: { title: string; body: string }[]; // order matches STEP_ICONS in Landing.tsx
  };
  why: {
    eyebrow: string;
    title: string;
    colInstant: string;
    colTraditional: string;
    rows: { label: string; instant: string; traditional: string }[];
  };
  transparency: { eyebrow: string; title: string; vrfPre: string; vrfPost: string };
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  finalCta: { title: string; share: string };
  /**
   * Modo pré-lançamento (constants.PRELAUNCH). Substitui o CTA "PLAY NOW" por
   * uma chamada à lista de espera. Sem datas: não há data para prometer.
   * Usado também no banner de /play, para haver uma só fonte desta mensagem.
   */
  prelaunch: { headline: string; cta: string };
  /**
   * O filme da página inicial (segunda passagem visual). Só as frases que a
   * narrativa exige; tudo o resto reutiliza o texto que já existia acima.
   */
  film: {
    /** Botão que pára o movimento contínuo da cena (WCAG 2.2.2). */
    pause: string;
    play: string;
    /** Legenda da forma: "<markOfRound> 42" / "<markOfCampaign> 2". */
    markOfRound: string;
    markOfCampaign: string;
    markPending: string;
    /** O conceito, numa linha, no capítulo da revelação. */
    markLine: string;
    revealTitle: string;
    campaignLabel: string;
    seeCampaign: string;
    keptra: {
      title: string;
      body: string;
      failure: string;
      /** Os nós do percurso: quem paga, o escrow, a loja. */
      path: [string, string, string];
      /** A ordem de absorção de uma falha: caução, reserva, capital. */
      layers: [string, string, string];
      cta: string;
    };
    /**
     * A legenda junto da forma: o que ela representa naquele capítulo, em
     * linguagem simples (components/film/Chapter.tsx SceneCaption). As últimas
     * três são só da /giveaways.
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
  metaTitle: 'Instant Win — Provably fair events',
  header: { enterApp: 'Enter App', ariaLanguage: 'Language' },
  hero: {
    badge: 'Powered by Chainlink VRF',
    headlineTop: 'Provably fair events.',
    headlineBottom: 'Proof, not promise.',
    sub: 'An on-chain Event Center on Arbitrum One: lotteries, giveaways and rewards where every winner is drawn by Chainlink VRF and every prize is claimed straight from the contract.',
    cta: 'PLAY NOW',
  },
  modules: {
    eyebrow: 'The Event Center',
    title: 'Three modules, one standard of proof.',
    sub: 'Each module ships in order. None is announced as done before it is verifiable on-chain.',
    prelaunchTag: 'PRE-LAUNCH',
    items: [
      {
        badge: 'LIVE',
        body: '3 winners every 30-minute round, tickets from 1 USDC. Immutable verified contract, Chainlink VRF, prizes claimed on-chain.',
        cta: 'Open the lottery',
      },
      {
        badge: 'DEPLOYED · OPENING SOON',
        body: 'Free entry for participants, any ERC-20 as the prize, winners drawn by Chainlink VRF. For brands, communities and creators.',
        cta: 'See the giveaway flow',
      },
      {
        badge: 'ROADMAP',
        body: 'Web2 onboarding for people who have never held a wallet, points for real engagement, and token economics under legal structuring.',
        cta: 'Read the roadmap',
      },
    ],
  },
  lottery: {
    eyebrow: 'Module 01 · Live now',
    title: 'The lottery, running on Arbitrum One.',
    intro:
      'The first live event in the Event Center — and the proof the rest is built on. Everything below is deployed code you can read today.',
  },
  how: {
    eyebrow: 'How it works',
    title: "Three steps. That's it.",
    steps: [
      { title: 'Connect & grab tickets', body: 'Connect your wallet and buy tickets. 1 ticket = 1 USDC.' },
      { title: 'VRF draws 3 winners', body: 'Chainlink VRF draws 3 winners in every 30-minute round — pure verifiable randomness, no human hands.' },
      { title: 'Claim your prize', body: 'The contract credits your prize the moment the round settles. Claim it from your wallet whenever you want — it never expires.' },
    ],
  },
  why: {
    eyebrow: "Why it's different",
    title: 'On-chain, not on trust.',
    colInstant: 'Instant Win',
    colTraditional: 'Traditional lottery',
    rows: [
      { label: 'Draws', instant: 'Every 30-minute round', traditional: 'Weekly' },
      { label: 'Randomness', instant: 'Chainlink VRF, on-chain proof', traditional: 'Trust the operator' },
      { label: 'Payout', instant: 'Credited on-chain, you claim it', traditional: 'Claim in person, with a deadline' },
      { label: 'To players', instant: '85.7% of ticket money over time', traditional: 'Rarely disclosed' },
      { label: 'Rules', instant: 'Open-source contracts anyone can read', traditional: 'Closed systems' },
    ],
  },
  transparency: {
    eyebrow: 'Transparency',
    title: "Don't trust. Verify.",
    vrfPre: 'Every draw is settled by ',
    vrfPost: ', which provides cryptographically verifiable randomness that no one — not even us — can predict or tamper with. This website is only an interface: the game itself lives on-chain.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Good questions.',
    items: [
      { q: 'What do I need to play?', a: 'An Arbitrum One wallet (such as MetaMask) with some USDC for tickets and a little ETH for gas.' },
      { q: 'What is USDC and where do I get it?', a: 'USDC is a US-dollar stablecoin. You can buy it on most exchanges and move it to the Arbitrum One network.' },
      { q: 'How are winners picked?', a: 'Chainlink VRF produces verifiable on-chain randomness. Each draw selects 3 winners and the proof is public — anyone can check it.' },
      { q: 'When do I get paid?', a: 'The contract credits your prize the moment the round settles, and you withdraw it with one transaction from the app. It is held on-chain in your name until you do — there is no deadline and it cannot be taken back.' },
      { q: 'How much of the money goes to players?', a: 'About 85.7% over time. Each round pays 75% of its pool to the three winners and 12.5% to development; the other 12.5% rolls into the next round, so it comes back to players — minus the same development share each time it recycles.' },
      { q: 'What are the odds?', a: 'Your chance in a round depends only on how many tickets you hold versus the total tickets in that round. It is luck, not strategy.' },
      { q: 'Is this available in my country?', a: 'Access depends on the rules of your own jurisdiction. It is your responsibility to check whether you are allowed to participate where you live.' },
      { q: 'Who runs this?', a: 'The game runs entirely on-chain through open-source smart contracts. This website is only an open interface to them.' },
    ],
  },
  finalCta: { title: 'The next draw is already running.', share: 'Share' },
  prelaunch: { headline: 'Day 0 is coming.', cta: 'Join the waitlist' },
  film: {
    pause: 'Pause motion',
    play: 'Play motion',
    markOfRound: 'Drawn from the VRF transaction of round',
    markOfCampaign: 'Drawn from the VRF seed of campaign',
    markPending: 'Waiting for the first settled draw.',
    markLine: 'Every settled draw leaves a shape drawn from its own proof. Same proof, same shape.',
    revealTitle: 'Winners, with their proof.',
    campaignLabel: 'Campaign',
    seeCampaign: 'See the campaign',
    keptra: {
      title: 'The same proof, for what you buy.',
      body: 'Your payment waits in an on-chain escrow. A proven delivery opens the way to the store.',
      failure: "If a brand fails a winner, the pool pays: the brand's bond first, then the risk reserve, then the capital.",
      path: ['You', 'Escrow', 'Store'],
      layers: ['Bond', 'Risk reserve', 'Capital'],
      cta: 'See the guarantee pool',
    },
    captions: {
      mark: 'This shape is drawn from the proof of the latest draw. Every draw has its own, and no one can fake it.',
      ticket: 'A ticket. Each one is one chance in the round.',
      draw: 'The tangle is chance before the draw; the shape is the result, once it is picked.',
      seal: 'The result, closed inside a block of the public record. From then on, no one can change it.',
      reveal: 'The same shape, seen face on. The green lines are the winners.',
      payout: 'The prize, in amber, goes from the contract to the winner\'s wallet.',
      escrow: 'Your payment waits in the middle. The green path to the store opens only once delivery is proven; the three layers below cover a failure.',
      modules: 'The three modules. A shape marks one that already has a draw; rings mark one that has none yet. Green is live.',
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
  metaTitle: 'Instant Win — Eventos comprovadamente justos',
  header: { enterApp: 'Abrir app', ariaLanguage: 'Idioma' },
  hero: {
    badge: 'Com tecnologia Chainlink VRF',
    headlineTop: 'Eventos comprovadamente justos.',
    headlineBottom: 'Prova, não promessa.',
    sub: 'Um Event Center on-chain na Arbitrum One: loterias, sorteios e recompensas em que cada ganhador é sorteado pelo Chainlink VRF e cada prêmio é resgatado direto do contrato.',
    cta: 'JOGAR AGORA',
  },
  modules: {
    eyebrow: 'O Event Center',
    title: 'Três módulos, um só padrão de prova.',
    sub: 'Cada módulo entra em ordem. Nenhum é anunciado como pronto antes de ser verificável on-chain.',
    prelaunchTag: 'PRÉ-LANÇAMENTO',
    items: [
      {
        badge: 'AO VIVO',
        body: '3 ganhadores a cada rodada de 30 minutos, bilhetes a partir de 1 USDC. Contrato imutável e verificado, Chainlink VRF, prêmios resgatados on-chain.',
        cta: 'Abrir a loteria',
      },
      {
        badge: 'DEPLOYADO · ABRE EM BREVE',
        body: 'Entrada gratuita para os participantes, qualquer ERC-20 como prêmio, ganhadores sorteados pelo Chainlink VRF. Para marcas, comunidades e criadores.',
        cta: 'Ver o fluxo de criação',
      },
      {
        badge: 'ROADMAP',
        body: 'Onboarding web2 para quem nunca teve uma wallet, pontos por engajamento real e economia de token em estruturação jurídica.',
        cta: 'Ler o roadmap',
      },
    ],
  },
  lottery: {
    eyebrow: 'Módulo 01 · Ao vivo',
    title: 'A loteria, rodando na Arbitrum One.',
    intro:
      'O primeiro evento ao vivo do Event Center — e a prova sobre a qual o resto é construído. Tudo abaixo é código deployado que você pode ler hoje.',
  },
  how: {
    eyebrow: 'Como funciona',
    title: 'Três passos. Só isso.',
    steps: [
      { title: 'Conecte e pegue bilhetes', body: 'Conecte sua wallet e compre bilhetes. 1 bilhete = 1 USDC.' },
      { title: 'O VRF sorteia 3 ganhadores', body: 'O Chainlink VRF sorteia 3 ganhadores em cada rodada de 30 minutos — aleatoriedade verificável, sem mãos humanas.' },
      { title: 'Resgate seu prêmio', body: 'O contrato credita seu prêmio no instante em que a rodada é liquidada. Resgate pela sua wallet quando quiser — não expira.' },
    ],
  },
  why: {
    eyebrow: 'Por que é diferente',
    title: 'On-chain, não na confiança.',
    colInstant: 'Instant Win',
    colTraditional: 'Loteria tradicional',
    rows: [
      { label: 'Sorteios', instant: 'A cada rodada de 30 minutos', traditional: 'Semanal' },
      { label: 'Aleatoriedade', instant: 'Chainlink VRF, prova on-chain', traditional: 'Confie no operador' },
      { label: 'Pagamento', instant: 'Creditado on-chain, você resgata', traditional: 'Resgate presencial, com prazo' },
      { label: 'Para os jogadores', instant: '85,7% do dinheiro dos bilhetes ao longo do tempo', traditional: 'Raramente divulgado' },
      { label: 'Regras', instant: 'Contratos open-source que qualquer um pode ler', traditional: 'Sistemas fechados' },
    ],
  },
  transparency: {
    eyebrow: 'Transparência',
    title: 'Não confie. Verifique.',
    vrfPre: 'Cada sorteio é definido pelo ',
    vrfPost: ', que fornece aleatoriedade verificável por criptografia que ninguém — nem mesmo nós — pode prever ou manipular. Este site é apenas uma interface: o jogo em si vive on-chain.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Boas perguntas.',
    items: [
      { q: 'O que eu preciso para jogar?', a: 'Uma wallet na Arbitrum One (como a MetaMask) com um pouco de USDC para os bilhetes e um pouco de ETH para o gas.' },
      { q: 'O que é USDC e onde consigo?', a: 'USDC é uma stablecoin atrelada ao dólar americano. Você pode comprá-la na maioria das exchanges e transferi-la para a rede Arbitrum One.' },
      { q: 'Como os ganhadores são escolhidos?', a: 'O Chainlink VRF gera aleatoriedade verificável on-chain. Cada sorteio escolhe 3 ganhadores e a prova é pública — qualquer um pode conferir.' },
      { q: 'Quando eu recebo?', a: 'O contrato credita seu prêmio no instante em que a rodada é liquidada, e você saca com uma transação pelo app. Fica guardado on-chain no seu nome até você sacar — sem prazo e sem ninguém poder tirar de volta.' },
      { q: 'Quanto do dinheiro vai para os jogadores?', a: 'Cerca de 85,7% ao longo do tempo. Cada rodada paga 75% do seu pool aos três ganhadores e 12,5% ao desenvolvimento; os outros 12,5% entram na rodada seguinte, ou seja, voltam para os jogadores — menos a mesma fatia de desenvolvimento a cada reciclagem.' },
      { q: 'Quais são as chances?', a: 'Sua chance em uma rodada depende apenas de quantos bilhetes você tem em relação ao total de bilhetes daquela rodada. É sorte, não estratégia.' },
      { q: 'Está disponível no meu país?', a: 'O acesso depende das regras da sua própria jurisdição. É sua responsabilidade verificar se você tem permissão para participar no lugar onde vive.' },
      { q: 'Quem administra isto?', a: 'O jogo roda inteiramente on-chain por meio de smart contracts open-source. Este site é apenas uma interface aberta para eles.' },
    ],
  },
  finalCta: { title: 'O próximo sorteio já está rolando.', share: 'Compartilhar' },
  prelaunch: { headline: 'O Dia 0 está chegando.', cta: 'Entrar na lista' },
  film: {
    pause: 'Pausar movimento',
    play: 'Retomar movimento',
    markOfRound: 'Desenhada a partir da transação do VRF da rodada',
    markOfCampaign: 'Desenhada a partir da semente do VRF da campanha',
    markPending: 'Aguardando o primeiro sorteio liquidado.',
    markLine: 'Cada sorteio liquidado deixa uma forma desenhada a partir da própria prova. Mesma prova, mesma forma.',
    revealTitle: 'Ganhadores, com a prova.',
    campaignLabel: 'Campanha',
    seeCampaign: 'Ver a campanha',
    keptra: {
      title: 'A mesma prova, para o que você compra.',
      body: 'Seu pagamento espera num escrow on-chain. Uma entrega provada abre o caminho até a loja.',
      failure: 'Se uma marca falha com um ganhador, o pool paga: primeiro a caução da marca, depois a reserva de risco, depois o capital.',
      path: ['Você', 'Escrow', 'Loja'],
      layers: ['Caução', 'Reserva de risco', 'Capital'],
      cta: 'Ver o pool de garantia',
    },
    captions: {
      mark: 'Esta forma é desenhada a partir da prova do último sorteio. Cada sorteio tem a sua, e ninguém consegue falsificá-la.',
      ticket: 'Um bilhete. Cada um é uma chance na rodada.',
      draw: 'O emaranhado é o acaso antes do sorteio; a forma é o resultado, depois de escolhido.',
      seal: 'O resultado, fechado dentro de um bloco do registro público. A partir daí, ninguém pode mudá-lo.',
      reveal: 'A mesma forma, vista de frente. As linhas verdes são os ganhadores.',
      payout: 'O prêmio, em âmbar, sai do contrato para a wallet de quem ganhou.',
      escrow: 'O seu pagamento espera no meio. O caminho verde até a loja só abre quando a entrega é provada; as três camadas de baixo cobrem uma falha.',
      modules: 'Os três módulos. Uma forma marca o que já tem um sorteio; anéis marcam o que ainda não tem. Verde é o que está no ar.',
      again: 'A forma do último sorteio, outra vez: a prova, desenhada.',
      entry: 'Uma inscrição. Quem participa não paga nada por ela.',
      prize: 'Uma moeda: o prêmio, em qualquer token, guardado pelo contrato até o sorteio.',
      pick: 'O emaranhado é o acaso; a forma é o resultado. As linhas verdes são os ganhadores.',
    },
  },
  footer: {
    contractsLabel: 'Contratos verificados · Arbitrum One',
    responsible: 'É preciso ter 18+. Jogue com responsabilidade. Este é um jogo de azar — nunca jogue com dinheiro que você não pode perder.',
    responsibleShort: 'Jogue com responsabilidade. 18+',
    disclaimer: 'Nada nesta página constitui aconselhamento financeiro. Este site é uma interface open-source para smart contracts on-chain.',
  },
};

const es: LandingCopy = {
  metaTitle: 'Instant Win — Eventos demostrablemente justos',
  header: { enterApp: 'Abrir app', ariaLanguage: 'Idioma' },
  hero: {
    badge: 'Con tecnología Chainlink VRF',
    headlineTop: 'Eventos demostrablemente justos.',
    headlineBottom: 'Prueba, no promesa.',
    sub: 'Un Event Center on-chain en Arbitrum One: loterías, sorteos y recompensas donde cada ganador se sortea con Chainlink VRF y cada premio se reclama directamente del contrato.',
    cta: 'JUGAR AHORA',
  },
  modules: {
    eyebrow: 'El Event Center',
    title: 'Tres módulos, un mismo estándar de prueba.',
    sub: 'Cada módulo llega en orden. Ninguno se anuncia como listo antes de ser verificable on-chain.',
    prelaunchTag: 'PRELANZAMIENTO',
    items: [
      {
        badge: 'EN VIVO',
        body: '3 ganadores por ronda de 30 minutos, boletos desde 1 USDC. Contrato inmutable y verificado, Chainlink VRF, premios reclamados on-chain.',
        cta: 'Abrir la lotería',
      },
      {
        badge: 'DESPLEGADO · ABRE PRONTO',
        body: 'Entrada gratuita para los participantes, cualquier ERC-20 como premio, ganadores sorteados con Chainlink VRF. Para marcas, comunidades y creadores.',
        cta: 'Ver el flujo de creación',
      },
      {
        badge: 'ROADMAP',
        body: 'Onboarding web2 para quien nunca ha tenido una wallet, puntos por participación real y economía de token bajo estructuración legal.',
        cta: 'Leer el roadmap',
      },
    ],
  },
  lottery: {
    eyebrow: 'Módulo 01 · En vivo',
    title: 'La lotería, funcionando en Arbitrum One.',
    intro:
      'El primer evento en vivo del Event Center — y la prueba sobre la que se construye el resto. Todo lo de abajo es código desplegado que puedes leer hoy.',
  },
  how: {
    eyebrow: 'Cómo funciona',
    title: 'Tres pasos. Nada más.',
    steps: [
      { title: 'Conecta y toma boletos', body: 'Conecta tu wallet y compra boletos. 1 boleto = 1 USDC.' },
      { title: 'El VRF sortea 3 ganadores', body: 'Chainlink VRF sortea 3 ganadores en cada ronda de 30 minutos — aleatoriedad verificable, sin manos humanas.' },
      { title: 'Reclama tu premio', body: 'El contrato acredita tu premio en el instante en que la ronda se liquida. Recláma­lo desde tu wallet cuando quieras — no caduca.' },
    ],
  },
  why: {
    eyebrow: 'Por qué es diferente',
    title: 'On-chain, no en la confianza.',
    colInstant: 'Instant Win',
    colTraditional: 'Lotería tradicional',
    rows: [
      { label: 'Sorteos', instant: 'Cada ronda de 30 minutos', traditional: 'Semanal' },
      { label: 'Aleatoriedad', instant: 'Chainlink VRF, prueba on-chain', traditional: 'Confía en el operador' },
      { label: 'Pago', instant: 'Acreditado on-chain, tú lo reclamas', traditional: 'Reclamo presencial, con plazo' },
      { label: 'Para los jugadores', instant: '85,7% del dinero de los boletos con el tiempo', traditional: 'Rara vez se divulga' },
      { label: 'Reglas', instant: 'Contratos open-source que cualquiera puede leer', traditional: 'Sistemas cerrados' },
    ],
  },
  transparency: {
    eyebrow: 'Transparencia',
    title: 'No confíes. Verifica.',
    vrfPre: 'Cada sorteo se define con ',
    vrfPost: ', que aporta aleatoriedad verificable por criptografía que nadie — ni siquiera nosotros — puede predecir ni manipular. Este sitio es solo una interfaz: el juego en sí vive on-chain.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Buenas preguntas.',
    items: [
      { q: '¿Qué necesito para jugar?', a: 'Una wallet en Arbitrum One (como MetaMask) con algo de USDC para los boletos y un poco de ETH para el gas.' },
      { q: '¿Qué es USDC y dónde lo consigo?', a: 'USDC es una stablecoin ligada al dólar estadounidense. Puedes comprarla en la mayoría de los exchanges y moverla a la red Arbitrum One.' },
      { q: '¿Cómo se eligen los ganadores?', a: 'Chainlink VRF genera aleatoriedad verificable on-chain. Cada sorteo elige 3 ganadores y la prueba es pública — cualquiera puede verificarla.' },
      { q: '¿Cuándo me pagan?', a: 'El contrato acredita tu premio en el instante en que la ronda se liquida, y lo retiras con una transacción desde la app. Queda guardado on-chain a tu nombre hasta que lo hagas — sin plazo y sin que nadie pueda quitártelo.' },
      { q: '¿Cuánto dinero va a los jugadores?', a: 'Alrededor del 85,7% con el tiempo. Cada ronda paga el 75% de su pool a los tres ganadores y el 12,5% al desarrollo; el otro 12,5% pasa a la ronda siguiente, o sea vuelve a los jugadores — menos la misma parte de desarrollo cada vez que se recicla.' },
      { q: '¿Cuáles son las probabilidades?', a: 'Tu probabilidad en una ronda depende solo de cuántos boletos tienes frente al total de boletos de esa ronda. Es suerte, no estrategia.' },
      { q: '¿Está disponible en mi país?', a: 'El acceso depende de las normas de tu propia jurisdicción. Es tu responsabilidad verificar si tienes permiso para participar en el lugar donde vives.' },
      { q: '¿Quién administra esto?', a: 'El juego funciona por completo on-chain mediante smart contracts open-source. Este sitio es solo una interfaz abierta hacia ellos.' },
    ],
  },
  finalCta: { title: 'El próximo sorteo ya está en marcha.', share: 'Compartir' },
  prelaunch: { headline: 'El Día 0 se acerca.', cta: 'Unirse a la lista' },
  film: {
    pause: 'Pausar movimiento',
    play: 'Reanudar movimiento',
    markOfRound: 'Dibujada a partir de la transacción del VRF de la ronda',
    markOfCampaign: 'Dibujada a partir de la semilla del VRF de la campaña',
    markPending: 'Esperando el primer sorteo liquidado.',
    markLine: 'Cada sorteo liquidado deja una forma dibujada a partir de su propia prueba. Misma prueba, misma forma.',
    revealTitle: 'Ganadores, con su prueba.',
    campaignLabel: 'Campaña',
    seeCampaign: 'Ver la campaña',
    keptra: {
      title: 'La misma prueba, para lo que compras.',
      body: 'Tu pago espera en un escrow on-chain. Una entrega probada abre el camino hasta la tienda.',
      failure: 'Si una marca le falla a un ganador, el pool paga: primero la fianza de la marca, luego la reserva de riesgo, luego el capital.',
      path: ['Tú', 'Escrow', 'Tienda'],
      layers: ['Fianza', 'Reserva de riesgo', 'Capital'],
      cta: 'Ver el pool de garantía',
    },
    captions: {
      mark: 'Esta forma se dibuja a partir de la prueba del último sorteo. Cada sorteo tiene la suya, y nadie puede falsificarla.',
      ticket: 'Un boleto. Cada uno es una oportunidad en la ronda.',
      draw: 'La maraña es el azar antes del sorteo; la forma es el resultado, una vez elegido.',
      seal: 'El resultado, cerrado dentro de un bloque del registro público. Desde entonces, nadie puede cambiarlo.',
      reveal: 'La misma forma, vista de frente. Las líneas verdes son los ganadores.',
      payout: 'El premio, en ámbar, sale del contrato hacia la wallet de quien ganó.',
      escrow: 'Tu pago espera en el medio. El camino verde hacia la tienda solo se abre cuando la entrega está probada; las tres capas de abajo cubren un fallo.',
      modules: 'Los tres módulos. Una forma marca el que ya tiene un sorteo; los anillos, el que aún no lo tiene. El verde es lo que está en marcha.',
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
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignora falha de persistência */
  }
  langListeners.forEach((notify) => notify());
}

export function useLang(): [Lang, (l: Lang) => void] {
  const lang = useSyncExternalStore(subscribeLang, getLangSnapshot, getLangSnapshot);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  return [lang, setLang];
}
