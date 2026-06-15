import type { StatusCanal, StatusAnuncioCanal } from '../canais/contrato.ts';

// Entrada normalizada do get_item_base_info (Fatia 1). estoque/preço já achatados
// pelo cliente (na Shopee vêm em stock_info/price_info por model; aqui aceitamos o
// valor agregado opcional). item_status: NORMAL/UNLIST/BANNED/REVIEWING/SELLER_DELETE/SHOPEE_DELETE.
export interface ItemShopeeStatus {
  item_id?: number;
  item_status?: string;
  normalized_stock?: number;
  current_price?: number;
}

const MAP: Record<string, StatusAnuncioCanal> = {
  NORMAL: 'ativo',
  UNLIST: 'pausado',
  REVIEWING: 'moderado',
  BANNED: 'moderado',
  SELLER_DELETE: 'encerrado',
  SHOPEE_DELETE: 'encerrado',
};

export function parseStatusShopee(item: ItemShopeeStatus | null): StatusCanal {
  if (!item || !item.item_status) {
    return { status: 'indisponivel', motivo: null, estoque: null, preco: null };
  }
  const status = MAP[item.item_status] ?? 'indisponivel';
  const motivo = (item.item_status === 'BANNED' || item.item_status === 'REVIEWING')
    ? item.item_status.toLowerCase()
    : null;
  return {
    status,
    motivo,
    estoque: item.normalized_stock ?? null,
    preco: item.current_price ?? null,
  };
}
