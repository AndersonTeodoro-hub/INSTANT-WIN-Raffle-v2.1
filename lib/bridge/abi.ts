// ABI minimo do GiveawayManager para a ponte.
//
// EXTRAIDO do artefacto compilado que produziu o bytecode deployado
// (instant-win-contracts@master, out/GiveawayManager.sol/GiveawayManager.json),
// nao escrito a mao. So o que a ponte usa: ler a campanha, ver se uma wallet ja
// entrou, e entrar. Alterar apenas re-extraindo do artefacto.
//
// Os errors estao aqui para o viem conseguir descodificar um revert por nome —
// e isso que permite dar uma mensagem propria em vez de um erro cru.

export const GIVEAWAY_MANAGER_ABI = [
  {
    "type": "function",
    "name": "enter",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256"
      },
      {
        "name": "merkleProof",
        "type": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getGiveaway",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "components": [
          {
            "name": "creator",
            "type": "address"
          },
          {
            "name": "endTime",
            "type": "uint64"
          },
          {
            "name": "winnersCount",
            "type": "uint32"
          },
          {
            "name": "prizeToken",
            "type": "address"
          },
          {
            "name": "drawRequestedAt",
            "type": "uint64"
          },
          {
            "name": "nextAttempt",
            "type": "uint32"
          },
          {
            "name": "status",
            "type": "uint8"
          },
          {
            "name": "prizeAmount",
            "type": "uint256"
          },
          {
            "name": "feeAmount",
            "type": "uint256"
          },
          {
            "name": "eligibilityRoot",
            "type": "bytes32"
          },
          {
            "name": "vrfRequestId",
            "type": "uint256"
          },
          {
            "name": "seed",
            "type": "uint256"
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
        "type": "uint256"
      },
      {
        "name": "",
        "type": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "Entered",
    "inputs": [
      {
        "name": "giveawayId",
        "type": "uint256",
        "indexed": true
      },
      {
        "name": "wallet",
        "type": "address",
        "indexed": true
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
    "name": "NotEligible",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ParticipantCapReached",
    "inputs": []
  }
] as const;

/** GiveawayManager.Status — tem de bater com o enum do contrato. */
export const GiveawayStatus = {
  NONE: 0,
  OPEN: 1,
  DRAW_REQUESTED: 2,
  SEED_RECEIVED: 3,
  SETTLED: 4,
  CANCELLED: 5,
} as const;
