import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mesmo padrão de src/lib/__tests__/notificacoes.test.ts: mocka o client e testa a lógica sem rede.
const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

const { buscarVendasPorIds } = await import('@/lib/faturamento');
const { buscarIdsDossie, buscarMlbsDossie, buscarMovimentos, buscarModeracoes, buscarPerguntas, buscarCampanhas } = await import('@/lib/sku-dossie-dados');

/** Chain que resolve `resultado` a qualquer ponto (select/in), como o PostgrestFilterBuilder real. */
function fakeChain(resultado: unknown) {
  const chain: any = {
    select: vi.fn(() => chain),
    in: vi.fn(() => chain),
    or: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
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

describe('buscarVendasPorIds — lotes em paralelo (concorrência 4)', () => {
  beforeEach(() => { mockFrom.mockReset(); });

  /** Cada `from()` devolve um lote pendente; o teste decide quando (e em que ordem) cada um resolve. */
  function lotesPendentes() {
    const pendentes: { resolver: (r: unknown) => void; ids: string[] }[] = [];
    let emVoo = 0;
    let picoEmVoo = 0;
    mockFrom.mockImplementation(() => {
      const chain: any = {
        select: vi.fn(() => chain),
        in: vi.fn((_col: string, ids: string[]) => { chain.ids = ids; return chain; }),
        then: (resolve: any, reject: any) => {
          emVoo++;
          picoEmVoo = Math.max(picoEmVoo, emVoo);
          return new Promise((r) => pendentes.push({ ids: chain.ids, resolver: (v) => { emVoo--; r(v); } })).then(resolve, reject);
        },
      };
      return chain;
    });
    return { pendentes, pico: () => picoEmVoo };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

  it('320 ids → 4 lotes de 80 disparados juntos, antes de qualquer um responder', async () => {
    const { pendentes, pico } = lotesPendentes();
    const p = buscarVendasPorIds(ids(320));
    await flush();
    expect(mockFrom).toHaveBeenCalledTimes(4);
    expect(pendentes.map((x) => x.ids.length)).toEqual([80, 80, 80, 80]);
    // Resolve na ordem inversa: o resultado sai ordenado igual (date_closed desc, id).
    [3, 2, 1, 0].forEach((i) => pendentes[i].resolver({ data: [venda(`v${i}`, `2026-09-0${i + 1}T00:00:00+00:00`)], error: null }));
    expect((await p).map((v) => v.id)).toEqual(['v3', 'v2', 'v1', 'v0']);
    expect(pico()).toBe(4);
  });

  it('nunca mais de 4 em voo: o 5º lote só sai quando um termina', async () => {
    const { pendentes, pico } = lotesPendentes();
    const p = buscarVendasPorIds(ids(400));
    await flush();
    expect(mockFrom).toHaveBeenCalledTimes(4);
    pendentes[2].resolver({ data: [venda('c', '2026-09-03T00:00:00+00:00')], error: null });
    await flush();
    expect(mockFrom).toHaveBeenCalledTimes(5);
    for (const [i, x] of pendentes.entries()) if (i !== 2) x.resolver({ data: [venda(`v${i}`, '2026-09-01T00:00:00+00:00')], error: null });
    expect((await p).map((v) => v.id)).toEqual(['c', 'v0', 'v1', 'v3', 'v4']);
    expect(pico()).toBe(4);
  });

  it('um lote com erro → rejeita (nunca dado parcial), mesmo com os outros ok', async () => {
    const { pendentes } = lotesPendentes();
    const p = buscarVendasPorIds(ids(320));
    await flush();
    pendentes[0].resolver({ data: [venda('a', '2026-09-01T00:00:00+00:00')], error: null });
    pendentes[1].resolver({ data: null, error: { message: 'lote 2 caiu' } });
    pendentes[2].resolver({ data: [], error: null });
    pendentes[3].resolver({ data: [], error: null });
    await expect(p).rejects.toThrow('lote 2 caiu');
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

describe('fetchers de eventos', () => {
  beforeEach(() => { mockFrom.mockReset(); });
  it('buscarMovimentos: colunas explícitas, filtro por código, ordem estável', async () => {
    const chain = fakeChain({ data: [{ id: 'm1' }], error: null });
    mockFrom.mockReturnValue(chain);
    expect(await buscarMovimentos(['A'])).toEqual([{ id: 'm1' }]);
    expect(mockFrom).toHaveBeenCalledWith('estoque_movimentos');
    expect(chain.select).toHaveBeenCalledWith('id, codigo, motivo, quantidade, custo_unitario, estoque_anterior, estoque_resultante, criado_em');
    expect(chain.in).toHaveBeenCalledWith('codigo', ['A']);
    expect(chain.order.mock.calls.map((c: unknown[]) => c[0])).toEqual(['criado_em', 'id']);
  });

  it('buscarPerguntas: coluna item_id, 170 MLBs → 3 lotes de 80', async () => {
    const chain = fakeChain({ data: [{ id: 'p' }], error: null });
    mockFrom.mockReturnValue(chain);
    const mlbs = Array.from({ length: 170 }, (_, i) => `MLB${i}`);
    expect(await buscarPerguntas(mlbs)).toHaveLength(3);
    expect(chain.select).toHaveBeenCalledWith('id, item_id, criada_em');
    expect(chain.in.mock.calls.map((c: unknown[]) => [c[0], (c[1] as string[]).length])).toEqual([['item_id', 80], ['item_id', 80], ['item_id', 10]]);
  });

  it('buscarModeracoes: sem MLB → não consulta', async () => {
    expect(await buscarModeracoes([])).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('buscarCampanhas: duas leituras e join no cliente pelo promocao_id', async () => {
    const itens = fakeChain({ data: [
      { promocao_id: 'P1', ml_item_id: 'MLB1', status: 'started', preco_promo: 10, sincronizado_em: 's1' },
      { promocao_id: 'P2', ml_item_id: 'MLB1', status: 'candidate', preco_promo: null, sincronizado_em: 's2' },
    ], error: null });
    const promos = fakeChain({ data: [{ promocao_id: 'P1', nome: 'Dia', tipo: 'DEAL', status: 'started', inicio: null, fim: null, sincronizado_em: 'x' }], error: null });
    mockFrom.mockImplementation((t: string) => (t === 'ml_promocao_itens' ? itens : promos));
    const r = await buscarCampanhas(['MLB1']);
    expect(promos.in).toHaveBeenCalledWith('promocao_id', ['P1', 'P2']);
    expect(r[0].promocao?.nome).toBe('Dia');
    expect(r[1].promocao).toBeNull();
  });

  // ADR-0174, emenda 2026-10-05: o par normal/catálogo vira a linha do catálogo; o dossiê só conhece o normal.
  it('buscarCampanhas: acha a linha do catálogo pelo normal e a mostra com o MLB do normal', async () => {
    const itens = fakeChain({ data: [
      { promocao_id: 'P1', ml_item_id: 'MLB7', anuncio_normal_id: 'MLB5', status: 'candidate', preco_promo: null, sincronizado_em: 's1' },
    ], error: null });
    mockFrom.mockImplementation((t: string) => (t === 'ml_promocao_itens' ? itens : fakeChain({ data: [], error: null })));
    const r = await buscarCampanhas(['MLB5']);
    expect(itens.or).toHaveBeenCalledWith('ml_item_id.in.(MLB5),anuncio_normal_id.in.(MLB5)');
    expect(r[0].ml_item_id).toBe('MLB5');
  });

  // Grok #5: normal e catálogo em blocos diferentes do .in → a mesma linha volta nas duas consultas.
  it('buscarCampanhas: a mesma linha achada em dois blocos aparece uma vez só', async () => {
    const itens = fakeChain({ data: [
      { promocao_id: 'P1', ml_item_id: 'MLB7', anuncio_normal_id: 'MLB5', status: 'started', preco_promo: 9, sincronizado_em: 's1' },
    ], error: null });
    mockFrom.mockImplementation((t: string) => (t === 'ml_promocao_itens' ? itens : fakeChain({ data: [], error: null })));
    const mlbs = Array.from({ length: 81 }, (_, i) => `MLB${i + 100}`);
    expect(await buscarCampanhas(mlbs)).toHaveLength(1);
  });

  it('erro → lança', async () => {
    mockFrom.mockReturnValue(fakeChain({ data: null, error: { message: 'boom' } }));
    await expect(buscarModeracoes(['MLB1'])).rejects.toThrow('boom');
  });
});

describe('buscarFonteAds (Fatia 2c)', () => {
  beforeEach(() => { mockFrom.mockReset(); mockRpc.mockReset(); });
  const syncChain = (data: unknown) => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }) });

  it('numeric do PostgREST chega como string → Number() em cost, *_amount e no custo do sync', async () => {
    const sync = { estado: 'ok', erro: null, ultimo_ok_em: null, carga_inicial_ok: true, cobertura_desde: null, custo_resumo: '100.50', custo_listado: '97.40' };
    const tabelas: Record<string, unknown> = {
      ml_ads_grupo_item: { data: [{ ad_group_id: 11, ml_item_id: 'MLB1' }], error: null },
      ml_ads_grupo: { data: [{ ad_group_id: 11, tipo: 'ITEM', external_id: null, campaign_id: null, status: 'ACTIVE', atualizado_em: 'x' }], error: null },
      ml_ads_grupo_dia: { data: [{ ad_group_id: 11, dia: '2026-09-15', cost: '12.34', clicks: 3, prints: 9, direct_amount: '50.10',
        indirect_amount: '0.90', total_amount: '51.00', direct_units: 1, units: 1, coletado_em: 'x' }], error: null },
    };
    mockFrom.mockImplementation((t: string) => {
      if (t === 'ml_ads_sync') return syncChain(sync);
      const chain = fakeChain(tabelas[t]);
      chain.gte = vi.fn(() => chain);
      chain.lte = vi.fn(() => chain);
      return chain;
    });
    mockRpc.mockResolvedValueOnce({ data: { MLB1: ['A'] }, error: null });
    const { buscarFonteAds } = await import('@/lib/sku-dossie-dados');
    const f = await buscarFonteAds(['MLB1'], '2026-09-14', '2026-09-26');
    expect(f.sync).toMatchObject({ custo_resumo: 100.5, custo_listado: 97.4 });
    expect(f.dias[0]).toMatchObject({ cost: 12.34, direct_amount: 50.1, indirect_amount: 0.9, total_amount: 51 });
    expect(f.codigosDosMembros.get('MLB1')).toEqual(['A']);
    expect(mockRpc).toHaveBeenCalledWith('vendas_sku_codigos_mlbs', { p_mlbs: ['MLB1'] });
  });

  it('nenhum grupo toca os MLBs → não lê grupos, dias nem códigos', async () => {
    mockFrom.mockImplementation((t: string) => (t === 'ml_ads_sync' ? syncChain(null) : fakeChain({ data: [], error: null })));
    const { buscarFonteAds } = await import('@/lib/sku-dossie-dados');
    expect(await buscarFonteAds(['MLB1'], '2026-09-14', '2026-09-26')).toMatchObject({ sync: null, grupos: [], dias: [] });
    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('buscarResumoAds (I2)', () => {
  beforeEach(() => { mockRpc.mockReset(); });
  it('chama ads_resumo_periodo com o período e converte numeric (string) em número', async () => {
    mockRpc.mockResolvedValueOnce({ data: { custo_conta: '200.50', dias_conta: 13, custo_grupos_com_membro: '190.25' }, error: null });
    const { buscarResumoAds } = await import('@/lib/sku-dossie-dados');
    expect(await buscarResumoAds('2026-09-14', '2026-09-26')).toEqual({ custo_conta: 200.5, dias_conta: 13, custo_grupos_com_membro: 190.25 });
    expect(mockRpc).toHaveBeenCalledWith('ads_resumo_periodo', { p_desde: '2026-09-14', p_ate: '2026-09-26' });
  });
  it('RPC devolve null → null', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const { buscarResumoAds } = await import('@/lib/sku-dossie-dados');
    expect(await buscarResumoAds('2026-09-14', '2026-09-26')).toBeNull();
  });
  it('erro propaga', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'ads_resumo_periodo: período inválido' } });
    const { buscarResumoAds } = await import('@/lib/sku-dossie-dados');
    await expect(buscarResumoAds('2026-09-26', '2026-09-14')).rejects.toThrow('período inválido');
  });
});
