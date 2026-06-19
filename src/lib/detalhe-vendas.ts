import type { MetricasVendas } from './metricas';
import type { PublicadoItem } from './publicados';

export interface LinhaVenda { id: string; titulo: string; unidades: number; valor: number; pctTotal: number }
export interface SecaoVendas { linhas: LinhaVenda[]; unidades: number; valor: number; pctTotal: number }
export interface DetalheVendas { total: number; pedidos: number; app: SecaoVendas; externo: SecaoVendas }

function secao(linhas: LinhaVenda[], total: number): SecaoVendas {
  const unidades = linhas.reduce((a, l) => a + l.unidades, 0);
  const valor = linhas.reduce((a, l) => a + l.valor, 0);
  return { linhas, unidades, valor, pctTotal: total > 0 ? (valor / total) * 100 : 0 };
}

/** Compõe o detalhe do faturamento: anúncios do app (porItem + títulos) vs. externos. */
export function montarDetalheVendas(metricas: MetricasVendas, publicados: PublicadoItem[]): DetalheVendas {
  const total = metricas.totais.faturamento;
  const pct = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const titulos = new Map(publicados.map((p) => [p.mlItemId, p.titulo]));

  const appLinhas: LinhaVenda[] = Object.entries(metricas.porItem)
    .map(([id, v]) => ({ id, titulo: titulos.get(id) ?? id, unidades: v.unidades, valor: v.valor, pctTotal: pct(v.valor) }))
    .sort((a, b) => b.valor - a.valor);

  const externoLinhas: LinhaVenda[] = (metricas.externos ?? [])
    .map((e) => ({ id: e.id, titulo: e.titulo, unidades: e.unidades, valor: e.valor, pctTotal: pct(e.valor) }))
    .sort((a, b) => b.valor - a.valor);

  return {
    total,
    pedidos: metricas.totais.pedidos,
    app: secao(appLinhas, total),
    externo: secao(externoLinhas, total),
  };
}
