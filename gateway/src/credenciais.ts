// Persistência da credencial e do estado do OAuth (ADR-0132 D-5, D-15; Errata 1).
//
// A regra que este arquivo existe para garantir: o token só existe em texto puro dentro do
// processo, entre decifrar e usar. Entra cifrado no banco e sai cifrado do banco.
//
// As dependências de I/O entram por parâmetro para que a lógica de consumo do `state` — a parte
// que precisa ser à prova de replay — seja testável sem Postgres.

import { cifrar, decifrar, iguaisEmTempoConstante } from './cripto.js'

export const VERSAO_CHAVE_ATUAL = 1

export interface EstadoOAuth {
  state: string
  orgId: string
  iniciadoPor: string
  codeVerifier: string
  redirectUri: string
  expiraEm: Date
  usadoEm: Date | null
}

export interface CredencialSalva {
  accessToken: string
  refreshToken: string | null
  expiraEm: Date | null
  escopo: string | null
}

export interface RepositorioCredenciais {
  gravarEstado(e: Omit<EstadoOAuth, 'usadoEm'>): Promise<void>
  lerEstado(state: string): Promise<EstadoOAuth | null>
  /** Marca como usado SE ainda não estiver. Devolve false quando outra requisição chegou antes. */
  marcarEstadoUsado(state: string): Promise<boolean>
  gravarCredencial(orgId: string, campos: {
    accessTokenCifrado: string
    refreshTokenCifrado: string | null
    versaoChave: number
    expiraEm: Date | null
    escopo: string | null
    conectadoPor: string
  }): Promise<void>
  lerCredencial(orgId: string): Promise<{
    accessTokenCifrado: string
    refreshTokenCifrado: string | null
    versaoChave: number
    expiraEm: Date | null
    escopo: string | null
  } | null>
  apagarCredencial(orgId: string): Promise<void>
}

export type MotivoEstadoInvalido = 'desconhecido' | 'expirado' | 'ja_usado' | 'nao_confere'

export type ResultadoEstado =
  | { ok: true; estado: EstadoOAuth }
  | { ok: false; motivo: MotivoEstadoInvalido }

/**
 * Consome o `state` do callback. É a única prova de identidade nesse ponto — o redirect da
 * JoomPulse chega sem o JWT do usuário —, então as quatro recusas abaixo são todas obrigatórias.
 *
 * A marcação de uso é feita por UPDATE condicional no banco, não por leitura seguida de escrita:
 * duas requisições simultâneas com o mesmo state precisam que exatamente uma vença.
 */
export async function consumirEstado(
  state: string,
  repo: RepositorioCredenciais,
  agora = new Date(),
): Promise<ResultadoEstado> {
  if (!state) return { ok: false, motivo: 'desconhecido' }

  const estado = await repo.lerEstado(state)
  if (!estado) return { ok: false, motivo: 'desconhecido' }
  // Defesa contra um repositório que faça match frouxo (prefixo, case-insensitive).
  if (!iguaisEmTempoConstante(estado.state, state)) return { ok: false, motivo: 'nao_confere' }
  if (estado.usadoEm !== null) return { ok: false, motivo: 'ja_usado' }
  if (estado.expiraEm.getTime() <= agora.getTime()) return { ok: false, motivo: 'expirado' }

  const venceu = await repo.marcarEstadoUsado(state)
  if (!venceu) return { ok: false, motivo: 'ja_usado' }

  return { ok: true, estado }
}

export async function salvarCredencial(
  orgId: string,
  conectadoPor: string,
  tokens: CredencialSalva,
  chave: Buffer,
  repo: RepositorioCredenciais,
): Promise<void> {
  await repo.gravarCredencial(orgId, {
    accessTokenCifrado: cifrar(tokens.accessToken, chave),
    refreshTokenCifrado: tokens.refreshToken ? cifrar(tokens.refreshToken, chave) : null,
    versaoChave: VERSAO_CHAVE_ATUAL,
    expiraEm: tokens.expiraEm,
    escopo: tokens.escopo,
    conectadoPor,
  })
}

export async function carregarCredencial(
  orgId: string,
  chave: Buffer,
  repo: RepositorioCredenciais,
): Promise<CredencialSalva | null> {
  const linha = await repo.lerCredencial(orgId)
  if (!linha) return null
  if (linha.versaoChave !== VERSAO_CHAVE_ATUAL) {
    // Rotação de chave é trabalho consciente, não fallback silencioso: melhor falhar e pedir
    // reconexão do que decifrar com a chave errada e tratar o lixo como token.
    throw new Error(`credencial gravada com versão de chave ${linha.versaoChave}, atual é ${VERSAO_CHAVE_ATUAL}`)
  }
  return {
    accessToken: decifrar(linha.accessTokenCifrado, chave),
    refreshToken: linha.refreshTokenCifrado ? decifrar(linha.refreshTokenCifrado, chave) : null,
    expiraEm: linha.expiraEm,
    escopo: linha.escopo,
  }
}

/** Margem para não sair com um token que vence no meio da chamada seguinte. */
export const MARGEM_RENOVACAO_MS = 60_000

export function precisaRenovar(expiraEm: Date | null, agora = new Date()): boolean {
  if (!expiraEm) return false
  return expiraEm.getTime() - agora.getTime() <= MARGEM_RENOVACAO_MS
}
