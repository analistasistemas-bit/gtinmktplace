// Dossiê do SKU (Vendas SKU, Fatia 2a): série temporal. Nenhuma conta própria de dinheiro —
// cada intervalo recorta as vendas por date_closed, agrupa em pedidos (mesmo rateio da aba Vendas)
// e reusa agregarPorSku/somarAcumuladores/metricas da Fatia 1.
import type { Venda } from './faturamento';
import type { Pedido } from './pedidos-faturamento';
import type { CatalogoSku } from './vendas-sku-catalogo';
import type { Intervalo } from './calendario-brt';
import { agregarPorSku, somarAcumuladores, metricas, dentroDaJanela, SEM_CODIGO, type FonteCusto } from './vendas-sku';
import { round2 } from './formato';

export interface PontoSerie {
  intervalo: Intervalo;
  unidades: number;
  bruto: number;
  lucro: number | null;
  fonteCusto: FonteCusto;
  /** Média ponderada por quantidade dos itens faturáveis do SKU; null sem venda. */
  precoMedio: number | null;
  precoMin: number | null;
  precoMax: number | null;
}

export function serieDoSku(p: {
  vendas: Venda[]; agrupar: (vs: Venda[]) => Pedido[]; codigos: string[]; intervalos: Intervalo[];
  catalogo: Map<string, CatalogoSku>; ordensDevolvidas: Set<number>;
}): PontoSerie[] {
  const codigos = new Set(p.codigos);
  return p.intervalos.map((intervalo) => {
    const ini = Date.parse(intervalo.inicio);
    const fim = Date.parse(intervalo.fim);
    const vendasDoIv = p.vendas.filter((v) => {
      if (!v.date_closed) return false;
      const t = Date.parse(v.date_closed);
      return t >= ini && t < fim;
    });
    const pedidos = p.agrupar(vendasDoIv);
    const janela = { desde: intervalo.inicio, ate: new Date(fim - 1).toISOString() };
    const linhas = agregarPorSku(pedidos, janela, p.catalogo, p.ordensDevolvidas).filter((l) => codigos.has(l.codigo));
    const acc = somarAcumuladores(linhas.map((l) => l.acc));
    const m = metricas(acc);

    let qtd = 0; let valor = 0; let min: number | null = null; let max: number | null = null;
    for (const ped of pedidos) {
      if (!dentroDaJanela(ped.data, janela)) continue; // mesmo corte de agregarPorSku
      for (const it of ped.itens) {
        if (!it.faturavel || !codigos.has(it.codigo?.trim() || SEM_CODIGO)) continue;
        qtd += it.quantity;
        valor += it.unit_price * it.quantity;
        min = min == null ? it.unit_price : Math.min(min, it.unit_price);
        max = max == null ? it.unit_price : Math.max(max, it.unit_price);
      }
    }
    return {
      intervalo, unidades: acc.unidades, bruto: round2(acc.bruto), lucro: m.lucro, fonteCusto: m.fonteCusto,
      precoMedio: qtd > 0 ? round2(valor / qtd) : null, precoMin: min, precoMax: max,
    };
  });
}
