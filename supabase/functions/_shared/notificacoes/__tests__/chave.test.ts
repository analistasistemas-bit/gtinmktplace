// ADR-0173: notificarCategoria com `chave` — caminho garantido/idempotente usado só pela rodada
// do Pulse. Sem `chave`, o comportamento tem que continuar igual ao de config.test.ts (best-effort).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { notificarCategoria } from '../config.ts';

type Cfg = { telegram_bot_token: string | null; telegram_chat_id: string | null; telegram_ativo: boolean } | null;
type Profile = { id: string; telegram_chat_id: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeAdmin(opts: {
  cfg: Cfg;
  profiles: Profile[];
  profilesError?: { message: string } | null;
  upsertData?: Array<{ user_id: string }> | null;
  upsertError?: { message: string } | null;
}) {
  const upsertCalls: Array<{ rows: unknown[]; options: unknown }> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any = {
    upsertCalls,
    from: (tabela: string) => {
      if (tabela === 'configuracoes') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: opts.cfg, error: null }) };
        return chain;
      }
      if (tabela === 'profiles') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const chain: any = {
          select: () => chain, eq: () => chain, contains: () => chain,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          then: (resolve: any) => Promise.resolve({ data: opts.profiles, error: opts.profilesError ?? null }).then(resolve),
        };
        return chain;
      }
      if (tabela === 'notificacoes') {
        return {
          upsert: (rows: unknown[], options: unknown) => {
            upsertCalls.push({ rows, options });
            return { select: async () => ({ data: opts.upsertData ?? null, error: opts.upsertError ?? null }) };
          },
        };
      }
      throw new Error(`tabela inesperada: ${tabela}`);
    },
  };
  return admin;
}

const ATIVO: Cfg = { telegram_bot_token: 'tok', telegram_chat_id: '999', telegram_ativo: true };

describe('notificarCategoria com chave', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('1ª chamada: grava 2 linhas (onConflict user_id,chave) e manda 2 Telegrams', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as unknown as Response);
    const admin = fakeAdmin({
      cfg: ATIVO,
      profiles: [{ id: 'u1', telegram_chat_id: '111' }, { id: 'u2', telegram_chat_id: '222' }],
      upsertData: [{ user_id: 'u1' }, { user_id: 'u2' }],
    });

    const n = await notificarCategoria(admin, 'org1', 'pulse', 'oi', { chave: 'rodada:pulse:2026-09-27' });

    expect(n).toBe(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(admin.upsertCalls).toHaveLength(1);
    expect(admin.upsertCalls[0].options).toEqual({ onConflict: 'user_id,chave', ignoreDuplicates: true });
    expect(admin.upsertCalls[0].rows).toEqual([
      expect.objectContaining({ user_id: 'u1', chave: 'rodada:pulse:2026-09-27' }),
      expect.objectContaining({ user_id: 'u2', chave: 'rodada:pulse:2026-09-27' }),
    ]);
  });

  it('2ª chamada (upsert devolve []) → não manda Telegram', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const admin = fakeAdmin({
      cfg: ATIVO,
      profiles: [{ id: 'u1', telegram_chat_id: '111' }, { id: 'u2', telegram_chat_id: '222' }],
      upsertData: [], // ambos já existiam (ON CONFLICT DO NOTHING)
    });

    const n = await notificarCategoria(admin, 'org1', 'pulse', 'oi', { chave: 'rodada:pulse:2026-09-27' });

    expect(n).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lerAssinantes com error → rejeita', async () => {
    const admin = fakeAdmin({ cfg: ATIVO, profiles: [], profilesError: { message: 'timeout' } });
    await expect(notificarCategoria(admin, 'org1', 'pulse', 'oi', { chave: 'k' })).rejects.toThrow('timeout');
  });

  it('upsert com error → rejeita', async () => {
    const admin = fakeAdmin({
      cfg: ATIVO,
      profiles: [{ id: 'u1', telegram_chat_id: '111' }],
      upsertError: { message: 'conflito' },
    });
    await expect(notificarCategoria(admin, 'org1', 'pulse', 'oi', { chave: 'k' })).rejects.toThrow('conflito');
  });
});

describe('notificarCategoria sem chave (comportamento de hoje)', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('lerAssinantes com erro → segue com lista vazia (best-effort, não lança)', async () => {
    const admin = fakeAdmin({ cfg: ATIVO, profiles: [], profilesError: { message: 'timeout' } });
    await expect(notificarCategoria(admin, 'org1', 'pulse', 'oi')).resolves.toBe(0);
    expect(admin.upsertCalls).toHaveLength(0);
  });
});
