import { describe, expect, it } from 'vitest';
import { resolverAcessoOrg, resolverOrgDoPerfil } from '../auth-org.ts';

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

describe('resolverAcessoOrg', () => {
  const agora = new Date('2026-07-25T12:00:00.000Z');

  it('mantém membro ativo no tenant sem sessão de suporte', () => {
    expect(resolverAcessoOrg(
      { org_id: 'org-1', is_active: true, is_admin: false, is_super_admin: false },
      null,
      'write',
      agora,
    )).toEqual({ orgId: 'org-1', isAdmin: false, support: null });
  });

  it('aceita super-admin apenas com sessão ativa ainda vigente', () => {
    expect(resolverAcessoOrg(
      { org_id: null, is_active: true, is_admin: false, is_super_admin: true },
      { id: 'request-1', org_id: 'org-1', scope: 'read', status: 'active', expires_at: '2026-07-25T12:01:00.000Z' },
      'read',
      agora,
    )).toEqual({ orgId: 'org-1', isAdmin: false, support: { requestId: 'request-1', scope: 'read' } });
  });

  it('rejeita escrita de suporte read', () => {
    expect(() => resolverAcessoOrg(
      { org_id: null, is_active: true, is_admin: false, is_super_admin: true },
      { id: 'request-1', org_id: 'org-1', scope: 'read', status: 'active', expires_at: '2026-07-25T12:01:00.000Z' },
      'write',
      agora,
    )).toThrow('escopo full');
  });

  it('rejeita sessão expirada', () => {
    expect(() => resolverAcessoOrg(
      { org_id: null, is_active: true, is_admin: false, is_super_admin: true },
      { id: 'request-1', org_id: 'org-1', scope: 'full', status: 'active', expires_at: '2026-07-25T12:00:00.000Z' },
      'read',
      agora,
    )).toThrow('sessão de suporte');
  });
});
