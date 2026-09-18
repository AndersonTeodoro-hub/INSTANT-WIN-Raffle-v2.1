/**
 * Keptra accounts, the pure half. SPEC-BLOCO-03 section 6 and Adenda A.
 *
 * A user account is a Safe 1.4.1 whose only owners are the user's own passkey
 * signers (6.1.2, A3), with one recovery module and one guardian (6.1.4), and a
 * fallback handler that is never that module (A2, R-4). The bridge submits the
 * account's transactions and pays their gas (6.1.5); it never signs for them.
 *
 * Everything in this file is a constant or a function of its arguments: no RPC,
 * no database, no key. The addresses are the ones confirmed on-chain in Phase A
 * (A1) and are platform constants, never configuration — a configurable address
 * here would be a configurable owner of somebody's money.
 *
 * WHAT THE BRIDGE CAN ASK AN ACCOUNT TO DO is the closed list in refusalFor
 * below (R-4, R-5, M21). Every Safe transaction the relay builds passes through
 * it before anything is signed or sent, so a new kind of call is a change to
 * this file and never a parameter.
 */

import {
  concat,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getContractAddress,
  hashTypedData,
  keccak256,
  pad,
  size,
  toHex,
  zeroAddress,
  type Hex,
} from 'viem';
import { CHAIN_ID } from './config.js';

// -----------------------------------------------------------------------------
// A1 and 6.1 — the contracts every account is made of
// -----------------------------------------------------------------------------

/** 6.1.1: the SafeL2 1.4.1 singleton every account proxy points at. */
export const SAFE_L2_SINGLETON = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762' as const;
/** A1: SafeProxyFactory 1.4.1. */
export const SAFE_PROXY_FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as const;
/** A1: MultiSendCallOnly 1.4.1 — the only delegatecall target an account may use. */
export const MULTI_SEND_CALL_ONLY = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2' as const;
/** A1, A2: CompatibilityFallbackHandler 1.4.1, set at creation on every account. */
export const FALLBACK_HANDLER = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99' as const;
/** A1: SafeWebAuthnSignerFactory v0.2.1. */
export const SIGNER_FACTORY = '0x1d31F259eE307358a26dFb23EB365939E8641195' as const;
/** 6.1.4: the Candide SocialRecoveryModule with the immutable 7-day period (F14). */
export const RECOVERY_MODULE = '0x088f6cfD8BB1dDb1BB069CCb3fc1A98927D233f2' as const;
/** 6.1.2: the v0.2.1 SharedSigner. Named only so a test can show it is never an owner. */
export const SHARED_SIGNER = '0x94a4F6affBd8975951142c3999aEAB7ecee555c2' as const;

/**
 * 6.1.3: P-256 verification through the 0x0100 precompile only, with no
 * fallback verifier. Encoded as the factory expects it, `uint176(0x100) << 160`,
 * and part of every signer address, so it can never change for an account that
 * already exists.
 */
export const VERIFIERS = 0x100n << 160n;

/** A13: the relying party of every passkey. A platform constant. */
export const RP_ID = 'keptra.io' as const;

/**
 * A13 again: where a page that asks for the passkey lives. A passkey only
 * answers on its own relying party, so every link that leads to a signature —
 * a claim, a confirmation of entry, the cancellation of a recovery — goes here.
 */
export const KEPTRA_BASE = 'https://keptra.io' as const;

/** F14/R4-Q1: the module's recovery period, fixed in its bytecode. */
export const RECOVERY_PERIOD_SECONDS = 604_800;

/** The linked-list sentinel both the Safe and the module use. */
export const SENTINEL = '0x0000000000000000000000000000000000000001' as const;

/**
 * SafeProxyFactory.proxyCreationCode(), 486 bytes, read from 0x4e1D…ec67 on
 * Arbitrum One. Needed so an account address can be computed before the
 * account exists (6.1.6) without asking the chain; the fork suite checks it
 * against the factory.
 */
export const PROXY_CREATION_CODE = '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564' as Hex;

/**
 * A10: a participant account and a creator account, never the same Safe. The
 * salt nonce is what makes them two addresses for one passkey.
 */
export type AccountRole = 'PARTICIPANT' | 'CREATOR';
export const SALT_NONCE: Record<AccountRole, bigint> = { PARTICIPANT: 0n, CREATOR: 1n };

// -----------------------------------------------------------------------------
// ABIs — only the functions this file encodes or the chain half reads
// -----------------------------------------------------------------------------

export const SAFE_ABI = [
  {
    type: 'function',
    name: 'setup',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_owners', type: 'address[]' },
      { name: '_threshold', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'data', type: 'bytes' },
      { name: 'fallbackHandler', type: 'address' },
      { name: 'paymentToken', type: 'address' },
      { name: 'payment', type: 'uint256' },
      { name: 'paymentReceiver', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'execTransaction',
    stateMutability: 'payable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'signatures', type: 'bytes' },
    ],
    outputs: [{ type: 'bool' }],
  },
  { type: 'function', name: 'enableModule', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [] },
  {
    type: 'function',
    name: 'disableModule',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [],
  },
  { type: 'function', name: 'setFallbackHandler', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [] },
  {
    type: 'function',
    name: 'addOwnerWithThreshold',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [],
  },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getOwners', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'getThreshold', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'VERSION', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'isModuleEnabled', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  {
    type: 'function',
    name: 'getModulesPaginated',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'address[]' }, { type: 'address' }],
  },
  {
    type: 'function',
    name: 'getStorageAt',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'uint256' }],
    outputs: [{ type: 'bytes' }],
  },
] as const;

export const PROXY_FACTORY_ABI = [
  {
    type: 'function',
    name: 'createProxyWithNonce',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_singleton', type: 'address' },
      { name: 'initializer', type: 'bytes' },
      { name: 'saltNonce', type: 'uint256' },
    ],
    outputs: [{ type: 'address' }],
  },
  { type: 'function', name: 'proxyCreationCode', stateMutability: 'pure', inputs: [], outputs: [{ type: 'bytes' }] },
] as const;

export const MULTI_SEND_ABI = [
  { type: 'function', name: 'multiSend', stateMutability: 'payable', inputs: [{ type: 'bytes' }], outputs: [] },
] as const;

export const SIGNER_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getSigner',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint176' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'createSigner',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint176' }],
    outputs: [{ type: 'address' }],
  },
  {
    type: 'function',
    name: 'isValidSignatureForSigner',
    stateMutability: 'view',
    inputs: [
      { name: 'message', type: 'bytes32' },
      { name: 'signature', type: 'bytes' },
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'verifiers', type: 'uint176' },
    ],
    outputs: [{ type: 'bytes4' }],
  },
  {
    type: 'event',
    name: 'Created',
    inputs: [
      { name: 'signer', type: 'address', indexed: true },
      { name: 'x', type: 'uint256', indexed: false },
      { name: 'y', type: 'uint256', indexed: false },
      { name: 'verifiers', type: 'uint176', indexed: false },
    ],
  },
] as const;

export const RECOVERY_MODULE_ABI = [
  { type: 'function', name: 'cancelRecovery', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'invalidateNonce', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'addGuardianWithThreshold',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revokeGuardianWithThreshold',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'multiConfirmRecovery',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_wallet', type: 'address' },
      { name: '_newOwners', type: 'address[]' },
      { name: '_newThreshold', type: 'uint256' },
      {
        name: '_signatures',
        type: 'tuple[]',
        components: [
          { name: 'signer', type: 'address' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: '_execute', type: 'bool' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'finalizeRecovery', stateMutability: 'nonpayable', inputs: [{ type: 'address' }], outputs: [] },
  {
    type: 'function',
    name: 'getRecoveryHash',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address[]' }, { type: 'uint256' }, { type: 'uint256' }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'getRecoveryRequest',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'guardiansApprovalCount', type: 'uint256' },
          { name: 'newThreshold', type: 'uint256' },
          { name: 'executeAfter', type: 'uint64' },
          { name: 'newOwners', type: 'address[]' },
        ],
      },
    ],
  },
  { type: 'function', name: 'nonce', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'isGuardian', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'guardiansCount', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'threshold', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getGuardians', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'address[]' }] },
  {
    type: 'event',
    name: 'RecoveryCanceled',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'NonceInvalidated',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
    ],
  },
] as const;

// -----------------------------------------------------------------------------
// 6.1.6 — an address known before the account exists
// -----------------------------------------------------------------------------

/**
 * The Safe's setup call. Owner: the one passkey signer. Threshold 1. Fallback
 * handler: the CompatibilityFallbackHandler (A2). No module and no delegatecall
 * here: the module is enabled by the account's own first transaction
 * (configurationCalls), because a setup call cannot name the Safe it is setting
 * up — the address is a hash of this very initializer.
 *
 * The guardian is therefore not part of the address, which is what lets a
 * rotated guardian key leave every address the platform has handed out intact.
 */
export function safeInitializer(signer: `0x${string}`): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'setup',
    args: [[signer], 1n, zeroAddress, '0x', FALLBACK_HANDLER, zeroAddress, 0n, zeroAddress],
  });
}

/** SafeProxyFactory.createProxyWithNonce, reproduced: CREATE2 over the proxy code and the singleton. */
export function predictSafeAddress(signer: `0x${string}`, role: AccountRole): `0x${string}` {
  const salt = keccak256(
    encodePacked(['bytes32', 'uint256'], [keccak256(safeInitializer(signer)), SALT_NONCE[role]]),
  );
  return getContractAddress({
    opcode: 'CREATE2',
    from: SAFE_PROXY_FACTORY,
    salt,
    bytecode: concat([PROXY_CREATION_CODE, pad(SAFE_L2_SINGLETON, { size: 32 })]),
  });
}

/** The factory call that deploys an account. Anyone may send it; the relayer does. */
export function createAccountCall(signer: `0x${string}`, role: AccountRole): SafeCall {
  return {
    to: SAFE_PROXY_FACTORY,
    data: encodeFunctionData({
      abi: PROXY_FACTORY_ABI,
      functionName: 'createProxyWithNonce',
      args: [SAFE_L2_SINGLETON, safeInitializer(signer), SALT_NONCE[role]],
    }),
  };
}

/** SafeWebAuthnSignerFactory.createSigner — permissionless, idempotent. */
export function createSignerCall(x: bigint, y: bigint): SafeCall {
  return {
    to: SIGNER_FACTORY,
    data: encodeFunctionData({ abi: SIGNER_FACTORY_ABI, functionName: 'createSigner', args: [x, y, VERIFIERS] }),
  };
}

// -----------------------------------------------------------------------------
// Safe transactions
// -----------------------------------------------------------------------------

/** One call an account makes. Value is always zero: no action here moves ETH. */
export interface SafeCall {
  readonly to: `0x${string}`;
  readonly data: Hex;
}

/** SafeTx with every refund field zero: the relayer is never paid by the account (6.1.5). */
export interface SafeTx {
  readonly to: `0x${string}`;
  readonly data: Hex;
  /** 0 call, 1 delegatecall — and 1 only ever to MultiSendCallOnly. */
  readonly operation: 0 | 1;
  readonly nonce: bigint;
}

/** MultiSendCallOnly's packed encoding: operation, to, value, length, data. */
export function encodeMultiSend(calls: readonly SafeCall[]): Hex {
  const packed = concat(
    calls.map((call) =>
      encodePacked(
        ['uint8', 'address', 'uint256', 'uint256', 'bytes'],
        [0, call.to, 0n, BigInt(size(call.data)), call.data],
      ),
    ),
  );
  return encodeFunctionData({ abi: MULTI_SEND_ABI, functionName: 'multiSend', args: [packed] });
}

/** The inverse of encodeMultiSend, so the allow-list can see inside a batch. */
export function decodeMultiSend(data: Hex): SafeCall[] | null {
  const selector = data.slice(0, 10).toLowerCase();
  if (selector !== encodeFunctionData({ abi: MULTI_SEND_ABI, functionName: 'multiSend', args: ['0x'] }).slice(0, 10)) {
    return null;
  }
  const bytes = data.slice(10);
  // The argument is one dynamic `bytes`: offset, length, then the payload.
  const length = Number(BigInt(`0x${bytes.slice(64, 128)}`));
  const payload = bytes.slice(128, 128 + length * 2);
  const calls: SafeCall[] = [];
  let i = 0;
  while (i < payload.length) {
    const operation = Number.parseInt(payload.slice(i, i + 2), 16);
    const to = `0x${payload.slice(i + 2, i + 42)}` as `0x${string}`;
    const value = BigInt(`0x${payload.slice(i + 42, i + 106)}`);
    const dataLength = Number(BigInt(`0x${payload.slice(i + 106, i + 170)}`));
    const callData = `0x${payload.slice(i + 170, i + 170 + dataLength * 2)}` as Hex;
    if (operation !== 0 || value !== 0n) return null;
    calls.push({ to, data: callData });
    i += 170 + dataLength * 2;
  }
  return calls;
}

/** One call goes out as itself; several go out as one delegatecall to MultiSendCallOnly. */
export function safeTxFor(calls: readonly SafeCall[], nonce: bigint): SafeTx {
  if (calls.length === 0) throw new Error('[bridge-v2] a Safe transaction needs at least one call');
  if (calls.length === 1) return { to: calls[0].to, data: calls[0].data, operation: 0, nonce };
  return { to: MULTI_SEND_CALL_ONLY, data: encodeMultiSend(calls), operation: 1, nonce };
}

/** The calls a SafeTx makes, in order. */
export function callsOf(tx: SafeTx): SafeCall[] | null {
  if (tx.operation === 0) return [{ to: tx.to, data: tx.data }];
  if (tx.to.toLowerCase() !== MULTI_SEND_CALL_ONLY.toLowerCase()) return null;
  return decodeMultiSend(tx.data);
}

/** EIP-712 SafeTx hash — what the passkey signs (the WebAuthn challenge). */
export function safeTxHash(safe: `0x${string}`, tx: SafeTx): Hex {
  return hashTypedData({
    domain: { chainId: CHAIN_ID, verifyingContract: safe },
    types: {
      SafeTx: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'operation', type: 'uint8' },
        { name: 'safeTxGas', type: 'uint256' },
        { name: 'baseGas', type: 'uint256' },
        { name: 'gasPrice', type: 'uint256' },
        { name: 'gasToken', type: 'address' },
        { name: 'refundReceiver', type: 'address' },
        { name: 'nonce', type: 'uint256' },
      ],
    },
    primaryType: 'SafeTx',
    message: {
      to: tx.to,
      value: 0n,
      data: tx.data,
      operation: tx.operation,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: zeroAddress,
      refundReceiver: zeroAddress,
      nonce: tx.nonce,
    },
  });
}

/** execTransaction calldata for a SafeTx and its signatures. */
export function execTransactionData(tx: SafeTx, signatures: Hex): Hex {
  return encodeFunctionData({
    abi: SAFE_ABI,
    functionName: 'execTransaction',
    args: [tx.to, 0n, tx.data, tx.operation, 0n, 0n, 0n, zeroAddress, zeroAddress, signatures],
  });
}

// -----------------------------------------------------------------------------
// WebAuthn — the passkey's signature, as the signer contract reads it
// -----------------------------------------------------------------------------

/** WebAuthn.Signature from safe-modules passkey v0.2.1. */
export interface WebAuthnSignature {
  readonly authenticatorData: Hex;
  /** clientDataJSON after `"challenge":"…",` and before the closing brace. */
  readonly clientDataFields: string;
  readonly r: bigint;
  readonly s: bigint;
}

export function encodeWebAuthnSignature(signature: WebAuthnSignature): Hex {
  return encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'string' }, { type: 'uint256' }, { type: 'uint256' }],
    [signature.authenticatorData, signature.clientDataFields, signature.r, signature.s],
  );
}

// The P-256 group order, written in two halves so no line of this file looks like a 32-byte key.
const P256_N = BigInt('0xffffffff00000000ffffffffffffffff' + 'bce6faada7179e84f3b9cac2fc632551');

/** base64url without padding, the form WebAuthn uses for the challenge. */
export function base64UrlOf(hex: Hex): string {
  let binary = '';
  for (let i = 2; i < hex.length; i += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A DER ECDSA signature (what navigator.credentials.get returns) as r and s. */
export function parseDerSignature(der: Hex): { r: bigint; s: bigint } | null {
  const b = der.slice(2);
  const byte = (i: number) => Number.parseInt(b.slice(i * 2, i * 2 + 2), 16);
  if (byte(0) !== 0x30 || byte(2) !== 0x02) return null;
  const rLength = byte(3);
  const r = BigInt(`0x${b.slice(8, 8 + rLength * 2)}`);
  const sAt = 4 + rLength;
  if (byte(sAt) !== 0x02) return null;
  const sLength = byte(sAt + 1);
  const s = BigInt(`0x${b.slice((sAt + 2) * 2, (sAt + 2 + sLength) * 2)}`);
  if (r === 0n || s === 0n || r >= P256_N || s >= P256_N) return null;
  return { r, s };
}

/**
 * Turns a browser assertion into the signer contract's signature, and refuses
 * one that was not made over `challenge`.
 *
 * The contract rebuilds clientDataJSON as `{"type":"webauthn.get","challenge":"<c>",<fields>}`
 * from the challenge it is asked about, so an assertion over any other hash
 * cannot verify there. Checking the prefix here as well is what lets the relay
 * refuse before it spends a read (M10).
 */
export function assertionToSignature(
  challenge: Hex,
  authenticatorData: Hex,
  clientDataJSON: string,
  derSignature: Hex,
): WebAuthnSignature | null {
  const prefix = `{"type":"webauthn.get","challenge":"${base64UrlOf(challenge)}",`;
  if (!clientDataJSON.startsWith(prefix) || !clientDataJSON.endsWith('}')) return null;
  const rs = parseDerSignature(derSignature);
  if (rs === null) return null;
  return {
    authenticatorData,
    clientDataFields: clientDataJSON.slice(prefix.length, -1),
    r: rs.r,
    s: rs.s,
  };
}

/**
 * A Safe contract signature (v = 0): the signer address as r, the offset of the
 * dynamic part as s, then the length-prefixed WebAuthn signature.
 */
export function encodeSafeSignature(signer: `0x${string}`, signature: WebAuthnSignature): Hex {
  const encoded = encodeWebAuthnSignature(signature);
  return concat([
    pad(signer, { size: 32 }),
    pad(toHex(65), { size: 32 }),
    '0x00',
    pad(toHex(size(encoded)), { size: 32 }),
    encoded,
  ]);
}

// -----------------------------------------------------------------------------
// 6.1.4 — what the account's first transaction configures
// -----------------------------------------------------------------------------

/**
 * Enables the recovery module and adds the one guardian with threshold 1.
 *
 * The prefix of the account's first transaction (nonce 0) and never anything
 * else: GuardianStorage requires the module to be enabled already
 * (GuardianStorage.sol:34-38), so both have to come from the Safe itself, in
 * this order, and R-5 forbids enabling the module at any other time.
 */
export function configurationCalls(safe: `0x${string}`, guardian: `0x${string}`): SafeCall[] {
  return [
    { to: safe, data: encodeFunctionData({ abi: SAFE_ABI, functionName: 'enableModule', args: [RECOVERY_MODULE] }) },
    {
      to: RECOVERY_MODULE,
      data: encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'addGuardianWithThreshold', args: [guardian, 1n] }),
    },
  ];
}

// -----------------------------------------------------------------------------
// 6.3 and 6.4 — recovery, from the account's side
// -----------------------------------------------------------------------------

const moduleCall = (data: Hex): SafeCall => ({ to: RECOVERY_MODULE, data });

/** R-2: a cancellation always invalidates the nonce in the same transaction. */
export function cancelRecoveryCalls(): SafeCall[] {
  return [
    moduleCall(encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'cancelRecovery' })),
    moduleCall(encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'invalidateNonce' })),
  ];
}

/**
 * R-3 as corrected by A6: the reaction to a compromised guardian. cancelRecovery
 * only when one is pending — the module reverts it otherwise (whenRecovery) —
 * then invalidateNonce, then the guardian revoked with the threshold at zero,
 * which is the only threshold the module accepts once the last guardian goes.
 */
export function revokeGuardianCalls(guardian: `0x${string}`, recoveryPending: boolean): SafeCall[] {
  const calls: SafeCall[] = [];
  if (recoveryPending) calls.push(cancelRecoveryCalls()[0]);
  calls.push(moduleCall(encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'invalidateNonce' })));
  calls.push(
    moduleCall(
      encodeFunctionData({
        abi: RECOVERY_MODULE_ABI,
        functionName: 'revokeGuardianWithThreshold',
        args: [SENTINEL, guardian, 0n],
      }),
    ),
  );
  return calls;
}

/** A6: after a rotation, the account adds the new guardian at its next login. */
export function addGuardianCalls(guardian: `0x${string}`): SafeCall[] {
  return [
    moduleCall(
      encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'addGuardianWithThreshold', args: [guardian, 1n] }),
    ),
  ];
}

/** 6.2.4: a second passkey, as a second owner with the threshold kept at 1. */
export function addOwnerCalls(safe: `0x${string}`, signer: `0x${string}`): SafeCall[] {
  return [
    { to: safe, data: encodeFunctionData({ abi: SAFE_ABI, functionName: 'addOwnerWithThreshold', args: [signer, 1n] }) },
  ];
}

/**
 * R-1: what the guardian checks about a new owner list before it confirms
 * anything. Returns the reason for refusing, or null.
 *
 * `deployed` is the set of addresses the caller found code at; the pure half
 * cannot ask the chain, and "already deployed" is the first condition.
 */
export function newOwnersRefusal(
  safe: `0x${string}`,
  newOwners: readonly `0x${string}`[],
  guardian: `0x${string}`,
  deployed: ReadonlySet<string>,
): string | null {
  // A3: one or two passkeys, never more, never none.
  if (newOwners.length === 0 || newOwners.length > 2) return 'owner_count';
  const seen = new Set<string>();
  for (const owner of newOwners) {
    const lower = owner.toLowerCase();
    if (lower === zeroAddress || lower === SENTINEL) return 'owner_reserved';
    if (lower === safe.toLowerCase()) return 'owner_is_safe';
    if (lower === guardian.toLowerCase()) return 'owner_is_guardian';
    // A3: "not duplicated" is a repetition inside the new list.
    if (seen.has(lower)) return 'owner_duplicated';
    seen.add(lower);
    if (!deployed.has(lower)) return 'owner_not_deployed';
  }
  return null;
}

// -----------------------------------------------------------------------------
// R-4, R-5, M21 — the closed list of what the relay will ask an account to do
// -----------------------------------------------------------------------------

const selectorOf = (data: Hex) => data.slice(0, 10).toLowerCase();

/** Calls on the account itself the relay may build: adding a passkey (6.2.4). Nothing else. */
const SELF_CALLS = new Set([
  selectorOf(encodeFunctionData({ abi: SAFE_ABI, functionName: 'addOwnerWithThreshold', args: [zeroAddress, 1n] })),
]);

/** Calls on the recovery module the relay may build (R-2, R-3/A6). */
const MODULE_CALLS = new Set([
  selectorOf(encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'cancelRecovery' })),
  selectorOf(encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'invalidateNonce' })),
  selectorOf(
    encodeFunctionData({
      abi: RECOVERY_MODULE_ABI,
      functionName: 'revokeGuardianWithThreshold',
      args: [zeroAddress, zeroAddress, 0n],
    }),
  ),
  selectorOf(
    encodeFunctionData({ abi: RECOVERY_MODULE_ABI, functionName: 'addGuardianWithThreshold', args: [zeroAddress, 1n] }),
  ),
]);

/**
 * Whether the relay may put this transaction in front of a passkey. Returns
 * the reason for refusing, or null.
 *
 * - delegatecall only to MultiSendCallOnly, which itself refuses delegatecall;
 * - on the account itself, only addOwnerWithThreshold — so never enableModule,
 *   disableModule (R-5), setFallbackHandler (R-4), setGuard, removeOwner,
 *   swapOwner or changeThreshold;
 * - on the module, only the four recovery calls of 6.3/6.4;
 * - the configuration prefix (configurationCalls) is accepted only as the exact
 *   first two calls of the account's first transaction.
 */
export function refusalFor(
  safe: `0x${string}`,
  tx: SafeTx,
  configuration: readonly SafeCall[] | null,
  guardian: `0x${string}`,
): string | null {
  if (tx.operation === 1 && tx.to.toLowerCase() !== MULTI_SEND_CALL_ONLY.toLowerCase()) return 'delegatecall_target';
  const calls = callsOf(tx);
  if (calls === null) return 'undecodable';

  let rest = calls;
  if (configuration !== null) {
    if (tx.nonce !== 0n) return 'configuration_not_first';
    const prefix = calls.slice(0, configuration.length);
    const matches =
      prefix.length === configuration.length &&
      prefix.every(
        (call, i) =>
          call.to.toLowerCase() === configuration[i].to.toLowerCase() &&
          call.data.toLowerCase() === configuration[i].data.toLowerCase(),
      );
    if (!matches) return 'configuration_mismatch';
    rest = calls.slice(configuration.length);
  }

  for (const call of rest) {
    const to = call.to.toLowerCase();
    if (to === safe.toLowerCase()) {
      if (!SELF_CALLS.has(selectorOf(call.data))) return 'self_call';
      continue;
    }
    if (to === RECOVERY_MODULE.toLowerCase()) {
      if (!MODULE_CALLS.has(selectorOf(call.data))) return 'module_call';
      // A guardian named by the relay is only ever the platform's own: the one
      // being revoked (R-3) or the rotated one being added (A6). Never an address
      // somebody else chose.
      const { functionName, args } = decodeFunctionData({ abi: RECOVERY_MODULE_ABI, data: call.data });
      const named =
        functionName === 'addGuardianWithThreshold'
          ? (args[0] as string)
          : functionName === 'revokeGuardianWithThreshold'
            ? (args[1] as string)
            : null;
      if (named !== null && named.toLowerCase() !== guardian.toLowerCase()) return 'guardian_mismatch';
      continue;
    }
    if (to === MULTI_SEND_CALL_ONLY.toLowerCase()) return 'nested_batch';
  }
  return null;
}

// -----------------------------------------------------------------------------
// 6.6 — the passkey's authorisation to migrate a derived wallet
// -----------------------------------------------------------------------------

/**
 * What the passkey signs to authorise the move of a derived wallet's balances
 * into its account. Bound to the chain, both addresses and the purpose, so the
 * same assertion authorises nothing else. Verified on-chain through
 * isValidSignatureForSigner (M32).
 */
export function migrationChallenge(derived: `0x${string}`, account: `0x${string}`): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }],
      ['keptra-migration-v1', BigInt(CHAIN_ID), derived, account],
    ),
  );
}

// -----------------------------------------------------------------------------
// 6.3.2 — when the recovery notices are due
// -----------------------------------------------------------------------------

export type NoticeStage = 'START' | 'MID' | 'FINAL';

const HOUR_MS = 60 * 60 * 1000;

/**
 * The notices due at `now` for a recovery confirmed at `startedAt` that
 * executes at `executeAfter`: at the start, half-way, and 24 hours before the
 * end. A stage is due from its moment until the end; the caller records each
 * one once per channel, so a stage that was missed by a run is sent late
 * rather than never.
 */
export function dueNoticeStages(startedAt: Date, executeAfter: Date, now: Date): NoticeStage[] {
  const t = now.getTime();
  const end = executeAfter.getTime();
  if (t >= end) return [];
  const due: NoticeStage[] = [];
  if (t >= startedAt.getTime()) due.push('START');
  if (t >= startedAt.getTime() + (end - startedAt.getTime()) / 2) due.push('MID');
  if (t >= end - 24 * HOUR_MS) due.push('FINAL');
  return due;
}
