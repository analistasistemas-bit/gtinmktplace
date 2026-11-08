// ADR-0199: fotos usadas por item moderado no ML (spec, teste de 07/11: nunca usar foto de item moderado). Extraído de
// `criar-kit-variacao/index.ts` (Task 15) para a geração de foto por IA (`gerar-foto-kit`) aplicar a mesma regra às
// fotos de origem. Foto → itens que a usam (`itensPorFoto`: Legacy, principal e cópias de catálogo) → status lido no ML
// agora, com leitura completa (`moderadosDoBulk` lança se faltar item). Qualquer falha lança e quem chama recusa.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { caminhoMultiget, comoEnvelopeAntigo } from '../_shared/ml/multiget.ts';
import { itensPorFoto, moderadosDoBulk } from './processar.ts';

type Linha = Record<string, unknown>;

async function ler<T>(q: PromiseLike<{ data: T; error: { message: string } | null }>, onde: string): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(`${onde}: ${error.message}`);
  return data;
}

/** Caminhos de `paths` usados por algum item moderado (`under_review`, `forbidden`, `waiting_for_patch`), lido no ML. */
export async function fotosEmItemModerado(
  admin: SupabaseClient, orgId: string, tokenML: () => Promise<string>, paths: string[],
): Promise<string[]> {
  const vs = await ler(admin.from('variacoes').select('codigo, imagem_path, catalog_listing_id, familias!inner(ml_item_id)')
    .eq('org_id', orgId).in('imagem_path', paths), 'fotos de variação') ?? [];
  const capas: Array<{ path: string; codigo_pai: string; ml_item_id: string | null }> = [];
  for (const coluna of ['capa_storage_path', 'capa2_storage_path', 'capa3_storage_path']) {
    const fs = await ler(admin.from('familias').select('*').eq('org_id', orgId).in(coluna, paths), 'fotos de capa') as Linha[] | null;
    capas.push(...(fs ?? []).map((f) => ({
      path: f[coluna] as string, codigo_pai: f.codigo_pai as string, ml_item_id: (f.ml_item_id as string | null) ?? null,
    })));
  }
  const skus = [...new Set(vs.map((v) => v.codigo as string))];
  const pais = [...new Set(capas.map((f) => f.codigo_pai))];
  const filhos: Linha[] = [];
  const colunas = 'sku, item_externo_id, catalog_listing_id, anuncios_externos!inner(codigo_pai)';
  if (skus.length > 0) {
    filhos.push(...await ler(admin.from('anuncios_externos_itens').select(colunas).eq('org_id', orgId)
      .in('sku', skus), 'itens das fotos de variação') ?? []);
  }
  if (pais.length > 0) {
    filhos.push(...await ler(admin.from('anuncios_externos_itens').select(colunas).eq('org_id', orgId)
      .in('anuncios_externos.codigo_pai', pais), 'itens das fotos de capa') ?? []);
  }
  const umDe = (x: unknown) => (Array.isArray(x) ? x[0] : x) as Linha | null | undefined;
  const itensPorPath = itensPorFoto({
    variacoes: vs.map((v) => ({
      imagem_path: v.imagem_path as string, codigo: v.codigo as string,
      familia_ml_item_id: (umDe(v.familias)?.ml_item_id as string | null) ?? null,
      catalog_listing_id: (v.catalog_listing_id as string | null) ?? null,
    })),
    capas,
    filhos: filhos.map((f) => ({
      sku: f.sku as string, codigo_pai: (umDe(f.anuncios_externos)?.codigo_pai as string | null) ?? null,
      item_externo_id: (f.item_externo_id as string | null) ?? null, catalog_listing_id: (f.catalog_listing_id as string | null) ?? null,
    })),
  });
  const ids = [...new Set([...itensPorPath.values()].flatMap((x) => [...x]))];
  if (ids.length === 0) return [];
  const token = await tokenML();
  const moderados = new Set<string>();
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    const resp = await fetch(`https://api.mercadolibre.com${caminhoMultiget(bloco, 'id,status,sub_status')}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) throw new Error(`ML /items/bulk ${resp.status}`);
    for (const id of moderadosDoBulk(bloco, comoEnvelopeAntigo(await resp.json(), bloco))) moderados.add(id);
  }
  return [...itensPorPath].filter(([, itens]) => [...itens].some((id) => moderados.has(id))).map(([p]) => p);
}
