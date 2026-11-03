// Fronteira HTTP do fechar-mes-plataforma: assinatura QStash, ator de sistema e mapeamento de erros.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  verificar: vi.fn(async () => true),
  processar: vi.fn(async () => ({ publicados: 0 })),
  env: {} as Record<string, string>,
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {} }));
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: vi.fn(() => ({})) }));
vi.mock('../../_shared/queue.ts', () => ({ verificarAssinatura: f.verificar, qstashClient: vi.fn() }));
vi.mock('../../_shared/platform-admin/fechamento-automatico-io.ts', async () => {
  class EntradaInvalida extends Error {}
  class AguardandoOrgs extends Error {}
  return { EntradaInvalida, AguardandoOrgs, processarJobFechamento: f.processar };
});

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: (k: string) => f.env[k] } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0];
});
beforeEach(() => {
  f.env = { PLATFORM_SYSTEM_ACTOR_ID: '00000000-0000-4000-8000-000000000001', APP_URL: 'https://app/', SUPABASE_URL: 'https://x.supabase.co' };
  f.verificar.mockResolvedValue(true);
  f.processar.mockReset().mockResolvedValue({ publicados: 0 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const req = (body = '', headers: Record<string, string> = { 'upstash-signature': 'sig' }) =>
  new Request('http://localhost', { method: 'POST', headers, body });

describe('fechar-mes-plataforma (handler)', () => {
  it('assinatura QStash inválida → 401 sem processar', async () => {
    f.verificar.mockResolvedValue(false);
    const r = await handler(req('{}'));
    expect(r.status).toBe(401);
    expect(f.processar).not.toHaveBeenCalled();
  });

  it('sem PLATFORM_SYSTEM_ACTOR_ID → 500 alto, sem processar', async () => {
    delete f.env.PLATFORM_SYSTEM_ACTOR_ID;
    expect((await handler(req(''))).status).toBe(500);
    expect(f.processar).not.toHaveBeenCalled();
  });

  it('schedule sem body → processa {} com ator, link da Central, URL própria e retried', async () => {
    const r = await handler(req('', { 'upstash-signature': 'sig', 'upstash-retried': '2' }));
    expect(r.status).toBe(200);
    const [, job, ctx] = f.processar.mock.calls[0] as unknown as [unknown, unknown, Record<string, unknown>];
    expect(job).toEqual({});
    expect(ctx).toMatchObject({
      ator: '00000000-0000-4000-8000-000000000001', linkCentral: 'https://app/#/admin',
      url: 'https://x.supabase.co/functions/v1/fechar-mes-plataforma', retried: 2,
    });
  });

  it('JSON inválido → 400; EntradaInvalida → 400; AguardandoOrgs/erro → 500', async () => {
    expect((await handler(req('{x'))).status).toBe(400);
    const io = await import('../../_shared/platform-admin/fechamento-automatico-io.ts');
    f.processar.mockRejectedValueOnce(new io.EntradaInvalida('month'));
    expect((await handler(req('{"month":"2026-13"}'))).status).toBe(400);
    f.processar.mockRejectedValueOnce(new io.AguardandoOrgs('1 org'));
    expect((await handler(req('{"aviso":true}'))).status).toBe(500);
    f.processar.mockRejectedValueOnce(new Error('boom'));
    expect((await handler(req('{"orgId":"x"}'))).status).toBe(500);
  });
});
