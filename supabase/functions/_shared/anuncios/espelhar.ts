// ADR-0025 / E2: espelha o estado de publicação do ML em anuncios_externos (dual-write).
// montarAnuncioExterno é pura (testável); espelharAnuncioExterno é best-effort (não derruba a
// publicação — o ml_* em familias/variacoes é a fonte de verdade).

export type VariacaoEspelho = {
  codigo: string;
  ml_variation_id: string | null;
  catalog_product_id?: string | null;
  catalog_listing_id?: string | null;
  catalog_status?: string | null;
};

export type FamiliaEspelho = {
  user_id: string;
  codigo_pai: string;
  ml_item_id: string | null;
  ml_permalink: string | null;
  status?: string;
  publicado_em?: string | null;
};

export type VariacaoExterna = {
  variation_id: string;
  catalog_product_id?: string;
  catalog_listing_id?: string;
  catalog_status?: string;
};

export type AnuncioExternoRow = {
  user_id: string;
  canal: 'mercado_livre';
  codigo_pai: string;
  item_externo_id: string | null;
  permalink: string | null;
  status: string;
  variacoes_externas: Record<string, VariacaoExterna>;
  publicado_em: string | null;
};

export function montarAnuncioExterno(
  familia: FamiliaEspelho,
  variacoes: VariacaoEspelho[],
): AnuncioExternoRow {
  const variacoes_externas: Record<string, VariacaoExterna> = {};
  for (const v of variacoes) {
    if (!v.ml_variation_id) continue;
    const entry: VariacaoExterna = { variation_id: v.ml_variation_id };
    if (v.catalog_product_id) entry.catalog_product_id = v.catalog_product_id;
    if (v.catalog_listing_id) entry.catalog_listing_id = v.catalog_listing_id;
    if (v.catalog_status && v.catalog_status !== 'pendente') entry.catalog_status = v.catalog_status;
    variacoes_externas[v.codigo] = entry;
  }
  return {
    user_id: familia.user_id,
    canal: 'mercado_livre',
    codigo_pai: familia.codigo_pai,
    item_externo_id: familia.ml_item_id,
    permalink: familia.ml_permalink,
    status: familia.status ?? 'publicado',
    variacoes_externas,
    publicado_em: familia.publicado_em ?? null,
  };
}

// Mescla o mapa existente com o novo (novo vence por código). Preserva cores de lotes
// anteriores que não vieram no lote atual — uma reposição parcial (poucos SKUs) não pode
// encolher o mapa do anúncio (que tem todas as cores publicadas). Ver ADR-0025 / review E2.
export function mesclarVariacoesExternas(
  existente: Record<string, VariacaoExterna> | null | undefined,
  novo: Record<string, VariacaoExterna>,
): Record<string, VariacaoExterna> {
  return { ...(existente ?? {}), ...novo };
}

// deno-lint-ignore no-explicit-any
export async function espelharAnuncioExterno(
  admin: any,
  familia: FamiliaEspelho,
  variacoes: VariacaoEspelho[],
): Promise<void> {
  try {
    const row = montarAnuncioExterno(familia, variacoes);
    // Merge com o que já existe: o lote atual pode trazer só um subconjunto das cores
    // (reposição parcial); o upsert substituiria a row inteira e perderia as demais.
    const { data: existente } = await admin
      .from('anuncios_externos')
      .select('variacoes_externas')
      .eq('user_id', row.user_id).eq('canal', row.canal).eq('codigo_pai', row.codigo_pai)
      .maybeSingle();
    row.variacoes_externas = mesclarVariacoesExternas(
      existente?.variacoes_externas as Record<string, VariacaoExterna> | undefined,
      row.variacoes_externas,
    );
    const { error } = await admin
      .from('anuncios_externos')
      .upsert(row, { onConflict: 'user_id,canal,codigo_pai' });
    if (error) console.error('espelhar anuncios_externos falhou:', error.message);
  } catch (e) {
    console.error('espelhar anuncios_externos exceção:', (e as Error).message);
  }
}
