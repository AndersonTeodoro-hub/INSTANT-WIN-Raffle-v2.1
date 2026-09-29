# Keptra — the trust layer for every promise

Every day, people are made promises. Your order will arrive. This draw is fair. Your prize
will be paid. Keptra turns those promises into proof: a trust infrastructure on Arbitrum
One, with Chainlink proving what happens in the real world. People use it with just an
email — no wallet needed.

**Live:** https://keptra.io · **Roadmap:** https://keptra.io/roadmap

## Products
- **Verified Delivery** — free shipping made customers smile, easy returns made them loyal;
  verified delivery is the next benefit every brand will offer. Payment held in escrow,
  delivery proven by a Chainlink oracle from the carrier's tracking, an on-chain record
  behind every order. (`/business`, `/pool`)
- **Instant Win** — a lottery nobody can rig: 30-minute rounds, Chainlink VRF draws, every
  round closed by Chainlink CRE, prizes claimed from the contract. (`/play`)
- **Giveaways & Event Center** — prize campaigns with ERC-20, ERC-721 and ERC-1155 prizes
  held in a verified contract until claimed. One verified person, one entry.
  (`/giveaways`, `/events`)

## Contracts on Arbitrum One — don't believe us, go check
| Contract | Address |
|---|---|
| KeptraEscrow | [0x6B65fB17Cc548Fb3807F5c9130D4A4991398E246](https://arbiscan.io/address/0x6B65fB17Cc548Fb3807F5c9130D4A4991398E246) |
| KeptraGuarantee | [0xCa3121f129328B78b10f178F508e1CE0B4b37c2e](https://arbiscan.io/address/0xCa3121f129328B78b10f178F508e1CE0B4b37c2e) |
| KeptraPool | [0x5A6318A163c32bCDf545A6E32B73327EA5779cA7](https://arbiscan.io/address/0x5A6318A163c32bCDf545A6E32B73327EA5779cA7) |
| KeptraReputation | [0xcF3f8110263f66952d059796BFadF5Ac52D87b22](https://arbiscan.io/address/0xcF3f8110263f66952d059796BFadF5Ac52D87b22) |
| KeptraVoucher | [0x3075FA512203e9dC6250Feb4eBA36c55BD2A7a22](https://arbiscan.io/address/0x3075FA512203e9dC6250Feb4eBA36c55BD2A7a22) |
| Instant Win (RaffleManagerV3) | [0xB1935f2d6D0A8dEb7cfB074b17f179fd842d324a](https://arbiscan.io/address/0xB1935f2d6D0A8dEb7cfB074b17f179fd842d324a) |
| Event Center (GiveawayManagerV2) | [0xEA91eb545FBB7e82f0085ff30555ed06C1Baf739](https://arbiscan.io/address/0xEA91eb545FBB7e82f0085ff30555ed06C1Baf739) |

Every contract's source is verified on Arbiscan and Sourcify — read it there.

## What's in this repository
The web app (React + wagmi/viem) and the bridge (Vercel serverless + Supabase) that lets
people use Keptra with an email: accounts, orders, offers, prize campaigns, and the
endpoint the Chainlink CRE delivery oracle reads. Smart contracts and the CRE workflows
live in separate repositories.

## Where this goes
Live: Verified Delivery, Instant Win, Giveaways & Event Center. Next: card payments, for
mass adoption — customers pay the way they always do, with the same guarantee. Last
module: the Keptra Token, launched inside the regulated company, never before it.
Full vision: https://keptra.io/roadmap

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

## Environment variables

`VITE_WC_PROJECT_ID` (WalletConnect Project ID) is **required**.

- **Production:** set it in the Vercel dashboard.
- **Local development:** set it in `.env.local` (never committed).

The app throws a runtime error if the variable is not set.
