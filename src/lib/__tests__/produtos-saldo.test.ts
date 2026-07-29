import { describe, it, expect } from 'vitest';
import { agruparProdutosComSaldo } from '../produtos-saldo';

const linhas = [
  { codigo: 'A1', nome: 'Azul', cor: 'Azul', estoque: 5, custo: 10, preco: 30, familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', criado_em: '2026-07-02' } },
  { codigo: 'A2', nome: 'Rosa', cor: 'Rosa', estoque: 3, custo: 10, preco: 30, familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', criado_em: '2026-07-02' } },
  { codigo: 'B1', nome: null, cor: null, estoque: 0, custo: null, preco: 15, familias: { codigo_pai: 'P2', nome_pai: 'Meia', criado_em: '2026-07-01' } },
];

describe('agruparProdutosComSaldo', () => {
  it('agrupa variações pelo produto pai', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r).toHaveLength(2);
    expect(r.find((p) => p.codigoPai === 'P1')!.variacoes).toHaveLength(2);
  });

  it('soma o saldo total do produto', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r.find((p) => p.codigoPai === 'P1')!.saldoTotal).toBe(8);
    expect(r.find((p) => p.codigoPai === 'P2')!.saldoTotal).toBe(0);
  });

  it('ordena por nome do produto', () => {
    const r = agruparProdutosComSaldo(linhas as never);
    expect(r.map((p) => p.nomePai)).toEqual(['Camiseta', 'Meia']);
  });

  it('lista vazia devolve vazio', () => {
    expect(agruparProdutosComSaldo([])).toEqual([]);
  });

  // Âncora do ADR-0025: a família mais recente de cada codigo_pai é a canônica — a mesma
  // que baixar_estoque e o worker de push usam. Org de planilha tem N lotes do mesmo
  // produto; sem o corte a tela duplicaria a variação e somaria saldo histórico.
  it('mantém só a família mais recente de cada codigo_pai', () => {
    const r = agruparProdutosComSaldo([
      { codigo: 'A1', nome: null, cor: null, estoque: 2, custo: null, preco: 10,
        familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', criado_em: '2026-06-01' } },
      { codigo: 'A1', nome: null, cor: null, estoque: 9, custo: null, preco: 10,
        familias: { codigo_pai: 'P1', nome_pai: 'Camiseta', criado_em: '2026-07-02' } },
    ] as never);
    expect(r).toHaveLength(1);
    expect(r[0].variacoes).toHaveLength(1);
    expect(r[0].saldoTotal).toBe(9);
  });

  it('linha sem família é ignorada', () => {
    expect(agruparProdutosComSaldo([
      { codigo: 'X', nome: null, cor: null, estoque: 5, custo: null, preco: 1, familias: null },
    ] as never)).toEqual([]);
  });
});
