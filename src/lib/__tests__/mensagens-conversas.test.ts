import { describe, it, expect, vi } from 'vitest';
import type { Mensagem } from '../mensagens';

// buscarConversas agora encadeia .order().limit(1000) e reverte o array (plan 036) — o mock
// representa o retorno bruto do Postgrest (desc + limit); mockOrder segue sendo o ponto de
// controle dos fixtures, só que agora por trás de um `.limit()` na cadeia.
const { mockLimit, mockDataOrder, mockMessageIdOrder } = vi.hoisted(() => ({
  mockLimit: vi.fn(), mockDataOrder: vi.fn(), mockMessageIdOrder: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: (...args: unknown[]) => {
          mockDataOrder(...args);
          const query = {
            limit: mockLimit,
            order: (...messageIdArgs: unknown[]) => {
              mockMessageIdOrder(...messageIdArgs);
              return query;
            },
          };
          return query;
        },
      }),
    }),
  },
}));

const { buscarConversas } = await import('../mensagens');

const msg = (over: Partial<Mensagem>): Mensagem => ({
  id: over.id ?? 'id-1',
  pack_id: over.pack_id ?? 'pack-1',
  order_id: over.order_id ?? null,
  message_id: over.message_id ?? 'm-1',
  direcao: over.direcao ?? 'recebida',
  texto: over.texto ?? 'texto',
  item_titulo: over.item_titulo ?? null,
  item_id: over.item_id ?? null,
  comprador_nome: over.comprador_nome ?? null,
  comprador_nick: over.comprador_nick ?? null,
  order_status: over.order_status ?? null,
  // `??` trataria um `null` explícito como "não informado" e cairia no default — usa 'in' para
  // permitir que o teste do caso `data_ml: null` passe null de propósito.
  data_ml: 'data_ml' in over ? (over.data_ml as string | null) : '2026-07-10T10:00:00Z',
});

describe('buscarConversas', () => {
  it('pack com última mensagem do comprador → aguardando: true; badge conta 1', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        msg({ id: '2', message_id: 'm2', direcao: 'recebida', data_ml: '2026-07-10T11:00:00Z' }),
        msg({ id: '1', message_id: 'm1', direcao: 'enviada', data_ml: '2026-07-10T10:00:00Z' }),
      ],
      error: null,
    });
    const conversas = await buscarConversas();
    expect(conversas).toHaveLength(1);
    expect(conversas[0].aguardando).toBe(true);
  });

  it('pack respondido (última é enviada) → aguardando: false', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        msg({ id: '2', message_id: 'm2', direcao: 'enviada', data_ml: '2026-07-10T11:00:00Z' }),
        msg({ id: '1', message_id: 'm1', direcao: 'recebida', data_ml: '2026-07-10T10:00:00Z' }),
      ],
      error: null,
    });
    const conversas = await buscarConversas();
    expect(conversas[0].aguardando).toBe(false);
  });

  it('pedido cancelado nunca aguarda resposta mesmo se a última mensagem é recebida', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [msg({
        direcao: 'recebida',
        order_status: 'cancelled',
        comprador_nome: 'Maria Silva',
        comprador_nick: 'MARIA_01',
        item_id: 'MLB123',
      })],
      error: null,
    });
    const [conversa] = await buscarConversas();
    expect(conversa).toMatchObject({
      aguardando: false,
      order_status: 'cancelled',
      comprador_nome: 'Maria Silva',
      comprador_nick: 'MARIA_01',
      item_id: 'MLB123',
    });
  });

  it('status da mensagem mais recente cancela o pack mesmo após status paid', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        msg({ id: '2', message_id: 'm2', direcao: 'recebida', order_status: 'cancelled', data_ml: '2026-07-10T11:00:00Z' }),
        msg({ id: '1', message_id: 'm1', direcao: 'enviada', order_status: 'paid', data_ml: '2026-07-10T10:00:00Z' }),
      ],
      error: null,
    });
    const [conversa] = await buscarConversas();
    expect(conversa).toMatchObject({ order_status: 'cancelled', aguardando: false });
  });

  it('multi-pack: aguardando vem antes; entre não-aguardando, mais recente primeiro', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        // pack "aguardando": última é do comprador
        msg({ id: '3', pack_id: 'aguardando', message_id: 'm3', direcao: 'recebida', data_ml: '2026-07-10T09:00:00Z' }),
        // pack "recente-respondido": não aguardando, ultima mais recente
        msg({ id: '2', pack_id: 'recente-respondido', message_id: 'm2', direcao: 'enviada', data_ml: '2026-07-10T12:00:00Z' }),
        // pack "antigo-respondido": não aguardando, ultima mais antiga
        msg({ id: '1', pack_id: 'antigo-respondido', message_id: 'm1', direcao: 'enviada', data_ml: '2026-07-10T08:00:00Z' }),
      ],
      error: null,
    });
    const conversas = await buscarConversas();
    expect(conversas.map((c) => c.pack_id)).toEqual(['aguardando', 'recente-respondido', 'antigo-respondido']);
  });

  it('lista vazia → [], badge 0', async () => {
    mockLimit.mockResolvedValueOnce({ data: [], error: null });
    const conversas = await buscarConversas();
    expect(conversas).toEqual([]);
  });

  it('data_ml: null vai para o início cronológico (nulls last no desc) e nunca decide o aguardando', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        // query real: order('data_ml', { ascending: false, nullsFirst: false }) — desc com nulls
        // LAST. A mensagem datada vem primeiro no bruto, a null (sem data) vem por último.
        msg({ id: '1', message_id: 'm1', direcao: 'recebida', data_ml: '2026-07-10T10:00:00Z' }),
        msg({ id: '2', message_id: 'm2', direcao: 'enviada', data_ml: null }),
      ],
      error: null,
    });
    const conversas = await buscarConversas();
    // depois do .reverse(): [null-enviada, datada-recebida] — o null fica no INÍCIO da lista
    // cronológica, nunca é a última mensagem do pack. A mensagem datada (recebida) decide
    // aguardando: true, e `ultima` reflete a data dela em vez de null.
    expect(conversas[0].aguardando).toBe(true);
    expect(conversas[0].ultima).toBe('2026-07-10T10:00:00Z');
  });

  it('timestamp igual usa message_id para manter a mesma última mensagem da RPC', async () => {
    mockLimit.mockResolvedValueOnce({
      data: [
        msg({ id: '2', message_id: 'm2', direcao: 'recebida', order_status: 'cancelled', data_ml: '2026-07-10T10:00:00Z' }),
        msg({ id: '1', message_id: 'm1', direcao: 'enviada', order_status: 'paid', data_ml: '2026-07-10T10:00:00Z' }),
      ],
      error: null,
    });

    const [conversa] = await buscarConversas();

    expect(mockDataOrder).toHaveBeenLastCalledWith('data_ml', { ascending: false, nullsFirst: false });
    expect(mockMessageIdOrder).toHaveBeenLastCalledWith('message_id', { ascending: false });
    expect(conversa).toMatchObject({ order_status: 'cancelled', aguardando: false });
  });
});
