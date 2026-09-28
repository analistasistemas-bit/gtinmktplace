import { describe, expect, it } from 'vitest';
import { decidir, piorou } from '../decidir.ts';

const conv = { status: 'candidate', preco_min: 7, preco_max: 18.99, offer_id: null };
const pedido = (preco: number | null) => ({ ml_item_id: 'MLB1', preco });

describe('decidir — aderir', () => {
  it('participando → ja_estava (retry depois de POST bem-sucedido não posta de novo)', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(18.99), { ...conv, status: 'pending' }, null))
      .toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
    expect(decidir('aderir', 'SMART', 'P-1', pedido(null), { ...conv, status: 'started', offer_id: 'OFFER-1' }, null))
      .toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
  });
  it('fora da campanha → mudou', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(10), null, null))
      .toEqual({ tipo: 'fim', status: 'mudou', mensagem: 'O anúncio não é mais convidado nesta promoção' });
  });
  it('status ≠ candidate e não participando → mudou', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(10), { ...conv, status: 'finished' }, null))
      .toEqual({ tipo: 'fim', status: 'mudou', mensagem: 'O anúncio não é mais convidado nesta promoção' });
  });
  it('sincronizado com anúncio de catálogo → bloqueado', () => {
    const rel = { catalog_listing: false, relacionados: [{ id: 'MLB9', catalog_listing: false }, { id: 'MLB7', catalog_listing: true }] };
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(10), conv, rel))
      .toEqual({ tipo: 'fim', status: 'bloqueado', mensagem: 'Anúncio sincronizado com o de catálogo MLB7: inscreva o de catálogo' });
  });
  it('o próprio de catálogo não é bloqueado', () => {
    const rel = { catalog_listing: true, relacionados: [{ id: 'MLB7', catalog_listing: true }] };
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(10), conv, rel).tipo).toBe('post');
  });
});

describe('decidir — aderir DEAL', () => {
  it('posta deal_price dentro da faixa', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(18.99), conv, null))
      .toEqual({ tipo: 'post', body: { promotion_id: 'P-1', promotion_type: 'DEAL', deal_price: 18.99 } });
  });
  it('acima da faixa → mudou', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(19.5), conv, null))
      .toEqual({ tipo: 'fim', status: 'mudou', mensagem: 'A faixa de preço mudou: agora 7,00 a 18,99' });
  });
  it('abaixo da faixa → mudou', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(6.99), conv, null))
      .toEqual({ tipo: 'fim', status: 'mudou', mensagem: 'A faixa de preço mudou: agora 7,00 a 18,99' });
  });
  it('preço nulo → mudou', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(null), conv, null))
      .toEqual({ tipo: 'fim', status: 'mudou', mensagem: 'A faixa de preço mudou: agora 7,00 a 18,99' });
  });
  it('faixa sem limites → posta', () => {
    expect(decidir('aderir', 'DEAL', 'P-1', pedido(50), { ...conv, preco_min: null, preco_max: null }, null))
      .toEqual({ tipo: 'post', body: { promotion_id: 'P-1', promotion_type: 'DEAL', deal_price: 50 } });
  });
});

describe('decidir — aderir SMART', () => {
  it('sem offer_id → erro', () => {
    expect(decidir('aderir', 'SMART', 'P-2', pedido(null), conv, null))
      .toEqual({ tipo: 'fim', status: 'erro', mensagem: 'O ML não informou a oferta deste convite' });
  });
  it('posta offer_id do convite', () => {
    expect(decidir('aderir', 'SMART', 'P-2', pedido(null), { ...conv, offer_id: 'CANDIDATE-MLB1-9' }, null))
      .toEqual({ tipo: 'post', body: { promotion_id: 'P-2', promotion_type: 'SMART', offer_id: 'CANDIDATE-MLB1-9' } });
  });
});

describe('decidir — sair', () => {
  it('fora da campanha → ja_estava', () => {
    expect(decidir('sair', 'DEAL', 'P-1', pedido(null), null, null))
      .toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
  });
  it('convidado (não participando) → ja_estava', () => {
    expect(decidir('sair', 'SMART', 'P-1', pedido(null), conv, null))
      .toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
  });
  it('DEAL participando → delete', () => {
    expect(decidir('sair', 'DEAL', 'P-1', pedido(null), { ...conv, status: 'started' }, null))
      .toEqual({ tipo: 'delete', query: 'promotion_type=DEAL&promotion_id=P-1&app_version=v2' });
  });
  it('SMART participando sem offer_id → erro', () => {
    expect(decidir('sair', 'SMART', 'P-2', pedido(null), { ...conv, status: 'started' }, null))
      .toEqual({ tipo: 'fim', status: 'erro', mensagem: 'O ML não informou a oferta deste anúncio' });
  });
  it('SMART participando → delete com offer_id', () => {
    expect(decidir('sair', 'SMART', 'P-2', pedido(null), { ...conv, status: 'pending', offer_id: 'OFFER-a/b' }, null))
      .toEqual({ tipo: 'delete', query: 'promotion_type=SMART&promotion_id=P-2&offer_id=OFFER-a%2Fb&app_version=v2' });
  });
});

describe('piorou', () => {
  it('ordem verde < amarelo < vermelho', () => {
    expect(piorou('verde', 'amarelo')).toBe(true);
    expect(piorou('amarelo', 'vermelho')).toBe(true);
    expect(piorou('verde', 'vermelho')).toBe(true);
    expect(piorou('vermelho', 'amarelo')).toBe(false);
    expect(piorou('amarelo', 'amarelo')).toBe(false);
  });
  it('indisponivel conta como vermelho', () => {
    expect(piorou('amarelo', 'indisponivel')).toBe(true);
    expect(piorou('vermelho', 'indisponivel')).toBe(false);
    expect(piorou('indisponivel', 'vermelho')).toBe(false);
    expect(piorou('indisponivel', 'verde')).toBe(false);
  });
});
