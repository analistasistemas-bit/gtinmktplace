import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { calcularReserva, pagosDesde, type PedidoPago, type PedidoPendente } from '../conciliacao.ts';
import { importarPedidosDoItem, lerOferta, listarPendentes } from '../ml-oferta.ts';
import { refBaixa } from '../../estoque/baixa.ts';

// Só o catálogo é falso: a busca de pedidos, o mapeamento e `registrarBaixaVenda` são os reais.
vi.mock('../../faturamento/io.ts', async (original) => ({
  ...(await original<typeof import('../../faturamento/io.ts')>()),
  carregarCatalogo: async () => ({
    idsPubliai: new Set(['MLB1', 'MLB2']),
    codigoResolver: (id: string | null) => (id === 'MLB1' ? 'SKU-1' : id === 'MLB2' ? 'SKU-2' : null),
    eanResolver: () => null,
    infoPorGtin: new Map(),
    custoVigenteResolver: () => null,
  }),
}));

const UP = ['MLB1', 'MLB1C'];
const item = (id: string, quantity: number) => ({ item: { id }, quantity });
const pendente = (id: number, status: string, ...itens: ReturnType<typeof item>[]): PedidoPendente => ({
  id, order_items: itens, payments: [{ status }],
});
const pago = (id: number, ...itens: ReturnType<typeof item>[]): PedidoPago => ({
  id, order_items: itens, date_closed: '2026-11-07T12:00:00.000-03:00',
});
const base = { itemIds: UP, pendentes: [], pagosRecentes: [], qtdPasso1: 5, qtdAgora: 5 };

describe('calcularReserva', () => {
  it.each(['cancelled', 'rejected'])('pagamento %s não reserva', (status) => {
    expect(calcularReserva({ ...base, pendentes: [pendente(1, status, item('MLB1', 2))] }))
      .toEqual({ reservado: 0, duvida: false });
  });

  it('pagamento pending reserva a quantidade do item, não o pedido (Review Focus 2)', () => {
    expect(calcularReserva({ ...base, pendentes: [pendente(1, 'pending', item('MLB1', 3))] }))
      .toEqual({ reservado: 3, duvida: false });
  });

  it('nova tentativa pending depois de pagamento rejected reserva', () => {
    const p = { id: 1, order_items: [item('MLB1', 2)], payments: [{ status: 'rejected' }, { status: 'pending' }] };
    expect(calcularReserva({ ...base, pendentes: [p] })).toEqual({ reservado: 2, duvida: false });
  });

  it('pedido com vários itens conta só os do UP, inclusive a cópia de catálogo', () => {
    const p = pendente(1, 'pending', item('MLB1', 2), item('MLB9', 7), item('MLB1C', 1));
    expect(calcularReserva({ ...base, pendentes: [p] })).toEqual({ reservado: 3, duvida: false });
  });

  it('pedido de outro UP não reserva nem gera dúvida, seja qual for o pagamento', () => {
    expect(calcularReserva({ ...base, pendentes: [pendente(1, 'in_process', item('MLB9', 1))] }))
      .toEqual({ reservado: 0, duvida: false });
  });

  it('pedido pago reserva enquanto a quantidade não cair', () => {
    expect(calcularReserva({ ...base, pagosRecentes: [pago(1, item('MLB1', 1))] }))
      .toEqual({ reservado: 1, duvida: false });
  });

  it('pedido pago solta a reserva quando qtdAgora < qtdPasso1', () => {
    expect(calcularReserva({ ...base, pagosRecentes: [pago(1, item('MLB1', 1))], qtdAgora: 4 }))
      .toEqual({ reservado: 0, duvida: false });
  });

  it('pedido parcialmente conciliado segue reservado por inteiro', () => {
    expect(calcularReserva({ ...base, pagosRecentes: [pago(1, item('MLB1', 3))], qtdAgora: 4 }))
      .toEqual({ reservado: 3, duvida: false });
  });

  it('pagamento perto de T, ainda sem baixa no ML, segue reservado', () => {
    const r = calcularReserva({
      ...base, pagosRecentes: pagosDesde([pago(1, item('MLB1', 2))], '2026-11-07T11:59:50.000-03:00'),
    });
    expect(r).toEqual({ reservado: 2, duvida: false });
  });

  it('queda de quantidade não solta o pendente', () => {
    expect(calcularReserva({
      ...base, qtdAgora: 4,
      pendentes: [pendente(1, 'pending', item('MLB1', 2))],
      pagosRecentes: [pago(2, item('MLB1', 1))],
    })).toEqual({ reservado: 2, duvida: false });
  });

  it('pedido que passou de pendente a pago entre as leituras conta uma vez', () => {
    expect(calcularReserva({
      ...base,
      pendentes: [pendente(1, 'pending', item('MLB1', 2))],
      pagosRecentes: [pago(1, item('MLB1', 2))],
    })).toEqual({ reservado: 2, duvida: false });
  });

  it.each([
    ['pendentes', { pendentes: null }],
    ['pagos', { pagosRecentes: null }],
    ['quantidade do passo 1', { qtdPasso1: null }],
    ['quantidade atual', { qtdAgora: null }],
    ['quantidade não finita', { qtdAgora: Number.NaN }],
  ])('leitura com falha (%s) devolve dúvida', (_nome, falha) => {
    expect(calcularReserva({ ...base, ...falha }).duvida).toBe(true);
  });

  it.each([
    ['pagamento desconhecido', pendente(1, 'in_process', item('MLB1', 1))],
    ['sem pagamento', { id: 1, order_items: [item('MLB1', 1)], payments: [] }],
    ['quantidade inválida', pendente(1, 'pending', { item: { id: 'MLB1' }, quantity: 0 })],
    ['item sem id', pendente(1, 'pending', { item: {}, quantity: 1 } as ReturnType<typeof item>)],
    ['sem itens', pendente(1, 'pending')],
  ])('%s devolve dúvida', (_nome, p) => {
    expect(calcularReserva({ ...base, pendentes: [p] }).duvida).toBe(true);
  });

  it('saldo que subiu sem explicação devolve dúvida', () => {
    expect(calcularReserva({ ...base, qtdAgora: 6 }).duvida).toBe(true);
  });

  it('queda maior que os pagos conhecidos devolve dúvida', () => {
    expect(calcularReserva({ ...base, pagosRecentes: [pago(1, item('MLB1', 1))], qtdAgora: 3 }).duvida).toBe(true);
  });
});

describe('pagosDesde', () => {
  it('descarta o pago antes do instante, mantém o posterior e o sem data', () => {
    const antigo = { ...pago(1), date_closed: '2026-11-07T10:00:00.000-03:00' };
    const recente = { ...pago(2), date_closed: '2026-11-07T12:00:00.000-03:00' };
    const semData = { ...pago(3), date_closed: null };
    expect(pagosDesde([antigo, recente, semData], '2026-11-07T11:00:00.000-03:00')).toEqual([recente, semData]);
  });
});

const json = (corpo: unknown, init?: ResponseInit) => new Response(JSON.stringify(corpo), init);

/** Rotas do ML por trecho de URL. URL sem rota falha o teste. */
function fakeFetch(rotas: Array<[string, () => Response]>) {
  const chamadas: string[] = [];
  const f = (async (url: string) => {
    chamadas.push(String(url));
    const rota = rotas.find(([trecho]) => String(url).includes(trecho));
    if (!rota) throw new Error(`rota não prevista: ${url}`);
    return rota[1]();
  }) as unknown as typeof fetch;
  return { f, chamadas };
}

const estoque = (locations: unknown, headers: Record<string, string> = { 'x-version': '8' }) =>
  () => json({ locations }, { headers });
const rotasOferta = (sobre: Array<[string, () => Response]> = []): Array<[string, () => Response]> => [
  ...sobre,
  ['/user-products/MLBU1/stock', estoque([{ type: 'selling_address', quantity: 4 }])],
  ['/users/me', () => json({ id: 77 })],
  ['/users/77/items/search', () => json({ results: ['MLB1', 'MLB1C'], paging: { total: 2 } })],
  ['/items/bulk', () => json([
    { status_code: 200, body: { id: 'MLB1', user_product_id: 'MLBU1', status: 'paused', sub_status: ['paused_by_seller'] } },
    { status_code: 200, body: { id: 'MLB1C', user_product_id: 'MLBU1', status: 'active', sub_status: [] } },
  ])],
];

describe('lerOferta', () => {
  it('soma os locais, lê x-version e lista os itens do UP', async () => {
    const { f, chamadas } = fakeFetch(rotasOferta());
    await expect(lerOferta('tok', 'MLBU1', f)).resolves.toEqual({
      upId: 'MLBU1', versao: 8, quantidade: 4,
      locais: [{ type: 'selling_address', quantity: 4 }],
      itens: [
        { id: 'MLB1', status: 'paused', subStatus: ['paused_by_seller'] },
        { id: 'MLB1C', status: 'active', subStatus: [] },
      ],
      somenteSellingAddress: true,
    });
    expect(chamadas.some((u) => u.includes('user_product_id=MLBU1'))).toBe(true);
  });

  it('segundo local devolve somenteSellingAddress false, mesmo com quantidade 0', async () => {
    const { f } = fakeFetch(rotasOferta([['/stock', estoque([
      { type: 'selling_address', quantity: 4 }, { type: 'meli_facility', quantity: 0 },
    ])]]));
    await expect(lerOferta('tok', 'MLBU1', f)).resolves.toMatchObject({ quantidade: 4, somenteSellingAddress: false });
  });

  it('sem local nenhum não é somenteSellingAddress', async () => {
    const { f } = fakeFetch(rotasOferta([['/stock', estoque([])]]));
    await expect(lerOferta('tok', 'MLBU1', f)).resolves.toMatchObject({ quantidade: 0, somenteSellingAddress: false });
  });

  it.each<[string, Array<[string, () => Response]>]>([
    ['status inesperado no estoque', [['/stock', () => json({}, { status: 500 })]]],
    ['sem x-version', [['/stock', estoque([{ type: 'selling_address', quantity: 4 }], {})]]],
    ['locations ausente', [['/stock', estoque(undefined)]]],
    ['quantity não numérica', [['/stock', estoque([{ type: 'selling_address', quantity: '4' }])]]],
    ['falha em /users/me', [['/users/me', () => json({}, { status: 401 })]]],
    ['busca com status inesperado', [['/items/search', () => json({}, { status: 403 })]]],
    ['UP sem itens', [['/items/search', () => json({ results: [], paging: { total: 0 } })]]],
    ['busca truncada', [['/items/search', () => json({ results: ['MLB1'], paging: { total: 2 } })]]],
    ['busca sem paging.total', [['/items/search', () => json({ results: ['MLB1'] })]]],
    ['bulk com item não lido', [['/items/bulk', () => json([
      { status_code: 200, body: { id: 'MLB1', user_product_id: 'MLBU1', status: 'paused', sub_status: [] } },
      { status_code: 404 },
    ])]]],
    // ADR-0105: a busca do ML ignora em silêncio filtro que não conhece e devolve a conta inteira.
    ['item de outro UP na busca', [['/items/bulk', () => json([
      { status_code: 200, body: { id: 'MLB1', user_product_id: 'MLBU1', status: 'paused', sub_status: [] } },
      { status_code: 200, body: { id: 'MLB1C', user_product_id: 'MLBU2', status: 'active', sub_status: [] } },
    ])]]],
    ['bulk com status inesperado', [['/items/bulk', () => json({}, { status: 500 })]]],
  ])('%s lança', async (_nome, sobre) => {
    const { f } = fakeFetch(rotasOferta(sobre));
    await expect(lerOferta('tok', 'MLBU1', f)).rejects.toThrow();
  });

  it('falha de rede lança', async () => {
    await expect(lerOferta('tok', 'MLBU1', (() => Promise.reject(new Error('rede'))) as unknown as typeof fetch))
      .rejects.toThrow('rede');
  });
});

describe('listarPendentes', () => {
  const lote = (de: number, n: number) =>
    Array.from({ length: n }, (_, i) => pendente(de + i, 'pending', item('MLB1', 1)));

  it('pagina /orders/search/pending até o total', async () => {
    const paginas = [lote(0, 50), lote(50, 3)];
    const { f, chamadas } = fakeFetch([
      ['/orders/search/pending', () => json({ results: paginas.shift(), paging: { total: 53 } })],
    ]);
    await expect(listarPendentes('tok', '77', f)).resolves.toHaveLength(53);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]).toContain('seller=77');
    expect(chamadas[1]).toContain('offset=50');
  });

  it('nenhum pendente devolve lista vazia', async () => {
    const { f } = fakeFetch([['/orders/search/pending', () => json({ results: [], paging: { total: 0 } })]]);
    await expect(listarPendentes('tok', '77', f)).resolves.toEqual([]);
  });

  it.each<[string, () => Response]>([
    ['status inesperado', () => json({}, { status: 500 })],
    ['results ausente', () => json({ paging: { total: 0 } })],
    ['sem paging.total', () => json({ results: [] })],
    ['acima do teto', () => json({ results: [], paging: { total: 5001 } })],
    ['página vazia antes do total', () => json({ results: [], paging: { total: 3 } })],
  ])('%s lança', async (_nome, resposta) => {
    const { f } = fakeFetch([['/orders/search/pending', resposta]]);
    await expect(listarPendentes('tok', '77', f)).rejects.toThrow();
  });

  it('total que muda durante a varredura lança', async () => {
    const paginas = [{ results: lote(0, 50), paging: { total: 53 } }, { results: lote(50, 4), paging: { total: 54 } }];
    const { f } = fakeFetch([['/orders/search/pending', () => json(paginas.shift())]]);
    await expect(listarPendentes('tok', '77', f)).rejects.toThrow();
  });

  it('falha de rede lança', async () => {
    await expect(listarPendentes('tok', '77', (() => Promise.reject(new Error('rede'))) as unknown as typeof fetch))
      .rejects.toThrow('rede');
  });
});

/** Banco falso: `baixar_estoque` idempotente por referência, como a RPC real. */
function fakeAdmin(opts: { erroRpc?: string } = {}) {
  const baixas: Array<{ ref: string; qtd: number }> = [];
  const refs = new Set<string>();
  const consulta = (): any => {
    const self: any = {
      select: () => self, eq: () => self, is: () => self, neq: () => self, order: () => self, limit: () => self,
      update: () => self,
      maybeSingle: () => Promise.resolve({
        data: { familias: { codigo_pai: 'PAI-1', kit_base_codigo_pai: null, kit_multiplicador: null } }, error: null,
      }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
    };
    return self;
  };
  const admin = {
    from: consulta,
    rpc: (_fn: string, a: { p_ref: string; p_qtd: number }) => {
      if (opts.erroRpc) return Promise.resolve({ data: null, error: { message: opts.erroRpc } });
      if (refs.has(a.p_ref)) return Promise.resolve({ data: { aplicado: false, motivo: 'duplicata' }, error: null });
      refs.add(a.p_ref);
      baixas.push({ ref: a.p_ref, qtd: a.p_qtd });
      return Promise.resolve({
        data: {
          aplicado: true, motivo: 'ok', codigo_pai: 'PAI-1', movimento_id: 'm',
          estoque_anterior: 100, quantidade_pedida: a.p_qtd, quantidade_aplicada: a.p_qtd,
        },
        error: null,
      });
    },
  } as unknown as SupabaseClient;
  return { admin, baixas };
}

describe('importarPedidosDoItem', () => {
  const pedidoML = (id: number, sobre: Record<string, unknown> = {}) => ({
    id, status: 'paid', seller: { id: 77 }, order_items: [item('MLB1', 2)], ...sobre,
  });
  const orders = (results: unknown[]) => fakeFetch([
    ['/users/me', () => json({ id: 77 })],
    ['/orders/search', () => json({ results, paging: { total: results.length } })],
  ]).f;
  const deps = (f: typeof fetch) => ({ token: 'tok', seller: '77', desde: '2026-11-04T00:00:00.000-03:00', fetch: f });

  it('importar duas vezes baixa uma, com a mesma referência do sync-venda', async () => {
    const { admin, baixas } = fakeAdmin();
    const f = orders([pedidoML(10)]);
    await importarPedidosDoItem(admin, 'org', ['MLB1'], deps(f));
    await importarPedidosDoItem(admin, 'org', ['MLB1'], deps(f));
    expect(baixas).toEqual([{ ref: refBaixa('mercado_livre', 10, 'SKU-1'), qtd: 2 }]);
  });

  it('devolve os pagos do item e ignora não pago, compra da conta e outro item', async () => {
    const { admin, baixas } = fakeAdmin();
    const certo = pedidoML(10);
    const r = await importarPedidosDoItem(admin, 'org', ['MLB1'], deps(orders([
      certo,
      pedidoML(11, { status: 'cancelled' }),
      pedidoML(12, { seller: { id: 99 } }),
      pedidoML(13, { order_items: [item('MLB2', 1)] }),
    ])));
    expect(r.pagos).toEqual([certo]);
    expect(baixas.map((b) => b.ref)).toEqual([refBaixa('mercado_livre', 10, 'SKU-1')]);
    expect(r.falhas).toEqual([]);
  });

  it('pedido com vários itens baixa todos, como o sync-venda', async () => {
    const { admin, baixas } = fakeAdmin();
    await importarPedidosDoItem(admin, 'org', ['MLB1'], deps(orders([
      pedidoML(10, { order_items: [item('MLB1', 1), item('MLB2', 3)] }),
    ])));
    expect(baixas).toEqual([
      { ref: refBaixa('mercado_livre', 10, 'SKU-1'), qtd: 1 },
      { ref: refBaixa('mercado_livre', 10, 'SKU-2'), qtd: 3 },
    ]);
  });

  it('falha da baixa aparece em falhas, para virar dúvida', async () => {
    const { admin } = fakeAdmin({ erroRpc: 'rpc caiu' });
    const r = await importarPedidosDoItem(admin, 'org', ['MLB1'], deps(orders([pedidoML(10)])));
    expect(r.falhas).toEqual(['pedido 10: SKU-1: rpc caiu']);
  });

  it('devolve o resultado de cada baixa, porque o sync-venda não alertará de novo', async () => {
    const { admin } = fakeAdmin();
    const r = await importarPedidosDoItem(admin, 'org', ['MLB1'], deps(orders([pedidoML(10)])));
    expect(r.baixas).toEqual([expect.objectContaining({ orderId: '10' })]);
  });

  it('falha na leitura dos pedidos lança', async () => {
    const { admin } = fakeAdmin();
    const { f } = fakeFetch([
      ['/users/me', () => json({ id: 77 })],
      ['/orders/search', () => json({}, { status: 500 })],
    ]);
    await expect(importarPedidosDoItem(admin, 'org', ['MLB1'], deps(f))).rejects.toThrow();
  });
});
