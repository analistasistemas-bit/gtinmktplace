import { describe, it, expect, vi, afterEach } from 'vitest';
import { mensagemErroEnvioML, pedidoCancelado, resolverMetaPack, responderMensagemPedido, upsertMensagens } from '../mensagens-io';
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

describe('responderMensagemPedido', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('resp.ok=false → lança com status e corpo truncado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Too many requests'.repeat(20)),
    }));
    await expect(responderMensagemPedido('token', 'pack-1', SELLER_ID, COMPRADOR_ID, 'Olá'))
      .rejects.toThrow(/ML \/messages 429/);
  });

  it('resp.ok=true → resolve; URL usa ?tag=post_sale (sem /messages) e body é { from, to, text }', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', fetchMock);
    await expect(responderMensagemPedido('token', 'pack-1', SELLER_ID, COMPRADOR_ID, 'Olá, tudo bem?')).resolves.toBeUndefined();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.mercadolibre.com/messages/packs/pack-1/sellers/999?tag=post_sale');
    expect(JSON.parse(options.body as string)).toEqual({
      from: { user_id: '999' }, to: { user_id: '111' }, text: 'Olá, tudo bem?',
    });
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
    expect(mensagemErroEnvioML(429, 'Too many requests')).toMatch(/ML \/messages 429/);
  });
});
