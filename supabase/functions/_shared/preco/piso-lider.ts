import type { OfertaVendedor } from '../concorrencia/tipos.ts';

/** Menor preço entre ofertas de vendedores MercadoLíder. Null se nenhuma oferta-líder válida. */
export function pisoLiderDeOfertas(
  ofertas: OfertaVendedor[],
  ehLider: (sellerId: number) => boolean,
): number | null {
  const precos = ofertas
    .filter((o): o is { seller_id: number; preco: number } => o.seller_id != null && o.preco != null && ehLider(o.seller_id))
    .map((o) => o.preco);
  return precos.length > 0 ? Math.min(...precos) : null;
}
