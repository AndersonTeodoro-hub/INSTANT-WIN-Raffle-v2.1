/**
 * A WebAuthn authenticator, emulated for the tests. SPEC-BLOCO-03.
 *
 * A real P-256 key pair from Web Crypto, and assertions shaped exactly as a
 * browser returns them from navigator.credentials.get: authenticatorData
 * (rpIdHash, flags, counter), clientDataJSON with the challenge in base64url,
 * and a DER-encoded ECDSA signature over authenticatorData ‖ sha256(clientDataJSON).
 * The signer contract verifies that on-chain; nothing here is trusted by it.
 *
 * The key lives only in this process's memory and is thrown away with it.
 */

import { createHash, randomBytes } from 'node:crypto';

const hex = (bytes) => `0x${Buffer.from(bytes).toString('hex')}`;
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

/** An ECDSA (r, s) pair as the DER a browser hands over. */
function toDer(raw) {
  const integer = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
    let out = bytes.slice(i);
    if (out[0] & 0x80) out = Buffer.concat([Buffer.from([0]), out]);
    return Buffer.concat([Buffer.from([0x02, out.length]), out]);
  };
  const body = Buffer.concat([integer(Buffer.from(raw.slice(0, 32))), integer(Buffer.from(raw.slice(32, 64)))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

/**
 * A new passkey. `flags` defaults to UP|UV (0x05); the signer contract requires
 * UV, so a test can pass 0x01 to show an assertion without it is refused.
 */
export async function createPasskey({ rpId = 'keptra.io', origin = 'https://keptra.io' } = {}) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  // SPEC-BLOCO-03 piece 6: the public key as a browser's getPublicKey() hands it over (SPKI), for the page's own parsing.
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const x = BigInt(hex(raw.slice(1, 33)));
  const y = BigInt(hex(raw.slice(33, 65)));
  const credentialId = b64url(randomBytes(32));
  let counter = 0;

  async function sign(challenge, { flags = 0x05 } = {}) {
    counter += 1;
    const rpIdHash = createHash('sha256').update(rpId).digest();
    const authenticatorData = Buffer.concat([rpIdHash, Buffer.from([flags]), Buffer.from([0, 0, (counter >> 8) & 0xff, counter & 0xff])]);
    const clientDataJSON = JSON.stringify({
      type: 'webauthn.get',
      challenge: b64url(Buffer.from(challenge.slice(2), 'hex')),
      origin,
      crossOrigin: false,
    });
    const clientDataHash = createHash('sha256').update(clientDataJSON).digest();
    const signed = new Uint8Array(
      await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, Buffer.concat([authenticatorData, clientDataHash])),
    );
    return {
      credentialId,
      authenticatorData: hex(authenticatorData),
      clientDataJSON,
      signature: hex(toDer(signed)),
    };
  }

  return { x, y, credentialId, sign, spki };
}
