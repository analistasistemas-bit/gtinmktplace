// Formato de publicação confirmado (cache `ml_formato_publicacao`) por família, pela conexão ML da org
// e a categoria dela. ADR-0195: `legacy` confirmado é o que autoriza dividir por soma de estoque.
// ADR-0160 (emenda 2026-11-09): `user_products` leva o CREATE divergente à saga em vez do split.
// Falha de leitura vale como não confirmado (Map vazio): a publicação segue.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import type { FormatoPublicacaoML } from '../_shared/ml/formato-publicacao.ts';

export async function formatoPorFamilia(
  admin: SupabaseClient, orgId: string, familiaIds: string[],
): Promise<Map<string, FormatoPublicacaoML>> {
  if (familiaIds.length === 0) return new Map();
  try {
    const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
    if (!conexao) return new Map();
    const { data: familias, error: errF } = await admin.from('familias')
      .select('id, categoria_ml_id').eq('org_id', orgId).in('id', familiaIds);
    if (errF) throw new Error(errF.message);
    const categorias = [...new Set((familias ?? []).map((f) => f.categoria_ml_id as string | null).filter((c) => c != null))];
    const { data: formatos, error: errC } = await admin.from('ml_formato_publicacao')
      .select('categoria_id, formato').eq('connection_id', conexao.id).in('categoria_id', categorias);
    if (errC) throw new Error(errC.message);
    const porCategoria = new Map((formatos ?? []).map((c) => [c.categoria_id as string, c.formato as FormatoPublicacaoML]));
    const porFamilia = new Map<string, FormatoPublicacaoML>();
    for (const f of familias ?? []) {
      const formato = porCategoria.get(f.categoria_ml_id as string);
      if (formato) porFamilia.set(f.id as string, formato);
    }
    return porFamilia;
  } catch (e) {
    console.error(`formato de publicação não lido (org ${orgId}):`, (e as Error).message);
    return new Map();
  }
}
