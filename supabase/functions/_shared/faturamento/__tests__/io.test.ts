import { describe, it, expect, vi } from 'vitest';
import { upsertVenda } from '../io';
import type { PedidoML } from '../venda';

type Linha = Record<string, unknown> | null;

/**
 * Fake mínimo do admin client, só com as cadeias que `upsertVenda` usa. `ml_vendas` guarda a
 * última linha gravada e a devolve como estado anterior na leitura seguinte — é isso que permite
 * exercitar "grava, depois reprocessa o mesmo pedido".
 */
function criarAdminFake() {
  let linha: Linha = null;
  const atualizarMensagens = vi.fn(() => ({
    eq: () => ({ or: async () => ({ error: null }) }),
  }));
  const upsertVendas = vi.fn((row: Record<string, unknown>) => {
    linha = row;
    return { select: () => ({ single: async () => ({ data: { id: 'venda-1' }, error: null }) }) };
  });
  const from = vi.fn((tabela: string) =>
    tabela === 'ml_vendas'
      ? {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: linha }) }) }) }),
          upsert: upsertVendas,
        }
      : tabela === 'ml_mensagens'
        ? { update: atualizarMensagens }
        : {
          delete: () => ({ eq: async () => ({ error: null }) }),
          upsert: async () => ({ error: null }),
        });
  return { admin: { from } as unknown as Parameters<typeof upsertVenda>[0], upsertVendas, atualizarMensagens };
}

const pedido: PedidoML = {
  id: 555,
  status: 'paid',
  total_amount: 100,
  payments: [{ id: 1 }],
  order_items: [{ item: { id: 'MLB1' }, quantity: 1, unit_price: 100, sale_fee: 10 }],
};

const opts = { idsPubliai: new Set<string>(), codigoResolver: () => null, freteVendedor: 5 };

describe('upsertVenda', () => {
  // O bug que o ADR-0093 fecha: o upsert regrava a linha inteira, então um sync em que a leitura
  // do MP falhou (liquidoPorPayment undefined) apagaria estorno/liberação já corretos — o selo de
  // liberação sumiria e notificar-liberacao nunca dispararia, em silêncio.
  it('reprocessar sem dados do MP preserva estorno e money_release_date já gravados', async () => {
    const { admin, upsertVendas } = criarAdminFake();

    await upsertVenda(admin, 'user-1', 'org-1', pedido, {
      ...opts,
      liquidoPorPayment: new Map([['1', { estorno: 12.5, releaseDate: '2026-07-30T00:00:00.000-04:00' }]]),
    });
    expect(upsertVendas.mock.calls[0][0]).toMatchObject({
      estorno: 12.5, money_release_date: '2026-07-30T00:00:00.000-04:00',
    });

    // Segunda passada: o MP não respondeu, o worker chama com liquidoPorPayment undefined.
    await upsertVenda(admin, 'user-1', 'org-1', pedido, { ...opts, liquidoPorPayment: undefined });
    expect(upsertVendas.mock.calls[1][0]).toMatchObject({
      estorno: 12.5, money_release_date: '2026-07-30T00:00:00.000-04:00',
    });
  });
});

it('transição para cancelado atualiza os snapshots do pack sem sincronizar mensagem nova', async () => {
  const { admin, atualizarMensagens } = criarAdminFake();

  await upsertVenda(admin, 'user-1', 'org-1', pedido, opts);
  await upsertVenda(admin, 'user-1', 'org-1', { ...pedido, status: 'cancelled', pack_id: 777 }, opts);

  expect(atualizarMensagens).toHaveBeenLastCalledWith({ order_status: 'cancelled' });
});
