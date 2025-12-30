import { createConfig, http } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

// --- CONFIGURATION ---

export const PROJECT_ID = '94daeb9a2c7c766816ab3ea56255520b'; 

const metadata = {
  name: 'Instant Win',
  description: 'Arbitrum Raffle Protocol',
  url: 'https://instantwin.finance',
  icons: ['https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png']
};

export const wagmiConfig = createConfig({
  chains: [arbitrum],
  transports: {
    [arbitrum.id]: http(), 
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
  RAFFLE_MANAGER: '0xA018d2fdE729349c1CAE20b6B72007c817Bc342c',
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

// =============================================================================
// RAFFLE ABI - CORRIGIDO
// =============================================================================
export const RAFFLE_ABI = [
  {
    name: 'currentRoundId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getCurrentRound',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'totalPool', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'participantCount', type: 'uint256' },
      { name: 'ticketCount', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
  },
  {
    name: 'buyTickets',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'ticketCount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getWinners',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address[]' }],
  },
  {
    name: 'TICKET_PRICE',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'MAX_TICKETS_PER_WALLET',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
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
