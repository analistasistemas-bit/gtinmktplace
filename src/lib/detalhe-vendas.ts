import type { Venda } from './faturamento';
import { ehFaturavel, ratearLiquidoPorFrete, type CustoResolver, type PesoResolver } from './resumo-vendas';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LinhaVenda {
  id: string;
  titulo: string;
  /** Código do produto (codigo do item). null para itens fora do PubliAI. */
  codigo: string | null;
  /** EAN/GTIN do item. null para itens fora do PubliAI. */
  ean: string | null;
  unidades: number;
  valor: number;
  pctTotal: number;
  /** Markup ponderado do produto no período: (Σ líquido − Σ custo) / Σ custo. null = sem custo. */
  markup: number | null;
  /** Lucro do produto no período: Σ líquido − Σ custo. null = sem custo. */
  lucro: number | null;
}
export interface SecaoVendas {
  linhas: LinhaVenda[];
  unidades: number;
  valor: number;
  pctTotal: number;
  /** Lucro consolidado da seção (Σ líquido − Σ custo dos itens com custo). */
  lucro: number;
  /** Markup ponderado da seção. null = nenhum item com custo. */
  markup: number | null;
}
export interface DetalheVendas { total: number; pedidos: number; app: SecaoVendas; externo: SecaoVendas }

interface Grupo {
  unidades: number;
  valor: number;
  /** Líquido atribuído ao produto (rateado por item, igual ao Faturamento). */
  liquido: number;
  /** Custo total acumulado (custo unitário × qtd) dos itens com custo. */
  custo: number;
  temCusto: boolean;
  titulo: string | null;
  codigo: string | null;
  ean: string | null;
  publiai: boolean;
}

/** Lucro/markup de um par (líquido, custo): null quando não há custo (>0). */
function lucroMarkup(liquido: number, custo: number, temCusto: boolean): { lucro: number | null; markup: number | null } {
  if (!temCusto || custo <= 0) return { lucro: null, markup: null };
  return { lucro: round2(liquido - custo), markup: (liquido - custo) / custo };
}

function secao(grupos: Grupo[], linhas: LinhaVenda[], total: number): SecaoVendas {
  const unidades = linhas.reduce((a, l) => a + l.unidades, 0);
  const valor = round2(linhas.reduce((a, l) => a + l.valor, 0));
  // Consolidado ponderado: soma líquido e custo só dos produtos com custo.
  let liqComCusto = 0;
  let custoTotal = 0;
  for (const g of grupos) {
    if (g.temCusto && g.custo > 0) { liqComCusto += g.liquido; custoTotal += g.custo; }
  }
  return {
    linhas,
    unidades,
    valor,
    pctTotal: total > 0 ? (valor / total) * 100 : 0,
    lucro: custoTotal > 0 ? round2(liqComCusto - custoTotal) : 0,
    markup: custoTotal > 0 ? (liqComCusto - custoTotal) / custoTotal : null,
  };
}

/**
 * Compõe o detalhe do faturamento a partir das vendas de `ml_vendas` (fonte única — ADR-0038), a
 * MESMA que alimenta o card de Faturamento (calcularResumo). Agrupa os itens por anúncio
 * (ml_item_id) e separa anúncios do app (is_publiai) dos externos. `total`/`pedidos` consideram só
 * vendas faturáveis (paid/partially_refunded/refunded).
 *
 * Markup/lucro por produto (média ponderada): quando `custoResolver` é informado, acumula por
 * produto o líquido e o custo das vendas do período e calcula `(Σ líquido − Σ custo) / Σ custo` —
 * o mesmo número do consolidado da tela Publicados. O líquido por item reusa o rateio de frete de
 * pack (`ratearLiquidoPorFrete`, igual ao Faturamento), então um pack não infla um produto e zera
 * o outro. Sem custo cadastrado, markup/lucro ficam null (a UI mostra "—").
 */
export function montarDetalheVendas(
  vendas: Venda[], custoResolver?: CustoResolver, pesoResolver?: PesoResolver,
): DetalheVendas {
  const rateio = ratearLiquidoPorFrete(vendas, pesoResolver);
  const liquidoPedido = (v: Venda) => rateio.get(v.id)?.liquido ?? v.liquido ?? 0;

  let total = 0;
  let pedidos = 0;
  const grupos = new Map<string, Grupo>();

  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    total += v.total_amount;
    pedidos += 1;
    const liqPedido = liquidoPedido(v);
    const valorItens = v.itens.reduce((s, it) => s + it.unit_price * it.quantity, 0);
    for (const it of v.itens) {
      const key = it.ml_item_id ?? it.id;
      const g = grupos.get(key)
        ?? { unidades: 0, valor: 0, liquido: 0, custo: 0, temCusto: false, titulo: null, codigo: null, ean: null, publiai: it.is_publiai };
      const valorItem = it.unit_price * it.quantity;
      g.unidades += it.quantity;
      g.valor += valorItem;
      // Rateio do líquido do pedido pelo valor bruto do item (igual a agruparPorPedido).
      g.liquido += valorItens > 0 ? (liqPedido * valorItem) / valorItens : 0;
      const custoUnit = custoResolver?.(it) ?? null;
      if (custoUnit != null && custoUnit > 0) { g.custo += custoUnit * it.quantity; g.temCusto = true; }
      g.titulo ??= it.titulo;
      g.codigo ??= it.codigo;
      g.ean ??= it.ean;
      grupos.set(key, g);
    }
  }
  total = round2(total);

  const pct = (valor: number) => (total > 0 ? (valor / total) * 100 : 0);
  const appG: Grupo[] = [];
  const externoG: Grupo[] = [];
  const app: LinhaVenda[] = [];
  const externo: LinhaVenda[] = [];
  for (const [id, g] of grupos) {
    const { lucro, markup } = lucroMarkup(g.liquido, g.custo, g.temCusto);
    const linha: LinhaVenda = {
      id,
      titulo: g.titulo ?? id,
      // Itens fora do PubliAI não têm código/EAN do catálogo do app.
      codigo: g.publiai ? g.codigo : null,
      ean: g.publiai ? g.ean : null,
      unidades: g.unidades,
      valor: round2(g.valor),
      pctTotal: pct(g.valor),
      markup,
      lucro,
    };
    if (g.publiai) { app.push(linha); appG.push(g); }
    else { externo.push(linha); externoG.push(g); }
  }
  app.sort((a, b) => b.valor - a.valor);
  externo.sort((a, b) => b.valor - a.valor);

  return { total, pedidos, app: secao(appG, app, total), externo: secao(externoG, externo, total) };
}
