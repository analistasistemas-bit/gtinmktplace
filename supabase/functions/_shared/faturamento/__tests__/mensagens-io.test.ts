import { describe, it, expect, vi } from 'vitest';
import {
  CODIGO_PEDIDO_CANCELADO,
  ERRO_PEDIDO_CANCELADO,
  buscarMensagensPack,
  statusConversaLocal,
  marcarConversaCancelada,
  mensagemErroEnvioML,
  ERRO_EM_MEDIACAO,
  pedidoCancelado,
  resolverMetaPack,
  upsertMensagens,
} from '../mensagens-io';
import type { MensagemML } from '../mensagem-mapper';

const SELLER_ID = 999;
const COMPRADOR_ID = 111;
const META = {
  orderId: 'order-1',
  itemId: 'MLB123',
  itemTitulo: 'Produto X',
  compradorNome: 'Maria Silva',
  compradorNick: 'MARIA_01',
  orderStatus: 'paid',
};

/**
 * Mock do admin client para as DUAS chamadas de `.upsert()` de upsertMensagens: a 1ª encadeada
 * com `.select()` (ignoreDuplicates — devolve só as linhas efetivamente inseridas), a 2ª solta
 * (upsert de verdade, só grava). `idsQueSeraoInseridos`: quais message_ids a 1ª upsert deve
 * devolver como novos (null = default, devolve todas as rows passadas, simulando "tudo novo").
 */
function criarAdminMock(idsQueSeraoInseridos: string[] | null = null) {
  const upsertComSelect = vi.fn((rows: Array<{ message_id: string; direcao: string }>) => ({
    select: vi.fn().mockResolvedValue({
      data: idsQueSeraoInseridos === null
        ? rows.map((r) => ({ message_id: r.message_id, direcao: r.direcao }))
        : rows.filter((r) => idsQueSeraoInseridos.includes(r.message_id)).map((r) => ({ message_id: r.message_id, direcao: r.direcao })),
      error: null,
    }),
  }));
  const upsertSimples = vi.fn().mockResolvedValue({ data: null, error: null });
  let chamada = 0;
  const upsert = vi.fn((rows: unknown) => {
    chamada++;
    return chamada === 1 ? upsertComSelect(rows as Array<{ message_id: string; direcao: string }>) : upsertSimples(rows);
  });
  const from = vi.fn(() => ({ upsert }));
  const admin = { from } as unknown as Parameters<typeof upsertMensagens>[0];
  return { admin, from, upsert };
}

function criarAdminMeta(data: unknown, error: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error });
  const limit = vi.fn(() => ({ maybeSingle }));
  const or = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ or }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return {
    admin: { from } as unknown as Parameters<typeof resolverMetaPack>[0],
    select,
  };
}

function criarAdminMarcarCancelada(options?: {
  mensagensError?: { message: string } | null;
  venda?: { order_id: string | number } | null;
  vendaError?: { message: string } | null;
}) {
  const mensagensBuilder: {
    eq: ReturnType<typeof vi.fn>;
    then: PromiseLike<{ error: { message: string } | null }>['then'];
  } = {
    eq: vi.fn(),
    then: (onfulfilled, onrejected) =>
      Promise.resolve({ error: options?.mensagensError ?? null }).then(onfulfilled, onrejected),
  };
  mensagensBuilder.eq.mockReturnValue(mensagensBuilder);
  const mensagensUpdate = vi.fn().mockReturnValue(mensagensBuilder);

  const maybeSingle = vi.fn().mockResolvedValue({ data: options?.venda ?? null, error: null });
  const limit = vi.fn().mockReturnValue({ maybeSingle });
  const or = vi.fn().mockReturnValue({ limit });
  const selectEq = vi.fn().mockReturnValue({ or });
  const vendasSelect = vi.fn().mockReturnValue({ eq: selectEq });

  const vendasUpdateBuilder: {
    eq: ReturnType<typeof vi.fn>;
    then: PromiseLike<{ error: { message: string } | null }>['then'];
  } = {
    eq: vi.fn(),
    then: (onfulfilled, onrejected) =>
      Promise.resolve({ error: options?.vendaError ?? null }).then(onfulfilled, onrejected),
  };
  vendasUpdateBuilder.eq.mockReturnValue(vendasUpdateBuilder);
  const vendasUpdate = vi.fn().mockReturnValue(vendasUpdateBuilder);

  const from = vi.fn((table: string) => {
    if (table === 'ml_mensagens') return { update: mensagensUpdate };
    if (table === 'ml_vendas') return { select: vendasSelect, update: vendasUpdate };
    throw new Error(`Tabela inesperada: ${table}`);
  });

  return {
    admin: { from } as unknown as Parameters<typeof marcarConversaCancelada>[0],
    from,
    mensagensUpdate,
    mensagensBuilder,
    vendasSelect,
    selectEq,
    or,
    limit,
    maybeSingle,
    vendasUpdate,
    vendasUpdateBuilder,
  };
}

const msgDoComprador = (id: string, dataMl: string): MensagemML => ({
  id, from: { user_id: COMPRADOR_ID }, to: { user_id: SELLER_ID },
  text: `msg ${id}`, message_date: { created: dataMl },
});
const msgDoVendedor = (id: string, dataMl: string): MensagemML => ({
  id, from: { user_id: SELLER_ID }, to: { user_id: COMPRADOR_ID },
  text: `msg ${id}`, message_date: { created: dataMl },
});

describe('upsertMensagens', () => {
  it('N mensagens novas do comprador → novasRecebidas === N', async () => {
    const { admin, upsert } = criarAdminMock(['m1', 'm2']); // 1ª upsert (ignoreDuplicates) insere as duas.
    const msgs = [msgDoComprador('m1', '2026-07-10T10:00:00Z'), msgDoComprador('m2', '2026-07-10T10:01:00Z')];
    const r = await upsertMensagens(admin, 'user-1', 'org-1', 'pack-1', META, SELLER_ID, msgs);
    expect(r.novasRecebidas).toBe(2);
    expect(upsert.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        order_id: 'order-1',
        item_id: 'MLB123',
        item_titulo: 'Produto X',
        comprador_nome: 'Maria Silva',
        comprador_nick: 'MARIA_01',
        order_status: 'paid',
      }),
    ]));
  });

  it('re-execução com o mesmo payload (nada novo inserido) → novasRecebidas === 0', async () => {
    const { admin } = criarAdminMock([]); // ignoreDuplicates: já existiam, nada é inserido de novo.
    const msgs = [msgDoComprador('m1', '2026-07-10T10:00:00Z'), msgDoComprador('m2', '2026-07-10T10:01:00Z')];
    const r = await upsertMensagens(admin, 'user-1', 'org-1', 'pack-1', META, SELLER_ID, msgs);
    expect(r.novasRecebidas).toBe(0);
  });

  it('mix: 1 conhecida (não inserida) + 1 nova recebida + 1 nova enviada pelo vendedor → novasRecebidas === 1', async () => {
    const { admin } = criarAdminMock(['b', 'c']); // 'a' já existia, não volta na 1ª upsert.
    const msgs = [
      msgDoComprador('a', '2026-07-10T09:00:00Z'), // já conhecida
      msgDoComprador('b', '2026-07-10T10:00:00Z'), // nova, recebida
      msgDoVendedor('c', '2026-07-10T11:00:00Z'), // nova, enviada pelo vendedor
    ];
    const r = await upsertMensagens(admin, 'user-1', 'org-1', 'pack-1', META, SELLER_ID, msgs);
    expect(r.novasRecebidas).toBe(1);
  });

  it('mensagem sem id (message_id vazio) é filtrada e não conta', async () => {
    const { admin } = criarAdminMock(['d1']); // só d1 chega a entrar no upsert (semId é filtrada antes).
    const semId: MensagemML = { from: { user_id: COMPRADOR_ID }, text: 'sem id', message_date: { created: '2026-07-10T12:00:00Z' } };
    const msgs = [msgDoComprador('d1', '2026-07-10T10:00:00Z'), semId];
    const r = await upsertMensagens(admin, 'user-1', 'org-1', 'pack-1', META, SELLER_ID, msgs);
    expect(r.novasRecebidas).toBe(1);
  });

  it('lista vazia → { novasRecebidas: 0 } sem chamar upsert', async () => {
    const { admin, from, upsert } = criarAdminMock([]);
    const r = await upsertMensagens(admin, 'user-1', 'org-1', 'pack-1', META, SELLER_ID, []);
    expect(r).toEqual({ novasRecebidas: 0 });
    expect(from).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('metadados ausentes não enviam null para apagar um snapshot já persistido', async () => {
    const { admin, upsert } = criarAdminMock(['m1']);
    await upsertMensagens(admin, 'user-1', 'org-1', 'pack-1', {
      orderId: null, itemId: null, itemTitulo: null, compradorNome: null, compradorNick: null, orderStatus: null,
    }, SELLER_ID, [msgDoComprador('m1', '2026-07-10T10:00:00Z')]);

    const [row] = upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(row).not.toHaveProperty('order_id');
    expect(row).not.toHaveProperty('item_id');
    expect(row).not.toHaveProperty('item_titulo');
    expect(row).not.toHaveProperty('comprador_nome');
    expect(row).not.toHaveProperty('comprador_nick');
    expect(row).not.toHaveProperty('order_status');
    expect(row).not.toHaveProperty('conversa_status');
  });

  it('estado da conversa lido do ML (conversaStatus do pack) vai em conversa_status de todas as linhas', async () => {
    const { admin, upsert } = criarAdminMock(['m1', 'm2']);
    const msgs = Object.assign(
      [msgDoComprador('m1', '2026-07-10T10:00:00Z'), msgDoVendedor('m2', '2026-07-10T10:01:00Z')],
      { conversaStatus: 'active' },
    );
    await upsertMensagens(admin, 'user-1', 'org-1', 'pack-1', META, SELLER_ID, msgs);
    for (const chamada of upsert.mock.calls) {
      for (const row of chamada[0] as Array<Record<string, unknown>>) expect(row.conversa_status).toBe('active');
    }
  });
});

describe('statusConversaLocal', () => {
  function criarAdminStatus(data: unknown, error: { message: string } | null = null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error });
    const q: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const k of ['select', 'eq', 'order', 'limit']) q[k] = vi.fn(() => ({ ...q, maybeSingle }));
    const from = vi.fn(() => q);
    return { admin: { from } as unknown as Parameters<typeof statusConversaLocal>[0], q, from };
  }

  it('lê conversa_status da mensagem mais recente do pack na org', async () => {
    const { admin, q, from } = criarAdminStatus({ conversa_status: 'active' });
    await expect(statusConversaLocal(admin, 'org-1', 123)).resolves.toBe('active');
    expect(from).toHaveBeenCalledWith('ml_mensagens');
    expect(q.select).toHaveBeenCalledWith('conversa_status');
    expect(q.eq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(q.eq).toHaveBeenCalledWith('pack_id', '123');
    expect(q.order).toHaveBeenNthCalledWith(1, 'data_ml', { ascending: false, nullsFirst: false });
    expect(q.order).toHaveBeenNthCalledWith(2, 'message_id', { ascending: false });
    expect(q.limit).toHaveBeenCalledWith(1);
  });

  it('sem linha, sem valor ou erro → null (conta como encerrada)', async () => {
    await expect(statusConversaLocal(criarAdminStatus(null).admin, 'o', 'p')).resolves.toBeNull();
    await expect(statusConversaLocal(criarAdminStatus({ conversa_status: null }).admin, 'o', 'p')).resolves.toBeNull();
    await expect(statusConversaLocal(criarAdminStatus(null, { message: 'x' }).admin, 'o', 'p')).resolves.toBeNull();
  });
});

describe('buscarMensagensPack (não paginada)', () => {
  it('carrega conversation_status.status do ML em conversaStatus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      conversation_status: { status: 'blocked', substatus: 'blocked_by_cancelled_order' }, messages: [{ id: 'a' }],
    }), { status: 200 })));
    const msgs = await buscarMensagensPack('t', 1, 2);
    vi.unstubAllGlobals();
    expect([...msgs]).toEqual([{ id: 'a' }]);
    expect(msgs.conversaStatus).toBe('blocked');
  });
});

describe('resolverMetaPack', () => {
  it('compõe os metadados completos da venda e do primeiro item', async () => {
    const { admin, select } = criarAdminMeta({
      order_id: 123,
      status: 'paid',
      comprador_nome: 'Maria Silva',
      comprador_nick: 'MARIA_01',
      ml_vendas_itens: [{ ml_item_id: 'MLB123', titulo: 'Produto X' }],
    });

    await expect(resolverMetaPack(admin, 'user-1', 'pack-1')).resolves.toEqual({ ...META, orderId: '123' });
    expect(select).toHaveBeenCalledWith('order_id, status, comprador_nome, comprador_nick, ml_vendas_itens(ml_item_id, titulo)');
  });

  it('erro ao ler a venda não vira metadados ausentes silenciosamente', async () => {
    const { admin } = criarAdminMeta(null, { message: 'database unavailable' });

    await expect(resolverMetaPack(admin, 'user-1', 'pack-1')).rejects.toThrow('resolver meta pack: database unavailable');
  });
});

describe('regras de envio pós-venda', () => {
  it('reconhece somente pedido cancelado', () => {
    expect(pedidoCancelado('cancelled')).toBe(true);
    expect(pedidoCancelado('paid')).toBe(false);
    expect(pedidoCancelado(null)).toBe(false);
  });

  it('traduz bloqueio por cancelamento e preserva erros genéricos do ML', () => {
    expect(mensagemErroEnvioML(
      403,
      '{"code":"forbidden","message":"blocked_by_cancelled_order"}',
    )).toBe('Não é possível responder porque o pedido foi cancelado.');
    expect(mensagemErroEnvioML(
      403,
      '{"status_code":403,"code":"forbidden","message":"blocked_by_mediation","stacktrace":null}',
    )).toBe(ERRO_EM_MEDIACAO);
    expect(mensagemErroEnvioML(429, 'Too many requests')).toMatch(/ML \/messages 429/);
  });

  it('erro genérico leva o status e trunca o corpo em 200 caracteres', () => {
    const msg = mensagemErroEnvioML(429, 'x'.repeat(500));
    expect(msg).toBe(`ML /messages 429: ${'x'.repeat(200)}`);
  });
});

describe('constantes de pedido cancelado', () => {
  it('possuem os valores esperados para mensagem e código', () => {
    expect(ERRO_PEDIDO_CANCELADO).toBe('Não é possível responder porque o pedido foi cancelado.');
    expect(CODIGO_PEDIDO_CANCELADO).toBe('pedido_cancelado');
  });
});

describe('marcarConversaCancelada', () => {
  it('grava conversa_status blocked junto (só roda com a conversa encerrada pelo ML)', async () => {
    const { admin, mensagensUpdate } = criarAdminMarcarCancelada({ venda: null });
    await marcarConversaCancelada(admin, 'org-1', 'pack-1');
    expect(mensagensUpdate).toHaveBeenCalledWith({ order_status: 'cancelled', conversa_status: 'blocked' });
  });

  it('atualiza ml_mensagens com order_status: cancelled filtrando por org_id e pack_id', async () => {
    const {
      admin,
      from,
      mensagensUpdate,
      mensagensBuilder,
      vendasSelect,
      selectEq,
      or,
      limit,
      maybeSingle,
      vendasUpdate,
      vendasUpdateBuilder,
    } = criarAdminMarcarCancelada({
      venda: { order_id: 'order-999' },
    });

    await marcarConversaCancelada(admin, 'org-42', 98765);

    expect(from).toHaveBeenCalledWith('ml_mensagens');
    expect(mensagensUpdate).toHaveBeenCalledWith({ order_status: 'cancelled', conversa_status: 'blocked' });
    expect(mensagensBuilder.eq).toHaveBeenNthCalledWith(1, 'org_id', 'org-42');
    expect(mensagensBuilder.eq).toHaveBeenNthCalledWith(2, 'pack_id', '98765');

    expect(from).toHaveBeenCalledWith('ml_vendas');
    expect(vendasSelect).toHaveBeenCalledWith('order_id');
    expect(selectEq).toHaveBeenCalledWith('org_id', 'org-42');
    expect(or).toHaveBeenCalledWith('pack_id.eq.98765,order_id.eq.98765');
    expect(limit).toHaveBeenCalledWith(1);
    expect(maybeSingle).toHaveBeenCalled();

    expect(vendasUpdate).toHaveBeenCalledWith({ status: 'cancelled' });
    expect(vendasUpdateBuilder.eq).toHaveBeenNthCalledWith(1, 'org_id', 'org-42');
    expect(vendasUpdateBuilder.eq).toHaveBeenNthCalledWith(2, 'order_id', 'order-999');
  });

  it('inclui user_id no filtro de ml_vendas se fornecido', async () => {
    const { admin, vendasUpdateBuilder } = criarAdminMarcarCancelada({
      venda: { order_id: 'order-123' },
    });

    await marcarConversaCancelada(admin, 'org-1', 'pack-1', 'user-abc');

    expect(vendasUpdateBuilder.eq).toHaveBeenCalledWith('user_id', 'user-abc');
  });

  it('não tenta atualizar ml_vendas quando não há venda associada ao pack', async () => {
    const { admin, vendasUpdate } = criarAdminMarcarCancelada({ venda: null });

    await marcarConversaCancelada(admin, 'org-1', 'pack-1');

    expect(vendasUpdate).not.toHaveBeenCalled();
  });

  it('propaga erro caso o update de ml_mensagens falhe', async () => {
    const { admin } = criarAdminMarcarCancelada({
      mensagensError: { message: 'falha de conexao' },
    });

    await expect(marcarConversaCancelada(admin, 'org-1', 'pack-1'))
      .rejects.toThrow('marcar conversa cancelada: falha de conexao');
  });

  it('propaga erro caso o update de ml_vendas falhe', async () => {
    const { admin } = criarAdminMarcarCancelada({
      venda: { order_id: 'order-123' },
      vendaError: { message: 'erro ao atualizar venda' },
    });

    await expect(marcarConversaCancelada(admin, 'org-1', 'pack-1'))
      .rejects.toThrow('marcar venda cancelada: erro ao atualizar venda');
  });
});
