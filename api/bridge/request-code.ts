import { getSupabase } from '../../lib/bridge/supabase.js';
import { readGiveaway } from '../../lib/bridge/chain.js';
import { generateCode, hashCode, codeExpiry, MAX_CODES_PER_HOUR } from '../../lib/bridge/codes.js';
import { sendCodeEmail } from '../../lib/bridge/email.js';
import { json, fail, readJson, parseEmail, parseGiveawayId, maskEmail, unexpected } from '../../lib/bridge/http.js';

/**
 * POST /api/bridge/request-code  {email, giveawayId}
 *
 * Gera o código de 6 dígitos, guarda o hash e envia o email (SPEC-BRIDGE §2b).
 *
 * Imports com extensão .js: em `api/` o especificador tem de resolver no runtime
 * do Vercel, onde o .ts já foi compilado. Export nomeado por método, nunca
 * default — as duas lições do incidente de 30/08.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body) return fail(400, 'Invalid request body.');

  const email = parseEmail(body.email);
  if (!email) return fail(400, 'Enter a valid email address.');

  const giveawayId = parseGiveawayId(body.giveawayId);
  if (!giveawayId) return fail(400, 'Invalid giveaway id.');

  try {
    // 1. A campanha aceita entradas? Lido on-chain, que é a única verdade.
    const g = await readGiveaway(giveawayId);
    if (!g.isOpen) return fail(400, 'This giveaway is not open for entries.');
    if (g.hasEnded) return fail(400, 'Entries for this giveaway are closed.');
    // SPEC §3: campanhas com allowlist estão fora da ponte V1. Recusado à
    // entrada, com razão explícita, em vez de falhar mais à frente no enter().
    if (g.isAllowlisted) {
      return fail(400, 'This giveaway requires an eligibility list and cannot be entered by email.');
    }

    const db = getSupabase();

    // 2. Já entrou NESTA campanha? A resposta só fala desta campanha — nunca
    //    revela se o email existe noutras (seria fuga de dado pessoal).
    const { data: participant, error: pErr } = await db
      .from('bridge_participants').select('id').eq('email', email).maybeSingle();
    if (pErr) throw pErr;

    if (participant) {
      const { data: entry, error: eErr } = await db
        .from('bridge_entries').select('status')
        .eq('participant_id', participant.id).eq('giveaway_id', giveawayId.toString()).maybeSingle();
      if (eErr) throw eErr;
      if (entry?.status === 'CONFIRMED') {
        return fail(409, 'This email has already entered this giveaway.');
      }
    }

    // 3. Rate limit: MAX_CODES_PER_HOUR por email+campanha.
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count, error: cErr } = await db
      .from('bridge_codes').select('id', { count: 'exact', head: true })
      .eq('email', email).eq('giveaway_id', giveawayId.toString()).gte('created_at', since);
    if (cErr) throw cErr;
    if ((count ?? 0) >= MAX_CODES_PER_HOUR) {
      return fail(429, 'Too many codes requested. Try again in an hour.');
    }

    // 4. Gera, guarda o HASH (nunca o código), envia.
    const code = generateCode();
    const { error: iErr } = await db.from('bridge_codes').insert({
      email,
      giveaway_id: giveawayId.toString(),
      code_hash: await hashCode(code, email, giveawayId.toString()),
      expires_at: codeExpiry().toISOString(),
    });
    if (iErr) throw iErr;

    await sendCodeEmail(email, code, giveawayId.toString());
    console.log(`[bridge] code sent ${maskEmail(email)} giveaway=${giveawayId}`);

    return json({ ok: true });
  } catch (err) {
    return unexpected('request-code', err, email);
  }
}
