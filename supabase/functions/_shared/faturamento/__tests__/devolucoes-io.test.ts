import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buscarClaimsSeller } from '../devolucoes-io';

describe('buscarClaimsSeller', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('faz requisições com status=opened e status=closed e combina os resultados', async () => {
    const fetchMock = vi.mocked(fetch);
    
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        paging: { total: 1 },
        data: [{ id: 1, status: 'opened' }]
      })
    } as any);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        paging: { total: 1 },
        data: [{ id: 2, status: 'closed' }]
      })
    } as any);

    const res = await buscarClaimsSeller('fake-token');
    
    expect(res).toEqual([
      { id: 1, status: 'opened' },
      { id: 2, status: 'closed' }
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    
    const url1 = fetchMock.mock.calls[0][0] as string;
    const url2 = fetchMock.mock.calls[1][0] as string;
    expect(url1).toContain('status=opened');
    expect(url2).toContain('status=closed');
  });
});

describe('upsertDevolucao', () => {
  it('resolve order_id a partir do shipping_id se claim.resource === "shipment" e order_id original for null', async () => {
    const { upsertDevolucao } = await import('../devolucoes-io');
    const mockMaybeSingleDev = vi.fn().mockResolvedValue({ data: null });
    const mockMaybeSingleVenda = vi.fn().mockResolvedValue({ data: { order_id: 2000017600380594 } });

    const mockAdmin: any = {
      from: vi.fn((table: string) => {
        if (table === 'ml_devolucoes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: mockMaybeSingleDev,
                }),
              }),
            }),
            upsert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        if (table === 'ml_vendas') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: mockMaybeSingleVenda,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({ error: null }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const claimMock = {
      id: 5549631650,
      resource: 'shipment',
      resource_id: 47611358807,
      type: 'cancel_purchase',
      players: [],
    };

    const res = await upsertDevolucao(mockAdmin, 'user-123', 'org-123', claimMock, null);

    expect(res.row.order_id).toBe(2000017600380594);
  });
});

