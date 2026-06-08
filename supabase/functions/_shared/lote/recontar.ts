import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// Reconta os contadores do lote a partir das famílias restantes (o trigger
// update_lote_counters NÃO dispara em DELETE), ou remove o lote se ficou vazio.
// `total_publicadas` conta status='publicado' (mesma base do trigger). Retorna
// true se o lote foi removido. Compartilhado por excluir-lote e remover-publicado.
export async function recontarOuRemoverLote(
  admin: SupabaseClient,
  loteId: string,
  setConcluido: boolean,
): Promise<boolean> {
  const { data: rest } = await admin.from('familias').select('status').eq('lote_id', loteId);
  if (!rest || rest.length === 0) {
    await admin.from('lotes').delete().eq('id', loteId);
    return true;
  }
  let publicadas = 0;
  let erros = 0;
  for (const f of rest) {
    if (f.status === 'publicado') publicadas++;
    else if (f.status === 'erro') erros++;
  }
  const update: Record<string, unknown> = {
    total_familias: rest.length,
    total_publicadas: publicadas,
    total_erros: erros,
  };
  if (setConcluido) update.status = 'concluido';
  await admin.from('lotes').update(update).eq('id', loteId);
  return false;
}
