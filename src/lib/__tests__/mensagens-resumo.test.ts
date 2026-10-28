import { describe, expect, it } from 'vitest';
import type { Conversa, Mensagem } from '../mensagens';
import { baldeDaConversa, resumirConversas, rotuloVenda } from '../mensagens-resumo';

function msg(direcao: 'recebida' | 'enviada', extra: Partial<Mensagem> = {}): Mensagem {
  return {
    id: Math.random().toString(), pack_id: 'p', order_id: 'o', message_id: Math.random().toString(), direcao, texto: 'x',
    item_titulo: null, item_id: null, comprador_nome: null, comprador_nick: null, order_status: 'paid',
    data_ml: '2026-10-28T10:00:00Z', lida: false, lida_ml_em: null, ...extra,
  };
}

function conversa(over: Partial<Conversa> & { ultimaMsg?: Mensagem; naoLidaML?: boolean }): Conversa {
  const m = over.ultimaMsg ?? msg('recebida');
  return {
    pack_id: 'p', order_id: 'o', item_titulo: null, item_id: null, comprador_nome: null, comprador_nick: null,
    order_status: 'paid', mensagens: [m], aguardando: false, ultima: m.data_ml,
    shipping_status: 'handling',
    idsNaoLidosML: over.naoLidaML === false ? [] : [m.message_id],
    ...over,
  } as Conversa;
}

describe('resumirConversas', () => {
  it('não lidas por situação de envio: preparar (pending|handling|ready_to_ship), caminho, entregues', () => {
    const r = resumirConversas([
      conversa({ shipping_status: 'pending' }),
      conversa({ shipping_status: 'handling' }),
      conversa({ shipping_status: 'ready_to_ship' }),
      conversa({ shipping_status: 'shipped' }),
      conversa({ shipping_status: 'delivered' }),
      conversa({ shipping_status: null }),
    ]);
    expect(r.naoLidas).toEqual({ aPreparar: 3, aCaminho: 1, entregues: 1, total: 6 });
    expect(r.lidas).toEqual({ semResponder: 0, respondidas: 0 });
  });

  it('lida no ML com última recebida e não dispensada = sem responder', () => {
    const r = resumirConversas([conversa({ naoLidaML: false })]);
    expect(r.lidas).toEqual({ semResponder: 1, respondidas: 0 });
    expect(r.naoLidas.total).toBe(0);
  });

  it('dispensar (lida=true) tira de sem responder', () => {
    const r = resumirConversas([conversa({ naoLidaML: false, ultimaMsg: msg('recebida', { lida: true }) })]);
    expect(r.lidas).toEqual({ semResponder: 0, respondidas: 0 });
  });

  it('última enviada = respondida', () => {
    const r = resumirConversas([conversa({ naoLidaML: false, ultimaMsg: msg('enviada', { lida: true }) })]);
    expect(r.lidas).toEqual({ semResponder: 0, respondidas: 1 });
  });

  it('pedido cancelado fica fora de tudo', () => {
    const c = conversa({ order_status: 'cancelled' });
    expect(baldeDaConversa(c)).toBeNull();
    expect(resumirConversas([c]).naoLidas.total).toBe(0);
  });
});

describe('baldeDaConversa / rotuloVenda', () => {
  it('devolve o balde de cada conversa', () => {
    expect(baldeDaConversa(conversa({ shipping_status: 'shipped' }))).toBe('aCaminho');
    expect(baldeDaConversa(conversa({ naoLidaML: false }))).toBe('semResponder');
  });
  it('rótulo da venda pelo envio', () => {
    expect(rotuloVenda('ready_to_ship')).toBe('Venda para preparar');
    expect(rotuloVenda('shipped')).toBe('Venda a caminho');
    expect(rotuloVenda('delivered')).toBe('Venda entregue');
    expect(rotuloVenda(null)).toBe('Venda');
  });
});
