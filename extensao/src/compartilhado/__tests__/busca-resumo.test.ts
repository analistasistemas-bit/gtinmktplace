import { describe, expect, it } from 'vitest';
import { filtrarCards, ordenarCards, resumoBusca, type ResultadoBusca } from '../busca-resumo';
import type { CardBusca } from '../../leitura/busca';

const card = (itemId: string, o: Partial<CardBusca> = {}): CardBusca => ({
  itemId, catalogProductId: null, userProductId: null, posicao: null, titulo: itemId, preco: 100, vendedor: null, nota: null,
  vendidosTexto: null, freteGratis: null, full: null, lojaOficial: null, patrocinado: false, selos: [], miniaturaUrl: null, ocorrencias: [], ...o,
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
      vendidosMinimos: { soma: 10004, cobertura: 2, grupos: 3 },
    });
  });
});

describe('totais por grupo de vendas (modo busca completo)', () => {
  const oc = (preco: number | null, posicao = 1) => ({ posicao, patrocinado: false, preco });
  it('volume: menor contribuição completa do grupo, sem misturar piso de um card com preço de outro', () => {
    const g = [
      card('MLB1', { catalogProductId: 'MLB100', vendidosTexto: '+100 vendidos', preco: 30, ocorrencias: [oc(30), oc(20, 2)] }),
      card('MLB2', { catalogProductId: 'MLB100', vendidosTexto: null, preco: 10, ocorrencias: [oc(10)] }),
      card('MLB3', { vendidosTexto: '+10 vendidos', preco: null, ocorrencias: [oc(null)] }),
    ];
    const r = resumoBusca(g, {}, 4);
    expect(r.volumeMinimo).toEqual({ centavos: 200000, cobertura: 1, grupos: 2, conflitos: 0 });
    expect(r.vendidosMinimos).toMatchObject({ soma: 110, cobertura: 2, grupos: 2 });
    expect(r).toMatchObject({ ocorrencias: 4, produtos: 3 });
  });
  it('/up/ comprovada propaga o catálogo do outro item; /up/ com dois catálogos exclui o grupo e conta conflito', () => {
    const prop = [
      card('MLB1', { catalogProductId: 'MLB100', userProductId: 'MLBU1', vendidosTexto: '+50 vendidos', ocorrencias: [oc(10)] }),
      card('MLB2', { userProductId: 'MLBU1', vendidosTexto: '+50 vendidos', ocorrencias: [oc(8)] }),
    ];
    expect(resumoBusca(prop, {}, 2).vendidosMinimos).toMatchObject({ soma: 50, grupos: 1 });
    const conf = [
      card('MLB1', { catalogProductId: 'MLB100', userProductId: 'MLBU1', vendidosTexto: '+50 vendidos', ocorrencias: [oc(10)] }),
      card('MLB2', { catalogProductId: 'MLB200', userProductId: 'MLBU1', vendidosTexto: '+70 vendidos', ocorrencias: [oc(8)] }),
      card('MLB3', { vendidosTexto: '+5 vendidos', ocorrencias: [oc(1)] }),
    ];
    const r = resumoBusca(conf, {}, 3);
    expect(r.vendidosMinimos).toMatchObject({ soma: 5, cobertura: 1, grupos: 1 });
    expect(r.volumeMinimo).toMatchObject({ centavos: 500, grupos: 1, conflitos: 1 });
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
