import { describe, expect, it } from 'vitest';
import {
  contarAtencao, lucroDoPeriodo, resultadoCarrinho, resultadoPorItem, topPorLucro, type ResultadoItem,
} from '../resultado.ts';
import {
  carregarContexto, ContextoIndisponivel, lerPaginas, lerVendasDoCarrinho, lerVendasJanela,
  VolumeAcimaDoLimite, type ContextoCalculo, type MetricsDb,
} from '../../../platform-admin/metrics-repository.ts';
import {
  montarAliquotaResolver, montarCustoResolver, montarMapasCusto, montarPesoResolver,
} from '../../../platform-admin/sales-costs.ts';
import type { Venda, VendaItem } from '../../../platform-admin/sales-types.ts';
import { agruparPorPedido } from '../../../../../../src/lib/pedidos-faturamento';
import { cascataDoPedido } from '../../../../../../src/lib/cascata-pedido';

type Row = Record<string, unknown>;

const item = (patch: Partial<VendaItem> = {}): VendaItem => ({
  id: 'i1', ml_item_id: 'MLB1', variation_id: 1, titulo: 'Produto 1', codigo: 'SKU1', cor: null, ean: null,
  quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, custo_congelado: null, ...patch,
});

const venda = (patch: Partial<Venda> = {}): Venda => ({
  id: 'v1', org_id: 'org-a', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-10-20T12:00:00-03:00', date_created: null, comprador_nick: null, comprador_nome: null,
  comprador_id: null, uf: 'SP', cidade: null, total_amount: 100, paid_amount: 100, liquido: 80,
  sale_fee_total: 10, frete_vendedor: 10, estorno: null, money_release_date: null, sacado_em: null,
  sacado_por: null, atualizado_em: '2026-10-20T12:00:00-03:00', currency: 'BRL', shipping_id: null,
  shipping_status: null, shipping_substatus: null, shipping_logistic: null, tracking_number: null,
  is_publiai: true, tem_devolucao: false, itens: [item()], ...patch,
});

const catRow = (mlItemId: string, varId: number, custo: number, peso: number, origem = 'nacional'): Row => ({
  custo, peso_gramas: peso, ml_variation_id: String(varId), gtin: null, codigo: null,
  atualizado_em: '2026-01-01', familias: { ml_item_id: mlItemId, origem },
});

const maps = montarMapasCusto([
  catRow('MLB1', 1, 25, 300), catRow('MLB2', 2, 15, 100), catRow('MLB4', 4, 12, 200, 'importado'),
]);
const ctx: ContextoCalculo = {
  maps, rates: { nacional: 8, importado: 16, ufEmpresa: 'CE', internaPct: 8 }, custosOk: true, configOk: true,
};

/** Lucro do pedido como a tela calcula (Detalhe da venda → cascata). */
function margemDaTela(vendas: Venda[], c: ContextoCalculo = ctx): number | null {
  const pedido = agruparPorPedido(
    vendas, montarCustoResolver(c.maps), montarPesoResolver(c.maps), undefined,
    c.configOk ? montarAliquotaResolver(c.maps, c.rates) : undefined,
  )[0];
  return cascataDoPedido(pedido).margem;
}

const lucroGerencial = (vendas: Venda[], c: ContextoCalculo = ctx) =>
  resultadoCarrinho(resultadoPorItem(vendas, c), c.configOk);

describe('resultadoCarrinho — fixture calculada à mão', () => {
  it('pedido sem pack, 1 item, quantidade 2: lucro 32', () => {
    const v = venda({ itens: [item({ quantity: 2, unit_price: 50, custo_congelado: 20 })] });
    const r = lucroGerencial([v]);
    expect(r).toMatchObject({ venda: 100, itens: 1, lucro: 32, margemSobreVenda: 0.32, markup: 0.8, motivo: null });
    expect(margemDaTela([v])).toBe(32);
  });
});

describe('paridade com cascataDoPedido (Lucro do pedido da tela)', () => {
  const packA = [
    venda({ id: 'a1', order_id: 11, pack_id: 900, shipping_id: 555, total_amount: 60, sale_fee_total: 10,
      frete_vendedor: 10, liquido: 40, itens: [item({ id: 'a1i', unit_price: 60 })] }),
    venda({ id: 'a2', order_id: 12, pack_id: 900, shipping_id: 555, total_amount: 40, sale_fee_total: 9.8,
      frete_vendedor: 10, liquido: 20.2, itens: [item({ id: 'a2i', ml_item_id: 'MLB2', variation_id: 2,
        titulo: 'Produto 2', codigo: 'SKU2', unit_price: 40 })] }),
  ];
  const pedidoB = [venda({ id: 'b1', order_id: 21, uf: 'CE', total_amount: 100, liquido: 80, itens: [
    item({ id: 'b1i', unit_price: 70 }),
    item({ id: 'b2i', ml_item_id: 'MLB3', variation_id: 3, titulo: 'Sem custo', codigo: 'SKU3', unit_price: 30 }),
  ] })];
  const packC = [
    venda({ id: 'c1', order_id: 31, pack_id: 901, shipping_id: 556, total_amount: 55.5, sale_fee_total: 7.33,
      frete_vendedor: 12.9, liquido: 35.27, itens: [item({ id: 'c1i', unit_price: 55.5, custo_congelado: 21.37 })] }),
    venda({ id: 'c2', order_id: 32, pack_id: 901, shipping_id: 556, status: 'cancelled', total_amount: 40,
      sale_fee_total: 5, frete_vendedor: 12.9, liquido: 22.1, itens: [item({ id: 'c2i', ml_item_id: 'MLB2',
        variation_id: 2, unit_price: 40 })] }),
  ];
  const pedidoD = [venda({ id: 'd1', order_id: 41, total_amount: 89.7, sale_fee_total: 12.11, frete_vendedor: 18.45,
    liquido: 59.14, itens: [item({ id: 'd1i', ml_item_id: 'MLB4', variation_id: 4, quantity: 3, unit_price: 29.9 })] })];

  it.each([
    ['(a) pack de 2 orders com frete compartilhado', packA],
    ['(b) multi-item com custo parcial', pedidoB],
    ['(c) pack com 1 order cancelada', packC],
    ['(d) item com quantidade 3', pedidoD],
  ])('%s', (_nome, vendas) => {
    const tela = margemDaTela(vendas);
    const gerencial = lucroGerencial(vendas).lucro;
    expect(gerencial).toBe(tela);
    // Base da Margem s/ venda: Σ valorDoItem (gerencial) = brutoFaturavel (tela).
    const pedido = agruparPorPedido(vendas, montarCustoResolver(ctx.maps))[0];
    expect(lucroGerencial(vendas).venda).toBe(cascataDoPedido(pedido).venda);
  });

  it('as fixtures (a), (c) e (d) têm lucro calculado (paridade não é null == null)', () => {
    for (const vendas of [packA, packC, pedidoD]) expect(lucroGerencial(vendas).lucro).not.toBeNull();
  });

  it('(b) sem custo → lucro null, motivo sem_custo, título no semCusto', () => {
    const r = lucroGerencial(pedidoB);
    expect(r.lucro).toBeNull();
    expect(r.motivo).toBe('sem_custo');
    expect(r.semCusto).toEqual(['Sem custo']);
  });
});

describe('base dos itens zerada (cupom do vendedor = valor dos itens)', () => {
  it('preserva o líquido do pedido como a cascata: venda 100, cupom 100, frete 10, custo 20 → −30', () => {
    const v = venda({ total_amount: 100, cupom_vendedor: 100, sale_fee_total: 0, frete_vendedor: 10, liquido: -10,
      itens: [item({ unit_price: 100, cupom_vendedor: 100, custo_congelado: 20 })] });
    expect(margemDaTela([v])).toBe(-30);
    expect(lucroGerencial([v]).lucro).toBe(-30);
  });
});

describe('motivos sem lucro', () => {
  it('frete nulo com shipping_id → frete_nao_lido', () => {
    const v = venda({ shipping_id: 77, frete_vendedor: null, itens: [item({ custo_congelado: 20 })] });
    const r = lucroGerencial([v]);
    expect(r.lucro).toBeNull();
    expect(r.motivo).toBe('frete_nao_lido');
  });

  it('configOk false → aliquota_nao_confirmada, e lucro do período null', () => {
    const c = { ...ctx, rates: null, configOk: false };
    const itens = resultadoPorItem([venda({ itens: [item({ custo_congelado: 20 })] })], c);
    expect(resultadoCarrinho(itens, false).motivo).toBe('aliquota_nao_confirmada');
    expect(lucroDoPeriodo(itens, false).lucro).toBeNull();
    expect(lucroDoPeriodo(itens, false).motivo).toBe('aliquota_nao_confirmada');
  });
});

describe('prejuízo mascarado', () => {
  it('item com −4,10 aparece mesmo com o pedido em +5,90', () => {
    const v = venda({ uf: 'CE', liquido: 80, itens: [
      item({ id: 'p1', titulo: 'Bom', unit_price: 60, custo_congelado: 33.2 }),
      item({ id: 'p2', titulo: 'Ruim', codigo: 'SKU9', unit_price: 40, custo_congelado: 32.9 }),
    ] });
    const r = lucroGerencial([v]);
    expect(r.lucro).toBe(5.9);
    expect(r.prejuizos).toEqual([{ titulo: 'Ruim', valor: -4.1 }]);
    expect(margemDaTela([v])).toBe(5.9);
  });
});

const ri = (patch: Partial<ResultadoItem> = {}): ResultadoItem => ({
  orderId: 1, packChave: '1', codigo: 'SKU1', titulo: 'Produto 1', quantidade: 1, venda: 100, liquido: 80,
  imposto: 8, impostoOk: true, custo: 40, custoEstimado: false, faturavel: true, freteNaoLido: false, lucro: 32,
  ...patch,
});

describe('lucroDoPeriodo', () => {
  it('cobertura: 1 item sem custo (50) e 1 com custo (150)', () => {
    const r = lucroDoPeriodo([
      ri({ orderId: 1, packChave: '1', venda: 50, custo: null, lucro: null }),
      ri({ orderId: 2, packChave: '2', venda: 150, liquido: 120, imposto: 12, custo: 60, lucro: 48 }),
    ], true);
    expect(r.pctVendaComLucro).toBe(0.75);
    expect(r.vendaSemCusto).toBe(50);
    expect(r.lucro).toBe(48);
    expect(r.markup).toBe(0.8);
    expect(r.motivo).toBeNull();
    expect(r.vendaSemImposto).toBe(0);
  });

  it('vendaSemImposto: item com custo e sem alíquota resolvida explica a cobertura', () => {
    const r = lucroDoPeriodo([
      ri({ orderId: 1, packChave: '1', venda: 30, impostoOk: false, imposto: 0, lucro: null }),
      ri({ orderId: 2, packChave: '2', venda: 20, custo: null, impostoOk: false, imposto: 0, lucro: null }),
      ri({ orderId: 3, packChave: '3', venda: 50, liquido: 40, imposto: 4, custo: 20, lucro: 16 }),
    ], true);
    expect(r.vendaSemImposto).toBe(30);
    expect(r.vendaSemCusto).toBe(20);
    expect(r.pctVendaComLucro).toBe(0.5);
  });
});

describe('topPorLucro só com lucro positivo', () => {
  const it_ = (titulo: string, lucro: number) => ({ titulo, codigo: titulo, lucro } as unknown as ResultadoItem);
  it('exclui grupo com lucro negativo ou zero', () => {
    const itens = [it_('A', 35.27), it_('B', 4.18), it_('C', -6.28), it_('D', 0)];
    expect(topPorLucro(itens, 5).map((t) => t.titulo)).toEqual(['A', 'B']);
  });
  it('agrupa antes de filtrar', () => {
    expect(topPorLucro([it_('A', 10), it_('A', -4), it_('B', -1)], 5)).toEqual([{ titulo: 'A', lucro: 6 }]);
  });
  it('tudo negativo → vazio', () => {
    expect(topPorLucro([it_('A', -1), it_('B', -2)], 5)).toEqual([]);
  });
});

describe('contarAtencao — prejuízos nomeados', () => {
  const vermelho = (patch: Partial<ResultadoItem> = {}) =>
    ri({ liquido: 40, imposto: 4, custo: 40, lucro: -4.1, ...patch });
  const verde = (patch: Partial<ResultadoItem> = {}) => ri({ lucro: 10, ...patch });

  it('agrega por SKU somando só as vendas vermelhas', () => {
    const r = contarAtencao([vermelho({ orderId: 1 }), verde({ orderId: 2 })], new Map());
    expect(r.prejuizos).toEqual([{ codigo: 'SKU1', titulo: 'Produto 1', valor: -4.1, vendas: 1 }]);
  });

  it('sem código agrega pelo título', () => {
    const r = contarAtencao([
      vermelho({ orderId: 1, codigo: null, titulo: 'Sem SKU', lucro: -2 }),
      vermelho({ orderId: 2, codigo: null, titulo: 'Sem SKU', lucro: -3 }),
    ], new Map());
    expect(r.prejuizos).toEqual([{ codigo: null, titulo: 'Sem SKU', valor: -5, vendas: 2 }]);
  });

  it('ordena pelo maior prejuízo', () => {
    const r = contarAtencao([
      vermelho({ orderId: 1, codigo: 'A', lucro: -1 }),
      vermelho({ orderId: 2, codigo: 'B', lucro: -9 }),
    ], new Map());
    expect(r.prejuizos.map((p) => p.codigo)).toEqual(['B', 'A']);
  });

  it('contagem prejuizo inalterada', () => {
    const r = contarAtencao([vermelho({ orderId: 1 }), vermelho({ orderId: 2 }), verde({ orderId: 3 })], new Map());
    expect(r.prejuizo).toBe(2);
  });
});

describe('imposto indisponível por item', () => {
  // A casa no catálogo (origem nacional); B tem custo congelado mas não está no catálogo → sem origem.
  const v = venda({ uf: 'SP', liquido: 80, itens: [
    item({ id: 'A', titulo: 'A', codigo: 'SKUA', unit_price: 50, custo_congelado: 10 }),
    item({ id: 'B', ml_item_id: 'MLB99', variation_id: 99, titulo: 'B', codigo: 'SKUB', unit_price: 50,
      custo_congelado: 60 }),
  ] });
  const itens = resultadoPorItem([v], ctx);
  const b = itens.find((it) => it.titulo === 'B')!;

  it('B fica sem imposto confirmado e sem lucro', () => {
    expect(b.impostoOk).toBe(false);
    expect(b.lucro).toBeNull();
    expect(itens.find((it) => it.titulo === 'A')!.impostoOk).toBe(true);
  });

  it('carrinho → aliquota_nao_confirmada', () => {
    expect(resultadoCarrinho(itens, true).motivo).toBe('aliquota_nao_confirmada');
  });

  it('top e atenção ignoram B', () => {
    expect(topPorLucro(itens, 5).map((t) => t.titulo)).toEqual(['A']);
    const atencao = contarAtencao(itens, new Map([['SKUA', 1], ['SKUB', 1000]]));
    expect(atencao.prejuizo).toBe(0);
    expect(atencao.abaixoMinimo).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Leituras (fake db)
// ---------------------------------------------------------------------------------------------
type Call = { table: string; op: string; args: unknown[] };

function fakeDb(opts: { rows?: Row[]; count?: number; rpcError?: string; config?: Row[] } = {}) {
  const calls: Call[] = [];
  const db = {
    calls,
    rpc(name: string, args: Row) {
      calls.push({ table: name, op: 'rpc', args: [args] });
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      return Promise.resolve({ data: [], error: null });
    },
    from(table: string) {
      let head = false;
      const q: Record<string, unknown> = {};
      const rec = (op: string) => (...args: unknown[]) => { calls.push({ table, op, args }); return q; };
      for (const op of ['eq', 'in', 'gte', 'lt', 'order']) q[op] = rec(op);
      q.select = (...args: unknown[]) => {
        calls.push({ table, op: 'select', args });
        head = (args[1] as { head?: boolean } | undefined)?.head === true;
        return q;
      };
      q.range = (from: number, to: number) => {
        calls.push({ table, op: 'range', args: [from, to] });
        const rows = table === 'configuracoes' ? opts.config ?? [] : opts.rows ?? [];
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      };
      q.then = (resolve: (v: unknown) => unknown) => resolve(head
        ? { count: opts.count ?? 0, error: null }
        : { data: [], error: null });
      return q;
    },
  };
  return db;
}

const janela = { desde: '2026-10-20T00:00:00-03:00', ate: '2026-10-21T00:00:00-03:00' };

describe('leituras', () => {
  it('lerVendasDoCarrinho filtra por pack_id, sem janela de data', async () => {
    const db = fakeDb();
    await lerVendasDoCarrinho(db as unknown as MetricsDb, 'org-a', { packId: 900, orderId: 11 });
    const vendas = db.calls.filter((c) => c.table === 'ml_vendas');
    expect(vendas).toEqual(expect.arrayContaining([{ table: 'ml_vendas', op: 'eq', args: ['pack_id', 900] }]));
    expect(vendas.some((c) => (c.op === 'gte' || c.op === 'lt') && c.args[0] === 'date_closed')).toBe(false);
    const colunas = String(vendas.find((c) => c.op === 'select')?.args[0]);
    expect(colunas).toContain('itens:ml_vendas_itens(ml_item_id, variation_id, titulo,');
    expect(colunas).toContain('custos:venda_item_custo(');
  });

  it('lerVendasDoCarrinho sem pack filtra por order_id', async () => {
    const db = fakeDb();
    await lerVendasDoCarrinho(db as unknown as MetricsDb, 'org-a', { packId: null, orderId: 11 });
    expect(db.calls).toEqual(expect.arrayContaining([{ table: 'ml_vendas', op: 'eq', args: ['order_id', 11] }]));
  });

  it('lerVendasDoCarrinho para no teto de linhas', async () => {
    const rows = Array.from({ length: 5001 }, (_, n) => ({ id: `s${n}`, org_id: 'org-a', itens: [], custos: [] }));
    const db = fakeDb({ rows });
    await expect(lerVendasDoCarrinho(db as unknown as MetricsDb, 'org-a', { packId: 900, orderId: 11 }))
      .rejects.toThrow(VolumeAcimaDoLimite);
  });

  it('carregarContexto lança ContextoIndisponivel se a RPC de catálogo falha', async () => {
    const db = fakeDb({ rpcError: 'boom', config: [] });
    await expect(carregarContexto(db as unknown as MetricsDb, 'org-a', janela.desde)).rejects.toThrow(ContextoIndisponivel);
  });

  it('lerVendasJanela com count acima do teto lança sem paginar', async () => {
    const db = fakeDb({ count: 5001 });
    await expect(lerVendasJanela(db as unknown as MetricsDb, 'org-a', janela)).rejects.toThrow(VolumeAcimaDoLimite);
    expect(db.calls.some((c) => c.op === 'range')).toBe(false);
  });

  it('lerVendasJanela para no teto mesmo com count abaixo dele', async () => {
    const rows = Array.from({ length: 5001 }, (_, n) => ({ id: `s${n}`, org_id: 'org-a', itens: [], custos: [] }));
    const db = fakeDb({ count: 4990, rows });
    await expect(lerVendasJanela(db as unknown as MetricsDb, 'org-a', janela)).rejects.toThrow(VolumeAcimaDoLimite);
  });

  it('lerPaginas sem opções lê 2.500 linhas (regressão)', async () => {
    const rows = Array.from({ length: 2500 }, (_, n) => ({ n }));
    const db = fakeDb({ rows });
    const r = await lerPaginas(() => (db as unknown as MetricsDb).from('ml_vendas'));
    expect(r.error).toBeNull();
    expect(r.rows).toHaveLength(2500);
  });
});
