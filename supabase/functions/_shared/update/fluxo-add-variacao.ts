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

/**
 * Incidente 12/11/2026 (produto 92710170): neste fluxo nenhuma cor pode ser desmarcada. A saga de composição lê
 * "cor fora do conjunto" como retirada, e 7 cores desmarcadas na Revisão foram pausadas no ML.
 *
 * Devolve os SKUs com `excluida_da_publicacao=true` que estão no ar: filho User Products vivo (`retirado=false`
 * com item) ou variação casada do anúncio com variações (`ml_variation_id`). Quem chama recusa antes de escrever.
 *
 * `variacoes` é a MESMA fotografia de onde quem chama tira as cores incluídas que entrega à saga — nunca uma
 * segunda leitura. Relendo, uma cor remarcada no intervalo sumia das duas listas: fora das incluídas (lidas
 * antes) e fora das desmarcadas (lidas depois), e a saga a retirava.
 *
 * Fail-closed: a leitura dos itens que falha lança. Erro de SELECT nunca vira "sem desmarcadas".
 */
export interface VariacaoMarcacao {
  codigo: string; ml_variation_id?: string | null; excluida_da_publicacao?: boolean | null;
}
export async function coresDesmarcadasPublicadas(
  admin: SupabaseClient, variacoes: VariacaoMarcacao[], raizId: string | null,
): Promise<string[]> {
  const excluidas = variacoes.filter((v) => v.excluida_da_publicacao);
  if (excluidas.length === 0) return [];

  let vivos = new Set<string>();
  if (raizId) {
    const { data: itens, error: errItens } = await admin.from('anuncios_externos_itens')
      .select('sku, item_externo_id, retirado').eq('anuncio_externo_id', raizId);
    if (errItens || !Array.isArray(itens)) {
      throw new Error(`ler itens do anúncio ${raizId}: ${errItens?.message ?? 'sem resposta'}`);
    }
    vivos = new Set(
      (itens as Array<{ sku: string; item_externo_id: string | null; retirado: boolean | null }>)
        .filter((i) => !i.retirado && i.item_externo_id).map((i) => i.sku),
    );
  }
  return excluidas.filter((v) => v.ml_variation_id || vivos.has(v.codigo)).map((v) => v.codigo).sort();
}

/** Mesmo padrão do `reposicao_sem_item` (ADR-0195): terminal, diz o que houve e o que fazer. */
export function mensagemCoresDesmarcadas(skus: string[]): string {
  return `UPDATE bloqueado: ${skus.length} cor(es) desmarcada(s) já publicada(s) no Mercado Livre `
    + `(${skus.slice(0, 10).join(', ')}${skus.length > 10 ? '…' : ''}). Em 'Adicionar variação' nenhuma cor pode ser `
    + 'desmarcada. Nada foi enviado. Marque todas as cores e reenvie.';
}
