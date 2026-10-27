import { describe, it, expect } from 'vitest';
import { mapearLinha, normalizarCabecalhos } from '../mapear-linha.ts';
import { exigirOrigemExplicita } from '../verificar-origem.ts';
import { agruparPorPai } from '../../_shared/parser.ts';

const CRU = {
  CODIGO: '2841240', PAI: '0', NOME: 'FITAS DE VELUDO 25MM CORES', UNIDADE: 'PC',
  GTIN: '3000008412400', CUSTO: 28.79, PRECO: 78, ESTOQUE: 262,
  DESCRICAO_DETALHADO: 'desc', PESO_GRAMAS: 388, ALTURA_CM: 5.5, LARGURA_CM: 24.5,
  COMPRIMENTO_CM: 24.5, FORNECEDOR: 'BUFALO', ORIGEM: 'IMPORTADO',
};

describe('mapearLinha', () => {
  it('carrega ORIGEM da planilha (regressão: campo dropado → imposto sempre nacional)', () => {
    expect(mapearLinha(CRU).ORIGEM).toBe('IMPORTADO');
  });

  it('ORIGEM ausente → undefined (parser resolve p/ nacional)', () => {
    const { ORIGEM: _omit, ...semOrigem } = CRU;
    expect(mapearLinha(semOrigem).ORIGEM).toBeUndefined();
  });

  it('mapeia todos os campos da planilha (guarda contra drop silencioso de coluna)', () => {
    expect(mapearLinha(CRU)).toEqual({
      CODIGO: '2841240', PAI: '0', NOME: 'FITAS DE VELUDO 25MM CORES', UNIDADE: 'PC',
      GTIN: '3000008412400', CUSTO: 28.79, PRECO: 78, ESTOQUE: 262,
      DESCRICAO_DETALHADO: 'desc', PESO_GRAMAS: 388, ALTURA_CM: 5.5, LARGURA_CM: 24.5,
      COMPRIMENTO_CM: 24.5, FORNECEDOR: 'BUFALO', ORIGEM: 'IMPORTADO',
    });
  });

  it('GTIN inválido da planilha vira null (não chega à Revisão); 3000* fica', () => {
    expect(mapearLinha({ ...CRU, GTIN: 1 }).GTIN).toBeNull();
    expect(mapearLinha({ ...CRU, GTIN: '48251671' }).GTIN).toBeNull();
    expect(mapearLinha(CRU).GTIN).toBe('3000008412400');
    expect(mapearLinha({ ...CRU, GTIN: 7891234567895 }).GTIN).toBe('7891234567895');
    // UPC-A numérico perde o zero no XLSX: 012345678905 chega como 12345678905.
    expect(mapearLinha({ ...CRU, GTIN: 12345678905 }).GTIN).toBe('012345678905');
    // ID de fornecedor de 9 dígitos não ganha zeros (lote #48).
    expect(mapearLinha({ ...CRU, GTIN: 533100017 }).GTIN).toBeNull();
  });

  it('defaults seguros quando campos faltam/são nulos', () => {
    const r = mapearLinha({ CODIGO: 5 });
    expect(r.GTIN).toBeNull();
    expect(r.CUSTO).toBe(0);
    expect(r.CODIGO).toBe('5');
  });

  // ADR-0191: vazio ≠ 0 — vazio sem filhos é produto único, 0 é agrupador.
  it('PAI vazio/ausente fica vazio; PAI 0 numérico vira "0"', () => {
    expect(mapearLinha({ CODIGO: 5 }).PAI).toBe('');
    expect(mapearLinha({ ...CRU, PAI: null }).PAI).toBe('');
    expect(mapearLinha({ ...CRU, PAI: '  ' }).PAI).toBe('');
    expect(mapearLinha({ ...CRU, PAI: 0 }).PAI).toBe('0');
  });

  it('planilha Hairfly (só produtos únicos, PAI vazio) → um grupo por linha, ORIGEM aceita', () => {
    const rowsRaw = ['102873', '102865', '102857', '139220'].map((c) => ({
      ...CRU, CODIGO: c, PAI: null, ORIGEM: 'NACIONAL',
    }));
    expect(() => exigirOrigemExplicita(rowsRaw)).not.toThrow();
    const { grupos, anomalias } = agruparPorPai(rowsRaw.map(mapearLinha));
    expect(grupos.map((g) => [g.codigo_pai, g.variacoes.map((v) => v.CODIGO)])).toEqual([
      ['00102873', ['102873']], ['00102865', ['102865']],
      ['00102857', ['102857']], ['00139220', ['139220']],
    ]);
    expect(anomalias.familias_sem_filho).toEqual([]);
  });

  // Lote Hairfly 26/10: cabeçalho " PESO_GRAMAS" passava no validarColunas (trim) e o peso ia a 0.
  it('normalizarCabecalhos: espaço/minúscula no cabeçalho não zera o campo', () => {
    const { PESO_GRAMAS: _p, ALTURA_CM: _a, ...resto } = CRU;
    const r = mapearLinha(normalizarCabecalhos({ ...resto, ' PESO_GRAMAS': 1957, 'Altura_cm ': 26.8 }));
    expect(r.PESO_GRAMAS).toBe(1957);
    expect(r.ALTURA_CM).toBe(26.8);
  });

  it('carrega os 4 campos fiscais (ADR-0135)', () => {
    const r = mapearLinha({ ...CRU, NCM: '39269090', CEST: '0102300', ORIGEM_NFE: '1', CSOSN: '102' });
    expect(r.NCM).toBe('39269090');
    expect(r.CEST).toBe('0102300');
    expect(r.ORIGEM_NFE).toBe('1');
    expect(r.CSOSN).toBe('102');
  });

  it('ORIGEM_NFE = 0 (número, código NFe válido) sobrevive — não é a mesma armadilha do truthy de GTIN', () => {
    expect(mapearLinha({ ...CRU, ORIGEM_NFE: 0 }).ORIGEM_NFE).toBe('0');
  });

  it('campos fiscais ausentes → undefined (org sem módulo não é afetada)', () => {
    const r = mapearLinha(CRU);
    expect(r.NCM).toBeUndefined();
    expect(r.CEST).toBeUndefined();
    expect(r.ORIGEM_NFE).toBeUndefined();
    expect(r.CSOSN).toBeUndefined();
  });
});
