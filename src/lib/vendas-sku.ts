// Vendas SKU (ADR-0172): agrega por código (variação) os itens que agruparPorPedido já produz —
// a mesma fonte da aba Vendas. Nenhuma fórmula nova de dinheiro: bruto = preço × qtd, líquido =
// item.liquido (já sem imposto), custo = item.custo. Só itens faturáveis entram no dinheiro.
import type { Pedido } from './pedidos-faturamento';
import type { CatalogoSku } from './vendas-sku-catalogo';
import type { Janela } from './metricas';
import { round2 } from './formato';

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

export function agregarPorSku(pedidos: Pedido[], janela: Janela, catalogo: Map<string, CatalogoSku>): LinhaSku[] {
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
      } else if (!it.temDevolucao) {
        a.canceladas += it.quantity;
      }
      if (it.faturavel || it.temDevolucao) g.base.add(it.orderId);
      if (it.temDevolucao) g.devolvidos.add(it.orderId);
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
