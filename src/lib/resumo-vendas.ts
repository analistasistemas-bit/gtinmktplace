// Agregador único dos KPIs de venda (ADR-0038). Fonte: linhas de `ml_vendas` (+ itens) lidas por
// `buscarVendas`. Os três menus — Publicados, Faturamento e Financeiro — derivam seus KPIs daqui,
// então mostram exatamente o mesmo número para o mesmo período. Pura e testável (sem rede).
import type { Venda, VendaItem } from './faturamento';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Status que contam como venda faturável (entram no bruto/líquido/unidades/pedidos), espelhando o
 * "Vendas brutas" da tela de Métricas do ML: pagas E reembolsadas. `cancelled` fica de fora.
 * O reembolso continua segregado no campo `estornos`.
 */
export const STATUS_FATURAVEL = new Set(['paid', 'partially_refunded', 'refunded']);

/** Uma venda é faturável (entra nos KPIs monetários)? */
export const ehFaturavel = (status: string | null | undefined): boolean =>
  STATUS_FATURAVEL.has(status ?? '');

/** Resolve o custo unitário (R$) de um item vendido, ou null se não houver custo cadastrado. */
export type CustoResolver = (item: VendaItem) => number | null;

/** Uma venda resumida para a tabela do detalhe financeiro (e afins). */
export interface VendaResumo {
  id: string;
  orderId: number;
  /** date_closed ?? date_created. */
  data: string | null;
  /** money_release_date — data de liberação do recebimento (null = MP não informou). */
  dataLiberacao: string | null;
  descricao: string | null;
  codigo: string | null;
  bruto: number;
  liquido: number;
  /** bruto − líquido: taxas do ML/MP + frete retido. */
  retido: number;
  estorno: number;
  /** Custo total do produto na venda (custo unitário × qtd), em R$. null = sem custo/não mapeada. */
  custo: number | null;
}

export interface ResumoVendas {
  /** Faturamento bruto das vendas faturáveis no período. */
  bruto: number;
  /** Líquido recebido (soma de ml_vendas.liquido). */
  liquido: number;
  /** bruto − líquido: taxas do ML/MP + frete retido. */
  descontos: number;
  /** Total estornado no período. */
  estornos: number;
  /** Quantidade de vendas (pedidos faturáveis). */
  pedidos: number;
  /** Unidades vendidas (soma das quantidades dos itens). */
  unidades: number;
  /** Ticket médio (bruto ÷ pedidos). */
  ticket: number;
  /** Markup do período: (líquido − custo) ÷ custo, só sobre vendas com custo. null = sem custo. */
  markup: number | null;
  /** Lucro do período (líquido − custo) das vendas com custo. */
  lucro: number;
  /** ml_item_id → vendas do período (anúncios), p/ rankings da tela Publicados. */
  porItem: Record<string, { unidades: number; valor: number }>;
  /** Detalhe por venda, da mais recente para a mais antiga. */
  vendas: VendaResumo[];
}

/** Custo total (R$) de uma venda: soma custoUnit × qtd dos itens com custo. null se nenhum tem. */
function custoDaVenda(v: Venda, resolver?: CustoResolver): number | null {
  if (!resolver) return null;
  let total = 0;
  let achou = false;
  for (const it of v.itens) {
    const unit = resolver(it);
    if (unit != null && unit > 0) { total += unit * it.quantity; achou = true; }
  }
  return achou ? round2(total) : null;
}

/** Descrição curta da venda: título (1 item) ou "N itens". */
function descricaoVenda(v: Venda): string | null {
  if (v.itens.length === 1) return v.itens[0].titulo ?? null;
  if (v.itens.length === 0) return null;
  return `${v.itens.length} itens`;
}

/**
 * Agrega as vendas faturáveis do período num resumo único. `vendas` são as linhas de ml_vendas da
 * janela (a quebra por status de envio, que conta TODOS, fica em `calcularKpis`). O frete inflado
 * em packs (mesmo valor de envio repetido em cada pedido) NÃO afeta estes KPIs: o líquido vem do
 * net do MP por pedido, então `descontos = bruto − líquido` já é correto (ADR-0038).
 */
export function calcularResumo(vendas: Venda[], custoResolver?: CustoResolver): ResumoVendas {
  let bruto = 0, liquido = 0, estornos = 0, unidades = 0, pedidos = 0;
  let liqComCusto = 0, custoTotal = 0;
  const porItem: Record<string, { unidades: number; valor: number }> = {};
  const vendasResumo: VendaResumo[] = [];

  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    const liq = v.liquido ?? 0;
    const est = v.estorno ?? 0;
    bruto += v.total_amount;
    liquido += liq;
    estornos += est;
    pedidos += 1;

    for (const it of v.itens) {
      unidades += it.quantity;
      if (it.ml_item_id) {
        const acc = porItem[it.ml_item_id] ?? { unidades: 0, valor: 0 };
        acc.unidades += it.quantity;
        acc.valor += it.unit_price * it.quantity;
        porItem[it.ml_item_id] = acc;
      }
    }

    const custo = custoDaVenda(v, custoResolver);
    if (custo != null && custo > 0) { liqComCusto += liq; custoTotal += custo; }

    vendasResumo.push({
      id: v.id,
      orderId: v.order_id,
      data: v.date_closed ?? v.date_created,
      dataLiberacao: v.money_release_date,
      descricao: descricaoVenda(v),
      codigo: v.itens.find((i) => i.codigo)?.codigo ?? null,
      bruto: round2(v.total_amount),
      liquido: round2(liq),
      retido: round2(v.total_amount - liq),
      estorno: round2(est),
      custo,
    });
  }

  for (const id of Object.keys(porItem)) porItem[id].valor = round2(porItem[id].valor);
  vendasResumo.sort((a, b) => Date.parse(b.data ?? '') - Date.parse(a.data ?? ''));

  return {
    bruto: round2(bruto),
    liquido: round2(liquido),
    descontos: round2(bruto - liquido),
    estornos: round2(estornos),
    pedidos,
    unidades,
    ticket: pedidos > 0 ? round2(bruto / pedidos) : 0,
    markup: custoTotal > 0 ? (liqComCusto - custoTotal) / custoTotal : null,
    lucro: round2(liqComCusto - custoTotal),
    porItem,
    vendas: vendasResumo,
  };
}

/**
 * Frete do vendedor rateado por pedido. O webhook grava o frete do envio inteiro em cada pedido do
 * mesmo pack (shipping_id), inflando a soma; aqui dividimos o frete do envio igualmente entre os
 * pedidos do grupo para exibição (zero-soma). Pedido sem pack fica com o próprio frete.
 * Retorna mapa order_id → frete rateado (R$). Só para o detalhe; não afeta líquido/descontos.
 */
export function fretePorPedidoRateado(vendas: Venda[]): Map<number, number> {
  const grupos = new Map<number, Venda[]>();
  const soltos: Venda[] = [];
  for (const v of vendas) {
    const sid = v.shipping_id ?? v.pack_id;
    if (sid == null) { soltos.push(v); continue; }
    const g = grupos.get(sid);
    if (g) g.push(v); else grupos.set(sid, [v]);
  }
  const out = new Map<number, number>();
  for (const v of soltos) out.set(v.order_id, v.frete_vendedor ?? 0);
  for (const membros of grupos.values()) {
    // O frete do envio é o mesmo repetido em cada pedido do pack → conta uma vez e divide igual.
    const freteEnvio = Math.max(0, ...membros.map((m) => m.frete_vendedor ?? 0));
    const rateado = round2(freteEnvio / membros.length);
    for (const m of membros) out.set(m.order_id, rateado);
  }
  return out;
}
