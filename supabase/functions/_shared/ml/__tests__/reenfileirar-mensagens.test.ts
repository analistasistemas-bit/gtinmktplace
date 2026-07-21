import { describe, expect, it } from 'vitest';
import { deveReenfileirarMensagens, classificarDedupWebhook } from '../reenfileirar-mensagens.ts';

describe('deveReenfileirarMensagens', () => {
  const agora = new Date('2026-07-12T12:00:00.000Z').getTime();

  it('sem linha existente: false', () => {
    expect(deveReenfileirarMensagens(null, agora)).toBe(false);
  });

  it('linha já processada: false', () => {
    const existente = { recebido_em: new Date(agora - 10 * 60_000).toISOString(), processado_em: new Date().toISOString() };
    expect(deveReenfileirarMensagens(existente, agora)).toBe(false);
  });

  it('linha não-processada recente (<=2min): false', () => {
    const existente = { recebido_em: new Date(agora - 60_000).toISOString(), processado_em: null };
    expect(deveReenfileirarMensagens(existente, agora)).toBe(false);
  });

  it('linha não-processada antiga (>2min): true', () => {
    const existente = { recebido_em: new Date(agora - 121_000).toISOString(), processado_em: null };
    expect(deveReenfileirarMensagens(existente, agora)).toBe(true);
  });
});

describe('classificarDedupWebhook', () => {
  it('sem erro de INSERT (evento novo): enfileirar', () => {
    expect(classificarDedupWebhook(null, 'orders_v2')).toBe('enfileirar');
    expect(classificarDedupWebhook(null, 'messages')).toBe('enfileirar');
  });

  it('erro NÃO-23505 (RLS/timeout/pool): enfileirar — não engole o evento', () => {
    expect(classificarDedupWebhook({ code: '57014' }, 'orders_v2')).toBe('enfileirar'); // query_canceled/timeout
    expect(classificarDedupWebhook({ code: '42501' }, 'questions')).toBe('enfileirar'); // insufficient_privilege (RLS)
    expect(classificarDedupWebhook({ code: 'messages' }, 'messages')).toBe('enfileirar'); // code inesperado
  });

  it('erro sem code (undefined): enfileirar — na dúvida não perde o evento', () => {
    expect(classificarDedupWebhook({}, 'orders_v2')).toBe('enfileirar');
  });

  it('duplicado real (23505) de topic ≠ messages: ignorar', () => {
    expect(classificarDedupWebhook({ code: '23505' }, 'orders_v2')).toBe('ignorar');
    expect(classificarDedupWebhook({ code: '23505' }, 'questions')).toBe('ignorar');
  });

  it('duplicado real (23505) de messages: checar-messages (decisão temporal fica com deveReenfileirarMensagens)', () => {
    expect(classificarDedupWebhook({ code: '23505' }, 'messages')).toBe('checar-messages');
  });
});
