import { describe, it, expect } from 'vitest';
import { mapearMensagem, extrairMensagens } from '../mensagem-mapper';

// Amostra baseada no shape de GET /messages/packs/{pack}/sellers/{seller} do ML.
const doComprador = {
  id: 'a1b2-msg-1',
  from: { user_id: 111 }, // comprador
  to: { user_id: 999 }, // vendedor
  text: 'Boa noite, preciso de mais 50m do mesmo tecido, consegue valor melhor?',
  message_date: { received: '2026-07-10T19:01:00.000-04:00', created: '2026-07-10T19:01:00.000-04:00' },
  status: 'available',
};
const doVendedor = {
  id: 'a1b2-msg-2',
  from: { user_id: 999 }, // vendedor = seller
  to: { user_id: 111 },
  text: 'Olá! Consigo sim, vou verificar.',
  message_date: { created: '2026-07-10T20:00:00.000-04:00' },
};

describe('mapearMensagem', () => {
  it('mensagem do comprador → recebida', () => {
    const r = mapearMensagem(doComprador, 999);
    expect(r).toEqual({
      message_id: 'a1b2-msg-1',
      direcao: 'recebida',
      texto: 'Boa noite, preciso de mais 50m do mesmo tecido, consegue valor melhor?',
      data_ml: '2026-07-10T19:01:00.000-04:00',
    });
  });

  it('mensagem do próprio vendedor → enviada (seller_id string ou number)', () => {
    expect(mapearMensagem(doVendedor, 999).direcao).toBe('enviada');
    expect(mapearMensagem(doVendedor, '999').direcao).toBe('enviada');
  });

  it('created ausente cai em received; ambos ausentes → null', () => {
    expect(mapearMensagem({ id: 'x', from: { user_id: 1 }, message_date: { received: '2026-01-01T00:00:00Z' } }, 9).data_ml)
      .toBe('2026-01-01T00:00:00Z');
    expect(mapearMensagem({ id: 'y', from: { user_id: 1 } }, 9).data_ml).toBeNull();
  });

  it('campos ausentes viram defaults seguros; sem from → recebida', () => {
    expect(mapearMensagem({ id: 'z' }, 9)).toEqual({
      message_id: 'z', direcao: 'recebida', texto: '', data_ml: null,
    });
  });
});

describe('extrairMensagens', () => {
  it('extrai o array messages; shape inesperado → []', () => {
    expect(extrairMensagens({ messages: [doComprador, doVendedor] })).toHaveLength(2);
    expect(extrairMensagens({})).toEqual([]);
    expect(extrairMensagens(null)).toEqual([]);
  });
});
