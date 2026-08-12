// ADR-0113 — exclusão de produto pelo módulo Estoque. Só produto NÃO publicado em canal
// nenhum: apagar família com `ml_item_id` corta o vínculo CREATE-vs-UPDATE do ingest-lote e a
// próxima planilha do mesmo código viraria anúncio duplicado no ML (ADR-0019).
// Produto publicado sai pela tela Publicados → "Remover" (remover-publicado), que pausa no ML.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { pathsDaFamilia, filtrarPathsDeDonos } from '../_shared/lote/exclusao.ts';
import { recontarOuRemoverLote } from '../_shared/lote/recontar.ts';
import { limparMovimentosOrfaos } from '../_shared/estoque/limpeza.ts';

// A exclusão opera sobre o `codigo_pai` inteiro (D-4), não sobre a linha clicada — receber o
// código evita a indireção de resolver familia_id → codigo_pai só para varrer o código de volta.
export interface ExcluirProdutoInput {
  codigoPai: string;
  orgId: string;
}

export type ResultadoExclusaoProduto =
  | { tipo: 'nao_encontrada' }
  | { tipo: 'publicado' }
  | { tipo: 'em_voo' }
  | { tipo: 'ok'; familiasRemovidas: number; lotesRemovidos: number; movimentosRemovidos: number };

const EM_VOO = ['publicando', 'processando'];

export async function excluirProduto(
  admin: SupabaseClient, input: ExcluirProdutoInput,
): Promise<ResultadoExclusaoProduto> {
  const { codigoPai, orgId } = input;

  // Trava ADR-0019, olhando o codigo_pai inteiro e não a linha clicada na tela: ciclos de UPDATE
  // deixam várias famílias com o mesmo código, e o delete abaixo apaga TODAS. Checar só a linha
  // visível deixaria excluir a mais recente (crua) de um produto com anúncio vivo em outra.
  // O predicado é `ml_item_id not null` porque é exatamente o que o ingest-lote consulta para
  // decidir UPDATE — inclusive a linha de reposição que herdou o id sem publicar nada.
  const { data: publicadas, error: pubErr } = await admin.from('familias')
    .select('id').eq('codigo_pai', codigoPai).eq('org_id', orgId)
    .not('ml_item_id', 'is', null).limit(1);
  // Fail-closed: erro virando lista vazia cortaria o vínculo de UPDATE em silêncio.
  if (pubErr) throw new Error(`excluir-produto: consultar publicadas falhou: ${pubErr.message}`);
  if (publicadas && publicadas.length > 0) return { tipo: 'publicado' };

  // Um worker em andamento ainda vai escrever nessa família (e pode publicá-la).
  const { data: emVoo, error: emVooErr } = await admin.from('familias')
    .select('id').eq('codigo_pai', codigoPai).eq('org_id', orgId)
    .in('status', EM_VOO).limit(1);
  if (emVooErr) throw new Error(`excluir-produto: consultar em_voo falhou: ${emVooErr.message}`);
  if (emVoo && emVoo.length > 0) return { tipo: 'em_voo' };

  const { data: familias, error: familiasErr } = await admin.from('familias')
    .select('id, lote_id, user_id, capa_storage_path, capa2_storage_path, capa3_storage_path, variacoes(imagem_path)')
    .eq('codigo_pai', codigoPai).eq('org_id', orgId);
  if (familiasErr) throw new Error(`excluir-produto: listar famílias falhou: ${familiasErr.message}`);
  const alvos = familias ?? [];
  if (alvos.length === 0) return { tipo: 'nao_encontrada' };

  // Guard de posse: `capa*_storage_path` é editável por qualquer membro da org e este delete roda
  // com service_role (a RLS de storage não se aplica). Cada família só apaga sob o prefixo do SEU
  // dono — travar na org deixaria um membro apagar arquivo de um colega.
  const paths = [...new Set(alvos.flatMap((f) => filtrarPathsDeDonos(
    pathsDaFamilia({
      capa_storage_path: f.capa_storage_path,
      capa2_storage_path: f.capa2_storage_path,
      capa3_storage_path: f.capa3_storage_path,
      variacoes: f.variacoes ?? [],
    }),
    new Set([f.user_id as string]),
  )))];
  if (paths.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(paths);
    if (error) console.warn('excluir-produto storage falhou (segue):', error.message);
  }

  const lotesAfetados = [...new Set(alvos.map((f) => f.lote_id as string))];
  const { error: delErr } = await admin.from('familias').delete().in('id', alvos.map((f) => f.id));
  if (delErr) throw new Error(`excluir-produto: deletar familias falhou: ${delErr.message}`);

  // ADR-0097 D-2: o ledger não tem FK para `variacoes`, então o cascade não o alcança. Depois do
  // delete — antes dele o anti-join sairia vazio. A RPC preserva os 4 motivos de D-1.1 (entre
  // eles o tombstone `cancelamento_sem_baixa`), que não pertencem a produto nenhum.
  const movimentosRemovidos = await limparMovimentosOrfaos(admin, orgId);

  let lotesRemovidos = 0;
  for (const loteId of lotesAfetados) {
    if (await recontarOuRemoverLote(admin, loteId, false)) lotesRemovidos++;
  }

  return { tipo: 'ok', familiasRemovidas: alvos.length, lotesRemovidos, movimentosRemovidos };
}
