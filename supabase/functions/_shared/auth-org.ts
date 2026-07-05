// E7 (ADR-0027): lógica pura da identidade org do chamador. Sem imports Deno/rede
// (fica fora de auth.ts para ser testável por vitest, que não resolve `jsr:`).

export interface PerfilOrgRow { org_id: string | null; is_active: boolean; is_admin: boolean }

export function resolverOrgDoPerfil(p: PerfilOrgRow): { orgId: string; isAdmin: boolean } {
  if (!p.is_active || !p.org_id) throw new Error('perfil inativo ou sem organização');
  return { orgId: p.org_id, isAdmin: p.is_admin };
}
