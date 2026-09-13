/**
 * Campaign identity — SPEC-BRIDGE-V2 §17 (L1–L10).
 *
 * The pure checks both sides share, the two identity routes, the link-preview
 * route and the verification email, with the database, the chain and every
 * outbound call replaced by the doubles the routes suite uses. The migration is
 * executed in engine.test.mjs and read in sql.test.mjs; the settlement notice is
 * in processor.test.mjs, next to the pass that sends it.
 *
 * The signatures are real. Every wallet here is generated when the process
 * starts and lives only in its memory (rule 0.1).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { hashMessage } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { assert, http, jsonResponse, request, suite, test } from '../harness.mjs';
import * as db from '../doubles/db.mjs';
import * as chain from '../doubles/chain.mjs';
import { keyedHash } from '../../../lib/bridge-v2/crypto.ts';

import * as identityRead from '../../../api/bridge/v2/campaign/identity/read.ts';
import * as identitySave from '../../../api/bridge/v2/campaign/identity/save.ts';
import * as ogEvent from '../../../api/og/event.ts';
import * as requestCode from '../../../api/bridge/v2/session/request-code.ts';
import {
  canonicalContent,
  checkImage,
  checkText,
  IMAGE_LIMITS,
  identityMessage,
  imageObjectPath,
  sha256Hex,
  sniffImage,
} from '../../../lib/campaign-identity.ts';
import {
  CHAIN_ID,
  GIVEAWAY_MANAGER_V2,
  IDENTITY_MAX_BODY_BYTES,
  IDENTITY_SIGNATURE_MAX_AGE_MS,
} from '../../../lib/bridge-v2/config.ts';

suite('identity');

const root = new URL('../../../', import.meta.url);
const url = (path) => `https://events.invalid/api/bridge/v2/${path}`;

const creator = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

// ---------------------------------------------------------------------------
// image fixtures — headers only, which is all the server ever reads
// ---------------------------------------------------------------------------

function png(width, height, size = 64) {
  const bytes = new Uint8Array(Math.max(size, 45));
  const view = new DataView(bytes.buffer);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // IHDR
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

function jpeg(width, height) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

function webp(width, height, kind) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, 22, true);
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  view.setUint32(16, 10, true);
  if (kind === 'VP8X') {
    bytes.set([0x56, 0x50, 0x38, 0x58], 12);
    const w = width - 1;
    const h = height - 1;
    bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
    bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  } else if (kind === 'VP8L') {
    bytes.set([0x56, 0x50, 0x38, 0x4c], 12);
    bytes[20] = 0x2f;
    view.setUint32(21, ((width - 1) | ((height - 1) << 14)) >>> 0, true);
  } else {
    bytes.set([0x56, 0x50, 0x38, 0x20], 12);
    bytes.set([0x9d, 0x01, 0x2a], 23);
    view.setUint16(26, width, true);
    view.setUint16(28, height, true);
  }
  return bytes;
}

const utf8 = (text) => new TextEncoder().encode(text);

const BANNER = png(1200, 630);
const LOGO = png(256, 256);
const BANNER_SHA = await sha256Hex(BANNER);
const LOGO_SHA = await sha256Hex(LOGO);
const BANNER_URL = `https://project.supabase.invalid/storage/v1/object/public/campaign-identity/${imageObjectPath('2', 'banner', BANNER_SHA, 'image/png')}`;

const TEXT = {
  name: 'Summer Drop',
  message: 'Thank you for being part of this.',
  brand: 'Acme',
  link: 'https://acme.example/',
};

/** A row as the table holds it for campaign `giveawayId`. */
function identityRow(giveawayId = '2', overrides = {}) {
  return {
    giveaway_id: giveawayId,
    name: TEXT.name,
    message: TEXT.message,
    brand_name: TEXT.brand,
    link_url: TEXT.link,
    banner_sha256: BANNER_SHA,
    banner_type: 'image/png',
    banner_width: 1200,
    banner_height: 630,
    logo_sha256: null,
    logo_type: null,
    logo_width: null,
    logo_height: null,
    version: 1,
    updated_at: '2026-09-13T12:00:00.000Z',
    ...overrides,
  };
}

const nonce = () => crypto.randomUUID().replace(/-/g, '');

async function descriptor(bytes) {
  return { ...sniffImage(bytes), sha256: await sha256Hex(bytes) };
}

/**
 * A save request built the way the page builds it, signed by `account`.
 *
 * `sendBanner`/`sendLogo` are the bytes actually attached, which default to the
 * bytes that were signed; `after` edits the payload once it is signed, which is
 * how a tampered request is made. The banner is attached declaring itself
 * text/html, so a test that sees image/png arrive at the bucket has proved the
 * type came from the bytes.
 */
async function signedRequest({
  account = creator,
  giveawayId = '2',
  text = TEXT,
  banner = BANNER,
  logo = null,
  issuedAt = new Date().toISOString(),
  nonceValue = nonce(),
  sendBanner = banner,
  sendLogo = logo,
  after = (payload) => payload,
} = {}) {
  const bannerDescriptor = await descriptor(banner);
  const logoDescriptor = logo === null ? null : await descriptor(logo);
  const contentHash = await sha256Hex(
    canonicalContent({ giveawayId, ...text, banner: bannerDescriptor, logo: logoDescriptor }),
  );
  const message = identityMessage({
    giveawayId,
    name: text.name,
    brand: text.brand,
    contentHash,
    contract: GIVEAWAY_MANAGER_V2,
    chainId: CHAIN_ID,
    issuedAt,
    nonce: nonceValue,
  });
  const signature = await account.signMessage({ message });
  const payload = after({
    giveawayId,
    ...text,
    banner: bannerDescriptor,
    logo: logoDescriptor,
    issuedAt,
    nonce: nonceValue,
    signature,
  });
  const form = new FormData();
  form.set('payload', JSON.stringify(payload));
  if (sendBanner !== null) form.set('banner', new Blob([sendBanner], { type: 'text/html' }), 'banner');
  if (sendLogo !== null) form.set('logo', new Blob([sendLogo], { type: 'image/png' }), 'logo');
  return { form, payload, message };
}

const save = (form) =>
  identitySave.POST(
    new Request(url('campaign/identity/save'), {
      method: 'POST',
      body: form,
      headers: { 'x-forwarded-for': '198.51.100.7', 'user-agent': 'test-agent' },
    }),
  );

const readIdentities = (giveawayIds) =>
  identityRead.POST(request(url('campaign/identity/read'), { body: { giveawayIds } }));

/** A clean slate: limits open, the save function answering SAVED, #2 created by `creator`. */
function fresh() {
  db.reset();
  chain.reset();
  http.reset();
  db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: true, retry_after_seconds: 0 }], error: null }));
  db.on('rpc:bridge_v2_save_campaign_identity', () => ({
    data: [{ saved_outcome: 'SAVED', saved_version: 1 }],
    error: null,
  }));
  http.on('/storage/v1/object/campaign-identity/', () => new Response('{"Key":"stored"}', { status: 200 }));
  chain.set({ giveawayCreator: creator.address.toLowerCase() });
}

const uploads = () => http.requests.filter((entry) => entry.url.includes('/storage/v1/object/'));
const saves = () => db.callsTo('rpc:bridge_v2_save_campaign_identity');
const reasonOf = async (response) => (await response.json()).reason;

// ---------------------------------------------------------------------------
// L3, L4, L5 — the checks both sides share
// ---------------------------------------------------------------------------

await test(['L5'], 'the image type and size come from the bytes: PNG, JPEG and WebP, and nothing else', () => {
  assert.deepEqual(sniffImage(png(1200, 630)), { type: 'image/png', width: 1200, height: 630 });
  assert.deepEqual(sniffImage(jpeg(1200, 630)), { type: 'image/jpeg', width: 1200, height: 630 });
  for (const kind of ['VP8X', 'VP8L', 'VP8 ']) {
    assert.deepEqual(sniffImage(webp(1200, 630, kind)), { type: 'image/webp', width: 1200, height: 630 }, kind);
  }
  assert.equal(
    sniffImage(utf8('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"></svg>')),
    null,
    'an SVG was taken for an image',
  );
  assert.equal(sniffImage(utf8('<!DOCTYPE html><html><script>alert(1)</script></html>')), null, 'HTML was taken for an image');
  assert.equal(sniffImage(utf8('GIF89a\u0004\u0000\u0004\u0000')), null, 'a GIF was accepted');
  assert.equal(sniffImage(png(1200, 630).slice(0, 20)), null, 'a truncated PNG was accepted');
  assert.equal(sniffImage(new Uint8Array(0)), null);
});

await test(['L5'], 'each slot has its own ceiling on bytes, dimensions and shape', () => {
  const problem = (slot, bytes) => {
    const result = checkImage(slot, bytes);
    return result.ok ? 'ok' : result.problem;
  };
  assert.equal(problem('banner', png(1200, 630)), 'ok');
  assert.equal(problem('banner', png(1200, 630, IMAGE_LIMITS.banner.maxBytes + 1)), 'size');
  assert.equal(problem('banner', png(599, 314)), 'dimensions');
  assert.equal(problem('banner', png(1200, 1200)), 'dimensions', 'a square banner, which every preview crops in half');
  assert.equal(problem('banner', png(8000, 4000)), 'dimensions');
  assert.equal(problem('banner', utf8('<svg/>')), 'type');
  assert.equal(problem('logo', png(512, 512)), 'ok');
  assert.equal(problem('logo', png(32, 32)), 'dimensions');
  assert.equal(problem('logo', png(512, 512, IMAGE_LIMITS.logo.maxBytes + 1)), 'size');
});

await test(['L4', 'L8'], 'the words are normalised one way on both sides, and links stay out of names', () => {
  const accepted = checkText({
    name: '  Summer   Drop ',
    message: 'Line one\r\n\r\n\r\nLine two  ',
    brand: 'Acme.io',
    link: 'https://acme.example/path?x=1',
  });
  assert.ok(accepted.ok);
  assert.equal(accepted.value.name, 'Summer Drop');
  assert.equal(accepted.value.message, 'Line one\n\nLine two');
  assert.equal(accepted.value.brand, 'Acme.io', 'a brand that is a domain name was refused');
  assert.equal(accepted.value.link, 'https://acme.example/path?x=1');
  assert.equal(checkText({ ...TEXT, link: '' }).value.link, null);

  const field = (overrides) => {
    const result = checkText({ ...TEXT, ...overrides });
    return result.ok ? 'ok' : result.field;
  };
  assert.equal(field({ name: '' }), 'name');
  assert.equal(field({ name: 'x'.repeat(81) }), 'name');
  assert.equal(field({ name: 'Claim yours at https://evil.example' }), 'name');
  assert.equal(field({ name: 'Visit www.evil.example now' }), 'name');
  assert.equal(field({ brand: 'Acme\u202egnp.exe' }), 'brand', 'a right-to-left override would reach an email subject');
  assert.equal(field({ brand: 'Ac\u200bme' }), 'brand', 'a zero-width character would reach an email subject');
  assert.equal(field({ message: '' }), 'message');
  assert.equal(field({ message: 'y'.repeat(281) }), 'message');
  assert.equal(field({ message: 'a\nb\nc\nd\ne\nf\ng' }), 'message');
  assert.equal(field({ link: 'http://acme.example/' }), 'link');
  assert.equal(field({ link: 'https://user:pass@acme.example/' }), 'link');
  assert.equal(field({ link: 'https://acme.example:8443/' }), 'link');
  assert.equal(field({ link: 'javascript:alert(1)' }), 'link');
  assert.equal(field({ link: 'https://localhost/' }), 'link');
});

await test(['L4', 'L8'], 'no control, format or invisible character survives into a name, a brand or a message', () => {
  const hex = (codePoint) => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;

  // The cases the audit of a1a403b found passing, one by one: the Arabic letter
  // mark, the Mongolian vowel separator, the interlinear annotation marks, the
  // tag characters ("Acme" and "Acme" + TAG LATIN CAPITAL A print the same), the
  // musical symbol format controls, the combining grapheme joiner, the Hangul
  // and Khmer fillers, the variation selectors and the blank Braille pattern.
  // Then the ones the re-audit of 2e7712c found: default-ignorable code points
  // not assigned yet, which a browser draws with zero width — U+2065 had even
  // been refused in a1a403b.
  const listed = [
    0x061c, 0x180e, 0xfff9, 0xfffa, 0xfffb,
    0xe0000, 0xe0001, 0xe0020, 0xe0041, 0xe007f,
    0x1d173, 0x1d17a,
    0x034f, 0x115f, 0x1160, 0x3164, 0xffa0, 0x17b4, 0x17b5,
    0x180b, 0x180f, 0xfe00, 0xfe0f, 0xe0100, 0xe01ef,
    0x2800,
    0x2065, 0xfff0, 0xfff8, 0xe0080, 0xe00ff, 0xe01f0, 0xe0fff,
  ];
  for (const codePoint of listed) {
    for (const field of ['name', 'brand', 'message']) {
      const result = checkText({ ...TEXT, [field]: `Acme${String.fromCodePoint(codePoint)}` });
      assert.equal(result.ok ? 'ok' : result.field, field, `${hex(codePoint)} was accepted in the ${field}`);
    }
  }

  // An invisible character inside "www." or "https://" must not carry a link past
  // the filter: the two sentences the re-audit wrote, refused in a1a403b, accepted
  // in 2e7712c.
  const hidden = String.fromCodePoint(0x2065);
  for (const sentence of [`Verify at www${hidden}.example.com`, `Verify at https:${hidden}//example.com`]) {
    for (const field of ['name', 'brand']) {
      const result = checkText({ ...TEXT, [field]: sentence });
      assert.equal(result.ok ? 'ok' : result.field, field, `a link split by U+2065 was accepted in the ${field}`);
    }
  }

  // And every Cc, Cf and Default_Ignorable_Code_Point in the code space — which
  // includes the whole tag block and the unassigned ones — in the middle of a
  // word: refused, or removed by the whitespace normalisation (a tab, a line
  // break), but never stored. A line break is the one character a message is
  // allowed to keep.
  const swept = [];
  for (let codePoint = 0; codePoint <= 0x10ffff; codePoint += 1) {
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) continue;
    const character = String.fromCodePoint(codePoint);
    if (/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(character)) swept.push(codePoint);
  }
  assert.ok(swept.length > 4000, `only ${swept.length} code points were swept`);
  const leaks = [];
  for (const codePoint of swept) {
    const character = String.fromCodePoint(codePoint);
    for (const field of ['name', 'brand', 'message']) {
      if (field === 'message' && codePoint === 0x0a) continue;
      const result = checkText({ ...TEXT, [field]: `Ac${character}me` });
      if (result.ok && Array.from(result.value[field]).includes(character)) leaks.push(`${field} ${hex(codePoint)}`);
    }
  }
  assert.deepEqual(leaks, [], `stored: ${leaks.slice(0, 20).join(', ')}`);
});

await test(['L3'], 'the signed message changes with the campaign, the content, the chain, the instant and the nonce', async () => {
  const content = { giveawayId: '2', ...TEXT, banner: await descriptor(BANNER), logo: null };
  const base = {
    giveawayId: '2',
    name: TEXT.name,
    brand: TEXT.brand,
    contentHash: await sha256Hex(canonicalContent(content)),
    contract: GIVEAWAY_MANAGER_V2,
    chainId: CHAIN_ID,
    issuedAt: '2026-09-13T12:00:00.000Z',
    nonce: 'ab'.repeat(16),
  };
  const message = identityMessage(base);
  for (const [key, value] of [
    ['giveawayId', '3'],
    ['contentHash', 'f'.repeat(64)],
    ['chainId', 1],
    ['issuedAt', '2026-09-13T12:00:01.000Z'],
    ['nonce', 'cd'.repeat(16)],
  ]) {
    assert.notEqual(identityMessage({ ...base, [key]: value }), message, `${key} is not in the message`);
  }
  assert.equal(
    identityMessage({ ...base, contract: GIVEAWAY_MANAGER_V2.toLowerCase() }),
    message,
    'a checksummed and a lower-case contract address sign different bytes',
  );
  for (const other of [
    { ...content, message: 'Something else' },
    { ...content, link: null },
    { ...content, banner: { ...content.banner, sha256: 'b'.repeat(64) } },
    { ...content, banner: { ...content.banner, width: 1201 } },
  ]) {
    assert.notEqual(await sha256Hex(canonicalContent(other)), base.contentHash, 'a change is not covered by the hash');
  }
  assert.equal(canonicalContent({ extra: true, ...content }), canonicalContent(content), 'an extra key changed the hash');
  assert.match(message, /Signing is free and sends no transaction\./);
});

// ---------------------------------------------------------------------------
// L1, L2, L3, L5, L6 — campaign/identity/save
// ---------------------------------------------------------------------------

await test(['L1', 'L2', 'L3', 'L5'], "creation: the creator's signature publishes the identity of campaign #2", async () => {
  fresh();
  const { form, payload } = await signedRequest();
  const response = await save(form);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(), { ok: true, version: 1 });

  const [upload] = uploads();
  assert.ok(upload, 'the banner was never uploaded');
  assert.ok(
    upload.url.endsWith(`/storage/v1/object/campaign-identity/${imageObjectPath('2', 'banner', BANNER_SHA, 'image/png')}`),
    upload.url,
  );
  const headers = new Headers(upload.init.headers);
  assert.equal(headers.get('content-type'), 'image/png', 'the object is stored with the declared type, not the sniffed one');
  assert.equal(headers.get('x-upsert'), 'false', 'an upload may overwrite a published image');
  assert.ok(headers.get('apikey'), 'the upload carries no credential');
  assert.equal(headers.get('authorization'), null, 'the secret key went into Authorization');
  assert.ok(upload.init.signal instanceof AbortSignal, 'the upload is unbounded (G4)');

  const [call] = saves();
  assert.equal(call.args.p_giveaway_id, '2');
  assert.equal(call.args.p_creator_address, creator.address.toLowerCase());
  assert.equal(call.args.p_nonce, payload.nonce);
  assert.equal(call.args.p_signed_at, payload.issuedAt);
  assert.equal(call.args.p_name, TEXT.name);
  assert.equal(call.args.p_banner_sha256, BANNER_SHA);
  assert.equal(call.args.p_logo_sha256, null);
  assert.ok(call.abortSignal instanceof AbortSignal);
  assert.deepEqual(chain.calls.find((entry) => entry.name === 'giveawayCreator').args, [2n]);
});

await test(['L1', 'L2', 'L6'], 'edit: campaign #2 changes its words later and keeps the banner it already published', async () => {
  fresh();
  db.on('bridge_v2_campaign_identities:select', () => ({ data: identityRow('2'), error: null }));
  db.on('rpc:bridge_v2_save_campaign_identity', () => ({
    data: [{ saved_outcome: 'SAVED', saved_version: 2 }],
    error: null,
  }));
  const { form } = await signedRequest({
    text: { ...TEXT, name: 'Summer Drop — final week' },
    logo: LOGO,
    sendBanner: null,
  });
  const response = await save(form);
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(await response.json(), { ok: true, version: 2 });
  assert.deepEqual(
    uploads().map((entry) => entry.url.split('/').pop()),
    [`logo-${LOGO_SHA}.png`],
    'the kept banner was uploaded again, or the new logo was not',
  );
  assert.equal(saves()[0].args.p_name, 'Summer Drop — final week');
  assert.equal(saves()[0].args.p_banner_sha256, BANNER_SHA);
  assert.equal(saves()[0].args.p_logo_sha256, LOGO_SHA);
});

await test(['L2'], 'a wallet that is not the recorded creator is refused, and nothing is uploaded or written', async () => {
  fresh();
  const response = await save((await signedRequest({ account: stranger })).form);
  assert.equal(response.status, 403);
  assert.equal(await reasonOf(response), 'NOT_CREATOR');
  assert.equal(uploads().length, 0, 'a refused request reached the bucket');
  assert.equal(saves().length, 0, 'a refused request reached the database');
});

await test(['L2', 'L3'], 'a signature over anything but exactly what arrived is refused', async () => {
  for (const [what, options] of [
    ['a name changed after signing', { after: (payload) => ({ ...payload, name: 'Free money' }) }],
    ['another campaign', { after: (payload) => ({ ...payload, giveawayId: '3' }) }],
    ['another instant', { after: (payload) => ({ ...payload, issuedAt: new Date(Date.parse(payload.issuedAt) - 1000).toISOString() }) }],
    ['another nonce', { after: (payload) => ({ ...payload, nonce: nonce() }) }],
    ['a signature that is not one', { after: (payload) => ({ ...payload, signature: `0x${'00'.repeat(65)}` }) }],
  ]) {
    fresh();
    const response = await save((await signedRequest(options)).form);
    assert.equal(response.status, 403, what);
    assert.equal(uploads().length + saves().length, 0, `${what} reached the bucket or the database`);
  }

  fresh();
  const malformed = await save((await signedRequest({ after: (payload) => ({ ...payload, signature: '0x1234' }) })).form);
  assert.equal(malformed.status, 400);
  assert.equal(await reasonOf(malformed), 'INVALID_SIGNATURE_FORMAT');
});

await test(['L2'], 'a contract-wallet creator is asked through ERC-1271, and its answer is the answer', async () => {
  for (const accepts of [true, false]) {
    fresh();
    chain.set({ isValidContractSignature: accepts });
    // Bytes that do not recover to the creator, as a Safe's would not.
    const { form, message, payload } = await signedRequest({ account: stranger });
    const response = await save(form);
    assert.equal(response.status, accepts ? 200 : 403);
    const asked = chain.calls.find((entry) => entry.name === 'isValidContractSignature');
    assert.deepEqual(asked.args, [creator.address.toLowerCase(), hashMessage(message), payload.signature]);
  }
});

await test(['L3'], 'a signature older than its window, or from too far ahead, is refused before the chain is asked', async () => {
  for (const offset of [-(IDENTITY_SIGNATURE_MAX_AGE_MS + 1000), 3 * 60 * 1000]) {
    fresh();
    const response = await save((await signedRequest({ issuedAt: new Date(Date.now() + offset).toISOString() })).form);
    assert.equal(response.status, 401);
    assert.equal(await reasonOf(response), 'SIGNATURE_EXPIRED');
    assert.equal(chain.calls.length, 0, 'an expired signature still cost an RPC call');
  }
});

await test(['L6'], 'a spent signature, or one older than what is published, changes nothing', async () => {
  for (const [outcome, reason] of [['REPLAYED', 'SIGNATURE_USED'], ['STALE', 'STALE']]) {
    fresh();
    db.on('rpc:bridge_v2_save_campaign_identity', () => ({
      data: [{ saved_outcome: outcome, saved_version: outcome === 'STALE' ? 3 : null }],
      error: null,
    }));
    const response = await save((await signedRequest()).form);
    assert.equal(response.status, 409);
    assert.equal(await reasonOf(response), reason);
  }
});

await test(['L5'], 'an image outside its limits is refused before the chain, the bucket or the database', async () => {
  for (const [what, bytes, status, reason] of [
    ['a banner past its byte ceiling', png(1200, 630, IMAGE_LIMITS.banner.maxBytes + 1), 413, 'IMAGE_TOO_LARGE'],
    ['an SVG', utf8('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><script>alert(1)</script></svg>'), 415, 'IMAGE_TYPE'],
    ['an HTML document', utf8('<!DOCTYPE html><html><script>alert(1)</script></html>'), 415, 'IMAGE_TYPE'],
    ['a banner too small for a preview', png(500, 262), 422, 'IMAGE_DIMENSIONS'],
    ['a square banner', png(1200, 1200), 422, 'IMAGE_DIMENSIONS'],
  ]) {
    fresh();
    const response = await save((await signedRequest({ sendBanner: bytes })).form);
    assert.equal(response.status, status, what);
    assert.equal(await reasonOf(response), reason, what);
    assert.equal(chain.calls.length + uploads().length + saves().length, 0, `${what} went further than the check`);
  }

  fresh();
  const bigLogo = await save(
    (await signedRequest({ logo: LOGO, sendLogo: png(256, 256, IMAGE_LIMITS.logo.maxBytes + 1) })).form,
  );
  assert.equal(bigLogo.status, 413, 'a logo past its own, smaller, ceiling');

  fresh();
  const swapped = await save((await signedRequest({ sendBanner: png(1300, 680) })).form);
  assert.equal(swapped.status, 400);
  assert.equal(await reasonOf(swapped), 'IMAGE_MISMATCH', 'an image other than the one signed');

  fresh();
  const huge = new FormData();
  huge.set('payload', '{}');
  huge.set('banner', new Blob([new Uint8Array(IDENTITY_MAX_BODY_BYTES + 1)]), 'banner');
  const refused = await save(huge);
  assert.equal(refused.status, 413);
  assert.equal(db.calls.length, 0, 'a body past the route ceiling reached the database');
});

await test(['L2', 'L5'], 'an image that is not sent must be the one already published', async () => {
  fresh();
  db.on('bridge_v2_campaign_identities:select', () => ({ data: null, error: null }));
  const response = await save((await signedRequest({ sendBanner: null })).form);
  assert.equal(response.status, 400);
  assert.equal(await reasonOf(response), 'IMAGE_MISSING');
  assert.equal(saves().length, 0);
});

await test(['L2'], 'a campaign the contract never assigned cannot be given an identity', async () => {
  fresh();
  chain.set({ giveawayCreator: null });
  const response = await save((await signedRequest({ giveawayId: '999' })).form);
  assert.equal(response.status, 404);
  assert.equal(uploads().length + saves().length, 0);
});

await test(['I3'], 'the save route takes multipart and nothing else', async () => {
  fresh();
  const response = await identitySave.POST(request(url('campaign/identity/save'), { body: { giveawayId: '2' } }));
  assert.equal(response.status, 400);
  assert.equal(db.calls.length, 0);
});

await test(['B1', 'B2'], 'both identity routes are rate limited like every other route', async () => {
  fresh();
  db.on('rpc:bridge_v2_rate_limit_hit', () => ({ data: [{ allowed: false, retry_after_seconds: 42 }], error: null }));
  const saved = await save((await signedRequest()).form);
  assert.equal(saved.status, 429);
  assert.equal(saved.headers.get('retry-after'), '42');
  assert.equal(chain.calls.length, 0, 'a limited request still asked the chain');
  const read = await readIdentities(['2']);
  assert.equal(read.status, 429);
});

await test(['B2', 'L2'], "the identity write is limited per campaign on its own key, never on the one the campaign's entries use", async () => {
  fresh();
  const response = await save((await signedRequest()).form);
  assert.equal(response.status, 200);

  const perCampaign = db.callsTo('rpc:bridge_v2_rate_limit_hit').filter((call) => call.args.p_axis === 'GIVEAWAY');
  assert.equal(perCampaign.length, 1, 'the write is no longer limited per campaign');
  const entriesKey = await keyedHash('BRIDGE_V2_SIGNAL_HMAC_KEY', 'ratelimit-key-v1', 'GIVEAWAY:2');
  const identityKey = await keyedHash('BRIDGE_V2_SIGNAL_HMAC_KEY', 'ratelimit-key-v1', 'GIVEAWAY:identity:2');
  assert.notEqual(
    perCampaign[0].args.p_key_hash,
    entriesKey,
    'an anonymous save spends the budget entry/start and entry/resume draw on',
  );
  assert.equal(perCampaign[0].args.p_key_hash, identityKey);

  // The other half of the claim: the entry routes still key this axis on the id
  // alone. If either changed, the two hashes above would prove nothing.
  for (const route of ['api/bridge/v2/entry/start.ts', 'api/bridge/v2/entry/resume.ts']) {
    assert.match(
      readFileSync(new URL(route, root), 'utf8'),
      /\{ axis: 'GIVEAWAY', value: giveawayId\.toString\(\) \}/,
      `${route} no longer keys the campaign axis on the id alone`,
    );
  }
});

await test([], 'once the campaign exists, the creation page cannot sign a second createGiveaway', () => {
  // With an identity drafted the page stays open after the receipt, for the
  // second (gas-free) signature. The create button must not be live under it.
  const page = readFileSync(new URL('pages/EventCreate.tsx', root), 'utf8');
  assert.match(page, /disabled=\{!canSubmit \|\| createdId !== null\}/, 'the create button is live after creation');
  assert.match(
    page,
    /const create = \(\) => \{[^}]*?if \(createdId !== null\) return;\s*writeContract\(/,
    'create() signs whether or not the campaign already exists',
  );
  const writes = page.match(/functionName: 'createGiveaway'/g) ?? [];
  assert.equal(writes.length, 1, 'another path to createGiveaway exists');
});

await test(['A6', 'L2'], 'the identity write takes no address from the client and no session in place of a signature', () => {
  const code = readFileSync(new URL('api/bridge/v2/campaign/identity/save.ts', root), 'utf8');
  assert.ok(!/payload\.(address|creator|wallet|account|signer)\b/.test(code), 'the save route reads an address from its payload');
  assert.match(code, /const creator = await giveawayCreator\(giveawayId\);/);
  assert.ok(!/resolveSession/.test(code), 'a session could stand in for the signature');
});

// ---------------------------------------------------------------------------
// L7, L9 — campaign/identity/read
// ---------------------------------------------------------------------------

await test(['L7', 'L9'], 'the public read returns what was published and nothing for a campaign without it', async () => {
  fresh();
  db.on('bridge_v2_campaign_identities:select', () => ({
    data: [identityRow('2', { logo_sha256: LOGO_SHA, logo_type: 'image/png', logo_width: 256, logo_height: 256 })],
    error: null,
  }));
  const response = await readIdentities(['2', '1', '2']);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.identities), ['2'], 'a campaign without an identity was given one');
  const identity = body.identities['2'];
  assert.equal(identity.name, TEXT.name);
  assert.equal(identity.brand, TEXT.brand);
  assert.equal(identity.banner.url, BANNER_URL);
  assert.equal(identity.logo.width, 256);

  const [query] = db.callsTo('bridge_v2_campaign_identities:select');
  assert.deepEqual(query.filters, [['in', 'giveaway_id', ['2', '1']]]);
  assert.ok(!/creator_address|signed_at/.test(query.columns), 'the public read selects who signed and when');
  assert.ok(query.abortSignal instanceof AbortSignal);
});

await test(['L7', 'I1', 'I2'], 'the public read refuses an unbounded or malformed list before the database', async () => {
  for (const giveawayIds of [
    [],
    Array.from({ length: 31 }, (_unused, index) => String(index + 1)),
    ['0'],
    ['abc'],
    'not-a-list',
    [`1${'0'.repeat(78)}`],
  ]) {
    fresh();
    const response = await readIdentities(giveawayIds);
    assert.equal(response.status, 400, JSON.stringify(giveawayIds).slice(0, 40));
    assert.equal(db.calls.length, 0);
  }
});

await test(['L7'], 'the browser reads identities through the route, never through a bridge module or the database', () => {
  const files = [
    ...readdirSync(new URL('pages/', root)).map((name) => `pages/${name}`),
    ...readdirSync(new URL('components/', root)).map((name) => `components/${name}`),
    'lib/eventcenter.ts',
  ].filter((name) => /\.tsx?$/.test(name));
  const offenders = files.filter((name) =>
    /from ['"][^'"]*(bridge-v2\/|@supabase\/)/.test(readFileSync(new URL(name, root), 'utf8')),
  );
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// L9, L10 — the link preview
// ---------------------------------------------------------------------------

const og = (query, userAgent = 'facebookexternalhit/1.1') =>
  ogEvent.GET(
    new Request(`https://instntwin.com/api/og/event${query}`, {
      headers: { 'user-agent': userAgent, 'x-forwarded-for': '198.51.100.7' },
    }),
  );

const previewTags = (html) =>
  [...html.matchAll(/<title>[^<]*<\/title>|<meta (?:property|name)="(?:og:[^"]*|twitter:[^"]*|description)"[^>]*>/g)].map(
    (match) => match[0],
  );

/** The favicons, the manifest and the theme colour: what Slack and Discord read beside the tags. */
const headLinks = (html) =>
  [...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>|<meta name="theme-color"[^>]*>/g)].map(
    (match) => match[0],
  );

const INDEX_HTML = readFileSync(new URL('index.html', root), 'utf8');
const INDEX_TAGS = previewTags(INDEX_HTML);
const INDEX_HEAD_LINKS = headLinks(INDEX_HTML);
const EDGE_CACHE = 'public, max-age=0, s-maxage=300';

await test(['L9', 'L10'], "a campaign without an identity previews with index.html's own tags", async () => {
  assert.ok(INDEX_TAGS.length >= 8, 'index.html carries fewer preview tags than expected, so the comparison proves nothing');
  assert.equal(INDEX_HEAD_LINKS.length, 5, 'index.html no longer carries the icons, manifest and theme colour this compares');
  for (const query of ['?id=1', '?id=not-a-number', '']) {
    fresh();
    db.on('bridge_v2_campaign_identities:select', () => ({ data: null, error: null }));
    const response = await og(query);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    const html = await response.text();
    assert.deepEqual(previewTags(html), INDEX_TAGS, `${query}: the fallback is not what a crawler read before`);
    assert.deepEqual(headLinks(html), INDEX_HEAD_LINKS, `${query}: the fallback lost the favicon, manifest or theme colour`);
    assert.equal(response.headers.get('cache-control'), EDGE_CACHE, 'the edge cache is not the five minutes §17 fixes');
  }
});

await test(['L10'], 'a campaign with an identity previews with its banner, its name and its brand, escaped', async () => {
  fresh();
  db.on('bridge_v2_campaign_identities:select', () => ({
    data: identityRow('2', { name: 'Summer <Drop> & "Friends"', message: 'Line one\nLine two' }),
    error: null,
  }));
  const response = await og('?id=2');
  const html = await response.text();
  for (const tag of [
    '<meta property="og:title" content="Summer &lt;Drop&gt; &amp; &quot;Friends&quot;">',
    '<meta property="og:description" content="Acme — Line one Line two">',
    `<meta property="og:image" content="${BANNER_URL}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${BANNER_URL}">`,
    '<link rel="canonical" href="https://instntwin.com/events/2">',
  ]) {
    assert.ok(html.includes(tag), `missing: ${tag}`);
  }
  assert.ok(html.includes('href="https://instntwin.com/events/2?app=1"'), 'a person who lands here has no way into the app');
  assert.ok(!html.includes('<Drop>'), 'unescaped creator text reached the document');
  assert.ok(!html.includes('og-image.png'), 'the platform image is still in a campaign preview');
  for (const duplicate of ['twitter:title', 'twitter:description', 'twitter:image:alt']) {
    assert.ok(!html.includes(`name="${duplicate}"`), `${duplicate} repeats an og: tag X already reads`);
  }
  assert.equal(response.headers.get('cache-control'), EDGE_CACHE, 'the edge cache is not the five minutes §17 fixes');
});

await test(['L9', 'L10'], 'a preview the database cannot answer falls back, and is not cached', async () => {
  fresh();
  db.on('bridge_v2_campaign_identities:select', () => ({ data: null, error: { message: 'unavailable' } }));
  const response = await og('?id=2');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.deepEqual(previewTags(html), INDEX_TAGS);
  assert.deepEqual(headLinks(html), INDEX_HEAD_LINKS);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

const FETCHERS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'WhatsApp/2.23.20.0 A',
  'TelegramBot (like TwitterBot)',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  // iMessage's preview fetcher
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
];
const PEOPLE = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0]',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp/9.29',
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0 Mobile Safari/537.36 Telegram-Android/11.0',
];
const SEARCH = [
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
];

await test(['L10'], 'only link-preview fetchers are rewritten to the preview, only on a campaign path', () => {
  const vercel = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
  const [preview, spa] = vercel.rewrites;
  assert.equal(preview.source, '/events/:id(\\d+)');
  assert.equal(preview.destination, '/api/og/event?id=:id');
  assert.deepEqual(preview.missing, [{ type: 'query', key: 'app' }], 'a person has no way past the preview');
  assert.equal(spa.source, '/((?!api/).*)', 'the preview rewrite is not in front of the SPA fallback');
  assert.ok(existsSync(new URL('api/og/event.ts', root)));

  const header = preview.has.find((item) => item.type === 'header' && item.key === 'user-agent');
  const matches = (userAgent) => new RegExp(`^(?:${header.value})$`).test(userAgent);
  for (const userAgent of FETCHERS) assert.ok(matches(userAgent), `not treated as a preview fetcher: ${userAgent}`);
  for (const userAgent of PEOPLE) assert.ok(!matches(userAgent), `a person would be served the preview: ${userAgent}`);
  for (const userAgent of SEARCH) {
    assert.ok(!matches(userAgent), `a search engine would be served a different page from people: ${userAgent}`);
  }
});

// ---------------------------------------------------------------------------
// L8, L9 — the verification email
// ---------------------------------------------------------------------------

function mailSetup() {
  fresh();
  db.on('bridge_v2_participants:select', () => ({ data: null, error: null }));
  db.on('bridge_v2_disposable_domains:select', () => ({ data: [], error: null }));
  db.on('rpc:bridge_v2_claim_spend', () => ({ data: true, error: null }));
  http.on('api.resend.com', () => jsonResponse({ id: 'mail-1' }));
  http.on('cloudflare-dns.com', () => jsonResponse({ Status: 0, Answer: [{ data: '10 mx' }] }));
}

const sentMail = () => JSON.parse(http.requests.find((entry) => entry.url.includes('resend')).body);

await test(['L8', 'J6'], 'the verification email names the campaign and its brand, and the code stays out of the subject', async () => {
  mailSetup();
  db.on('bridge_v2_campaign_identities:select', () => ({ data: identityRow('2'), error: null }));
  await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'alice@example.com', giveawayId: '2' } }),
  );
  const mail = sentMail();
  assert.equal(mail.subject, 'Your verification code for Summer Drop by Acme');
  const code = mail.text.match(/\b(\d{6})\b/)[1];
  assert.ok(!mail.subject.includes(code), 'the code is in the subject');
  assert.match(mail.text, /^You asked to enter Summer Drop, a campaign by Acme\./);
});

await test(['L8', 'L9'], 'without an identity, without a campaign, or without a database, the email is the one it always was', async () => {
  for (const [body, identity] of [
    [{ email: 'alice@example.com', giveawayId: '1' }, { data: null, error: null }],
    [{ email: 'alice@example.com' }, undefined],
    [{ email: 'alice@example.com', giveawayId: '2' }, { data: null, error: { message: 'unavailable' } }],
  ]) {
    mailSetup();
    if (identity !== undefined) db.on('bridge_v2_campaign_identities:select', () => identity);
    const response = await requestCode.POST(request(url('session/request-code'), { body }));
    assert.deepEqual(await response.json(), { ok: true, status: 'accepted' });
    const mail = sentMail();
    assert.equal(mail.subject, 'Your verification code');
    assert.match(mail.text, /^Use this code to confirm your email address:/);
  }
});

await test(['L8', 'D2'], 'naming a campaign does not change what the route tells anybody about an address', async () => {
  const answers = [];
  for (const known of [null, { id: 'participant-1' }]) {
    mailSetup();
    db.on('bridge_v2_participants:select', () => ({ data: known, error: null }));
    db.on('bridge_v2_campaign_identities:select', () => ({ data: identityRow('2'), error: null }));
    const response = await requestCode.POST(
      request(url('session/request-code'), { body: { email: 'someone@example.com', giveawayId: '2' } }),
    );
    answers.push([response.status, await response.text()]);
  }
  assert.deepEqual(answers[0], answers[1]);
});

await test(['I1'], 'a campaign id that is not one is a 400, and nothing is sent', async () => {
  mailSetup();
  const response = await requestCode.POST(
    request(url('session/request-code'), { body: { email: 'alice@example.com', giveawayId: 'two' } }),
  );
  assert.equal(response.status, 400);
  assert.equal(http.requests.filter((entry) => entry.url.includes('resend')).length, 0);
});
