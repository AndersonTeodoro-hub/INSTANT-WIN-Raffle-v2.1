import { getSupabase } from '../../lib/bridge/supabase.js';
import { arbiscanUrl } from '../../lib/bridge/chain.js';
import { json, fail, parseEmail, parseGiveawayId, unexpected } from '../../lib/bridge/http.js';

/**
 * GET /api/bridge/status?email=&giveawayId=
 *
 * Estado da entrada e link do Arbiscan (SPEC-BRIDGE §2b).
 *
 * Devolve SÓ a entrada desta campanha. Nunca lista as outras campanhas de um
 * email — saber onde uma pessoa participou é dado pessoal e esta rota não pede
 * prova de posse do email.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const email = parseEmail(url.searchParams.get('email'));
  if (!email) return fail(400, 'Enter a valid email address.');

  const giveawayId = parseGiveawayId(url.searchParams.get('giveawayId'));
  if (!giveawayId) return fail(400, 'Invalid giveaway id.');

  try {
    const db = getSupabase();

    const { data: participant, error: pErr } = await db
      .from('bridge_participants').select('id, wallet_address').eq('email', email).maybeSingle();
    if (pErr) throw pErr;
    // 404 igual para "email desconhecido" e "email sem entrada nesta campanha":
    // distinguir os dois casos diria a um estranho se o email está registado.
    if (!participant) return fail(404, 'No entry found for this giveaway.');

    const { data: entry, error: eErr } = await db
      .from('bridge_entries').select('status, tx_hash, created_at, updated_at')
      .eq('participant_id', participant.id).eq('giveaway_id', giveawayId.toString()).maybeSingle();
    if (eErr) throw eErr;
    if (!entry) return fail(404, 'No entry found for this giveaway.');

    return json({
      ok: true,
      status: entry.status,
      walletAddress: participant.wallet_address,
      txHash: entry.tx_hash ?? null,
      arbiscanUrl: entry.tx_hash ? arbiscanUrl(entry.tx_hash) : null,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    });
  } catch (err) {
    return unexpected('status', err, email);
  }
}
