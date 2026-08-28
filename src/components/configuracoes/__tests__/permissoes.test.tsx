import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const estado = {
  perfil: null as Record<string, unknown> | null,
  suporte: null as { orgId: string; scope: 'read' | 'full' } | null,
};

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (seletor: (s: unknown) => unknown) =>
    seletor({ profile: estado.perfil, profileLoading: false }),
}));
vi.mock('@/stores/support-store', () => ({
  useSupportStore: (seletor: (s: unknown) => unknown) => seletor({ context: estado.suporte }),
}));

import { usePermissoesConfig } from '../permissoes';

function comoUsuario(perfil: Record<string, unknown> | null, suporte: typeof estado.suporte = null) {
  estado.perfil = perfil;
  estado.suporte = suporte;
  return renderHook(() => usePermissoesConfig()).result.current;
}

const MEMBRO = { is_admin: false, is_active: true, allowed_menus: ['configuracoes'], org_id: 'org-1' };
const ADMIN = { ...MEMBRO, is_admin: true };
const SUPER = { ...ADMIN, is_super_admin: true, org_id: null };

// A matriz replica as policies reais. Qualquer divergência aqui é um save que o RLS recusa
// sem a UI mostrar erro (o defeito que existia em Geral/Preços/Notificações) ou um controle
// desabilitado à toa.
describe('usePermissoesConfig', () => {
  it('membro comum não edita nada — a escrita em configuracoes exige admin', () => {
    const p = comoUsuario(MEMBRO);
    expect(p.podeEditarConfig).toBe(false);
    expect(p.podeEditarEmpresa).toBe(false);
    expect(p.podeVerMembros).toBe(false);
  });

  it('admin da organização edita as duas tabelas e vê Membros', () => {
    const p = comoUsuario(ADMIN);
    expect(p.podeEditarConfig).toBe(true);
    expect(p.podeEditarEmpresa).toBe(true);
    expect(p.podeVerMembros).toBe(true);
  });

  it('sessão de suporte com escopo read não edita NADA, mesmo com is_admin no perfil', () => {
    const p = comoUsuario(SUPER, { orgId: 'org-9', scope: 'read' });
    expect(p.podeEditarConfig).toBe(false);
    expect(p.podeEditarEmpresa).toBe(false);
  });

  // empresa_fiscal tem policy DIFERENTE de configuracoes: só is_admin(), sem escape de
  // suporte (adr135_cadastro_fiscal.sql:49-57). Por isso são dois predicados, não um.
  it('sessão de suporte full edita alíquotas; a empresa segue a policy própria', () => {
    const p = comoUsuario(SUPER, { orgId: 'org-9', scope: 'full' });
    expect(p.podeEditarConfig).toBe(true);
  });

  it('sessão de suporte nunca vê Membros — a visibilidade sai de visibleMenus', () => {
    expect(comoUsuario(SUPER, { orgId: 'org-9', scope: 'full' }).podeVerMembros).toBe(false);
    expect(comoUsuario(SUPER, { orgId: 'org-9', scope: 'read' }).podeVerMembros).toBe(false);
  });

  it('sem perfil carregado, não edita nem vê nada', () => {
    const p = comoUsuario(null);
    expect(p.podeEditarConfig).toBe(false);
    expect(p.podeEditarEmpresa).toBe(false);
    expect(p.podeVerMembros).toBe(false);
  });
});
