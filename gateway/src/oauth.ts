// Fluxo OAuth com a JoomPulse (ADR-0132 D-5; Errata 2).
//
// Endpoints MEDIDOS no metadado do provedor em 2026-08-29
// (`https://joompulse.com/.well-known/oauth-authorization-server`), não presumidos:
//
//   authorization_endpoint          https://joompulse.com/oauth2/authorize
//   token_endpoint                  https://joompulse.com/noauth/oauth2/token
//   introspection_endpoint          https://joompulse.com/noauth/oauth2/introspect
//   grant_types_supported           authorization_code, refresh_token
//   code_challenge_methods_supported S256
//   scopes_supported                mcp
//
// O metadado NÃO anuncia `revocation_endpoint`. É a confirmação técnica da D-27 da ADR-0141: não
// existe revogação remota padronizada a chamar. O que existe é `introspect`, que permite DETECTAR
// uma credencial já inválida — detectar, não causar.
//
// PKCE é usado mesmo com client confidencial: protege o `code` em trânsito e o provedor suporta
// S256. `token_endpoint_auth_methods_supported` inclui `none`, então um client público (sem
// secret) também funciona — por isso o segredo aqui é opcional.

import { createHash } from 'node:crypto'
import { segredoUrlSafe } from './cripto.js'

export const AUTORIZACAO_URL = 'https://joompulse.com/oauth2/authorize'
export const TOKEN_URL = 'https://joompulse.com/noauth/oauth2/token'
export const INTROSPECT_URL = 'https://joompulse.com/noauth/oauth2/introspect'
export const ESCOPO = 'mcp'

/** Janela do `state`. Curta: é uma ida ao provedor e a volta, não uma sessão. */
export const VALIDADE_ESTADO_MS = 10 * 60 * 1000

export interface ClienteOAuth {
  clientId: string
  /** Ausente = client público; o provedor aceita `none` como método de auth no token endpoint. */
  clientSecret?: string
  redirectUri: string
}

export interface InicioOAuth {
  urlAutorizacao: string
  state: string
  codeVerifier: string
  expiraEm: Date
}

export function desafioS256(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url')
}

export function iniciar(cliente: ClienteOAuth, agora = new Date()): InicioOAuth {
  const state = segredoUrlSafe(32)
  const codeVerifier = segredoUrlSafe(32)

  const url = new URL(AUTORIZACAO_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', cliente.clientId)
  url.searchParams.set('redirect_uri', cliente.redirectUri)
  url.searchParams.set('scope', ESCOPO)
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', desafioS256(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')

  return {
    urlAutorizacao: url.toString(),
    state,
    codeVerifier,
    expiraEm: new Date(agora.getTime() + VALIDADE_ESTADO_MS),
  }
}

export interface TokensJoomPulse {
  accessToken: string
  refreshToken: string | null
  expiraEm: Date | null
  escopo: string | null
}

interface RespostaToken {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  scope?: unknown
}

/**
 * Valida a resposta do token endpoint antes de guardar qualquer coisa.
 * Sem isto, um provedor que mude o contrato faria o Gateway persistir `undefined` cifrado e só
 * descobrir o problema na primeira consulta — o mesmo erro de classe do "zero silencioso".
 */
export function lerRespostaToken(corpo: unknown, agora = new Date()): TokensJoomPulse {
  const c = corpo as RespostaToken | null
  if (!c || typeof c.access_token !== 'string' || c.access_token.length === 0) {
    throw new Error('resposta do token endpoint sem access_token')
  }
  const expiresIn = typeof c.expires_in === 'number' && Number.isFinite(c.expires_in) ? c.expires_in : null
  return {
    accessToken: c.access_token,
    refreshToken: typeof c.refresh_token === 'string' && c.refresh_token.length > 0 ? c.refresh_token : null,
    expiraEm: expiresIn === null ? null : new Date(agora.getTime() + expiresIn * 1000),
    escopo: typeof c.scope === 'string' ? c.scope : null,
  }
}

function corpoComAuth(cliente: ClienteOAuth, params: URLSearchParams): {
  corpo: URLSearchParams
  cabecalhos: Record<string, string>
} {
  const cabecalhos: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }
  params.set('client_id', cliente.clientId)
  if (cliente.clientSecret) {
    // client_secret_basic: mantém o segredo fora do corpo, que é o que costuma acabar em log.
    const basica = Buffer.from(`${cliente.clientId}:${cliente.clientSecret}`).toString('base64')
    cabecalhos.Authorization = `Basic ${basica}`
  }
  return { corpo: params, cabecalhos }
}

export type BuscarHttp = typeof fetch

/** Troca o `code` pelos tokens. `buscar` é injetável para o teste não tocar a rede. */
export async function trocarCodePorToken(
  cliente: ClienteOAuth,
  code: string,
  codeVerifier: string,
  buscar: BuscarHttp,
  agora = new Date(),
): Promise<TokensJoomPulse> {
  const { corpo, cabecalhos } = corpoComAuth(
    cliente,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cliente.redirectUri,
      code_verifier: codeVerifier,
    }),
  )
  const resp = await buscar(TOKEN_URL, { method: 'POST', headers: cabecalhos, body: corpo })
  if (!resp.ok) {
    // O corpo do erro pode ecoar o code; nunca entra na mensagem que sobe.
    throw new Error(`token endpoint respondeu ${resp.status}`)
  }
  return lerRespostaToken(await resp.json(), agora)
}

export async function renovarComRefresh(
  cliente: ClienteOAuth,
  refreshToken: string,
  buscar: BuscarHttp,
  agora = new Date(),
): Promise<TokensJoomPulse> {
  const { corpo, cabecalhos } = corpoComAuth(
    cliente,
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  )
  const resp = await buscar(TOKEN_URL, { method: 'POST', headers: cabecalhos, body: corpo })
  if (!resp.ok) throw new Error(`refresh respondeu ${resp.status}`)
  const tokens = lerRespostaToken(await resp.json(), agora)
  // Rotação de refresh não é garantida pelo provedor; quando ele não devolve um novo, o antigo
  // continua valendo e precisa ser preservado — descartá-lo desconectaria a org no próximo ciclo.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
}
