// Líquido das vendas liberadas no dia, para o aviso de `notificar-liberacao`. Pura.
import { ratearLiquidoPorFrete } from '../platform-admin/sales-summary.ts';
import type { Venda } from '../platform-admin/sales-types.ts';

export type VendaLiberacao = Pick<Venda,
  'id' | 'status' | 'shipping_id' | 'pack_id' | 'frete_vendedor' | 'sale_fee_total' | 'total_amount'
  | 'cupom_vendedor' | 'liquido'>;

/**
 * venda.id → líquido de cada venda liberada. O `liquido` gravado traz o frete INTEIRO do envio em
 * cada order do pack; somá-lo cobrava o frete N vezes (pack de 2 orders: R$ 75,86 em vez de 94,16).
 * O frete é rateado como no Financeiro (`ratearLiquidoPorFrete`), entre TODOS os membros do envio —
 * por isso `membros` inclui as orders que liberam em outro dia. Sem `pesoResolver` o rateio é por
 * valor; o Financeiro rateia por peso quando há peso. A soma do pack é a mesma; só a fatia de cada
 * order muda quando o pack libera em dias diferentes (raro).
 */
export function liquidoDasLiberadas(liberadas: VendaLiberacao[], membros: VendaLiberacao[]): Map<string, number> {
  const porId = new Map<string, VendaLiberacao>();
  for (const v of [...membros, ...liberadas]) porId.set(v.id, v);
  const rateio = ratearLiquidoPorFrete([...porId.values()].map((v) => ({ ...v, itens: [] }) as unknown as Venda));
  return new Map(liberadas.map((v) => [v.id, rateio.get(v.id)?.liquido ?? v.liquido ?? 0]));
}
