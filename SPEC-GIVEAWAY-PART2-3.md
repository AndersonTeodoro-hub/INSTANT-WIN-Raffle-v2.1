# SPEC — Event Center · Giveaway Adapter (V1) — Part 2+3: Architecture & State Machine

**Status:** APPROVED 2026-08-28 — design frozen. Amended and re-approved 2026-08-28: two-step settle + Part 4 constants (large-campaign scale). Changes require explicit re-approval.
**Date:** 2026-08-28
**Depends on:** SPEC-GIVEAWAY.md (Part 1 — product decisions and roadmap)
**Grounding:** All integration facts below were verified on-chain by read-only report (2026-08-28), sources cited inline.

---

## Part 2 — Contract architecture

### 2.1 Components

**One new contract: `GiveawayManager` (V1).** Standalone, immutable (no proxy, no upgrade path), deployed alongside RaffleManagerV3. Nothing in production is modified.

**Verified integration facts (report 2026-08-28):**
- VRF v2.5 subscription supports up to **100 consumers** (`MAX_CONSUMERS = 100`, read on-chain from coordinator `0x3C0C...7a3e`; SubscriptionAPI.sol L22). Current: 2/100. → GiveawayManager becomes the **3rd consumer** of the existing subscription via `addConsumer` (owner action, browser-first).
- AutomationReceiver `0xb3Fe...74C3F5` is a **generic multi-target bridge**: allowlist is `mapping(address target => mapping(bytes4 selector => bool))` (AutomationReceiver.sol L82); target decoded from report at runtime (L336–353). → **Same receiver serves both contracts.** New `(GiveawayManager, selector)` pairs added by owner; a **second CRE workflow** ($30/month, within plan credits per Order Form 4.2.1) drives giveaway closes.
- Subscription LINK balance covers ≈960 draws at observed cost (~0.0022 LINK/draw). No top-up required for V1 launch.

### 2.2 Core design

Unlike the lottery (one global round), the GiveawayManager hosts **many concurrent, independent giveaways**, each identified by `giveawayId` (incrementing counter). Per-giveaway storage struct:

```
struct Giveaway {
    address creator;          // who created and funded it
    IERC20  prizeToken;       // any ERC-20
    uint256 prizeAmount;      // actual amount received (balance-delta accounting)
    uint64  endTime;          // entries close at this timestamp
    uint32  winnersCount;     // N winners, equal split
    bytes32 eligibilityRoot;  // optional Merkle root; 0x0 = open to any wallet
    Status  status;           // lifecycle state (Part 3)
    uint256 vrfRequestId;     // set when draw requested
    uint64  drawRequestedAt;  // for DRAW_TIMEOUT rescue
    address[] participants;   // one entry per wallet
}
```

**Creation (creator pays everything up front).** `createGiveaway(prizeToken, prizeAmount, duration, winnersCount, eligibilityRoot)`:
- Transfers in `prizeAmount + fee` in the prize token. Fee = `max(prizeAmount * FEE_BPS / 10_000, feeMin)` — `FEE_BPS` immutable (constructor); because a fixed minimum cannot be one constant across arbitrary tokens/decimals, **the fixed minimum is enforced in the prize token as `MIN_PRIZE` guard instead**: `prizeAmount * FEE_BPS / 10_000 == 0 → revert` (dust prizes rejected). Exact `FEE_BPS` value set in Part 4.
- **Balance-delta accounting:** `prizeAmount` recorded as actual balance received, so fee-on-transfer tokens are handled correctly. **Rebasing tokens are unsupported** (documented limitation; creator's responsibility).
- **Transfer-restricted tokens (RWA/compliance-layer ERC-20s, e.g. ERC-3643-style):** supported, provided the creator aligns the giveaway's `eligibilityRoot` with the token's own transfer whitelist, so every eligible entrant can receive the prize. Pull-payment already isolates any reverting claim (failure path 3). Creator's responsibility, stated in docs/UI. This makes the eligibility list double as the compliance tool for tokenized-asset (RWA) campaigns.
- Bounds: `duration` within `[MIN_DURATION, MAX_DURATION]`; `winnersCount` within `[1, MAX_WINNERS]`; values fixed as constants in Part 4.

**Entry (free).** `enter(giveawayId, merkleProof)`:
- One wallet = one entry (`hasEntered` mapping guard).
- If `eligibilityRoot != 0x0`, wallet must present a valid Merkle proof (leaf = `keccak256(abi.encodePacked(wallet))`). Root is computed off-chain by the creator; one `bytes32` on-chain — minimum state.
- Open giveaways (root = 0x0) accept sybil entries by design; this is the **creator's informed choice**, documented in the UI. Allowlist is the sybil defense for brands.
- Cap: `MAX_PARTICIPANTS` per giveaway (bounds VRF settle gas; constant set in Part 4).

**Close (permissionless).** `closeGiveaway(giveawayId)` callable by **anyone** once `block.timestamp >= endTime` — more decentralized than owner-only and automation-friendly. This is the selector the CRE workflow invokes via the AutomationReceiver.
- If `participants.length == 0` → giveaway → CANCELLED, prize+fee credited back to creator (pull-payment). No draw, no fee charged on a giveaway that never happened.
- Else → request VRF (1 word), status → DRAW_REQUESTED.

**Winner selection — two-step settle (amendment 2026-08-28, approved).** VRF callback gas is capped (~2.5M on v2.5), which cannot hold large winner sets. Therefore:
- **Step 1 (VRF callback):** stores only the random seed → status `SEED_RECEIVED`. Cheap, always fits the callback cap.
- **Step 2 (`finalizeWinners(giveawayId)`):** permissionless normal transaction (no callback cap) that derives and stores winners from the stored seed: `winnerIndex_i = uint(keccak256(seed, i)) % participants.length`, skipping already-selected indices (bounded; `winnersCount` clamped to `participants.length` at close). Prize split equally; remainder dust to the first winner (deterministic, documented). Driven by the CRE workflow like `closeGiveaway`; anyone can call it if automation is down.
- Derivation is fully deterministic from the on-chain seed — Step 2 adds zero manipulation surface: whoever calls it, the winners are the same.

**Claims (pull-payment, carried from V3 unchanged).**
- `claimPrize(giveawayId)` — winner withdraws share.
- `claimCreatorRefund(giveawayId)` — creator withdraws prize+fee after CANCELLED.
- `withdrawFees(token)` — owner withdraws accumulated protocol fees per token.
- **Claims are never pausable.** `pause()` blocks only `createGiveaway` and `enter`.

**Rescue path (carried from V3).** If VRF does not fulfill within `DRAW_TIMEOUT`, `cancelStuckDraw(giveawayId)` (permissionless after timeout) → CANCELLED → creator refund path. No funds can ever be trapped.

### 2.3 Security baseline (all carried from the V3 playbook)

- Solidity 0.8.x, SafeERC20 everywhere, ReentrancyGuard on all external state-changing functions with transfers, Ownable2Step, checks-effects-interactions.
- No admin power over outcomes: owner can pause creation/entry, withdraw fees, and nothing else. Owner cannot pick winners, cannot touch prizes, cannot block claims.
- No upgradeability, no external calls except tokens + VRF coordinator.
- **Absolute credentials rule applies to every prompt in the build.**

### 2.4 What is deliberately NOT in V1 (minimum necessary)

No NFT prizes (V1.1). No paid entries. No multiple entries per wallet. No token-gated entry by balance (allowlist covers brand use). No per-giveaway fee negotiation (one global FEE_BPS). No registry/factory pattern — one contract, one counter. No events pagination helpers beyond standard view functions.

---

## Part 3 — State machine & flows

### 3.1 States

```
NONE → OPEN → DRAW_REQUESTED → SEED_RECEIVED → SETTLED     (happy path)
         │            │
         │            └── (DRAW_TIMEOUT elapsed) → CANCELLED
         ├── (endTime reached, 0 participants)  → CANCELLED
         └── (creator cancels while OPEN)       → CANCELLED
```

| State | Entered by | Allowed actions |
|---|---|---|
| OPEN | `createGiveaway` | `enter` (until endTime), `cancelByCreator`, `closeGiveaway` (after endTime) |
| DRAW_REQUESTED | `closeGiveaway` with ≥1 participant | VRF `fulfillRandomWords` → SEED_RECEIVED; `cancelStuckDraw` after DRAW_TIMEOUT |
| SEED_RECEIVED | VRF fulfillment (stores seed only) | `finalizeWinners` (permissionless) → SETTLED |
| SETTLED | `finalizeWinners` | `claimPrize` (winners), forever |
| CANCELLED | zero-entry close, creator cancel, or stuck-draw rescue | `claimCreatorRefund` (creator), forever |

**Creator cancel:** allowed only while OPEN. Refund = prize + fee (no fee on a giveaway that didn't run). Participants lose nothing (entry was free; gas is sunk cost, documented).

### 3.2 Failure paths — explicit answers

1. **VRF never fulfills** → `cancelStuckDraw` after DRAW_TIMEOUT → creator refund. Nothing trapped.
2. **Fee-on-transfer token** → balance-delta accounting; recorded prize = received amount.
3. **Malicious/reverting token on claim** → pull-payment isolates: only that claimant's withdrawal fails; no other giveaway or claimant affected.
4. **winnersCount > participants** → clamped at close; equal split among actual participants.
5. **Automation down** → `closeGiveaway` is permissionless; anyone (including creator or owner manually) closes. Automation is a convenience, not a dependency — same philosophy as V3.
6. **Contract paused** → existing giveaways proceed to close/draw/claim untouched; only new creations/entries blocked.

### 3.3 Events (frontend + proof surface)

`GiveawayCreated(id, creator, token, prizeAmount, fee, endTime, winnersCount, eligibilityRoot)` · `Entered(id, wallet)` · `GiveawayClosed(id, participants)` · `RandomnessRequested(id, requestId)` · `SeedReceived(id, seed)` · `GiveawaySettled(id, winners[], sharePerWinner)` · `GiveawayCancelled(id, reason)` · `PrizeClaimed(id, winner, amount)` · `CreatorRefunded(id, amount)` · `FeesWithdrawn(token, amount)`

Every event is the proof layer: the frontend's "verify on Arbiscan" links resolve to these.

### 3.4 View functions (minimum for frontend)

`getGiveaway(id)` (full struct sans participants array) · `getParticipantsCount(id)` · `isWinner(id, wallet)` / `getWinners(id)` · `claimable(id, wallet)` · `hasEntered(id, wallet)` · `currentFee(prizeAmount)`

### 3.5 CRE workflow #2 (giveaways)

Cron-style workflow queries open giveaways past `endTime` (via view function `getCloseableGiveaways(limit)` — one extra view added for this) and giveaways in `SEED_RECEIVED` (via `getFinalizableGiveaways(limit)`), submitting reports invoking `closeGiveaway(id)` and `finalizeWinners(id)` through the AutomationReceiver. Receiver config additions (owner, browser-first): `setCallAllowed` for **both** `(GiveawayManager, closeGiveaway.selector)` and `(GiveawayManager, finalizeWinners.selector)` + gas limits per pair. Exact selectors confirmed from compiled artifact at build time — **selector reconciliation is a mandatory checklist item before allowlisting** (lesson registered from the pending `0x11c31db2` question on the lottery side).

### 3.6 Part 4 constants (approved 2026-08-28)

| Constant | Value | Rationale |
|---|---|---|
| `FEE_BPS` | 500 (5%) | Flat, simple to communicate; dust-prize guard rejects prizes where fee rounds to 0 |
| `MIN_DURATION` | 1 hour | Below this there is no real participation window |
| `MAX_DURATION` | 30 days | Longer than this is a different product |
| `MAX_WINNERS` | 1,000 | Traditional large-airdrop scale; enabled by two-step settle (winners written outside the VRF callback cap). `finalizeWinners` may batch if gas requires (implementation detail, tested at full scale) |
| `MAX_PARTICIPANTS` | 100,000 | Big-brand campaign scale; entry cost is paid per-participant at entry, settle never iterates participants beyond winner derivation |

### 3.7 GO/NO-GO test criteria (build gate — suite written with the contract, same discipline as V3's 23/23)

1. Full happy path: create → N entries → close → VRF seed → finalizeWinners → all winners claim exact shares
2. Zero-entry close → cancel → creator refund exact (prize+fee)
3. Creator cancel while OPEN → refund exact; entries after cancel revert
4. Entry guards: double entry reverts; after endTime reverts; invalid Merkle proof reverts; valid proof passes; open (root=0) accepts any wallet
5. winnersCount clamp: 5 winners requested, 3 participants → 3 winners, correct split
6. Dust remainder: indivisible prize → first winner gets remainder, total distributed == prizeAmount
7. Fee math: FEE_BPS applied correctly; dust prize (fee=0) reverts at creation
8. Fee-on-transfer token: recorded prize == received; claims match
9. Stuck draw: no fulfillment → cancelStuckDraw before timeout reverts, after timeout succeeds → creator refund
10. Pause: blocks create+enter only; close/draw/claims all proceed while paused
11. Reentrancy: malicious token cannot reenter claim/create paths
12. Access: only owner pause/withdrawFees; only creator cancelByCreator; closeGiveaway/cancelStuckDraw permissionless
13. Isolation: 3 concurrent giveaways, different tokens — no cross-contamination of funds or state; contract token balance == sum of all obligations at every step
14. VRF: fulfillment with wrong requestId reverts; double fulfillment reverts
15. Winner derivation: deterministic expansion produces no duplicate winners
16. Transfer-restricted token: claim reverting for a non-whitelisted winner stays isolated — other winners' claims, other giveaways, and creator refunds all unaffected; contract accounting remains consistent
17. Two-step settle at full scale: giveaway with MAX_WINNERS (1,000) winners and large participant set — `finalizeWinners` completes (batched if needed), no duplicates, split exact, total distributed == prizeAmount; `finalizeWinners` before SEED_RECEIVED reverts; double finalize reverts; derivation is identical regardless of caller

Deploy gate: **all criteria green in Foundry → deploy to Arbitrum One (owner, browser-first) → Genesis giveaways with owner funds (small USDC + one non-USDC ERC-20) exercising paths 1, 2 and 9 live → then, and only then, third-party prizes.**

---

## Approval

Approving this document freezes the design. Changes after code generation = the detour we agreed to avoid. Next step after approval: Part 5 prompts to Claude Code (contract + full test suite in one pass), absolute credentials rule first, as always.
