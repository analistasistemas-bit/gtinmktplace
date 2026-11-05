// ADR-0195: famílias com formato `legacy` confirmado para a conexão ML da org e a categoria delas.
// Só isso autoriza dividir por soma. Falha de leitura vale como não confirmado: a publicação segue.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { resolverConexao } from '../_shared/canais/conexao.ts';

export async function familiasFormatoLegacy(
  admin: SupabaseClient, orgId: string, familiaIds: string[],
): Promise<Set<string>> {
  if (familiaIds.length === 0) return new Set();
  try {
    const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!conexao) return new Set();
    const { data: familias, error: errF } = await admin.from('familias')
      .select('id, categoria_ml_id').eq('org_id', orgId).in('id', familiaIds);
    if (errF) throw new Error(errF.message);
    const categorias = [...new Set((familias ?? []).map((f) => f.categoria_ml_id as string | null).filter((c) => c != null))];
    const { data: formatos, error: errC } = await admin.from('ml_formato_publicacao')
      .select('categoria_id, formato').eq('connection_id', conexao.id).in('categoria_id', categorias);
    if (errC) throw new Error(errC.message);
    const legacy = new Set((formatos ?? []).filter((c) => c.formato === 'legacy').map((c) => c.categoria_id as string));
    return new Set((familias ?? []).filter((f) => legacy.has(f.categoria_ml_id as string)).map((f) => f.id as string));
  } catch (e) {
    console.error(`formato de publicação não lido (org ${orgId}):`, (e as Error).message);
    return new Set();
  }
}
