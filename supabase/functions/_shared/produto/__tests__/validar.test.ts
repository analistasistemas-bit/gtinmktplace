import { describe, it, expect } from 'vitest';
import { validarProdutoNovo, montarLinhasProduto } from '../validar';
import type { ProdutoEntrada } from '../validar';

const valido: ProdutoEntrada = {
  codigoPai: '09912345',
  nomePai: 'Camiseta básica',
  descricaoPai: 'Camiseta de algodão',
  unidade: 'UN',
  fornecedor: 'Fornecedor X',
  origem: 'nacional',
  variacoes: [
    { codigo: '09912345AZ', nome: 'Azul', gtin: '7891234567895', preco: 49.9, custo: 20, estoqueInicial: 10 },
    { codigo: '09912345RS', nome: 'Rosa', gtin: '7891234567901', preco: 49.9, custo: 20, estoqueInicial: 5 },
  ],
};

describe('validarProdutoNovo', () => {
  it('produto completo não tem erro', () => {
    expect(validarProdutoNovo(valido)).toEqual([]);
  });

  it('exige codigoPai', () => {
    const e = validarProdutoNovo({ ...valido, codigoPai: '  ' });
    expect(e.map((x) => x.campo)).toContain('codigoPai');
  });

  it('exige nomePai', () => {
    expect(validarProdutoNovo({ ...valido, nomePai: '' }).map((x) => x.campo)).toContain('nomePai');
  });

  it('exige ao menos uma variação', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [] }).map((x) => x.campo)).toContain('variacoes');
  });

  it('exige codigo em cada variação', () => {
    const e = validarProdutoNovo({ ...valido, variacoes: [{ codigo: '', preco: 10 }] });
    expect(e.map((x) => x.campo)).toContain('variacoes[0].codigo');
  });

  it('rejeita codigo de variação duplicado', () => {
    const e = validarProdutoNovo({
      ...valido,
      variacoes: [{ codigo: 'A1', preco: 10 }, { codigo: 'A1', preco: 10 }],
    });
    expect(e.map((x) => x.campo)).toContain('variacoes[1].codigo');
  });

  it('exige preço positivo', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: 0 }] })
      .map((x) => x.campo)).toContain('variacoes[0].preco');
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: -1 }] })
      .map((x) => x.campo)).toContain('variacoes[0].preco');
  });

  it('custo informado tem que ser positivo — zero é erro, ausente não é', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: 10, custo: 0 }] })
      .map((x) => x.campo)).toContain('variacoes[0].custo');
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: 10, custo: null }] }))
      .toEqual([]);
  });

  it('estoque inicial negativo é erro', () => {
    expect(validarProdutoNovo({ ...valido, variacoes: [{ codigo: 'A1', preco: 10, estoqueInicial: -1 }] })
      .map((x) => x.campo)).toContain('variacoes[0].estoqueInicial');
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
  const ctx = { loteId: 'lote-1', userId: 'user-1', orgId: 'org-1' };

  it('família nasce como CREATE e pendente', () => {
    const { familia } = montarLinhasProduto(valido, ctx);
    expect(familia.operacao).toBe('CREATE');
    expect(familia.status).toBe('pendente');
    expect(familia.lote_id).toBe('lote-1');
    expect(familia.org_id).toBe('org-1');
    expect(familia.codigo_pai).toBe('09912345');
  });

  it('grava a origem informada, nunca o default da coluna', () => {
    expect(montarLinhasProduto({ ...valido, origem: 'importado' }, ctx).familia.origem).toBe('importado');
    expect(montarLinhasProduto(valido, ctx).familia.origem).toBe('nacional');
  });

  it('estoque das variações nasce ZERO — quem soma é registrar_entrada', () => {
    const { variacoes } = montarLinhasProduto(valido, ctx);
    expect(variacoes.every((v) => v.estoque === 0)).toBe(true);
  });

  it('uma linha por variação, com org_id e user_id propagados', () => {
    const { variacoes } = montarLinhasProduto(valido, ctx);
    expect(variacoes).toHaveLength(2);
    expect(variacoes.every((v) => v.org_id === 'org-1' && v.user_id === 'user-1')).toBe(true);
  });

  it('trima os textos', () => {
    const { familia } = montarLinhasProduto({ ...valido, codigoPai: '  09912345  ' }, ctx);
    expect(familia.codigo_pai).toBe('09912345');
  });
});
