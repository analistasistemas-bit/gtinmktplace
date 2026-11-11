// Alvos de escrita da cor no ML (ADR-0201; plano, Task 13 "alvosDaCor", implementada na Task 8 porque o pedido de
// geração confere a elegibilidade antes de qualquer custo). Baseada em `resolverAlvosPush` (_shared/estoque/alvos.ts)
// com diferenças intencionais: só a linha de anuncios_externos selecionada; filho UP também `pausado`; qualquer SKU da
// cor sem endereço único e vivo aborta o conjunto (nunca pula em silêncio). `familias.ml_item_id` e o nome da cor não
// identificam nada: a cor só escolhe os SKUs pelos dados locais; no ML o casamento é pelo SKU.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { carregarAnuncio, skusDaCor } from './anuncio.ts';

export interface VariacaoML { id: number; sku: string | null; pictureIds: string[] }
export interface ItemElegibilidade {
  id: string;
  /** null = campo ausente na resposta (não dá para afirmar que não é catálogo). */
  catalogListing: boolean | null;
  tags: string[];
  /** seller_custom_field da raiz. */
  sku: string | null;
  pictures: string[];
  variacoes: VariacaoML[];
  /** picture id → `secure_url` do mesmo GET (prévia do aplicar); opcional: fixtures e retratos não trazem. */
  urls?: Record<string, string>;
}
export interface Alvo { itemId: string; variacoes: Array<{ sku: string; variationId: number | null }> }
export type ErroAlvos = { erro: 'conjunto_incompleto' | 'sem_anuncio' | 'variacao_nao_casa'; detalhe: string };
/** Leituras do ML injetadas (o chamador memoiza por item: um GET serve ao casamento e à elegibilidade). */
export interface LeitorML {
  lerItem(itemId: string): Promise<ItemElegibilidade | null>;
  /** `buscarItemBackfill` (_shared/ml/buscar-item.ts): SKU da raiz do item UP plano. */
  lerBackfill(itemId: string): Promise<{ sku: string | null; temVariacoes: boolean } | null>;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * GET próprio da galeria (o de `buscarItemML`, usado por todo UPDATE, não muda). Qualquer falha → null
 * (o chamador recusa: sem leitura não há como afirmar catálogo nem casar SKU).
 */
export async function lerElegibilidadeItemML(token: string, itemId: string): Promise<ItemElegibilidade | null> {
  try {
    const r = await fetch(
      `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}?attributes=id,catalog_listing,tags,variations,pictures,seller_custom_field`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return null;
    const j = await r.json() as Record<string, unknown>;
    const lista = (v: unknown) => (Array.isArray(v) ? v : []) as Array<Record<string, unknown>>;
    return {
      id: String(j.id ?? itemId),
      catalogListing: typeof j.catalog_listing === 'boolean' ? j.catalog_listing : null,
      tags: (Array.isArray(j.tags) ? j.tags : []).filter((t): t is string => typeof t === 'string'),
      sku: texto(j.seller_custom_field),
      pictures: lista(j.pictures).map((p) => texto(p.id)).filter((p): p is string => p !== null),
      variacoes: lista(j.variations).map((v) => ({
        id: Number(v.id),
        sku: texto(v.seller_custom_field),
        pictureIds: (Array.isArray(v.picture_ids) ? v.picture_ids : []).filter((p): p is string => typeof p === 'string'),
      })),
      urls: Object.fromEntries(lista(j.pictures).flatMap((p) => {
        const id = texto(p.id), url = texto(p.secure_url);
        return id && url ? [[id, url]] : [];
      })),
    };
  } catch {
    return null;
  }
}

/** R0.2 / ADR §5: catálogo fica fora; campo ausente também (não dá para provar que não é catálogo). */
export function motivoElegibilidade(item: ItemElegibilidade): 'catalogo' | 'catalogo_desconhecido' | null {
  return item.catalogListing === true ? 'catalogo' : item.catalogListing === null ? 'catalogo_desconhecido' : null;
}

const incompleto = (detalhe: string): ErroAlvos => ({ erro: 'conjunto_incompleto', detalhe });

export async function alvosDaCor(
  admin: SupabaseClient, orgId: string, anuncioId: string, cor: string, leitor: LeitorML,
): Promise<{ alvos: Alvo[] } | ErroAlvos> {
  const { data: an, error } = await admin.from('anuncios_externos').select('id, item_externo_id')
    .eq('id', anuncioId).eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  if (error) throw new Error(error.message);
  if (!an) return { erro: 'sem_anuncio', detalhe: anuncioId };
  const a = await carregarAnuncio(admin, orgId, anuncioId);
  if ('erro' in a) return incompleto(a.erro);
  // SKU vivo sem variação em nenhuma família publicada: não se sabe a cor dele → não dá para afirmar que o conjunto
  // da cor está completo.
  const semDados = a.skus.filter((s) => !a.porSku[s]);
  if (semDados.length > 0) return incompleto(`sem_variacao_publicada:${semDados.join(',')}`);
  const skus = skusDaCor(a, cor);
  if (skus.length === 0) return incompleto('cor_sem_sku');

  const { data: filhos, error: eF } = await admin.from('anuncios_externos_itens')
    .select('sku, item_externo_id, status, retirado').eq('anuncio_externo_id', anuncioId).eq('org_id', orgId).eq('retirado', false);
  if (eF) throw new Error(eF.message);
  const vivos = (filhos ?? []) as Array<{ sku: string; item_externo_id: string | null; status: string }>;

  // SKU → item. UP: exatamente um filho vivo, com MLB e ativo/pausado. Legacy: o MLB da partição.
  const itemDoSku: Record<string, string> = {};
  const upPlano = new Set<string>();
  for (const sku of skus) {
    if (vivos.length > 0) {
      const f = vivos.filter((x) => x.sku === sku);
      if (f.length !== 1) return incompleto(`${sku}:${f.length}_itens_vivos`);
      if (!f[0].item_externo_id) return incompleto(`${sku}:sem_endereco`);
      if (f[0].status !== 'ativo' && f[0].status !== 'pausado') return incompleto(`${sku}:${f[0].status}`);
      itemDoSku[sku] = f[0].item_externo_id;
      // SKU da raiz conferido pela leitura do backfill; SKU vazio nunca conta como conferido.
      const bf = await leitor.lerBackfill(f[0].item_externo_id);
      if (!bf) return incompleto(`${sku}:item_nao_lido`);
      if (!bf.temVariacoes) {
        if (bf.sku !== sku) return incompleto(`${sku}:sku_remoto_${bf.sku ?? 'vazio'}`);
        upPlano.add(sku);
      }
    } else {
      if (!an.item_externo_id) return incompleto(`${sku}:sem_endereco`);
      itemDoSku[sku] = an.item_externo_id;
    }
  }

  const porItem = new Map<string, Alvo['variacoes']>();
  for (const sku of skus) {
    const itemId = itemDoSku[sku];
    const vars = porItem.get(itemId) ?? [];
    porItem.set(itemId, vars);
    if (upPlano.has(sku)) { vars.push({ sku, variationId: null }); continue; }
    const item = await leitor.lerItem(itemId);
    if (!item) return incompleto(`${itemId}:item_nao_lido`);
    if (item.variacoes.length === 0) {
      if (item.sku !== sku) return { erro: 'variacao_nao_casa', detalhe: `${itemId}:${sku}` };
      vars.push({ sku, variationId: null });
      continue;
    }
    const casam = item.variacoes.filter((v) => v.sku === sku);
    if (casam.length !== 1) return { erro: 'variacao_nao_casa', detalhe: `${itemId}:${sku}` };
    vars.push({ sku, variationId: casam[0].id });
  }
  return { alvos: [...porItem].sort(([x], [y]) => x.localeCompare(y)).map(([itemId, variacoes]) => ({ itemId, variacoes })) };
}
