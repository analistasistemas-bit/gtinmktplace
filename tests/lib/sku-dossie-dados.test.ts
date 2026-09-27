import { describe, it, expect, vi } from 'vitest';

// Mesmo padrão de src/lib/__tests__/notificacoes.test.ts: mocka o client e testa a lógica sem rede.
const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

const { buscarVendasPorIds } = await import('@/lib/faturamento');
const { buscarIdsDossie, buscarMlbsDossie } = await import('@/lib/sku-dossie-dados');

/** Chain que resolve `resultado` a qualquer ponto (select/in), como o PostgrestFilterBuilder real. */
function fakeChain(resultado: unknown) {
  const chain: any = {
    select: () => chain,
    in: () => chain,
    then: (resolve: any) => Promise.resolve(resultado).then(resolve),
  };
  return chain;
}

const venda = (id: string, dateClosed: string) => ({
  id, order_id: 1, pack_id: null, date_closed: dateClosed,
  itens: [{ id: 'it', ml_item_id: 'MLB1', variation_id: null, titulo: null, codigo: null, cor: null, ean: null, quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true }],
  custos: [{ ml_item_id: 'MLB1', variation_id: null, custo_unitario: 5 }],
});

describe('buscarVendasPorIds', () => {
  it('320 ids → 4 chamadas .in de 80 (mesmo select da aba Vendas)', async () => {
    mockFrom.mockReturnValue(fakeChain({ data: [venda('a', '2026-09-01T00:00:00+00:00')], error: null }));
    const ids = Array.from({ length: 320 }, (_, i) => `id-${i}`);
    const vendas = await buscarVendasPorIds(ids);
    expect(mockFrom).toHaveBeenCalledTimes(4);
    expect(vendas).toHaveLength(4);
  });

  it('aplica comCustoCongelado e remove `custos` do objeto', async () => {
    mockFrom.mockReturnValue(fakeChain({ data: [venda('a', '2026-09-01T00:00:00+00:00')], error: null }));
    const [v] = await buscarVendasPorIds(['a']);
    expect(v.itens[0].custo_congelado).toBe(5);
    expect((v as any).custos).toBeUndefined();
  });

  it('ordena por date_closed desc, id', async () => {
    mockFrom.mockReturnValue(fakeChain({
      data: [
        venda('b', '2026-09-01T00:00:00+00:00'),
        venda('a', '2026-09-02T00:00:00+00:00'),
        venda('c', '2026-09-02T00:00:00+00:00'),
      ],
      error: null,
    }));
    const vendas = await buscarVendasPorIds(['a', 'b', 'c']);
    expect(vendas.map((v) => v.id)).toEqual(['a', 'c', 'b']);
  });

  it('erro → lança', async () => {
    mockFrom.mockReturnValue(fakeChain({ data: null, error: { message: 'boom' } }));
    await expect(buscarVendasPorIds(['a'])).rejects.toThrow('boom');
  });
});

describe('buscarIdsDossie', () => {
  it('chama a RPC com os códigos e devolve o array de ids', async () => {
    mockRpc.mockResolvedValueOnce({ data: ['id-1', 'id-2'], error: null });
    expect(await buscarIdsDossie(['09300001'])).toEqual(['id-1', 'id-2']);
    expect(mockRpc).toHaveBeenCalledWith('vendas_sku_dossie_ids', { p_codigos: ['09300001'] });
  });

  it('sem linhas → array vazio', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await buscarIdsDossie(['x'])).toEqual([]);
  });

  it('erro → lança', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(buscarIdsDossie(['x'])).rejects.toThrow('boom');
  });
});

describe('buscarMlbsDossie', () => {
  it('monta o Map a partir do objeto JSON da RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: { MLB1: ['09300001', '09300002'], MLB2: ['09300003'] }, error: null });
    const mapa = await buscarMlbsDossie(['09300001']);
    expect(mapa.get('MLB1')).toEqual(['09300001', '09300002']);
    expect(mapa.get('MLB2')).toEqual(['09300003']);
    expect(mockRpc).toHaveBeenCalledWith('vendas_sku_mlbs', { p_codigos: ['09300001'] });
  });

  it('sem correspondência → Map vazio', async () => {
    mockRpc.mockResolvedValueOnce({ data: {}, error: null });
    expect((await buscarMlbsDossie(['x'])).size).toBe(0);
  });

  it('erro → lança', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(buscarMlbsDossie(['x'])).rejects.toThrow('boom');
  });
});
