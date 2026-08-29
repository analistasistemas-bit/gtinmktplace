// Autorização do Gateway de mercado (ADR-0132 D-4, D-13, D-15).
//
// Espelha o `requireUserOrg` das edge functions (`supabase/functions/_shared/auth.ts`), mas em
// Node. Não é código compartilhado de propósito: aquele arquivo é Deno, importa `.ts` com
// extensão e usa o cliente admin global. Aqui as dependências entram por parâmetro, o que deixa
// a decisão testável sem rede.
//
// Duas regras da ADR-0132 mandam na forma deste arquivo:
//
// - **D-15:** `org_id` NUNCA vem do payload. É derivado do token, lendo `profiles` no servidor.
// - **D-13:** módulo desligado, perfil inativo e token inválido são estados DISTINTOS. Cada um
//   tem código próprio, porque a UI precisa dizer coisas diferentes. Colapsar tudo em 403 genérico
//   é o defeito que a D-13 proíbe.

/** Slug do módulo no `/admin` → Módulos. Desligado por padrão (ADR-0132 D-4). */
export const MODULO = 'analise_avancada'

export interface PerfilRow {
  org_id: string | null
  is_active: boolean | null
  is_admin: boolean | null
}

export interface Chamador {
  userId: string
  orgId: string
  isAdmin: boolean
}

/** Motivos de recusa. O código vai no envelope de erro e a UI decide o texto. */
export type MotivoRecusa =
  | 'sem_token'
  | 'token_invalido'
  | 'perfil_ausente'
  | 'perfil_inativo'
  | 'sem_org'
  | 'modulo_desligado'

export type Autorizacao =
  | { ok: true; chamador: Chamador }
  | { ok: false; motivo: MotivoRecusa }

export interface DepsAutorizacao {
  /** Valida o JWT contra o Supabase e devolve o usuário, ou null se inválido/expirado. */
  usuarioDoToken(token: string): Promise<{ id: string } | null>
  /** Lê `profiles` pelo id do usuário. null quando não existe. */
  perfil(userId: string): Promise<PerfilRow | null>
  /** Lê `organizations.modulos_habilitados` da org. */
  modulosDaOrg(orgId: string): Promise<string[]>
}

/** HTTP status por motivo: falta de identidade é 401, falta de permissão é 403. */
export function statusDe(motivo: MotivoRecusa): 401 | 403 {
  return motivo === 'sem_token' || motivo === 'token_invalido' ? 401 : 403
}

export function extrairToken(headerAutorizacao: string | null | undefined): string | null {
  if (!headerAutorizacao?.startsWith('Bearer ')) return null
  const token = headerAutorizacao.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

/**
 * Identidade e permissão do chamador, na ordem em que as coisas podem faltar.
 * A ordem importa: um token inválido nunca deve produzir "módulo desligado", que sugeriria ao
 * operador que o problema é de configuração da organização.
 */
export async function autorizar(
  headerAutorizacao: string | null | undefined,
  deps: DepsAutorizacao,
): Promise<Autorizacao> {
  const token = extrairToken(headerAutorizacao)
  if (!token) return { ok: false, motivo: 'sem_token' }

  const usuario = await deps.usuarioDoToken(token)
  if (!usuario) return { ok: false, motivo: 'token_invalido' }

  const perfil = await deps.perfil(usuario.id)
  if (!perfil) return { ok: false, motivo: 'perfil_ausente' }
  // `is_active` nulo é tratado como inativo: um perfil sem a flag preenchida não prova acesso.
  if (perfil.is_active !== true) return { ok: false, motivo: 'perfil_inativo' }
  if (!perfil.org_id) return { ok: false, motivo: 'sem_org' }

  const modulos = await deps.modulosDaOrg(perfil.org_id)
  if (!modulos.includes(MODULO)) return { ok: false, motivo: 'modulo_desligado' }

  return {
    ok: true,
    chamador: { userId: usuario.id, orgId: perfil.org_id, isAdmin: perfil.is_admin === true },
  }
}
