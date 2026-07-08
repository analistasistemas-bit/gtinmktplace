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
