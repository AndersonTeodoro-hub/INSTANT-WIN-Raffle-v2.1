import { createPublicClient, http } from 'viem';
import { arbitrum } from 'viem/chains';

const client = createPublicClient({
  chain: arbitrum,
  transport: http('https://arb1.arbitrum.io/rpc'),
});

const RAFFLE_MANAGER = '0xA018d2fdE729349c1CAE20b6B72007c817Bc342c';
const SHARES_REGISTRY = '0x089B10b8Af63277FA4D8B8ECb23603B451245f59';

const RAFFLE_ABI = [
  {
    name: 'getCurrentRound',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint256' },
      { name: 'totalPool', type: 'uint256' },
      { name: 'endTime', type: 'uint256' },
      { name: 'participantCount', type: 'uint256' },
      { name: 'ticketCount', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
    ],
  },
] as const;

const SHARES_ABI = [
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'sharePrice',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const roundData = await client.readContract({
      address: RAFFLE_MANAGER,
      abi: RAFFLE_ABI,
      functionName: 'getCurrentRound',
    });

    const totalShares = await client.readContract({
      address: SHARES_REGISTRY,
      abi: SHARES_ABI,
      functionName: 'totalSupply',
    });

    const sharePrice = await client.readContract({
      address: SHARES_REGISTRY,
      abi: SHARES_ABI,
      functionName: 'sharePrice',
    });

    const [roundId, totalPool, endTime, participantCount, ticketCount, isActive] = roundData;

    const sharePriceNumber = Number(sharePrice) / 1e6;
    const totalSharesNumber = Number(totalShares) / 1e6;
    const totalHolders = sharePriceNumber > 0 ? Math.floor(totalSharesNumber / sharePriceNumber) : 0;

    return res.status(200).json({
      currentRound: Number(roundId),
      roundEndsAt: Number(endTime) * 1000,
      currentPool: Number(totalPool) / 1e6,
      playersInRound: Number(participantCount),
      ticketsInRound: Number(ticketCount),
      isActive: isActive,
      totalHolders: totalHolders,
      totalSharesUSDC: totalSharesNumber,
      timestamp: Date.now(),
    });

  } catch (error) {
    console.error('Error fetching live stats:', error);
    return res.status(500).json({
      error: 'Failed to fetch live stats',
      timestamp: Date.now(),
    });
  }
}
