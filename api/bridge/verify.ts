import { getSupabase, EntryStatus } from '../../lib/bridge/supabase.js';
import {
  readGiveaway, hasEntered, getBalance, estimateEnterCost, fundWalletFrom,
  sendEnter, waitForReceipt, arbiscanUrl, mapContractError,
} from '../../lib/bridge/chain.js';
import {
  loadFunderPool, acquireFunder, supabaseLockStore,
  AllFundersBusyError, FundersDepletedError,
} from '../../lib/bridge/funders.js';
import { hashCode, timingSafeEqualHex, isExpired, MAX_ATTEMPTS } from '../../lib/bridge/codes.js';
import { deriveAccount } from '../../lib/bridge/wallet.js';
import { json, fail, readJson, parseEmail, parseGiveawayId, parseCode, maskEmail, unexpected } from '../../lib/bridge/http.js';

/**
 * POST /api/bridge/verify  {email, giveawayId, code}
 *
 * Valida o código, deriva a wallet, financia o gas e submete o enter() assinado
 * pela própria wallet derivada (SPEC-BRIDGE §3).
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, 'Invalid request body.');

  const email = parseEmail(body.email);
  if (!email) return fail(400, 'Enter a valid email address.');
  const giveawayId = parseGiveawayId(body.giveawayId);
  if (!giveawayId) return fail(400, 'Invalid giveaway id.');
  const code = parseCode(body.code);
  if (!code) return fail(400, 'Enter the 6-digit code from your email.');

  const gid = giveawayId.toString();
  const db = getSupabase();
  let entryId: string | null = null;

  try {
    // ---- 1. Código -------------------------------------------------------
    const { data: row, error: cErr } = await db
      .from('bridge_codes').select('id, code_hash, expires_at, attempts')
      .eq('email', email).eq('giveaway_id', gid)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (cErr) throw cErr;
    if (!row) return fail(400, 'No code found. Request a new one.');
    if (row.attempts >= MAX_ATTEMPTS) return fail(429, 'Too many attempts. Request a new code.');
    if (isExpired(row.expires_at)) return fail(400, 'This code has expired. Request a new one.');

    const expected = await hashCode(code, email, gid);
    if (!timingSafeEqualHex(expected, row.code_hash)) {
      // Falha conta como tentativa: é o que torna 5 tentativas um limite real.
      await db.from('bridge_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id);
      return fail(400, 'Incorrect code.');
    }

    // ---- 2. Campanha ainda aceita? --------------------------------------
    const g = await readGiveaway(giveawayId);
    if (!g.isOpen || g.hasEnded) return fail(400, 'Entries for this giveaway are closed.');
    if (g.isAllowlisted) return fail(400, 'This giveaway requires an eligibility list.');

    // ---- 3. Participante: get-or-create ---------------------------------
    // O wallet_index vem da sequence do Postgres (migração 0001), nunca calculado
    // aqui: dois pedidos concorrentes calculariam o mesmo índice, logo a mesma
    // wallet para dois emails diferentes.
    let { data: participant, error: pErr } = await db
      .from('bridge_participants').select('id, wallet_index, wallet_address').eq('email', email).maybeSingle();
    if (pErr) throw pErr;

    if (!participant) {
      const { data: created, error: nErr } = await db
        .from('bridge_participants').insert({ email, wallet_address: '0x' })
        .select('id, wallet_index, wallet_address').single();
      if (nErr) throw nErr;
      // O endereço só é conhecido depois de a sequence dar o índice.
      const address = deriveAccount(created.wallet_index).address;
      const { error: uErr } = await db
        .from('bridge_participants').update({ wallet_address: address }).eq('id', created.id);
      if (uErr) throw uErr;
      participant = { ...created, wallet_address: address };
    }

    const account = deriveAccount(participant.wallet_index);

    // ---- 4. Entry: get-or-create ----------------------------------------
    const { data: entry, error: eErr } = await db
      .from('bridge_entries')
      .upsert(
        { participant_id: participant.id, giveaway_id: gid, status: EntryStatus.CODE_VERIFIED, updated_at: new Date().toISOString() },
        { onConflict: 'participant_id,giveaway_id', ignoreDuplicates: false },
      )
      .select('id, status, tx_hash').single();
    if (eErr) throw eErr;
    entryId = entry.id;

    // ---- 5. Idempotência on-chain ---------------------------------------
    // A verdade é a chain, não a BD: se a wallet já entrou, não se tenta de novo
    // (o contrato reverteria com AlreadyEntered) e devolve-se o que houver.
    if (await hasEntered(giveawayId, account.address)) {
      await db.from('bridge_entries')
        .update({ status: EntryStatus.CONFIRMED, updated_at: new Date().toISOString() }).eq('id', entry.id);
      return json({
        ok: true, alreadyEntered: true, walletAddress: account.address,
        txHash: entry.tx_hash ?? null,
        arbiscanUrl: entry.tx_hash ? arbiscanUrl(entry.tx_hash) : null,
      });
    }

    // ---- 6. Funding, com um funder do pool -------------------------------
    // O lease garante que mais nenhuma invocação usa este funder enquanto esta o
    // tiver — é o que torna o nonce previsível sem uma fila global. Libertado
    // SEMPRE no finally, mesmo que o funding rebente a meio.
    const needed = await estimateEnterCost(giveawayId, account.address);
    if ((await getBalance(account.address)) < needed) {
      await db.from('bridge_entries')
        .update({ status: EntryStatus.FUNDING, updated_at: new Date().toISOString() }).eq('id', entry.id);

      const store = supabaseLockStore(db);
      const lease = await acquireFunder({ store, pool: loadFunderPool(), needed, getBalance });
      try {
        await fundWalletFrom(lease.account, account.address, needed);
      } finally {
        await store.release(lease.index, lease.token);
      }
    }

    // ---- 7. enter(), assinado pela própria wallet derivada ---------------
    await db.from('bridge_entries')
      .update({ status: EntryStatus.SUBMITTED, updated_at: new Date().toISOString() }).eq('id', entry.id);

    const txHash = await sendEnter(account, giveawayId);
    const receipt = await waitForReceipt(txHash);
    if (receipt.status !== 'success') throw new Error('enter() reverted on-chain');

    await db.from('bridge_entries')
      .update({ status: EntryStatus.CONFIRMED, tx_hash: txHash, updated_at: new Date().toISOString() })
      .eq('id', entry.id);

    // Código consumido: apagado para não poder ser reutilizado.
    await db.from('bridge_codes').delete().eq('id', row.id);
    console.log(`[bridge] entered ${maskEmail(email)} giveaway=${gid}`);

    return json({ ok: true, txHash, arbiscanUrl: arbiscanUrl(txHash), walletAddress: account.address });
  } catch (err) {
    if (entryId) {
      await db.from('bridge_entries')
        .update({ status: EntryStatus.FAILED, updated_at: new Date().toISOString() }).eq('id', entryId)
        .then(() => undefined, () => undefined);
    }
    // Pool cheio: carga, não avaria. 503 e o cliente repete — nunca pendurar a
    // invocação à espera de um funder.
    if (err instanceof AllFundersBusyError) return fail(503, 'high demand, try again');
    // Sem saldo em nenhum funder: avaria operacional. O log de cada funder já
    // saiu em funders.ts com o endereço mascarado; aqui fica a marca do alerta.
    if (err instanceof FundersDepletedError) {
      console.error('[bridge] ALERTA: pool de funders sem saldo — recarregar');
      return fail(503, 'funders depleted');
    }
    // Revert conhecido do contrato -> frase própria. Qualquer outra coisa cai no
    // envelope genérico, sem stack nem valores internos.
    const mapped = mapContractError(err);
    if (mapped) return fail(400, mapped);
    return unexpected('verify', err, email);
  }
}
