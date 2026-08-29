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
import type { RepositorioCredenciais } from './credenciais.js'

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

/**
 * Repositório das credenciais e do estado do OAuth.
 *
 * Service role ignora RLS, então cada consulta filtra explicitamente pelo `org_id` já derivado do
 * token (D-15). Nenhum id daqui vem de payload.
 */
export function repositorioDoSupabase(admin: SupabaseClient): RepositorioCredenciais {
  return {
    async gravarEstado(e) {
      const { error } = await admin.from('joompulse_oauth_estados').insert({
        state: e.state,
        org_id: e.orgId,
        iniciado_por: e.iniciadoPor,
        code_verifier: e.codeVerifier,
        redirect_uri: e.redirectUri,
        expira_em: e.expiraEm.toISOString(),
      })
      if (error) throw new Error(`falha ao gravar estado do OAuth: ${error.code ?? 'erro'}`)
    },

    async lerEstado(state) {
      const { data } = await admin.from('joompulse_oauth_estados')
        .select('state, org_id, iniciado_por, code_verifier, redirect_uri, expira_em, usado_em')
        .eq('state', state).maybeSingle()
      if (!data) return null
      const l = data as Record<string, string | null>
      return {
        state: l.state as string,
        orgId: l.org_id as string,
        iniciadoPor: l.iniciado_por as string,
        codeVerifier: l.code_verifier as string,
        redirectUri: l.redirect_uri as string,
        expiraEm: new Date(l.expira_em as string),
        usadoEm: l.usado_em ? new Date(l.usado_em) : null,
      }
    },

    // UPDATE condicional, não leitura-e-escrita: duas requisições simultâneas com o mesmo state
    // precisam que exatamente uma vença. O `is('usado_em', null)` é quem garante isso.
    async marcarEstadoUsado(state) {
      const { data } = await admin.from('joompulse_oauth_estados')
        .update({ usado_em: new Date().toISOString() })
        .eq('state', state).is('usado_em', null)
        .select('state')
      return Array.isArray(data) && data.length === 1
    },

    async gravarCredencial(orgId, campos) {
      const { error } = await admin.from('joompulse_credenciais').upsert({
        org_id: orgId,
        access_token_cifrado: campos.accessTokenCifrado,
        refresh_token_cifrado: campos.refreshTokenCifrado,
        versao_chave: campos.versaoChave,
        expira_em: campos.expiraEm?.toISOString() ?? null,
        escopo: campos.escopo,
        conectado_por: campos.conectadoPor,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'org_id' })
      if (error) throw new Error(`falha ao gravar credencial: ${error.code ?? 'erro'}`)
    },

    async lerCredencial(orgId) {
      const { data } = await admin.from('joompulse_credenciais')
        .select('access_token_cifrado, refresh_token_cifrado, versao_chave, expira_em, escopo')
        .eq('org_id', orgId).maybeSingle()
      if (!data) return null
      const l = data as Record<string, string | number | null>
      return {
        accessTokenCifrado: l.access_token_cifrado as string,
        refreshTokenCifrado: (l.refresh_token_cifrado as string | null) ?? null,
        versaoChave: l.versao_chave as number,
        expiraEm: l.expira_em ? new Date(l.expira_em as string) : null,
        escopo: (l.escopo as string | null) ?? null,
      }
    },

    async apagarCredencial(orgId) {
      const { error } = await admin.from('joompulse_credenciais').delete().eq('org_id', orgId)
      if (error) throw new Error(`falha ao apagar credencial: ${error.code ?? 'erro'}`)
    },
  }
}
