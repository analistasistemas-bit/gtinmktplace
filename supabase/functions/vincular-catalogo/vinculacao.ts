// ADR-0088 Fase 2 — roteamento da vinculação de catálogo: família User Products (N itens filhos,
// cada cor um item ML separado) vs. Legacy (1 item, N variações). Detecta UP pela presença de
// linhas em `anuncios_externos_itens` (mesmo padrão de guard de remover-publicado) e roteia para
// `vincularItensCatalogoUP` (por item) ou `vincularVariacoesCatalogo` (por variação). O GTIN dos
// itens filhos NÃO é duplicado no schema: é lido aqui, via join com `variacoes`.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import {
  vincularItensCatalogoUP,
  vincularVariacoesCatalogo,
  type ItemCatalogoRow,
  type ResumoCatalogo,
  type VarCatalogoRow,
} from '../_shared/ml/catalogo.ts';

export interface FilhoCatalogoUP extends ItemCatalogoRow {
  variacao_id: string | null;
  sku: string;
  cor: string | null; // derivado do join com variacoes; usado só no alerta no-match (ADR-0036)
}

/** GTIN do filho por variacao_id (quando presente no mapa), com fallback por sku. null se nenhum. */
export function resolverGtinFilho(
  filho: { variacao_id: string | null; sku: string },
  porVariacaoId: Map<string, string | null>,
  porSku: Map<string, string | null>,
): string | null {
  if (filho.variacao_id && porVariacaoId.has(filho.variacao_id)) return porVariacaoId.get(filho.variacao_id) ?? null;
  return porSku.get(filho.sku) ?? null;
}

/**
 * Carrega os itens filhos UP NÃO retirados de uma família (join raiz→filhos por
 * org_id+codigo_pai+canal) com gtin+cor resolvidos via `variacoes`. Família Legacy (sem linhas em
 * `anuncios_externos_itens`) → []. É a detecção que decide o roteamento em `rodarVinculacaoCatalogo`.
 */
export async function carregarFilhosCatalogoUP(
  admin: SupabaseClient,
  args: { orgId: string; codigoPai: string; canal: string; familiaId: string },
): Promise<FilhoCatalogoUP[]> {
  // Partição 0: hoje é a única que a saga UP escreve (o split, publicar-split-ml, ainda não está
  // integrado — ADR-0088 Fase 2). Trava explícita pra não misturar filhos de partições diferentes
  // no dia em que o split for wireado (revisão de código, achado #3).
  const { data: raizes, error: errRaizes } = await admin.from('anuncios_externos')
    .select('id').eq('org_id', args.orgId).eq('codigo_pai', args.codigoPai).eq('canal', args.canal).eq('particao', 0);
  if (errRaizes) throw new Error(`carregarFilhosCatalogoUP (raízes): ${errRaizes.message}`);
  const rootIds = (raizes ?? []).map((r: { id: string }) => r.id);
  if (rootIds.length === 0) return [];

  const { data: itens, error: errItens } = await admin.from('anuncios_externos_itens')
    .select('id, item_externo_id, variacao_id, sku, catalog_product_id, catalog_listing_id')
    .in('anuncio_externo_id', rootIds).eq('retirado', false);
  if (errItens) throw new Error(`carregarFilhosCatalogoUP (itens): ${errItens.message}`);
  if (!itens || itens.length === 0) return [];

  const { data: variacoes } = await admin.from('variacoes')
    .select('id, codigo, gtin, cor').eq('familia_id', args.familiaId);
  const porVariacaoId = new Map<string, string | null>();
  const porSku = new Map<string, string | null>();
  const corPorSku = new Map<string, string | null>();
  for (const v of (variacoes ?? []) as Array<{ id: string; codigo: string; gtin: string | null; cor: string | null }>) {
    porVariacaoId.set(v.id, v.gtin);
    porSku.set(v.codigo, v.gtin);
    corPorSku.set(v.codigo, v.cor);
  }

  return (itens as Array<Record<string, unknown>>).map((it) => ({
    id: it.id as string,
    item_externo_id: (it.item_externo_id as string | null) ?? null,
    variacao_id: (it.variacao_id as string | null) ?? null,
    sku: it.sku as string,
    cor: corPorSku.get(it.sku as string) ?? null,
    gtin: resolverGtinFilho({ variacao_id: (it.variacao_id as string | null) ?? null, sku: it.sku as string }, porVariacaoId, porSku),
    catalog_product_id: (it.catalog_product_id as string | null) ?? null,
    catalog_listing_id: (it.catalog_listing_id as string | null) ?? null,
  }));
}

export interface RodarVinculacaoDeps {
  vincularUP?: typeof vincularItensCatalogoUP;
  vincularLegacy?: typeof vincularVariacoesCatalogo;
}

export type ResultadoVinculacao =
  | { tipo: 'up'; resumo: ResumoCatalogo; filhos: FilhoCatalogoUP[] }
  | { tipo: 'legacy'; resumo: ResumoCatalogo }
  | { tipo: 'sem_variacoes' };

/**
 * Roteia a vinculação: se a família tem itens filhos UP, vincula por item; senão, cai no caminho
 * Legacy por variação (exatamente como antes). Carrega os filhos ANTES de qualquer lógica por
 * variação — uma família UP tem `variacoes.ml_variation_id = null`, então rodar o Legacy nela
 * marcaria todas as cores como não-elegíveis em silêncio (ADR-0088 §5).
 */
export async function rodarVinculacaoCatalogo(
  admin: SupabaseClient,
  token: string,
  familia: { id: string; org_id: string; codigo_pai: string; ml_item_id: string },
  canal: string,
  deps: RodarVinculacaoDeps = {},
): Promise<ResultadoVinculacao> {
  const vincularUP = deps.vincularUP ?? vincularItensCatalogoUP;
  const vincularLegacy = deps.vincularLegacy ?? vincularVariacoesCatalogo;

  const filhos = await carregarFilhosCatalogoUP(admin, {
    orgId: familia.org_id, codigoPai: familia.codigo_pai, canal, familiaId: familia.id,
  });
  if (filhos.length > 0) {
    const resumo = await vincularUP(token, admin, filhos);
    return { tipo: 'up', resumo, filhos };
  }

  const { data: variacoes } = await admin.from('variacoes')
    .select('id, codigo, gtin, ml_variation_id, catalog_product_id, catalog_listing_id')
    .eq('familia_id', familia.id).eq('excluida_da_publicacao', false);
  if (!variacoes || variacoes.length === 0) return { tipo: 'sem_variacoes' };

  const resumo = await vincularLegacy(token, admin, familia.ml_item_id, variacoes as unknown as VarCatalogoRow[]);
  return { tipo: 'legacy', resumo };
}
