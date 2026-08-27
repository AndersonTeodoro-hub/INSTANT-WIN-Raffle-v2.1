# SPEC — INSTANT WIN Event Center · Giveaway Adapter (V1)

**Status:** Part 1 approved — product decisions and roadmap
**Date:** 2026-08-27
**Owner:** Anderson Luiz Lages Teodoro (solo founder)
**Rule:** Nothing in this spec is deployed before the lottery's Day 0. This is design work running in parallel with CRE onboarding.

---

## 1. Vision

INSTANT WIN evolves from a single provably fair lottery into an **on-chain Event Center**: infrastructure for lotteries, giveaways, rewards and competitions where every draw is verifiable (Chainlink VRF) and every prize is claimable directly from the contract. The lottery remains the flagship; the Event Center is how the protocol earns and grows.

Positioning: most "giveaway platforms" are Web2 with crypto branding — no on-chain proof of fairness. INSTANT WIN's difference is the proof itself. **Proof, Not Promise.**

## 2. Product decisions (V1 — Giveaway Adapter)

**A. Who pays.** The event creator (brand/company/community) creates and funds the giveaway, depositing the full prize up front. The protocol charges a fee as a **percentage of the prize with a fixed minimum** (exact numbers set in Part 4, with modelling). This is the protocol's first direct revenue line.

**B. How participants enter.** Entry is **free**: one wallet = one entry. The creator may optionally provide an eligibility list (allowlist). No participant funds are ever collected — this is the key regulatory distinction from the lottery and what makes the product sellable to brands.

**C. Prizes.** V1 supports **any ERC-20 token** (USDC, project tokens, etc.) — the transfer/claim logic is token-agnostic, so restricting to USDC would cost flexibility without buying simplicity. **V1.1 adds NFTs (ERC-721/1155)** as a distinct prize module (custody and delivery have their own edge cases). Winner selection is always Chainlink VRF.

**D. Draw execution.** Same proven pattern as the lottery: time-based close → VRF request → fulfillment → pull-payment claim. Automated via a dedicated CRE workflow (~$30/month, within plan credits).

**Carried over from V3, unchanged:** pull-payment for all prizes and refunds; claims never pausable; any cancellation path returns funds to the creator.

## 3. Architecture principle

RaffleManagerV3 is immutable and is **not touched**. The Event Center is a set of new contracts deployed alongside it. The giveaway contract has no knowledge of whether a participant is Web3-native or Web2-onboarded — on-chain, everyone is an address. No speculative flexibility is built for future phases; each phase lands as its own contracts/modules.

**Open verification items (blocking Part 2 — to be confirmed by on-chain/report before any design is fixed):**
1. Does the current VRF v2.5 subscription support multiple consumers (so GiveawayManager can share it)?
2. How is the AutomationReceiver bound to V3, and what does a second CRE workflow require?

## 4. Roadmap

- **Phase 1 — Lottery Day 0.** CRE deploy access → 48h autonomous rounds → public launch. *The blocker for everything else.*
- **Phase 2 — Event Center: Giveaway Adapter.** V1 (any ERC-20) → V1.1 (NFTs). First B2B revenue.
- **Phase 3 — Web2 bridge.** Form-based onboarding: the system creates a wallet for the participant so the draw is always on-chain, even when the user never sees the wallet. Consciously deferred items for this phase: key custody, GDPR/data handling, Web2 prize delivery. The giveaway contract does not change.
- **Phase 4 — Platform token.** Utility (event fees + burn per use), community-first distribution based on **real engagement measured by the points program** (see 5). **Non-negotiable preconditions:** legal entity established; legal opinion (MiCA / securities analysis); enough event volume for burn to be meaningful. No public sale, no launch-first-regularize-later, no announcements before the structure exists.

## 5. Points program (starts with Phase 2)

The platform records points for real engagement: participating in rounds, creating events, bringing users. Points are **not a token, carry no promised value, and no conversion is announced**. They serve two purposes: user acquisition/retention now, and — if and when Phase 4 happens under proper legal structure — a fair, farmer-resistant basis for retroactive distribution.

## 6. Regulatory posture (unchanged and non-negotiable)

Zero sale and zero promotion of any asset (shares, tokens, or otherwise) until legal structuring is complete. Free-entry giveaways avoid the wagering pattern; the points program creates no asset. All public communication states facts about deployed code only.

## 7. Buildathon framing (Arbitrum Open House Singapore — starts Sept 14)

Submission narrative, three steps, first one already real:
1. **Live now:** provably fair lottery — immutable verified contract on Arbitrum One, Chainlink VRF, automated via CRE.
2. **In design (this spec):** Event Center — provably fair giveaways and airdrops of any ERC-20/NFT for brands and communities.
3. **The bridge:** Web2 onboarding via system-created wallets — every draw on-chain even for users who have never touched a wallet.

Token appears as one sober line: *sustainable token economics (utility + burn, community-first distribution) under legal review for a later phase.* Regulatory framing by trend, not prediction: MiCA in force in the EU, US market structure legislation advancing — brands will need compliant, verifiable infrastructure for on-chain engagement.

---

## Next parts

- **Part 2 — Contract architecture** (blocked on the two verification items in §3; verification via read-only Claude Code report)
- **Part 3 — Flows and states** (event lifecycle, failure paths)
- **Part 4 — Frontend, fees and narrative** (fee modelling included)
- **Part 5 — Claude Code prompts** (one at a time; every prompt begins with the absolute credentials rule)
