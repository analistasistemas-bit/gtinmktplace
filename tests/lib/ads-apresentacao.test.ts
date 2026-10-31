import { describe, expect, it } from 'vitest';
import type { FamiliaPainel } from '@/lib/ads-painel';
import {
  ATALHO_ACIMA_EQUILIBRIO, buscarFamiliasAds, contarFamiliasAds, filtrarFamiliasAds, ordenarFamiliasAds,
} from '@/lib/ads-apresentacao';

const base: FamiliaPainel = {
  codigoPai: 'A',
  nome: 'Fam A',
  grupos: 1,
  custoCompartilhado: 0,
  custo: 50,
  vendasDiretas: 400,
  vendasTotais: 500,
  cliques: 0,
  impressoes: 0,
  roas: 10,
  roasDireto: 8,
  acos: 0.1,
  acosDireto: 0.125,
  lucroAntes: 250,
  resultado: 200,
  margemConsumida: 0.2,
  acosEquilibrio: 0.25,
  semaforo: 'dentro',
  motivo: null,
  fonteCusto: 'real',
};

describe('apresentação de famílias Ads', () => {
  const familias: FamiliaPainel[] = [
    base,
    { ...base, codigoPai: 'B', semaforo: 'acima' },
    { ...base, codigoPai: 'C', semaforo: null },
    { ...base, codigoPai: 'D', semaforo: 'sem_espaco' },
  ];

  it('conta estados e preserva a ordem recebida', () => {
    expect(contarFamiliasAds(familias, true)).toEqual({
      total: 4,
      acima: 1,
      semEspaco: 1,
      dentro: 1,
      semReferencia: 1,
    });

    expect(filtrarFamiliasAds(familias, 'acima', true).map(f => f.codigoPai))
      .toEqual(['B']);
    expect(filtrarFamiliasAds(familias, 'dentro', true).map(f => f.codigoPai))
      .toEqual(['A']);
    expect(filtrarFamiliasAds(familias, 'sem_referencia', true).map(f => f.codigoPai))
      .toEqual(['C']);
  });

  it('semáforo desligado torna todas sem referência', () => {
    expect(contarFamiliasAds(familias, false)).toEqual({
      total: 4,
      acima: 0,
      semEspaco: 0,
      dentro: 0,
      semReferencia: 4,
    });
    expect(filtrarFamiliasAds(familias, 'acima', false)).toEqual([]);
    expect(filtrarFamiliasAds(familias, 'sem_referencia', false)).toEqual(familias);
  });
});

describe('busca, ordenação e atalho das famílias Ads', () => {
  const f = (codigoPai: string, nome: string | null, o: Partial<FamiliaPainel> = {}): FamiliaPainel =>
    ({ ...base, codigoPai, nome, ...o });
  const lista = [
    f('P1', 'Calça Jeans', { custo: 10, semaforo: 'acima', acosDireto: 0.3, resultado: null }),
    f('P2', 'Camiseta Básica', { custo: 30, semaforo: 'dentro', acosDireto: null, resultado: 5 }),
    f('P3', null, { custo: 30, semaforo: 'acima', acosDireto: 0.1, resultado: 9 }),
    f('P4', 'Boné', { custo: 20, semaforo: null, acosDireto: 0.2, resultado: -3 }),
  ];
  const ids = (l: FamiliaPainel[]) => l.map(x => x.codigoPai);

  it('busca por nome e código, sem acento nem caixa', () => {
    expect(ids(buscarFamiliasAds(lista, 'calca'))).toEqual(['P1']);
    expect(ids(buscarFamiliasAds(lista, ' BONE '))).toEqual(['P4']);
    expect(ids(buscarFamiliasAds(lista, 'p3'))).toEqual(['P3']);
    expect(buscarFamiliasAds(lista, '  ')).toEqual(lista);
    expect(buscarFamiliasAds(lista, 'zzz')).toEqual([]);
  });

  it('ordena de forma estável, com nulos sempre no fim nas duas direções', () => {
    expect(ids(ordenarFamiliasAds(lista, 'investimento', 'desc'))).toEqual(['P2', 'P3', 'P4', 'P1']);
    expect(ids(ordenarFamiliasAds(lista, 'investimento', 'asc'))).toEqual(['P1', 'P4', 'P2', 'P3']);
    expect(ids(ordenarFamiliasAds(lista, 'acos_direto', 'asc'))).toEqual(['P3', 'P4', 'P1', 'P2']);
    expect(ids(ordenarFamiliasAds(lista, 'acos_direto', 'desc'))).toEqual(['P1', 'P4', 'P3', 'P2']);
    expect(ids(ordenarFamiliasAds(lista, 'resultado', 'asc'))).toEqual(['P4', 'P2', 'P3', 'P1']);
    expect(ids(ordenarFamiliasAds(lista, 'resultado', 'desc'))).toEqual(['P3', 'P2', 'P4', 'P1']);
    expect(ids(ordenarFamiliasAds(lista, 'nome', 'asc'))).toEqual(['P4', 'P1', 'P2', 'P3']);
    expect(ids(ordenarFamiliasAds(lista, 'nome', 'desc'))).toEqual(['P2', 'P1', 'P4', 'P3']);
    expect(ids(lista)).toEqual(['P1', 'P2', 'P3', 'P4']); // não muta a entrada
  });

  it('busca e filtro não alteram as contagens da lista inteira', () => {
    const antes = contarFamiliasAds(lista, true);
    const achadas = buscarFamiliasAds(filtrarFamiliasAds(lista, 'acima', true), 'p3');
    expect(ids(achadas)).toEqual(['P3']);
    expect(contarFamiliasAds(lista, true)).toEqual(antes);
    expect(antes.acima).toBe(2);
  });

  it('atalho acima do equilíbrio filtra e ordena por maior investimento', () => {
    expect(ATALHO_ACIMA_EQUILIBRIO).toEqual({ filtro: 'acima', coluna: 'investimento', direcao: 'desc' });
    const { filtro, coluna, direcao } = ATALHO_ACIMA_EQUILIBRIO;
    expect(ids(ordenarFamiliasAds(filtrarFamiliasAds(lista, filtro, true), coluna, direcao))).toEqual(['P3', 'P1']);
    expect(filtrarFamiliasAds(lista, 'acima', false)).toEqual([]);
  });
});
