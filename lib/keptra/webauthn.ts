/**
 * The passkey, in the browser. SPEC-BLOCO-03 6.2.1, 6.2.2, A13, C9.
 *
 * Two calls and nothing else: create a passkey for keptra.io and hand the bridge
 * its public key (account/register), and sign a hash the bridge prepared (the Safe
 * transaction's, or the migration challenge) in exactly the shape the bridge
 * checks — authenticatorData, clientDataJSON as the browser wrote it, the DER
 * signature, the credential id (keptra.ts assertionToSignature). The private key
 * never leaves the device, and this file never sees it.
 *
 * A13 and C9: the relying party is keptra.io, a constant, and the bridge refuses an
 * assertion from any other origin. `passkeyOrigin` says whether this page is on it,
 * so a page served anywhere else says so rather than asking for a passkey that
 * would be refused (U1).
 *
 * `credentials` is navigator.credentials in the browser, and the software
 * authenticator in the tests (T8).
 */

export const RP_ID = 'keptra.io';
export const KEPTRA_ORIGIN = 'https://keptra.io';
/** ES256 (P-256), the only algorithm the signer factory verifies (F11). */
const ES256 = -7;
const TIMEOUT_MS = 120_000;

export interface CredentialsLike {
  create(options: CredentialCreationOptions): Promise<Credential | null>;
  get(options: CredentialRequestOptions): Promise<Credential | null>;
}

/** Whether this page may ask for a Keptra passkey: on keptra.io, with WebAuthn available. */
export function passkeyOrigin(origin: string, hasWebAuthn: boolean): boolean {
  return origin === KEPTRA_ORIGIN && hasWebAuthn;
}

export const toHex = (bytes: ArrayBuffer | Uint8Array): `0x${string}` =>
  `0x${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(new ArrayBuffer(body.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(body.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const random = (length: number) => crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));

/** A new passkey, and its public key as the bridge registers it: x and y as decimal strings. */
export async function createPasskey(
  credentials: CredentialsLike,
  userName: string,
): Promise<{ credentialId: string; x: string; y: string }> {
  const credential = (await credentials.create({
    publicKey: {
      rp: { id: RP_ID, name: 'Keptra' },
      user: { id: random(16), name: userName, displayName: userName },
      // The creation's challenge proves nothing here: the bridge trusts the public
      // key only as the session's own claim about its device (register.ts, A6).
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: ES256 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      attestation: 'none',
      timeout: TIMEOUT_MS,
    },
  })) as PublicKeyCredential | null;
  if (credential === null) throw new Error('No passkey was created.');
  const response = credential.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey();
  if (spki === null) throw new Error('This device did not give the passkey’s public key.');
  const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return {
    credentialId: base64Url(credential.rawId),
    x: BigInt(toHex(raw.slice(1, 33))).toString(),
    y: BigInt(toHex(raw.slice(33, 65))).toString(),
  };
}

/**
 * The passkey's signature over `hash` (32 bytes, hex), as the bridge takes it.
 * `credentialIds` are the participant's own (account/status), so the device offers
 * only a Keptra passkey of this account.
 */
export async function signHash(
  credentials: CredentialsLike,
  hash: `0x${string}`,
  credentialIds: readonly string[],
): Promise<{ credentialId: string; authenticatorData: `0x${string}`; clientDataJSON: string; signature: `0x${string}` }> {
  const credential = (await credentials.get({
    publicKey: {
      challenge: hexToBytes(hash),
      rpId: RP_ID,
      allowCredentials: credentialIds.map((id) => ({ type: 'public-key' as const, id: fromBase64Url(id) })),
      // The signer contract requires the UV flag (F11, M4): no silent signature.
      userVerification: 'required',
      timeout: TIMEOUT_MS,
    },
  })) as PublicKeyCredential | null;
  if (credential === null) throw new Error('The passkey did not sign.');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    credentialId: base64Url(credential.rawId),
    authenticatorData: toHex(response.authenticatorData),
    clientDataJSON: new TextDecoder().decode(response.clientDataJSON),
    signature: toHex(response.signature),
  };
}

/** A person closing the passkey prompt is not an error to show as one. */
export function isCancelled(error: unknown): boolean {
  return error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}
