/**
 * The delivery code. SPEC-BLOCO-03 9.2, H18, I6, T6.
 *
 * - Generated on the recipient's device, before the payment or the redemption,
 *   and kept on that device: the bridge and the chain see only its commitment.
 * - 100 bits of entropy (9.2 asks for at least 96), shown as 20 characters of
 *   Crockford base32 in four groups, and in a QR that carries the code alone (T6).
 * - The conversion to the contract's format is fixed: the 20 characters are one
 *   big-endian number, left-padded to 32 bytes — the `bytes32 code` submitCode
 *   takes — and the commitment is keccak256(abi.encode(code)), the contract's own
 *   formula (KeptraEscrow.sol submitCode; relay.ts checks it the same way).
 * - Lost, it cannot be recovered: 9.4 applies, the store's declaration and the
 *   window to contest it (T6).
 */

import { encodeAbiParameters, keccak256 } from 'viem';

/** Crockford's base32: no I, L, O or U, so a code read aloud or typed is not misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 20;
export const CODE_BITS = CODE_LENGTH * 5;

/** A new code: 20 symbols from 13 random bytes (104 bits drawn, 100 used). */
export function generateDeliveryCode(random: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const bytes = random(new Uint8Array(13));
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  value >>= 4n; // 104 bits drawn, the top 100 kept
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out = ALPHABET[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}

/** The code as a person reads it: four groups of five. */
export const groupCode = (code: string): string => code.match(/.{1,5}/g)?.join('-') ?? code;

/**
 * What a store typed or scanned, as the 20 symbols — upper case, separators
 * dropped, and O, I and L read as the digits they are mistaken for. Null when it
 * is not a code.
 */
export function normalizeDeliveryCode(input: string): string | null {
  const text = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (text.length !== CODE_LENGTH) return null;
  for (const char of text) if (!ALPHABET.includes(char)) return null;
  return text;
}

/** The contract's `bytes32 code`: the symbols as one big-endian number, left-padded to 32 bytes. */
export function codeToBytes32(code: string): `0x${string}` {
  const normal = normalizeDeliveryCode(code);
  if (normal === null) throw new Error('not a delivery code');
  let value = 0n;
  for (const char of normal) value = value * 32n + BigInt(ALPHABET.indexOf(char));
  return `0x${value.toString(16).padStart(64, '0')}`;
}

/** 9.2: the commitment the payment or the redemption carries — keccak256(abi.encode(bytes32 code)). */
export function commitmentOf(code: string): `0x${string}` {
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }], [codeToBytes32(code)]));
}

/** Kept on this device only (T6), under the commitment the order carries on-chain. */
export interface CodeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const keyOf = (commitment: string) => `keptra.delivery-code.${commitment.toLowerCase()}`;

export function keepCode(store: CodeStore, code: string): `0x${string}` {
  const commitment = commitmentOf(code);
  store.setItem(keyOf(commitment), code);
  return commitment;
}

/** The code for an order's commitment, if this device made it; checked against the commitment before it is shown. */
export function codeFor(store: CodeStore, commitment: string): string | null {
  const code = store.getItem(keyOf(commitment));
  if (code === null || normalizeDeliveryCode(code) === null) return null;
  return commitmentOf(code).toLowerCase() === commitment.toLowerCase() ? code : null;
}
