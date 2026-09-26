/**
 * Campaign identity — the shape the browser and the bridge agree on.
 * SPEC-BRIDGE-V2 §17 (L1–L10).
 *
 * Imported by pages/ and components/ AND by lib/bridge-v2, api/bridge/v2 and
 * api/og. It imports nothing, so neither bundle pulls in the other's
 * dependencies, and the message a creator signs is built by one function on
 * both sides rather than by two copies that can drift apart (L3): a signature
 * over a message the server rebuilds differently is a signature that never
 * verifies, and nobody would see why.
 *
 * Everything here is a pure function of its input. What the server adds on top
 * — the on-chain creator, the nonce ledger, the upload — lives in
 * lib/bridge-v2/campaignIdentity.ts.
 */

export const IDENTITY_VERSION = 1 as const;

export const NAME_MAX = 80;
export const BRAND_MAX = 60;
export const MESSAGE_MAX = 280;
export const MESSAGE_MAX_LINES = 6;
export const LINK_MAX = 200;

export type ImageSlot = 'banner' | 'logo';
export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * L5: raster formats only, checked on the bytes and never on a declared type.
 *
 * The banner bounds are what a link preview needs: every large-card format
 * (Open Graph, X, Telegram, WhatsApp) crops towards 1.91:1, so a banner far from
 * that ratio is a banner the preview cuts in half. The maxima bound the decoded
 * size a browser is asked to hold, not only the bytes on the wire.
 */
export const IMAGE_LIMITS = {
  banner: {
    maxBytes: 2 * 1024 * 1024,
    minWidth: 600,
    minHeight: 314,
    maxWidth: 4096,
    maxHeight: 4096,
    minRatio: 1.5,
    maxRatio: 2.5,
  },
  logo: {
    maxBytes: 512 * 1024,
    minWidth: 64,
    minHeight: 64,
    maxWidth: 2048,
    maxHeight: 2048,
    minRatio: 0.5,
    maxRatio: 2,
  },
} as const;

export const IMAGE_EXTENSION: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** The storage object an image lives at. Content-addressed, so a replay rewrites nothing. */
export function imageObjectPath(giveawayId: string, slot: ImageSlot, sha256: string, type: ImageType): string {
  return `campaigns/${giveawayId}/${slot}-${sha256}.${IMAGE_EXTENSION[type]}`;
}

// ---------------------------------------------------------------------------
// text
// ---------------------------------------------------------------------------

/**
 * L4: every control (Cc) and format (Cf) character, every
 * Default_Ignorable_Code_Point, and the blank Braille pattern.
 *
 * Default_Ignorable_Code_Point is the Unicode property a renderer uses to draw a
 * character as nothing, and it covers code points not assigned yet (U+2065,
 * U+FFF0 to U+FFF8, the rest of the tag and variation-selector planes), which a
 * browser already gives zero width. Listing categories let those through. The
 * property also contains the variation selectors, the combining grapheme joiner,
 * the Hangul and Khmer fillers and the tag block. U+2800 renders blank without
 * being default-ignorable, so it is named.
 *
 * The name and the brand are printed into the subject of an email sent from the
 * platform's own authenticated domain (L8) and into the preview title. A
 * right-to-left override there can make a sentence read as something it does not
 * say, and an invisible character can make two different names look identical,
 * or split a "www." the link filter below would otherwise refuse.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u{2800}]/u;

/**
 * L8: no link inside a name or a brand. Those two strings reach an email subject,
 * and "Your account is locked, verify at www.example" is a phishing subject
 * whichever campaign it came from. A brand that is a domain ("Acme.io") is still
 * allowed; a scheme or a www. prefix is not.
 */
const LINK_LIKE = /:\/\/|\bwww\./i;

export interface IdentityText {
  readonly name: string;
  readonly message: string;
  readonly brand: string;
  readonly link: string | null;
}

export type TextField = 'name' | 'message' | 'brand' | 'link';

export type TextCheck = { readonly ok: true; readonly value: IdentityText } | { readonly ok: false; readonly field: TextField };

const codePoints = (text: string) => Array.from(text).length;

/** One line of text, normalised; null when empty, too long, invisible-charactered or link-shaped. Shared with lib/keptra-description.ts. */
export function singleLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  const length = codePoints(text);
  if (length === 0 || length > max) return null;
  if (INVISIBLE.test(text) || LINK_LIKE.test(text)) return null;
  return text;
}

/** Several lines of text, normalised the same way; null when empty, too long, too many lines or invisible-charactered. */
export function multiLine(value: unknown, max: number, maxLines: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const length = codePoints(text);
  if (length === 0 || length > max) return null;
  if (text.split('\n').length > maxLines) return null;
  if (INVISIBLE.test(text.replace(/\n/g, ''))) return null;
  return text;
}

/** undefined is "invalid"; null is "no link", which is allowed. */
function parseLink(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const raw = value.trim();
  if (raw === '') return null;
  if (raw.length > LINK_MAX || INVISIBLE.test(raw) || /\s/.test(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  // https only, no credentials, no port: the link is shown to participants as
  // "the brand's site", and each of those is a way to make it something else.
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return undefined;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z0-9-]{2,}$/i.test(url.hostname)) return undefined;
  return url.href.length <= LINK_MAX ? url.href : undefined;
}

/** L4: the text fields, normalised the one way both sides normalise them. */
export function checkText(input: { name: unknown; message: unknown; brand: unknown; link: unknown }): TextCheck {
  const name = singleLine(input.name, NAME_MAX);
  if (name === null) return { ok: false, field: 'name' };
  const message = multiLine(input.message, MESSAGE_MAX, MESSAGE_MAX_LINES);
  if (message === null) return { ok: false, field: 'message' };
  const brand = singleLine(input.brand, BRAND_MAX);
  if (brand === null) return { ok: false, field: 'brand' };
  const link = parseLink(input.link);
  if (link === undefined) return { ok: false, field: 'link' };
  return { ok: true, value: { name, message, brand, link } };
}

/** The host a link is shown as, without the scheme and the www. */
export function displayHost(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------

export interface ImageMeta {
  readonly type: ImageType;
  readonly width: number;
  readonly height: number;
}

export type ImageProblem = 'size' | 'type' | 'dimensions';

export type ImageCheck = { readonly ok: true; readonly meta: ImageMeta } | { readonly ok: false; readonly problem: ImageProblem };

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));
const u16be = (b: Uint8Array, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32be = (b: Uint8Array, o: number) => u16be(b, o) * 0x10000 + u16be(b, o + 2);
const u16le = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, o: number) => u16le(b, o) | ((b[o + 2] ?? 0) << 16);
const u32le = (b: Uint8Array, o: number) => u24le(b, o) + (b[o + 3] ?? 0) * 0x1000000;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sniffPng(b: Uint8Array): ImageMeta | null {
  if (b.length < 33 || PNG_SIGNATURE.some((value, index) => b[index] !== value)) return null;
  // IHDR is required to be the first chunk and is always 13 bytes long.
  if (u32be(b, 8) !== 13 || ascii(b, 12, 4) !== 'IHDR') return null;
  return { type: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
}

/** SOF0–SOF15, minus DHT (C4), JPG (C8) and DAC (CC), which share the range. */
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

function sniffJpeg(b: Uint8Array): ImageMeta | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  let offset = 2;
  while (offset < b.length) {
    if (b[offset] !== 0xff) return null;
    while (offset < b.length && b[offset] === 0xff) offset += 1; // the prefix and any fill bytes
    if (offset >= b.length) return null;
    const marker = b[offset] as number;
    offset += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue; // no length field
    if (marker === 0xd9 || marker === 0xda) return null; // image data before any frame header
    if (offset + 2 > b.length) return null;
    const length = u16be(b, offset);
    if (length < 2 || offset + length > b.length) return null;
    if (isStartOfFrame(marker)) {
      if (length < 7) return null;
      return { type: 'image/jpeg', height: u16be(b, offset + 3), width: u16be(b, offset + 5) };
    }
    offset += length;
  }
  return null;
}

function sniffWebp(b: Uint8Array): ImageMeta | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') return null;
  if (u32le(b, 4) + 8 > b.length) return null; // truncated
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { type: 'image/webp', width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const [b1, b2, b3, b4] = [b[21] ?? 0, b[22] ?? 0, b[23] ?? 0, b[24] ?? 0];
    return {
      type: 'image/webp',
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + (((b2 & 0xc0) >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  if (chunk === 'VP8X') {
    return { type: 'image/webp', width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  }
  return null;
}

/**
 * L5: what the bytes are, from the bytes.
 *
 * PNG, JPEG and WebP, with their dimensions read from the header. Everything
 * else is null — SVG and HTML above all, because both are documents a browser
 * runs when it is served one, and a declared "image/png" says nothing about what
 * was actually uploaded.
 */
export function sniffImage(bytes: Uint8Array): ImageMeta | null {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffWebp(bytes);
}

export function checkImage(slot: ImageSlot, bytes: Uint8Array): ImageCheck {
  const limits = IMAGE_LIMITS[slot];
  if (bytes.length === 0 || bytes.length > limits.maxBytes) return { ok: false, problem: 'size' };
  const meta = sniffImage(bytes);
  if (meta === null) return { ok: false, problem: 'type' };
  const ratio = meta.width / meta.height;
  if (
    meta.width < limits.minWidth ||
    meta.height < limits.minHeight ||
    meta.width > limits.maxWidth ||
    meta.height > limits.maxHeight ||
    !(ratio >= limits.minRatio && ratio <= limits.maxRatio)
  ) {
    return { ok: false, problem: 'dimensions' };
  }
  return { ok: true, meta };
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// what is signed
// ---------------------------------------------------------------------------

export interface SignedImage extends ImageMeta {
  readonly sha256: string;
}

export interface IdentityContent extends IdentityText {
  readonly giveawayId: string;
  readonly banner: SignedImage;
  readonly logo: SignedImage | null;
}

const imagePart = (image: SignedImage) => ({
  sha256: image.sha256,
  type: image.type,
  width: image.width,
  height: image.height,
});

/**
 * L3: the exact bytes the signature covers, by hash.
 *
 * Built field by field in a fixed order, never by serialising an object that
 * arrived over the wire, so key order and extra keys cannot change the hash.
 * The images are in it by their SHA-256, which is what binds a signature to the
 * picture as well as to the words.
 */
export function canonicalContent(content: IdentityContent): string {
  return JSON.stringify({
    v: IDENTITY_VERSION,
    giveawayId: content.giveawayId,
    name: content.name,
    message: content.message,
    brand: content.brand,
    link: content.link,
    banner: imagePart(content.banner),
    logo: content.logo === null ? null : imagePart(content.logo),
  });
}

export const NONCE_PATTERN = /^[0-9a-f]{32}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** An instant in the one form toISOString produces, so both sides print it identically. */
export function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export interface MessageParts {
  readonly giveawayId: string;
  readonly name: string;
  readonly brand: string;
  readonly contentHash: string;
  readonly contract: string;
  readonly chainId: number;
  readonly issuedAt: string;
  readonly nonce: string;
}

/**
 * L3: the text the creator's wallet shows and signs (EIP-191 personal_sign).
 *
 * Readable first, because a wallet prompt nobody can read is a prompt people
 * learn to sign blindly: it says what is being published and for which
 * campaign, and that it costs nothing. Then everything that makes it unusable
 * anywhere else — the content hash, the contract and chain, when it was signed
 * and a nonce the server spends once. The contract is lower-cased so a
 * checksummed and a plain copy of the same address sign the same bytes.
 */
export function identityMessage(parts: MessageParts): string {
  return [
    'Instant Win — campaign identity',
    '',
    `Publish this name, message and images for campaign #${parts.giveawayId}.`,
    'Only the wallet that created the campaign can do this.',
    '',
    `Campaign: ${parts.name}`,
    `Brand: ${parts.brand}`,
    `Content: sha256:${parts.contentHash}`,
    `Contract: ${parts.contract.toLowerCase()}`,
    `Chain ID: ${parts.chainId}`,
    `Issued at: ${parts.issuedAt}`,
    `Nonce: ${parts.nonce}`,
    '',
    'Signing is free and sends no transaction.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// what is read back
// ---------------------------------------------------------------------------

export interface PublicImage extends SignedImage {
  readonly url: string;
}

/** What the public read route returns per campaign, and what the pages render. */
export interface PublicIdentity {
  readonly giveawayId: string;
  readonly name: string;
  readonly message: string;
  readonly brand: string;
  readonly link: string | null;
  readonly banner: PublicImage;
  readonly logo: PublicImage | null;
  readonly version: number;
  readonly updatedAt: string;
}

/** The campaign as an email names it. null when the creator has published nothing (L9). */
export interface CampaignLabel {
  readonly name: string;
  readonly brand: string;
}
