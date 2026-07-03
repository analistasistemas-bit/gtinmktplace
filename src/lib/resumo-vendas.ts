// Agregador único dos KPIs de venda (ADR-0038). Fonte: linhas de `ml_vendas` (+ itens) lidas por
// `buscarVendas`. Os três menus — Publicados, Faturamento e Financeiro — derivam seus KPIs daqui,
// então mostram exatamente o mesmo número para o mesmo período. Pura e testável (sem rede).
import type { Venda, VendaItem } from './faturamento';
import { round2 } from './formato';

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

/** Resolve o peso unitário (g) de um item vendido, ou null se não houver peso cadastrado. */
export type PesoResolver = (item: VendaItem) => number | null;

/** Resolve a alíquota de imposto (%) de um item pela origem da família, ou null se não mapeada. */
export type AliquotaResolver = (item: VendaItem) => number | null;

/** Uma venda resumida para a tabela do detalhe financeiro (e afins). */
export interface VendaResumo {
id: string;
orderId: number;
pedidoChave: string;
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
  /** Quantidade de pedidos faturáveis (packs distintos: pack_id ?? order_id; ADR-0039). */
  pedidos: number;
  /** Unidades vendidas (soma das quantidades dos itens). */
  unidades: number;
  /** Ticket médio (bruto ÷ pedidos). */
  ticket: number;
  /** Markup do período: (líquido − imposto − custo) ÷ custo, só sobre vendas com custo. null = sem custo. */
  markup: number | null;
  /** Lucro do período (líquido − imposto − custo) das vendas com custo. */
  lucro: number;
  /** Σ líquido das vendas já liberadas (money_release_date no passado). */
  liberado: number;
  /** Σ líquido das vendas ainda a liberar (money_release_date no futuro). */
  aLiberar: number;
  /** Menor money_release_date futuro (ISO), ou null se nada a liberar. */
  proximaLiberacao: string | null;
  /** Σ comissão do ML (sale_fee_total) das faturáveis. */
  comissao: number;
  /** Frete efetivo pago pelo vendedor = descontos − comissão (residual do retido). NÃO é a soma de
   *  frete_vendedor (que duplica em pack e é o bruto da etiqueta). comissão + frete == descontos. */
  frete: number;
  /** Σ imposto por origem (ADR-0055) das faturáveis. Reduz lucro/markup/margem, não o líquido do ML. */
  imposto: number;
  /** Nº de vendas faturáveis com custo cadastrado (base do lucro/markup/margem). */
  vendasComCusto: number;
  /** Nº de pedidos faturáveis no período (= pedidos/packs), para a nota de cobertura. */
  totalVendas: number;
  /** Margem sobre a receita líquida: lucro ÷ líquido (com custo). null = sem custo. */
  margem: number | null;
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

/** Imposto (R$) de um item (ADR-0055): valor de venda (unit × qtd) × alíquota(origem)/100. 0 sem alíquota. */
export function impostoDoItem(it: VendaItem, resolver?: AliquotaResolver): number {
  const pct = resolver?.(it) ?? null;
  return pct != null && pct > 0 ? round2((it.unit_price * it.quantity * pct) / 100) : 0;
}

/** Imposto total (R$) de uma venda: soma do imposto dos itens. */
function impostoDaVenda(v: Venda, resolver?: AliquotaResolver): number {
  let total = 0;
  for (const it of v.itens) total += impostoDoItem(it, resolver);
  return round2(total);
}

/** Descrição curta da venda: título (1 item) ou "N itens". */
function descricaoVenda(v: Venda): string | null {
  if (v.itens.length === 1) return v.itens[0].titulo ?? null;
  if (v.itens.length === 0) return null;
  return `${v.itens.length} itens`;
}

/**
 * Agrega as vendas faturáveis do período num resumo único. `vendas` são as linhas de ml_vendas da
 * janela (a quebra por status de envio, que conta TODOS, fica em `calcularKpis`).
 *
 * Frete de pack: quando vários pedidos compartilham um envio (mesmo shipping_id), o frete do envio
 * é gravado repetido em cada pedido. `ratearLiquidoPorFrete` distribui esse frete por peso entre os
 * pedidos do grupo e compõe o líquido econômico de cada um (`bruto − comissão − frete atribuído`),
 * corrigindo o markup por produto sem depender do net do MP (ADR-0042).
 */
export function calcularResumo(
  vendas: Venda[], custoResolver?: CustoResolver, pesoResolver?: PesoResolver,
  agoraMs: number = Date.now(), aliquotaResolver?: AliquotaResolver,
): ResumoVendas {
  const liqRateado = ratearLiquidoPorFrete(vendas, pesoResolver);
  let bruto = 0, liquido = 0, estornos = 0, unidades = 0;
  let liqComCusto = 0, custoTotal = 0, impostoPeriodo = 0;
  // Um checkout vira N order_id com o mesmo pack_id (carrinho). "Pedido" conta o PACK, não a linha
  // — alinhado ao menu Faturamento (ADR-0039); contar order_id inflava nº de pedidos e ticket médio.
  const packsFaturaveis = new Set<string>();
  // Custo/markup por PACK (não por linha): espelha agruparPorPedido/calcularKpisPedidos (menu
  // Faturamento, fonte da verdade). Um pack conta se tiver QUALQUER item com custo, e entra com o
  // líquido inteiro do pack — assim markup/lucro/"c/ custo" batem entre todas as telas.
  const custoPorPack = new Map<string, { liquido: number; custo: number; imposto: number; temCusto: boolean }>();
  let liberado = 0, aLiberar = 0, comissao = 0, vendasComCusto = 0;
  let proximaLiberacaoMs: number | null = null;
  let proximaLiberacao: string | null = null;
  const porItem: Record<string, { unidades: number; valor: number }> = {};
  const vendasResumo: VendaResumo[] = [];

  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    const liq = liqRateado.get(v.id)?.liquido ?? v.liquido ?? 0;
    const est = v.estorno ?? 0;
    bruto += v.total_amount;
    liquido += liq;
    estornos += est;
    packsFaturaveis.add(String(v.pack_id ?? v.order_id));

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
    const pk = String(v.pack_id ?? v.order_id);
    const pc = custoPorPack.get(pk) ?? { liquido: 0, custo: 0, imposto: 0, temCusto: false };
    pc.liquido += liq;
    const impV = impostoDaVenda(v, aliquotaResolver);
    pc.imposto += impV;
    impostoPeriodo += impV;
    if (custo != null && custo > 0) { pc.custo += custo; pc.temCusto = true; }
    custoPorPack.set(pk, pc);

    comissao += v.sale_fee_total ?? 0;
    if (v.money_release_date) {
      const ms = Date.parse(v.money_release_date);
      if (ms <= agoraMs) {
        liberado += liq;
      } else {
        aLiberar += liq;
        if (proximaLiberacaoMs == null || ms < proximaLiberacaoMs) {
          proximaLiberacaoMs = ms;
          proximaLiberacao = v.money_release_date;
        }
      }
    }

    vendasResumo.push({
      id: v.id,
      orderId: v.order_id,
      pedidoChave: String(v.pack_id ?? v.order_id),
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

  // Fecha o markup/lucro por pack (round2 por pack, igual ao Faturamento). vendasComCusto agora é
  // nº de PACKS com custo (≤ pedidos), eliminando o antigo "55/45" (numerador por linha > pacotes).
  for (const pc of custoPorPack.values()) {
    if (pc.temCusto && pc.custo > 0) {
      // Imposto (ADR-0055) reduz o líquido que entra no markup/lucro/margem — igual ao Faturamento.
      liqComCusto += round2(pc.liquido - pc.imposto);
      custoTotal += round2(pc.custo);
      vendasComCusto += 1;
    }
  }

  // Breakdown do retido: comissão = sale_fee_total (autoritativo, não duplica em pack); o "frete
  // efetivo" é o RESIDUAL (descontos − comissão), não a soma crua de frete_vendedor — que o ML
  // grava repetido em cada pedido do pack e é o frete BRUTO da etiqueta (antes de subsídio do ML).
  // Como líquido = bruto − comissão − frete_efetivo, o residual É o frete real pago pelo vendedor e
  // garante comissão + frete == descontos (o total exibido). Clamp em 0 p/ reembolsos (comissão > retido).
  const descontos = round2(bruto - liquido);
  const comissaoTotal = round2(comissao);
  const pedidos = packsFaturaveis.size;
  return {
    bruto: round2(bruto),
    liquido: round2(liquido),
    descontos,
    estornos: round2(estornos),
    pedidos,
    unidades,
    ticket: pedidos > 0 ? round2(bruto / pedidos) : 0,
    markup: custoTotal > 0 ? (liqComCusto - custoTotal) / custoTotal : null,
    lucro: round2(liqComCusto - custoTotal),
    liberado: round2(liberado),
    aLiberar: round2(aLiberar),
    proximaLiberacao,
    comissao: comissaoTotal,
    frete: round2(Math.max(0, descontos - comissaoTotal)),
    imposto: round2(impostoPeriodo),
    vendasComCusto,
    totalVendas: pedidos,
    margem: liqComCusto > 0 ? (liqComCusto - custoTotal) / liqComCusto : null,
    porItem,
    vendas: vendasResumo,
  };
}

/** Peso total (g) de um pedido: soma de pesoUnit × qtd dos itens com peso. 0 se nenhum tem. */
function pesoDaVenda(v: Venda, resolver?: PesoResolver): number {
  if (!resolver) return 0;
  let total = 0;
  for (const it of v.itens) {
    const unit = resolver(it);
    if (unit != null && unit > 0) total += unit * it.quantity;
  }
  return total;
}

/**
 * Rateia o frete de cada envio compartilhado (pack) entre os pedidos do grupo, compondo o líquido
 * econômico de cada um: `bruto − comissão − frete atribuído`. O `frete_vendedor` é gravado repetido
 * em cada pedido do pack (é o frete do ENVIO inteiro), então conta uma vez (max) e é distribuído por
 * peso (todos os pedidos com peso) → senão por valor (bruto). A comissão é a `sale_fee_total` real
 * de cada pedido (NÃO derivamos do net do MP — ver ADR-0042: o net é inconsistente, ora desconta
 * frete cheio, ora comissão).
 *
 * Singles (grupo de 1), sem frete, ou não faturáveis ficam fora do mapa — o líquido cru
 * (`ml_vendas.liquido`, já gravado como `bruto − comissão − frete` para pedidos avulsos) vale.
 * Retorna venda.id → { líquido composto, frete atribuído ao pedido }.
 */
export interface RateioPedido { liquido: number; frete: number }

export function ratearLiquidoPorFrete(
  vendas: Venda[], pesoResolver?: PesoResolver,
): Map<string, RateioPedido> {
  const grupos = new Map<number, Venda[]>();
  for (const v of vendas) {
    if (!ehFaturavel(v.status)) continue;
    const sid = v.shipping_id ?? v.pack_id;
    if (sid == null) continue;
    const g = grupos.get(sid);
    if (g) g.push(v); else grupos.set(sid, [v]);
  }

  const out = new Map<string, RateioPedido>();
  for (const membros of grupos.values()) {
    if (membros.length < 2) continue;
    // Frete do envio: o mesmo valor repetido em cada pedido do pack → conta uma vez.
    const freteEnvio = Math.max(0, ...membros.map((m) => m.frete_vendedor ?? 0));
    if (freteEnvio <= 0) continue;

    const pesos = membros.map((m) => pesoDaVenda(m, pesoResolver));
    const usaPeso = pesos.every((p) => p > 0);
    const base = usaPeso ? pesos : membros.map((m) => m.total_amount);
    const baseTotal = base.reduce((s, b) => s + b, 0);
    if (baseTotal <= 0) continue;
    // Maior base absorve o resíduo de centavos do arredondamento do frete.
    let idxMax = 0;
    for (let i = 1; i < base.length; i++) if (base[i] > base[idxMax]) idxMax = i;

    // Frete do envio rateado (peso, senão valor); comissão = sale_fee_total real de cada pedido.
    const fretes = ratearProporcional(freteEnvio, base, idxMax);
    membros.forEach((m, i) => {
      const liquido = round2(m.total_amount - (m.sale_fee_total ?? 0) - fretes[i]);
      out.set(m.id, { liquido, frete: fretes[i] });
    });
  }
  return out;
}

/** Rateia `total` proporcionalmente a `base`; o resíduo de centavos vai para `idxResto`. */
function ratearProporcional(total: number, base: number[], idxResto: number): number[] {
  const baseTotal = base.reduce((s, b) => s + b, 0);
  if (baseTotal <= 0) return base.map(() => 0);
  const partes = base.map((b) => round2((total * b) / baseTotal));
  const resto = round2(total - partes.reduce((s, p) => s + p, 0));
  partes[idxResto] = round2(partes[idxResto] + resto);
  return partes;
}

export interface PontoSerie { chave: string; rotulo: string; bruto: number; liquido: number; pedidos: number }
export interface ItemSerie { data: string | null; bruto: number; liquido: number; pedidoChave?: string | null }

/** Série temporal (bruto/líquido/nº de pedidos) por dia ou semana. Recebe itens já faturáveis (a
 *  página passa resumo.vendas, um item por venda). UTC na chave; rótulo DD/MM; ordenada crescente. */
export function agruparPorPeriodo(itens: ItemSerie[], passo: 'dia' | 'semana'): PontoSerie[] {
const mapa = new Map<string, { rotulo: string; bruto: number; liquido: number; pedidos: number; chaves: Set<string> }>();
  for (const v of itens) {
    if (!v.data) continue;
const d = new Date(v.data);
if (passo === 'semana') d.setDate(d.getDate() - d.getDay()); // âncora no domingo local
const yyyy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, '0');
const dd = String(d.getDate()).padStart(2, '0');
    const chave = `${yyyy}-${mm}-${dd}`;
const acc = mapa.get(chave) ?? { rotulo: `${dd}/${mm}`, bruto: 0, liquido: 0, pedidos: 0, chaves: new Set<string>() };
acc.bruto += v.bruto;
acc.liquido += v.liquido;
if (v.pedidoChave) {
if (!acc.chaves.has(v.pedidoChave)) {
acc.chaves.add(v.pedidoChave);
acc.pedidos += 1;
}
} else {
acc.pedidos += 1;
}
mapa.set(chave, acc);
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([chave, a]) => ({ chave, rotulo: a.rotulo, bruto: round2(a.bruto), liquido: round2(a.liquido), pedidos: a.pedidos }));
}
