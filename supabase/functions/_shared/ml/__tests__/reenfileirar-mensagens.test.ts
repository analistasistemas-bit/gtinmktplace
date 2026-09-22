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
  it('upsert inseriu (evento novo): enfileirar', () => {
    expect(classificarDedupWebhook({ erro: null, inseriu: true }, 'orders_v2')).toBe('enfileirar');
    expect(classificarDedupWebhook({ erro: null, inseriu: true }, 'messages')).toBe('enfileirar');
  });

  it('erro do upsert (RLS/timeout/pool): enfileirar — não engole o evento', () => {
    expect(classificarDedupWebhook({ erro: { code: '57014' }, inseriu: false }, 'orders_v2')).toBe('enfileirar'); // query_canceled/timeout
    expect(classificarDedupWebhook({ erro: { code: '42501' }, inseriu: false }, 'questions')).toBe('enfileirar'); // insufficient_privilege (RLS)
    expect(classificarDedupWebhook({ erro: {}, inseriu: false }, 'orders_v2')).toBe('enfileirar'); // erro sem code: na dúvida não perde o evento
  });

  it('duplicado real (0 linhas, sem erro) de topic com resource estável (vendas/envios): ignorar', () => {
    expect(classificarDedupWebhook({ erro: null, inseriu: false }, 'orders_v2')).toBe('ignorar');
    expect(classificarDedupWebhook({ erro: null, inseriu: false }, 'shipments')).toBe('ignorar');
  });

  it('duplicado real (0 linhas) de questions/claims: enfileirar — 2º evento é mudança de estado', () => {
    expect(classificarDedupWebhook({ erro: null, inseriu: false }, 'questions')).toBe('enfileirar');
    expect(classificarDedupWebhook({ erro: null, inseriu: false }, 'claims')).toBe('enfileirar');
  });

  it('duplicado real (0 linhas) de messages: checar-messages (decisão temporal fica com deveReenfileirarMensagens)', () => {
    expect(classificarDedupWebhook({ erro: null, inseriu: false }, 'messages')).toBe('checar-messages');
  });
});
