/**
 * Eligibility roots. SPEC-GIVEAWAY-V2 3.3, 4.1 and 4.2.
 *
 * The contract keeps an append-only array of roots per campaign and lets an
 * entry prove against any of them, current or long superseded. That is what
 * makes "eligible once, eligible for ever" structural rather than a promise: no
 * root is ever replaced, so no admission can be withdrawn.
 *
 * A published root covers exactly the batch it was built from, not everyone
 * admitted so far. Cumulative roots would grow without bound and would republish
 * addresses that already have a valid proof; per-batch roots stay small and are
 * equally valid for ever, because the contract accepts any index.
 *
 * C8: nothing reaches this module that has not already passed every filter. Once
 * an address is inside a published root it cannot be removed by anyone,
 * including us, which is the property 3.4 is protecting.
 */

import type { Hex } from 'viem';
import { checked, getDb } from './db.js';
import { buildTree, proofFor, verifyProof } from './merkle.js';
import { publishEligibilityRoot, rootsCount, waitForReceipt } from './chain.js';
import type { Logger } from './log.js';

export interface PublishedRoot {
  readonly rootId: string;
  readonly rootIndex: bigint;
  readonly root: Hex;
  readonly txHash: Hex;
}

/**
 * Builds a root over a batch of addresses, publishes it, and records the leaves.
 *
 * The leaf set is stored because a proof has to be rebuildable later: the entry
 * that this root admits may be submitted minutes or hours afterwards, and
 * without the original leaves the proof cannot be reconstructed and the address
 * is admitted on-chain with no way to use it.
 *
 * The root index is read from the contract rather than counted locally. The
 * contract is the authority on how many roots a campaign has, and a local count
 * that drifted would produce proofs against the wrong index.
 */
export async function publishBatch(
  giveawayId: bigint,
  addresses: readonly `0x${string}`[],
  log: Logger,
): Promise<PublishedRoot> {
  const tree = buildTree(addresses);
  const rootIndex = await rootsCount(giveawayId);

  const txHash = await publishEligibilityRoot(giveawayId, tree.root);

  const db = getDb();
  const inserted = checked(
    'eligibility.root_insert',
    await db
      .from('bridge_v2_eligibility_roots')
      .insert({
        giveaway_id: giveawayId.toString(),
        root_index: rootIndex.toString(),
        root: tree.root,
        leaf_count: tree.addresses.length,
        tx_hash: txHash,
      })
      .select('id')
      .single(),
  ) as { id: string };

  checked(
    'eligibility.leaves_insert',
    await db.from('bridge_v2_eligibility_leaves').insert(
      tree.addresses.map((address, position) => ({
        root_id: inserted.id,
        address,
        position,
      })),
    ),
  );

  // The root is only useful once it is mined. A timeout is not a failure — the
  // transaction may still confirm — so the caller is told the hash either way
  // and reconciliation is left to a later pass (G4, K3).
  const receipt = await waitForReceipt(txHash);
  await log.event('root.published', {
    giveaway_id: giveawayId.toString(),
    root_index: rootIndex.toString(),
    leaves: tree.addresses.length,
    mined: receipt?.status ?? 'pending',
  });

  return { rootId: inserted.id, rootIndex, root: tree.root, txHash };
}

export interface EntryProof {
  readonly rootIndex: bigint;
  readonly proof: Hex[];
}

interface RootRow {
  id: string;
  root_index: string;
  root: string;
}

interface LeafRow {
  address: string;
  position: number;
}

/**
 * Rebuilds the proof that admits one address under one published root.
 *
 * The rebuilt root is checked against the stored one before the proof is
 * returned. If they disagree, the stored leaves are not the leaves the published
 * root was built from, and submitting would burn gas on a certain revert.
 */
export async function proofForAddress(
  giveawayId: bigint,
  address: `0x${string}`,
  rootIndex: bigint,
): Promise<EntryProof | null> {
  const db = getDb();

  const rootRow = checked(
    'eligibility.root_select',
    await db
      .from('bridge_v2_eligibility_roots')
      .select('id, root_index, root')
      .eq('giveaway_id', giveawayId.toString())
      .eq('root_index', rootIndex.toString())
      .maybeSingle(),
  ) as RootRow | null;
  if (rootRow === null) return null;

  const leaves = checked(
    'eligibility.leaves_select',
    await db
      .from('bridge_v2_eligibility_leaves')
      .select('address, position')
      .eq('root_id', rootRow.id)
      .order('position', { ascending: true }),
  ) as LeafRow[] | null;
  if (!Array.isArray(leaves) || leaves.length === 0) return null;

  const ordered = leaves.map((leaf) => leaf.address.toLowerCase() as `0x${string}`);
  const tree = buildTree(ordered);
  if (tree.root.toLowerCase() !== rootRow.root.toLowerCase()) return null;

  const wanted = address.toLowerCase() as `0x${string}`;
  const position = tree.addresses.indexOf(wanted);
  if (position < 0) return null;

  const proof = proofFor(tree, position);
  if (!verifyProof(tree.root, wanted, proof)) return null;

  return { rootIndex: BigInt(rootRow.root_index), proof };
}
