// Pulse (ADR-0119): derivações puras sobre snapshots de ofertas/vendedores. Sem I/O — testável
// sem mock de rede/Supabase.
import type { PulseOferta, PulseVendedor } from './pulse';

/** Última linha por item (a mais recente por `dia`), só as ativas, ordenada por preço asc. */
export function estadoAtualOfertas(ofertas: PulseOferta[]): PulseOferta[] {
  const ultimaPorItem = new Map<string, PulseOferta>();
  for (const o of ofertas) {
    const atual = ultimaPorItem.get(o.item_id);
    if (!atual || o.dia > atual.dia) ultimaPorItem.set(o.item_id, o);
  }
  return [...ultimaPorItem.values()]
    .filter((o) => o.ativo)
    .sort((a, b) => a.preco - b.preco);
}

/** Menor preço entre as ofertas ativas de cada dia, em ordem cronológica. */
export function menorPrecoPorDia(ofertas: PulseOferta[]): { dia: string; preco: number }[] {
  const menorPorDia = new Map<string, number>();
  for (const o of ofertas) {
    if (!o.ativo) continue;
    const atual = menorPorDia.get(o.dia);
    if (atual == null || o.preco < atual) menorPorDia.set(o.dia, o.preco);
  }
  return [...menorPorDia.entries()]
    .map(([dia, preco]) => ({ dia, preco }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Delta de `transactions_total` entre a 1ª e a última leitura — proxy de vendas do VENDEDOR
 *  inteiro (não do anúncio; ver Fatos empíricos do plano). Precisa de pelo menos 2 pontos. */
export function vendasEstimadasVendedor(hist: PulseVendedor[]): number | null {
  if (hist.length < 2) return null;
  const ordenado = [...hist].sort((a, b) => a.dia.localeCompare(b.dia));
  const primeiro = ordenado[0].transactions_total;
  const ultimo = ordenado[ordenado.length - 1].transactions_total;
  if (primeiro == null || ultimo == null) return null;
  return ultimo - primeiro;
}

/**
 * Margem líquida estimada usando os custos do price-to-win do ML (comissão e frete em R$) +
 * imposto por origem + custo do produto. QUALQUER insumo ausente → null (regra LOUD: margem
 * nunca é exibida com dado assumido).
 */
export function margemEstimada(args: {
  preco: number; custoProduto: number | null;
  ptwCustos: { comissao: number | null; frete: number | null } | null;
  aliquotaPct: number | null;
}): { liquido: number; margemPct: number } | null {
  const { preco, custoProduto, ptwCustos, aliquotaPct } = args;
  if (custoProduto == null || ptwCustos?.comissao == null || ptwCustos?.frete == null || aliquotaPct == null) {
    return null;
  }
  const liquido = preco - ptwCustos.comissao - ptwCustos.frete - (preco * aliquotaPct) / 100 - custoProduto;
  const margemPct = (liquido / preco) * 100;
  return { liquido, margemPct };
}
