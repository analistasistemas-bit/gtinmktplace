import { describe, it, expect } from 'vitest';
import { propsAnaliseDaVariacao, variacaoRepresentativa } from '../analise-viabilidade';
import type { Familia, Variacao } from '../tipos-dominio';

const variacao = (over: Partial<Variacao>): Variacao => ({
  codigo: 'C', cor: 'Cor', corHex: '#000', corOrigem: null, corEditadaPeloOperador: false,
  preco: 10, precoPublicacao: 20, precoPublicadoMl: null, estoque: 5, gtin: null, excluidaDaPublicacao: false,
  mlVariationId: null, estoqueAnterior: null, custo: 5, pesoGramas: 100,
  alturaCm: 1, larguraCm: 2, comprimentoCm: 3, ...over,
});

const familia = (variacoes: Variacao[]): Familia => ({ variacoes } as Familia);

describe('variacaoRepresentativa', () => {
  it('escolhe a de menor preço de publicação entre as incluídas', () => {
    const f = familia([
      variacao({ codigo: 'A', precoPublicacao: 36.6 }),
      variacao({ codigo: 'B', precoPublicacao: 105.95 }),
      variacao({ codigo: 'C', precoPublicacao: 45.95 }),
    ]);
    expect(variacaoRepresentativa(f)?.codigo).toBe('A');
  });

  it('ignora as excluídas quando há incluídas', () => {
    const f = familia([
      variacao({ codigo: 'A', precoPublicacao: 10, excluidaDaPublicacao: true }),
      variacao({ codigo: 'B', precoPublicacao: 40 }),
    ]);
    expect(variacaoRepresentativa(f)?.codigo).toBe('B');
  });

  it('cai no preço quando precoPublicacao é null', () => {
    const f = familia([
      variacao({ codigo: 'A', precoPublicacao: null, preco: 8 }),
      variacao({ codigo: 'B', precoPublicacao: 30, preco: 5 }),
    ]);
    expect(variacaoRepresentativa(f)?.codigo).toBe('A');
  });

  it('retorna null sem variações', () => {
    expect(variacaoRepresentativa(familia([]))).toBeNull();
  });
});

describe('propsAnaliseDaVariacao', () => {
  it('mapeia preço (publicação), custo, piso e dimensões da variação', () => {
    const v = variacao({ precoPublicacao: 105.95, preco: 78, custo: 60, alturaCm: 4 });
    expect(propsAnaliseDaVariacao(v)).toEqual({
      preco: 105.95,
      custo: 60,
      piso: 78,
      dimensoes: { alturaCm: 4, larguraCm: 2, comprimentoCm: 3, pesoGramas: 100 },
    });
  });

  it('usa o piso (preco) como preço quando não há preço de publicação', () => {
    expect(propsAnaliseDaVariacao(variacao({ precoPublicacao: null, preco: 22.5 })).preco).toBe(22.5);
  });
});
