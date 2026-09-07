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
import { DB_TIMEOUT_MS } from './config.js';
import { buildTree, proofFor, verifyProof } from './merkle.js';
import { publishEligibilityRoot, rootIndexFromLogs, waitForReceipt } from './chain.js';
import type { Logger } from './log.js';

export interface PublishedRoot {
  readonly rootId: string;
  readonly rootIndex: bigint;
  readonly root: Hex;
  readonly txHash: Hex;
}

/**
 * Builds a root over a batch of addresses, publishes it, and — only once the
 * receipt says it is on chain — records the leaves.
 *
 * THE ORDER IS THE POINT. The receipt decides whether anything is written at
 * all. Writing the root row first and waiting afterwards produced a row saying
 * an address was admitted under index N of a campaign whose on-chain history had
 * no index N, because the transaction had timed out or reverted. Everything
 * downstream believes that row: the entry is promoted to ELIGIBLE, gas is moved
 * to its wallet, and enter() reverts with InvalidRoot against an index the
 * contract does not have. The gas is spent, the participant is told they are in,
 * and nothing on this side ever corrects it.
 *
 * So a timeout leaves the batch exactly as it was. The entries stay VERIFIED and
 * a later run publishes again, reading a fresh index. If the timed-out
 * transaction does confirm afterwards, the campaign carries one extra root that
 * nobody proves against — the contract's root list is append-only and unused
 * entries in it cost nothing, which is a far cheaper outcome than an entry
 * admitted against a root that does not exist.
 *
 * The leaf set is stored because a proof has to be rebuildable later: the entry
 * this root admits may be submitted hours afterwards, and without the original
 * leaves the proof cannot be reconstructed.
 *
 * THE ROOT INDEX COMES OUT OF THE RECEIPT, AND THIS IS THE SECOND HALF OF THE
 * ORDER ABOVE. It used to be read with getEligibilityRootsCount at `latest`
 * before the transaction was even signed, which answers "how many roots have
 * been mined", not "which index will this one be given". Those differ exactly
 * when a publication for the same campaign is still in the mempool — the
 * ordinary case, because this runs in a loop over campaigns and the receipt wait
 * is bounded, so a publication that timed out is still pending when the next run
 * reads the count. Both publications then claimed the same index, one of them
 * wrongly. Every proof built against the wrong one fails to verify and enter()
 * reverts with NotEligible, for every entry in that batch, for ever: nothing on
 * this side ever re-reads the index, and the row is what the funding stage
 * believes.
 *
 * addEligibilityRoot emits the index it assigned, so once the receipt is in hand
 * the contract has already answered the question. An event that is not there is
 * not a number to fall back on — the batch is left exactly as a timeout leaves
 * it, and a later run publishes again.
 *
 * Returns null when the publication is not confirmed on chain, or when the
 * confirmed transaction did not say which index it took.
 */
export async function publishBatch(
  giveawayId: bigint,
  addresses: readonly `0x${string}`[],
  log: Logger,
): Promise<PublishedRoot | null> {
  const tree = buildTree(addresses);

  const txHash = await publishEligibilityRoot(giveawayId, tree.root);

  const receipt = await waitForReceipt(txHash);
  if (receipt === null || receipt.status !== 'success') {
    await log.event('root.published', {
      giveaway_id: giveawayId.toString(),
      leaves: tree.addresses.length,
      mined: receipt?.status ?? 'pending',
      recorded: false,
    });
    return null;
  }

  const rootIndex = rootIndexFromLogs(receipt.logs, giveawayId);
  if (rootIndex === null) {
    // Mined, successful, and carrying no EligibilityRootAdded for this campaign.
    // Those cannot all be true, so nothing is written: an index this side
    // invented is the exact failure this function was changed to stop.
    await log.event('root.published', {
      giveaway_id: giveawayId.toString(),
      leaves: tree.addresses.length,
      mined: 'success',
      recorded: false,
      reason: 'no_root_index_event',
    });
    return null;
  }

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
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .single(),
  ) as { id: string };

  checked(
    'eligibility.leaves_insert',
    await db
      .from('bridge_v2_eligibility_leaves')
      .insert(
        tree.addresses.map((address, position) => ({
          root_id: inserted.id,
          address,
          position,
        })),
      )
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  );

  await log.event('root.published', {
    giveaway_id: giveawayId.toString(),
    root_index: rootIndex.toString(),
    leaves: tree.addresses.length,
    mined: 'success',
    recorded: true,
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
      // ::text for the same reason as everywhere else: root_index is
      // numeric(78,0) and a JSON number cannot carry it exactly.
      .select('id, root_index::text, root')
      .eq('giveaway_id', giveawayId.toString())
      .eq('root_index', rootIndex.toString())
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as RootRow | null;
  if (rootRow === null) return null;

  const leaves = checked(
    'eligibility.leaves_select',
    await db
      .from('bridge_v2_eligibility_leaves')
      .select('address, position')
      .eq('root_id', rootRow.id)
      .order('position', { ascending: true })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
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
