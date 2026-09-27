import type { Intervalo } from '@/lib/calendario-brt';
import type { PontoSerie } from '@/lib/sku-dossie';

// Larguras dos eixos: a régua de intervalos embaixo do gráfico usa as mesmas medidas para cair
// exatamente sob cada barra (eixo X categórico = faixas iguais na área de plotagem).
export const MARGEM = 4;
export const EIXO_UNID = 32;
export const EIXO_LUCRO = 40;
// ponytail: largura mínima por intervalo; acima disso (1 ano em semanas) rola dentro do cartão.
export const MIN_POR_INTERVALO = 14;

export const TOOLTIP = {
  contentStyle: { backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)', fontSize: 12 },
  labelStyle: { color: 'var(--popover-foreground)', fontWeight: 500, marginBottom: 2 },
  itemStyle: { color: 'var(--popover-foreground)', padding: 0 },
  cursor: { fill: 'var(--muted)', fillOpacity: 0.5 },
  separator: ': ',
};
export const EIXO = { fontSize: 11, fill: 'var(--muted-foreground)' };
export const kCompacto = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(Math.abs(v) >= 10_000 ? 0 : 1).replace('.', ',')}k` : String(Math.round(v)));

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

/** Cadência dos rótulos da régua: um a cada `passoLg` em sm+, um a cada `passoSm` no celular. passoSm é
 *  múltiplo de passoLg, senão um rótulo visível no celular sumiria em sm (ex.: 30 dias → 5 e 2). */
export function passosRotulo(n: number): { passoSm: number; passoLg: number } {
  const passoLg = Math.max(1, Math.ceil(n / 16));
  return { passoSm: passoLg * Math.max(1, Math.ceil(Math.ceil(n / 6) / passoLg)), passoLg };
}

/** Eixo de 0 a um topo redondo (passo 1/2/2,5/5 × 10^k, até 5 ticks) que cobre `max`. */
export function escalaRedonda(max: number): { topo: number; ticks: number[] } {
  if (!(max > 0)) return { topo: 1, ticks: [0, 1] };
  const bruto = max / 4;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = ([1, 2, 2.5, 5, 10].find((k) => k * mag >= bruto - 1e-12) ?? 10) * mag;
  const n = Math.ceil(max / passo - 1e-9);
  const ticks = Array.from({ length: n + 1 }, (_, i) => Number((i * passo).toPrecision(12)));
  return { topo: ticks[n], ticks };
}
