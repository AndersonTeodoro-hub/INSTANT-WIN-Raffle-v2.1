import { createConfig, http } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { injected, walletConnect } from 'wagmi/connectors';
import { ARBITRUM_RPC_URL } from './lib/rpc';

// --- CONFIGURATION ---

const PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID;
if (!PROJECT_ID) {
  throw new Error('VITE_WC_PROJECT_ID não definida — configurar no Vercel ou em .env.local');
}

/*
 * Identidade que a wallet mostra ao utilizador na janela de aprovação.
 *
 * `url` TEM de ser o domínio a sério do site. Estava `instantwin.finance`, que
 * não é o domínio deste produto (hoje é keptra.io, SPEC-BLOCO-03 T9 — o mesmo
 * do og:image e do ShareButton), e o WalletConnect avisava em toda a sessão:
 * "the configured metadata.url differs from the actual page url". Em produção
 * era isso que aparecia a quem estava a assinar.
 */
const metadata = {
  // SPEC-BLOCO-03 T9: the app is Keptra, served at keptra.io.
  name: 'Keptra',
  description: 'Verified delivery, giveaways and the Event Center on Arbitrum One',
  url: 'https://keptra.io',
  // The Keptra K the wallet shows beside the request (it was Arbitrum's logo).
  icons: ['https://keptra.io/favicon-512.png']
};

export const wagmiConfig = createConfig({
  chains: [arbitrum],
  transports: {
    [arbitrum.id]: http(ARBITRUM_RPC_URL),
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
 * Contacto para investidores e parceiros (CTA final da /roadmap).
 */
export const INVESTOR_EMAIL = 'instantwin.official@gmail.com';

export const CONTRACTS = {
  USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  // GiveawayManager V1 — Arbitrum One, verificado (Exact Match). Nenhuma página
  // o usa: as campanhas criam-se no Event Center, no V2 abaixo.
  GIVEAWAY_MANAGER: '0x1F2aE94Fd04Ce15cb2A3a09B7b81eb9e16781cB0',
  // GiveawayManagerV2 e módulos de prémio — Arbitrum One, verificados no
  // Arbiscan. O Event Center (/events) fala com estes; o GiveawayManager V1
  // acima deixa de ser usado por ele (SPEC-GIVEAWAY-V2 §11, addenda 07/09/2026).
  GIVEAWAY_MANAGER_V2: '0xEA91eb545FBB7e82f0085ff30555ed06C1Baf739',
  ERC20_PRIZE_MODULE: '0x2247aeF54C66bD5149989f9c66522d3b439a4A7b',
  ERC721_PRIZE_MODULE: '0xafe9E198816DEa24e7f74e9D666c0F250aD688BC',
  ERC1155_PRIZE_MODULE: '0xeb54e328F9F38222FA91e29D6c0367342B8EFD50',
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
