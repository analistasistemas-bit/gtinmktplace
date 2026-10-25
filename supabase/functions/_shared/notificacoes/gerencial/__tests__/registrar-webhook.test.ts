import { describe, expect, it, vi } from 'vitest';
import { registrarWebhookTelegram } from '../registrar-webhook.ts';
import { secretDaOrg } from '../bot.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const BOT = 8837666738;

function fakeFetch(over: Partial<Record<'getMe' | 'setWebhook' | 'setMyCommands', unknown>> = {}) {
  const resp: Record<string, unknown> = { getMe: { ok: true, result: { id: BOT } }, setWebhook: { ok: true }, setMyCommands: { ok: true }, ...over };
  return vi.fn(async (url: string) => {
    const metodo = url.split('/').pop()!;
    return new Response(JSON.stringify(resp[metodo]), { status: (resp[metodo] as { ok?: boolean })?.ok ? 200 : 400 });
  });
}

const base = (over = {}) => ({
  orgId: ORG, chave: 'chave-mestra', supabaseUrl: 'https://proj.supabase.co',
  lerToken: vi.fn().mockResolvedValue('SEGREDO123'),
  outraOrgComBot: vi.fn().mockResolvedValue(false),
  gravarBotId: vi.fn().mockResolvedValue(null),
  fetch: fakeFetch(),
  ...over,
});

const corpo = (f: ReturnType<typeof vi.fn>, metodo: string) =>
  JSON.parse((f.mock.calls.find(([u]) => String(u).endsWith(`/${metodo}`))![1] as RequestInit).body as string);

describe('registrarWebhookTelegram (ADR-0190 D-8)', () => {
  it('getMe → grava bot_id → setWebhook com secret da org → setMyCommands', async () => {
    const d = base();
    expect(await registrarWebhookTelegram(d)).toEqual({ status: 200, body: { ok: true } });
    expect(d.fetch.mock.calls[0][0]).toBe('https://api.telegram.org/botSEGREDO123/getMe');
    expect(d.gravarBotId).toHaveBeenCalledWith(BOT);
    expect(corpo(d.fetch, 'setWebhook')).toEqual({
      url: `https://proj.supabase.co/functions/v1/telegram-bot?org=${ORG}`,
      secret_token: await secretDaOrg('chave-mestra', ORG, BOT),
      allowed_updates: ['message'],
      drop_pending_updates: false,
    });
    expect(corpo(d.fetch, 'setMyCommands').commands.map((c: { command: string }) => c.command))
      .toEqual(['hoje', 'ontem', 'mes', 'top', 'ajuda']);
  });

  it('bot já ligado a outra org → 409, sem gravar nem setWebhook', async () => {
    const d = base({ outraOrgComBot: vi.fn().mockResolvedValue(true) });
    expect(await registrarWebhookTelegram(d)).toEqual({ status: 409, body: { error: 'Este bot já está ligado a outra organização.' } });
    expect(d.gravarBotId).not.toHaveBeenCalled();
    expect(d.fetch).toHaveBeenCalledOnce();
  });

  it('corrida: unique violado na gravação → mesmo 409', async () => {
    const d = base({ gravarBotId: vi.fn().mockResolvedValue({ code: '23505', message: 'duplicate key' }) });
    expect((await registrarWebhookTelegram(d)).status).toBe(409);
    expect(d.fetch).toHaveBeenCalledOnce();
  });

  it('sem token salvo → 400; token inválido → 400; sem chave → 500', async () => {
    expect((await registrarWebhookTelegram(base({ lerToken: vi.fn().mockResolvedValue(null) }))).status).toBe(400);
    expect((await registrarWebhookTelegram(base({ fetch: fakeFetch({ getMe: { ok: false, description: 'Unauthorized' } }) }))).status).toBe(400);
    expect((await registrarWebhookTelegram(base({ chave: undefined }))).status).toBe(500);
  });

  it('setWebhook ou setMyCommands recusado → 502 sem vazar o token', async () => {
    const r = await registrarWebhookTelegram(base({ fetch: fakeFetch({ setWebhook: { ok: false, description: 'bad' } }) }));
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toContain('SEGREDO123');
    expect((await registrarWebhookTelegram(base({ fetch: fakeFetch({ setMyCommands: { ok: false } }) }))).status).toBe(502);
  });
});
