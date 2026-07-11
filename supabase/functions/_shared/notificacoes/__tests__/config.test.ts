import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lerDestinatarios, notificarCategoria } from '../config.ts';
import { sanitizarDestinatario } from '../destinatario.ts';

type Cfg = { telegram_bot_token: string | null; telegram_chat_id: string | null; telegram_ativo: boolean } | null;

// Mock do admin: roteia por tabela. `configuracoes` resolve via maybeSingle; `profiles` é thenable
// (select().eq().eq().contains().not() → { data }).
function fakeAdmin(cfg: Cfg, profiles: Array<{ telegram_chat_id: string | null }>) {
  return {
    from: (tabela: string) => {
      if (tabela === 'configuracoes') {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: cfg, error: null }),
        };
        return chain;
      }
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        contains: () => chain,
        not: () => chain,
        then: (resolve: any) => Promise.resolve({ data: profiles, error: null }).then(resolve),
      };
      return chain;
    },
  } as any;
}

const ATIVO: Cfg = { telegram_bot_token: 'tok', telegram_chat_id: '999', telegram_ativo: true };

describe('lerDestinatarios', () => {
  it('vazio quando Telegram da org inativo (interruptor-mestre)', async () => {
    const admin = fakeAdmin({ ...ATIVO, telegram_ativo: false }, [{ telegram_chat_id: '111' }]);
    expect(await lerDestinatarios(admin, 'org', 'vendas')).toEqual({ token: null, chatIds: [] });
  });

  it('vazio quando org não tem bot token', async () => {
    const admin = fakeAdmin({ ...ATIVO, telegram_bot_token: null }, [{ telegram_chat_id: '111' }]);
    expect(await lerDestinatarios(admin, 'org', 'vendas')).toEqual({ token: null, chatIds: [] });
  });

  it('retorna token da org + chat_ids, ignorando vazios/whitespace', async () => {
    const admin = fakeAdmin(ATIVO, [
      { telegram_chat_id: '111' }, { telegram_chat_id: '  ' }, { telegram_chat_id: '222' }, { telegram_chat_id: null },
    ]);
    expect(await lerDestinatarios(admin, 'org', 'vendas')).toEqual({ token: 'tok', chatIds: ['111', '222'] });
  });
});

describe('sanitizarDestinatario', () => {
  it('aceita chat_id numérico (inclusive negativo p/ grupo) e categorias válidas', () => {
    expect(sanitizarDestinatario({ telegram_chat_id: ' -100200 ', telegram_categorias: ['vendas', 'moderacao'] }))
      .toEqual({ ok: true, chatId: '-100200', categorias: ['vendas', 'moderacao'] });
  });

  it('vazio → chatId null e categorias vazias', () => {
    expect(sanitizarDestinatario({ telegram_chat_id: '  ', telegram_categorias: [] }))
      .toEqual({ ok: true, chatId: null, categorias: [] });
  });

  it('rejeita chat_id não-numérico', () => {
    const r = sanitizarDestinatario({ telegram_chat_id: 'abc123', telegram_categorias: [] });
    expect(r.ok).toBe(false);
  });

  it('descarta categorias desconhecidas e deduplica', () => {
    expect(sanitizarDestinatario({ telegram_chat_id: '1', telegram_categorias: ['vendas', 'vendas', 'hack', 42] }))
      .toEqual({ ok: true, chatId: '1', categorias: ['vendas'] });
  });

  it('telegram_categorias ausente/não-array → vazio', () => {
    expect(sanitizarDestinatario({ telegram_chat_id: '1' }))
      .toEqual({ ok: true, chatId: '1', categorias: [] });
  });
});

describe('notificarCategoria', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('inativo → 0 envios, nenhum fetch', async () => {
    const admin = fakeAdmin({ ...ATIVO, telegram_ativo: false }, [{ telegram_chat_id: '111' }]);
    expect(await notificarCategoria(admin, 'org', 'vendas', 'oi')).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('envia a cada destinatário e conta os sucessos', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as any);
    const admin = fakeAdmin(ATIVO, [{ telegram_chat_id: '111' }, { telegram_chat_id: '222' }]);
    expect(await notificarCategoria(admin, 'org', 'perguntas', 'oi')).toBe(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('best-effort: falha em um destinatário não impede os demais', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'blocked' } as any)
      .mockResolvedValueOnce({ ok: true } as any);
    const admin = fakeAdmin(ATIVO, [{ telegram_chat_id: '111' }, { telegram_chat_id: '222' }]);
    expect(await notificarCategoria(admin, 'org', 'moderacao', 'oi')).toBe(1);
  });
});
