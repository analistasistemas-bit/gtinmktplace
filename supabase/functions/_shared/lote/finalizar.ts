import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// Reavalia o status do LOTE quando um worker de publicação some da fila (sucesso ou erro
// definitivo). Havia três cópias idênticas — publish-familia-ml, update-familia-ml e
// publicar-split-ml; esta é a única.
//
// A versão antiga olhava só 'publicando' e 'pronto', ignorando 'pendente'/'processando': um lote
// com IA ainda rodando em alguma família virava 'concluido' — status terminal — e o trigger de
// transição (20260609132501_lote_transicao_revisao.sql) só promove lote em 'processando',
// então o lote nunca era resgatado e ficava concluído com família publicável dentro.

/** Contagem de famílias do lote por situação relevante. */
export interface ContagemLote { publicando: number; pronto: number; emPreparo: number }

/**
 * Status que o lote deve assumir, ou null para "não mexer".
 * `emPreparo` = famílias em 'pendente' ou 'processando' (IA ainda rodando): ainda há trabalho,
 * o lote fica em 'processando' para o trigger de transição poder promovê-lo a 'revisao' depois.
 */
export function decidirStatusLote(c: ContagemLote): 'revisao' | 'processando' | 'concluido' | null {
  if (c.publicando > 0) return null;
  if (c.pronto > 0) return 'revisao';
  if (c.emPreparo > 0) return 'processando';
  return 'concluido';
}

export function contarFamilias(familias: Array<{ status: string | null }>): ContagemLote {
  const c: ContagemLote = { publicando: 0, pronto: 0, emPreparo: 0 };
  for (const f of familias) {
    if (f.status === 'publicando') c.publicando++;
    else if (f.status === 'pronto') c.pronto++;
    else if (f.status === 'pendente' || f.status === 'processando') c.emPreparo++;
  }
  return c;
}

export async function talvezFinalizarLote(admin: SupabaseClient, loteId: string): Promise<void> {
  const { data: familias, error } = await admin.from('familias')
    .select('status').eq('lote_id', loteId);
  // Leitura falhou: NÃO escrever. Contagem vazia decidiria 'concluido' (terminal) num lote que
  // pode ter família publicável. Também não lançamos: nos workers esta chamada roda dentro do
  // try, e o catch marcaria a família como 'erro' mesmo já publicada com sucesso no ML.
  if (error || !familias) return;
  const novo = decidirStatusLote(contarFamilias(familias));
  if (novo === null) return;
  await admin.from('lotes').update({ status: novo }).eq('id', loteId);
}
