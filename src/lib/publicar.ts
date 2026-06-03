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
}

/** Dispara a publicação CREATE das famílias selecionadas (edge enfileira no QStash). */
export async function publicarFamilias(familiaIds: string[]): Promise<ResultadoPublicar> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sem sessão ativa');
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/publicar-familias`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ familia_ids: familiaIds }),
  });
  if (!resp.ok) {
    const texto = await resp.text();
    throw new Error(`Publicação falhou (${resp.status}): ${texto}`);
  }
  return resp.json();
}
