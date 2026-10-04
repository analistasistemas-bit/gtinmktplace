// Spec reajuste C2 — defesa nos workers de publicação (publish, update, split). A barreira atômica é
// o claim de publicar-familias; isto cobre reajuste confirmado depois do claim e Reenviar.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const MENSAGEM_REAJUSTE_ATIVO = 'Há reajuste de preço em massa em andamento neste produto (400)';

/**
 * Lança se o produto tem reajuste de preço em massa ativo: 400 definitivo. Erro da RPC é
 * fail-CLOSED e retentável (sem `status` → o catch do worker retenta): publicar o preço antigo por
 * cima de um reajuste é pior que atrasar a publicação.
 */
export async function exigirSemReajusteAtivo(
  admin: SupabaseClient, orgId: string, codigoPai: string,
): Promise<void> {
  const { data, error } = await admin.rpc('reajuste_ativo_produto', { p_org: orgId, p_codigo_pai: codigoPai });
  if (error) throw new Error(`Falha ao conferir reajuste de preço em massa: ${error.message}`);
  if (data) {
    const err = new Error(MENSAGEM_REAJUSTE_ATIVO) as Error & { status?: number };
    err.status = 400;
    throw err;
  }
}
