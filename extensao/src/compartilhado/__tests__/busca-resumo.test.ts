import { describe, expect, it } from 'vitest';
import { filtrarCards, ordenarCards, resumoBusca, type ResultadoBusca } from '../busca-resumo';
import type { CardBusca } from '../../leitura/busca';

const card = (itemId: string, o: Partial<CardBusca> = {}): CardBusca => ({
  itemId, catalogProductId: null, userProductId: null, posicao: null, titulo: itemId, preco: 100, vendedor: null, nota: null,
  vendidosTexto: null, freteGratis: null, full: null, lojaOficial: null, patrocinado: false, selos: [], ...o,
});
const ok = (pct: number, premium = pct - 4): ResultadoBusca => ({
  itemId: 'x', estado: 'ok', fonte: 'catalogo', codigo: '001',
  margem: { preco: 100, classico: { estado: 'ok', valor: { margemPct: pct, lucro: pct } as never }, premium: { estado: 'ok', valor: { margemPct: premium, lucro: premium } as never } },
  custo: {} as never,
});

const cards = [
  card('MLB1', { preco: 50, vendidosTexto: '+10mil vendidos', full: true, catalogProductId: 'MLB100', lojaOficial: true, selos: ['OFERTA DO DIA'] }),
  card('MLB2', { preco: 80, vendidosTexto: '+500 vendidos', freteGratis: true, patrocinado: true, catalogProductId: 'MLB100' }),
  card('MLB3', { preco: 20, vendidosTexto: '4 vendidos' }),
  card('MLB4', { preco: null }),
];

describe('resumoBusca (Task 22)', () => {
  it('conta por produto único e soma só os mínimos informados, sem somar o mesmo catálogo duas vezes', () => {
    const r = resumoBusca(cards, { MLB1: ok(12) }, 6);
    expect(r).toMatchObject({
      ocorrencias: 6, produtos: 4, menorPreco: 20, maiorPreco: 80, full: 1, freteGratis: 1, oficiais: 1, patrocinados: 1,
      comOferta: 1, comCatalogo: 2, semCatalogo: 2, vinculados: 1,
      vendidosMinimos: { soma: 10004, cobertura: 3 },
    });
  });
});

describe('filtrarCards / ordenarCards', () => {
  const resultados = { MLB1: ok(12), MLB2: ok(30), MLB3: { itemId: 'MLB3', estado: 'sem_vinculo' } as ResultadoBusca };
  it('filtros combinam (e)', () => {
    expect(filtrarCards(cards, resultados, new Set(['seus'])).map((c) => c.itemId)).toEqual(['MLB1', 'MLB2']);
    expect(filtrarCards(cards, resultados, new Set(['seus', 'full'])).map((c) => c.itemId)).toEqual(['MLB1']);
    expect(filtrarCards(cards, resultados, new Set(['catalogo'])).map((c) => c.itemId)).toEqual(['MLB1', 'MLB2']);
  });
  it('ordena por vendidos (mínimo), preço e margem; desconhecidos sempre no fim', () => {
    expect(ordenarCards(cards, resultados, 'vendidos').map((c) => c.itemId)).toEqual(['MLB1', 'MLB2', 'MLB3', 'MLB4']);
    expect(ordenarCards(cards, resultados, 'preco').map((c) => c.itemId)).toEqual(['MLB3', 'MLB1', 'MLB2', 'MLB4']);
    expect(ordenarCards(cards, resultados, 'margem').map((c) => c.itemId)).toEqual(['MLB2', 'MLB1', 'MLB3', 'MLB4']);
  });
});
