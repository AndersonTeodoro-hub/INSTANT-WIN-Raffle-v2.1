# Instant Win — Arbitrum Raffle Protocol

Instant-win raffle dApp on Arbitrum One.

## Stack

- Vite
- React 18
- Wagmi v2
- Arbitrum One

## Commands

```bash
npm install     # install dependencies
npm run dev     # start dev server
npm run build   # type-check + production build
```

## Variáveis de ambiente

`VITE_WC_PROJECT_ID` (WalletConnect Project ID) é **obrigatória**.

- **Produção:** configurar no dashboard do Vercel.
- **Desenvolvimento local:** definir em `.env.local` (nunca commitado).

A app lança um erro em runtime se a variável não estiver definida.
