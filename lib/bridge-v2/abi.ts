/**
 * The minimum ABI of GiveawayManagerV2 that the bridge needs.
 *
 * EXTRACTED from the compiled artifact that produced the deployed bytecode
 * (instant-win-audit/v2, out/GiveawayManagerV2.sol/GiveawayManagerV2.json), not
 * written by hand. To change it, extract again; do not edit an entry in place.
 *
 * H1 keeps this list short on purpose. What the bridge signs against this
 * contract, through THIS ABI, is enter(), addEligibilityRoot() under the role
 * key, and claimPrize() on behalf of a winning derived wallet — nothing else
 * is here that can move state. Everything else in the list is a view that
 * decides whether one of those three is allowed to happen.
 *
 * The owner's 07/09/2026 decision adds a fourth signed action, createGiveaway,
 * for a creator with no wallet of their own — but as a second derived-wallet
 * role entirely (bridge_v2_creators, never the entrant's own address) and
 * through a SEPARATE constant, CREATOR_CAMPAIGN_MANAGER_ABI, further down this
 * file. It stays out of the constant below on purpose: this file's own tests
 * assert that GIVEAWAY_MANAGER_V2_ABI carries exactly the three
 * state-changing functions the entry and prize pipelines use, and that
 * assertion is worth keeping true of the surface it actually describes.
 *
 * claimPrize and its views are section 7 of the specification: a settled
 * campaign pays msg.sender, and msg.sender has to be the derived wallet that was
 * drawn, so the claim is a transaction this side signs or the prize is never
 * collected at all. claimable() is what tells the bridge there is something to
 * collect, winnerIndex() is which item an NFT winner is owed (section 8.3), and
 * CLAIM_DEADLINE is the ninety-day window past which the creator takes it back.
 *
 * vrfCoordinator and subscriptionId are views as well: H8 asks for the VRF
 * subscription balance to be monitored, and the two public immutables are how the
 * bridge learns where to look without a second configured address to keep in step
 * with the deployment.
 *
 * The errors are here so a revert can be decoded by name. Without them a refusal
 * from the contract is an opaque byte string and the bridge cannot tell "entries
 * closed" from "not eligible", which are different answers to the participant.
 * contractErrorName at the foot of this file is what finally reads them.
 */

import { decodeErrorResult, type Hex } from 'viem';

export const GIVEAWAY_MANAGER_V2_ABI = [
  {
    "type": "function",
    "name": "addEligibilityRoot",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "root",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "bridge",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "effectiveEndTime",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "enter",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "rootIndex",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "merkleProof",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getEligibilityRootsCount",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getGiveaway",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct GiveawayManagerV2.Giveaway",
        "components": [
          {
            "name": "creator",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "startTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "winnersCount",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "prizeModule",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "endTime",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum GiveawayManagerV2.Status"
          },
          {
            "name": "prizeKind",
            "type": "uint8",
            "internalType": "enum PrizeKind"
          },
          {
            "name": "cancelReason",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "feeToken",
            "type": "address",
            "internalType": "contract IERC20"
          },
          {
            "name": "slotCap",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "nextAttempt",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "pausedOffset",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "closedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "drawRequestedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "settledAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "prizeAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "declaredValue",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "feeAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "slotsPaid",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "prizeDelivered",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "vrfRequestId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "seed",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hasEntered",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "paused",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "slotsRemaining",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "EligibilityRootAdded",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "rootIndex",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "root",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Entered",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "wallet",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "index",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyEntered",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EnforcedPause",
    "inputs": []
  },
  {
    "type": "error",
    "name": "EntriesClosed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "GiveawayNotOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRoot",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotBridge",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotEligible",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SlotsExhausted",
    "inputs": []
  },
  {
    "type": "function",
    "name": "CLAIM_DEADLINE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimPrize",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "claimable",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "wallet",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "winnerIndex",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "wallet",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "prizeClaimed",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "error",
    "name": "ClaimExpired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NothingToClaim",
    "inputs": []
  },
  {
    "type": "function",
    "name": "vrfCoordinator",
    "inputs": [],
    "outputs": [{ "name": "", "type": "address", "internalType": "contract IVRFCoordinatorV2Plus" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "subscriptionId",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  }
] as const;

/**
 * createGiveaway() and its views, kept OUT of GIVEAWAY_MANAGER_V2_ABI on
 * purpose. H1's own tests assert that ABI carries exactly three
 * state-changing functions (enter, addEligibilityRoot, claimPrize) — the
 * entry and prize pipelines, which never touch this constant. The
 * creator-without-wallet pipeline (07/09/2026 decision) is a genuinely
 * separate signing surface, signed by a genuinely separate derived-wallet
 * role (bridge_v2_creators, never a participant's own address; see
 * chain.ts's "Creator-without-wallet campaigns" section) — so it gets its own
 * ABI rather than widening the one those tests hold the entry/prize surface
 * to.
 */
export const CREATOR_CAMPAIGN_MANAGER_ABI = [
  {
    "type": "function",
    "name": "createGiveaway",
    "inputs": [
      { "name": "module", "type": "address", "internalType": "address" },
      { "name": "prizeData", "type": "bytes", "internalType": "bytes" },
      { "name": "prizeAmount", "type": "uint256", "internalType": "uint256" },
      { "name": "declaredValue", "type": "uint256", "internalType": "uint256" },
      { "name": "duration", "type": "uint256", "internalType": "uint256" },
      { "name": "winnersCount", "type": "uint32", "internalType": "uint32" },
      { "name": "slotCap", "type": "uint32", "internalType": "uint32" }
    ],
    "outputs": [{ "name": "giveawayId", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "currentFee",
    "inputs": [
      { "name": "kind", "type": "uint8", "internalType": "enum PrizeKind" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pricePerSlot",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "isModuleRegistered",
    "inputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "GiveawayCreated",
    "inputs": [
      { "name": "giveawayId", "type": "uint256", "indexed": true, "internalType": "uint256" },
      { "name": "creator", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "prizeModule", "type": "address", "indexed": true, "internalType": "address" },
      { "name": "prizeKind", "type": "uint8", "indexed": false, "internalType": "enum PrizeKind" },
      { "name": "prizeToken", "type": "address", "indexed": false, "internalType": "address" },
      { "name": "prizeAmount", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "declaredValue", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "feeToken", "type": "address", "indexed": false, "internalType": "contract IERC20" },
      { "name": "feeAmount", "type": "uint256", "indexed": false, "internalType": "uint256" },
      { "name": "endTime", "type": "uint64", "indexed": false, "internalType": "uint64" },
      { "name": "winnersCount", "type": "uint32", "indexed": false, "internalType": "uint32" },
      { "name": "slotCap", "type": "uint32", "indexed": false, "internalType": "uint32" },
      { "name": "slotsPaid", "type": "uint256", "indexed": false, "internalType": "uint256" }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "ModuleNotRegistered",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDuration",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidWinnersCount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSlotCap",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPrizeAmount",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDeclaredValue",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PrizeAmountMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PrizeTooSmall",
    "inputs": []
  }
] as const;

/**
 * GiveawayManagerV2.Status. Must match the enum in the contract.
 *
 * The bridge only ever admits an entry while a campaign is OPEN, which the
 * contract enforces as well; reading it first turns a revert into a clear answer
 * rather than a wasted transaction.
 */
export const GiveawayStatus = {
  NONE: 0,
  OPEN: 1,
  CLOSED: 2,
  DRAW_REQUESTED: 3,
  SEED_RECEIVED: 4,
  SETTLED: 5,
  CANCELLED: 6,
} as const;

/** PrizeKind as the contract declares it, used to apply the E2 thresholds. */
export const PrizeKind = {
  TOKEN: 0,
  NFT: 1,
} as const;

/**
 * The one function of the Chainlink VRF 2.5 coordinator the bridge reads (H8).
 *
 * A separate ABI rather than an addition to the one above, because it belongs to
 * a different contract: the coordinator address comes from GiveawayManagerV2's
 * own immutable, so nothing here is configurable and there is no second place a
 * read could be pointed at.
 *
 * Read only. The bridge holds no LINK, funds no subscription and signs nothing
 * for this contract.
 */
export const VRF_COORDINATOR_V2_PLUS_ABI = [
  {
    "type": "function",
    "name": "getSubscription",
    "inputs": [{ "name": "subId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      { "name": "balance", "type": "uint96", "internalType": "uint96" },
      { "name": "nativeBalance", "type": "uint96", "internalType": "uint96" },
      { "name": "reqCount", "type": "uint64", "internalType": "uint64" },
      { "name": "subOwner", "type": "address", "internalType": "address" },
      { "name": "consumers", "type": "address[]", "internalType": "address[]" }
    ],
    "stateMutability": "view"
  }
] as const;

/**
 * The prize itself, once it is in the derived wallet.
 *
 * E2 sends a prize at or above the threshold, and every NFT, to a wallet the
 * winner owns. The contract can only deliver to msg.sender, so the value passes
 * through the derived wallet and is handed on from there — which needs exactly
 * one function per prize kind and nothing else.
 *
 * H2 still holds: the destination of that transfer is the address the
 * participant confirmed through E4, read from the database, and the token or
 * collection is read from the chain. Neither is a parameter of any route.
 */
export const ERC20_ABI = [
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [{ "name": "account", "type": "address", "internalType": "address" }],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "transfer",
    "inputs": [
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  }
] as const;

/**
 * approve() and allowance(), kept OUT of ERC20_ABI on purpose. H1's own tests
 * assert that no ABI the bridge carries can approve or move a third party's
 * balance — true of ERC20_ABI, which the entry and prize pipelines use to
 * read a balance and hand a prize on, and true of it still: this pass adds a
 * genuinely new capability (a creator's derived wallet approving a spend of
 * its OWN balance, never a third party's), and it gets its own constant
 * rather than widening the one those tests hold the entry/prize surface to.
 */
export const CREATOR_APPROVAL_ABI = [
  {
    "type": "function",
    "name": "approve",
    "inputs": [
      { "name": "spender", "type": "address", "internalType": "address" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "allowance",
    "inputs": [
      { "name": "owner", "type": "address", "internalType": "address" },
      { "name": "spender", "type": "address", "internalType": "address" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  }
] as const;

/**
 * The one view every prize module shares (IPrizeModule.prizeKind), read before
 * a creator-without-wallet campaign is drafted (07/09/2026 decision).
 *
 * DESVIO (0.4): this pass only funds a TOKEN-kind module on the creator's
 * behalf — takeCustody's prizeData for an NFT module is a list of token ids
 * the creator must already hold and approve individually, which is a second,
 * larger unit of work than a single ERC-20 approval and is left for a later
 * pass. A module that answers NFT here is refused with a clear 400, not
 * silently miscoded.
 */
export const PRIZE_MODULE_KIND_ABI = [
  {
    "type": "function",
    "name": "prizeKind",
    "inputs": [],
    "outputs": [{ "name": "", "type": "uint8", "internalType": "enum PrizeKind" }],
    "stateMutability": "pure"
  }
] as const;

export const ERC721_ABI = [
  {
    "type": "function",
    "name": "ownerOf",
    "inputs": [{ "name": "tokenId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "address", "internalType": "address" }],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "safeTransferFrom",
    "inputs": [
      { "name": "from", "type": "address", "internalType": "address" },
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "tokenId", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const;

/**
 * The two views of ERC721PrizeModule the bridge needs to know WHICH item a
 * winner was handed.
 *
 * The core stores the winner's position, not the token id; the module holds the
 * deposited items and gives the n-th of them to the n-th winner (section 8.3).
 * So the token id is itemsOf(giveawayId)[winnerIndex] and the collection is the
 * one recorded at custody. Read only — the bridge never calls this module.
 *
 * The module address is not configured here either: it comes from
 * getGiveaway().prizeModule, which the core bound at creation and never
 * reassigns.
 */
export const ERC721_PRIZE_MODULE_ABI = [
  {
    "type": "function",
    "name": "custodyOf",
    "inputs": [{ "name": "giveawayId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      { "name": "collection", "type": "address", "internalType": "contract IERC721" },
      { "name": "itemCount", "type": "uint256", "internalType": "uint256" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "itemsOf",
    "inputs": [{ "name": "giveawayId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [{ "name": "", "type": "uint256[]", "internalType": "uint256[]" }],
    "stateMutability": "view"
  }
] as const;

/**
 * ERC-1155, and why prizeKind alone was never enough to build a delivery.
 *
 * PrizeKind has two values and there are three prize shapes. ERC721PrizeModule
 * and ERC1155PrizeModule both answer PrizeKind.NFT — the core freezes that value
 * from whichever module a campaign was created with and never looks further —
 * so a campaign whose prize is an ERC-1155 arrived here indistinguishable from
 * an ERC-721 one and was handed to the ERC-721 path: itemsOf on a module that
 * has no itemsOf, ownerOf on a collection that has no ownerOf, and a three-
 * argument safeTransferFrom that does not exist in the ERC-1155 standard. Every
 * one of those reverts, so nothing was stolen and nothing was delivered either:
 * the prize sat in a derived wallet, which is the one place E1 says value may
 * never rest, and the thirty-day custody clock ran out around it.
 *
 * Both modules are registered in the core for prizeKind NFT, so this is not a
 * hypothetical shape.
 */
export const ERC1155_ABI = [
  {
    "type": "function",
    "name": "balanceOf",
    "inputs": [
      { "name": "account", "type": "address", "internalType": "address" },
      { "name": "id", "type": "uint256", "internalType": "uint256" }
    ],
    "outputs": [{ "name": "", "type": "uint256", "internalType": "uint256" }],
    "stateMutability": "view"
  },
  {
    // The standard has one transfer and it carries an amount and a data field.
    // There is no three-argument form to fall back on and no unsafe variant, so
    // the ERC-721 encoding of a delivery is not a near miss on this collection —
    // it is a selector the contract does not implement.
    "type": "function",
    "name": "safeTransferFrom",
    "inputs": [
      { "name": "from", "type": "address", "internalType": "address" },
      { "name": "to", "type": "address", "internalType": "address" },
      { "name": "id", "type": "uint256", "internalType": "uint256" },
      { "name": "amount", "type": "uint256", "internalType": "uint256" },
      { "name": "data", "type": "bytes", "internalType": "bytes" }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  }
] as const;

/**
 * The two views of ERC1155PrizeModule the bridge needs, plus the one that tells
 * it which module it is talking to.
 *
 * custodyOf has the same decoded shape as the ERC-721 module's — an address and
 * a count — so it cannot be the discriminator. lotsOf can: section 8.3 pairs the
 * n-th winner with the n-th deposited UNIT, and units are deposited in lots of
 * (id, total), so the token id a winner is owed is the id of the lot their
 * flattened position falls in. That walk is the module's own _lotIndexOf, done
 * on this side because the module exposes the lots and not the mapping.
 *
 * supportsInterface is the discriminator. ERC1155PrizeModule declares it, for
 * IERC1155Receiver; ERC721PrizeModule declares no supportsInterface at all, and
 * PrizeModuleBase adds none, so the call reverts there. A revert read as "not
 * this module" is the standard ERC-165 probe and is what OpenZeppelin's own
 * checker does.
 *
 * The module address is not configured anywhere: it comes from
 * getGiveaway().prizeModule, which the core bound at creation and never
 * reassigns.
 */
export const ERC1155_PRIZE_MODULE_ABI = [
  {
    "type": "function",
    "name": "custodyOf",
    "inputs": [{ "name": "giveawayId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      { "name": "collection", "type": "address", "internalType": "contract IERC1155" },
      { "name": "unitCount", "type": "uint256", "internalType": "uint256" }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "lotsOf",
    "inputs": [{ "name": "giveawayId", "type": "uint256", "internalType": "uint256" }],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct ERC1155PrizeModule.Lot[]",
        "components": [
          { "name": "id", "type": "uint256", "internalType": "uint256" },
          { "name": "total", "type": "uint256", "internalType": "uint256" },
          { "name": "remaining", "type": "uint256", "internalType": "uint256" }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "supportsInterface",
    "inputs": [{ "name": "interfaceId", "type": "bytes4", "internalType": "bytes4" }],
    "outputs": [{ "name": "", "type": "bool", "internalType": "bool" }],
    "stateMutability": "pure"
  }
] as const;

/**
 * IERC1155Receiver's ERC-165 interface id.
 *
 * The XOR of onERC1155Received and onERC1155BatchReceived, as the standard
 * defines it, and the value ERC1155PrizeModule.supportsInterface answers true
 * for. A literal here rather than computed: it is a constant of the standard,
 * and computing it would mean carrying the two selectors instead.
 */
export const ERC1155_RECEIVER_INTERFACE_ID = '0x4e2312e0' as const;

// -----------------------------------------------------------------------------
// K5 — reading a revert back
// -----------------------------------------------------------------------------

/**
 * Every ABI a revert reaching this bridge can have come from.
 *
 * The manager first, because all but two of the interesting refusals live there;
 * then the token standards, because a prize delivery is a call into a contract
 * the campaign creator chose; then the prize modules, which have errors of their
 * own.
 */
const REVERT_ABIS = [
  GIVEAWAY_MANAGER_V2_ABI,
  ERC20_ABI,
  ERC721_ABI,
  ERC1155_ABI,
  ERC721_PRIZE_MODULE_ABI,
  ERC1155_PRIZE_MODULE_ABI,
  CREATOR_CAMPAIGN_MANAGER_ABI,
  CREATOR_APPROVAL_ABI,
] as const;

/**
 * The name of the contract error behind a failure, or null.
 *
 * K5, AND THE HEADER OF THIS FILE ALREADY PROMISED IT. Ten custom errors are
 * carried here so that "a revert can be decoded by name", and nothing decoded
 * one: log.failure recorded error.name, which for every refusal this contract
 * makes is the string "EstimateGasExecutionError". That is the class of the
 * wrapper, and it is the same class for a campaign that closed a block ago, a
 * proof that does not verify, a paused platform, a slot ledger that ran out and a
 * role the contract no longer accepts — five different operator actions behind
 * one word. The V1 failure K5 exists to close was throwing away err.message;
 * throwing away the four bytes that say which error it was is the same loss by a
 * different route.
 *
 * WHERE THOSE FOUR BYTES ARE. viem's estimateGas takes no ABI, so it cannot
 * decode anything and does not try: the payload arrives as `data` on an error
 * several links down the cause chain, and the walk below finds it wherever in
 * that chain it sits rather than depending on a nesting that changes between
 * versions. A contract-aware call decodes on its own and leaves the answer in
 * `data.errorName`; both are read, because the bridge makes both kinds of call.
 *
 * THE CHAIN IS WALKED BY HAND, and not with viem's own walker, because reaching
 * that walker means an instanceof against viem's base class and an instanceof is
 * an identity check. Two copies of the library in one process — a bundler that
 * did not dedupe, a transitive copy under a wallet package — and every revert in
 * the system silently reads as "not a revert", which is the failure this function
 * exists to end, restored by the diagnosis. `cause` is a language feature and
 * needs no agreement between copies. The depth cap is for a cause that points
 * back into its own chain; nothing observed does, and a diagnostic must not be
 * able to hang the failure path it is describing.
 *
 * K4 IS WHY ONLY THE NAME COMES BACK. decodeErrorResult also returns the
 * arguments, and one of the shapes it recognises is the built-in Error(string) —
 * an arbitrary string chosen by whatever contract reverted. A name is a constant
 * of a deployed contract and says nothing about a person; the arguments are
 * exactly the kind of value that must not reach a log.
 *
 * Null for anything that is not a revert, so a timeout and a transport failure
 * still read as what they are.
 */
export function contractErrorName(error: unknown): string | null {
  let decoded: string | null = null;
  let payload: Hex | null = null;

  let link: unknown = error;
  for (let depth = 0; depth < 16 && link !== null && link !== undefined; depth += 1) {
    const data = (link as { data?: unknown }).data;
    if (typeof data === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(data)) {
      payload ??= data as Hex;
    } else if (typeof data === 'object' && data !== null) {
      const named = (data as { errorName?: unknown }).errorName;
      if (typeof named === 'string' && decoded === null) decoded = named;
    }
    link = (link as { cause?: unknown }).cause;
  }

  if (decoded !== null) return decoded;
  if (payload === null) return null;

  for (const abi of REVERT_ABIS) {
    try {
      return decodeErrorResult({ abi, data: payload }).errorName;
    } catch {
      // Not this contract's error. Try the next; if none of them knows the
      // selector the caller keeps the class it already had, because an
      // undecodable revert is still more honest than a guess.
    }
  }
  return null;
}
