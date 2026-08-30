import { Resend } from 'resend';
import { requireEnv } from './env.js';
import { CODE_TTL_MS } from './codes.js';

/**
 * Envio do código por email, via Resend.
 *
 * TODO: trocar o remetente por `no-reply@instntwin.com` quando o domínio estiver
 * verificado no Resend. Até lá usa-se o remetente partilhado de onboarding, que
 * funciona sem domínio verificado mas cai facilmente em spam — limitação
 * conhecida, não escondida.
 */
const FROM = 'INSTANT WIN <onboarding@resend.dev>';

/**
 * Envia o código. Texto simples, sem HTML: um email de código não precisa de
 * layout, e texto puro passa melhor nos filtros.
 *
 * O código vai no corpo do email — é o seu propósito — mas NUNCA em logs.
 */
export async function sendCodeEmail(to: string, code: string, giveawayId: string): Promise<void> {
  const minutes = Math.round(CODE_TTL_MS / 60_000);
  const resend = new Resend(requireEnv('RESEND_API_KEY'));

  const { error } = await resend.emails.send({
    from: FROM,
    to,
    subject: `${code} is your INSTANT WIN entry code`,
    text: [
      'INSTANT WIN',
      '',
      `Your entry code for giveaway #${giveawayId}:`,
      '',
      `    ${code}`,
      '',
      `This code expires in ${minutes} minutes and can only be used once.`,
      'If you did not request it, you can ignore this email.',
      '',
      'Entering is free. Winners are drawn on-chain by Chainlink VRF.',
    ].join('\n'),
  });

  // O erro do Resend é devolvido, não lançado. Sem este check uma falha de envio
  // passaria por sucesso e o utilizador ficaria à espera de um email que nunca sai.
  if (error) {
    throw new Error(`[bridge] falha ao enviar email: ${error.name ?? 'unknown'}`);
  }
}
