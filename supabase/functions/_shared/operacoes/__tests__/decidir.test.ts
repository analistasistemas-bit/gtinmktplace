import { describe, expect, it } from 'vitest';
import { decidir, piorou } from '../decidir.ts';

const conv = { status: 'candidate', preco_min: 7, preco_max: 18.99, offer_id: null, estoque_min: null };
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

// Relâmpago (spike 02/11): campanha traz min 8,70 + stock.min; visão por item traz 5,80/26,10/24,65.
describe('decidir — LIGHTNING', () => {
  const fresco = { status: 'candidate', preco_min: 8.7, preco_max: null, offer_id: 'CANDIDATE-MLB1-5', estoque_min: 5 };
  const oferta = { preco_min: 5.8, preco_max: 26.1, preco_sugerido: 24.65, estoque_min: 5, inicio: null, fim: null };
  const rel = (disponivel: number | null) => ({ catalog_listing: false, relacionados: [], disponivel });
  const aderir = (preco: number | null, f = fresco, o: typeof oferta | null = oferta, r = rel(180)) =>
    decidir('aderir', 'LIGHTNING', 'LGH-1', pedido(preco), f, r, o);
  const fim = (status: string, mensagem: string | null = null) => ({ tipo: 'fim', status, mensagem });

  it('aderir monta POST com stock', () => {
    expect(aderir(24.65)).toEqual({ tipo: 'post',
      body: { promotion_id: 'LGH-1', promotion_type: 'LIGHTNING', deal_price: 24.65, stock: 5 } });
  });
  it('min efetivo é o maior das duas visões', () => {
    expect(aderir(8)).toEqual(fim('mudou', 'A faixa de preço mudou: agora 8,70 a 26,10'));
  });
  it('acima do máximo ou preço nulo → mudou', () => {
    expect(aderir(26.11)).toEqual(fim('mudou', 'A faixa de preço mudou: agora 8,70 a 26,10'));
    expect(aderir(null)).toEqual(fim('mudou', 'A faixa de preço mudou: agora 8,70 a 26,10'));
  });
  it('sem oferta na visão por item → erro', () => {
    expect(aderir(24.65, fresco, null)).toEqual(fim('erro', 'O ML não informou a oferta deste anúncio na Relâmpago'));
  });
  it('faixa null → erro (nunca posta com faixa aberta)', () => {
    expect(aderir(24.65, fresco, { ...oferta, preco_max: null })).toEqual(fim('erro', 'O ML não informou a faixa de preço deste anúncio'));
    expect(aderir(24.65, { ...fresco, preco_min: null }, { ...oferta, preco_min: null }))
      .toEqual(fim('erro', 'O ML não informou a faixa de preço deste anúncio'));
  });
  it('min de uma visão só basta', () => {
    expect(aderir(24.65, { ...fresco, preco_min: null }).tipo).toBe('post');
  });
  it('18,99 dentro da faixa → bloqueado (R$ 19)', () => {
    expect(aderir(18.99)).toEqual(fim('bloqueado', 'Abaixo de R$ 19 o comprador perde o frete grátis'));
    expect(aderir(19).tipo).toBe('post');
  });
  it('estoque mínimo divergente ou ausente nas duas → erro', () => {
    expect(aderir(24.65, fresco, { ...oferta, estoque_min: 6 })).toEqual(fim('erro', 'O ML não informou o estoque mínimo da oferta'));
    expect(aderir(24.65, { ...fresco, estoque_min: null }, { ...oferta, estoque_min: null }))
      .toEqual(fim('erro', 'O ML não informou o estoque mínimo da oferta'));
  });
  it('estoque mínimo de uma visão só basta', () => {
    expect(aderir(24.65, { ...fresco, estoque_min: null }, { ...oferta, estoque_min: 7 }, rel(7)))
      .toEqual({ tipo: 'post', body: { promotion_id: 'LGH-1', promotion_type: 'LIGHTNING', deal_price: 24.65, stock: 7 } });
  });
  it('disponivel null → bloqueado', () => {
    expect(aderir(24.65, fresco, oferta, rel(null))).toEqual(fim('bloqueado', 'O ML não informou o estoque disponível do anúncio'));
  });
  it('disponivel 3 < mínimo 5 → bloqueado', () => {
    expect(aderir(24.65, fresco, oferta, rel(3))).toEqual(fim('bloqueado', 'Estoque disponível (3) menor que o mínimo da Relâmpago (5)'));
  });
  it('participando → ja_estava; par de catálogo → bloqueado', () => {
    expect(aderir(24.65, { ...fresco, status: 'pending', offer_id: 'OFFER-X-1' })).toEqual(fim('ja_estava'));
    const cat = { catalog_listing: false, relacionados: [{ id: 'MLB7', catalog_listing: true }], disponivel: 180 };
    expect(aderir(24.65, fresco, oferta, cat).status).toBe('bloqueado');
  });

  const sair = (f: typeof fresco | null) => decidir('sair', 'LIGHTNING', 'LGH-1', pedido(null), f, null);
  it('sair com OFFER → delete com a query exata', () => {
    expect(sair({ ...fresco, status: 'pending', offer_id: 'OFFER-X-1' }))
      .toEqual({ tipo: 'delete', query: 'promotion_type=LIGHTNING&promotion_id=LGH-1&offer_id=OFFER-X-1&app_version=v2' });
  });
  it('sair participando sem OFFER → erro', () => {
    expect(sair({ ...fresco, status: 'started' })).toEqual(fim('erro', 'O ML não informou a oferta deste anúncio'));
    expect(sair({ ...fresco, status: 'started', offer_id: null })).toEqual(fim('erro', 'O ML não informou a oferta deste anúncio'));
  });
  it('sair com fresco null ou status estranho → erro (não ja_estava)', () => {
    const msg = 'O ML não mostra este anúncio na Relâmpago. Confira no Seller Center.';
    expect(sair(null)).toEqual(fim('erro', msg));
    expect(sair({ ...fresco, status: 'finished' })).toEqual(fim('erro', msg));
  });
  it('sair com candidate → ja_estava', () => {
    expect(sair(fresco)).toEqual(fim('ja_estava'));
  });
  it('sair DEAL com fresco null → ja_estava (inalterado)', () => {
    expect(decidir('sair', 'DEAL', 'P-1', pedido(null), null, null)).toEqual(fim('ja_estava'));
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

// Emenda ADR-0174 (2026-11-03): alterar o deal_price de item DEAL já participando (PUT; spike Zaven).
describe('decidir — alterar_preco', () => {
  const part = { status: 'started', preco_min: null, preco_max: null, offer_id: null, estoque_min: null, preco: 49.9 };
  it('participando com outro preço → PUT do deal_price', () => {
    expect(decidir('alterar_preco', 'DEAL', 'P-1', pedido(43.9), part, null))
      .toEqual({ tipo: 'put', body: { promotion_id: 'P-1', promotion_type: 'DEAL', deal_price: 43.9 } });
  });
  it('preço vivo já é o pedido → ja_estava (idempotente: retry não escreve)', () => {
    expect(decidir('alterar_preco', 'DEAL', 'P-1', pedido(49.9), part, null)).toEqual({ tipo: 'fim', status: 'ja_estava', mensagem: null });
  });
  it('não participando mais → mudou; Relâmpago/SMART → bloqueado; sem preço → erro', () => {
    expect(decidir('alterar_preco', 'DEAL', 'P-1', pedido(43.9), { ...part, status: 'candidate' }, null))
      .toEqual({ tipo: 'fim', status: 'mudou', mensagem: 'O anúncio não está mais participando desta promoção' });
    expect(decidir('alterar_preco', 'DEAL', 'P-1', pedido(43.9), null, null)).toMatchObject({ status: 'mudou' });
    expect(decidir('alterar_preco', 'LIGHTNING', 'P-1', pedido(43.9), part, null)).toMatchObject({ status: 'bloqueado' });
    expect(decidir('alterar_preco', 'SMART', 'P-1', pedido(43.9), part, null)).toMatchObject({ status: 'bloqueado' });
    expect(decidir('alterar_preco', 'DEAL', 'P-1', pedido(null), part, null)).toMatchObject({ status: 'erro' });
  });
  it('Reverter (achado Codex P1): preço vivo ≠ o que a origem deixou → mudou, não sobrescreve', () => {
    expect(decidir('alterar_preco', 'DEAL', 'P-1', { ...pedido(49.9), esperado: 43.9 }, { ...part, preco: 41 }, null))
      .toEqual({ tipo: 'fim', status: 'mudou', mensagem: 'O preço mudou desde a alteração original' });
    expect(decidir('alterar_preco', 'DEAL', 'P-1', { ...pedido(49.9), esperado: 43.9 }, { ...part, preco: 43.9 }, null))
      .toMatchObject({ tipo: 'put' });
  });
});
