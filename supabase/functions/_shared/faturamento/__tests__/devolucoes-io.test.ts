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
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
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


describe('leituras do pós-venda', () => {
  const resp = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as never;
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('buscarReturnLeitura: 404 → lido e vazio; 500/exceção → ok:false; 200 extrai id, rastreio e pedido', async () => {
    const { buscarReturnLeitura } = await import('../devolucoes-io');
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(resp(404, {}));
    expect(await buscarReturnLeitura('t', '1')).toEqual({ ok: true, valor: null });
    f.mockResolvedValueOnce(resp(500, {}));
    expect(await buscarReturnLeitura('t', '1')).toEqual({ ok: false });
    f.mockRejectedValueOnce(new Error('rede'));
    expect(await buscarReturnLeitura('t', '1')).toEqual({ ok: false });
    f.mockResolvedValueOnce(resp(200, {
      id: 169980422, status: 'delivered', status_money: 'refunded', subtype: 'return_total',
      shipments: [{ type: 'return', tracking_number: 'J32' }], resource_type: 'order', resource_id: 2000018882300346,
    }));
    expect(await buscarReturnLeitura('t', '1')).toEqual({
      ok: true, valor: { id: 169980422, tracking: 'J32', pedidos: [2000018882300346], status: 'delivered', status_money: 'refunded', subtype: 'return_total' },
    });
  });

  it('buscarExtrasClaim: sem return → revisões []; 404 "review not found" → sem_review; outro erro → ok:false só nela', async () => {
    const { buscarExtrasClaim } = await import('../devolucoes-io');
    const f = vi.mocked(fetch);
    f.mockResolvedValueOnce(resp(200, { title: 'x', due_date: '2026-11-01' }))
      .mockResolvedValueOnce(resp(200, { affects_reputation: 'not_affected' }));
    const sem = await buscarExtrasClaim('t', '1', null);
    expect(sem.revisoes).toEqual({ ok: true, valor: [] });
    expect(sem.reputacao).toEqual({ ok: true, valor: 'not_affected' });
    expect(sem.detalhe).toEqual({ ok: true, valor: { title: 'x', due_date: '2026-11-01' } });

    f.mockResolvedValueOnce(resp(200, {})).mockResolvedValueOnce(resp(200, {}))
      .mockResolvedValueOnce(resp(404, { message: 'return review not found' }));
    expect((await buscarExtrasClaim('t', '1', 5)).revisoes).toEqual({ ok: true, valor: 'sem_review' });

    f.mockResolvedValueOnce(resp(200, {})).mockResolvedValueOnce(resp(200, {})).mockResolvedValueOnce(resp(500, {}));
    const falha = await buscarExtrasClaim('t', '1', 5);
    expect(falha.revisoes).toEqual({ ok: false });
    expect(falha.detalhe.ok).toBe(true);
  });

  it('upsertDevolucao: return não lido não grava colunas do return; lido_em vai no RPC; erro do banco lança', async () => {
    const { upsertDevolucao } = await import('../devolucoes-io');
    const rpc = vi.fn().mockResolvedValue({ data: { claim_id: 1 }, error: null });
    const admin: any = {
      rpc,
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'x' } }) }) }) }) }),
    };
    await upsertDevolucao(admin, 'u', 'o', { id: 1 } as never, { ok: false }, '999', undefined, 'T1');
    const linha = rpc.mock.calls[0][1].linha;
    expect(linha.lido_em).toBe('T1');
    expect(linha).not.toHaveProperty('return_status');
    expect(linha).not.toHaveProperty('revisao_pendente');
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(upsertDevolucao(admin, 'u', 'o', { id: 1 } as never, null, '999')).rejects.toThrow('boom');
  });
});
