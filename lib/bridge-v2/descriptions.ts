/**
 * SPEC-BLOCO-03 T4 and T5 — the product descriptions, the database half.
 *
 * One row per set of terms: an offer's (COMPRA) or an obligation's (PRÉMIO),
 * keyed by the terms id the escrow assigned and the relay returned (T5). Written
 * once by the store or brand the terms name, and never changed: the table grants
 * the service INSERT and SELECT only (0014), so there is no statement that could
 * rewrite a description a buyer already read.
 *
 * Public: a description is what the store publishes about its product, shown on
 * the offer's link to anyone (T5), so nothing here is personal data.
 */

import { getAddress } from 'viem';
import { checked, checkedMaybe, getDb } from './db.js';
import { DB_TIMEOUT_MS } from './config.js';

const timeout = () => AbortSignal.timeout(DB_TIMEOUT_MS);

export interface StoredDescription {
  readonly termsId: bigint;
  readonly store: `0x${string}`;
  readonly obligationId: bigint | null;
  readonly title: string;
  readonly text: string;
  readonly createdAt: string;
}

interface DescriptionRow {
  terms_id: number | string;
  store_address: string;
  obligation_id: number | string | null;
  title: string;
  body: string;
  created_at: string;
}

const COLUMNS = 'terms_id, store_address, obligation_id, title, body, created_at';

const toDescription = (row: DescriptionRow): StoredDescription => ({
  termsId: BigInt(String(row.terms_id)),
  store: row.store_address as `0x${string}`,
  obligationId: row.obligation_id === null || row.obligation_id === undefined ? null : BigInt(String(row.obligation_id)),
  title: row.title,
  text: row.body,
  createdAt: row.created_at,
});

/** T4: written once. A second write for the same terms is refused ('exists'), whoever sends it. */
export async function writeDescription(entry: {
  termsId: bigint;
  store: `0x${string}`;
  obligationId: bigint | null;
  title: string;
  text: string;
}): Promise<'ok' | 'exists'> {
  const { error } = await getDb()
    .from('bridge_v2_offer_descriptions')
    .insert({
      terms_id: entry.termsId.toString(),
      store_address: getAddress(entry.store),
      obligation_id: entry.obligationId === null ? null : entry.obligationId.toString(),
      title: entry.title,
      body: entry.text,
    })
    .abortSignal(timeout());
  if (error === null) return 'ok';
  if ((error as { code?: string }).code === '23505') return 'exists';
  return checked('description.insert', { data: null, error }) as never;
}

/** T4: the description of one set of terms, or null when the store has not written it. */
export async function descriptionOf(termsId: bigint): Promise<StoredDescription | null> {
  const row = checkedMaybe(
    'description.read',
    await getDb().from('bridge_v2_offer_descriptions').select(COLUMNS).eq('terms_id', termsId.toString()).abortSignal(timeout()).maybeSingle(),
  ) as DescriptionRow | null;
  return row === null ? null : toDescription(row);
}

/** T5: what a store or brand has published, newest first — how its console finds its own offers and obligations. */
export async function descriptionsOfStore(store: `0x${string}`): Promise<StoredDescription[]> {
  const rows = checked(
    'description.of_store',
    await getDb()
      .from('bridge_v2_offer_descriptions')
      .select(COLUMNS)
      .eq('store_address', getAddress(store))
      .order('created_at', { ascending: false })
      .abortSignal(timeout()),
  ) as DescriptionRow[] | null;
  return (rows ?? []).map(toDescription);
}
