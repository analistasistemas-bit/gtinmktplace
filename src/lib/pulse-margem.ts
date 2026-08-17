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
 * Comissão do ML para um preço, a partir da estrutura lida na coleta. `null` sem a estrutura —
 * comissão nunca é estimada por regra de três a partir de um valor pronto de outro preço, que foi
 * exatamente o defeito da Errata 6.
 */
export function comissaoNoPreco(
  preco: number,
  comissao: { pct: number | null; fixa: number | null } | null,
): number | null {
  if (comissao?.pct == null) return null;
  return (preco * comissao.pct) / 100 + (comissao.fixa ?? 0);
}

/**
 * Margem líquida estimada: comissão do ML no preço + frete + imposto por origem + custo do
 * produto. QUALQUER insumo ausente → null (regra LOUD: margem nunca é exibida com dado assumido).
 *
 * A comissão vem da estrutura (percentual + fixo) lida para o preço praticado, não do valor
 * pronto de `ptw_custos` — aquele é calculado sobre o preço SUGERIDO pelo ML e superestimava a
 * sobra em todo anúncio acima da sugestão.
 */
export function margemEstimada(args: {
  preco: number; custoProduto: number | null;
  comissao: { pct: number | null; fixa: number | null } | null;
  frete: number | null;
  aliquotaPct: number | null;
}): { liquido: number; margemPct: number; comissao: number } | null {
  const { preco, custoProduto, frete, aliquotaPct } = args;
  const comissao = comissaoNoPreco(preco, args.comissao);
  if (custoProduto == null || comissao == null || frete == null || aliquotaPct == null) return null;
  const liquido = preco - comissao - frete - (preco * aliquotaPct) / 100 - custoProduto;
  const margemPct = (liquido / preco) * 100;
  return { liquido, margemPct, comissao };
}
