import { describe, expect, it, vi } from 'vitest';
import { lerPrecosAvulsos } from '../processar';

type Resp = unknown | Error;
/** GET falso: rota → resposta (Error = lança). Registra as rotas pedidas. */
function api(rotas: Record<string, Resp>) {
  const chamadas: string[] = [];
  const get = vi.fn(async (path: string) => {
    chamadas.push(path);
    const chave = Object.keys(rotas).find((k) => path.startsWith(k));
    const r = chave ? rotas[chave] : new Error(`ML 404 em ${path}`);
    if (r instanceof Error) throw r;
    return r;
  });
  return { get, chamadas };
}
const bulk = (itens: Array<[string, number]>) => itens.map(([id, price]) => ({ status_code: 200, body: { id, price } }));
const venda = (amount: number, regular: number | null, meta: Record<string, string> = {}) =>
  ({ amount, regular_amount: regular, currency_id: 'BRL', metadata: meta });

describe('lerPrecosAvulsos', () => {
  it('normal = price do /items/bulk; promoção = /sale_price abaixo dele; fim = finish_date da oferta vencedora', async () => {
    const { get, chamadas } = api({
      '/items/bulk': bulk([['MLB1', 71.9], ['MLB2', 69.9]]),
      // regular_amount velho (ADR-0196) não vira o normal.
      '/items/MLB1/sale_price': venda(41.9, 79.9, { promotion_id: 'OFFER-MLB1-9', campaign_id: 'P-MLB7' }),
      '/items/MLB2/sale_price': venda(69.9, null),
      '/seller-promotions/items/MLB1': [
        { id: 'P-MLB5', status: 'started', finish_date: '2026-11-12T02:59:00Z' }, // outra campanha, não a vencedora
        { id: 'P-MLB7', offer_id: 'OFFER-MLB1-9', status: 'started', finish_date: '2026-11-20T02:59:00Z' },
      ],
    });
    const r = await lerPrecosAvulsos(get, [{ sku: 'A', item_id: 'MLB1' }, { sku: 'B', item_id: 'MLB2' }]);
    expect(r.A).toEqual({ normal: 71.9, promocao: 41.9, fim_promocao: '2026-11-20T02:59:00Z' });
    expect(r.B).toEqual({ normal: 69.9, promocao: null, fim_promocao: null });
    expect(chamadas.filter((c) => c.startsWith('/items/bulk'))).toEqual([
      '/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.price',
    ]);
    // Fim da promoção só para o item em promoção.
    expect(chamadas.filter((c) => c.startsWith('/seller-promotions'))).toEqual(['/seller-promotions/items/MLB1?app_version=v2']);
  });

  it('bulk em blocos de 20 ids únicos (id repetido = 400 no lote)', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `MLB${i}`);
    const rotas: Record<string, Resp> = { '/items/bulk': [] };
    const { get, chamadas } = api(rotas);
    await lerPrecosAvulsos(get, [...ids, 'MLB0'].map((id, i) => ({ sku: `S${i}`, item_id: id })));
    const lotes = chamadas.filter((c) => c.startsWith('/items/bulk')).map((c) => c.split('ids=')[1].split('&')[0].split(','));
    expect(lotes.map((l) => l.length)).toEqual([20, 5]);
    expect(new Set(lotes.flat()).size).toBe(25);
  });

  it('sale_price falhou: peça indisponível (não presume "sem promoção")', async () => {
    const { get } = api({ '/items/bulk': bulk([['MLB1', 71.9]]), '/items/MLB1/sale_price': new Error('ML 500') });
    const r = await lerPrecosAvulsos(get, [{ sku: 'A', item_id: 'MLB1' }, { sku: 'D', item_id: null }]);
    expect(r.A).toEqual({ normal: null, promocao: null, fim_promocao: null });
    expect(r.D).toEqual({ normal: null, promocao: null, fim_promocao: null });
  });

  it('bulk falhou: peças do lote indisponíveis, sem lançar', async () => {
    const { get } = api({ '/items/bulk': new Error('ML 500'), '/items/MLB1/sale_price': venda(41.9, 71.9) });
    const r = await lerPrecosAvulsos(get, [{ sku: 'A', item_id: 'MLB1' }]);
    expect(r.A).toEqual({ normal: null, promocao: null, fim_promocao: null });
  });

  it('fim da promoção sem correlação com a oferta vencedora (ou leitura falhou): data nula, preços mantidos', async () => {
    const base = { '/items/bulk': bulk([['MLB1', 71.9]]), '/items/MLB1/sale_price': venda(41.9, 71.9, { promotion_id: 'X' }) };
    const semPar = await lerPrecosAvulsos(api({ ...base, '/seller-promotions/items/MLB1': [{ id: 'P-1', status: 'started', finish_date: '2026-11-12T00:00:00Z' }] }).get, [{ sku: 'A', item_id: 'MLB1' }]);
    expect(semPar.A).toEqual({ normal: 71.9, promocao: 41.9, fim_promocao: null });
    const falhou = await lerPrecosAvulsos(api({ ...base, '/seller-promotions/items/MLB1': new Error('ML 500') }).get, [{ sku: 'A', item_id: 'MLB1' }]);
    expect(falhou.A).toEqual({ normal: 71.9, promocao: 41.9, fim_promocao: null });
  });

  it('mesmo item em dois SKUs: uma leitura de sale_price só', async () => {
    const { get, chamadas } = api({ '/items/bulk': bulk([['MLB2', 69.9]]), '/items/MLB2/sale_price': venda(69.9, null) });
    const r = await lerPrecosAvulsos(get, [{ sku: 'A', item_id: 'MLB2' }, { sku: 'A2', item_id: 'MLB2' }]);
    expect(chamadas.filter((c) => c.includes('sale_price'))).toHaveLength(1);
    expect(r.A2).toEqual(r.A);
  });
});
