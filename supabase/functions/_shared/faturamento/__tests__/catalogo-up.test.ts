import { describe, it, expect } from 'vitest';
import { fundirItensUP, type CatalogoBase } from '../catalogo-up';

// ADR-0088 §2 — carregarCatalogo (faturamento/io.ts) precisa que os itens filhos User Products
// (cores 2..N, 1 item ML por SKU) entrem nos mesmos mapas usados p/ reconhecer venda PubliAI
// (idsPubliai) e resolver código/EAN (codPorItem/eanPorItem/infoPorGtin) — sem isso, a venda de
// uma cor 2..N não é reconhecida como PubliAI (is_publiai=false) e o código/EAN ficam null.

function baseVazia(): CatalogoBase {
  return { idsPubliai: new Set(), codPorItem: new Map(), eanPorItem: new Map(), infoPorGtin: new Map() };
}

describe('fundirItensUP', () => {
  it('família UP de 3+ filhos: cada cor 2..N vira PubliAI com seu próprio código', () => {
    const base = baseVazia();
    fundirItensUP(base, [
      { itemExternoId: 'MLB2', sku: 'V2', gtin: null },
      { itemExternoId: 'MLB3', sku: 'V3', gtin: null },
      { itemExternoId: 'MLB4', sku: 'V4', gtin: null },
    ]);
    expect([...base.idsPubliai].sort()).toEqual(['MLB2', 'MLB3', 'MLB4']);
    expect(base.codPorItem.get('MLB2')).toBe('V2');
    expect(base.codPorItem.get('MLB3')).toBe('V3');
    expect(base.codPorItem.get('MLB4')).toBe('V4');
  });

  it('resolve EAN + infoPorGtin quando o filho tem GTIN (fallback de catálogo, ADR-0045)', () => {
    const base = baseVazia();
    fundirItensUP(base, [{ itemExternoId: 'MLB2', sku: 'V2', gtin: '07891234567890' }]);
    expect(base.eanPorItem.get('MLB2')).toBe('07891234567890');
    expect(base.infoPorGtin.get('7891234567890')).toEqual({ codigo: 'V2', ean: '07891234567890' });
  });

  it('sem GTIN → não gera entrada em eanPorItem/infoPorGtin (fica null, comportamento existente)', () => {
    const base = baseVazia();
    fundirItensUP(base, [{ itemExternoId: 'MLB2', sku: 'V2', gtin: null }]);
    expect(base.eanPorItem.has('MLB2')).toBe(false);
  });

  // Antes preservava a entrada da família. Errado: quando o item_externo_id do filho é também o
  // familias.ml_item_id, io.ts semeia a chave com a PRIMEIRA variação da família em ordem
  // arbitrária (:96-98) ou com codigo_pai (:103) — nenhum dos dois é o produto vendido.
  // Em produção isso gravou 4 vendas com código errado e 6 com EAN errado.
  it('SOBRESCREVE a entrada semeada pela família — o sku do filho é 1:1 com a cor vendida', () => {
    const base = baseVazia();
    base.idsPubliai.add('MLB1');
    base.codPorItem.set('MLB1', 'CODIGO_PAI'); // fallback de familia.codigo_pai (io.ts:103)
    base.eanPorItem.set('MLB1', '07890000000017');
    fundirItensUP(base, [{ itemExternoId: 'MLB1', sku: 'V1', gtin: '07890000000024' }]);
    expect(base.codPorItem.get('MLB1')).toBe('V1');
    expect(base.eanPorItem.get('MLB1')).toBe('07890000000024');
  });

  it('caso real MLB4959919693: a família semeou a cor errada, o filho UP corrige', () => {
    const base = baseVazia();
    base.codPorItem.set('MLB4959919693', '18760903'); // 1ª variação da família (cor Vermelho)
    fundirItensUP(base, [{ itemExternoId: 'MLB4959919693', sku: '26705421', gtin: null }]);
    expect(base.codPorItem.get('MLB4959919693')).toBe('26705421'); // Amarelo Canário, a cor vendida
  });

  it('lista vazia (sem itens UP) → mapas inalterados', () => {
    const base = baseVazia();
    fundirItensUP(base, []);
    expect(base.idsPubliai.size).toBe(0);
    expect(base.codPorItem.size).toBe(0);
  });
});
