/**
 * The guardian key. SPEC-BLOCO-03 6.1.4, 6.4, A7 and A15.
 *
 * One key, one power: signing the recovery module's hash for a new owner list
 * that R-1 has already accepted (recovery.ts). It is never an owner of any
 * account (the module refuses it: GuardianStorage "guardian cannot be an owner"),
 * it sends no transaction of its own — the relayer submits its signature — and a
 * recovery it confirms takes seven days and can be cancelled by the passkey (A7).
 *
 * F6, as everywhere: the account is built, used and dropped inside the function.
 */

import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { requireEnv } from './env.js';
import { keeperAddress, roleAddress } from './chain.js';
import { funderAddress, poolSize } from './funders.js';

/** The guardian every new account is configured with. */
export function guardianAddress(): `0x${string}` {
  return privateKeyToAccount(requireEnv('BRIDGE_V2_GUARDIAN_KEY') as Hex).address;
}

/**
 * Signs the module's recovery hash (a raw ECDSA signature, which is what
 * SignatureChecker.isValidSignatureNow recovers against). Only recovery.ts calls
 * it, and only after newOwnersRefusal returned null for the same owner list.
 */
export async function signRecoveryHash(hash: Hex): Promise<Hex> {
  const account = privateKeyToAccount(requireEnv('BRIDGE_V2_GUARDIAN_KEY') as Hex);
  return account.sign({ hash });
}

/**
 * M39, section 5: "Cada papel usa uma chave diferente". The guardian, the
 * relayer and funders (one role, A15), the bridge role and the keeper, compared
 * by address two by two. Returns the colliding pairs, empty when all differ;
 * the maintenance pass alerts on anything else.
 */
export function roleCollisions(): string[] {
  const roles: [string, string][] = [
    ['guardian', guardianAddress()],
    ['bridge_role', roleAddress()],
    ['keeper', keeperAddress()],
  ];
  const size = poolSize();
  for (let index = 0; index < size; index += 1) roles.push([`relayer_${index}`, funderAddress(index)]);

  const collisions: string[] = [];
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = i + 1; j < roles.length; j += 1) {
      if (roles[i][1].toLowerCase() === roles[j][1].toLowerCase()) collisions.push(`${roles[i][0]}=${roles[j][0]}`);
    }
  }
  return collisions;
}
