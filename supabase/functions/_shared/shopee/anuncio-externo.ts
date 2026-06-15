// Estado de publicação Shopee em anuncios_externos (ADR-0025). NÃO usamos o
// espelhar.ts do ML (fixado em 'mercado_livre'); a Shopee tem sua própria row,
// e o `metadados_canal` guarda o cache de idempotência de fotos para o retry.
//
// montarAnuncioExternoShopee é PURA (testável); o I/O (upsert) fica no worker.

export type FotosCacheShopee = {
  capa?: string;
  capa2?: string;
  capa3?: string;
  // sku da variação → image_id já subido
  [sku: string]: string | undefined;
};

export type MetadadosCanalShopee = {
  shop_id?: string;
  categoria_id?: number | string;
  fotos?: FotosCacheShopee;
  [k: string]: unknown;
};

export type AnuncioExternoShopeeRow = {
  user_id: string;
  canal: 'shopee';
  codigo_pai: string;
  item_externo_id: string | null;
  permalink: string | null;
  status: string;
  erro_mensagem: string | null;
  variacoes_externas: Record<string, { variation_id: string }>;
  metadados_canal: MetadadosCanalShopee;
  publicado_em: string | null;
};

export interface DadosRowShopee {
  user_id: string;
  codigo_pai: string;
  status: string;
  itemExternoId?: string | null;
  permalink?: string | null;
  erroMensagem?: string | null;
  /** sku interno (codigo) → id da variação no canal. */
  variacoesExternas?: Record<string, string>;
  metadados: MetadadosCanalShopee;
  publicadoEm?: string | null;
}

/** Monta a row de anuncios_externos para o canal Shopee (pura). */
export function montarAnuncioExternoShopee(d: DadosRowShopee): AnuncioExternoShopeeRow {
  const variacoes_externas: Record<string, { variation_id: string }> = {};
  for (const [codigo, variationId] of Object.entries(d.variacoesExternas ?? {})) {
    variacoes_externas[codigo] = { variation_id: variationId };
  }
  return {
    user_id: d.user_id,
    canal: 'shopee',
    codigo_pai: d.codigo_pai,
    item_externo_id: d.itemExternoId ?? null,
    permalink: d.permalink ?? null,
    status: d.status,
    erro_mensagem: d.erroMensagem ?? null,
    variacoes_externas,
    metadados_canal: d.metadados,
    publicado_em: d.publicadoEm ?? null,
  };
}

/** Resolve o image_id de uma chave (capa/capa2/capa3/sku) do cache, ou undefined. */
export function fotoCacheada(metadados: MetadadosCanalShopee, chave: string): string | undefined {
  return metadados.fotos?.[chave];
}
