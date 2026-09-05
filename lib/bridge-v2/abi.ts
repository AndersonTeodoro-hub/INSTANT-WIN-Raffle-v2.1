/**
 * The minimum ABI of GiveawayManagerV2 that the bridge needs.
 *
 * EXTRACTED from the compiled artifact that produced the deployed bytecode
 * (instant-win-audit/v2, out/GiveawayManagerV2.sol/GiveawayManagerV2.json), not
 * written by hand. To change it, extract again; do not edit an entry in place.
 *
 * H1 keeps this list short on purpose. The bridge signs exactly two things — a
 * gas transfer and enter() — so the surface loaded into the process that holds
 * the funder keys is only what those two need plus the views that decide whether
 * they are allowed to happen.
 *
 * The errors are here so a revert can be decoded by name. Without them a refusal
 * from the contract is an opaque byte string and the bridge cannot tell "entries
 * closed" from "not eligible", which are different answers to the participant.
 */

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
    "name": "getParticipantsCount",
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
