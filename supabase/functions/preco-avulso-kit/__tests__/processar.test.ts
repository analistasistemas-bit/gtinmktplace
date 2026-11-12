import { describe, expect, it, vi } from 'vitest';
import { lerPrecosAvulsos, type DepsPrecoAvulso } from '../processar';
import { oferta } from '../../_shared/operacoes/reajuste/ofertas';
import type { OfertaVigente } from '../../_shared/operacoes/reajuste/tipos';

type Resp = unknown | Error;
// Relógio fixo injetado: nunca a data real (teste com data cruzando a janela reprova o CI de todas as branches).
const AGORA = Date.parse('2026-11-11T15:00:00Z');

/** GET falso: rota → resposta (Error = lança). Registra as rotas pedidas. */
function deps(rotas: Record<string, Resp>, ofertas: Record<string, OfertaVigente[] | null> = {}): DepsPrecoAvulso & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    agora: AGORA,
    get: vi.fn(async (path: string) => {
      chamadas.push(path);
      const chave = Object.keys(rotas).find((k) => path.startsWith(k));
      const r = chave ? rotas[chave] : new Error(`ML 404 em ${path}`);
      if (r instanceof Error) throw r;
      return r;
    }),
    lerOfertas: vi.fn(async (id: string) => (id in ofertas ? ofertas[id] : [])),
  };
}
const bulk = (itens: Array<[string, number]>) => itens.map(([id, price]) => ({ status_code: 200, body: { id, price } }));
const venda = (amount: number, regular: number | null, meta: Record<string, string> = {}) =>
  ({ amount, regular_amount: regular, currency_id: 'BRL', metadata: meta });
const of = (o: Partial<Omit<OfertaVigente, 'chave'>>): OfertaVigente => oferta({
  promocao_id: 'P-1', tipo: 'DEAL', status: 'started', preco: 41.9, offer_id: null, inicio: '2026-11-01T03:00:00Z', fim: '2026-11-20T02:59:00Z', ...o,
});

describe('lerPrecosAvulsos', () => {
  it('normal = price do /items/bulk; promoção = /sale_price abaixo dele; fim = da oferta vencedora (offer_id antes da campanha)', async () => {
    const d = deps({
      '/items/bulk': bulk([['MLB1', 71.9], ['MLB2', 69.9]]),
      // regular_amount velho (ADR-0196) não vira o normal.
      '/items/MLB1/sale_price': venda(41.9, 79.9, { promotion_id: 'OFFER-MLB1-9', campaign_id: 'P-MLB7' }),
      '/items/MLB2/sale_price': venda(69.9, null),
    }, {
      MLB1: [
        of({ promocao_id: 'P-MLB7', offer_id: 'OFFER-MLB1-8', fim: '2026-11-12T02:59:00Z' }), // outra janela da campanha
        of({ promocao_id: 'P-MLB7', offer_id: 'OFFER-MLB1-9', status: 'pending', fim: '2026-11-20T02:59:00Z' }), // Relâmpago participando
      ],
    });
    const r = await lerPrecosAvulsos(d, [{ sku: 'A', item_id: 'MLB1' }, { sku: 'B', item_id: 'MLB2' }]);
    expect(r.A).toMatchObject({ normal: 71.9, promocao: 41.9, fim_promocao: '2026-11-20T02:59:00Z' });
    expect(r.B).toMatchObject({ normal: 69.9, promocao: null, fim_promocao: null });
    expect(d.chamadas.filter((c) => c.startsWith('/items/bulk'))).toEqual(['/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.price']);
    // Promoções lidas de todo item (as futuras valem também para a peça sem promoção hoje).
    expect(d.lerOfertas).toHaveBeenCalledTimes(2);
  });

  it('sem a oferta exata, a campanha iniciada do metadata', async () => {
    const d = deps({ '/items/bulk': bulk([['MLB1', 71.9]]), '/items/MLB1/sale_price': venda(41.9, 71.9, { campaign_id: 'P-MLB7' }) },
      { MLB1: [of({ promocao_id: 'P-OUTRA', fim: '2026-11-13T00:00:00Z' }), of({ promocao_id: 'P-MLB7', fim: '2026-11-19T00:00:00Z' })] });
    expect((await lerPrecosAvulsos(d, [{ sku: 'A', item_id: 'MLB1' }])).A.fim_promocao).toBe('2026-11-19T00:00:00Z');
  });

  it('futuras: só início depois de agora e preço abaixo do normal; sem preço legível lista sem valor; ordenadas por início', async () => {
    const d = deps({ '/items/bulk': bulk([['MLB2', 69.9]]), '/items/MLB2/sale_price': venda(69.9, null) }, {
      MLB2: [
        of({ tipo: 'LIGHTNING', status: 'pending', preco: 39.9, inicio: '2026-11-20T15:00:00Z', fim: '2026-11-21T02:59:00Z' }),
        of({ tipo: 'DEAL', status: 'pending', preco: 49.9, inicio: '2026-11-14T03:00:00Z', fim: '2026-11-17T02:59:00Z' }),
        of({ tipo: 'SMART', status: 'pending', preco: null, inicio: '2026-11-25T03:00:00Z', fim: '2026-11-30T02:59:00Z' }),
        of({ tipo: 'DEAL', status: 'pending', preco: 69.9, inicio: '2026-11-15T03:00:00Z', fim: null }), // não é desconto
        of({ tipo: 'LIGHTNING', status: 'pending', preco: 35, inicio: '2026-11-11T12:00:00Z', fim: '2026-11-11T23:59:00Z' }), // já começou
      ],
    });
    const r = await lerPrecosAvulsos(d, [{ sku: 'B', item_id: 'MLB2' }]);
    expect(r.B.futuras).toEqual([
      { tipo: 'DEAL', preco: 49.9, inicio: '2026-11-14T03:00:00Z', fim: '2026-11-17T02:59:00Z' },
      { tipo: 'LIGHTNING', preco: 39.9, inicio: '2026-11-20T15:00:00Z', fim: '2026-11-21T02:59:00Z' },
      { tipo: 'SMART', preco: null, inicio: '2026-11-25T03:00:00Z', fim: '2026-11-30T02:59:00Z' },
    ]);
    expect(r.B.futuras_indisponivel).toBe(false);
  });

  it('leitura das promoções inconclusiva: futuras indisponível por SKU, preços mantidos, sem data de fim', async () => {
    const d = deps({ '/items/bulk': bulk([['MLB1', 71.9]]), '/items/MLB1/sale_price': venda(41.9, 71.9, { promotion_id: 'OFFER-1' }) }, { MLB1: null });
    expect((await lerPrecosAvulsos(d, [{ sku: 'A', item_id: 'MLB1' }])).A)
      .toEqual({ normal: 71.9, promocao: 41.9, fim_promocao: null, futuras: [], futuras_indisponivel: true });
  });

  it('bulk em blocos de 20 ids únicos (id repetido = 400 no lote)', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `MLB${i}`);
    const d = deps({ '/items/bulk': [] });
    await lerPrecosAvulsos(d, [...ids, 'MLB0'].map((id, i) => ({ sku: `S${i}`, item_id: id })));
    const lotes = d.chamadas.filter((c) => c.startsWith('/items/bulk')).map((c) => c.split('ids=')[1].split('&')[0].split(','));
    expect(lotes.map((l) => l.length)).toEqual([20, 5]);
    expect(new Set(lotes.flat()).size).toBe(25);
  });

  it('sale_price ou bulk falhou, ou sem vínculo: peça indisponível (não presume "sem promoção"), sem lançar', async () => {
    const vazio = { normal: null, promocao: null, fim_promocao: null, futuras: [], futuras_indisponivel: true };
    const a = await lerPrecosAvulsos(deps({ '/items/bulk': bulk([['MLB1', 71.9]]), '/items/MLB1/sale_price': new Error('ML 500') }),
      [{ sku: 'A', item_id: 'MLB1' }, { sku: 'D', item_id: null }]);
    expect(a.A).toEqual(vazio);
    expect(a.D).toEqual(vazio);
    const b = await lerPrecosAvulsos(deps({ '/items/bulk': new Error('ML 500'), '/items/MLB1/sale_price': venda(41.9, 71.9) }), [{ sku: 'A', item_id: 'MLB1' }]);
    expect(b.A).toEqual(vazio);
  });

  it('mesmo item em dois SKUs: uma leitura só de sale_price e de promoções', async () => {
    const d = deps({ '/items/bulk': bulk([['MLB2', 69.9]]), '/items/MLB2/sale_price': venda(69.9, null) });
    const r = await lerPrecosAvulsos(d, [{ sku: 'A', item_id: 'MLB2' }, { sku: 'A2', item_id: 'MLB2' }]);
    expect(d.chamadas.filter((c) => c.includes('sale_price'))).toHaveLength(1);
    expect(d.lerOfertas).toHaveBeenCalledTimes(1);
    expect(r.A2).toEqual(r.A);
  });
});
