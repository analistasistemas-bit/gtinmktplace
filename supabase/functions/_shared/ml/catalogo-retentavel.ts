// Mantido em sync com src/lib/catalogo-retentavel.ts (Deno/Vite split).

export const STATUS_CATALOGO_RETENTAVEL = ['erro', 'nao_elegivel'] as const;
export type StatusCatalogoRetentavel = (typeof STATUS_CATALOGO_RETENTAVEL)[number];

function statusRetentavel(status: string | null | undefined): boolean {
  return (STATUS_CATALOGO_RETENTAVEL as readonly string[]).includes(status ?? '');
}

export function variacaoCatalogoRetentavel(v: {
  catalog_status: string | null;
  catalog_listing_id: string | null;
  ml_variation_id: string | null;
}): boolean {
  return v.ml_variation_id != null
    && v.catalog_listing_id == null
    && statusRetentavel(v.catalog_status);
}

/** Item técnico UP (anuncios_externos_itens). */
export function itemExternoCatalogoRetentavel(item: {
  catalog_status?: string | null;
  catalog_listing_id?: string | null;
  item_externo_id?: string | null;
}): boolean {
  return !!item.item_externo_id
    && item.catalog_listing_id == null
    && statusRetentavel(item.catalog_status);
}

export function familiaTemCatalogoRetentavel(
  variacoes: Array<{
    catalog_status: string | null;
    catalog_listing_id: string | null;
    ml_variation_id: string | null;
  }>,
  itensExternos?: Array<{
    catalog_status?: string | null;
    catalog_listing_id?: string | null;
    item_externo_id?: string | null;
  }>,
): boolean {
  if (variacoes.some(variacaoCatalogoRetentavel)) return true;
  return (itensExternos ?? []).some(itemExternoCatalogoRetentavel);
}

export function catalogStatusRetentavelEmEspelho(
  variacoesExternas: Record<string, {
    catalog_status?: string | null;
    catalog_listing_id?: string | null;
    variation_id?: string | null;
  }> | null,
): boolean {
  if (!variacoesExternas) return false;
  return Object.values(variacoesExternas).some((v) =>
    v.variation_id != null
    && v.catalog_listing_id == null
    && statusRetentavel(v.catalog_status),
  );
}
