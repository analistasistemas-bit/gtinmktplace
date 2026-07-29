import { describe, it, expect } from 'vitest';
import { resolverAlvosPush } from '../alvos';

const estoques = { A1: 5, A2: 0, A3: 7 };

describe('resolverAlvosPush', () => {
  it('anúncio com variações recebe os SKUs que o mapa declara', () => {
    const r = resolverAlvosPush(
      [{ id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {}, A2: {} } }],
      [], estoques, null,
    );
    expect(r).toEqual([{
      canal: 'mercado_livre', itemExternoId: 'MLB1',
      estoques: [{ sku: 'A1', estoque: 5 }, { sku: 'A2', estoque: 0 }],
    }]);
  });

  it('mapa vazio → manda todos os SKUs do produto', () => {
    const r = resolverAlvosPush(
      [{ id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: {} }],
      [], estoques, null,
    );
    expect(r[0].estoques).toHaveLength(3);
  });

  it('exclui o canal de origem (venda já se decrementou lá)', () => {
    const r = resolverAlvosPush(
      [
        { id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
      ],
      [], estoques, 'mercado_livre',
    );
    expect(r.map((a) => a.canal)).toEqual(['fake']);
  });

  it('canal_origem null → push para todos (entrada, estorno, reconciliação)', () => {
    const r = resolverAlvosPush(
      [
        { id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
      ],
      [], estoques, null,
    );
    expect(r).toHaveLength(2);
  });

  it('split (ADR-0048): cada partição recebe só os SKUs que contém', () => {
    const r = resolverAlvosPush(
      [
        { id: 'p0', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } },
        { id: 'p1', canal: 'mercado_livre', item_externo_id: 'MLB2', variacoes_externas: { A3: {} } },
      ],
      [], estoques, null,
    );
    expect(r).toEqual([
      { canal: 'mercado_livre', itemExternoId: 'MLB1', estoques: [{ sku: 'A1', estoque: 5 }] },
      { canal: 'mercado_livre', itemExternoId: 'MLB2', estoques: [{ sku: 'A3', estoque: 7 }] },
    ]);
  });

  // CRÍTICO: numa família UP a linha-mãe de anuncios_externos fica com
  // item_externo_id NULL para sempre — os ids granulares vivem nos filhos
  // (_shared/user-products/publicar-familia-up.ts:72,123). A fixture reflete isso.
  it('user products (ADR-0088): pai com item_externo_id NULL, 1 alvo por item filho', () => {
    const r = resolverAlvosPush(
      [{ id: 'p0', canal: 'mercado_livre', item_externo_id: null, variacoes_externas: { A1: {}, A3: {} } }],
      [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'MLB-A1', retirado: false, status: 'ativo' },
        { anuncio_externo_id: 'p0', sku: 'A3', item_externo_id: 'MLB-A3', retirado: false, status: 'ativo' },
      ],
      estoques, null,
    );
    expect(r).toEqual([
      { canal: 'mercado_livre', itemExternoId: 'MLB-A1', estoques: [{ sku: 'A1', estoque: 5 }] },
      { canal: 'mercado_livre', itemExternoId: 'MLB-A3', estoques: [{ sku: 'A3', estoque: 7 }] },
    ]);
  });

  it('item UP retirado é ignorado', () => {
    const r = resolverAlvosPush(
      [{ id: 'p0', canal: 'mercado_livre', item_externo_id: null, variacoes_externas: { A1: {} } }],
      [{ anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'MLB-A1', retirado: true, status: 'ativo' }],
      estoques, null,
    );
    expect(r).toEqual([]);
  });

  // Espelha o filtro que atualizar-familia-up.ts:92 já aplica: só item 'ativo'.
  // Empurrar estoque para item em remoção/compensação pode ressuscitar anúncio.
  it('item UP fora de ativo é ignorado', () => {
    for (const status of ['erro', 'remocao_pendente', 'compensacao_pendente', 'pausado', 'pendente']) {
      const r = resolverAlvosPush(
        [{ id: 'p0', canal: 'mercado_livre', item_externo_id: null, variacoes_externas: { A1: {} } }],
        [{ anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'MLB-A1', retirado: false, status }],
        estoques, null,
      );
      expect(r, `status=${status}`).toEqual([]);
    }
  });

  it('anúncio sem item_externo_id E sem filhos é ignorado', () => {
    const r = resolverAlvosPush(
      [{ id: 'x', canal: 'mercado_livre', item_externo_id: null, variacoes_externas: { A1: {} } }],
      [], estoques, null,
    );
    expect(r).toEqual([]);
  });

  it('SKU no mapa que não está no estoque atual é ignorado', () => {
    const r = resolverAlvosPush(
      [{ id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {}, SUMIU: {} } }],
      [], estoques, null,
    );
    expect(r[0].estoques).toEqual([{ sku: 'A1', estoque: 5 }]);
  });
});
