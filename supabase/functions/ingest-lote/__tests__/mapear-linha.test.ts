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
});
