import { describe, expect, it } from 'vitest';
import {
  TAMANHOS_ROUPA, NUMERACOES_CALCADO,
  opcoesDeTamanho, numeracaoPublicavel, classificarFamilia, tipoDaGrade, tamanhosDoTipo,
} from '@/lib/tamanhos';

describe('TAMANHOS_ROUPA', () => {
  it('e a lista fechada decidida no grilling', () => {
    expect(TAMANHOS_ROUPA).toEqual(['P', 'M', 'G', 'GG']);
  });

  // Spike 051 §12: testado contra a API real — não existe guia de tamanhos para "Tamanho Único"
  // nos domínios de vestuário suportados, então publicar com esse valor falha SEMPRE. Sair da
  // lista é sair da whitelist da edge, não só sumir da tela.
  it('não oferece "Tamanho Único" — o ML não publica esse valor', () => {
    expect(TAMANHOS_ROUPA).not.toContain('Tamanho Único');
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

// Ruling R1: a regra "é grade" e o tipo inferido vêm da fonte única de `_shared` (o dialog de
// "Adicionar variação" e a edge precisam decidir igual).
describe('reexports da fonte única', () => {
  it('classificarFamilia, tipoDaGrade e tamanhosDoTipo estão disponíveis no front', () => {
    expect(classificarFamilia([{ tamanho: 'P', excluida_da_publicacao: false }])).toBe('grade');
    expect(tipoDaGrade(['38'])).toBe('calcado');
    expect(tamanhosDoTipo('roupa')).toEqual(TAMANHOS_ROUPA);
  });
});
