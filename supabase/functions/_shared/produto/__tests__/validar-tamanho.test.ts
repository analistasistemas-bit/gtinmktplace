import { describe, expect, it } from 'vitest';
import { montarLinhasProduto, validarProdutoNovo, type ProdutoEntrada } from '../validar';

const CTX = {
  loteId: 'lote-1', userId: 'user-1', orgId: 'org-1',
  codigoPai: '00000001', codigos: ['00000002', '00000003'],
  chaveCadastro: '11111111-1111-4111-8111-111111111111',
};

function base(over: Partial<ProdutoEntrada> = {}): ProdutoEntrada {
  return {
    nomePai: 'Camiseta Básica',
    origem: 'nacional',
    chaveCadastro: '11111111-1111-4111-8111-111111111111',
    variacoes: [{ nome: 'Azul', preco: 50 }],
    ...over,
  };
}

describe('genero', () => {
  it('ausente e valido — e o caso de toda org sem tipo de produto habilitado', () => {
    expect(validarProdutoNovo(base())).toEqual([]);
  });

  it('valor fora dos tres aceitos e recusado, nunca corrigido em silencio', () => {
    const erros = validarProdutoNovo(base({ genero: 'masc' as never }));
    expect(erros).toContainEqual({ campo: 'genero', mensagem: expect.stringMatching(/masculino.*feminino.*unissex/i) });
  });

  it('aceita os tres valores', () => {
    for (const g of ['masculino', 'feminino', 'unissex'] as const) {
      expect(validarProdutoNovo(base({ genero: g }))).toEqual([]);
    }
  });

  // R3 da revisao do Fable: o genero era opcional no cadastro e obrigatorio na publicacao, sem
  // nenhuma tela para corrigir — o produto nascia impublicavel e o operador nao tinha caminho.
  // Agora o cadastro RECUSA na entrada, com 400 explicito, no momento em que da para arrumar.
  it('tamanho preenchido SEM genero e recusado JA no cadastro', () => {
    const erros = validarProdutoNovo(base({
      genero: null,
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }],
    }));
    expect(erros).toContainEqual({
      campo: 'genero',
      mensagem: expect.stringMatching(/g[eê]nero/i),
    });
  });

  it('basta UMA variacao com tamanho para o genero virar obrigatorio', () => {
    const erros = validarProdutoNovo(base({
      variacoes: [{ nome: 'Azul', preco: 50 }, { nome: 'Preto', tamanho: 'M', preco: 50 }],
    }));
    expect(erros.some((e) => e.campo === 'genero')).toBe(true);
  });

  it('com tamanho E genero informado, passa', () => {
    expect(validarProdutoNovo(base({
      genero: 'feminino',
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }],
    }))).toEqual([]);
  });

  it('sem tamanho nenhum, genero ausente continua valido — INV-1 intacto', () => {
    expect(validarProdutoNovo(base({ variacoes: [{ nome: 'Azul', preco: 50 }] }))).toEqual([]);
  });
});

describe('tamanho', () => {
  it('duas variacoes com a MESMA cor e MESMO tamanho sao recusadas (SKU duplicado)', () => {
    const erros = validarProdutoNovo(base({
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }, { nome: 'Azul', tamanho: 'P', preco: 60 }],
    }));
    expect(erros).toContainEqual({ campo: 'variacoes', mensagem: expect.stringMatching(/Azul.*P/) });
  });

  it('mesma cor com tamanhos diferentes e o caso NORMAL da feature', () => {
    expect(validarProdutoNovo(base({
      genero: 'unissex',
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }, { nome: 'Azul', tamanho: 'M', preco: 50 }],
    }))).toEqual([]);
  });

  it('duas variacoes sem tamanho e sem cor continuam aceitas (comportamento de hoje)', () => {
    expect(validarProdutoNovo(base({
      variacoes: [{ preco: 50 }, { preco: 60 }],
    }))).toEqual([]);
  });
});

describe('montarLinhasProduto', () => {
  it('sem genero nem tamanho, as colunas novas saem null — payload de hoje intacto', () => {
    const { familia, variacoes } = montarLinhasProduto(base(), CTX);
    expect(familia.genero).toBeNull();
    expect(variacoes[0].tamanho).toBeNull();
  });

  it('grava genero na familia e tamanho na variacao, aparados', () => {
    const { familia, variacoes } = montarLinhasProduto(base({
      genero: 'feminino',
      variacoes: [{ nome: 'Azul', tamanho: '  P  ', preco: 50 }],
    }), CTX);
    expect(familia.genero).toBe('feminino');
    expect(variacoes[0].tamanho).toBe('P');
  });

  it('tamanho vazio vira null, nunca string vazia', () => {
    const { variacoes } = montarLinhasProduto(base({
      variacoes: [{ nome: 'Azul', tamanho: '   ', preco: 50 }],
    }), CTX);
    expect(variacoes[0].tamanho).toBeNull();
  });

  it('cor continua vindo de `nome` com cor_origem manual (ADR-0004 intacto)', () => {
    const { variacoes } = montarLinhasProduto(base({
      variacoes: [{ nome: 'Azul', tamanho: 'P', preco: 50 }],
    }), CTX);
    expect(variacoes[0].cor).toBe('Azul');
    expect(variacoes[0].cor_origem).toBe('manual');
  });
});
