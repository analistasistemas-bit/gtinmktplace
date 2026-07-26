// E7 (ADR-0027): lógica pura da identidade org do chamador. Sem imports Deno/rede
// (fica fora de auth.ts para ser testável por vitest, que não resolve `jsr:`).

export interface PerfilOrgRow {
  org_id: string | null;
  is_active: boolean;
  is_admin: boolean;
  is_super_admin?: boolean;
}

export interface SupportSessionRow {
  id: string;
  org_id: string;
  scope: 'read' | 'full';
  status: string;
  expires_at: string | null;
}

export type SupportAccess = 'read' | 'write';

export function resolverOrgDoPerfil(p: PerfilOrgRow): { orgId: string; isAdmin: boolean } {
  if (!p.is_active || !p.org_id) throw new Error('perfil inativo ou sem organização');
  return { orgId: p.org_id, isAdmin: p.is_admin };
}

export function resolverAcessoOrg(
  perfil: PerfilOrgRow,
  sessao: SupportSessionRow | null,
  access: SupportAccess = 'read',
  now = new Date(),
): { orgId: string; isAdmin: boolean; support: null | { requestId: string; scope: 'read' | 'full' } } {
  if (!perfil.is_active) throw new Error('perfil inativo');
  if (!perfil.is_super_admin) {
    const { orgId, isAdmin } = resolverOrgDoPerfil(perfil);
    return { orgId, isAdmin, support: null };
  }
  if (!sessao || sessao.status !== 'active' || !sessao.expires_at || new Date(sessao.expires_at) <= now) {
    throw new Error('sessão de suporte ausente ou expirada');
  }
  if (access === 'write' && sessao.scope !== 'full') throw new Error('escopo full é necessário para escrita');
  return { orgId: sessao.org_id, isAdmin: false, support: { requestId: sessao.id, scope: sessao.scope } };
}
