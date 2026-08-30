import { createClient } from '@supabase/supabase-js';
import { requireEnv } from './env.js';

/**
 * Cliente Supabase da ponte — SEMPRE service role.
 *
 * As três tabelas têm RLS ligado e ZERO policies (migração 0001). Isso significa
 * que `anon` e `authenticated` não vêem nem escrevem uma linha; o `service_role`
 * ignora RLS por desenho do Postgres. Ou seja: o RLS é contornado aqui de
 * propósito, e é essa a única forma de acesso que existe.
 *
 * Consequência directa: esta chave NUNCA pode chegar ao browser. Vive só em
 * SUPABASE_SERVICE_KEY, lida em runtime, nunca importada por código de cliente.
 * Este módulo não pode ser importado de nada dentro de `pages/` ou `components/`.
 *
 * `persistSession`/`autoRefreshToken` a false: não há utilizador com sessão, é
 * uma chave de servidor. Guardar sessão numa function seria estado a fugir entre
 * invocações.
 */
export function getSupabase() {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Estados de `bridge_entries.status` — tem de bater com o CHECK da migração 0001. */
export const EntryStatus = {
  PENDING_CODE: 'PENDING_CODE',
  CODE_VERIFIED: 'CODE_VERIFIED',
  FUNDING: 'FUNDING',
  SUBMITTED: 'SUBMITTED',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
} as const;

export type EntryStatus = (typeof EntryStatus)[keyof typeof EntryStatus];
