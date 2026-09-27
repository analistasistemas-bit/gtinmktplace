// Vendas SKU (ADR-0172): agrega por código (variação) os itens que agruparPorPedido já produz —
// a mesma fonte da aba Vendas. Nenhuma fórmula nova de dinheiro: bruto = preço × qtd, líquido =
// item.liquido (já sem imposto), custo = item.custo. Só itens faturáveis entram no dinheiro.
import type { Pedido } from './pedidos-faturamento';
import type { CatalogoSku } from './vendas-sku-catalogo';
import type { Janela } from './metricas';
import { round2 } from './formato';
import type { Venda } from './faturamento';
import { dataNoPeriodo, orderIdsComDevolucaoReal, type Devolucao } from './devolucoes';

export const SEM_CODIGO = '';

export interface AcumuladorSku {
  unidades: number; unidadesComCusto: number; pedidos: number;
  bruto: number; liquido: number; imposto: number;
  brutoComCusto: number; liquidoComCusto: number; custo: number; brutoCustoReal: number;
  itensComCusto: number; itensSemCusto: number; itensEstimados: number;
  canceladas: number; pedidosBaseDevolucao: number; pedidosDevolvidos: number;
}

export type FonteCusto = 'real' | 'estimado' | 'parcial' | 'sem_custo';

export interface MetricasSku {
  lucro: number | null;
  lucroPorUnidade: number | null;
  markup: number | null;
  margemSVenda: number | null;
  /** Preço médio unitário (bruto ÷ unidades). */
  ticket: number;
  taxaDevolucao: number | null;
  fonteCusto: FonteCusto;
}

export interface LinhaSku {
  codigo: string;
  titulo: string | null;
  imagemPath: string | null;
  codigoPai: string | null;
  nomeFamilia: string | null;
  fornecedor: string | null;
  origem: 'nacional' | 'importado' | null;
  ehKit: boolean;
  estoque: number | null;
  primeiraVenda: string | null;
  acc: AcumuladorSku;
  m: MetricasSku;
  pedidoChaves: string[];
}

const vazio = (): AcumuladorSku => ({
  unidades: 0, unidadesComCusto: 0, pedidos: 0, bruto: 0, liquido: 0, imposto: 0,
  brutoComCusto: 0, liquidoComCusto: 0, custo: 0, brutoCustoReal: 0,
  itensComCusto: 0, itensSemCusto: 0, itensEstimados: 0,
  canceladas: 0, pedidosBaseDevolucao: 0, pedidosDevolvidos: 0,
});

export function somarAcumuladores(accs: AcumuladorSku[]): AcumuladorSku {
  const t = vazio();
  for (const a of accs) for (const k of Object.keys(t) as (keyof AcumuladorSku)[]) t[k] += a[k];
  return t;
}

export function dentroDaJanela(data: string | null, j: Janela): boolean {
  if (!data) return false;
  const t = Date.parse(data);
  return t >= Date.parse(j.desde) && t <= Date.parse(j.ate);
}

export function metricas(a: AcumuladorSku): MetricasSku {
  const lucro = a.itensComCusto > 0 ? round2(a.liquidoComCusto - a.custo) : null;
  const fonteCusto: FonteCusto =
    a.itensSemCusto > 0 ? (a.itensComCusto > 0 ? 'parcial' : 'sem_custo')
      : a.itensEstimados > 0 ? 'estimado' : 'real';
  return {
    lucro,
    lucroPorUnidade: lucro != null && a.unidadesComCusto > 0 ? round2(lucro / a.unidadesComCusto) : null,
    markup: lucro != null && a.custo > 0 ? lucro / a.custo : null,
    margemSVenda: lucro != null && a.brutoComCusto > 0 ? lucro / a.brutoComCusto : null,
    ticket: a.unidades > 0 ? round2(a.bruto / a.unidades) : 0,
    taxaDevolucao: a.pedidosBaseDevolucao > 0 ? a.pedidosDevolvidos / a.pedidosBaseDevolucao : null,
    fonteCusto,
  };
}

interface Grupo {
  acc: AcumuladorSku; ordens: Set<number>; base: Set<number>; devolvidos: Set<number>;
  chaves: Set<string>; titulo: string | null; imagem: string | null;
}

/** `ordensDevolvidas`: order_ids com claim `returns` (orderIdsComDevolucaoReal). NÃO usar
 *  `it.temDevolucao`: ele marca QUALQUER claim (cancelamento, mediação…) e inflava a taxa ~7x. */
export function agregarPorSku(
  pedidos: Pedido[], janela: Janela, catalogo: Map<string, CatalogoSku>, ordensDevolvidas: Set<number>,
): LinhaSku[] {
  const grupos = new Map<string, Grupo>();
  for (const p of pedidos) {
    if (!dentroDaJanela(p.data, janela)) continue;
    for (const it of p.itens) {
      const codigo = it.codigo?.trim() || SEM_CODIGO;
      let g = grupos.get(codigo);
      if (!g) {
        g = { acc: vazio(), ordens: new Set(), base: new Set(), devolvidos: new Set(), chaves: new Set(), titulo: null, imagem: null };
        grupos.set(codigo, g);
      }
      const a = g.acc;
      const devolvido = ordensDevolvidas.has(it.orderId);
      const valor = it.unit_price * it.quantity;
      g.chaves.add(p.chave);
      g.titulo ??= it.titulo;
      g.imagem ??= it.imagem_path;
      if (it.faturavel) {
        a.unidades += it.quantity;
        a.bruto += valor;
        a.liquido += it.liquido;
        a.imposto += it.imposto;
        g.ordens.add(it.orderId);
        if (it.custo != null) {
          a.itensComCusto += 1;
          a.unidadesComCusto += it.quantity;
          a.custo += it.custo;
          a.liquidoComCusto += it.liquido;
          a.brutoComCusto += valor;
          if (it.custoEstimado) a.itensEstimados += 1; else a.brutoCustoReal += valor;
        } else {
          a.itensSemCusto += 1;
        }
      } else if (!devolvido) {
        a.canceladas += it.quantity;
      }
      if (it.faturavel || devolvido) g.base.add(it.orderId);
      if (devolvido) g.devolvidos.add(it.orderId);
    }
  }
  const linhas: LinhaSku[] = [];
  for (const [codigo, g] of grupos) {
    g.acc.pedidos = g.ordens.size;
    g.acc.pedidosBaseDevolucao = g.base.size;
    g.acc.pedidosDevolvidos = g.devolvidos.size;
    const cat = codigo === SEM_CODIGO ? undefined : catalogo.get(codigo);
    linhas.push({
      codigo,
      titulo: cat?.nome ?? g.titulo,
      imagemPath: g.imagem,
      codigoPai: cat?.codigoPai ?? null,
      nomeFamilia: cat?.nomeFamilia ?? null,
      fornecedor: cat?.fornecedor ?? null,
      origem: cat?.origem ?? null,
      ehKit: cat?.ehKit ?? false,
      estoque: cat ? cat.estoque : null,
      primeiraVenda: cat?.primeiraVenda ?? null,
      acc: g.acc,
      m: metricas(g.acc),
      pedidoChaves: [...g.chaves],
    });
  }
  return linhas;
}

/** Limites fixos da v1 (ADR-0172 D-7) — recalibrar com dado real, sem tela de configuração. */
export const LIMITES = {
  janelaTendenciaDias: 30,
  variacaoTendencia: 0.2,
  minUnidadesTendencia: 5,
  coberturaMinDias: 15,
  taxaDevolucaoMax: 0.05,
  minPedidosDevolucao: 20,
  abcA: 0.8,
  abcB: 0.95,
} as const;

const DIA_MS = 86_400_000;

export type Tendencia = 'novo' | 'em_alta' | 'em_queda' | 'estavel' | 'parado' | 'baixo_giro';

export function unidadesPorCodigo(pedidos: Pedido[], j: Janela): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of pedidos) {
    if (!dentroDaJanela(p.data, j)) continue;
    for (const it of p.itens) {
      if (!it.faturavel) continue;
      const c = it.codigo?.trim() || SEM_CODIGO;
      m.set(c, (m.get(c) ?? 0) + it.quantity);
    }
  }
  return m;
}

/** u30 = unidades nos 30 dias até o fim do período; uAnt = os 30 anteriores. Precedência:
 *  novo > parado > baixo giro > alta/queda/estável (glossário "Tendência do SKU"). */
export function classificarTendencia(u30: number, uAnt: number, primeiraVenda: string | null, fimMs: number): Tendencia {
  if (primeiraVenda && fimMs - Date.parse(primeiraVenda) < LIMITES.janelaTendenciaDias * DIA_MS) return 'novo';
  if (u30 === 0) return 'parado';
  if (Math.max(u30, uAnt) < LIMITES.minUnidadesTendencia) return 'baixo_giro';
  if (uAnt === 0) return 'em_alta';
  const d = (u30 - uAnt) / uAnt;
  if (d >= LIMITES.variacaoTendencia) return 'em_alta';
  if (d <= -LIMITES.variacaoTendencia) return 'em_queda';
  return 'estavel';
}

export type Cobertura = number | null | 'compartilhado';

/** Dias até acabar no ritmo dos últimos 30 dias. Kit vinculado divide o estoque com a base
 *  (ADR-0151): não tem número próprio. */
export function coberturaDias(estoque: number | null, u30: number, ehKit: boolean): Cobertura {
  if (ehKit) return 'compartilhado';
  if (estoque == null || u30 <= 0) return null;
  return Math.floor(estoque / (u30 / LIMITES.janelaTendenciaDias));
}

export type Alerta = 'lucro_negativo' | 'cobertura_baixa' | 'devolucao_alta' | 'sem_custo';

export function alertasSku(l: Pick<LinhaSku, 'acc' | 'm'>, cobertura: Cobertura): Alerta[] {
  const out: Alerta[] = [];
  if (l.m.lucro != null && l.m.lucro < 0) out.push('lucro_negativo');
  if (typeof cobertura === 'number' && cobertura < LIMITES.coberturaMinDias) out.push('cobertura_baixa');
  if (l.acc.pedidosBaseDevolucao >= LIMITES.minPedidosDevolucao && (l.m.taxaDevolucao ?? 0) > LIMITES.taxaDevolucaoMax) {
    out.push('devolucao_alta');
  }
  if (l.m.fonteCusto === 'sem_custo' || l.m.fonteCusto === 'parcial') out.push('sem_custo');
  return out;
}

export interface KpisSku {
  bruto: number; lucro: number | null; markup: number | null; margemSVenda: number | null;
  unidades: number; skusComVenda: number; skusVendaUnica: number;
  concentracaoTop5: number | null; pctBrutoCustoReal: number | null; prejuizo: number;
}

export function calcularKpisSku(linhas: LinhaSku[]): KpisSku {
  const total = somarAcumuladores(linhas.map((l) => l.acc));
  const m = metricas(total);
  // Sem código não é SKU: fica fora da concentração, mas segue nos totais.
  const positivos = linhas.filter((l) => l.codigo !== SEM_CODIGO).map((l) => l.m.lucro ?? 0).filter((v) => v > 0).sort((a, b) => b - a);
  const somaPos = positivos.reduce((s, v) => s + v, 0);
  const comVenda = linhas.filter((l) => l.codigo !== SEM_CODIGO && l.acc.unidades > 0);
  return {
    bruto: round2(total.bruto),
    lucro: m.lucro,
    markup: m.markup,
    margemSVenda: m.margemSVenda,
    unidades: total.unidades,
    skusComVenda: comVenda.length,
    skusVendaUnica: comVenda.filter((l) => l.acc.pedidos === 1).length,
    concentracaoTop5: somaPos > 0 ? positivos.slice(0, 5).reduce((s, v) => s + v, 0) / somaPos : null,
    pctBrutoCustoReal: total.bruto > 0 ? total.brutoCustoReal / total.bruto : null,
    prejuizo: round2(linhas.reduce((s, l) => s + (l.m.lucro != null && l.m.lucro < 0 ? l.m.lucro : 0), 0)),
  };
}

export interface Delta { texto: string; tendencia: 'up' | 'down' | 'neutral' }

// Mesmo sinal de menos (U+2212) no Δ% e no Δ em R$.
const pct1 = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(1).replace('.', ',')}`;
const tend = (d: number): Delta['tendencia'] => (d > 0 ? 'up' : d < 0 ? 'down' : 'neutral');

/** Δ% quando a base anterior é positiva; senão Δ em R$ (base zero/negativa não tem % honesto). */
export function deltaValor(atual: number | null, anterior: number | null, fmt: (n: number) => string): Delta | null {
  if (atual == null || anterior == null) return null;
  const d = atual - anterior;
  if (anterior > 0) return { texto: `${pct1(d / anterior)}%`, tendencia: tend(d) };
  return { texto: `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}`, tendencia: tend(d) };
}

/** Markup e Margem s/ venda variam em pontos percentuais. */
export function deltaPp(atual: number | null, anterior: number | null): Delta | null {
  if (atual == null || anterior == null) return null;
  const d = atual - anterior;
  return { texto: `${pct1(d)} p.p.`, tendencia: tend(d) };
}

export type ClasseAbc = 'A' | 'B' | 'C' | 'D';

/** A até 80% acumulado, B até 95%, C o resto — acumulado ANTES do item, então o 1º é sempre A.
 *  Por lucro: só lucro positivo entra; prejuízo = D; sem custo fica sem classe. */
export function curvaAbc(todas: LinhaSku[], base: 'lucro' | 'bruto'): Map<string, ClasseAbc> {
  const linhas = todas.filter((l) => l.codigo !== SEM_CODIGO); // sem código fica sem classe e fora do total
  const valor = (l: LinhaSku) => (base === 'lucro' ? l.m.lucro : l.acc.bruto);
  const out = new Map<string, ClasseAbc>();
  const pos = linhas.filter((l) => (valor(l) ?? 0) > 0).sort((a, b) => valor(b)! - valor(a)!);
  const total = pos.reduce((s, l) => s + valor(l)!, 0);
  let acum = 0;
  for (const l of pos) {
    const share = acum / total;
    out.set(l.codigo, share < LIMITES.abcA ? 'A' : share < LIMITES.abcB ? 'B' : 'C');
    acum += valor(l)!;
  }
  if (base === 'lucro') for (const l of linhas) if (l.m.lucro != null && l.m.lucro < 0) out.set(l.codigo, 'D');
  return out;
}

export interface VariacaoLucro { codigo: string; titulo: string | null; delta: number; situacao: 'entrou' | 'saiu' | 'mudou' }

/** Quem explica a variação do lucro, em R$. Só SKUs com lucro calculado em algum dos períodos. */
export function explicarVariacao(atual: LinhaSku[], anterior: LinhaSku[], n = 5): VariacaoLucro[] {
  const ant = new Map(anterior.map((l) => [l.codigo, l]));
  const at = new Map(atual.map((l) => [l.codigo, l]));
  const out: VariacaoLucro[] = [];
  for (const codigo of new Set([...at.keys(), ...ant.keys()])) {
    if (codigo === SEM_CODIGO) continue;
    const a = at.get(codigo); const b = ant.get(codigo);
    if (a?.m.lucro == null && b?.m.lucro == null) continue;
    const delta = round2((a?.m.lucro ?? 0) - (b?.m.lucro ?? 0));
    if (delta === 0) continue;
    out.push({ codigo, titulo: (a ?? b)!.titulo, delta, situacao: !b ? 'entrou' : !a ? 'saiu' : 'mudou' });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, n);
}

const fmtBRL0 = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** 0 a 3 frases, só quando a evidência existe. */
export function gerarInsights(p: { linhas: LinhaSku[]; variacoes: VariacaoLucro[]; coberturaBaixa: number; parados: number }): string[] {
  const out: string[] = [];
  const pos = p.linhas.filter((l) => l.codigo !== SEM_CODIGO).map((l) => l.m.lucro ?? 0).filter((v) => v > 0).sort((a, b) => b - a);
  if (pos.length >= 5) {
    const metade = pos.reduce((s, v) => s + v, 0) / 2;
    let acum = 0; let k = 0;
    while (acum < metade) acum += pos[k++];
    if (k <= Math.ceil(pos.length * 0.2)) out.push(`${k} ${k === 1 ? 'SKU faz' : 'SKUs fazem'} metade do lucro do período.`);
  }
  const queda = p.variacoes.find((v) => v.delta < 0 && v.situacao !== 'entrou');
  if (queda) out.push(`${queda.titulo ?? queda.codigo} tirou ${fmtBRL0(-queda.delta)} do lucro contra o período anterior.`);
  if (p.coberturaBaixa > 0) out.push(`${p.coberturaBaixa} ${p.coberturaBaixa === 1 ? 'SKU tem' : 'SKUs têm'} estoque para menos de ${LIMITES.coberturaMinDias} dias.`);
  if (p.parados > 0) out.push(`${p.parados} ${p.parados === 1 ? 'SKU parou' : 'SKUs pararam'} de vender há mais de ${LIMITES.janelaTendenciaDias} dias.`);
  return out.slice(0, 3);
}

export interface LinhaFamilia { codigoPai: string; nomeFamilia: string | null; acc: AcumuladorSku; m: MetricasSku; filhos: LinhaSku[] }

export function agruparPorFamilia(linhas: LinhaSku[]): LinhaFamilia[] {
  const g = new Map<string, LinhaSku[]>();
  for (const l of linhas) {
    const k = l.codigoPai ?? `sem-familia:${l.codigo}`;
    g.set(k, [...(g.get(k) ?? []), l]);
  }
  return [...g].map(([codigoPai, filhos]) => {
    const acc = somarAcumuladores(filhos.map((f) => f.acc));
    return { codigoPai, nomeFamilia: filhos[0].nomeFamilia, acc, m: metricas(acc), filhos };
  });
}

export function janelaEstendida(atual: Janela, anterior: Janela): Janela {
  const fim = Date.parse(atual.ate);
  const inicio = Math.min(Date.parse(anterior.desde), fim - 2 * LIMITES.janelaTendenciaDias * DIA_MS);
  return { desde: new Date(inicio).toISOString(), ate: atual.ate };
}

export interface VendasSku {
  linhas: LinhaSku[]; linhasAnterior: LinhaSku[];
  kpis: KpisSku; kpisAnterior: KpisSku;
  tendencias: Map<string, Tendencia>; coberturas: Map<string, Cobertura>; alertas: Map<string, Alerta[]>;
  variacoes: VariacaoLucro[]; insights: string[]; parados: number; devolucoesNaoAtribuidas: number;
  /** Primeira venda faturável registrada na org (ADR-0172 D-2): a tela diz desde quando conta. */
  historicoDesde: string | null;
}

export function montarVendasSku(p: {
  vendas: Venda[]; agrupar: (vs: Venda[]) => Pedido[]; janela: Janela; anterior: Janela;
  catalogo: Map<string, CatalogoSku>; devolucoes: Devolucao[];
}): VendasSku {
  // Recorta as VENDAS pela data antes de agrupar, como a aba Vendas (que só carrega a janela).
  const recorte = (j: Janela) => p.agrupar(p.vendas.filter((v) => dentroDaJanela(v.date_closed, j)));
  const fim = Date.parse(p.janela.ate);
  const j30 = { desde: new Date(fim - LIMITES.janelaTendenciaDias * DIA_MS).toISOString(), ate: p.janela.ate };
  const jAnt = {
    desde: new Date(fim - 2 * LIMITES.janelaTendenciaDias * DIA_MS).toISOString(),
    ate: new Date(fim - LIMITES.janelaTendenciaDias * DIA_MS - 1).toISOString(),
  };
  // ponytail: p.devolucoes vem de buscarDevolucoes, que não pagina — teto de 1.000 linhas do PostgREST
  // (175 em 2026-09-27). Passando disso, paginar como buscarVendas.
  const devolvidas = orderIdsComDevolucaoReal(p.devolucoes);
  const linhas = agregarPorSku(recorte(p.janela), p.janela, p.catalogo, devolvidas)
    .sort((a, b) => (b.m.lucro ?? -Infinity) - (a.m.lucro ?? -Infinity) || a.codigo.localeCompare(b.codigo));
  const linhasAnterior = agregarPorSku(recorte(p.anterior), p.anterior, p.catalogo, devolvidas);
  const u30 = unidadesPorCodigo(recorte(j30), j30);
  const uAnt = unidadesPorCodigo(recorte(jAnt), jAnt);

  const tendencias = new Map<string, Tendencia>();
  const coberturas = new Map<string, Cobertura>();
  const alertas = new Map<string, Alerta[]>();
  for (const l of linhas) {
    if (l.codigo === SEM_CODIGO) continue;
    tendencias.set(l.codigo, classificarTendencia(u30.get(l.codigo) ?? 0, uAnt.get(l.codigo) ?? 0, l.primeiraVenda, fim));
    const cob = coberturaDias(l.estoque, u30.get(l.codigo) ?? 0, l.ehKit);
    coberturas.set(l.codigo, cob);
    alertas.set(l.codigo, alertasSku(l, cob));
  }
  // ponytail: "parado" = SKU do catálogo com estoque > 0 cuja última venda faturável é anterior aos
  // 30 dias até o fim do período (estoque parado é o que importa). Não vê SKU fora do catálogo.
  let parados = 0;
  let historicoDesde: string | null = null;
  for (const c of p.catalogo.values()) {
    if (c.estoque > 0 && c.ultimaVenda && Date.parse(c.ultimaVenda) < Date.parse(j30.desde)) parados += 1;
    if (c.primeiraVenda && (historicoDesde == null || Date.parse(c.primeiraVenda) < Date.parse(historicoDesde))) historicoDesde = c.primeiraVenda;
  }
  const variacoes = explicarVariacao(linhas, linhasAnterior);
  const coberturaBaixa = [...alertas.values()].filter((a) => a.includes('cobertura_baixa')).length;
  // ponytail: devolução "não atribuída" = claim do período sem pedido carregado na janela estendida.
  // Um claim de venda mais antiga que a janela também cai aqui; é um teto conhecido.
  const orderIds = new Set(p.vendas.map((v) => v.order_id));
  const devolucoesNaoAtribuidas = p.devolucoes.filter((d) =>
    dentroDaJanela(dataNoPeriodo(d), p.janela) && (d.order_id == null || !orderIds.has(d.order_id))).length;
  return {
    linhas, linhasAnterior,
    kpis: calcularKpisSku(linhas), kpisAnterior: calcularKpisSku(linhasAnterior),
    tendencias, coberturas, alertas, variacoes,
    insights: gerarInsights({ linhas, variacoes, coberturaBaixa, parados }),
    parados, devolucoesNaoAtribuidas, historicoDesde,
  };
}
