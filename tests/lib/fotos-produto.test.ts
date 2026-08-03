import { describe, it, expect } from 'vitest';
import { montarFotoResolver, type MapasFoto } from '@/lib/fotos-produto';
import type { VendaItem } from '@/lib/faturamento';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it', ml_item_id: null, variation_id: null, titulo: null, codigo: null,
    cor: null, ean: null, quantity: 1, unit_price: 0, sale_fee: 0, is_publiai: true, ...over,
  };
}

describe('montarFotoResolver — fallback por Código/SKU sem EAN', () => {
  it('resolve imagem por codigo com normalização de zeros à esquerda', () => {
    const mapas: MapasFoto = {
      porVariacao: new Map(),
      porItem: new Map(),
      porGtin: new Map(),
      porCodigo: new Map([['2743647', 'produtos/oxford-natal.jpg']]),
    };
    const resolver = montarFotoResolver(mapas);

    expect(resolver(item({ codigo: '02743647', ean: null }))).toBe('produtos/oxford-natal.jpg');
    expect(resolver(item({ codigo: '2743647', ean: null }))).toBe('produtos/oxford-natal.jpg');
  });
});
