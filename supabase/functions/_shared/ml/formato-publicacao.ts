// Cache de formato de publicação por conexão+categoria (ADR-0088, extensão do ADR-0087).
// Guarda se uma categoria de uma conexão publica em `legacy` (variations[]) ou
// `user_products` (item plano com family_name na raiz). SÓ orienta o CREATE — o UPDATE
// nunca lê este cache (detecta UP por GET ao vivo; ver ADR-0087 §6 / ADR-0088 "UPDATE").
//
// `import type` (erased em runtime) → sem carregar o cliente jsr; vitest consegue importar.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export type FormatoPublicacaoML = 'legacy' | 'user_products';

export interface FormatoRepo {
  buscar(connectionId: string, categoriaId: string): Promise<FormatoPublicacaoML | null>;
  salvar(connectionId: string, categoriaId: string, formato: FormatoPublicacaoML): Promise<void>;
}

/** Lê o formato conhecido da conexão+categoria. `desconhecido` = nunca observado (cache miss)
 *  → o caller tenta Legacy primeiro e descobre o formato reagindo à resposta do ML. */
export async function lerFormatoPublicacao(
  repo: FormatoRepo, connectionId: string, categoriaId: string,
): Promise<FormatoPublicacaoML | 'desconhecido'> {
  return (await repo.buscar(connectionId, categoriaId)) ?? 'desconhecido';
}

/** Grava/atualiza o formato conhecido da conexão+categoria.
 *
 *  REGRA CRÍTICA (ADR-0088 §3, decidida após revisão adversarial): `user_products` só pode ser
 *  gravado quando a assinatura reativa EXATA foi observada — `cause_id` 369+374, o MESMO predicado
 *  de `precisaItemPlano` em `ml/erro-ml.ts`. Um CREATE plano que teve sucesso por outro motivo
 *  (categoria já no Set do ADR-0084, seed) NÃO prova formato UP e NÃO deve semear o cache. Este
 *  módulo é só o cache puro (leitura/escrita); essa decisão é responsabilidade de QUEM chama
 *  (a orquestração — publicar-split-ml/publish-familia-ml), não daqui. */
export async function confirmarFormatoPublicacao(
  repo: FormatoRepo, connectionId: string, categoriaId: string, formato: FormatoPublicacaoML,
): Promise<void> {
  await repo.salvar(connectionId, categoriaId, formato);
}

/** FormatoRepo real sobre `ml_formato_publicacao` (admin client, service_role). */
export function formatoRepoSupabase(admin: SupabaseClient): FormatoRepo {
  return {
    async buscar(connectionId, categoriaId) {
      const { data } = await admin.from('ml_formato_publicacao')
        .select('formato')
        .eq('connection_id', connectionId).eq('categoria_id', categoriaId)
        .maybeSingle();
      return (data?.formato as FormatoPublicacaoML) ?? null;
    },
    async salvar(connectionId, categoriaId, formato) {
      // PK composta (connection_id, categoria_id): upsert idempotente (2ª chamada atualiza).
      const { error } = await admin.from('ml_formato_publicacao')
        .upsert(
          { connection_id: connectionId, categoria_id: categoriaId, formato },
          { onConflict: 'connection_id,categoria_id' },
        );
      if (error) throw new Error(`ml_formato_publicacao upsert: ${error.message}`);
    },
  };
}
