import { useLang } from './landing.i18n';
import type { Lang } from './landing.i18n';

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
  raffle: {
    statusLoading: 'Loading Round',
    statusLive: 'Live Pool Arbitrum',
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
    status: 'Status',
    notConnected: 'Não conectado',
  },
  wallet: {
    connect: 'CONECTAR',
    wrongNet: 'Rede errada',
    selectWallet: 'Escolha a carteira',
    cancel: 'Cancelar',
    ariaDisconnect: 'Desconectar carteira',
  },
  dashboard: {
    identity: 'Identidade',
    register: 'Registrar',
    wallet: 'Carteira',
    nextPool: 'Próximo prêmio',
    network: 'Rede',
    finalizing: 'Finalizando rodada...',
    roundPre: 'Rodada #',
    roundPost: ' ao vivo',
    closing: 'FECHANDO…',
    endedAwaitingClose: 'Rodada encerrada · aguardando fechamento',
    timeRemaining: 'Tempo restante',
    totalPrizePool: 'Prêmio total',
    ticketsSold: 'Bilhetes vendidos',
    processing: 'Processando...',
    enterRound: 'ENTRAR NA RODADA',
    vrfNote: 'O smart contract verifica o ganhador automaticamente via Chainlink VRF.',
  },
  raffle: {
    statusLoading: 'Carregando rodada',
    statusLive: 'Prêmio ao vivo Arbitrum',
    statusEnded: 'Rodada encerrada · aguardando fechamento',
    statusDrawing: 'Sorteando ganhadores…',
    statusSettled: 'Rodada liquidada',
    statusCancelled: 'Rodada cancelada · reembolsos abertos',
    statusIdle: 'Parada',
    currentPrizePool: 'Prêmio atual',
    seededCarriedIn: 'acumulados',
    timeLeft: 'Tempo restante',
    tickets: 'Bilhetes',
    playerOne: 'jogador',
    playerMany: 'jogadores',
    needUsernameTitle: 'Você precisa de um nome de usuário para entrar',
    needUsernameBody: 'Todo bilhete fica ligado a uma identidade registrada.',
    needUsernameLink: 'Registre a sua aqui',
    alreadyEnteredTitle: 'Você já entrou nesta rodada',
    ticketOne: 'bilhete',
    ticketMany: 'bilhetes',
    inRound: 'na rodada',
    onePerWallet: 'Uma entrada por carteira por rodada.',
    priceLine: '1 bilhete = 1 USDC',
    cost: 'Custo:',
    ticketsChip: 'BILHETES',
    ariaTicketCount: 'Quantidade de bilhetes',
    ctaRegisterFirst: 'Registre um nome de usuário primeiro',
    ctaAlreadyEntered: 'Você já entrou nesta rodada',
    ctaApprovePre: 'Aprovar',
    ctaWaitNextRound: 'Aguarde a próxima rodada',
    ctaBuyPre: 'Comprar',
    yourOdds: 'Suas chances',
    nextRoundStartsWith: 'A próxima rodada já começa com',
    roundFacts: 'Dados da rodada',
    factNetwork: 'Rede',
    factRandomness: 'Aleatoriedade',
    factRounds: 'Rodadas',
    factRoundsValue: '30 min',
    prizeSplit: 'Divisão do prêmio',
    first: '1º',
    second: '2º',
    third: '3º',
    disclaimer:
      'Os prêmios são creditados on-chain no instante em que a rodada liquida e ficam seus até você sacar. Os sorteios são liquidados pela Chainlink VRF na Arbitrum One. 100% on-chain.',
  },
  winners: {
    title: 'Ganhadores recentes',
    onChain: 'On-chain',
    reading: 'Lendo a blockchain…',
    empty:
      'Ainda não há rodadas liquidadas. Os três primeiros ganhadores vão aparecer aqui, com link para a transação que os pagou.',
    round: 'Rodada',
    justNow: 'agora mesmo',
    minutesAgo: ' min atrás',
    hoursAgo: ' h atrás',
    daysAgo: ' d atrás',
    ariaVerifyPre: 'Verificar o pagamento da rodada',
    ariaVerifyPost: 'no Arbiscan',
  },
  claim: {
    title: 'Seus ganhos',
    claimable: 'Disponível para saque',
    nothingToClaim: 'Nada para sacar',
    claimPre: 'Sacar',
    refundsTitle: 'Reembolsos (rodadas canceladas)',
    round: 'Rodada #',
    refund: 'Reembolsar',
  },
  previousRound: {
    round: 'Rodada #',
    drawing: 'Sorteando ganhadores… (Chainlink VRF)',
    cancelled:
      'Rodada cancelada — menos de 3 participantes ou tempo esgotado no VRF. Quem tinha bilhetes pode pedir o reembolso integral acima.',
    settledPoolPre: 'Liquidada · prêmio',
    winnersSettled: 'Ganhadores liquidados on-chain. Saque acima se você ganhou.',
  },
  winCard: {
    firstPlace: '1º lugar',
    secondPlace: '2º lugar',
    thirdPlace: '3º lugar',
    round: 'Rodada',
    verified: 'Verificado na Arbitrum',
    copied: 'Copiado',
    share: 'Compartilhar',
    ariaViewTx: 'Ver a transação no Arbiscan',
    sharePre: 'Acabei de ganhar',
    sharePost: 'USDC no Instant Win — comprovadamente justo, verificado on-chain.',
  },
  username: {
    title: 'Sua identidade',
    connectPrompt: 'Conecte a carteira para registrar.',
    subtitle: 'Registre um nome de usuário único na Arbitrum One para se identificar em todo o ecossistema.',
    currentAlias: 'Apelido atual',
    alreadyRegistered: 'Seu nome de usuário já está registrado e não pode ser alterado.',
    chooseLabel: 'Escolha o nome de usuário',
    placeholder: 'seunome',
    available: 'Disponível',
    taken: 'Em uso',
    rules: 'Entre 3 e 20 caracteres. Apenas letras, números e underscore.',
    submit: '+ Registrar nome de usuário',
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
  raffle: {
    statusLoading: 'Cargando ronda',
    statusLive: 'Premio en vivo Arbitrum',
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
