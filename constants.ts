import { createConfig, http } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';

// --- CONFIGURATION ---

// [IMPORTANTE - DEPLOY]
// Esta é uma ID pública. Para garantir que o QR Code funcione 100% no mobile sem erros de "Rate Limit":
// 1. Crie uma conta em https://cloud.reown.com (Grátis)
// 2. Crie um novo projeto
// 3. Substitua a string abaixo pela SUA Project ID.
export const PROJECT_ID = '3a8170812b534d0ff9d794f19a901d64'; 

// Metadata para o modal de conexão (aparece no celular do usuário)
const metadata = {
  name: 'Instant Win',
  description: 'Arbitrum Raffle Protocol',
  url: 'https://instantwin.finance', // Substitua pelo seu domínio real quando tiver
  icons: ['https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/arbitrum/info/logo.png']
};

export const wagmiConfig = createConfig({
  chains: [arbitrum], // Arbitrum One (Mainnet ID 42161)
  transports: {
    // 'http()' usa RPCs públicos. Para alta performance em produção, 
    // recomenda-se usar uma chave da Alchemy ou Infura aqui.
    // Ex: [arbitrum.id]: http('https://arb-mainnet.g.alchemy.com/v2/SUA-CHAVE')
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
  // Endereço oficial do USDC Nativo na Arbitrum One
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  
  // Seus contratos (Certifique-se que estes endereços estão corretos na Mainnet)
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
            { name: 'status', type: 'uint8' }, 
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