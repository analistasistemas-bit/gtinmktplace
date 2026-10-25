// Resultado por item / pedido / carrinho da notificação gerencial (ADR-0190 D-2/D-5).
// Porta fiel de `agruparPorPedido` (src/lib/pedidos-faturamento.ts) + `cascataDoPedido`
// (src/lib/cascata-pedido.ts): o "Lucro" do Telegram é o "Lucro (do pedido)" da tela, ao centavo.
// Única diferença deliberada: item faturável sem alíquota resolvida fica SEM lucro (a tela usa imposto 0).
// Todo consumidor (carrinho, período, top, atenção) lê só `item.lucro` — nenhuma conta nova aqui.
import { ehFaturavel, impostoDoItem, ratearLiquidoPorFrete, valorDoItem } from '../../platform-admin/sales-summary.ts';
import { montarAliquotaResolver, montarCustoResolver, montarPesoResolver } from '../../platform-admin/sales-costs.ts';
import type { ContextoCalculo } from '../../platform-admin/metrics-repository.ts';
import type { Venda } from '../../platform-admin/sales-types.ts';
import { calcularSemaforo } from '../../preco/semaforo.ts';

const round2 = (v: number): number => Math.round(v * 100) / 100;

export type MotivoSemLucro = 'sem_custo' | 'frete_nao_lido' | 'aliquota_nao_confirmada';

export interface ResultadoItem {
  orderId: number;
  packChave: string;
  codigo: string | null;
  titulo: string | null;
  quantidade: number;
  /** `valorDoItem` (unit_price × qtd − cupom do vendedor). */
  venda: number;
  /** Fatia do líquido do pedido ANTES do imposto (a tela guarda `liquido − imposto` no item). */
  liquido: number;
  imposto: number;
  impostoOk: boolean;
  custo: number | null;
  custoEstimado: boolean;
  faturavel: boolean;
  freteNaoLido: boolean;
  lucro: number | null;
}

/** Porta de `agruparPorPedido`, item a item. */
export function resultadoPorItem(vendas: Venda[], ctx: ContextoCalculo): ResultadoItem[] {
  const custoResolver = montarCustoResolver(ctx.maps);
  // espelha metrics-repository.ts `summarize`: sem config confirmada, nenhum resolver de alíquota.
  const aliquotaResolver = ctx.configOk ? montarAliquotaResolver(ctx.maps, ctx.rates) : undefined;
  const rateio = ratearLiquidoPorFrete(vendas, montarPesoResolver(ctx.maps));
  // espelha pedidos-faturamento.ts:142
  const liquidoMembro = (v: Venda) => (ehFaturavel(v.status) ? rateio.get(v.id)?.liquido ?? v.liquido ?? 0 : 0);

  const grupos = new Map<string, Venda[]>();
  for (const v of vendas) {
    const chave = String(v.pack_id ?? v.order_id);
    const g = grupos.get(chave);
    if (g) g.push(v); else grupos.set(chave, [v]);
  }

  const out: ResultadoItem[] = [];
  for (const [chave, membros] of grupos) {
    membros.sort((a, b) => a.order_id - b.order_id);
    const liquido = round2(membros.reduce((s, v) => s + liquidoMembro(v), 0));
    const itensFlat = membros.flatMap((v) => v.itens.map((it) => ({ it, v, faturavel: ehFaturavel(v.status) })));
    const valorItensFaturaveis = itensFlat
      .filter(({ faturavel }) => faturavel)
      .reduce((s, { it }) => s + valorDoItem(it), 0);
    const liqItens = itensFlat.map(({ it, faturavel }) => (faturavel && valorItensFaturaveis > 0
      ? round2((liquido * valorDoItem(it)) / valorItensFaturaveis)
      : 0));
    let idxMaior = -1;
    itensFlat.forEach(({ it, faturavel }, i) => {
      if (faturavel && (idxMaior < 0 || valorDoItem(it) > valorDoItem(itensFlat[idxMaior].it))) idxMaior = i;
    });
    // diverge de pedidos-faturamento.ts:190 (de propósito): lá, com a base dos itens zerada (cupom do
    // vendedor = valor dos itens) as fatias ficam 0, mas o pedido segue com o líquido inteiro
    // (frete/comissão ainda devidos) e a cascata desconta. Sem a trava `valorItensFaturaveis > 0`,
    // o resíduo (= líquido inteiro) cai no 1º item faturável e o Σ dos itens bate com a cascata.
    if (idxMaior >= 0) {
      liqItens[idxMaior] = round2(liqItens[idxMaior] + liquido - liqItens.reduce((s, x) => s + x, 0));
    }

    itensFlat.forEach(({ it, v, faturavel }, i) => {
      // espelha pedidos-faturamento.ts:122 (custoDoItem; o resolver já prefere custo_congelado)
      const unit = custoResolver(it);
      const custo = unit != null && unit > 0 ? round2(unit * it.quantity) : null;
      const imposto = faturavel ? impostoDoItem(it, aliquotaResolver, v.uf) : 0;
      // diverge de pedidos-faturamento.ts:200 (de propósito): lá alíquota null vira imposto 0 e o
      // pedido segue com lucro; aqui o item fica sem lucro e o carrinho cai em `aliquota_nao_confirmada`.
      const impostoOk = ctx.configOk && aliquotaResolver != null && aliquotaResolver(it, v.uf) != null;
      // Frete do envio não lido ainda (shipping_id sem frete_vendedor): o líquido gravado não o desconta.
      const freteNaoLido = v.frete_vendedor == null && v.shipping_id != null;
      const liq = liqItens[i];
      out.push({
        orderId: v.order_id, packChave: chave, codigo: it.codigo, titulo: it.titulo, quantidade: it.quantity,
        venda: round2(valorDoItem(it)), liquido: liq, imposto, impostoOk, custo,
        custoEstimado: custo != null && it.custo_congelado == null, faturavel, freteNaoLido,
        // espelha cascata-pedido.ts:46 (margem = liquido − custo, com liquido já sem imposto)
        lucro: faturavel && impostoOk && custo != null && !freteNaoLido ? round2(liq - imposto - custo) : null,
      });
    });
  }
  return out;
}

export interface ResultadoCarrinho {
  venda: number;
  itens: number;
  lucro: number | null;
  motivo: MotivoSemLucro | null;
  margemSobreVenda: number | null;
  markup: number | null;
  prejuizos: { titulo: string; valor: number }[];
  semCusto: string[];
}

const nomeItem = (it: ResultadoItem) => it.titulo ?? it.codigo ?? '';

/** Lucro do carrinho = Σ lucro dos itens faturáveis; vazio com motivo se algum item não fecha. */
export function resultadoCarrinho(itens: ResultadoItem[], configOk: boolean): ResultadoCarrinho {
  const fat = itens.filter((it) => it.faturavel);
  // `venda` = Σ valorDoItem; a tela (cascata-pedido.ts) usa brutoFaturavel = Σ (total_amount − cupom).
  // Iguais quando total_amount − cupom da order = Σ valorDoItem dos itens dela (paridade testada).
  const venda = round2(fat.reduce((s, it) => s + it.venda, 0));
  const motivo: MotivoSemLucro | null = !configOk || fat.some((it) => !it.impostoOk) ? 'aliquota_nao_confirmada'
    : fat.some((it) => it.freteNaoLido) ? 'frete_nao_lido'
    : fat.some((it) => it.custo == null) ? 'sem_custo'
    : null;
  const lucro = motivo == null && fat.length > 0 ? round2(fat.reduce((s, it) => s + (it.lucro ?? 0), 0)) : null;
  const custo = fat.reduce((s, it) => s + (it.custo ?? 0), 0);
  return {
    venda,
    itens: fat.length,
    lucro,
    motivo,
    margemSobreVenda: lucro != null && venda > 0 ? lucro / venda : null,
    markup: lucro != null && custo > 0 ? lucro / custo : null,
    prejuizos: fat.filter((it) => it.lucro != null && it.lucro < 0).map((it) => ({ titulo: nomeItem(it), valor: it.lucro! })),
    semCusto: fat.filter((it) => it.custo == null).map(nomeItem),
  };
}

export interface LucroPeriodo {
  lucro: number | null;
  motivo: 'aliquota_nao_confirmada' | null;
  pctVendaComLucro: number;
  vendaSemCusto: number;
  /** Venda faturável de itens com custo mas sem alíquota resolvida (fora do lucro por imposto). */
  vendaSemImposto: number;
  vendaCustoEstimado: number;
  pedidosFreteNaoLido: number;
  markup: number | null;
}

/** Lucro de período = Σ dos itens com lucro calculável, com a cobertura para a linha de rodapé. */
export function lucroDoPeriodo(itens: ResultadoItem[], configOk: boolean): LucroPeriodo {
  const fat = itens.filter((it) => it.faturavel);
  const comLucro = fat.filter((it) => it.lucro != null);
  const soma = (xs: ResultadoItem[], f: (it: ResultadoItem) => number) => round2(xs.reduce((s, it) => s + f(it), 0));
  const vendaTotal = soma(fat, (it) => it.venda);
  const lucro = soma(comLucro, (it) => it.lucro!);
  const custo = soma(comLucro, (it) => it.custo!);
  return {
    lucro: configOk ? lucro : null,
    motivo: configOk ? null : 'aliquota_nao_confirmada',
    pctVendaComLucro: vendaTotal > 0 ? soma(comLucro, (it) => it.venda) / vendaTotal : 0,
    vendaSemCusto: soma(fat.filter((it) => it.custo == null), (it) => it.venda),
    vendaSemImposto: soma(fat.filter((it) => it.custo != null && !it.impostoOk), (it) => it.venda),
    vendaCustoEstimado: soma(fat.filter((it) => it.custo != null && it.custoEstimado), (it) => it.venda),
    pedidosFreteNaoLido: new Set(fat.filter((it) => it.freteNaoLido).map((it) => it.packChave)).size,
    markup: configOk && custo > 0 ? lucro / custo : null,
  };
}

/** Top N produtos por lucro (só itens com lucro calculável; grupo com lucro ≤ 0 fica de fora), agrupados por código (ou título). */
export function topPorLucro(itens: ResultadoItem[], n: number): { titulo: string; lucro: number }[] {
  const porChave = new Map<string, { titulo: string; lucro: number }>();
  for (const it of itens) {
    if (it.lucro == null) continue;
    const chave = it.codigo ?? it.titulo ?? '';
    const acc = porChave.get(chave) ?? { titulo: nomeItem(it), lucro: 0 };
    acc.lucro += it.lucro;
    porChave.set(chave, acc);
  }
  return [...porChave.values()]
    .map((t) => ({ titulo: t.titulo, lucro: round2(t.lucro) }))
    .filter((t) => t.lucro > 0)
    .sort((a, b) => b.lucro - a.lucro)
    .slice(0, n);
}

/** Itens que pedem atenção: abaixo do piso, prejuízo (semáforo ADR-0020 por unidade) e sem custo. */
export function contarAtencao(
  itens: ResultadoItem[], pisoPorCodigo: Map<string, number>,
): { abaixoMinimo: number; prejuizo: number; semCusto: number } {
  let abaixoMinimo = 0, prejuizo = 0, semCusto = 0;
  for (const it of itens) {
    if (!it.faturavel) continue;
    if (it.custo == null) { semCusto++; continue; }
    if (it.lucro == null) continue;
    // ponytail: sem piso cadastrado, piso 0 — só o prejuízo conta (liquido ≥ 0 nunca é "abaixo").
    const piso = (it.codigo != null ? pisoPorCodigo.get(it.codigo) : undefined) ?? 0;
    const s = calcularSemaforo((it.liquido - it.imposto) / it.quantidade, piso, it.custo / it.quantidade);
    if (s === 'vermelho') prejuizo++;
    else if (s === 'amarelo') abaixoMinimo++;
  }
  return { abaixoMinimo, prejuizo, semCusto };
}
