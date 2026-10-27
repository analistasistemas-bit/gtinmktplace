import { describe, it, expect, vi, afterEach } from 'vitest';
import { comissaoDe, buscarComissaoParaPreco } from '../listing-prices';

// Emenda ADR-0020 (2026-10-27): 429 do ML jogava o preço no piso em silêncio (lote Hairfly).
describe('buscarComissaoParaPreco', () => {
  const OK = { sale_fee_amount: 2.3, sale_fee_details: { percentage_fee: 11.5, fixed_fee: 0 } };
  const resp = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const stub = (...respostas: Response[]) => {
    const f = vi.fn();
    for (const r of respostas) f.mockResolvedValueOnce(r);
    vi.stubGlobal('fetch', f);
    return f;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('429 seguido de sucesso: retenta e devolve a comissão oficial', async () => {
    const f = stub(resp(429, { message: 'local_rate_limited' }), resp(200, OK));
    await expect(buscarComissaoParaPreco('t', 20, 'MLB1265', [0, 0])).resolves.toEqual({ percentual: 11.5, fixa: 0 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('429 em todas as tentativas: lança (nunca devolve comissão inventada)', async () => {
    const f = stub(resp(429, {}), resp(429, {}), resp(503, {}));
    await expect(buscarComissaoParaPreco('t', 20, 'MLB1265', [0, 0])).rejects.toThrow(/429|503/);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('4xx que não é 429: lança sem retentar', async () => {
    const f = stub(resp(400, { message: 'bad category' }));
    await expect(buscarComissaoParaPreco('t', 20, 'MLB1265', [0, 0])).rejects.toThrow(/400/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('200 sem sale_fee_details: lança (comissaoDe viraria 0% em silêncio)', async () => {
    stub(resp(200, { sale_fee_amount: 0 }));
    await expect(buscarComissaoParaPreco('t', 20, 'MLB1265', [0, 0])).rejects.toThrow(/sale_fee_details/);
  });
});

describe('comissaoDe', () => {
  it('extrai percentual e fixa do listing_prices', () => {
    expect(comissaoDe({
      sale_fee_amount: 8.5,
      sale_fee_details: { percentage_fee: 13, fixed_fee: 6 },
    })).toEqual({ percentual: 13, fixa: 6 });
  });
  it('sem detalhes → zeros', () => {
    expect(comissaoDe({ sale_fee_amount: 0 })).toEqual({ percentual: 0, fixa: 0 });
  });
});
