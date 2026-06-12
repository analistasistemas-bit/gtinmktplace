import { describe, it, expect } from 'vitest';
import { extrairItensAnalise } from '../extrair-itens';

describe('extrairItensAnalise', () => {
  it('planilha enxuta (sem PAI): cada linha com GTIN/preço/custo vira item', () => {
    const rows = [
      { NOME: 'LINHA 150 15000MT', UNIDADE: 'UN', GTIN: '3000025438427', PRECO: 39.9, CUSTO: 21.16 },
      { NOME: 'LINHA 150 15000MT (P)', UNIDADE: 'UN', GTIN: '3000025438267', PRECO: 21.16, CUSTO: 39.9 },
    ];
    const { itens, ignorados } = extrairItensAnalise(rows);
    expect(ignorados).toBe(0);
    expect(itens).toEqual([
      { gtin: '3000025438427', nome: 'LINHA 150 15000MT', unidade: 'UN', minimo: 39.9, custo: 21.16 },
      { gtin: '3000025438267', nome: 'LINHA 150 15000MT (P)', unidade: 'UN', minimo: 21.16, custo: 39.9 },
    ]);
  });

  it('aceita decimal com vírgula (pt-BR) vindo como string', () => {
    const rows = [{ NOME: 'X', UNIDADE: 'UN', GTIN: '789', PRECO: '39,900000', CUSTO: '21,161200' }];
    const { itens } = extrairItensAnalise(rows);
    expect(itens[0].minimo).toBeCloseTo(39.9, 2);
    expect(itens[0].custo).toBeCloseTo(21.1612, 4);
  });

  it('aceita decimal en-US e separadores de milhar', () => {
    const rows = [
      { NOME: 'A', UNIDADE: 'UN', GTIN: '1', PRECO: '39.90', CUSTO: '21.16' },
      { NOME: 'B', UNIDADE: 'UN', GTIN: '2', PRECO: '1.234,56', CUSTO: '1,234.56' },
    ];
    const { itens } = extrairItensAnalise(rows);
    expect(itens[0].minimo).toBeCloseTo(39.9, 2);
    expect(itens[0].custo).toBeCloseTo(21.16, 2);
    expect(itens[1].minimo).toBeCloseTo(1234.56, 2);
    expect(itens[1].custo).toBeCloseTo(1234.56, 2);
  });

  it('planilha completa: pula linhas de agrupador (PAI = 0) e usa só as 5 colunas', () => {
    const rows = [
      { CODIGO: '10', PAI: '0', NOME: 'PAI AGRUP', UNIDADE: 'UN', GTIN: '111', PRECO: 5, CUSTO: 2, ESTOQUE: 0 },
      { CODIGO: '11', PAI: '10', NOME: 'FILHO AZUL', UNIDADE: 'UN', GTIN: '222', PRECO: 5, CUSTO: 2, ESTOQUE: 3 },
    ];
    const { itens } = extrairItensAnalise(rows);
    expect(itens.map((i) => i.gtin)).toEqual(['222']);
  });

  it('descarta e conta linhas sem GTIN ou sem preço/custo válidos', () => {
    const rows = [
      { NOME: 'OK', UNIDADE: 'UN', GTIN: '789', PRECO: 5, CUSTO: 2 },
      { NOME: 'SEM GTIN', UNIDADE: 'UN', GTIN: null, PRECO: 5, CUSTO: 2 },
      { NOME: 'SEM PRECO', UNIDADE: 'UN', GTIN: '790', PRECO: null, CUSTO: 2 },
    ];
    const { itens, ignorados } = extrairItensAnalise(rows);
    expect(itens.map((i) => i.gtin)).toEqual(['789']);
    expect(ignorados).toBe(2);
  });

  it('lança erro claro quando falta uma das 5 colunas obrigatórias', () => {
    const rows = [{ NOME: 'X', GTIN: '789', PRECO: 5, CUSTO: 2 }]; // falta UNIDADE
    expect(() => extrairItensAnalise(rows)).toThrow(/UNIDADE/);
  });
});
