// ADR-0154 D-14: as duas chamadas extras de status-publicados para kit — preço (`/sale_price`)
// e estoque (`/user-products/{id}/stock`). Nenhuma lança: status-publicados/processar.ts conta
// com isso para tolerar falha individual sem derrubar a resposta inteira.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { lerPrecoKitML, lerEstoqueKitML } from '../kit-virtual';

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
});
