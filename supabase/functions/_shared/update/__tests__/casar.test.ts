import { describe, it, expect } from 'vitest';
import { casarVariacoesUpdate, excluidaNoUpdate } from '../casar';

const anteriores = [
  { codigo: '00000101', ml_variation_id: 'V1', cor: 'Azul', cor_origem: 'descricao', ml_picture_id: 'P1', estoque: 5, preco_publicacao: 12 },
  { codigo: '00000102', ml_variation_id: 'V2', cor: 'Verde', cor_origem: 'vision', ml_picture_id: 'P2', estoque: 8, preco_publicacao: 20 },
];

describe('casarVariacoesUpdate', () => {
  it('cor casada herda ml_variation_id, cor, cor_origem, ml_picture_id, snapshot do estoque e preço publicado', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000101' }], anteriores);
    expect(r.herdados['00000101']).toEqual({
      ml_variation_id: 'V1', cor: 'Azul', cor_origem: 'descricao', ml_picture_id: 'P1', estoque_anterior: 5, preco_publicacao: 12,
    });
  });
  it('cor nova (sem correspondente) herda nulos e vira mudança estrutural', () => {
    const r = casarVariacoesUpdate([{ codigo: '00000999' }], anteriores);
    expect(r.herdados['00000999']).toEqual({
      ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null, preco_publicacao: null,
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

describe('excluidaNoUpdate', () => {
  it('Legacy: cor casada (ml_variation_id) entra mesmo sem foto', () => {
    expect(excluidaNoUpdate({ mlVariationId: 'V1', ativaUP: false, temFoto: false, estoque: 5 })).toBe(false);
  });
  it('UP: SKU ativo no ML entra mesmo sem foto e com ml_variation_id null (ADR-0088)', () => {
    expect(excluidaNoUpdate({ mlVariationId: null, ativaUP: true, temFoto: false, estoque: 5 })).toBe(false);
  });
  it('cor nova sem foto entra desmarcada', () => {
    expect(excluidaNoUpdate({ mlVariationId: null, ativaUP: false, temFoto: false, estoque: 5 })).toBe(true);
  });
  it('cor nova com foto e estoque entra marcada; sem estoque, desmarcada', () => {
    expect(excluidaNoUpdate({ mlVariationId: null, ativaUP: false, temFoto: true, estoque: 5 })).toBe(false);
    expect(excluidaNoUpdate({ mlVariationId: null, ativaUP: false, temFoto: true, estoque: 0 })).toBe(true);
  });
});
