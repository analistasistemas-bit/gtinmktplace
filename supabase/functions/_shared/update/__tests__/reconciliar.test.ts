import { describe, it, expect } from 'vitest';
import { reconciliarCasamentoComML, type MlVariacaoExistente } from '../reconciliar';
import type { ResultadoCasamento } from '../casar';

function casamento(over: Partial<ResultadoCasamento>): ResultadoCasamento {
  return {
    herdados: {},
    mudancaEstrutural: { novas: [], removidas: [] },
    ...over,
  };
}

describe('reconciliarCasamentoComML', () => {
  it('reclassifica código "novo" que já existe no ML como casado (adota var_id + cor)', () => {
    const cas = casamento({
      herdados: {
        '00220809': { ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null, preco_publicacao: null },
      },
      mudancaEstrutural: { novas: ['00220809'], removidas: [] },
    });
    const ml: MlVariacaoExistente[] = [
      { id: '203375281741', seller_custom_field: '00220809', cor: 'Azul', available_quantity: 1207 },
    ];
    const r = reconciliarCasamentoComML(cas, ml);
    expect(r.mudancaEstrutural.novas).toEqual([]);
    expect(r.herdados['00220809']).toEqual({
      ml_variation_id: '203375281741',
      cor: 'Azul',
      cor_origem: 'manual',
      ml_picture_id: null,
      estoque_anterior: 1207,
      preco_publicacao: null,
    });
  });

  it('mantém como novo o código que o ML realmente não tem', () => {
    const cas = casamento({
      herdados: {
        '00999999': { ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null, preco_publicacao: null },
      },
      mudancaEstrutural: { novas: ['00999999'], removidas: [] },
    });
    const ml: MlVariacaoExistente[] = [
      { id: '203375281741', seller_custom_field: '00220809', cor: 'Azul', available_quantity: 1207 },
    ];
    const r = reconciliarCasamentoComML(cas, ml);
    expect(r.mudancaEstrutural.novas).toEqual(['00999999']);
    expect(r.herdados['00999999'].ml_variation_id).toBeNull();
  });

  it('casa por código normalizado (pad de 8) mesmo se o ML devolver sem zeros à esquerda', () => {
    const cas = casamento({
      herdados: {
        '00220809': { ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null, preco_publicacao: null },
      },
      mudancaEstrutural: { novas: ['00220809'], removidas: [] },
    });
    const ml: MlVariacaoExistente[] = [
      { id: '203375281741', seller_custom_field: '220809', cor: 'Azul', available_quantity: 5 },
    ];
    const r = reconciliarCasamentoComML(cas, ml);
    expect(r.mudancaEstrutural.novas).toEqual([]);
    expect(r.herdados['00220809'].ml_variation_id).toBe('203375281741');
  });

  it('adota a variação do ML mesmo sem cor (cor_origem null)', () => {
    const cas = casamento({
      herdados: {
        '00220809': { ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null, preco_publicacao: null },
      },
      mudancaEstrutural: { novas: ['00220809'], removidas: [] },
    });
    const ml: MlVariacaoExistente[] = [
      { id: '111', seller_custom_field: '00220809', cor: null, available_quantity: null },
    ];
    const r = reconciliarCasamentoComML(cas, ml);
    expect(r.herdados['00220809'].ml_variation_id).toBe('111');
    expect(r.herdados['00220809'].cor).toBeNull();
    expect(r.herdados['00220809'].cor_origem).toBeNull();
    expect(r.herdados['00220809'].estoque_anterior).toBeNull();
  });

  it('no-op quando não há cores novas (não chama nada, retorna igual)', () => {
    const cas = casamento({
      herdados: {
        '00220566': { ml_variation_id: '203313876609', cor: 'Branco', cor_origem: 'manual', ml_picture_id: null, estoque_anterior: 26028, preco_publicacao: 4 },
      },
      mudancaEstrutural: { novas: [], removidas: [] },
    });
    const r = reconciliarCasamentoComML(cas, []);
    expect(r).toEqual(cas);
  });

  it('preserva removidas e os demais herdados', () => {
    const cas = casamento({
      herdados: {
        '00220566': { ml_variation_id: '203313876609', cor: 'Branco', cor_origem: 'manual', ml_picture_id: null, estoque_anterior: 26028, preco_publicacao: 4 },
        '00220809': { ml_variation_id: null, cor: null, cor_origem: null, ml_picture_id: null, estoque_anterior: null, preco_publicacao: null },
      },
      mudancaEstrutural: { novas: ['00220809'], removidas: [{ codigo: '00299999', cor: 'Verde' }] },
    });
    const ml: MlVariacaoExistente[] = [
      { id: '203375281741', seller_custom_field: '00220809', cor: 'Azul', available_quantity: 1207 },
    ];
    const r = reconciliarCasamentoComML(cas, ml);
    expect(r.mudancaEstrutural.removidas).toEqual([{ codigo: '00299999', cor: 'Verde' }]);
    expect(r.herdados['00220566'].cor).toBe('Branco');
  });
});
