import { describe, it, expect, vi } from 'vitest';

// Pino do payload real (2026-09-19, incidente "Falha ao salvar [object Object]"): o token NUNCA
// pode ir no upsert com onConflict:'org_id' — vira ON CONFLICT DO UPDATE SET col=EXCLUDED.col, que
// o Postgres só resolve com SELECT na coluna. `telegram_bot_token` perdeu esse grant de propósito
// (migration 20260822131053, achado de segurança F5). O token vai num update() puro à parte.
const { mockFrom, mockGetUser } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetUser: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, auth: { getUser: mockGetUser } },
}));

const { useAuthStore } = await import('@/stores/auth-store');
const { salvarTelegramConfig } = await import('../queries');

useAuthStore.setState({
  profile: { id: 'u1', is_admin: true, is_active: true, allowed_menus: [], nome: 'Admin', org_id: 'org-1', is_super_admin: false },
});
mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });

describe('salvarTelegramConfig', () => {
  it('sem token: só faz upsert de chat_id/ativo, sem telegram_bot_token no payload', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ upsert });

    await salvarTelegramConfig({ chatId: '123', ativo: true });

    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockFrom).toHaveBeenCalledWith('configuracoes');
    const [payload, opts] = upsert.mock.calls[0];
    expect(payload).toMatchObject({ org_id: 'org-1', telegram_chat_id: '123', telegram_ativo: true });
    expect(payload).not.toHaveProperty('telegram_bot_token');
    expect(opts).toEqual({ onConflict: 'org_id' });
  });

  it('com token: upsert sem o token + update() separado só com telegram_bot_token', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ upsert, update });

    await salvarTelegramConfig({ chatId: '123', ativo: true, botToken: ' meu-token ' });

    const [upsertPayload] = upsert.mock.calls[0];
    expect(upsertPayload).not.toHaveProperty('telegram_bot_token');

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ telegram_bot_token: 'meu-token' }));
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1');
    // Ordem importa: update() num org_id que ainda não existe devolve 0 linhas SEM erro — se o
    // token rodasse antes do upsert, o 1º save de uma org nova perderia o token em silêncio.
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
  });

  it('erro no update do token propaga (não é engolido)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockResolvedValue({ error: { message: 'permission denied' } });
    const update = vi.fn().mockReturnValue({ eq });
    mockFrom.mockReturnValue({ upsert, update });

    await expect(salvarTelegramConfig({ chatId: '123', ativo: true, botToken: 'x' }))
      .rejects.toMatchObject({ message: 'permission denied' });
  });
});
