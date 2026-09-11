// Mantido em sync com src/lib/catalogo-retentavel.ts (Deno/Vite split).

/**
 * Estados de catálogo que o operador pode mandar reavaliar pelo botão ↻ (retentar-catalogo).
 *
 * `sem_produto` e `pendente` entraram em 2026-09-11. Os dois são transitórios e estavam de fora,
 * o que os tornava terminais na prática:
 *  - `sem_produto` = o ML LIBERA o opt-in (`podeTentarOptin`), mas a busca da ficha por GTIN veio
 *    vazia. A ficha pode nascer a qualquer momento — foi o caso do Centrum (DSA), preso desde
 *    12/08 enquanto o par dono↔catálogo já existia no ML; só saiu dali por SQL manual.
 *  - `pendente` = o ML ainda não terminou de computar a elegibilidade. O worker já reagenda
 *    sozinho, mas desiste após 5 rodadas e finaliza "como está", sem caminho de volta pela UI.
 *
 * `ficha_divergente` fica de fora por escopo, não por risco: retentar NÃO burla a trava de
 * equivalência do ADR-0021 — o worker rebusca a ficha e reroda `fichaEquivalente` antes de
 * qualquer POST, então só vincularia se a ficha (ou o nosso item) tivesse mudado e agora passasse.
 * Incluí-lo é seguro por construção; só não é a classe de problema medida aqui.
 */
export const STATUS_CATALOGO_RETENTAVEL = ['erro', 'nao_elegivel', 'sem_produto', 'pendente'] as const;
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
