import type { OfertaVendedor } from '../concorrencia/tipos.ts';
import { reputacaoVendedor } from '../ml/mercado.ts';

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

/** Busca reputação dos sellers distintos das ofertas (cache Redis 24h) e aplica pisoLiderDeOfertas. */
export async function calcularPisoLider(token: string, ofertas: OfertaVendedor[]): Promise<number | null> {
  const sellerIds = [...new Set(ofertas.map((o) => o.seller_id).filter((id): id is number => id != null))];
  const reps = await Promise.all(
    sellerIds.map((id) => reputacaoVendedor(token, id).catch(() => ({ lider: false, vendas: 0 }))),
  );
  const lideres = new Set(sellerIds.filter((_, i) => reps[i].lider));
  return pisoLiderDeOfertas(ofertas, (id) => lideres.has(id));
}
