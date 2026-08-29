import { randomBytes, createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  AUTORIZACAO_URL, ESCOPO, desafioS256, iniciar, lerRespostaToken,
  renovarComRefresh, trocarCodePorToken, type ClienteOAuth,
} from '../src/oauth.js'
import {
  carregarCredencial, consumirEstado, precisaRenovar, salvarCredencial,
  type EstadoOAuth, type RepositorioCredenciais,
} from '../src/credenciais.js'

const cliente: ClienteOAuth = {
  clientId: 'publiai-gateway',
  clientSecret: 'segredo',
  redirectUri: 'https://gw.publiai.com.br/v1/oauth/callback',
}

const AGORA = new Date('2026-08-29T12:00:00Z')

describe('iniciar', () => {
  it('monta a URL de autorização com PKCE S256 e escopo mcp', () => {
    const i = iniciar(cliente, AGORA)
    const u = new URL(i.urlAutorizacao)
    expect(`${u.origin}${u.pathname}`).toBe(AUTORIZACAO_URL)
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('client_id')).toBe('publiai-gateway')
    expect(u.searchParams.get('scope')).toBe(ESCOPO)
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBe(desafioS256(i.codeVerifier))
  })

  // O verifier NUNCA pode ir junto na URL: ele é o segredo que o challenge protege.
  it('não expõe o code_verifier na URL', () => {
    const i = iniciar(cliente, AGORA)
    expect(i.urlAutorizacao).not.toContain(i.codeVerifier)
  })

  it('gera state e verifier novos a cada chamada', () => {
    const a = iniciar(cliente, AGORA)
    const b = iniciar(cliente, AGORA)
    expect(a.state).not.toBe(b.state)
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
  })

  it('o desafio S256 confere com o cálculo do provedor', () => {
    const v = 'verifier-de-teste'
    expect(desafioS256(v)).toBe(createHash('sha256').update(v).digest('base64url'))
  })
})

describe('lerRespostaToken', () => {
  it('lê access, refresh, expiração e escopo', () => {
    const t = lerRespostaToken(
      { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'mcp' }, AGORA)
    expect(t.accessToken).toBe('a')
    expect(t.refreshToken).toBe('r')
    expect(t.expiraEm?.toISOString()).toBe('2026-08-29T13:00:00.000Z')
    expect(t.escopo).toBe('mcp')
  })

  // Mesma classe do "zero silencioso": contrato mudou, não se persiste undefined cifrado.
  it('recusa resposta sem access_token', () => {
    expect(() => lerRespostaToken({}, AGORA)).toThrow(/sem access_token/)
    expect(() => lerRespostaToken({ access_token: '' }, AGORA)).toThrow()
    expect(() => lerRespostaToken(null, AGORA)).toThrow()
    expect(() => lerRespostaToken({ access_token: 123 }, AGORA)).toThrow()
  })

  it('trata expires_in ausente ou inválido como sem expiração conhecida', () => {
    expect(lerRespostaToken({ access_token: 'a' }, AGORA).expiraEm).toBeNull()
    expect(lerRespostaToken({ access_token: 'a', expires_in: 'x' }, AGORA).expiraEm).toBeNull()
  })
})

describe('trocarCodePorToken', () => {
  it('envia code_verifier e usa Basic com o segredo do cliente', async () => {
    const buscar = vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 60 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await trocarCodePorToken(cliente, 'o-code', 'o-verifier', buscar as unknown as typeof fetch, AGORA)

    const [, init] = buscar.mock.calls[0] as unknown as [string, RequestInit]
    const corpo = init.body as URLSearchParams
    expect(corpo.get('grant_type')).toBe('authorization_code')
    expect(corpo.get('code_verifier')).toBe('o-verifier')
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /)
    // O segredo vai no header, não no corpo — corpo é o que costuma acabar em log.
    expect(corpo.get('client_secret')).toBeNull()
  })

  it('não repete o corpo de erro do provedor na exceção', async () => {
    const buscar = vi.fn(async () => new Response('code=SEGREDO-VAZADO', { status: 400 }))
    await expect(trocarCodePorToken(cliente, 'c', 'v', buscar as unknown as typeof fetch, AGORA))
      .rejects.toThrow(/^token endpoint respondeu 400$/)
  })
})

describe('renovarComRefresh', () => {
  // O provedor pode não rotacionar o refresh; descartar o antigo desconectaria a org.
  it('preserva o refresh antigo quando o provedor não devolve um novo', async () => {
    const buscar = vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'novo', expires_in: 60 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const t = await renovarComRefresh(cliente, 'refresh-antigo', buscar as unknown as typeof fetch, AGORA)
    expect(t.accessToken).toBe('novo')
    expect(t.refreshToken).toBe('refresh-antigo')
  })

  it('adota o refresh novo quando há rotação', async () => {
    const buscar = vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'novo', refresh_token: 'refresh-novo' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const t = await renovarComRefresh(cliente, 'antigo', buscar as unknown as typeof fetch, AGORA)
    expect(t.refreshToken).toBe('refresh-novo')
  })
})

// ---- estado do OAuth: é a única prova de identidade no callback ----

function repoFake(estado: EstadoOAuth | null) {
  let marcado = estado?.usadoEm ?? null
  const repo: RepositorioCredenciais = {
    gravarEstado: async () => {},
    lerEstado: async (s) => (estado && estado.state === s ? { ...estado, usadoEm: marcado } : null),
    marcarEstadoUsado: async () => {
      if (marcado) return false
      marcado = new Date()
      return true
    },
    gravarCredencial: async () => {},
    lerCredencial: async () => null,
    apagarCredencial: async () => {},
  }
  return repo
}

const estadoBase: EstadoOAuth = {
  state: 'st-123',
  orgId: 'org1',
  iniciadoPor: 'u1',
  codeVerifier: 'v',
  redirectUri: cliente.redirectUri,
  expiraEm: new Date(AGORA.getTime() + 60_000),
  usadoEm: null,
}

describe('consumirEstado', () => {
  it('aceita uma vez e recusa o replay', async () => {
    const repo = repoFake(estadoBase)
    expect((await consumirEstado('st-123', repo, AGORA)).ok).toBe(true)
    expect(await consumirEstado('st-123', repo, AGORA)).toEqual({ ok: false, motivo: 'ja_usado' })
  })

  it('recusa state desconhecido, vazio e expirado', async () => {
    const repo = repoFake(estadoBase)
    expect(await consumirEstado('outro', repo, AGORA)).toEqual({ ok: false, motivo: 'desconhecido' })
    expect(await consumirEstado('', repo, AGORA)).toEqual({ ok: false, motivo: 'desconhecido' })
    const depois = new Date(AGORA.getTime() + 61_000)
    expect(await consumirEstado('st-123', repoFake(estadoBase), depois))
      .toEqual({ ok: false, motivo: 'expirado' })
  })

  it('recusa quando o repositório devolve um state diferente do pedido', async () => {
    const frouxo: RepositorioCredenciais = {
      ...repoFake(estadoBase),
      lerEstado: async () => ({ ...estadoBase, state: 'st-OUTRO' }),
    }
    expect(await consumirEstado('st-123', frouxo, AGORA)).toEqual({ ok: false, motivo: 'nao_confere' })
  })
})

describe('credencial cifrada', () => {
  const chave = randomBytes(32)

  it('grava cifrado e lê em claro, sem token puro no que vai ao banco', async () => {
    let gravado: Record<string, unknown> = {}
    const repo: RepositorioCredenciais = {
      ...repoFake(null),
      gravarCredencial: async (_org, campos) => { gravado = campos as unknown as Record<string, unknown> },
      lerCredencial: async () => ({
        accessTokenCifrado: gravado.accessTokenCifrado as string,
        refreshTokenCifrado: gravado.refreshTokenCifrado as string | null,
        versaoChave: gravado.versaoChave as number,
        expiraEm: null,
        escopo: 'mcp',
      }),
    }

    await salvarCredencial('org1', 'u1',
      { accessToken: 'ACCESS-PURO', refreshToken: 'REFRESH-PURO', expiraEm: null, escopo: 'mcp' },
      chave, repo)

    expect(JSON.stringify(gravado)).not.toContain('ACCESS-PURO')
    expect(JSON.stringify(gravado)).not.toContain('REFRESH-PURO')

    const lida = await carregarCredencial('org1', chave, repo)
    expect(lida?.accessToken).toBe('ACCESS-PURO')
    expect(lida?.refreshToken).toBe('REFRESH-PURO')
  })

  it('recusa credencial de outra versão de chave em vez de decifrar errado', async () => {
    const repo: RepositorioCredenciais = {
      ...repoFake(null),
      lerCredencial: async () => ({
        accessTokenCifrado: 'x', refreshTokenCifrado: null, versaoChave: 99, expiraEm: null, escopo: null,
      }),
    }
    await expect(carregarCredencial('org1', chave, repo)).rejects.toThrow(/versão de chave 99/)
  })

  it('devolve null quando a org não conectou', async () => {
    expect(await carregarCredencial('org1', chave, repoFake(null))).toBeNull()
  })
})

describe('precisaRenovar', () => {
  it('renova dentro da margem e nunca quando não há expiração', () => {
    expect(precisaRenovar(new Date(AGORA.getTime() + 30_000), AGORA)).toBe(true)
    expect(precisaRenovar(new Date(AGORA.getTime() + 120_000), AGORA)).toBe(false)
    expect(precisaRenovar(new Date(AGORA.getTime() - 1), AGORA)).toBe(true)
    expect(precisaRenovar(null, AGORA)).toBe(false)
  })
})
