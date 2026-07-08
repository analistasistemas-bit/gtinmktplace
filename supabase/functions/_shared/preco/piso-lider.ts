import type { OfertaVendedor } from '../concorrencia/tipos.ts';
import { reputacaoVendedor } from '../ml/mercado.ts';

export interface ReputacaoSeller {
  lider: boolean;
  vendas: number;
}

/**
 * Preço do concorrente MercadoLíder com MAIS VENDAS entre as ofertas (lote #28 → correção
 * pós-teste ao vivo: antes usava o MENOR preço entre líderes, mas isso podia escolher um
 * líder pequeno em vez do concorrente estabelecido que o operador quer copiar).
 * Empate de vendas → desempata pelo menor preço entre os empatados.
 * Vendedor com ofertas em mais de uma cor (preços diferentes) → usa o MENOR preço DELE.
 * Null se nenhuma oferta-líder válida (seller_id/preco não-nulos).
 */
export function precoLiderMaisVendas(
  ofertas: OfertaVendedor[],
  reputacao: (sellerId: number) => ReputacaoSeller | undefined,
): number | null {
  const menorPrecoPorSeller = new Map<number, number>();
  for (const o of ofertas) {
    if (o.seller_id == null || o.preco == null) continue;
    const rep = reputacao(o.seller_id);
    if (!rep || rep.lider !== true) continue;
    const atual = menorPrecoPorSeller.get(o.seller_id);
    if (atual == null || o.preco < atual) menorPrecoPorSeller.set(o.seller_id, o.preco);
  }

  let melhorSellerId: number | null = null;
  let melhorVendas = -1;
  let melhorPreco = Infinity;
  for (const [sellerId, preco] of menorPrecoPorSeller) {
    const vendas = reputacao(sellerId)!.vendas;
    if (
      melhorSellerId == null ||
      vendas > melhorVendas ||
      (vendas === melhorVendas && preco < melhorPreco)
    ) {
      melhorSellerId = sellerId;
      melhorVendas = vendas;
      melhorPreco = preco;
    }
  }
  return melhorSellerId == null ? null : melhorPreco;
}

/** Busca reputação dos sellers distintos das ofertas (cache Redis 24h) e aplica precoLiderMaisVendas. */
export async function calcularPrecoLiderMaisVendas(token: string, ofertas: OfertaVendedor[]): Promise<number | null> {
  const sellerIds = [...new Set(ofertas.map((o) => o.seller_id).filter((id): id is number => id != null))];
  const reps = await Promise.all(
    sellerIds.map((id) => reputacaoVendedor(token, id).catch(() => ({ lider: false, vendas: 0 }))),
  );
  const reputacoes = new Map<number, ReputacaoSeller>(sellerIds.map((id, i) => [id, reps[i]]));
  return precoLiderMaisVendas(ofertas, (id) => reputacoes.get(id));
}
