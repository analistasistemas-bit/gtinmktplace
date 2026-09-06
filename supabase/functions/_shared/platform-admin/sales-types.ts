export interface VendaItem {
  id: string;
  ml_item_id: string | null;
  variation_id: number | null;
  titulo: string | null;
  codigo: string | null;
  cor: string | null;
  ean: string | null;
  quantity: number;
  unit_price: number;
  sale_fee: number;
  is_publiai: boolean;
  custo_congelado?: number | null;
}

export interface Venda {
  id: string;
  org_id?: string;
  order_id: number;
  pack_id: number | null;
  status: string;
  status_detail: string | null;
  date_closed: string | null;
  date_created: string | null;
  comprador_nick: string | null;
  comprador_nome: string | null;
  comprador_id: number | null;
  uf: string | null;
  cidade: string | null;
  total_amount: number;
  paid_amount: number | null;
  liquido: number | null;
  sale_fee_total: number | null;
  frete_vendedor: number | null;
  estorno: number | null;
  money_release_date: string | null;
  sacado_em: string | null;
  sacado_por: string | null;
  atualizado_em: string;
  currency: string;
  shipping_id: number | null;
  shipping_status: string | null;
  shipping_substatus: string | null;
  shipping_logistic: string | null;
  tracking_number: string | null;
  is_publiai: boolean;
  tem_devolucao: boolean;
  /** ADR-0154 D-10: item_id do Kit Virtual (lido de `bundle.parent_item`). Só marca a linha com
   *  um badge — as orders NÃO são agrupadas e nenhum cálculo financeiro usa este campo. */
  kit_item_id?: string | null;
  itens: VendaItem[];
  canal?: string;
}

export type OrigemVenda = 'todos' | 'publiai' | 'fora';
export interface CustoCongeladoRow { ml_item_id: string | null; variation_id: number | null; custo_unitario: unknown }

const chaveCusto = (mlItemId: string | null, variationId: number | null) => `${mlItemId}|${variationId}`;

export function comCustoCongelado(venda: Venda & { custos?: CustoCongeladoRow[] | null }): VendaItem[] {
  const porChave = new Map<string, number>();
  for (const custo of venda.custos ?? []) {
    const valor = Number(custo.custo_unitario);
    if (Number.isFinite(valor) && valor > 0) {
      porChave.set(chaveCusto(custo.ml_item_id, custo.variation_id), valor);
    }
  }
  return (venda.itens ?? []).map((item) => ({
    ...item,
    custo_congelado: porChave.get(chaveCusto(item.ml_item_id, item.variation_id)) ?? null,
  }));
}

export type CustoResolver = (item: VendaItem) => number | null;
export type PesoResolver = (item: VendaItem) => number | null;
export type AliquotaResolver = (item: VendaItem, uf: string | null) => number | null;
