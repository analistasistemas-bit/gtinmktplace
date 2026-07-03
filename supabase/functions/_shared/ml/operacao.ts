import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * A operação (single-tenant, ADR-0047) compartilha UMA conexão ML entre todos
 * os membros. O enriquecimento ao vivo (status/estoque/preço/vendas) deve usar
 * essa credencial — e não a do chamador — senão membros que não conectaram o ML
 * (ou não são o criado_por das famílias) veem tudo "indisponível" (ADR-0056).
 *
 * Ponto único de troca para o E7 (multi-org): aqui passa a resolver a credencial
 * ML do org do chamador. Escolhe a conexão mais antiga (determinístico) caso mais
 * de um membro tenha conectado.
 */
export async function userIdCredencialOperacaoML(
  admin: SupabaseClient,
): Promise<string | null> {
  const { data } = await admin
    .from('ml_credentials')
    .select('user_id')
    .order('criado_em', { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}
