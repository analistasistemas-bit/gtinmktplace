import { describe, it, expect, vi } from 'vitest';
import { registrarFalhaAuth, registrarSyncOk } from '../liveness';

function criarAdminMock(authAlertaEm: string | null) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) });
  const maybeSingle = vi.fn().mockResolvedValue({ data: { auth_alerta_em: authAlertaEm }, error: null });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select, update });
  const admin = { from } as unknown as Parameters<typeof registrarFalhaAuth>[0];
  return { admin, update, select };
}

describe('registrarFalhaAuth', () => {
  it('conexão sem auth_alerta_em → jaAlertado: false e chama update com auth_alerta_em preenchido', async () => {
    const { admin, update } = criarAdminMock(null);
    const r = await registrarFalhaAuth(admin, 'conexao-1', 'ML /orders 401: token inválido');
    expect(r.jaAlertado).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0] as { auth_alerta_em: string };
    expect(payload.auth_alerta_em).toBeTruthy();
  });

  it('conexão já com auth_alerta_em preenchido → jaAlertado: true e NÃO chama update (anti-spam)', async () => {
    const { admin, update } = criarAdminMock('2026-07-10T00:00:00.000Z');
    const r = await registrarFalhaAuth(admin, 'conexao-1', 'ML /orders 401: token inválido');
    expect(r.jaAlertado).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('registrarSyncOk', () => {
  it('chama update com ultima_sincronizacao_ok_em preenchido e auth_alerta_em: null', async () => {
    const { admin, update } = criarAdminMock(null);
    await registrarSyncOk(admin, 'conexao-1');
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0] as { ultima_sincronizacao_ok_em: string; auth_alerta_em: null };
    expect(payload.ultima_sincronizacao_ok_em).toBeTruthy();
    expect(payload.auth_alerta_em).toBeNull();
  });
});
