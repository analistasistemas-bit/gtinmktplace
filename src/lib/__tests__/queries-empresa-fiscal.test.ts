import { describe, it, expect, vi } from 'vitest';

// Pino do payload real do upsert (Task 11, ADR-0135) — o teste de UI mocka
// @/hooks/useConfiguracoes inteiro e nunca chama upsertEmpresaFiscal de verdade.
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mockFrom } }));

const { useAuthStore } = await import('@/stores/auth-store');
const { upsertEmpresaFiscal } = await import('../queries');

useAuthStore.setState({
  profile: { id: 'u1', is_admin: true, is_active: true, allowed_menus: [], nome: 'Admin', org_id: 'org-1', is_super_admin: false },
});

describe('upsertEmpresaFiscal', () => {
  it('grava org_id + patch + atualizado_em com onConflict org_id', async () => {
    let payload: unknown;
    let opts: unknown;
    mockFrom.mockReturnValue({
      upsert: (p: unknown, o: unknown) => { payload = p; opts = o; return Promise.resolve({ error: null }); },
    });

    await upsertEmpresaFiscal({ cnpj: '11222333000181' });

    expect(mockFrom).toHaveBeenCalledWith('empresa_fiscal');
    expect(payload).toMatchObject({ org_id: 'org-1', cnpj: '11222333000181' });
    expect(payload).toHaveProperty('atualizado_em');
    expect(opts).toEqual({ onConflict: 'org_id' });
  });
});
