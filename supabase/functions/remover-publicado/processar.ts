import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { pathsDaFamilia } from '../_shared/lote/exclusao.ts';
import { recontarOuRemoverLote } from '../_shared/lote/recontar.ts';

export interface RemoverPublicadoInput {
  familiaId: string;
  orgId: string;
  canal: string;
}

export type ResultadoRemocao =
  | { tipo: 'nao_encontrada' }
  | { tipo: 'nao_publicada' }
  | { tipo: 'em_voo' }
  | { tipo: 'bloqueio_up' }
  | { tipo: 'ok'; familiasRemovidas: number; lotesRemovidos: number };

export const MENSAGEM_BLOQUEIO_UP =
  'Esta família usa o modelo User Products (múltiplos itens no Mercado Livre). '
  + 'Remoção automática ainda não suportada — contate o suporte técnico.';

export async function removerPublicado(admin: SupabaseClient, input: RemoverPublicadoInput): Promise<ResultadoRemocao> {
  const { familiaId, orgId, canal } = input;

  const { data: alvo } = await admin.from('familias')
    .select('id, codigo_pai, ml_item_id, org_id')
    .eq('id', familiaId).eq('org_id', orgId).maybeSingle();
  if (!alvo) return { tipo: 'nao_encontrada' };
  // Invariante ADR-0019: este escape hatch só remove famílias PUBLICADAS.
  if (!alvo.ml_item_id) return { tipo: 'nao_publicada' };

  // Guarda: bloqueia se há família do mesmo codigo_pai em 'publicando' (UPDATE em voo depende do ml_item_id).
  const { data: emVoo } = await admin.from('familias')
    .select('id').eq('codigo_pai', alvo.codigo_pai).eq('org_id', alvo.org_id).eq('status', 'publicando').limit(1);
  if (emVoo && emVoo.length > 0) return { tipo: 'em_voo' };

  // Guarda mínima ADR-0088: família User Products tem N itens técnicos ativos no ML —
  // remover-publicado ainda não sabe pausar+confirmar todos antes de apagar local (a
  // mini-saga completa de remoção é trabalho futuro). Recusa cedo, sem tocar em nada,
  // pra nunca deixar item ativo órfão no ML (pior cenário que o ADR proíbe).
  const { data: externos } = await admin.from('anuncios_externos')
    .select('id').eq('org_id', alvo.org_id).eq('codigo_pai', alvo.codigo_pai).eq('canal', canal);
  const idsExternos = (externos ?? []).map((e: { id: string }) => e.id);
  if (idsExternos.length > 0) {
    const { data: itensUP } = await admin.from('anuncios_externos_itens')
      .select('id').in('anuncio_externo_id', idsExternos).limit(1);
    if (itensUP && itensUP.length > 0) return { tipo: 'bloqueio_up' };
  }

  // Codex P2: o vínculo de UPDATE é GLOBAL por (user_id, codigo_pai, ml_item_id not null) —
  // o ingest-lote casa por codigo_pai. Após ciclos de UPDATE existem várias linhas publicadas
  // do mesmo codigo_pai (uma por lote). Remover só a selecionada deixaria outra satisfazendo a
  // busca → a próxima planilha ainda viraria UPDATE no anúncio morto. Removemos TODAS as linhas
  // publicadas do mesmo codigo_pai para realmente cortar o vínculo.
  const { data: familias } = await admin.from('familias')
    .select('id, lote_id, capa_storage_path, capa2_storage_path, capa3_storage_path, variacoes(imagem_path)')
    .eq('codigo_pai', alvo.codigo_pai).eq('org_id', orgId).not('ml_item_id', 'is', null);
  const alvos = familias ?? [];

  const paths = [...new Set(alvos.flatMap((f) => pathsDaFamilia({
    capa_storage_path: f.capa_storage_path,
    capa2_storage_path: f.capa2_storage_path,
    capa3_storage_path: f.capa3_storage_path,
    variacoes: f.variacoes ?? [],
  })))];
  if (paths.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(paths);
    if (error) console.warn('remover-publicado storage falhou (segue):', error.message);
  }

  const lotesAfetados = [...new Set(alvos.map((f) => f.lote_id))];
  await admin.from('familias').delete().in('id', alvos.map((f) => f.id));
  await admin.from('anuncios_externos')
    .delete()
    .eq('org_id', alvo.org_id)          // E7: escopo por org — não apagar anúncio de outra org com mesmo codigo_pai
    .eq('canal', canal)
    .eq('codigo_pai', alvo.codigo_pai);

  // Reconta (ou remove se vazio) cada lote afetado. Remover não "conclui" o lote → setConcluido=false.
  let lotesRemovidos = 0;
  for (const loteId of lotesAfetados) {
    if (await recontarOuRemoverLote(admin, loteId, false)) lotesRemovidos++;
  }

  return { tipo: 'ok', familiasRemovidas: alvos.length, lotesRemovidos };
}
