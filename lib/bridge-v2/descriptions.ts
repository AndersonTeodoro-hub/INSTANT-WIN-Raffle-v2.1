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

/**
 * SPEC-BLOCO-03 P6-14: the terms the relay created for a store, recorded from the
 * receipt — so the console lists an offer or an obligation whose description was
 * not written, after any reload, and offers to write that description instead of
 * creating another (a second obligation is a second bond). Recorded once; a repeat
 * is the same fact.
 */
export async function recordStoreTerms(entry: { termsId: bigint; store: `0x${string}`; obligationId: bigint | null }): Promise<void> {
  const { error } = await getDb()
    .from('bridge_v2_store_terms')
    .insert({
      terms_id: entry.termsId.toString(),
      store_address: getAddress(entry.store),
      obligation_id: entry.obligationId === null ? null : entry.obligationId.toString(),
    })
    .abortSignal(timeout());
  if (error !== null && (error as { code?: string }).code !== '23505') checked('store_terms.insert', { data: null, error });
}

/** P6-14: what a store created with no description yet, newest first. */
export async function undescribedTermsOf(store: `0x${string}`): Promise<{ termsId: bigint; obligationId: bigint | null }[]> {
  const rows = checked(
    'store_terms.of_store',
    await getDb()
      .from('bridge_v2_store_terms')
      .select('terms_id, obligation_id')
      .eq('store_address', getAddress(store))
      .order('created_at', { ascending: false })
      .abortSignal(timeout()),
  ) as { terms_id: number | string; obligation_id: number | string | null }[] | null;
  const described = new Set((await descriptionsOfStore(store)).map((row) => row.termsId));
  return (rows ?? [])
    .map((row) => ({ termsId: BigInt(String(row.terms_id)), obligationId: row.obligation_id === null || row.obligation_id === undefined ? null : BigInt(String(row.obligation_id)) }))
    .filter((row) => !described.has(row.termsId));
}

/**
 * SPEC-BLOCO-03 AB4: how far the orders pass has read the chain's terms and
 * obligations into bridge_v2_store_terms — the next id of each to read. One from
 * the start: both contracts leave id 0 empty.
 */
export async function storeTermsCursor(): Promise<{ nextTerms: bigint; nextObligation: bigint }> {
  const rows = checked(
    'store_terms.cursor',
    await getDb().from('bridge_v2_store_terms_cursor').select('name, next_id').abortSignal(timeout()),
  ) as { name: string; next_id: number | string }[] | null;
  const next = (name: string) => BigInt(String(rows?.find((row) => row.name === name)?.next_id ?? 1));
  return { nextTerms: next('terms'), nextObligation: next('obligations') };
}

/** AB4: the cursor moved on, once what it passed is recorded. */
export async function advanceStoreTermsCursor(nextTerms: bigint, nextObligation: bigint): Promise<void> {
  checked(
    'store_terms.cursor_advance',
    await getDb()
      .from('bridge_v2_store_terms_cursor')
      .upsert(
        [
          { name: 'terms', next_id: nextTerms.toString() },
          { name: 'obligations', next_id: nextObligation.toString() },
        ],
        { onConflict: 'name' },
      )
      .abortSignal(timeout()),
  );
}
