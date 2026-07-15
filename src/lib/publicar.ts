import { supabase } from './supabase';

/** Marca/desmarca a cor para exclusão da publicação (persiste na hora). */
export async function setVariacaoExcluida(variacaoId: string, excluida: boolean): Promise<void> {
  const { error } = await supabase
    .from('variacoes')
    .update({ excluida_da_publicacao: excluida })
    .eq('id', variacaoId);
  if (error) throw new Error(`Falha ao atualizar exclusão: ${error.message}`);
}

export interface ResultadoPublicar {
  enfileiradas: number;
  porCanal?: Record<string, number>;
  canaisIgnorados?: string[];
}

export type ListingType = 'gold_special' | 'gold_pro';

export interface OpcoesPublicar {
  /** true = só estoque (preserva preço no ar); false/undefined = atualizar tudo (comportamento
   *  atual, default no backend — ADR-0078 F1). */
  somenteEstoqueGlobal?: boolean;
  /** familiaIds que devem seguir o oposto da escolha global (override por produto). */
  somenteEstoqueOverrides?: string[];
}

/** Dispara a publicação das famílias selecionadas nos canais escolhidos (edge enfileira no
 *  QStash). `canais` default ['mercado_livre'] → comportamento atual inalterado (E6/ADR-0061). */
export async function publicarFamilias(
  familiaIds: string[],
  listingTypeId: ListingType = 'gold_special',
  canais: string[] = ['mercado_livre'],
  opcoes?: OpcoesPublicar,
): Promise<ResultadoPublicar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa');
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/publicar-familias`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      familia_ids: familiaIds,
      listing_type_id: listingTypeId,
      canais,
      somente_estoque_global: opcoes?.somenteEstoqueGlobal,
      somente_estoque_overrides: opcoes?.somenteEstoqueOverrides,
    }),
  });
  if (!resp.ok) {
    const texto = await resp.text();
    throw new Error(`Publicação falhou (${resp.status}): ${texto}`);
  }
  return resp.json();
}
