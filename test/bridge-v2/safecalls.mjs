/**
 * The calls a Safe transaction makes, read back out of it — for the tests only.
 *
 * SPEC-BLOCO-03 Adenda F10: the relay checks the list of calls before it encodes
 * them (keptra.refusalFor), so production no longer decodes a MultiSendCallOnly
 * batch it built itself. The tests still need to see what a prepared transaction
 * would do, and this is where that inverse lives now.
 */

import { encodeFunctionData } from 'viem';
import * as keptra from '../../lib/bridge-v2/keptra.ts';

const MULTI_SEND_SELECTOR = encodeFunctionData({ abi: keptra.MULTI_SEND_ABI, functionName: 'multiSend', args: ['0x'] }).slice(0, 10);

/** The inverse of keptra.encodeMultiSend, or null for anything that is not one. */
export function decodeMultiSend(data) {
  if (data.slice(0, 10).toLowerCase() !== MULTI_SEND_SELECTOR) return null;
  const bytes = data.slice(10);
  // The argument is one dynamic `bytes`: offset, length, then the payload.
  const length = Number(BigInt(`0x${bytes.slice(64, 128)}`));
  const payload = bytes.slice(128, 128 + length * 2);
  const calls = [];
  let i = 0;
  while (i < payload.length) {
    const operation = Number.parseInt(payload.slice(i, i + 2), 16);
    const to = `0x${payload.slice(i + 2, i + 42)}`;
    const value = BigInt(`0x${payload.slice(i + 42, i + 106)}`);
    const dataLength = Number(BigInt(`0x${payload.slice(i + 106, i + 170)}`));
    const callData = `0x${payload.slice(i + 170, i + 170 + dataLength * 2)}`;
    if (operation !== 0 || value !== 0n) return null;
    calls.push({ to, data: callData });
    i += 170 + dataLength * 2;
  }
  return calls;
}

/** The calls a SafeTx makes, in order. */
export function callsOf(tx) {
  if (tx.operation === 0) return [{ to: tx.to, data: tx.data }];
  if (tx.to.toLowerCase() !== keptra.MULTI_SEND_CALL_ONLY.toLowerCase()) return null;
  return decodeMultiSend(tx.data);
}
