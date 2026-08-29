// Ponte Sonar Apify → amostra por vendedor (ADR-0142). Função pura — sem I/O.

import type { AnuncioAmostra } from '../pulse/nicho-vendedor.ts';
import type { ItemVendas } from '../pulse/sonar-vendas.ts';

export function anunciosDaAmostra(
  itens: ItemVendas[],
  sellerPorItem?: Map<string, number>,
): { anuncios: AnuncioAmostra[]; semSellerId: number } {
  const anuncios: AnuncioAmostra[] = [];
  let semSellerId = 0;

  for (const item of itens) {
    if (!item.item_id) continue;
    const sellerId = item.seller_id ?? sellerPorItem?.get(item.item_id) ?? null;
    if (sellerId == null) {
      semSellerId += 1;
      continue;
    }
    anuncios.push({
      item_id: item.item_id,
      seller_id: sellerId,
      preco: item.preco,
      vendidos: item.vendidos,
    });
  }

  return { anuncios, semSellerId };
}
