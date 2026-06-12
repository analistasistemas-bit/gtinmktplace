import { describe, it, expect } from 'vitest';
import { compararCor, variacoesParaRevisao, coresNovasPendentes } from '../../src/lib/revisao-variacoes';
import type { Familia, Variacao } from '../../src/lib/tipos-dominio';

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

function fam(over: Partial<Familia>): Familia {
  return {
    id: 'f1', loteId: 'l1', codigoPai: '00000100', titulo: 'FITA', descricao: 'd',
    operacao: 'UPDATE', estrategiaPreco: 'PROPRIO', estrategiaMotivo: '',
    concorrencia: 'sem', concorrenciaVendedores: 0, concorrenciaPrecoMin: null,
    analiseMercado: null, tipoAviamento: 'fita', categoriaMlId: 'MLB255054',
    precoMin: 12.5, precoMax: 12.5, precoAbaixo20pc: false, capaStoragePath: null,
    variacoes: [], status: 'publicado', tokensInput: null, tokensOutput: null,
    custoCentavos: null, tituloEditadoPeloOperador: false,
    descricaoEditadaPeloOperador: false, variacoesSemCor: 0,
    mlPermalink: null, mlItemId: 'MLB1', erroMensagem: null, mudancaEstrutural: null,
    ...over,
  } as Familia;
}

describe('coresNovasPendentes', () => {
  it('exclui as cores novas já publicadas (com ml_variation_id)', () => {
    const f = fam({
      mudancaEstrutural: { novas: ['1', '2', '3'], removidas: [] },
      variacoes: [
        v({ codigo: '1', cor: 'Vinho', mlVariationId: '900' }),   // já publicada
        v({ codigo: '2', cor: 'Cereja', mlVariationId: null }),    // pendente
        v({ codigo: '3', cor: 'Amarelo', mlVariationId: null }),   // pendente
      ],
    });
    expect(coresNovasPendentes(f).map((x) => x.cor)).toEqual(['Amarelo', 'Cereja']);
  });
  it('todas publicadas → lista vazia', () => {
    const f = fam({
      mudancaEstrutural: { novas: ['1'], removidas: [] },
      variacoes: [v({ codigo: '1', cor: 'X', mlVariationId: '9' })],
    });
    expect(coresNovasPendentes(f)).toHaveLength(0);
  });
  it('sem mudança estrutural → vazio', () => {
    expect(coresNovasPendentes(fam({ mudancaEstrutural: null }))).toHaveLength(0);
  });
});
