import { describe, it, expect } from 'vitest';
import { agruparPorPai } from '../parser';
import type { PlanilhaRow } from '../types';

function row(p: Partial<PlanilhaRow> & { CODIGO: string; PAI: string }): PlanilhaRow {
  return {
    NOME: 'X',
    UNIDADE: 'UN',
    GTIN: null,
    CUSTO: 1,
    PRECO: 1,
    ESTOQUE: 1,
    DESCRICAO_DETALHADO: 'd',
    PESO_GRAMAS: 1,
    ALTURA_CM: 1,
    LARGURA_CM: 1,
    COMPRIMENTO_CM: 1,
    FORNECEDOR: 'ACME',
    ...p,
  };
}

describe('agruparPorPai', () => {
  it('caso feliz: 1 PAI + 2 filhos → 1 família com 2 variações, sem anomalias', () => {
    const rows = [
      row({ CODIGO: '100', PAI: '0', NOME: 'LINHA' }),
      row({ CODIGO: '101', PAI: '100' }),
      row({ CODIGO: '102', PAI: '100' }),
    ];
    const { grupos, anomalias } = agruparPorPai(rows);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].codigo_pai).toBe('00000100');
    expect(grupos[0].variacoes).toHaveLength(2);
    expect(anomalias.codigos_duplicados).toEqual([]);
    expect(anomalias.filhos_orfaos).toEqual([]);
    expect(anomalias.familias_sem_filho).toEqual([]);
  });

  it('CODIGO duplicado: mantém a 1ª ocorrência e contabiliza o descartado', () => {
    const rows = [
      row({ CODIGO: '100', PAI: '0' }),
      row({ CODIGO: '101', PAI: '100', NOME: 'PRIMEIRA' }),
      row({ CODIGO: '101', PAI: '100', NOME: 'DUPLICADA' }),
    ];
    const { grupos, anomalias } = agruparPorPai(rows);

    expect(grupos[0].variacoes).toHaveLength(1);
    expect(grupos[0].variacoes[0].NOME).toBe('PRIMEIRA');
    expect(anomalias.codigos_duplicados).toEqual(['00000101']);
  });

  it('filho órfão: descarta o filho sem lançar e contabiliza', () => {
    const rows = [
      row({ CODIGO: '100', PAI: '0' }),
      row({ CODIGO: '101', PAI: '100' }),
      row({ CODIGO: '999', PAI: '888' }),
    ];
    const { grupos, anomalias } = agruparPorPai(rows);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].variacoes).toHaveLength(1);
    expect(anomalias.filhos_orfaos).toEqual(['00000999']);
  });

  it('PAI sem filho: descarta a família sem lançar e contabiliza', () => {
    const rows = [
      row({ CODIGO: '100', PAI: '0' }),
      row({ CODIGO: '101', PAI: '100' }),
      row({ CODIGO: '200', PAI: '0', NOME: 'PAI VAZIO' }),
    ];
    const { grupos, anomalias } = agruparPorPai(rows);

    expect(grupos).toHaveLength(1);
    expect(grupos[0].codigo_pai).toBe('00000100');
    expect(anomalias.familias_sem_filho).toEqual(['00000200']);
  });

  it('popula fornecedor a partir da linha PAI', () => {
    const rows = [
      row({ CODIGO: '100', PAI: '0', NOME: 'LINHA', FORNECEDOR: 'LINHAS SETTA LTDA' }),
      row({ CODIGO: '101', PAI: '100', FORNECEDOR: 'IGNORADO' }),
    ];
    const { grupos } = agruparPorPai(rows);
    expect(grupos[0].fornecedor).toBe('LINHAS SETTA LTDA');
  });

  it('combinação das três anomalias coexiste num só lote', () => {
    const rows = [
      row({ CODIGO: '100', PAI: '0' }),
      row({ CODIGO: '101', PAI: '100' }),
      row({ CODIGO: '101', PAI: '100' }), // duplicado
      row({ CODIGO: '200', PAI: '0' }), // pai sem filho
      row({ CODIGO: '999', PAI: '888' }), // órfão
    ];
    const { grupos, anomalias } = agruparPorPai(rows);

    expect(grupos).toHaveLength(1);
    expect(anomalias.codigos_duplicados).toEqual(['00000101']);
    expect(anomalias.familias_sem_filho).toEqual(['00000200']);
    expect(anomalias.filhos_orfaos).toEqual(['00000999']);
  });
});
