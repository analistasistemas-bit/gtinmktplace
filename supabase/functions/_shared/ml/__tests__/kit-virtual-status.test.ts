// ADR-0154 D-14: as duas chamadas extras de status-publicados para kit — preço (`/sale_price`)
// e estoque (`/user-products/{id}/stock`). Nenhuma lança: status-publicados/processar.ts conta
// com isso para tolerar falha individual sem derrubar a resposta inteira.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { lerPrecoKitML, lerEstoqueKitML, buscarListingTypeItensML } from '../kit-virtual';

afterEach(() => vi.unstubAllGlobals());

function resp(json: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(json), { status }));
}

describe('lerPrecoKitML', () => {
  // Payload copiado da doc oficial de Kits Virtuais (§"Consultar preço de venda do kit"): o
  // rateio vive em `bundle.components` e o total em `bundle.total_components_amount`. Ler esses
  // campos na raiz devolve rateio vazio em toda resposta real — e um teste que inventa o shape
  // fica verde justamente no caso que quebra em produção.
  it('devolve preco + rateio por componente quando o ML responde 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('https://api.mercadolibre.com/items/MLBKIT1/sale_price?context=channel_marketplace');
      return resp({
        price_id: '13',
        amount: 114,
        regular_amount: 250,
        currency_id: 'BRL',
        metadata: {},
        bundle: {
          components: [
            {
              user_product_id: 'MLBU3397414253', item_id: 'MLB4189262175',
              component_price: 100, quantity: 1, unit_amount: 45.6, total_amount: 45.6,
            },
            {
              user_product_id: 'MLBU3438878324', item_id: 'MLB4189327103',
              component_price: 50, quantity: 3, unit_amount: 22.8, total_amount: 68.4,
            },
          ],
          total_components_amount: 250,
        },
      });
    }));

    const r = await lerPrecoKitML('tok', 'MLBKIT1');
    expect(r).toEqual({
      preco: 114,
      totalComponentesAmount: 250,
      componentes: [
        { userProductId: 'MLBU3397414253', componentPrice: 100, quantidade: 1, unitAmount: 45.6, totalAmount: 45.6 },
        { userProductId: 'MLBU3438878324', componentPrice: 50, quantidade: 3, unitAmount: 22.8, totalAmount: 68.4 },
      ],
    });
  });

  it('devolve rateio vazio, sem quebrar, quando o no bundle nao vem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ amount: 99 })));
    expect(await lerPrecoKitML('tok', 'MLBKIT1')).toEqual({
      preco: 99, totalComponentesAmount: null, componentes: [],
    });
  });

  it('devolve null (nunca lança) quando o ML responde erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)));
    expect(await lerPrecoKitML('tok', 'MLBKIT1')).toBeNull();
  });

  it('devolve null quando a rede falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await lerPrecoKitML('tok', 'MLBKIT1')).toBeNull();
  });

  it('devolve null quando a resposta não tem amount', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ total_components_amount: 250 })));
    expect(await lerPrecoKitML('tok', 'MLBKIT1')).toBeNull();
  });
});

describe('lerEstoqueKitML', () => {
  it('soma locations[].quantity', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('https://api.mercadolibre.com/user-products/MLBU-KIT1/stock');
      return resp({ locations: [{ quantity: 3 }, { quantity: 4 }] });
    }));
    expect(await lerEstoqueKitML('tok', 'MLBU-KIT1')).toBe(7);
  });

  it('devolve null (nunca lança) quando o ML responde erro', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 404)));
    expect(await lerEstoqueKitML('tok', 'MLBU-KIT1')).toBeNull();
  });

  it('devolve null quando a rede falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await lerEstoqueKitML('tok', 'MLBU-KIT1')).toBeNull();
  });

  // D-6: "não consegui ler" e "está zerado" são informações DIFERENTES. Um 200 sem `locations`
  // (ou com `locations` de outro tipo) não pode virar o zero plausível que a tela exibiria como
  // estoque real.
  it('200 sem array de locations devolve null, nunca 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({})));
    expect(await lerEstoqueKitML('tok', 'MLBU-KIT1')).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => resp({ locations: null })));
    expect(await lerEstoqueKitML('tok', 'MLBU-KIT1')).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => resp({ locations: { quantity: 3 } })));
    expect(await lerEstoqueKitML('tok', 'MLBU-KIT1')).toBeNull();
  });

  it('locations vazio continua sendo 0 — esse zero foi MEDIDO', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ locations: [] })));
    expect(await lerEstoqueKitML('tok', 'MLBU-KIT1')).toBe(0);
  });
});

// Bug real 2026-09-06: `listing_type_id` fixo (`gold_pro`) não bate com o dos componentes e o ML
// recusa o kit inteiro (`listing_type_mismatch`). Mesmo padrão de multiget que
// `buscar-componentes-kit-virtual` já usa (`GET /items?ids=...&attributes=...`).
describe('buscarListingTypeItensML', () => {
  it('mapeia item_id → listing_type_id a partir do multiget', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url).toBe('https://api.mercadolibre.com/items?ids=MLB1,MLB2&attributes=id,listing_type_id');
      return resp([
        { code: 200, body: { id: 'MLB1', listing_type_id: 'gold_special' } },
        { code: 200, body: { id: 'MLB2', listing_type_id: 'gold_pro' } },
      ]);
    }));
    const mapa = await buscarListingTypeItensML('tok', ['MLB1', 'MLB2']);
    expect(mapa).toEqual(new Map([['MLB1', 'gold_special'], ['MLB2', 'gold_pro']]));
  });

  it('item que o ML não devolveu (code !== 200) fica de fora do mapa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp([
      { code: 200, body: { id: 'MLB1', listing_type_id: 'gold_special' } },
      { code: 404, body: null },
    ])));
    const mapa = await buscarListingTypeItensML('tok', ['MLB1', 'MLB2']);
    expect(mapa).toEqual(new Map([['MLB1', 'gold_special']]));
  });

  it('lote de mais de 20 ids: pagina em blocos de 20', async () => {
    const chamadas: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { chamadas.push(url); return resp([]); }));
    const ids = Array.from({ length: 25 }, (_, i) => `MLB${i}`);
    await buscarListingTypeItensML('tok', ids);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]).toContain(ids.slice(0, 20).join(','));
    expect(chamadas[1]).toContain(ids.slice(20).join(','));
  });

  // Diferente de `lerPrecoKitML`/`lerEstoqueKitML` (enriquecimento de exibição, tolera null):
  // esta chamada GATE o publish em `criarKitVirtual`, então LANÇA em falha — nunca devolve mapa
  // vazio pra um 5xx/timeout, senão um blip transiente vira "nenhum componente tem listing type"
  // (400) em vez do 502 que é.
  it('resposta de erro HTTP do ML → lança (não devolve mapa vazio silencioso)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)));
    await expect(buscarListingTypeItensML('tok', ['MLB1'])).rejects.toThrow(/500/);
  });

  it('rede falha (timeout/exceção) → lança', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(buscarListingTypeItensML('tok', ['MLB1'])).rejects.toThrow('network down');
  });
});
