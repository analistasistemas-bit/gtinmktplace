import type { AnuncioCanonico } from '../canais/contrato.ts';

/**
 * Corpo de `POST /api/v2/product/add_item` (Fatia 1: 1 variação simples).
 * Função PURA — não faz I/O. As variações múltiplas (`tier_variation`/`model`)
 * são a Fatia 2.
 *
 * Conversões/decisões da Fatia 1:
 * - `weight` em kg: a Shopee usa quilos; nosso canônico tem `peso_gramas` → /1000.
 * - `description` embutida (capability `descricaoSeparada:false`): a descrição
 *   vai dentro do add_item, não há recurso separado.
 * - `item_sku` = sku da variação (nosso `codigo`).
 * - `image.image_id_list` = ids já subidos (capa + comuns + foto da variação).
 * - `logistic_info`: placeholder `[]` na Fatia 1; depende de `get_channel_list`
 *   (canais de envio habilitados na loja). O worker preencherá antes do envio
 *   real. TODO Fatia 1+: popular com os logistic_ids ativos.
 */
export interface PayloadAddItemShopee {
  category_id: number;
  item_name: string;
  description: string;
  original_price: number;
  normal_stock: number;
  seller_stock: Array<{ stock: number }>;
  weight: number;
  dimension: { package_length: number; package_width: number; package_height: number };
  image: { image_id_list: string[] };
  item_sku: string;
  logistic_info: Array<{ logistic_id: number; enabled: boolean }>;
}

function gramasParaKg(peso_gramas: number | null): number {
  return (peso_gramas ?? 0) / 1000;
}

export function montarPayloadAddItem(a: AnuncioCanonico, _shopId?: string): PayloadAddItemShopee {
  const variacao = a.variacoes[0];
  if (!variacao) throw new Error('montarPayloadAddItem: AnuncioCanonico sem variação');

  const d = a.dimensoes;
  const imageIds = [a.capaFotoId, a.capa2FotoId, a.capa3FotoId, variacao.fotoId]
    .filter((x): x is string => !!x);

  const preco = variacao.preco ?? 0;

  return {
    category_id: Number(a.categoriaId ?? 0),
    item_name: a.titulo ?? '',
    description: a.descricao ?? '',
    original_price: preco,
    normal_stock: variacao.estoque,
    seller_stock: [{ stock: variacao.estoque }],
    weight: gramasParaKg(d?.peso_gramas ?? null),
    dimension: {
      package_length: d?.comprimento_cm ?? 0,
      package_width: d?.largura_cm ?? 0,
      package_height: d?.altura_cm ?? 0,
    },
    image: { image_id_list: imageIds },
    item_sku: variacao.sku,
    // Fatia 1: placeholder. Preenchido a partir de get_channel_list antes do envio real.
    logistic_info: [],
  };
}
