import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/**
 * "Adicionar variação" (tela Estoque, ADR-0129) é o único fluxo que cria lote `origem='manual'`
 * com família UPDATE — mesmo predicado do sino D-11 em `update-familia-ml/processar.ts`.
 *
 * Nesse fluxo só a cor NOVA vai ao canal: as já publicadas entram no payload apenas para o ML não
 * apagá-las (o PUT de `variations` deleta as omitidas), com o estoque que já está lá — sem COLOR,
 * sem preço, sem foto (`AtualizacaoCanonica.preservarPublicadas`). Pedido do Diego 2026-09-03,
 * depois de um PUT inteiro ser recusado com "You cannot change attribute combinations if the
 * variation has bids" ao adicionar uma cor: o ML normaliza o nome da cor pelo dicionário de COLOR
 * ("Rosa Claro" → "Rosa-claro") e a comparação estrita do `montarVariacoesUpdate` lia isso como
 * renomeio (ADR-0062) em variações com venda.
 *
 * Derivado do LOTE, não de um flag no job, de propósito: o "Reenviar" da Revisão
 * (`reprocessar-familia`) reenfileira só `{familia_id, lote_id}` e perderia qualquer payload
 * extra — a família ficaria presa no mesmo erro a cada tentativa.
 */
export async function ehFluxoAddVariacao(admin: SupabaseClient, loteId: string): Promise<boolean> {
  // Falha alto (Codex r2 #3): devolver `false` num erro de leitura reabria o repreço das irmãs.
  // Os chamadores tratam o throw como retry (worker/split: catch do QStash; reconciliador: rodada
  // falha e a raiz segue travada para a próxima).
  const { data, error } = await admin.from('lotes').select('origem').eq('id', loteId).maybeSingle();
  if (error) throw new Error(`ler origem do lote ${loteId}: ${error.message}`);
  if (!data) throw new Error(`lote ${loteId} não encontrado ao decidir preservarPublicadas`);
  return data.origem === 'manual';
}
