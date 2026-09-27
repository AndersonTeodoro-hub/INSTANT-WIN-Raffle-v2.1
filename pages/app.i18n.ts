import { useLang } from './landing.i18n.js';
import type { Lang } from './landing.i18n.js';

// i18n das páginas do jogo (/play/*). Mesmo padrão do landing.i18n.ts: objecto de
// lookup por idioma, sem biblioteca. O `Lang`, o `useLang` e a persistência vêm
// de lá — há um só idioma escolhido para todo o site.
//
// NÃO SE TRADUZ, em nenhum idioma: INSTANT WIN, "Seeded round" (selo), USDC,
// Chainlink VRF, Arbitrum One, On-chain. São marca ou nomes de protocolo.
//
// Interpolação: em vez de funções no dicionário, partem-se as frases em
// pre/post à volta do valor — o mesmo que a landing já faz em transparency.

export interface AppCopy {
  nav: {
    ariaLanguage: string;
    ariaOpenMenu: string;
    overview: string;
    raffle: string;
    identity: string;
    status: string;
    notConnected: string;
  };
  wallet: {
    connect: string;
    wrongNet: string;
    selectWallet: string;
    cancel: string;
    ariaDisconnect: string;
  };
  dashboard: {
    identity: string;
    register: string;
    wallet: string;
    nextPool: string;
    network: string;
    finalizing: string;
    /** "Round #" + id + " Live" */
    roundPre: string;
    roundPost: string;
    closing: string;
    endedAwaitingClose: string;
    timeRemaining: string;
    totalPrizePool: string;
    ticketsSold: string;
    processing: string;
    enterRound: string;
    vrfNote: string;
  };
  /**
   * O que é preciso saber antes de jogar, na vista Overview (decisão do owner de
   * 27/09/2026): os textos que a página inicial tinha em 1acef6c
   * (pages/landing.i18n.ts :150, :164, :168, :170), nas três línguas, tal como
   * estavam — a linha "para os jogadores" da tabela comparativa, e as três
   * respostas: o que é preciso para jogar, para onde vai o dinheiro dos bilhetes,
   * e a jurisdição. O título da secção é o do owner (commit A4): "Before you play".
   */
  rules: {
    title: string;
    toPlayersLabel: string;
    toPlayers: string;
    items: { q: string; a: string }[];
  };
  raffle: {
    statusLoading: string;
    statusLive: string;
    statusEnded: string;
    statusDrawing: string;
    statusSettled: string;
    statusCancelled: string;
    statusIdle: string;
    currentPrizePool: string;
    /** "Seeded round · " + valor + " carried in" — o selo fica em inglês. */
    seededCarriedIn: string;
    timeLeft: string;
    tickets: string;
    playerOne: string;
    playerMany: string;
    needUsernameTitle: string;
    needUsernameBody: string;
    needUsernameLink: string;
    alreadyEnteredTitle: string;
    ticketOne: string;
    ticketMany: string;
    inRound: string;
    onePerWallet: string;
    priceLine: string;
    cost: string;
    ticketsChip: string;
    ariaTicketCount: string;
    ctaRegisterFirst: string;
    ctaAlreadyEntered: string;
    ctaApprovePre: string;
    ctaWaitNextRound: string;
    ctaBuyPre: string;
    yourOdds: string;
    /** "Next round already starts with " + valor + " USDC" */
    nextRoundStartsWith: string;
    roundFacts: string;
    factNetwork: string;
    factRandomness: string;
    factRounds: string;
    factRoundsValue: string;
    prizeSplit: string;
    first: string;
    second: string;
    third: string;
    disclaimer: string;
    /**
     * O talão. Rótulos impressos num bilhete a sério — curtos, porque é o que
     * cabe num talão, e em maiúsculas pequenas por ser tipografia de bilhete e
     * não decoração. Tudo o que já existia (bilhetes, custo, chances, tempo)
     * continua a vir das chaves acima; aqui só está o que o talão acrescenta.
     */
    ticket: {
      title: string;
      holder: string;
      /** Ainda sem username: o bilhete existe, o nome dele é que falta. */
      holderNone: string;
      round: string;
      total: string;
      drawIn: string;
      /** Último minuto da ronda. */
      closing: string;
      /** Ronda expirada, à espera do fecho on-chain. */
      drawing: string;
      footnote: string;
      oddsHint: string;
    };
    /** O que a prova on-chain dá e uma lotaria em papel não dá. */
    proof: {
      line: string;
      verifyCta: string;
    };
  };
  winners: {
    title: string;
    onChain: string;
    reading: string;
    empty: string;
    round: string;
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    daysAgo: string;
    /** aria: "Verify round " + id + " payout on Arbiscan" */
    ariaVerifyPre: string;
    ariaVerifyPost: string;
  };
  claim: {
    title: string;
    claimable: string;
    nothingToClaim: string;
    /** "Claim " + valor + " USDC" */
    claimPre: string;
    refundsTitle: string;
    round: string;
    refund: string;
  };
  previousRound: {
    round: string;
    drawing: string;
    cancelled: string;
    /** "Settled · pool " + valor + " USDC" */
    settledPoolPre: string;
    winnersSettled: string;
  };
  winCard: {
    firstPlace: string;
    secondPlace: string;
    thirdPlace: string;
    round: string;
    verified: string;
    copied: string;
    share: string;
    ariaViewTx: string;
    /** "I just won " + valor + " USDC on Instant Win — ..." */
    sharePre: string;
    sharePost: string;
    /** Depois de o claim confirmar on-chain: o percurso do prémio, do contrato à wallet. */
    claimed: string;
    contract: string;
    yourWallet: string;
    claimTx: string;
  };
  /** A forma da prova de um sorteio (components/proof): o que ela é e de onde vem. */
  proof: {
    /** aria: "Proof shape of round " + id */
    markRound: string;
    vrfTx: string;
    settled: string;
  };
  username: {
    title: string;
    connectPrompt: string;
    subtitle: string;
    currentAlias: string;
    alreadyRegistered: string;
    chooseLabel: string;
    placeholder: string;
    available: string;
    taken: string;
    rules: string;
    submit: string;
  };
  footer: {
    liveOn: string;
  };
}

const en: AppCopy = {
  nav: {
    ariaLanguage: 'Language',
    ariaOpenMenu: 'Open menu',
    overview: 'Overview',
    raffle: 'Raffle',
    identity: 'Identity',
    status: 'Status',
    notConnected: 'Not Connected',
  },
  wallet: {
    connect: 'CONNECT',
    wrongNet: 'Wrong Net',
    selectWallet: 'Select Wallet',
    cancel: 'Cancel',
    ariaDisconnect: 'Disconnect wallet',
  },
  dashboard: {
    identity: 'Identity',
    register: 'Register',
    wallet: 'Wallet',
    nextPool: 'Next Pool',
    network: 'Network',
    finalizing: 'Finalizing Round...',
    roundPre: 'Round #',
    roundPost: ' Live',
    closing: 'CLOSING…',
    endedAwaitingClose: 'Round ended · awaiting close',
    timeRemaining: 'Time Remaining',
    totalPrizePool: 'Total Prize Pool',
    ticketsSold: 'Tickets Sold',
    processing: 'Processing...',
    enterRound: 'ENTER ROUND NOW',
    vrfNote: 'Smart Contract verifies winner automatically via Chainlink VRF.',
  },
  rules: {
    title: 'Before you play',
    toPlayersLabel: 'To players',
    toPlayers: '85.7% of ticket money over time',
    items: [
      { q: 'What do I need to play?', a: 'An Arbitrum One wallet (such as MetaMask) with some USDC for tickets and a little ETH for gas.' },
      {
        q: 'How much of the money goes to players?',
        a: 'About 85.7% over time. Each round pays 75% of its pool to the three winners and 12.5% to development; the other 12.5% rolls into the next round, so it comes back to players — minus the same development share each time it recycles.',
      },
      {
        q: 'Is this available in my country?',
        a: 'Access depends on the rules of your own jurisdiction. It is your responsibility to check whether you are allowed to participate where you live.',
      },
    ],
  },
  raffle: {
    statusLoading: 'Loading Round',
    statusLive: 'Open for entries',
    statusEnded: 'Round Ended · Awaiting Close',
    statusDrawing: 'Drawing Winners…',
    statusSettled: 'Round Settled',
    statusCancelled: 'Round Cancelled · Refunds Open',
    statusIdle: 'Idle',
    currentPrizePool: 'Current Prize Pool',
    seededCarriedIn: 'carried in',
    timeLeft: 'Time left',
    tickets: 'Tickets',
    playerOne: 'player',
    playerMany: 'players',
    needUsernameTitle: 'You need a username to enter',
    needUsernameBody: 'Every ticket is tied to a registered identity.',
    needUsernameLink: 'Register one here',
    alreadyEnteredTitle: 'You already entered this round',
    ticketOne: 'ticket',
    ticketMany: 'tickets',
    inRound: 'in round',
    onePerWallet: 'One entry per wallet per round.',
    priceLine: '1 ticket = 1 USDC',
    cost: 'Cost:',
    ticketsChip: 'TICKETS',
    ariaTicketCount: 'Number of tickets',
    ctaRegisterFirst: 'Register a Username First',
    ctaAlreadyEntered: 'Already Entered This Round',
    ctaApprovePre: 'Approve',
    ctaWaitNextRound: 'Wait for Next Round',
    ctaBuyPre: 'Buy',
    yourOdds: 'Your odds',
    nextRoundStartsWith: 'Next round already starts with',
    roundFacts: 'Round facts',
    factNetwork: 'Network',
    factRandomness: 'Randomness',
    factRounds: 'Rounds',
    factRoundsValue: '30 min',
    prizeSplit: 'Prize split',
    first: '1st',
    second: '2nd',
    third: '3rd',
    disclaimer:
      'Prizes are credited on-chain the moment a round settles and stay yours until you claim them. Draws are settled by Chainlink VRF on Arbitrum One. 100% on-chain.',
    ticket: {
      title: 'Your ticket',
      holder: 'Holder',
      holderNone: 'Name your ticket first',
      round: 'Round',
      total: 'Total',
      drawIn: 'Draw in',
      closing: 'Closing now',
      drawing: 'Round ended',
      footnote: 'There is no paper ticket to lose: tickets are recorded on Arbitrum against the wallet that buys them, and only that wallet can claim what they win or their refund. Keep that wallet safe.',
      oddsHint: 'Your odds move as other players buy into the same round.',
    },
    proof: {
      line: 'A paper lottery asks you to trust the draw. This one lets you read it: the contract, the randomness and every payout are public, permanent and yours to check.',
      verifyCta: 'Read the contract on Arbiscan',
    },
  },
  winners: {
    title: 'Recent Winners',
    onChain: 'On-chain',
    reading: 'Reading the chain…',
    empty:
      'No settled rounds yet. The first three winners will appear here, with a link to the transaction that paid them.',
    round: 'Round',
    justNow: 'just now',
    // Sufixos colados ao número por `relativeTime`: o espaço, quando é preciso,
    // faz parte da string ("5m ago" em EN, "5 min atrás" em PT/ES).
    minutesAgo: 'm ago',
    hoursAgo: 'h ago',
    daysAgo: 'd ago',
    ariaVerifyPre: 'Verify round',
    ariaVerifyPost: 'payout on Arbiscan',
  },
  claim: {
    title: 'Your Winnings',
    claimable: 'Claimable',
    nothingToClaim: 'Nothing to Claim',
    claimPre: 'Claim',
    refundsTitle: 'Refunds (cancelled rounds)',
    round: 'Round #',
    refund: 'Refund',
  },
  previousRound: {
    round: 'Round #',
    drawing: 'Drawing winners… (Chainlink VRF)',
    cancelled:
      'Round cancelled — fewer than 3 participants or VRF timeout. Ticket holders can claim a full refund above.',
    settledPoolPre: 'Settled · pool',
    winnersSettled: 'Winners settled on-chain. Claim above if you won.',
  },
  winCard: {
    firstPlace: '1st place',
    secondPlace: '2nd place',
    thirdPlace: '3rd place',
    round: 'Round',
    verified: 'Verified on Arbitrum',
    copied: 'Copied',
    share: 'Share',
    ariaViewTx: 'View transaction on Arbiscan',
    sharePre: 'I just won',
    sharePost: 'USDC on Instant Win — provably fair, verified on-chain.',
    claimed: 'Claimed. The contract paid it to your wallet.',
    contract: 'Contract',
    yourWallet: 'Your wallet',
    claimTx: 'Claim transaction',
  },
  proof: {
    markRound: 'Proof shape of round',
    vrfTx: 'VRF transaction',
    settled: 'Settled on-chain',
  },
  username: {
    title: 'Your Identity',
    connectPrompt: 'Connect wallet to register.',
    subtitle: 'Register a unique username on Arbitrum One to identify yourself across the suite.',
    currentAlias: 'Current Alias',
    alreadyRegistered: 'Your username is already registered and cannot be changed.',
    chooseLabel: 'Choose Username',
    placeholder: 'yourname',
    available: 'Available',
    taken: 'Taken',
    rules: 'Must be between 3 and 20 characters. Only letters, numbers and underscore.',
    submit: '+ Register Username',
  },
  footer: {
    liveOn: 'Live on Arbitrum One',
  },
};

const pt: AppCopy = {
  nav: {
    ariaLanguage: 'Idioma',
    ariaOpenMenu: 'Abrir menu',
    overview: 'Visão geral',
    raffle: 'Sorteio',
    identity: 'Identidade',
    status: 'Estado',
    notConnected: 'Não ligado',
  },
  wallet: {
    connect: 'LIGAR',
    wrongNet: 'Rede errada',
    selectWallet: 'Escolha a carteira',
    cancel: 'Cancelar',
    ariaDisconnect: 'Desligar carteira',
  },
  dashboard: {
    identity: 'Identidade',
    register: 'Registar',
    wallet: 'Carteira',
    nextPool: 'Próximo prémio',
    network: 'Rede',
    finalizing: 'A finalizar a ronda...',
    roundPre: 'Ronda #',
    roundPost: ' ao vivo',
    closing: 'A FECHAR…',
    endedAwaitingClose: 'Ronda encerrada · à espera do fecho',
    timeRemaining: 'Tempo restante',
    totalPrizePool: 'Prémio total',
    ticketsSold: 'Bilhetes vendidos',
    processing: 'A processar...',
    enterRound: 'ENTRAR NA RONDA',
    vrfNote: 'O smart contract verifica o vencedor automaticamente através do Chainlink VRF.',
  },
  rules: {
    title: 'Antes de jogar',
    toPlayersLabel: 'Para os jogadores',
    toPlayers: '85,7% do dinheiro dos bilhetes ao longo do tempo',
    items: [
      { q: 'De que preciso para jogar?', a: 'Uma wallet na Arbitrum One (como a MetaMask) com um pouco de USDC para os bilhetes e um pouco de ETH para o gas.' },
      {
        q: 'Quanto do dinheiro vai para os jogadores?',
        a: 'Cerca de 85,7% ao longo do tempo. Cada ronda paga 75% do seu pool aos três vencedores e 12,5% ao desenvolvimento; os outros 12,5% entram na ronda seguinte, ou seja, voltam para os jogadores — menos a mesma fatia de desenvolvimento a cada reciclagem.',
      },
      {
        q: 'Está disponível no meu país?',
        a: 'O acesso depende das regras da sua própria jurisdição. É da sua responsabilidade verificar se tem permissão para participar no lugar onde vive.',
      },
    ],
  },
  raffle: {
    statusLoading: 'A carregar a ronda',
    statusLive: 'Aberta a entradas',
    statusEnded: 'Ronda encerrada · à espera do fecho',
    statusDrawing: 'A sortear os vencedores…',
    statusSettled: 'Ronda liquidada',
    statusCancelled: 'Ronda cancelada · reembolsos abertos',
    statusIdle: 'Parada',
    currentPrizePool: 'Prémio actual',
    seededCarriedIn: 'acumulados',
    timeLeft: 'Tempo restante',
    tickets: 'Bilhetes',
    playerOne: 'jogador',
    playerMany: 'jogadores',
    needUsernameTitle: 'Precisa de um nome de utilizador para entrar',
    needUsernameBody: 'Cada bilhete fica ligado a uma identidade registada.',
    needUsernameLink: 'Registe a sua aqui',
    alreadyEnteredTitle: 'Já entrou nesta ronda',
    ticketOne: 'bilhete',
    ticketMany: 'bilhetes',
    inRound: 'na ronda',
    onePerWallet: 'Uma entrada por carteira por ronda.',
    priceLine: '1 bilhete = 1 USDC',
    cost: 'Custo:',
    ticketsChip: 'BILHETES',
    ariaTicketCount: 'Quantidade de bilhetes',
    ctaRegisterFirst: 'Registe primeiro um nome de utilizador',
    ctaAlreadyEntered: 'Já entrou nesta ronda',
    ctaApprovePre: 'Aprovar',
    ctaWaitNextRound: 'Aguarde a próxima ronda',
    ctaBuyPre: 'Comprar',
    yourOdds: 'As suas probabilidades',
    nextRoundStartsWith: 'A próxima ronda já começa com',
    roundFacts: 'Dados da ronda',
    factNetwork: 'Rede',
    factRandomness: 'Aleatoriedade',
    factRounds: 'Rondas',
    factRoundsValue: '30 min',
    prizeSplit: 'Divisão do prémio',
    first: '1º',
    second: '2º',
    third: '3º',
    disclaimer:
      'Os prémios são creditados on-chain no instante em que a ronda é liquidada e ficam seus até os levantar. Os sorteios são liquidados pelo Chainlink VRF na Arbitrum One. 100% on-chain.',
    ticket: {
      title: 'O seu bilhete',
      holder: 'Titular',
      holderNone: 'Dê um nome ao seu bilhete',
      round: 'Ronda',
      total: 'Total',
      drawIn: 'Sorteio em',
      closing: 'A fechar agora',
      drawing: 'Ronda encerrada',
      footnote: 'Não há bilhete de papel para perder: os bilhetes ficam registados na Arbitrum na carteira que os compra, e só essa carteira pode levantar o que eles ganharem ou o seu reembolso. Guarde bem essa carteira.',
      oddsHint: 'As suas probabilidades mudam à medida que outros jogadores entram na mesma ronda.',
    },
    proof: {
      line: 'A lotaria em papel pede-lhe que confie no sorteio. Esta permite-lhe ler o sorteio: o contrato, a aleatoriedade e cada pagamento são públicos, permanentes e seus para conferir.',
      verifyCta: 'Ler o contrato no Arbiscan',
    },
  },
  winners: {
    title: 'Vencedores recentes',
    onChain: 'On-chain',
    reading: 'A ler a blockchain…',
    empty:
      'Ainda não há rondas liquidadas. Os três primeiros vencedores vão aparecer aqui, com ligação para a transacção que os pagou.',
    round: 'Ronda',
    justNow: 'agora mesmo',
    minutesAgo: ' min atrás',
    hoursAgo: ' h atrás',
    daysAgo: ' d atrás',
    ariaVerifyPre: 'Verificar o pagamento da ronda',
    ariaVerifyPost: 'no Arbiscan',
  },
  claim: {
    title: 'Os seus ganhos',
    claimable: 'Disponível para levantar',
    nothingToClaim: 'Nada para levantar',
    claimPre: 'Levantar',
    refundsTitle: 'Reembolsos (rondas canceladas)',
    round: 'Ronda #',
    refund: 'Reembolsar',
  },
  previousRound: {
    round: 'Ronda #',
    drawing: 'A sortear os vencedores… (Chainlink VRF)',
    cancelled:
      'Ronda cancelada — menos de 3 participantes ou tempo esgotado no VRF. Quem tinha bilhetes pode pedir o reembolso integral acima.',
    settledPoolPre: 'Liquidada · prémio',
    winnersSettled: 'Vencedores liquidados on-chain. Levante acima se ganhou.',
  },
  winCard: {
    firstPlace: '1º lugar',
    secondPlace: '2º lugar',
    thirdPlace: '3º lugar',
    round: 'Ronda',
    verified: 'Verificado na Arbitrum',
    copied: 'Copiado',
    share: 'Partilhar',
    ariaViewTx: 'Ver a transacção no Arbiscan',
    sharePre: 'Acabei de ganhar',
    sharePost: 'USDC no Instant Win — comprovadamente justo, verificado on-chain.',
    claimed: 'Levantado. O contrato pagou para a sua wallet.',
    contract: 'Contrato',
    yourWallet: 'A sua wallet',
    claimTx: 'Transacção do levantamento',
  },
  proof: {
    markRound: 'Forma da prova da ronda',
    vrfTx: 'Transacção do VRF',
    settled: 'Liquidada on-chain',
  },
  username: {
    title: 'A sua identidade',
    connectPrompt: 'Ligue a carteira para registar.',
    subtitle: 'Registe um nome de utilizador único na Arbitrum One para se identificar em todo o ecossistema.',
    currentAlias: 'Nome actual',
    alreadyRegistered: 'O seu nome de utilizador já está registado e não pode ser alterado.',
    chooseLabel: 'Escolha o nome de utilizador',
    placeholder: 'seunome',
    available: 'Disponível',
    taken: 'Em uso',
    rules: 'Entre 3 e 20 caracteres. Apenas letras, números e underscore.',
    submit: '+ Registar nome de utilizador',
  },
  footer: {
    liveOn: 'Ao vivo na Arbitrum One',
  },
};

const es: AppCopy = {
  nav: {
    ariaLanguage: 'Idioma',
    ariaOpenMenu: 'Abrir menú',
    overview: 'Resumen',
    raffle: 'Sorteo',
    identity: 'Identidad',
    status: 'Estado',
    notConnected: 'Sin conectar',
  },
  wallet: {
    connect: 'CONECTAR',
    wrongNet: 'Red incorrecta',
    selectWallet: 'Elige la wallet',
    cancel: 'Cancelar',
    ariaDisconnect: 'Desconectar wallet',
  },
  dashboard: {
    identity: 'Identidad',
    register: 'Registrar',
    wallet: 'Wallet',
    nextPool: 'Próximo premio',
    network: 'Red',
    finalizing: 'Finalizando ronda...',
    roundPre: 'Ronda #',
    roundPost: ' en vivo',
    closing: 'CERRANDO…',
    endedAwaitingClose: 'Ronda terminada · esperando cierre',
    timeRemaining: 'Tiempo restante',
    totalPrizePool: 'Premio total',
    ticketsSold: 'Boletos vendidos',
    processing: 'Procesando...',
    enterRound: 'ENTRAR EN LA RONDA',
    vrfNote: 'El smart contract verifica al ganador automáticamente mediante Chainlink VRF.',
  },
  rules: {
    title: 'Antes de jugar',
    toPlayersLabel: 'Para los jugadores',
    toPlayers: '85,7% del dinero de los boletos con el tiempo',
    items: [
      { q: '¿Qué necesito para jugar?', a: 'Una wallet en Arbitrum One (como MetaMask) con algo de USDC para los boletos y un poco de ETH para el gas.' },
      {
        q: '¿Cuánto dinero va a los jugadores?',
        a: 'Alrededor del 85,7% con el tiempo. Cada ronda paga el 75% de su pool a los tres ganadores y el 12,5% al desarrollo; el otro 12,5% pasa a la ronda siguiente, o sea vuelve a los jugadores — menos la misma parte de desarrollo cada vez que se recicla.',
      },
      {
        q: '¿Está disponible en mi país?',
        a: 'El acceso depende de las normas de tu propia jurisdicción. Es tu responsabilidad verificar si tienes permiso para participar en el lugar donde vives.',
      },
    ],
  },
  raffle: {
    statusLoading: 'Cargando ronda',
    statusLive: 'Abierta a participación',
    statusEnded: 'Ronda terminada · esperando cierre',
    statusDrawing: 'Sorteando ganadores…',
    statusSettled: 'Ronda liquidada',
    statusCancelled: 'Ronda cancelada · reembolsos abiertos',
    statusIdle: 'Inactiva',
    currentPrizePool: 'Premio actual',
    seededCarriedIn: 'acumulados',
    timeLeft: 'Tiempo restante',
    tickets: 'Boletos',
    playerOne: 'jugador',
    playerMany: 'jugadores',
    needUsernameTitle: 'Necesitas un nombre de usuario para entrar',
    needUsernameBody: 'Cada boleto queda ligado a una identidad registrada.',
    needUsernameLink: 'Registra el tuyo aquí',
    alreadyEnteredTitle: 'Ya entraste en esta ronda',
    ticketOne: 'boleto',
    ticketMany: 'boletos',
    inRound: 'en la ronda',
    onePerWallet: 'Una entrada por wallet por ronda.',
    priceLine: '1 boleto = 1 USDC',
    cost: 'Costo:',
    ticketsChip: 'BOLETOS',
    ariaTicketCount: 'Cantidad de boletos',
    ctaRegisterFirst: 'Registra primero un nombre de usuario',
    ctaAlreadyEntered: 'Ya entraste en esta ronda',
    ctaApprovePre: 'Aprobar',
    ctaWaitNextRound: 'Espera la próxima ronda',
    ctaBuyPre: 'Comprar',
    yourOdds: 'Tus probabilidades',
    nextRoundStartsWith: 'La próxima ronda ya empieza con',
    roundFacts: 'Datos de la ronda',
    factNetwork: 'Red',
    factRandomness: 'Aleatoriedad',
    factRounds: 'Rondas',
    factRoundsValue: '30 min',
    prizeSplit: 'Reparto del premio',
    first: '1º',
    second: '2º',
    third: '3º',
    disclaimer:
      'Los premios se acreditan on-chain en el instante en que la ronda se liquida y quedan tuyos hasta que los retires. Los sorteos los liquida Chainlink VRF en Arbitrum One. 100% on-chain.',
    ticket: {
      title: 'Tu boleto',
      holder: 'Portador',
      holderNone: 'Ponle nombre a tu boleto',
      round: 'Ronda',
      total: 'Total',
      drawIn: 'Sorteo en',
      closing: 'Cerrando ahora',
      drawing: 'Ronda terminada',
      footnote: 'No hay boleto de papel que perder: los boletos quedan registrados en Arbitrum a nombre de la wallet que los compra, y solo esa wallet puede retirar lo que ganen o su reembolso. Guarda bien esa wallet.',
      oddsHint: 'Tus probabilidades cambian a medida que otros jugadores entran en la misma ronda.',
    },
    proof: {
      line: 'Una lotería de papel te pide confiar en el sorteo. Esta te deja leerlo: el contrato, la aleatoriedad y cada pago son públicos, permanentes y tuyos para comprobar.',
      verifyCta: 'Leer el contrato en Arbiscan',
    },
  },
  winners: {
    title: 'Ganadores recientes',
    onChain: 'On-chain',
    reading: 'Leyendo la blockchain…',
    empty:
      'Todavía no hay rondas liquidadas. Los tres primeros ganadores aparecerán aquí, con enlace a la transacción que los pagó.',
    round: 'Ronda',
    justNow: 'ahora mismo',
    minutesAgo: ' min atrás',
    hoursAgo: ' h atrás',
    daysAgo: ' d atrás',
    ariaVerifyPre: 'Verificar el pago de la ronda',
    ariaVerifyPost: 'en Arbiscan',
  },
  claim: {
    title: 'Tus ganancias',
    claimable: 'Disponible para retirar',
    nothingToClaim: 'Nada para retirar',
    claimPre: 'Retirar',
    refundsTitle: 'Reembolsos (rondas canceladas)',
    round: 'Ronda #',
    refund: 'Reembolsar',
  },
  previousRound: {
    round: 'Ronda #',
    drawing: 'Sorteando ganadores… (Chainlink VRF)',
    cancelled:
      'Ronda cancelada — menos de 3 participantes o tiempo agotado en el VRF. Quien tenía boletos puede pedir el reembolso íntegro arriba.',
    settledPoolPre: 'Liquidada · premio',
    winnersSettled: 'Ganadores liquidados on-chain. Retira arriba si ganaste.',
  },
  winCard: {
    firstPlace: '1º puesto',
    secondPlace: '2º puesto',
    thirdPlace: '3º puesto',
    round: 'Ronda',
    verified: 'Verificado en Arbitrum',
    copied: 'Copiado',
    share: 'Compartir',
    ariaViewTx: 'Ver la transacción en Arbiscan',
    sharePre: 'Acabo de ganar',
    sharePost: 'USDC en Instant Win — demostrablemente justo, verificado on-chain.',
    claimed: 'Retirado. El contrato lo pagó a tu wallet.',
    contract: 'Contrato',
    yourWallet: 'Tu wallet',
    claimTx: 'Transacción del retiro',
  },
  proof: {
    markRound: 'Forma de la prueba de la ronda',
    vrfTx: 'Transacción del VRF',
    settled: 'Liquidada on-chain',
  },
  username: {
    title: 'Tu identidad',
    connectPrompt: 'Conecta la wallet para registrar.',
    subtitle: 'Registra un nombre de usuario único en Arbitrum One para identificarte en todo el ecosistema.',
    currentAlias: 'Alias actual',
    alreadyRegistered: 'Tu nombre de usuario ya está registrado y no se puede cambiar.',
    chooseLabel: 'Elige el nombre de usuario',
    placeholder: 'tunombre',
    available: 'Disponible',
    taken: 'En uso',
    rules: 'Entre 3 y 20 caracteres. Solo letras, números y guion bajo.',
    submit: '+ Registrar nombre de usuario',
  },
  footer: {
    liveOn: 'En vivo en Arbitrum One',
  },
};

export const appTranslations: Record<Lang, AppCopy> = { en, pt, es };

/** Atalho: devolve directamente o dicionário do idioma escolhido. */
export function useAppCopy(): AppCopy {
  const [lang] = useLang();
  return appTranslations[lang];
}
