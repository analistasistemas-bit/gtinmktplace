import { describe, it, expect, vi } from 'vitest';
import { upsertVenda } from '../io';
import type { PedidoML } from '../venda';

type Linha = Record<string, unknown> | null;

/**
 * Fake mínimo do admin client, só com as cadeias que `upsertVenda` usa. `ml_vendas` guarda a
 * última linha gravada e a devolve como estado anterior na leitura seguinte — é isso que permite
 * exercitar "grava, depois reprocessa o mesmo pedido".
 */
function criarAdminFake(
  errosSnapshot: Array<{ message: string } | null> = [],
  erroCusto: { message: string } | null = null,
) {
  let linha: Linha = null;
  const atualizarMensagens = vi.fn(() => ({
    eq: () => ({ or: async () => ({ error: errosSnapshot.shift() ?? null }) }),
  }));
  const upsertVendas = vi.fn((row: Record<string, unknown>) => {
    linha = row;
    return { select: () => ({ single: async () => ({ data: { id: 'venda-1' }, error: null }) }) };
  });
  // Congelamento do custo (ADR-0109): captura linhas e opções do upsert em venda_item_custo.
  const upsertCustos = vi.fn(async () => ({ error: erroCusto }));
  const from = vi.fn((tabela: string) =>
    tabela === 'ml_vendas'
      ? {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: linha }) }) }) }),
          upsert: upsertVendas,
        }
      : tabela === 'ml_mensagens'
        ? { update: atualizarMensagens }
        : tabela === 'venda_item_custo'
          ? { upsert: upsertCustos }
          : {
            delete: () => ({ eq: async () => ({ error: null }) }),
            upsert: async () => ({ error: null }),
          });
  return {
    admin: { from } as unknown as Parameters<typeof upsertVenda>[0],
    upsertVendas, atualizarMensagens, upsertCustos,
  };
}

const pedido: PedidoML = {
  id: 555,
  status: 'paid',
  total_amount: 100,
  payments: [{ id: 1 }],
  order_items: [{ item: { id: 'MLB1' }, quantity: 1, unit_price: 100, sale_fee: 10 }],
};

const opts = {
  idsPubliai: new Set<string>(), codigoResolver: () => null, freteVendedor: 5,
  // Obrigatório (ADR-0109): o TS quebra a build de qualquer caller que esqueça.
  custoVigenteResolver: () => null as number | null,
};

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

it('retry repete o snapshot quando a venda já foi atualizada antes da falha', async () => {
  const { admin, atualizarMensagens } = criarAdminFake([{ message: 'timeout' }, null]);
  const cancelado = { ...pedido, status: 'cancelled', pack_id: 777 };

  await expect(upsertVenda(admin, 'user-1', 'org-1', cancelado, opts))
    .rejects.toThrow('atualizar status das mensagens: timeout');
  await expect(upsertVenda(admin, 'user-1', 'org-1', cancelado, opts)).resolves.toBeDefined();

  expect(atualizarMensagens).toHaveBeenCalledTimes(2);
  expect(atualizarMensagens).toHaveBeenLastCalledWith({ order_status: 'cancelled' });
});

// ADR-0109 — o custo do produto é congelado no instante da venda. Mora aqui, dentro do
// `upsertVenda`, e não nos callers, porque `ml_vendas_itens` tem um writer só mas QUATRO chamadores
// (sync-venda, sync-devolucao, backfill-faturamento, reconciliar-faturamento).
describe('upsertVenda — congelamento do custo (ADR-0109)', () => {
  it('grava o custo resolvido, uma vez, com insert-once', async () => {
    const { admin, upsertCustos } = criarAdminFake();
    await upsertVenda(admin, 'user-1', 'org-1', pedido, { ...opts, custoVigenteResolver: () => 15.8558 });

    expect(upsertCustos).toHaveBeenCalledTimes(1);
    const [linhas, opcoes] = upsertCustos.mock.calls[0] as unknown as [Record<string, unknown>[], Record<string, unknown>];
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      user_id: 'user-1', org_id: 'org-1', venda_id: 'venda-1',
      ml_item_id: 'MLB1', custo_unitario: 15.8558, fonte: 'sync',
    });
    // ignoreDuplicates = ON CONFLICT DO NOTHING: o 2º sync não reescreve o custo.
    expect(opcoes).toEqual({ onConflict: 'venda_id,ml_item_id,variation_id', ignoreDuplicates: true });
  });

  it('item sem casamento no catálogo não gera linha', async () => {
    const { admin, upsertCustos } = criarAdminFake();
    await upsertVenda(admin, 'user-1', 'org-1', pedido, { ...opts, custoVigenteResolver: () => null });
    expect(upsertCustos).not.toHaveBeenCalled();
  });

  it('custo não positivo não é congelado', async () => {
    const { admin, upsertCustos } = criarAdminFake();
    await upsertVenda(admin, 'user-1', 'org-1', pedido, { ...opts, custoVigenteResolver: () => 0 });
    expect(upsertCustos).not.toHaveBeenCalled();
  });

  // Caminho financeiro: falha ao congelar não pode passar despercebida.
  it('erro ao gravar o custo faz o upsertVenda lançar', async () => {
    const { admin } = criarAdminFake([], { message: 'boom' });
    await expect(
      upsertVenda(admin, 'user-1', 'org-1', pedido, { ...opts, custoVigenteResolver: () => 10 }),
    ).rejects.toThrow(/congelar custo/i);
  });
});
