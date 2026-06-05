import { describe, it, expect } from 'vitest';
import { casarVariacoesUpdate } from '../casar';

const anteriores = [
  { codigo: '00000101', ml_variation_id: 'V1', cor: 'Azul', cor_origem: 'descricao', ml_picture_id: 'P1', estoque: 5 },
  { codigo: '00000102', ml_variation_id: 'V2', cor: 'Verde', cor_origem: 'vision', ml_picture_id: 'P2', estoque: 8 },
];

describe('casarVariacoesUpdate', () => {
  it('cor casada herda ml_variation_id, cor, cor_origem, ml_picture_id e snapshot do estoque', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000101' }], anteriores);
    expect(r.herdados['00000101']).toEqual({
      ml_variation_id: 'V1', cor: 'Azul', cor_origem: 'descricao', ml_picture_id: 'P1', estoque_anterior: 5,
    });
  });
  it('cor nova (sem correspondente) herda nulos e vira mudança estrutural', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000999' }], anteriores);
    expect(r.herdados['00000999']).toEqual({
      ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null,
    });
    expect(r.mudancaEstrutural.novas).toEqual(['00000999']);
  });
  it('cor removida (no anúncio, ausente no lote) entra em removidas', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000101' }], anteriores);
    expect(r.mudancaEstrutural.removidas).toEqual([{ codigo: '00000102', cor: 'Verde' }]);
  });
  it('sem mudança estrutural quando o conjunto de códigos bate', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000101' }, { codigo: '00000102' }], anteriores);
    expect(r.mudancaEstrutural.novas).toEqual([]);
    expect(r.mudancaEstrutural.removidas).toEqual([]);
  });
});
