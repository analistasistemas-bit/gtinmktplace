import { describe, expect, it } from 'vitest';
import { indiceHistorico, pontosDaSerie, ultimoComPreco } from '../serie-pontos';
import type { PontoSerie } from '@/lib/sku-dossie';

const p = (inicio: string, fim: string, incompleto: boolean, over: Partial<PontoSerie> = {}): PontoSerie => ({
  intervalo: { inicio, fim, rotulo: inicio.slice(8, 10), incompleto, inicioParcial: false }, unidades: 1, bruto: 10, lucro: 5,
  fonteCusto: 'real', precoMedio: 10, precoMin: 10, precoMax: 10, unidadesKit: 0, pedidos: [], ...over,
});
const serie = [
  p('2026-09-07T03:00:00.000Z', '2026-09-14T03:00:00.000Z', false, { lucro: 4 }),
  p('2026-09-14T03:00:00.000Z', '2026-09-21T03:00:00.000Z', false, { lucro: 6 }),
  p('2026-09-21T03:00:00.000Z', '2026-09-28T03:00:00.000Z', true, { lucro: 2, precoMedio: null, precoMin: null, precoMax: null }),
];

describe('pontosDaSerie', () => {
  it('o lucro do intervalo parcial aparece no tooltip (uma vez por ponto)', () => {
    const d = pontosDaSerie(serie, [0, 0, 0]);
    expect(d.map((x) => x.lucroTooltip)).toEqual([4, 6, 2]);
    expect(d[2].lucro).toBeNull(); // o traço sólido para no último completo
    expect(d[2].lucroParcial).toBe(2);
  });
});

describe('ultimoComPreco', () => {
  it('é o último intervalo com preço, não necessariamente o último', () => {
    expect(ultimoComPreco(serie)).toBe(1);
    expect(ultimoComPreco([])).toBe(-1);
  });
});

describe('indiceHistorico', () => {
  it('marca o 1º intervalo quando a 1ª venda cai dentro dele', () => {
    expect(indiceHistorico(serie, '2026-09-09T12:00:00Z')).toBe(0);
  });
  it('marca o intervalo que contém a 1ª venda', () => {
    expect(indiceHistorico(serie, '2026-09-16T12:00:00Z')).toBe(1);
  });
  it('sem marcador quando o histórico começa antes do 1º intervalo', () => {
    expect(indiceHistorico(serie, '2026-08-01T12:00:00Z')).toBe(-1);
    expect(indiceHistorico(serie, null)).toBe(-1);
  });
});
