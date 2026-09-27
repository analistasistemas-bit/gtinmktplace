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
