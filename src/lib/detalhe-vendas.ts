import type { Venda } from './faturamento';
import { ehFaturavel, ratearLiquidoPorFrete, impostoDoItem, type CustoResolver, type PesoResolver, type AliquotaResolver } from './resumo-vendas';
import { round2 } from './formato';

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
  /** Taxas do produto no período: comissão + frete + imposto (= valor − líquido + imposto). */
  taxas: Taxas;
  /** Custo total do produto no período (custo unitário × qtd). null = sem custo cadastrado. */
  custo: number | null;
  /** Markup ponderado do produto: (Σ líquido − Σ imposto − Σ custo) / Σ custo (ADR-0055). null = sem custo. */
  markup: number | null;
  /** Lucro do produto no período: Σ líquido − Σ imposto − Σ custo (ADR-0055). null = sem custo. */
  lucro: number | null;
}
/** Taxas do ML/fisco de um produto ou seção: soma + breakdown p/ o tooltip. */
export interface Taxas {
  /** comissão + frete + imposto. */
  total: number;
  /** Σ sale_fee × qtd (comissão do ML). */
  comissao: number;
  /** Frete pago pelo vendedor, resíduo: (valor − líquido) − comissão. */
  frete: number;
  /** Σ imposto por origem (ADR-0055). */
  imposto: number;
}

export interface SecaoVendas {
  linhas: LinhaVenda[];
  unidades: number;
  valor: number;
  pctTotal: number;
  /** Taxas consolidadas da seção (comissão + frete + imposto). */
  taxas: Taxas;
  /** Custo total consolidado da seção (Σ custo dos itens com custo). */
  custo: number;
  /** Lucro consolidado da seção (Σ líquido − Σ imposto − Σ custo dos itens com custo). */
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
  /** Comissão do ML acumulada (Σ sale_fee × qtd dos itens). */
  comissao: number;
  /** Imposto acumulado do produto no período (Σ imposto dos itens — ADR-0055). */
  imposto: number;
  /** Custo total acumulado (custo unitário × qtd) dos itens com custo. */
  custo: number;
  temCusto: boolean;
  titulo: string | null;
  codigo: string | null;
  ean: string | null;
  publiai: boolean;
}

/** Lucro/markup de um trio (líquido, imposto, custo): null quando não há custo (>0). Imposto reduz
 *  o líquido antes do markup/lucro, igual ao Faturamento/KPIs (ADR-0055). */
function lucroMarkup(liquido: number, imposto: number, custo: number, temCusto: boolean): { lucro: number | null; markup: number | null } {
  if (!temCusto || custo <= 0) return { lucro: null, markup: null };
  const liquidoComImposto = liquido - imposto;
  return { lucro: round2(liquidoComImposto - custo), markup: (liquidoComImposto - custo) / custo };
}

/** Taxas (comissão + frete + imposto) de um trio valor/líquido/comissão + imposto. O frete é o
 *  resíduo do retido (valor − líquido − comissão), mesma filosofia do `resumo-vendas.ts` (o retido
 *  do ML é comissão + frete), garantindo taxas.total = valor − líquido + imposto e, com o custo,
 *  valor − taxas − custo = lucro exibido. */
function taxasDe(valor: number, liquido: number, comissao: number, imposto: number): Taxas {
  const com = round2(comissao);
  const frete = round2(valor - liquido - com);
  const imp = round2(imposto);
  return { total: round2(com + frete + imp), comissao: com, frete, imposto: imp };
}

function secao(grupos: Grupo[], linhas: LinhaVenda[], total: number): SecaoVendas {
  const unidades = linhas.reduce((a, l) => a + l.unidades, 0);
  const valor = round2(linhas.reduce((a, l) => a + l.valor, 0));
  // Consolidado ponderado: soma líquido (já líquido de imposto) e custo só dos produtos com custo.
  let liqComCusto = 0;
  let custoTotal = 0;
  // Taxas da seção somam TODOS os produtos (independe de ter custo cadastrado).
  let liquidoTotal = 0;
  let comissaoTotal = 0;
  let impostoTotal = 0;
  for (const g of grupos) {
    liquidoTotal += g.liquido;
    comissaoTotal += g.comissao;
    impostoTotal += g.imposto;
    if (g.temCusto && g.custo > 0) { liqComCusto += g.liquido - g.imposto; custoTotal += g.custo; }
  }
  return {
    linhas,
    unidades,
    valor,
    pctTotal: total > 0 ? (valor / total) * 100 : 0,
    taxas: taxasDe(valor, liquidoTotal, comissaoTotal, impostoTotal),
    custo: round2(custoTotal),
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
 * produto o líquido, o imposto (ADR-0055) e o custo das vendas do período e calcula
 * `(Σ líquido − Σ imposto − Σ custo) / Σ custo` — o MESMO número dos KPIs de Publicados/Faturamento/
 * Financeiro (imposto descontado do líquido). O líquido por item reusa o rateio de frete de
 * pack (`ratearLiquidoPorFrete`, igual ao Faturamento), então um pack não infla um produto e zera
 * o outro. Sem custo cadastrado, markup/lucro ficam null (a UI mostra "—").
 */
export function montarDetalheVendas(
  vendas: Venda[], custoResolver?: CustoResolver, pesoResolver?: PesoResolver,
  aliquotaResolver?: AliquotaResolver,
): DetalheVendas {
  const rateio = ratearLiquidoPorFrete(vendas, pesoResolver);
  const liquidoPedido = (v: Venda) => rateio.get(v.id)?.liquido ?? v.liquido ?? 0;

  // Pool do líquido por PACK (pack_id ?? order_id), igual ao agruparPorPedido (menu Faturamento,
  // fonte da verdade). Num pack com um order_id por produto, ratear por linha dava à fita leve/barata
  // o líquido inteiro do seu order_id (quase sem frete, rateado por peso) e inflava o markup por
  // produto; poolar o líquido do pack e redistribuir por valor bruto alinha o markup entre as telas.
  const liquidoPorPack = new Map<string, number>();
  const valorItensPorPack = new Map<string, number>();
  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    const pk = String(v.pack_id ?? v.order_id);
    liquidoPorPack.set(pk, (liquidoPorPack.get(pk) ?? 0) + liquidoPedido(v));
    const valorV = v.itens.reduce((s, it) => s + it.unit_price * it.quantity, 0);
    valorItensPorPack.set(pk, (valorItensPorPack.get(pk) ?? 0) + valorV);
  }

  let total = 0;
  let pedidos = 0;
  const grupos = new Map<string, Grupo>();

  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    total += v.total_amount;
    pedidos += 1;
    const pk = String(v.pack_id ?? v.order_id);
    const liqPack = round2(liquidoPorPack.get(pk) ?? 0);
    const valorPack = valorItensPorPack.get(pk) ?? 0;
    for (const it of v.itens) {
      const key = it.ml_item_id ?? it.id;
      const g = grupos.get(key)
        ?? { unidades: 0, valor: 0, liquido: 0, comissao: 0, imposto: 0, custo: 0, temCusto: false, titulo: null, codigo: null, ean: null, publiai: it.is_publiai };
      const valorItem = it.unit_price * it.quantity;
      g.unidades += it.quantity;
      g.valor += valorItem;
      g.comissao += it.sale_fee * it.quantity;
      // Líquido do item = líquido do PACK inteiro rateado por valor bruto (igual a agruparPorPedido,
      // com o mesmo round2 por item para o markup por produto bater 1:1 com o Detalhe do pedido).
      g.liquido += valorPack > 0 ? round2((liqPack * valorItem) / valorPack) : 0;
      // Imposto por item (ADR-0055): reduz o líquido no markup/lucro, igual ao Faturamento/KPIs.
      g.imposto += impostoDoItem(it, aliquotaResolver);
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
    const { lucro, markup } = lucroMarkup(g.liquido, g.imposto, g.custo, g.temCusto);
    const linha: LinhaVenda = {
      id,
      titulo: g.titulo ?? id,
      // Itens fora do PubliAI não têm código/EAN do catálogo do app.
      codigo: g.publiai ? g.codigo : null,
      ean: g.publiai ? g.ean : null,
      unidades: g.unidades,
      valor: round2(g.valor),
      pctTotal: pct(g.valor),
      taxas: taxasDe(round2(g.valor), g.liquido, g.comissao, g.imposto),
      custo: g.temCusto && g.custo > 0 ? round2(g.custo) : null,
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
