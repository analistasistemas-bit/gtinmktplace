import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { montarMapaLiquido, mapaLiberacaoPorOrder, carregarLiquidoMPDoPedido } from '../enriquecimento';
import { buscarPagamentosMP, type PagamentoMP } from '../../mercadopago/financeiro';

// Task 7 (ADR-0173): a recuperação por-org do reconciliar-faturamento e do backfill-faturamento
// (e os workers de evento sync-venda/sync-devolucao) lêem o MP por pedido
// (`carregarLiquidoMPDoPedido`), NUNCA pela varredura de 120 dias (`buscarPagamentosMP`) que os
// workers de lote usam. Este teste prova que os dois caminhos produzem o MESMO líquido/liberação
// para o mesmo pedido — dado financeiro, uma divergência silenciosa gravaria número diferente
// dependendo de qual worker processou a venda.

function pag(p: Partial<PagamentoMP> & { id: number }): PagamentoMP {
  return p as PagamentoMP;
}

const CONTA = 123;
const ORDER = '2000099';

/** Mock de /v1/payments/search: devolve o pool inteiro na 1ª página de cada status (a função
 *  real busca 'approved' e depois 'refunded'), páginas seguintes vazias — replica a paginação de
 *  buscarPagamentosMP sem reimplementá-la. */
function mockVarredura(pool: PagamentoMP[]) {
  vi.mocked(fetch).mockImplementation((url) => {
    const params = new URL(String(url)).searchParams;
    const results = params.get('offset') === '0' ? pool.filter((p) => p.status === params.get('status')) : [];
    return Promise.resolve({ ok: true, json: async () => ({ results, paging: { total: results.length } }) } as unknown as Response);
  });
}

/** Mock de /v1/payments/{id}: devolve o pagamento do pool com aquele id. */
function mockPorPedido(pool: PagamentoMP[]) {
  vi.mocked(fetch).mockImplementation((url) => {
    const id = Number(String(url).split('/').pop());
    const p = pool.find((x) => Number(x.id) === id);
    if (!p) return Promise.resolve({ ok: false, status: 404, text: async () => 'not found' } as unknown as Response);
    return Promise.resolve({ ok: true, json: async () => p } as unknown as Response);
  });
}

/** Roda os dois caminhos com o mesmo pool e devolve o par (líquido do pedido, liberação do
 *  pedido) de cada um, para comparar por igualdade. `pool` pode ter ruído de outro pedido: a
 *  varredura vê tudo e filtra por orderId; a leitura por pedido só recebe os ids do pedido. */
async function comparar(pool: PagamentoMP[], idsDoPedido: Array<number | string>) {
  mockVarredura(pool);
  const varredura = await buscarPagamentosMP('token', 120);
  const porPaymentVarredura = montarMapaLiquido(varredura, CONTA);
  const doPedidoNaVarredura = new Map([...porPaymentVarredura].filter(([, d]) => d.orderId === ORDER));
  const liberacaoVarredura = mapaLiberacaoPorOrder(porPaymentVarredura).get(ORDER) ?? null;

  mockPorPedido(pool);
  const porPaymentPedido = await carregarLiquidoMPDoPedido('token', CONTA, idsDoPedido);
  const liberacaoPedido = porPaymentPedido ? mapaLiberacaoPorOrder(porPaymentPedido).get(ORDER) ?? null : null;

  return {
    varredura: { porPayment: doPedidoNaVarredura, liberacao: liberacaoVarredura },
    porPedido: { porPayment: porPaymentPedido, liberacao: liberacaoPedido },
  };
}

describe('equivalência: varredura de 120 dias × leitura por pedido (ADR-0173)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('pedido com 2 pagamentos', async () => {
    const pool = [
      pag({ id: 501, status: 'approved', collector_id: CONTA, order: { id: ORDER }, money_release_date: '2026-08-20T09:00:00.000-04:00' }),
      pag({ id: 502, status: 'approved', collector_id: CONTA, order: { id: ORDER }, money_release_date: '2026-08-21T09:00:00.000-04:00' }),
      pag({ id: 999, status: 'approved', collector_id: CONTA, order: { id: '2000001' }, money_release_date: '2026-08-01T09:00:00.000-04:00' }), // ruído: outro pedido
    ];
    const r = await comparar(pool, [501, 502]);
    expect(r.porPedido.porPayment).toEqual(r.varredura.porPayment);
    expect(r.porPedido.liberacao).toBe(r.varredura.liberacao);
    expect(r.porPedido.liberacao).toBe('2026-08-21T09:00:00.000-04:00'); // liberação mais recente do pedido
  });

  it('estorno total (MP move o pagamento para status refunded)', async () => {
    const pool = [
      pag({ id: 601, status: 'refunded', collector_id: CONTA, order: { id: ORDER }, transaction_amount_refunded: 89.9, money_release_date: null }),
    ];
    const r = await comparar(pool, [601]);
    expect(r.porPedido.porPayment).toEqual(r.varredura.porPayment);
    expect(r.porPedido.porPayment?.get('601')).toEqual({ estorno: 89.9, releaseDate: null, orderId: ORDER });
  });

  it('estorno parcial (pagamento continua approved, com transaction_amount_refunded > 0)', async () => {
    const pool = [
      pag({
        id: 701, status: 'approved', collector_id: CONTA, order: { id: ORDER },
        transaction_amount_refunded: 20, money_release_date: '2026-08-22T09:00:00.000-04:00',
      }),
    ];
    const r = await comparar(pool, [701]);
    expect(r.porPedido.porPayment).toEqual(r.varredura.porPayment);
    expect(r.porPedido.liberacao).toBe(r.varredura.liberacao);
    expect(r.porPedido.porPayment?.get('701')?.estorno).toBe(20);
  });

  // buscarPagamentoMP lança (rede/HTTP) → carregarLiquidoMPDoPedido devolve null, nunca mapa
  // parcial. É esse `null` que os chamadores (reconciliar/backfill/sync-venda/sync-devolucao)
  // leem como `mpFalhou` para decidir retry, em vez de gravar líquido incompleto.
  it('buscarPagamentoMP lança → carregarLiquidoMPDoPedido devolve null (mpFalhou)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    const mpFalhou = await carregarLiquidoMPDoPedido('token', CONTA, [801]);
    expect(mpFalhou).toBeNull();
  });
});
