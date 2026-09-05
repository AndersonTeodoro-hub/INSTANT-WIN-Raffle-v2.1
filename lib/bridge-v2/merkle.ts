/**
 * The eligibility tree. SPEC-GIVEAWAY-V2 4.1.
 *
 * This has to agree with the contract byte for byte, because a tree the contract
 * cannot verify is an address that paid gas and cannot enter. Two details decide
 * that agreement, and both are read from the contract rather than assumed.
 *
 * The leaf is keccak256 of the 20-byte address, hashed once. The contract
 * computes keccak256(abi.encodePacked(msg.sender)) and notes that address leaves
 * are 20 bytes while internal nodes are 64, so the two can never be confused —
 * which is why a second hash of the leaf, as some tooling defaults to, would be
 * wrong here.
 *
 * The internal node is keccak256 of the two children concatenated in ascending
 * order. OpenZeppelin's MerkleProof folds a proof commutatively, so the order a
 * proof is built in must be the sorted one or verification fails for half the
 * tree.
 *
 * An odd node in a layer is carried up unchanged rather than paired with itself.
 * Duplicating it would let the same proof verify a leaf that is not in the tree.
 */

import { concat, keccak256, encodePacked, type Hex } from 'viem';

/** One leaf: the address, hashed once. */
export function leafOf(address: `0x${string}`): Hex {
  return keccak256(encodePacked(['address'], [address]));
}

/** One internal node: the children in ascending order, concatenated, hashed. */
function hashPair(left: Hex, right: Hex): Hex {
  return left.toLowerCase() <= right.toLowerCase()
    ? keccak256(concat([left, right]))
    : keccak256(concat([right, left]));
}

export interface EligibilityTree {
  readonly root: Hex;
  /** Addresses in the order their leaves occupy the bottom layer. */
  readonly addresses: readonly `0x${string}`[];
  readonly layers: readonly (readonly Hex[])[];
}

/**
 * Builds the tree over a set of addresses.
 *
 * Sorted and de-duplicated first, so the same set always produces the same root.
 * Determinism is what lets a root be rebuilt later from the stored leaf list and
 * checked against what was published on-chain.
 */
export function buildTree(input: readonly `0x${string}`[]): EligibilityTree {
  const addresses = [...new Set(input.map((a) => a.toLowerCase() as `0x${string}`))].sort();
  if (addresses.length === 0) throw new Error('[bridge-v2] cannot build an eligibility tree with no addresses');

  const layers: Hex[][] = [addresses.map(leafOf)];
  while ((layers[layers.length - 1] as Hex[]).length > 1) {
    const previous = layers[layers.length - 1] as Hex[];
    const next: Hex[] = [];
    for (let i = 0; i < previous.length; i += 2) {
      const left = previous[i] as Hex;
      const right = previous[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }
    layers.push(next);
  }

  return { root: (layers[layers.length - 1] as Hex[])[0] as Hex, addresses, layers };
}

/**
 * The proof for one position in the bottom layer.
 *
 * A carried node contributes nothing at its layer, which is why the sibling is
 * only pushed when it exists. Getting that wrong produces a proof one element
 * too long and a revert that looks like ineligibility.
 */
export function proofFor(tree: EligibilityTree, position: number): Hex[] {
  if (position < 0 || position >= tree.addresses.length) {
    throw new Error('[bridge-v2] eligibility proof requested for a position outside the tree');
  }
  const proof: Hex[] = [];
  let index = position;
  for (let level = 0; level < tree.layers.length - 1; level += 1) {
    const layer = tree.layers[level] as readonly Hex[];
    const sibling = layer[index ^ 1];
    if (sibling !== undefined) proof.push(sibling);
    index = Math.floor(index / 2);
  }
  return proof;
}

/**
 * Verifies a proof the same way the contract will.
 *
 * Used before submitting an entry. A proof that fails here would fail on-chain
 * as well, and finding out in a function costs nothing while finding out in a
 * transaction costs the gas of a revert.
 */
export function verifyProof(root: Hex, address: `0x${string}`, proof: readonly Hex[]): boolean {
  let computed = leafOf(address);
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
}
