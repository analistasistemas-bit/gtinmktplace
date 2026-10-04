import { describe, it, expect, vi } from 'vitest';
import { publicarFamilias, familiasEnviadas } from '@/lib/publicar';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token-teste' } } }),
    },
  },
}));

const { warningSpy } = vi.hoisted(() => ({ warningSpy: vi.fn() }));
vi.mock('sonner', () => ({ toast: { warning: warningSpy } }));

describe('publicarFamilias', () => {
  it('recusadas pelo reajuste em massa → toast de aviso; sem recusa, nenhum toast', async () => {
    const motivo = 'Há reajuste de preço em massa em andamento no anúncio MLB1';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ enfileiradas: 1, recusadas: [{ familia_id: 'F2', motivo }] }),
    }));
    await publicarFamilias(['F1', 'F2']);
    expect(warningSpy).toHaveBeenCalledWith('1 produto(s) não enviado(s)', { description: motivo });

    warningSpy.mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ enfileiradas: 1, recusadas: [] }) }));
    await publicarFamilias(['F1']);
    expect(warningSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('inclui a escolha de somente estoque no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enfileiradas: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await publicarFamilias(['F1'], 'gold_special', ['mercado_livre'], {
      somenteEstoqueGlobal: true,
      somenteEstoqueOverrides: ['F1'],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.somente_estoque_global).toBe(true);
    expect(body.somente_estoque_overrides).toEqual(['F1']);

    vi.unstubAllGlobals();
  });
});

describe('familiasEnviadas (toast de sucesso de Revisão/Progresso)', () => {
  it('recusa parcial desconta as recusadas; sem recusa = seleção (igual a antes)', () => {
    expect(familiasEnviadas(3, { enfileiradas: 2, recusadas: [{ familia_id: 'F3', motivo: 'x' }] })).toBe(2);
    expect(familiasEnviadas(3, { enfileiradas: 3 })).toBe(3);
    // Canais extras: enfileiradas soma (família × canal), a contagem de famílias não.
    expect(familiasEnviadas(2, { enfileiradas: 4, recusadas: [] })).toBe(2);
  });
});
