import { createConfig, http } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

// --- CONFIGURATION ---

const PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID;
if (!PROJECT_ID) {
  throw new Error('VITE_WC_PROJECT_ID não definida — configurar no Vercel ou em .env.local');
}

const metadata = {
  name: 'Instant Win',
  description: 'Arbitrum Raffle Protocol',
  url: 'https://instantwin.finance',
  icons: ['https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png']
};

export const wagmiConfig = createConfig({
  chains: [arbitrum],
  transports: {
    [arbitrum.id]: http('https://arb1.arbitrum.io/rpc'), 
  },
  connectors: [
    injected(),
    walletConnect({ 
        projectId: PROJECT_ID, 
        showQrModal: true,
        metadata: metadata,
        qrModalOptions: {
            themeMode: 'dark',
        }
    }),
  ],
});

/**
 * Modo pré-lançamento. Enquanto `true`:
 *   - a Landing troca "PLAY NOW" (herói e CTA final) por um bloco de lista de espera;
 *   - /play mostra um banner discreto no topo com a mesma mensagem.
 *
 * O jogo NÃO é bloqueado em nenhum dos casos: as rotas continuam todas abertas e
 * quem chegar vê tudo — só não é convidado a jogar. Pôr a `false` devolve o
 * comportamento anterior sem deixar vestígios.
 */
export const PRELAUNCH = true;

/**
 * Destino do botão da lista de espera. Não é segredo nenhum, é um link público.
 */
export const TELEGRAM_URL = 'https://t.me/instantwinprotocol';

/**
 * Formulário de early access para criadores de campanhas (/giveaways).
 *
 * PLACEHOLDER — substituir pelo link real do Google Form antes do deploy.
 * Enquanto for este valor, o botão não abre separador novo (mesma regra do
 * TELEGRAM_URL): a página detecta que ainda não é um destino a sério.
 */
export const EARLY_ACCESS_FORM_URL = 'https://forms.gle/PLACEHOLDER';

export const CONTRACTS = {
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  USERNAME_REGISTRY: '0x2fC8676386D799844F32173f8226a6E85FF19685',
  // RaffleManagerV3 — Arbitrum One, verificado (Sourcify + Arbiscan).
  // Não há SHARES_REGISTRY: o V3 eliminou a camada de investidores.
  RAFFLE_MANAGER: '0xB1935f2d6D0A8dEb7cfB074b17f179fd842d324a',
  // GiveawayManager V1 — Arbitrum One, verificado (Exact Match).
  // Deployado, ainda sem criação de campanhas aberta ao público: a página
  // /giveaways é um preview do fluxo, não uma interface de escrita.
  GIVEAWAY_MANAGER: '0x1F2aE94Fd04Ce15cb2A3a09B7b81eb9e16781cB0',
} as const;

/**
 * Constantes REAIS do GiveawayManager V1, tal como estão no contrato deployado.
 *
 * São a fonte única dos limites que o wizard de /giveaways valida e dos números
 * que o painel de prova mostra. Não inventar valores nem duplicá-los em copy:
 * o i18n interpola a partir daqui, para não haver dois números divergentes.
 *
 * Ao alterar o contrato, alterar aqui — e só aqui.
 */
export const GIVEAWAY_LIMITS = {
  /** FEE_BPS = 500 → 5% do prémio, cobrado ao criador na criação. */
  FEE_BPS: 500n,
  BPS_DENOMINATOR: 10_000n,
  /** MIN_DURATION / MAX_DURATION, em horas: 1 hora a 30 dias. */
  MIN_DURATION_HOURS: 1,
  MAX_DURATION_HOURS: 720,
  /** MAX_WINNERS — escala de airdrop grande, possível pelo settle em dois passos. */
  MAX_WINNERS: 1_000,
  /** MAX_PARTICIPANTS — escala de campanha de marca grande. */
  MAX_PARTICIPANTS: 100_000,
} as const;

/** Bloco de deploy da RaffleManagerV3 — piso para queries de eventos. */
export const RAFFLE_DEPLOY_BLOCK = 492021006n;

/** RaffleManagerV3.State — tem de bater com o enum do contrato. */
export const RoundState = {
  NONE: 0,
  OPEN: 1,
  DRAWING: 2,
  SETTLED: 3,
  CANCELLED: 4,
} as const;

// --- ABIS ---

export const USDC_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// =============================================================================
// USERNAME ABI - CORRIGIDO para corresponder ao contrato deployado
// =============================================================================
export const USERNAME_ABI = [
  // registerUsername - registar um username
  {
    name: 'registerUsername',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [],
  },
  // isUsernameAvailable - verificar se username está disponível (NÃO isAvailable!)
  {
    name: 'isUsernameAvailable',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // usernameToWallet - obter wallet de um username (NÃO usernameToAddress!)
  {
    name: 'usernameToWallet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  // walletToUsername - obter username de uma wallet (NÃO addressToUsername!)
  {
    name: 'walletToUsername',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
  // hasUsername - verificar se wallet já tem username
  {
    name: 'hasUsername',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  // getUsername - obter username de uma wallet
  {
    name: 'getUsername',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
  // getWallet - obter wallet de um username
  {
    name: 'getWallet',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const;

/** Único sítio onde vive a assinatura do evento — reutilizado no ABI e no getLogs. */
export const PRIZE_AWARDED_EVENT = {
  type: 'event',
  name: 'PrizeAwarded',
  inputs: [
    { name: 'roundId', type: 'uint256', indexed: true },
    { name: 'winner', type: 'address', indexed: true },
    { name: 'rank', type: 'uint8', indexed: true },
    { name: 'amount', type: 'uint256', indexed: false },
  ],
  anonymous: false,
} as const;

// =============================================================================
// RAFFLE ABI — RaffleManagerV3
// Extraído do artefacto compilado que produziu o bytecode deployado
// (instant-win-audit/v2/out/RaffleManagerV3.sol/RaffleManagerV3.json), não
// escrito à mão. Alterar apenas re-extraindo do artefacto.
// =============================================================================
export const RAFFLE_ABI = [
  {
    type: 'function',
    name: 'getCurrentRound',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'state', type: 'uint8' },
      { name: 'endTime', type: 'uint256' },
      // V3 renomeou este campo de `participantCount` para `buyers` (posição [3]
      // inalterada; a UI lê por índice, não por nome).
      { name: 'buyers', type: 'uint256' },
      { name: 'totalTickets', type: 'uint256' },
      { name: 'pool', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'buyTickets',
    inputs: [{ name: 'ticketCount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claim',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'claimable',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'claimRefund',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'ticketsOf',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'refunded',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'rounds',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'state', type: 'uint8' },
      { name: 'endTime', type: 'uint40' },
      { name: 'requestedAt', type: 'uint40' },
      { name: 'totalTickets', type: 'uint256' },
      { name: 'pool', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'TICKET_PRICE',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_TICKETS_PER_WALLET',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MIN_PARTICIPANTS',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'currentRoundId',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'paused',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  // --- novas no V3 ---
  {
    type: 'function',
    name: 'winOddsBps',
    inputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: 'bps', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pendingCarry',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  PRIZE_AWARDED_EVENT,
] as const;
