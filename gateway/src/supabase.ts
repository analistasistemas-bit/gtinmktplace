// Acesso ao Supabase pelo Gateway, com service role.
//
// Por que service role e não o token do usuário: o Gateway precisa VERIFICAR o token
// (`auth.getUser`) e ler `profiles`/`organizations` de forma independente do que o browser
// afirma — é o que a D-4 e a D-15 da ADR-0132 exigem. Com o token do chamador o Gateway leria
// pelas mesmas lentes de quem está perguntando, e o gate do módulo deixaria de ser server-side.
//
// A contrapartida é que service role ignora RLS. Por isso TODA consulta aqui filtra explicitamente
// pelo `org_id` já derivado do token, nunca por um id vindo de payload.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DepsAutorizacao, PerfilRow } from './autorizacao.js'

export function criarClienteAdmin(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function depsDoSupabase(admin: SupabaseClient): DepsAutorizacao {
  return {
    async usuarioDoToken(token) {
      const { data, error } = await admin.auth.getUser(token)
      if (error || !data.user) return null
      return { id: data.user.id }
    },

    async perfil(userId) {
      const { data } = await admin
        .from('profiles')
        .select('org_id, is_active, is_admin')
        .eq('id', userId)
        .maybeSingle()
      return (data as PerfilRow | null) ?? null
    },

    async modulosDaOrg(orgId) {
      // A RPC `modulos_habilitados_da_org()` resolve a org pelo contexto de auth do chamador —
      // inútil com service role, que não tem esse contexto. Aqui a org já veio do token.
      const { data } = await admin
        .from('organizations')
        .select('modulos_habilitados')
        .eq('id', orgId)
        .maybeSingle()
      const modulos = (data as { modulos_habilitados: string[] | null } | null)?.modulos_habilitados
      return modulos ?? []
    },
  }
}
