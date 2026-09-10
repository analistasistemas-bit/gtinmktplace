import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { podeExcluirLote } from '../_shared/support-state.ts';
import { particionarExclusao, chaveVinculo, type FamiliaExclusao } from '../_shared/lote/exclusao.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { recontarOuRemoverLote } from '../_shared/lote/recontar.ts';
import { limparMovimentosOrfaos } from '../_shared/estoque/limpeza.ts';

const BLOQUEADOS = ['processando', 'publicando'];

/**
 * Vínculos `ml_item_id|ml_variation_id` que continuam representados por famílias FORA deste
 * lote — insumo do guard anti-órfão de `particionarExclusao`. `undefined` quando a consulta
 * falha: o guard trava fechado e preserva, em vez de apagar a última linha que representa
 * uma variação viva no ML.
 */
/**
 * `codigo_pai`s do lote que têm item VIVO no ML segundo `anuncios_externos_itens` (os filhos User
 * Products). Incidente 2026-09-10: em UP nem a raiz de `anuncios_externos` (item_externo_id null)
 * nem `variacoes.ml_variation_id` (null por construção) provam a existência do anúncio — só os
 * filhos. `undefined` = consulta falhou; quem chama trava fechado e preserva.
 */
async function lerCodigosComItemRemoto(
  admin: SupabaseClient,
  orgId: string,
  familiasDoLote: Array<{ codigo_pai?: string | null }>,
): Promise<ReadonlySet<string> | undefined> {
  const codigos = [...new Set(familiasDoLote.map((f) => f.codigo_pai).filter((c): c is string => !!c))];
  if (codigos.length === 0) return new Set();
  const { data, error } = await admin.from('anuncios_externos')
    .select('codigo_pai, anuncios_externos_itens(item_externo_id)')
    .eq('org_id', orgId).in('codigo_pai', codigos);
  if (error) {
    console.warn('excluir-lote: itens remotos indisponíveis (preserva por precaução):', error.message);
    return undefined;
  }
  const comItem = new Set<string>();
  for (const raiz of (data ?? []) as Array<{ codigo_pai: string; anuncios_externos_itens?: Array<{ item_externo_id: string | null }> }>) {
    if ((raiz.anuncios_externos_itens ?? []).some((i) => !!i.item_externo_id)) comItem.add(raiz.codigo_pai);
  }
  return comItem;
}

async function lerVinculosVivosFora(
  admin: SupabaseClient,
  orgId: string,
  loteId: string,
  familiasDoLote: Array<{ ml_item_id: string | null }>,
): Promise<ReadonlySet<string> | undefined> {
  const itemIds = [...new Set(familiasDoLote.map((f) => f.ml_item_id).filter((id): id is string => !!id))];
  if (itemIds.length === 0) return new Set();
  const { data, error } = await admin.from('familias')
    .select('ml_item_id, variacoes(ml_variation_id)')
    .eq('org_id', orgId).in('ml_item_id', itemIds).neq('lote_id', loteId);
  if (error) {
    console.warn('excluir-lote: vínculos vivos indisponíveis (preserva por precaução):', error.message);
    return undefined;
  }
  const vivos = new Set<string>();
  for (const f of data ?? []) {
    for (const v of (f.variacoes ?? []) as Array<{ ml_variation_id: string | null }>) {
      const k = chaveVinculo(f.ml_item_id as string | null, v.ml_variation_id);
      if (k) vivos.add(k);
    }
  }
  return vivos;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let user;
  try { user = await requireUserOrg(req, { access: 'write' }); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const { lote_id } = await req.json().catch(() => ({}));
  if (!lote_id) return new Response('lote_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const { data: lote } = await admin.from('lotes')
    .select('id, user_id, status, planilha_path, imagens_paths').eq('id', lote_id).eq('org_id', user.orgId).maybeSingle();
  if (!lote) return new Response('Lote não encontrado', { status: 404, headers: corsHeaders });
  if (!podeExcluirLote(lote.user_id, user.userId, user.support?.scope === 'full')) return new Response('Lote não encontrado', { status: 404, headers: corsHeaders });
  if (BLOQUEADOS.includes(lote.status)) {
    return new Response(JSON.stringify({ erro: 'Aguarde o processamento/publicação terminar antes de excluir.' }),
      { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { data: familias } = await admin.from('familias')
    .select('id, codigo_pai, ml_item_id, publicado_em, capa_storage_path, capa2_storage_path, capa3_storage_path, variacoes(imagem_path, ml_variation_id)')
    .eq('lote_id', lote_id);

  const part = particionarExclusao({
    familias: (familias ?? []) as FamiliaExclusao[],
    planilhaPath: lote.planilha_path, imagensPaths: lote.imagens_paths,
    // lote.user_id === user.id (checado acima). Trava os paths no prefixo do próprio dono:
    // as colunas de path são escritas pelo cliente, e este delete roda com service_role.
    donoUserId: lote.user_id,
    vinculosVivosFora: await lerVinculosVivosFora(admin, user.orgId, lote_id, familias ?? []),
    codigosComItemRemoto: await lerCodigosComItemRemoto(admin, user.orgId, familias ?? []),
  });

  if (part.pathsRemover.length > 0) {
    const { error } = await admin.storage.from('imagens').remove(part.pathsRemover);
    if (error) console.warn('excluir-lote storage remove falhou (segue):', error.message);
  }

  const ids = part.paraExcluir.map((f) => f.id);
  if (ids.length > 0) await admin.from('familias').delete().in('id', ids);

  // ADR-0097: o ledger não tem FK para variacoes, então o cascade não o alcança.
  // Depois do delete — antes dele o conjunto órfão sairia vazio.
  const movimentosRemovidos = ids.length > 0
    ? await limparMovimentosOrfaos(admin, user.orgId)
    : 0;

  // Reconta (ou remove se vazio) a partir do estado real do DB. Sobrou só publicada → concluido.
  const loteRemovido = await recontarOuRemoverLote(admin, lote_id, true);

  await auditarOperacaoSuporte(admin, user, { type: 'lote', id: lote_id }, 'succeeded');
  return new Response(JSON.stringify({
    familias_removidas: ids.length, imagens_removidas: part.pathsRemover.length,
    familias_preservadas: part.preservadas.length, lote_removido: loteRemovido,
    movimentos_removidos: movimentosRemovidos,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
