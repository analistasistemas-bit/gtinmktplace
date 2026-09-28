// ADR-0173: fiação fina sobre worker_pendencias (Task 1) — filas de retry por org, por order_id.
import { describe, it, expect, vi } from 'vitest';
import { lerPendencias, registrarPendencias, temPendenciaAtiva } from '../pendencias';

describe('lerPendencias', () => {
  function criarAdmin(data: unknown, error: { message: string } | null = null) {
    const limit = vi.fn().mockResolvedValue({ data, error });
    const order = vi.fn(() => ({ limit }));
    const gt = vi.fn(() => ({ order }));
    const is = vi.fn(() => ({ gt }));
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { admin: { from } as unknown as Parameters<typeof lerPendencias>[0], from, select, eq, is, gt, order, limit };
  }

  it('filtra descartado_em is null, order_id > depoisDe, ordena e limita', async () => {
    const { admin, from, select, eq, is, gt, order, limit } = criarAdmin([{ order_id: '10' }, { order_id: '11' }]);
    const r = await lerPendencias(admin, 'org-1', '5', 20);
    expect(r).toEqual(['10', '11']);
    expect(from).toHaveBeenCalledWith('worker_pendencias');
    expect(select).toHaveBeenCalledWith('order_id');
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(is).toHaveBeenCalledWith('descartado_em', null);
    expect(gt).toHaveBeenCalledWith('order_id', '5');
    expect(order).toHaveBeenCalledWith('order_id', { ascending: true });
    expect(limit).toHaveBeenCalledWith(20);
  });

  it('error → rejeita', async () => {
    const { admin } = criarAdmin(null, { message: 'timeout' });
    await expect(lerPendencias(admin, 'org-1', '5', 20)).rejects.toThrow('timeout');
  });
});

describe('registrarPendencias', () => {
  function criarAdmin(data: unknown, error: { message: string } | null = null) {
    const rpc = vi.fn().mockResolvedValue({ data, error });
    return { admin: { rpc } as unknown as Parameters<typeof registrarPendencias>[0], rpc };
  }

  it('chama a RPC com os arrays e devolve descartados', async () => {
    const { admin, rpc } = criarAdmin([{ descartados: 3 }]);
    const r = await registrarPendencias(admin, 'org-1', ['1', '2'], '2026-09-27T00:00:00Z', ['3'], 'timeout');
    expect(r).toBe(3);
    expect(rpc).toHaveBeenCalledWith('registrar_pendencias_pedido', {
      p_org: 'org-1', p_ok: ['1', '2'], p_inicio: '2026-09-27T00:00:00Z', p_falhas: ['3'], p_erro: 'timeout',
    });
  });

  it('sem linha de retorno → 0', async () => {
    const { admin } = criarAdmin([]);
    await expect(registrarPendencias(admin, 'org-1', [], '2026-09-27T00:00:00Z', [], null)).resolves.toBe(0);
  });

  it('error → rejeita', async () => {
    const { admin } = criarAdmin(null, { message: 'boom' });
    await expect(registrarPendencias(admin, 'org-1', [], '2026-09-27T00:00:00Z', [], null)).rejects.toThrow('boom');
  });
});

describe('temPendenciaAtiva', () => {
  function criarAdmin(count: number | null, error: { message: string } | null = null) {
    const is = vi.fn().mockResolvedValue({ count, error });
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { admin: { from } as unknown as Parameters<typeof temPendenciaAtiva>[0], select, eq, is };
  }

  it('devolve a quantidade de pendências ativas', async () => {
    const { admin, select, eq, is } = criarAdmin(3);
    await expect(temPendenciaAtiva(admin, 'org-1')).resolves.toBe(3);
    expect(select).toHaveBeenCalledWith('order_id', { count: 'exact', head: true });
    expect(eq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(is).toHaveBeenCalledWith('descartado_em', null);
  });

  it('count null → 0', async () => {
    const { admin } = criarAdmin(null);
    await expect(temPendenciaAtiva(admin, 'org-1')).resolves.toBe(0);
  });

  it('error → rejeita', async () => {
    const { admin } = criarAdmin(null, { message: 'boom' });
    await expect(temPendenciaAtiva(admin, 'org-1')).rejects.toThrow('boom');
  });
});
