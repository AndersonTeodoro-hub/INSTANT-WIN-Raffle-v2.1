import { hashMessage, recoverMessageAddress } from 'viem';
import { handle, json, methodGuard, ok, readFormBody } from '../../../../../lib/bridge-v2/http.js';
import { enforce, retryAfterHeaders } from '../../../../../lib/bridge-v2/ratelimit.js';
import { extractSignals } from '../../../../../lib/bridge-v2/signals.js';
import { parseGiveawayId } from '../../../../../lib/bridge-v2/validate.js';
import { giveawayCreator, isValidContractSignature } from '../../../../../lib/bridge-v2/chain.js';
import { readIdentity, saveIdentity, uploadImage } from '../../../../../lib/bridge-v2/campaignIdentity.js';
import {
  CHAIN_ID,
  GIVEAWAY_MANAGER_V2,
  IDENTITY_MAX_BODY_BYTES,
  IDENTITY_SIGNATURE_MAX_AGE_MS,
  IDENTITY_SIGNATURE_MAX_SKEW_MS,
} from '../../../../../lib/bridge-v2/config.js';
import {
  canonicalContent,
  checkImage,
  checkText,
  IMAGE_LIMITS,
  imageObjectPath,
  identityMessage,
  isCanonicalInstant,
  NONCE_PATTERN,
  SHA256_PATTERN,
  sha256Hex,
  type ImageSlot,
  type ImageType,
  type SignedImage,
} from '../../../../../lib/campaign-identity.js';

/**
 * POST /api/bridge/v2/campaign/identity/save   multipart/form-data
 *
 *   payload  JSON: giveawayId, name, message, brand, link, banner, logo,
 *            issuedAt, nonce, signature
 *   banner   the banner's bytes, when it is new
 *   logo     the logo's bytes, when it is new
 *
 * L2: THE WALLET THE CONTRACT RECORDS AS CREATOR, AND NOBODY ELSE. There is no
 * session here and no address in the request. The creator is read from
 * getGiveaway on chain, and the request carries a signature (EIP-191, no
 * transaction, no gas) over a message this route rebuilds itself from the
 * fields it received (L3). Recovering that message's signer and comparing it
 * with the recorded creator is the whole of the authorisation, so a request that
 * changes one character of the name, one pixel of the banner, or the campaign id
 * verifies against a different message and fails.
 *
 * A6 holds in its strongest form: no identity is taken from the client, not even
 * one to check. The only address that matters is the one the chain returns.
 *
 * Order: everything that can be decided locally first, so a malformed request
 * costs neither an RPC call nor a database write; then the chain; then the
 * images already published; then the upload; then the one write, which spends
 * the nonce (L6).
 */

type Failure =
  | 'INVALID_REQUEST'
  | 'INVALID_NAME'
  | 'INVALID_MESSAGE'
  | 'INVALID_BRAND'
  | 'INVALID_LINK'
  | 'INVALID_SIGNATURE_FORMAT'
  | 'SIGNATURE_EXPIRED'
  | 'NOT_CREATOR'
  | 'NOT_FOUND'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_TYPE'
  | 'IMAGE_DIMENSIONS'
  | 'IMAGE_MISMATCH'
  | 'IMAGE_MISSING'
  | 'SIGNATURE_USED'
  | 'STALE'
  | 'STORAGE_FAILED';

/**
 * A refusal with a stable reason next to the sentence, so the page can say it in
 * the visitor's language rather than print ours.
 */
const fail = (status: number, reason: Failure, message: string, headers: Record<string, string> = {}) =>
  json({ ok: false, error: message, reason }, status, headers);

const IMAGE_TYPES: readonly ImageType[] = ['image/png', 'image/jpeg', 'image/webp'];

/** A signed image descriptor as the payload carries it, or null. */
function parseSignedImage(value: unknown, slot: ImageSlot): SignedImage | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const limits = IMAGE_LIMITS[slot];
  if (typeof record.sha256 !== 'string' || !SHA256_PATTERN.test(record.sha256)) return null;
  if (typeof record.type !== 'string' || !IMAGE_TYPES.includes(record.type as ImageType)) return null;
  const width = record.width;
  const height = record.height;
  if (typeof width !== 'number' || !Number.isInteger(width) || width < 1 || width > limits.maxWidth) return null;
  if (typeof height !== 'number' || !Number.isInteger(height) || height < 1 || height > limits.maxHeight) return null;
  return { sha256: record.sha256, type: record.type as ImageType, width, height };
}

const sameImage = (a: SignedImage, b: SignedImage) =>
  a.sha256 === b.sha256 && a.type === b.type && a.width === b.width && a.height === b.height;

/**
 * An EOA signature recovers to its signer. A contract wallet — a Safe, or any
 * account that signs through ERC-1271 — does not, and is asked instead. Both
 * campaigns live at the time of writing were created by EIP-7702 accounts, which
 * sign with their own key and take the first path.
 */
async function signedByCreator(message: string, signature: `0x${string}`, creator: `0x${string}`): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    if (recovered.toLowerCase() === creator.toLowerCase()) return true;
  } catch {
    // Not a 65-byte ECDSA signature. It can still be a contract wallet's.
  }
  return isValidContractSignature(creator, hashMessage(message), signature);
}

const route = handle('campaign/identity/save', async ({ request, log }) => {
  const guard = methodGuard(request, 'POST');
  if (guard !== null) return guard;

  // I3, before anything is parsed: the content type and the size of the whole
  // body. Each image is held to its own ceiling further down.
  const read = await readFormBody(request, IDENTITY_MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === 'size'
      ? fail(413, 'IMAGE_TOO_LARGE', 'The upload is too large.')
      : fail(400, 'INVALID_REQUEST', 'Invalid request body.');
  }
  const form = read.form;

  const rawPayload = form.get('payload');
  if (typeof rawPayload !== 'string' || rawPayload.length > 16_384) {
    return fail(400, 'INVALID_REQUEST', 'Invalid request body.');
  }
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawPayload);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    payload = parsed as Record<string, unknown>;
  } catch {
    return fail(400, 'INVALID_REQUEST', 'Invalid request body.');
  }

  const giveawayId = parseGiveawayId(payload.giveawayId);
  if (giveawayId === null) return fail(400, 'INVALID_REQUEST', 'Invalid giveaway id.');

  const signals = await extractSignals(request);
  const verdict = await enforce([
    { axis: 'IP', value: signals.ipHash },
    { axis: 'GIVEAWAY', value: giveawayId.toString() },
    { axis: 'ROUTE_GLOBAL', value: 'campaign/identity/save' },
  ]);
  if (!verdict.allowed) {
    return fail(429, 'INVALID_REQUEST', 'Too many requests. Please wait and try again.', retryAfterHeaders(verdict));
  }

  // L4: the words.
  const text = checkText({ name: payload.name, message: payload.message, brand: payload.brand, link: payload.link });
  if (!text.ok) {
    const reason = `INVALID_${text.field.toUpperCase()}` as Failure;
    return fail(400, reason, `Invalid ${text.field}.`);
  }

  // L3: what the signature is over, and when it was made.
  const { issuedAt, nonce, signature } = payload;
  if (
    !isCanonicalInstant(issuedAt) ||
    typeof nonce !== 'string' ||
    !NONCE_PATTERN.test(nonce) ||
    typeof signature !== 'string' ||
    !/^0x(?:[0-9a-fA-F]{2}){65,4096}$/.test(signature)
  ) {
    return fail(400, 'INVALID_SIGNATURE_FORMAT', 'Invalid signature.');
  }
  const age = Date.now() - Date.parse(issuedAt);
  if (age > IDENTITY_SIGNATURE_MAX_AGE_MS || age < -IDENTITY_SIGNATURE_MAX_SKEW_MS) {
    return fail(401, 'SIGNATURE_EXPIRED', 'This signature has expired. Sign again.');
  }

  // L5: the images, as descriptors. The banner is required; the logo is not.
  const banner = parseSignedImage(payload.banner, 'banner');
  if (banner === null) return fail(400, 'IMAGE_MISSING', 'A banner is required.');
  const logo = payload.logo === null || payload.logo === undefined ? null : parseSignedImage(payload.logo, 'logo');
  if (logo === null && payload.logo !== null && payload.logo !== undefined) {
    return fail(400, 'IMAGE_MISSING', 'Invalid logo.');
  }
  if (logo === null && form.get('logo') !== null) return fail(400, 'IMAGE_MISMATCH', 'Invalid logo.');

  // L5: the bytes that were actually sent, checked against what was signed.
  const uploads: Array<{ slot: ImageSlot; bytes: Uint8Array<ArrayBuffer>; descriptor: SignedImage }> = [];
  const kept: Array<{ slot: ImageSlot; descriptor: SignedImage }> = [];
  for (const [slot, descriptor] of [['banner', banner], ['logo', logo]] as const) {
    if (descriptor === null) continue;
    const part = form.get(slot);
    if (part === null) {
      kept.push({ slot, descriptor });
      continue;
    }
    if (typeof part === 'string') return fail(400, 'IMAGE_MISMATCH', `Invalid ${slot}.`);
    if (part.size > IMAGE_LIMITS[slot].maxBytes) return fail(413, 'IMAGE_TOO_LARGE', `The ${slot} is too large.`);
    const bytes = new Uint8Array(await part.arrayBuffer());
    const checkedImage = checkImage(slot, bytes);
    if (!checkedImage.ok) {
      await log.event('identity.refused', { reason: `image_${checkedImage.problem}` });
      if (checkedImage.problem === 'size') return fail(413, 'IMAGE_TOO_LARGE', `The ${slot} is too large.`);
      if (checkedImage.problem === 'type') return fail(415, 'IMAGE_TYPE', `The ${slot} must be a PNG, JPEG or WebP image.`);
      return fail(422, 'IMAGE_DIMENSIONS', `The ${slot} dimensions are outside the limits.`);
    }
    const actual: SignedImage = { ...checkedImage.meta, sha256: await sha256Hex(bytes) };
    if (!sameImage(actual, descriptor)) return fail(400, 'IMAGE_MISMATCH', `The ${slot} does not match the signature.`);
    uploads.push({ slot, bytes, descriptor });
  }

  // L3: the message, rebuilt here from what arrived. Never taken from the client.
  const content = { giveawayId: giveawayId.toString(), ...text.value, banner, logo };
  const message = identityMessage({
    giveawayId: giveawayId.toString(),
    name: text.value.name,
    brand: text.value.brand,
    contentHash: await sha256Hex(canonicalContent(content)),
    contract: GIVEAWAY_MANAGER_V2,
    chainId: CHAIN_ID,
    issuedAt,
    nonce,
  });

  // L2: the creator, from the contract.
  const creator = await giveawayCreator(giveawayId);
  if (creator === null) return fail(404, 'NOT_FOUND', 'This campaign does not exist.');
  if (!(await signedByCreator(message, signature as `0x${string}`, creator))) {
    await log.event('identity.refused', { reason: 'not_creator' });
    return fail(403, 'NOT_CREATOR', 'Only the wallet that created this campaign can change its identity.');
  }

  // An image not sent with this request must be the one already published: a
  // signature over a hash is not an image, and nothing may point a campaign at an
  // object nobody uploaded.
  if (kept.length > 0) {
    const current = await readIdentity(giveawayId);
    for (const { slot, descriptor } of kept) {
      const published = slot === 'banner' ? current?.banner : current?.logo;
      if (published === undefined || published === null || !sameImage(published, descriptor)) {
        return fail(400, 'IMAGE_MISSING', `The ${slot} was not uploaded.`);
      }
    }
  }

  for (const { slot, bytes, descriptor } of uploads) {
    const path = imageObjectPath(giveawayId.toString(), slot, descriptor.sha256, descriptor.type);
    if (!(await uploadImage(path, bytes, descriptor.type))) {
      await log.event('identity.failed', { reason: 'storage' });
      return fail(502, 'STORAGE_FAILED', 'Something went wrong. Please try again.');
    }
  }

  const saved = await saveIdentity({
    giveawayId,
    nonce,
    signedAt: issuedAt,
    creator,
    text: text.value,
    banner,
    logo,
  });
  if (saved.kind === 'REPLAYED') return fail(409, 'SIGNATURE_USED', 'This signature was already used. Sign again.');
  if (saved.kind === 'STALE') return fail(409, 'STALE', 'A newer identity was already published.');

  await log.event('route.ok', { version: saved.version, uploaded: uploads.length });
  return ok({ version: saved.version });
});

/** 8.10: exported as a named async function declaration, like every V2 route. */
export async function POST(request: Request): Promise<Response> {
  return route(request);
}
