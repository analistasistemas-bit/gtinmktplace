import { describe, it, expect } from 'vitest';
import { montarFotoResolver, type MapasFoto } from '@/lib/fotos-produto';
import type { VendaItem } from '@/lib/faturamento';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it', ml_item_id: null, variation_id: null, titulo: null, codigo: null,
    cor: null, ean: null, quantity: 1, unit_price: 0, sale_fee: 0, is_publiai: true, ...over,
  };
}

function mapas(over: Partial<MapasFoto> = {}): MapasFoto {
  return {
    porVariacao: new Map(),
    porItem: new Map(),
    porGtin: new Map(),
    porCodigo: new Map(),
    porItemCapa: new Map(),
    ...over,
  };
}

describe('montarFotoResolver — fallback por Código/SKU sem EAN', () => {
  it('resolve imagem por codigo com normalização de zeros à esquerda', () => {
    const resolver = montarFotoResolver(
      mapas({ porCodigo: new Map([['2743647', 'produtos/oxford-natal.jpg']]) }),
    );

    expect(resolver(item({ codigo: '02743647', ean: null }))).toBe('produtos/oxford-natal.jpg');
    expect(resolver(item({ codigo: '2743647', ean: null }))).toBe('produtos/oxford-natal.jpg');
  });
});

describe('montarFotoResolver — capa da família como último fallback', () => {
  it('variação sem imagem_path usa a capa da família (produto do cadastro avulso)', () => {
    const resolver = montarFotoResolver(mapas({ porItemCapa: new Map([['MLB1', 'org/lote/fam-capa.png']]) }));

    expect(resolver(item({ ml_item_id: 'MLB1', codigo: '00000023', ean: '609963220755' })))
      .toBe('org/lote/fam-capa.png');
  });

  it('foto da própria variação vence a capa (não estraga anúncio com cores)', () => {
    const resolver = montarFotoResolver(mapas({
      porItem: new Map([['MLB1', 'org/lote/variacao.JPG']]),
      porItemCapa: new Map([['MLB1', 'org/lote/fam-capa.png']]),
    }));

    expect(resolver(item({ ml_item_id: 'MLB1' }))).toBe('org/lote/variacao.JPG');
  });

  it('sem foto nenhuma continua null (ícone de pacote)', () => {
    expect(montarFotoResolver(mapas())(item({ ml_item_id: 'MLB1' }))).toBeNull();
  });
});

describe('montarFotoResolver — venda por catálogo (ADR-0045)', () => {
  it('canonicaliza o MLB de catálogo pro MLB do anúncio dono antes de bater no porItem', () => {
    const resolver = montarFotoResolver(
      mapas({ porItem: new Map([['MLB_DONO', 'org/lote/variacao.jpg']]) }),
      { MLB_CATALOGO: 'MLB_DONO' },
    );

    expect(resolver(item({ ml_item_id: 'MLB_CATALOGO' }))).toBe('org/lote/variacao.jpg');
  });

  it('canonicaliza também no fallback da capa da família (cadastro avulso vendido por catálogo)', () => {
    const resolver = montarFotoResolver(
      mapas({ porItemCapa: new Map([['MLB_DONO', 'org/lote/fam-capa.png']]) }),
      { MLB_CATALOGO: 'MLB_DONO' },
    );

    expect(resolver(item({ ml_item_id: 'MLB_CATALOGO', codigo: '00000023', ean: '609963220755' })))
      .toBe('org/lote/fam-capa.png');
  });
});
