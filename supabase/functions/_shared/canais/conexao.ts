// E7 (ADR-0027): resolvedor de conexão do canal por organização.
// `import type` (erased em runtime) → sem import Deno/jsr; vitest consegue carregar.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export interface ConexaoCanal {
  id: string;
  orgId: string;
  canal: string;
  contaExternaId: string | null;
  expiresAt: string | null;
}

/** Mapeia a linha de marketplace_connections → ConexaoCanal. null se ausente. */
export function mapearConexao(
  row: { id: string; org_id: string; canal: string; conta_externa_id: string | null; expires_at: string | null } | null,
): ConexaoCanal | null {
  if (!row) return null;
  return { id: row.id, orgId: row.org_id, canal: row.canal, contaExternaId: row.conta_externa_id, expiresAt: row.expires_at };
}

/** Conexão pelo id (`marketplace_connections.id`); a org vem da própria conexão. Com `orgId`
 *  informado, ele precisa bater — senão null (job de outra org não usa esta conexão). */
export async function resolverConexaoPorId(admin: SupabaseClient, id: string, orgId?: string | null): Promise<ConexaoCanal | null> {
  const { data } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at')
    .eq('id', id).eq('canal', 'mercado_livre').maybeSingle();
  const cx = mapearConexao(data ?? null);
  return cx && (!orgId || cx.orgId === orgId) ? cx : null;
}

/** Conexão da ORG para o canal (null = org não conectou o canal). */
export async function resolverConexao(admin: SupabaseClient, orgId: string, canal: string): Promise<ConexaoCanal | null> {
  const { data } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at')
    .eq('org_id', orgId).eq('canal', canal).maybeSingle();
  return mapearConexao(data ?? null);
}
