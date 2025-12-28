import { createConfig, http } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

// --- CONFIGURATION ---

// [CRITICAL FOR PRODUCTION]
// 1. Go to https://cloud.reown.com (WalletConnect)
// 2. Create a Project
// 3. Paste the Project ID below.
// If you leave this specific test ID, mobile wallets might fail in production due to rate limits.
export const PROJECT_ID = '3a8170812b534d0ff9d794f19a901d64'; 

export const wagmiConfig = createConfig({
  chains: [arbitrum],
  transports: {
    // Recommendation: Replace the empty http() with an Alchemy or Infura URL for better stability.
    // Example: http('https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY')
    [arbitrum.id]: http(), 
  },
  connectors: [
    injected(),
    walletConnect({ 
        projectId: PROJECT_ID, 
        showQrModal: true,
        metadata: {
            name: 'Instant Win',
            description: 'Arbitrum Raffle Protocol',
            url: 'https://instantwin.finance', // Update this to your Vercel URL after deploy
            icons: ['https://avatars.githubusercontent.com/u/37784886']
        }
    }),
  ],
});

export const CONTRACTS = {
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  USERNAME_REGISTRY: '0x2fC8676386D799844F32173f8226a6E85FF19685',
  SHARES_REGISTRY: '0x089B10b8Af63277FA4D8B8ECb23603B451245F59',
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

export const USERNAME_ABI = [
  {
    name: 'registerUsername',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [],
  },
  {
    name: 'usernameToAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'addressToUsername',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'isAvailable',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'username', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const RAFFLE_ABI = [
  {
    name: 'currentRoundId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getRoundInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [
      {
        components: [
            { name: 'status', type: 'uint8' }, // 0: Pending, 1: Active, 2: Calculated, 3: Finalized
            { name: 'endTime', type: 'uint256' },
            { name: 'totalPot', type: 'uint256' },
            { name: 'ticketsSold', type: 'uint256' },
            { name: 'participantCount', type: 'uint256' }
        ],
        name: '',
        type: 'tuple'
      }
    ],
  },
  {
    name: 'buyTickets',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amountUSDC', type: 'uint256' }],
    outputs: [],
  },
  {
      name: 'getWinners',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'roundId', type: 'uint256' }],
      outputs: [{name: '', type: 'address[]'}]
  }
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
  }
] as const;