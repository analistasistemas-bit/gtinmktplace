import { describe, it, expect } from 'vitest';
import { validarProdutoNovo, montarLinhasProduto } from '../validar';
import type { ProdutoEntrada } from '../validar';

const valido: ProdutoEntrada = {
  nomePai: 'Camiseta básica',
  descricaoPai: 'Camiseta de algodão',
  unidade: 'UN',
  fornecedor: 'Fornecedor X',
  origem: 'nacional',
  chaveCadastro: '11111111-1111-1111-1111-111111111111',
  variacoes: [
    { nome: 'Azul', gtin: '7891234567895', preco: 49.9, custo: 20, estoqueInicial: 10 },
    { nome: 'Rosa', gtin: '7891234567901', preco: 49.9, custo: 20, estoqueInicial: 5 },
  ],
};

describe('validarProdutoNovo', () => {
  it('produto completo não tem erro', () => {
    expect(validarProdutoNovo(valido)).toEqual([]);
  });

  it('exige nomePai', () => {
    expect(validarProdutoNovo({ ...valido, nomePai: '' }).map((x) => x.campo)).toContain('nomePai');
  });

  it('exige ao menos uma variação', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [] }).map((x) => x.campo)).toContain('variacoes');
  });

  it('exige preço positivo', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ preco: 0 }] })
      .map((x) => x.campo)).toContain('variacoes[0].preco');
    expect(validarProdutoNovo({ ...valido, variacoes: [{ preco: -1 }] })
      .map((x) => x.campo)).toContain('variacoes[0].preco');
  });

  it('custo informado tem que ser positivo — zero é erro, ausente não é', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ preco: 10, custo: 0 }] })
      .map((x) => x.campo)).toContain('variacoes[0].custo');
    expect(validarProdutoNovo({ ...valido, variacoes: [{ preco: 10, custo: null }] }))
      .toEqual([]);
  });

  it('estoque inicial negativo é erro', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ preco: 10, estoqueInicial: -1 }] })
      .map((x) => x.campo)).toContain('variacoes[0].estoqueInicial');
  });

  // Idempotência da submissão (spec 2026-07-31, D-9): sem chave válida, um retry duplica o
  // produto e o estoque inicial — o código é gerado, então os guards de duplicata não pegam.
  it('exige chaveCadastro em formato UUID', () => {
    expect(validarProdutoNovo({ ...valido, chaveCadastro: '' }).map((x) => x.campo))
      .toContain('chaveCadastro');
    expect(validarProdutoNovo({ ...valido, chaveCadastro: 'nao-uuid' }).map((x) => x.campo))
      .toContain('chaveCadastro');
  });

  // ADR-0055: familias.origem é NOT NULL com DEFAULT 'nacional'. Sem esta trava, um cliente
  // que omitisse o campo gravaria o produto como nacional em silêncio e pagaria a alíquota
  // errada — exatamente o incidente de 2026-07-14 do ingest-lote.
  it('origem ausente FALHA em vez de virar nacional por default', () => {
    const { origem: _omitida, ...semOrigem } = valido;
    expect(validarProdutoNovo(semOrigem as ProdutoEntrada).map((x) => x.campo)).toContain('origem');
  });

  it('origem inválida FALHA', () => {
    expect(validarProdutoNovo({ ...valido, origem: 'NACIONAL' as unknown as 'nacional' })
      .map((x) => x.campo)).toContain('origem');
  });

  it('importado é origem válida', () => {
    expect(validarProdutoNovo({ ...valido, origem: 'importado' })).toEqual([]);
  });
});

describe('montarLinhasProduto', () => {
  const ctx = {
    loteId: 'lote-1', userId: 'user-1', orgId: 'org-1',
    codigoPai: '09912345', codigos: ['09912346', '09912347'],
    chaveCadastro: '11111111-1111-1111-1111-111111111111',
  };

  it('família nasce como CREATE e pendente', () => {
    const { familia } = montarLinhasProduto(valido, ctx);
    expect(familia.operacao).toBe('CREATE');
    expect(familia.status).toBe('pendente');
    expect(familia.lote_id).toBe('lote-1');
    expect(familia.org_id).toBe('org-1');
    expect(familia.codigo_pai).toBe('09912345');
    expect(familia.chave_cadastro).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('grava a origem informada, nunca o default da coluna', () => {
    expect(montarLinhasProduto({ ...valido, origem: 'importado' }, ctx).familia.origem).toBe('importado');
    expect(montarLinhasProduto(valido, ctx).familia.origem).toBe('nacional');
  });

  it('estoque das variações nasce ZERO — quem soma é registrar_entrada', () => {
    const { variacoes } = montarLinhasProduto(valido, ctx);
    expect(variacoes.every((v) => v.estoque === 0)).toBe(true);
  });

  it('uma linha por variação, com org_id, user_id e código gerado propagados', () => {
    const { variacoes } = montarLinhasProduto(valido, ctx);
    expect(variacoes).toHaveLength(2);
    expect(variacoes.every((v) => v.org_id === 'org-1' && v.user_id === 'user-1')).toBe(true);
    expect(variacoes.map((v) => v.codigo)).toEqual(['09912346', '09912347']);
  });

  it('trima os textos', () => {
    const { familia } = montarLinhasProduto({ ...valido, nomePai: '  Camiseta básica  ' }, ctx);
    expect(familia.nome_pai).toBe('Camiseta básica');
  });

  // Fixa o comportamento: `preco` grava CRU, sem arredondar aqui. O Postgres parseia o texto
  // decimal do JSON e arredonda para numeric(12,2) na escrita — arredondar de novo neste ponto
  // (Step 3b, revertido) era desnecessário e um `?? 0`/`!` sobre entrada inválida gravaria
  // R$ 0,00 em silêncio (achado de revisão, Task 4b fix round 1). Não reintroduzir.
  it('grava preco exatamente como recebido, sem arredondar — quem arredonda é o Postgres (numeric(12,2))', () => {
    const { variacoes } = montarLinhasProduto(
      { ...valido, variacoes: [{ ...valido.variacoes[0], preco: 1.005 }] }, ctx,
    );
    expect(variacoes[0].preco).toBe(1.005);
  });
});
