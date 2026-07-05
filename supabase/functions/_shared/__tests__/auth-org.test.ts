import { describe, expect, it } from 'vitest';
import { resolverOrgDoPerfil } from '../auth-org.ts';

describe('resolverOrgDoPerfil', () => {
  it('devolve org e admin de perfil ativo', () => {
    expect(resolverOrgDoPerfil({ org_id: 'org-1', is_active: true, is_admin: true }))
      .toEqual({ orgId: 'org-1', isAdmin: true });
  });
  it('devolve isAdmin false p/ membro comum ativo', () => {
    expect(resolverOrgDoPerfil({ org_id: 'org-1', is_active: true, is_admin: false }))
      .toEqual({ orgId: 'org-1', isAdmin: false });
  });
  it('rejeita perfil inativo', () => {
    expect(() => resolverOrgDoPerfil({ org_id: 'org-1', is_active: false, is_admin: false })).toThrow();
  });
  it('rejeita perfil sem org', () => {
    expect(() => resolverOrgDoPerfil({ org_id: null, is_active: true, is_admin: false })).toThrow();
  });
});
