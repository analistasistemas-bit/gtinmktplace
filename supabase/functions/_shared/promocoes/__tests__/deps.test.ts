import { beforeEach, describe, expect, it, vi } from 'vitest';

// Só a fiação de cache de criarTarifaEm: Redis e ML mockados (o client real lê Deno.env).
const m = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), lp: vi.fn(), frete: vi.fn() }));
vi.mock('../../redis/client.ts', () => ({
  redisGet: (k: string) => m.get(k),
  redisSet: (k: string, v: string, ttl?: number) => m.set(k, v, ttl),
}));
vi.mock('../../ml/listing-prices.ts', () => ({
  buscarListingPrice: () => m.lp(),
  comissaoDeComProveniencia: (c: unknown) => ({ valor: c, proveniencia: 'official' }),
}));
vi.mock('../../ml/frete.ts', () => ({ buscarFreteVendedorComProveniencia: () => m.frete() }));
vi.mock('../../queue.ts', () => ({ qstashClient: vi.fn() }));
import { criarTarifaEm } from '../deps.ts';

const cx = { orgId: 'o', mlUserId: 'u', token: 't' };
const q = { preco: 100, categoria: 'MLB1', listingType: 'gold_special', dim: null } as never;

describe('criarTarifaEm', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.lp.mockResolvedValue({ percentual: 16, fixa: 0 });
    m.frete.mockResolvedValue({ valor: 20, proveniencia: 'official' });
  });

  it('padrão: hit no cache não consulta o ML', async () => {
    m.get.mockResolvedValue(JSON.stringify(7));
    expect(await criarTarifaEm(cx)(q)).toEqual({ comissao: 7, frete: 7 });
    expect(m.lp).not.toHaveBeenCalled();
    expect(m.frete).not.toHaveBeenCalled();
  });

  it('fresco: não lê o cache, consulta o ML e grava', async () => {
    m.get.mockResolvedValue(JSON.stringify(7));
    expect(await criarTarifaEm(cx, { fresco: true })(q)).toEqual({ comissao: { percentual: 16, fixa: 0 }, frete: 20 });
    expect(m.get).not.toHaveBeenCalled();
    expect(m.set).toHaveBeenCalledTimes(2);
  });
});
