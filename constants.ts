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

export const CONTRACTS = {
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  USERNAME_REGISTRY: '0x2fC8676386D799844F32173f8226a6E85FF19685',
  SHARES_REGISTRY: '0x089B10b8Af63277FA4D8B8ECb23603B451245f59',
  // RaffleManagerV2 — Arbitrum One, verificado (Sourcify exact_match).
  RAFFLE_MANAGER: '0x4149406c1f0A4D680ad5d5278370ee65478254f8',
} as const;

/** Bloco de deploy da RaffleManagerV2 — piso para queries de eventos. */
export const RAFFLE_DEPLOY_BLOCK = 490447325n;

/** RaffleManagerV2.State — tem de bater com o enum do contrato. */
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
// RAFFLE ABI — RaffleManagerV2
// Extraído do artefacto compilado que produziu o bytecode deployado
// (instant-win-audit/v2/out/RaffleManagerV2.sol/RaffleManagerV2.json), não
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
      { name: 'participantCount', type: 'uint256' },
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
  PRIZE_AWARDED_EVENT,
] as const;

export const SHARES_ABI = [
  {
    name: 'buyShares',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getClaimableRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'sharePrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
