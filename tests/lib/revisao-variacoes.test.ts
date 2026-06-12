import { describe, it, expect } from 'vitest';
import { compararCor, variacoesParaRevisao } from '../../src/lib/revisao-variacoes';
import type { Variacao } from '../../src/lib/tipos-dominio';

function v(over: Partial<Variacao>): Variacao {
  return {
    codigo: '00000001', cor: 'Azul', corHex: '#00f', corOrigem: 'descricao',
    corEditadaPeloOperador: false, preco: 10, precoPublicacao: 12.5, estoque: 5,
    gtin: null, fotoPath: 'u/l.jpeg', excluidaDaPublicacao: false,
    mlVariationId: null, estoqueAnterior: null, custo: null,
    pesoGramas: null, alturaCm: null, larguraCm: null, comprimentoCm: null,
    ...over,
  };
}

describe('compararCor', () => {
  it('ordena alfabético case/acento-insensível', () => {
    const arr = [v({ cor: 'verde' }), v({ cor: 'Ámbar' }), v({ cor: 'Azul' })];
    expect([...arr].sort(compararCor).map((x) => x.cor)).toEqual(['Ámbar', 'Azul', 'verde']);
  });
  it('sufixo numérico natural (2 antes de 10)', () => {
    const arr = [v({ cor: 'Azul 10' }), v({ cor: 'Azul 2' })];
    expect([...arr].sort(compararCor).map((x) => x.cor)).toEqual(['Azul 2', 'Azul 10']);
  });
  it('sem cor cai no código', () => {
    const arr = [v({ cor: '', codigo: 'B' }), v({ cor: '', codigo: 'A' })];
    expect([...arr].sort(compararCor).map((x) => x.codigo)).toEqual(['A', 'B']);
  });
});

describe('variacoesParaRevisao', () => {
  const lista = [
    v({ codigo: '1', cor: 'Vinho', mlVariationId: '900' }),    // publicada
    v({ codigo: '2', cor: 'Amarelo', mlVariationId: null }),   // não publicada
    v({ codigo: '3', cor: 'Branco', mlVariationId: '901' }),   // publicada
  ];

  it('não publicada: todas, em ordem alfabética', () => {
    expect(variacoesParaRevisao(lista, false).map((x) => x.cor)).toEqual(['Amarelo', 'Branco', 'Vinho']);
  });
  it('publicada: só as sem ml_variation_id (não conseguiram publicar)', () => {
    expect(variacoesParaRevisao(lista, true).map((x) => x.cor)).toEqual(['Amarelo']);
  });
  it('publicada com tudo no ML → lista vazia', () => {
    const todas = [v({ cor: 'A', mlVariationId: '1' }), v({ cor: 'B', mlVariationId: '2' })];
    expect(variacoesParaRevisao(todas, true)).toHaveLength(0);
  });
  it('não muta a entrada', () => {
    const orig = [v({ cor: 'Z' }), v({ cor: 'A' })];
    variacoesParaRevisao(orig, false);
    expect(orig.map((x) => x.cor)).toEqual(['Z', 'A']);
  });
});
