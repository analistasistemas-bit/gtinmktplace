import { describe, it, expect } from 'vitest';
import { mapearLinha } from '../mapear-linha.ts';

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

  it('defaults seguros quando campos faltam/são nulos', () => {
    const r = mapearLinha({ CODIGO: 5 });
    expect(r.PAI).toBe('0');
    expect(r.GTIN).toBeNull();
    expect(r.CUSTO).toBe(0);
    expect(r.CODIGO).toBe('5');
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
