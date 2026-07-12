import { describe, it, expect, vi } from 'vitest';
import type { Mensagem } from '../mensagens';

// buscarConversas agora encadeia .order().limit(1000) e reverte o array (plan 036) — o mock
// representa o retorno bruto do Postgrest (desc + limit); mockOrder segue sendo o ponto de
// controle dos fixtures, só que agora por trás de um `.limit()` na cadeia.
const { mockOrder } = vi.hoisted(() => ({ mockOrder: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ order: () => ({ limit: mockOrder }) }) }) },
}));

const { buscarConversas } = await import('../mensagens');

/** Espelha o reduce de useMensagensAguardando (src/hooks/useMensagens.ts) sem montar o hook/react-query. */
const contarAguardando = (conversas: Array<{ aguardando: boolean }>) =>
  conversas.reduce((n, c) => n + (c.aguardando ? 1 : 0), 0);

const msg = (over: Partial<Mensagem>): Mensagem => ({
  id: over.id ?? 'id-1',
  pack_id: over.pack_id ?? 'pack-1',
  order_id: over.order_id ?? null,
  message_id: over.message_id ?? 'm-1',
  direcao: over.direcao ?? 'recebida',
  texto: over.texto ?? 'texto',
  item_titulo: over.item_titulo ?? null,
  // `??` trataria um `null` explícito como "não informado" e cairia no default — usa 'in' para
  // permitir que o teste do caso `data_ml: null` passe null de propósito.
  data_ml: 'data_ml' in over ? (over.data_ml as string | null) : '2026-07-10T10:00:00Z',
});

describe('buscarConversas', () => {
  it('pack com última mensagem do comprador → aguardando: true; badge conta 1', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        msg({ id: '2', message_id: 'm2', direcao: 'recebida', data_ml: '2026-07-10T11:00:00Z' }),
        msg({ id: '1', message_id: 'm1', direcao: 'enviada', data_ml: '2026-07-10T10:00:00Z' }),
      ],
      error: null,
    });
    const conversas = await buscarConversas();
    expect(conversas).toHaveLength(1);
    expect(conversas[0].aguardando).toBe(true);
    expect(contarAguardando(conversas)).toBe(1);
  });

  it('pack respondido (última é enviada) → aguardando: false', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        msg({ id: '2', message_id: 'm2', direcao: 'enviada', data_ml: '2026-07-10T11:00:00Z' }),
        msg({ id: '1', message_id: 'm1', direcao: 'recebida', data_ml: '2026-07-10T10:00:00Z' }),
      ],
      error: null,
    });
    const conversas = await buscarConversas();
    expect(conversas[0].aguardando).toBe(false);
    expect(contarAguardando(conversas)).toBe(0);
  });

  it('multi-pack: aguardando vem antes; entre não-aguardando, mais recente primeiro', async () => {
    mockOrder.mockResolvedValueOnce({
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
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    const conversas = await buscarConversas();
    expect(conversas).toEqual([]);
    expect(contarAguardando(conversas)).toBe(0);
  });

  it('data_ml: null vai para o início cronológico (nulls last no desc) e nunca decide o aguardando', async () => {
    mockOrder.mockResolvedValueOnce({
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
});
