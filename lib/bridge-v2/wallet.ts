/**
 * Participant wallets. E1, F4 and F6.
 *
 * A derived wallet exists for one reason: the contract requires
 * msg.sender == participant and the Merkle leaf is keccak256(msg.sender), so
 * every entry has to be signed by the address that is entering. It is a signing
 * vehicle, not custody (E1). No value rests in one by design; the seed controls
 * gas in flight, never a balance.
 *
 * F6 is the rule this module is shaped around. Nothing here returns an account
 * object. The V1 handed callers a viem HDAccount, and an HDAccount exposes
 * getHdKey().privateKey to anything running in the same process — finding A4.
 * Here the account is created inside a function, used, and dropped; what crosses
 * the boundary is an address or a signed payload, never a key and never a thing
 * that holds one.
 *
 * F4: the seed is read at the moment of use and is not cached in module scope.
 * Partial and declared (R2): a warm container keeps process.env alive and
 * JavaScript cannot zero a string.
 */

import { mnemonicToAccount } from 'viem/accounts';
import type { Hex, TransactionSerializable } from 'viem';
import { requireEnv } from './env.js';

/**
 * The derivation index comes from a Postgres sequence, never from a count.
 *
 * Two concurrent registrations computing MAX(index) + 1 would derive the same
 * wallet for two people, and the second would be entering with the first
 * person's address.
 */
function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('[bridge-v2] wallet index must be a non-negative integer');
  }
}

/** The public address for an index. Nothing secret crosses this boundary. */
export function addressOf(index: number): `0x${string}` {
  assertIndex(index);
  return mnemonicToAccount(requireEnv('BRIDGE_V2_WALLET_SEED'), { addressIndex: index }).address;
}

/**
 * Signs one transaction as the derived wallet and returns the serialised result.
 *
 * The signature is produced and the account goes out of scope in the same call.
 * A caller receives bytes it can broadcast and has no route back to the key,
 * which is the encapsulation F6 asks for.
 */
export async function signAsDerived(
  index: number,
  transaction: TransactionSerializable,
): Promise<Hex> {
  assertIndex(index);
  const account = mnemonicToAccount(requireEnv('BRIDGE_V2_WALLET_SEED'), { addressIndex: index });
  return account.signTransaction(transaction);
}
