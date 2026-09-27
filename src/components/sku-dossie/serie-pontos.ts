import type { Intervalo } from '@/lib/calendario-brt';
import type { PontoSerie } from '@/lib/sku-dossie';

/** "(parcial)" no intervalo em andamento; "(início parcial)" no 1º, que começa antes do período. */
export const marcaParcial = (iv: Intervalo) => (iv.incompleto ? '(parcial)' : iv.inicioParcial ? '(início parcial)' : null);

/** Linhas do gráfico. O lucro tem 3 séries: `lucro` (traço sólido até o último completo),
 *  `lucroParcial` (tracejado até o intervalo em andamento) e `lucroTooltip` (invisível, um valor por
 *  ponto): as duas visíveis ficam fora do tooltip, senão o último completo apareceria duas vezes e o
 *  parcial nenhuma. */
export function pontosDaSerie(serie: PontoSerie[], perguntas: number[]) {
  // O intervalo em andamento é sempre o último.
  const ultimoCompleto = serie[serie.length - 1]?.intervalo.incompleto ? serie.length - 2 : serie.length - 1;
  return serie.map((p, i) => ({
    i, rotulo: p.intervalo.rotulo, marca: marcaParcial(p.intervalo), parcial: p.intervalo.incompleto,
    diretas: p.unidades - p.unidadesKit, kit: p.unidadesKit,
    lucro: p.intervalo.incompleto ? null : p.lucro,
    lucroParcial: p.intervalo.incompleto || i === ultimoCompleto ? p.lucro : null,
    lucroTooltip: p.lucro,
    precoMedio: p.precoMedio, precoMin: p.precoMin, precoMax: p.precoMax,
    bigode: p.precoMedio != null && p.precoMin != null && p.precoMax != null ? [p.precoMedio - p.precoMin, p.precoMax - p.precoMedio] : null,
    perguntas: perguntas[i] ?? 0,
  }));
}

/** Último intervalo com preço (o parcial pode não ter venda): onde vai o rótulo direto do preço. */
export function ultimoComPreco(serie: PontoSerie[]): number {
  for (let i = serie.length - 1; i >= 0; i--) if (serie[i].precoMedio != null) return i;
  return -1;
}

/** Intervalo do marcador "Histórico desde": o que contém a 1ª venda, quando ela cai depois do
 *  início do 1º intervalo (inclusive dentro dele). -1 = o histórico cobre o gráfico inteiro. */
export function indiceHistorico(serie: PontoSerie[], historicoDesde: string | null): number {
  if (!historicoDesde || !serie.length) return -1;
  const t = Date.parse(historicoDesde);
  if (t <= Date.parse(serie[0].intervalo.inicio)) return -1;
  return serie.findIndex((p) => t >= Date.parse(p.intervalo.inicio) && t < Date.parse(p.intervalo.fim));
}
