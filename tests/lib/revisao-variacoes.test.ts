import { describe, it, expect } from 'vitest';
import { compararCor, variacoesParaRevisao, coresNovasComEstoque, agruparRevisaoUpdate, coresSemFotoExcluidas } from '../../src/lib/revisao-variacoes';
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
  it('ocultarSemEstoque: esconde variações com estoque 0', () => {
    const arr = [
      v({ cor: 'Azul', estoque: 0 }),
      v({ cor: 'Branco', estoque: 7 }),
      v({ cor: 'Verde', estoque: 0 }),
    ];
    expect(variacoesParaRevisao(arr, false, true).map((x) => x.cor)).toEqual(['Branco']);
  });
  it('ocultarSemEstoque desligado (padrão): mantém estoque 0', () => {
    const arr = [v({ cor: 'Azul', estoque: 0 }), v({ cor: 'Branco', estoque: 7 })];
    expect(variacoesParaRevisao(arr, false).map((x) => x.cor)).toEqual(['Azul', 'Branco']);
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
    concorrenciaCategoriaId: null,
    ...over,
  } as Familia;
}

describe('agruparRevisaoUpdate', () => {
  it('separa reposição (com ml_variation_id) de novas (sem)', () => {
    const arr = [
      v({ codigo: '1', cor: 'Azul', mlVariationId: '900' }),
      v({ codigo: '2', cor: 'Nova', mlVariationId: null }),
      v({ codigo: '3', cor: 'Branco', mlVariationId: '901' }),
    ];
    const g = agruparRevisaoUpdate(arr);
    expect(g.reposicao.map((x) => x.cor)).toEqual(['Azul', 'Branco']);
    expect(g.novas.map((x) => x.cor)).toEqual(['Nova']);
  });
  it('todas reposição → novas vazio', () => {
    const arr = [v({ mlVariationId: '1' }), v({ mlVariationId: '2' })];
    const g = agruparRevisaoUpdate(arr);
    expect(g.reposicao).toHaveLength(2);
    expect(g.novas).toHaveLength(0);
  });
  it('preserva a ordem recebida', () => {
    const arr = [v({ codigo: 'B', mlVariationId: '1' }), v({ codigo: 'A', mlVariationId: '2' })];
    expect(agruparRevisaoUpdate(arr).reposicao.map((x) => x.codigo)).toEqual(['B', 'A']);
  });
});

describe('coresNovasComEstoque', () => {
  it('conta cor sem ml_variation_id e com estoque (precisa foto)', () => {
    const f = fam({
      variacoes: [
        v({ codigo: '1', cor: 'Vinho', mlVariationId: '900', estoque: 5 }), // casada
        v({ codigo: '2', cor: 'Cereja', mlVariationId: null, estoque: 50 }), // nova
        v({ codigo: '3', cor: 'Amarelo', mlVariationId: null, estoque: 49 }), // nova
      ],
    });
    expect(coresNovasComEstoque(f).map((x) => x.cor)).toEqual(['Amarelo', 'Cereja']);
  });
  it('NÃO depende de mudancaEstrutural.novas (cor da família nunca publicada conta)', () => {
    // Regressão do bug: cor sem ml_variation_id mas FORA de mudancaEstrutural.novas.
    const f = fam({
      mudancaEstrutural: { novas: [], removidas: [] },
      variacoes: [v({ codigo: '99', cor: 'Azul Turqueza', mlVariationId: null, estoque: 330 })],
    });
    expect(coresNovasComEstoque(f).map((x) => x.cor)).toEqual(['Azul Turqueza']);
  });
  it('exclui estoque 0 (dorme até reposição)', () => {
    const f = fam({
      variacoes: [
        v({ codigo: '1', cor: 'Cereja', mlVariationId: null, estoque: 0 }),
        v({ codigo: '2', cor: 'Azul', mlVariationId: null, estoque: 5 }),
      ],
    });
    expect(coresNovasComEstoque(f).map((x) => x.cor)).toEqual(['Azul']);
  });
  it('CREATE → vazio (não é reposição de anúncio)', () => {
    expect(coresNovasComEstoque(fam({ operacao: 'CREATE' }))).toHaveLength(0);
  });
  it('todas casadas → vazio', () => {
    const f = fam({ variacoes: [v({ mlVariationId: '9', estoque: 5 })] });
    expect(coresNovasComEstoque(f)).toHaveLength(0);
  });
});

describe('coresSemFotoExcluidas', () => {
  it('conta cor excluída, sem foto e com estoque, em ordem alfabética', () => {
    const f = fam({
      operacao: 'CREATE',
      variacoes: [
        v({ codigo: '1', cor: 'Verde Botânico', fotoPath: undefined, excluidaDaPublicacao: true, estoque: 34 }),
        v({ codigo: '2', cor: 'Cereja', fotoPath: undefined, excluidaDaPublicacao: true, estoque: 36 }),
        v({ codigo: '3', cor: 'Azul', fotoPath: 'u/azul.jpeg', excluidaDaPublicacao: false, estoque: 10 }),
      ],
    });
    expect(coresSemFotoExcluidas(f).map((x) => x.cor)).toEqual(['Cereja', 'Verde Botânico']);
  });
  it('ignora estoque 0 (dorme até reposição, não precisa avisar)', () => {
    const f = fam({
      variacoes: [v({ codigo: '1', cor: 'Cereja', fotoPath: undefined, excluidaDaPublicacao: true, estoque: 0 })],
    });
    expect(coresSemFotoExcluidas(f)).toHaveLength(0);
  });
  it('ignora cor excluída que TEM foto (exclusão manual, não por falta de foto)', () => {
    const f = fam({
      variacoes: [v({ codigo: '1', cor: 'Azul', fotoPath: 'u/azul.jpeg', excluidaDaPublicacao: true, estoque: 10 })],
    });
    expect(coresSemFotoExcluidas(f)).toHaveLength(0);
  });
  it('ignora cor sem foto que está INCLUÍDA (não foi desmarcada)', () => {
    const f = fam({
      variacoes: [v({ codigo: '1', cor: 'Azul', fotoPath: undefined, excluidaDaPublicacao: false, estoque: 10 })],
    });
    expect(coresSemFotoExcluidas(f)).toHaveLength(0);
  });
});
