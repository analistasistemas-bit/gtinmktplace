import { useProfile } from '@/hooks/useProfile';
import { useSupportStore } from '@/stores/support-store';
import { visibleMenus } from '@/lib/menus';

/**
 * Quem pode editar o quê em /configuracoes.
 *
 * A tela escreve em DUAS tabelas com policies diferentes, então há dois predicados:
 *
 * - `configuracoes` (descontos, ancorar piso, mostrar lucro, modelos de IA, Telegram e
 *   alíquotas): `is_admin() OR current_support_scope() = 'full'`
 *   (`20260725224000_support_access.sql:285-298`).
 * - `empresa_fiscal` (o cadastro da empresa): `is_admin()` apenas, sem escape de suporte
 *   (`20260826004934_adr135_cadastro_fiscal.sql:49-57`).
 *
 * Leitura NÃO é gateada: o `SELECT` das duas é liberado a qualquer membro da organização, e
 * é de propósito — quem precifica precisa enxergar a alíquota e o desconto vigentes.
 *
 * `podeEscrever` replica `canWrite()` (`support-store.ts:56`) de forma reativa: a função de
 * lá lê o store direto e não re-renderiza quando o contexto de suporte muda. Ela entra como
 * conjunto restritivo, nunca sozinha — sozinha seria mais permissiva que as duas policies
 * (devolve `true` para qualquer membro com `org_id`). Como conjunto, fecha a sessão de
 * suporte em escopo `read`, onde o super-admin ainda carrega `profiles.is_admin = true`.
 */
export function usePermissoesConfig() {
  const { profile, isAdmin, profileLoading } = useProfile();
  const context = useSupportStore((s) => s.context);

  const orgId = context?.orgId ?? profile?.org_id ?? null;
  const podeEscrever = context ? context.scope === 'full' : orgId !== null;

  // A visibilidade de "Membros" sai da MESMA fonte que a sidebar usa, em vez de ser
  // re-derivada de `isAdmin`. Re-derivar divergiria exatamente na sessão de suporte:
  // `visibleMenus(p, true)` devolve MENU_KEYS (sem 'usuarios'), mas o super-admin que abre a
  // sessão tem `is_admin = true` — a seção reapareceria para quem nunca a viu.
  const menus = visibleMenus(
    profile ?? { is_admin: false, is_active: true, allowed_menus: [] },
    !!context,
  );

  return {
    podeEditarConfig: podeEscrever && (isAdmin || context?.scope === 'full'),
    podeEditarEmpresa: podeEscrever && isAdmin,
    podeVerMembros: menus.includes('usuarios'),
    profileLoading,
  };
}
