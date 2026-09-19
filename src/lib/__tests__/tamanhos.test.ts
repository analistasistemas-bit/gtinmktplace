import { describe, expect, it } from 'vitest';
import {
  TAMANHOS_ROUPA, NUMERACOES_CALCADO, LIMITE_VARIACOES_GERADAS,
  opcoesDeTamanho, gerarCombinacoes, numeracaoPublicavel,
} from '@/lib/tamanhos';

describe('TAMANHOS_ROUPA', () => {
  it('e a lista fechada decidida no grilling', () => {
    expect(TAMANHOS_ROUPA).toEqual(['P', 'M', 'G', 'GG', 'Tamanho Único']);
  });
});

describe('NUMERACOES_CALCADO', () => {
  it('vem da fonte unica com os pares de meio-numero do padrao ML', () => {
    expect(NUMERACOES_CALCADO).toContain('39/40');
  });
});

describe('opcoesDeTamanho', () => {
  it('org sem tipo nao oferece nenhum grupo — o campo Tamanho nem aparece', () => {
    expect(opcoesDeTamanho([])).toEqual([]);
  });

  it('so roupa oferece so Tamanho', () => {
    expect(opcoesDeTamanho(['roupa']).map((g) => g.grupo)).toEqual(['Tamanho']);
  });

  it('so calcado oferece so Numeracao', () => {
    expect(opcoesDeTamanho(['calcado']).map((g) => g.grupo)).toEqual(['Numeração']);
  });

  it('os dois habilitados oferecem os dois grupos (combinavel, nao exclusivo)', () => {
    expect(opcoesDeTamanho(['calcado', 'roupa']).map((g) => g.grupo)).toEqual(['Tamanho', 'Numeração']);
  });
});

describe('gerarCombinacoes', () => {
  it('produto cartesiano na ordem cor-externa, tamanho-interno', () => {
    expect(gerarCombinacoes(['Azul', 'Preto'], ['P', 'M'])).toEqual([
      { cor: 'Azul', tamanho: 'P' },
      { cor: 'Azul', tamanho: 'M' },
      { cor: 'Preto', tamanho: 'P' },
      { cor: 'Preto', tamanho: 'M' },
    ]);
  });

  it('sem tamanho marcado devolve uma linha por cor, com tamanho nulo', () => {
    expect(gerarCombinacoes(['Azul', 'Preto'], [])).toEqual([
      { cor: 'Azul', tamanho: null },
      { cor: 'Preto', tamanho: null },
    ]);
  });

  it('sem cor e sem tamanho devolve lista vazia — nao inventa uma linha', () => {
    expect(gerarCombinacoes([], [])).toEqual([]);
  });

  it('sem cor mas com tamanho devolve uma linha por tamanho, com cor vazia', () => {
    expect(gerarCombinacoes([], ['P', 'M'])).toEqual([
      { cor: '', tamanho: 'P' },
      { cor: '', tamanho: 'M' },
    ]);
  });

  it('deduplica e apara cor e tamanho', () => {
    expect(gerarCombinacoes([' Azul ', 'Azul', ''], ['P', 'P'])).toEqual([
      { cor: 'Azul', tamanho: 'P' },
    ]);
  });

  // Trava LOUD: `proximo_codigo_produto` reserva variacoes.length + 1 codigos de 8 digitos, e o
  // cartesiano estoura facil. Descobrir o limite em producao (D-5) seria um cadastro perdido.
  it('acima do limite LANCA com mensagem acionavel, nunca trunca', () => {
    const cores = Array.from({ length: 13 }, (_, i) => `Cor ${i}`);
    expect(() => gerarCombinacoes(cores, ['P', 'M', 'G', 'GG', 'Tamanho Único']))
      .toThrow(/65 variações.*limite de 60/i);
  });

  it('exatamente no limite nao lanca', () => {
    const cores = Array.from({ length: 12 }, (_, i) => `Cor ${i}`);
    expect(gerarCombinacoes(cores, ['P', 'M', 'G', 'GG', 'Tamanho Único']))
      .toHaveLength(LIMITE_VARIACOES_GERADAS);
  });
});

describe('numeracaoPublicavel (spec 2026-09-19 §2, aviso inline)', () => {
  it('numeração isolada dentro da tabela do gênero é publicável', () => {
    expect(numeracaoPublicavel('42', 'masculino')).toBe(true);
    expect(numeracaoPublicavel('42', 'feminino')).toBe(true);
  });

  // COMPRIMENTO_PE_CM.feminino para em 44; masculino vai até 48. O aviso é POR GÊNERO.
  it('45/46 publicam no masculino e NÃO publicam no feminino', () => {
    expect(numeracaoPublicavel('45', 'masculino')).toBe(true);
    expect(numeracaoPublicavel('46', 'masculino')).toBe(true);
    expect(numeracaoPublicavel('45', 'feminino')).toBe(false);
    expect(numeracaoPublicavel('46', 'feminino')).toBe(false);
  });

  // Spike 051 §13: o ML não publica chart STANDARD "Sem gênero"; unissex reaproveita a masculina.
  it('unissex segue a tabela masculina', () => {
    expect(numeracaoPublicavel('45', 'unissex')).toBe(true);
  });

  it('par de meio-número nunca publica — não existe comprimento de pé para dois números num SKU', () => {
    expect(numeracaoPublicavel('45/46', 'masculino')).toBe(false);
    expect(numeracaoPublicavel('33/34', 'feminino')).toBe(false);
  });

  // Sem gênero escolhido ainda, não dá para afirmar que NÃO publica — não assustar o operador
  // com um aviso que some assim que ele preencher o campo logo acima.
  it('sem gênero escolhido, não afirma que é impublicável', () => {
    expect(numeracaoPublicavel('45', '')).toBe(true);
  });

  it('tamanho de roupa não é assunto desta função', () => {
    expect(numeracaoPublicavel('P', 'masculino')).toBe(true);
  });
});
