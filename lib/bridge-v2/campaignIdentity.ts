/**
 * Campaign identity, server half. SPEC-BRIDGE-V2 §17 (L1–L10).
 *
 * The shapes and the checks both sides share are in lib/campaign-identity.ts.
 * What is here needs the server: the table, the bucket, and the one write path.
 *
 * G2: every query goes through checked/checkedMaybe. G4: every query carries an
 * abort signal, and the one storage call is bounded by its own timer.
 */

import {
  imageObjectPath,
  type CampaignLabel,
  type IdentityText,
  type ImageType,
  type PublicIdentity,
  type SignedImage,
} from '../campaign-identity.js';
import {
  DB_TIMEOUT_MS,
  IDENTITY_BUCKET,
  IDENTITY_NONCE_RETENTION_SECONDS,
  STORAGE_TIMEOUT_MS,
} from './config.js';
import { checked, checkedMaybe, DatabaseError, getDb } from './db.js';
import { requireEnv } from './env.js';

interface IdentityRow {
  giveaway_id: string;
  name: string;
  message: string;
  brand_name: string;
  link_url: string | null;
  banner_sha256: string;
  banner_type: ImageType;
  banner_width: number;
  banner_height: number;
  logo_sha256: string | null;
  logo_type: ImageType | null;
  logo_width: number | null;
  logo_height: number | null;
  version: number;
  updated_at: string;
}

/**
 * The id is cast to text in the select. numeric(78,0) otherwise comes back as a
 * JSON number, and a JSON number past 2^53 is not the id that was stored.
 */
const COLUMNS =
  'giveaway_id::text, name, message, brand_name, link_url, ' +
  'banner_sha256, banner_type, banner_width, banner_height, ' +
  'logo_sha256, logo_type, logo_width, logo_height, version, updated_at';

/** Where a crawler and a browser fetch an image from: the public object URL. */
export function publicImageUrl(path: string): string {
  const base = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/${IDENTITY_BUCKET}/${path}`;
}

function toPublic(row: IdentityRow): PublicIdentity {
  const image = (slot: 'banner' | 'logo', sha256: string, type: ImageType, width: number, height: number) => ({
    sha256,
    type,
    width,
    height,
    url: publicImageUrl(imageObjectPath(row.giveaway_id, slot, sha256, type)),
  });
  return {
    giveawayId: row.giveaway_id,
    name: row.name,
    message: row.message,
    brand: row.brand_name,
    link: row.link_url,
    banner: image('banner', row.banner_sha256, row.banner_type, row.banner_width, row.banner_height),
    logo:
      row.logo_sha256 === null || row.logo_type === null || row.logo_width === null || row.logo_height === null
        ? null
        : image('logo', row.logo_sha256, row.logo_type, row.logo_width, row.logo_height),
    version: row.version,
    updatedAt: row.updated_at,
  };
}

/** L7: the identities of several campaigns, keyed by id. Campaigns without one are absent. */
export async function readIdentities(giveawayIds: readonly bigint[]): Promise<Map<string, PublicIdentity>> {
  const found = new Map<string, PublicIdentity>();
  if (giveawayIds.length === 0) return found;
  const db = getDb();
  const rows = checked(
    'identity.read',
    await db
      .from('bridge_v2_campaign_identities')
      .select(COLUMNS)
      .in('giveaway_id', giveawayIds.map((id) => id.toString()))
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as IdentityRow[] | null;
  for (const row of Array.isArray(rows) ? rows : []) found.set(row.giveaway_id, toPublic(row));
  return found;
}

export async function readIdentity(giveawayId: bigint): Promise<PublicIdentity | null> {
  const db = getDb();
  const row = checkedMaybe(
    'identity.read_one',
    await db
      .from('bridge_v2_campaign_identities')
      .select(COLUMNS)
      .eq('giveaway_id', giveawayId.toString())
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle(),
  ) as IdentityRow | null;
  return row === null ? null : toPublic(row);
}

/**
 * L8/L9: how an email names the campaign, or null.
 *
 * NEVER THROWS. The identity is decoration on a message whose job is something
 * else — a verification code, a result. A database that cannot answer this
 * question is a reason to send the message as it was sent before identities
 * existed, never a reason not to send it.
 */
export async function campaignLabel(giveawayId: bigint): Promise<CampaignLabel | null> {
  try {
    const identity = await readIdentity(giveawayId);
    return identity === null ? null : { name: identity.name, brand: identity.brand };
  } catch {
    return null;
  }
}

/**
 * L5: one image into the bucket, under the type the bytes were sniffed as.
 *
 * The content type sent here is the one Storage serves the object with, which is
 * why it comes from sniffImage and never from the upload's own declaration.
 *
 * Content-addressed and never upserted: an object already at this path is these
 * same bytes, so "already exists" is success. A replayed request uploads nothing
 * new, and nothing ever overwrites an object a published identity points at.
 *
 * The secret key goes in `apikey` and nowhere else, for the reason db.ts gives:
 * the platform gateway rejects a non-JWT key in Authorization and synthesises the
 * service-role credential from apikey itself.
 */
export async function uploadImage(path: string, bytes: Uint8Array<ArrayBuffer>, type: ImageType): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORAGE_TIMEOUT_MS);
  try {
    const base = requireEnv('SUPABASE_URL').replace(/\/+$/, '');
    const response = await fetch(`${base}/storage/v1/object/${IDENTITY_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: requireEnv('SUPABASE_SERVICE_KEY'),
        'content-type': type,
        'cache-control': 'max-age=31536000, immutable',
        'x-upsert': 'false',
      },
      body: bytes,
      signal: controller.signal,
    });
    if (response.ok) return true;
    const answer = await response.text().catch(() => '');
    return response.status === 409 || /already exists|duplicate/i.test(answer);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface IdentityWrite {
  readonly giveawayId: bigint;
  readonly nonce: string;
  readonly signedAt: string;
  readonly creator: `0x${string}`;
  readonly text: IdentityText;
  readonly banner: SignedImage;
  readonly logo: SignedImage | null;
}

export type SaveOutcome =
  | { readonly kind: 'SAVED'; readonly version: number }
  | { readonly kind: 'STALE' }
  | { readonly kind: 'REPLAYED' };

interface SaveRow {
  saved_outcome: string;
  saved_version: number | null;
}

/** L6: the nonce and the write in one statement-level decision (0011). */
export async function saveIdentity(write: IdentityWrite): Promise<SaveOutcome> {
  const db = getDb();
  const rows = checked(
    'identity.save',
    await db
      .rpc('bridge_v2_save_campaign_identity', {
        p_giveaway_id: write.giveawayId.toString(),
        p_nonce: write.nonce,
        p_signed_at: write.signedAt,
        p_nonce_retention_seconds: IDENTITY_NONCE_RETENTION_SECONDS,
        p_creator_address: write.creator.toLowerCase(),
        p_name: write.text.name,
        p_message: write.text.message,
        p_brand_name: write.text.brand,
        p_link_url: write.text.link,
        p_banner_sha256: write.banner.sha256,
        p_banner_type: write.banner.type,
        p_banner_width: write.banner.width,
        p_banner_height: write.banner.height,
        p_logo_sha256: write.logo?.sha256 ?? null,
        p_logo_type: write.logo?.type ?? null,
        p_logo_width: write.logo?.width ?? null,
        p_logo_height: write.logo?.height ?? null,
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
  ) as SaveRow[] | null;

  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (row?.saved_outcome === 'SAVED' && typeof row.saved_version === 'number') {
    return { kind: 'SAVED', version: row.saved_version };
  }
  if (row?.saved_outcome === 'STALE') return { kind: 'STALE' };
  if (row?.saved_outcome === 'REPLAYED') return { kind: 'REPLAYED' };
  // A function that returned no row, or a value it never returns, is a database
  // that did not do what 0011 says it does. G2: that is an error, not a guess.
  throw new DatabaseError('identity.save');
}
