import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { MODULO } from '../src/autorizacao.js'
import { pedidoDe, tratar, type DepsRotas, type Pedido } from '../src/rotas.js'
import { decifrar } from '../src/cripto.js'
import type { EstadoOAuth, RepositorioCredenciais } from '../src/credenciais.js'

const AGORA = new Date('2026-08-29T12:00:00Z')
const CHAVE = randomBytes(32)

function repoEmMemoria(estadoInicial: EstadoOAuth | null = null) {
  const estados = new Map<string, EstadoOAuth>()
  if (estadoInicial) estados.set(estadoInicial.state, estadoInicial)
  const credenciais = new Map<string, Parameters<RepositorioCredenciais['gravarCredencial']>[1]>()

  const repo: RepositorioCredenciais = {
    gravarEstado: async (e) => { estados.set(e.state, { ...e, usadoEm: null }) },
    lerEstado: async (s) => estados.get(s) ?? null,
    marcarEstadoUsado: async (s) => {
      const e = estados.get(s)
      if (!e || e.usadoEm) return false
      estados.set(s, { ...e, usadoEm: new Date() })
      return true
    },
    gravarCredencial: async (org, campos) => { credenciais.set(org, campos) },
    lerCredencial: async (org) => {
      const c = credenciais.get(org)
      return c
        ? {
            accessTokenCifrado: c.accessTokenCifrado,
            refreshTokenCifrado: c.refreshTokenCifrado,
            versaoChave: c.versaoChave,
            expiraEm: c.expiraEm,
            escopo: c.escopo,
          }
        : null
    },
    apagarCredencial: async (org) => { credenciais.delete(org) },
  }
  return { repo, estados, credenciais }
}

function deps(over: Partial<DepsRotas> = {}): DepsRotas {
  const { repo } = repoEmMemoria()
  return {
    usuarioDoToken: async () => ({ id: 'u1' }),
    perfil: async () => ({ org_id: 'org1', is_active: true, is_admin: true }),
    modulosDaOrg: async () => [MODULO],
    versao: 'test',
    repo,
    cliente: {
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'https://gw.test/v1/oauth/callback',
    },
    chaveCredencial: CHAVE,
    buscar: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    urlAppCanais: 'https://app.test/canais',
    agora: () => AGORA,
    ...over,
  }
}

const pedir = (metodo: string, caminho: string, opts: Partial<Pedido> = {}): Pedido => ({
  metodo,
  caminho,
  query: new URLSearchParams(),
  headerAutorizacao: 'Bearer t',
  ...opts,
})

describe('/v1/sessao', () => {
  it('reporta conectado=false quando a org nunca conectou', async () => {
    const r = await tratar(pedir('GET', '/v1/sessao'), deps())
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ org_id: 'org1', conectado: false })
  })

  it('reporta conectado=true depois de gravada a credencial', async () => {
    const { repo } = repoEmMemoria()
    await repo.gravarCredencial('org1', {
      accessTokenCifrado: 'x', refreshTokenCifrado: null, versaoChave: 1,
      expiraEm: new Date('2026-08-29T13:00:00Z'), escopo: 'mcp', conectadoPor: 'u1',
    })
    const r = await tratar(pedir('GET', '/v1/sessao'), deps({ repo }))
    expect(r.corpo).toMatchObject({ conectado: true, expira_em: '2026-08-29T13:00:00.000Z' })
  })
})

describe('/v1/oauth/iniciar', () => {
  it('devolve a URL de autorização e guarda o estado no servidor', async () => {
    const { repo, estados } = repoEmMemoria()
    const r = await tratar(pedir('POST', '/v1/oauth/iniciar'), deps({ repo }))
    expect(r.status).toBe(200)

    const corpo = r.corpo as { url_autorizacao: string }
    const state = new URL(corpo.url_autorizacao).searchParams.get('state')!
    const guardado = estados.get(state)!
    expect(guardado.orgId).toBe('org1')
    // O verifier fica só no servidor — é o que o PKCE protege.
    expect(corpo.url_autorizacao).not.toContain(guardado.codeVerifier)
  })

  // D-5: conectar é ato de admin da organização.
  it('recusa membro não-admin', async () => {
    const r = await tratar(pedir('POST', '/v1/oauth/iniciar'),
      deps({ perfil: async () => ({ org_id: 'org1', is_active: true, is_admin: false }) }))
    expect(r.status).toBe(403)
    expect(r.corpo).toMatchObject({ erro: { codigo: 'somente_admin' } })
  })

  it('recusa GET e exige token', async () => {
    expect((await tratar(pedir('GET', '/v1/oauth/iniciar'), deps())).status).toBe(405)
    const semToken = await tratar(pedir('POST', '/v1/oauth/iniciar', { headerAutorizacao: null }), deps())
    expect(semToken.status).toBe(401)
  })
})

describe('/v1/oauth/callback', () => {
  const estado: EstadoOAuth = {
    state: 'st-1', orgId: 'org1', iniciadoPor: 'u1', codeVerifier: 'verif',
    redirectUri: 'https://gw.test/v1/oauth/callback',
    expiraEm: new Date(AGORA.getTime() + 60_000), usadoEm: null,
  }

  const tokenOk = () => vi.fn(async () => new Response(
    JSON.stringify({ access_token: 'ACCESS', refresh_token: 'REFRESH', expires_in: 3600, scope: 'mcp' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }))

  it('troca o code, grava a credencial CIFRADA e devolve o browser ao app', async () => {
    const { repo, credenciais } = repoEmMemoria(estado)
    const buscar = tokenOk()
    const r = await tratar(
      pedir('GET', '/v1/oauth/callback', {
        query: new URLSearchParams({ code: 'c1', state: 'st-1' }),
        headerAutorizacao: null, // o callback chega SEM o JWT do usuário
      }),
      deps({ repo, buscar: buscar as unknown as typeof fetch }))

    expect(r.status).toBe(302)
    expect(r.redirecionarPara).toBe('https://app.test/canais?joompulse=conectado')

    const gravada = credenciais.get('org1')!
    expect(gravada.accessTokenCifrado).not.toContain('ACCESS')
    expect(decifrar(gravada.accessTokenCifrado, CHAVE)).toBe('ACCESS')
    expect(decifrar(gravada.refreshTokenCifrado!, CHAVE)).toBe('REFRESH')
    expect(gravada.conectadoPor).toBe('u1')
  })

  it('recusa replay do mesmo state', async () => {
    const { repo } = repoEmMemoria(estado)
    const d = deps({ repo, buscar: tokenOk() as unknown as typeof fetch })
    const q = () => new URLSearchParams({ code: 'c1', state: 'st-1' })

    const primeira = await tratar(pedir('GET', '/v1/oauth/callback', { query: q(), headerAutorizacao: null }), d)
    expect(primeira.redirecionarPara).toContain('joompulse=conectado')

    const segunda = await tratar(pedir('GET', '/v1/oauth/callback', { query: q(), headerAutorizacao: null }), d)
    expect(segunda.redirecionarPara).toContain('joompulse=estado_ja_usado')
  })

  it('recusa state desconhecido e expirado sem chamar o provedor', async () => {
    const buscar = vi.fn()
    const { repo } = repoEmMemoria(estado)
    const d = deps({ repo, buscar: buscar as unknown as typeof fetch })

    const desconhecido = await tratar(
      pedir('GET', '/v1/oauth/callback', {
        query: new URLSearchParams({ code: 'c', state: 'outro' }), headerAutorizacao: null }), d)
    expect(desconhecido.redirecionarPara).toContain('estado_desconhecido')

    const expirado = await tratar(
      pedir('GET', '/v1/oauth/callback', {
        query: new URLSearchParams({ code: 'c', state: 'st-1' }), headerAutorizacao: null }),
      deps({ repo: repoEmMemoria(estado).repo, buscar: buscar as unknown as typeof fetch,
        agora: () => new Date(AGORA.getTime() + 61_000) }))
    expect(expirado.redirecionarPara).toContain('estado_expirado')

    expect(buscar).not.toHaveBeenCalled()
  })

  it('trata recusa do usuário no provedor e ausência de code', async () => {
    const { repo } = repoEmMemoria(estado)
    const recusado = await tratar(pedir('GET', '/v1/oauth/callback', {
      query: new URLSearchParams({ error: 'access_denied' }), headerAutorizacao: null }), deps({ repo }))
    expect(recusado.redirecionarPara).toContain('joompulse=recusado')

    const semCode = await tratar(pedir('GET', '/v1/oauth/callback', {
      query: new URLSearchParams({ state: 'st-1' }), headerAutorizacao: null }), deps({ repo }))
    expect(semCode.redirecionarPara).toContain('joompulse=sem_code')
  })

  it('falha na troca não grava credencial e não vaza o erro na URL', async () => {
    const { repo, credenciais } = repoEmMemoria(estado)
    const buscar = vi.fn(async () => new Response('code=SEGREDO', { status: 400 }))
    const r = await tratar(pedir('GET', '/v1/oauth/callback', {
      query: new URLSearchParams({ code: 'c1', state: 'st-1' }), headerAutorizacao: null }),
      deps({ repo, buscar: buscar as unknown as typeof fetch }))

    expect(r.redirecionarPara).toBe('https://app.test/canais?joompulse=falha_troca')
    expect(r.redirecionarPara).not.toContain('SEGREDO')
    expect(credenciais.size).toBe(0)
  })
})

describe('/v1/oauth/conexao', () => {
  it('admin desconecta e o Gateway não finge ter revogado no provedor', async () => {
    const { repo, credenciais } = repoEmMemoria()
    await repo.gravarCredencial('org1', {
      accessTokenCifrado: 'x', refreshTokenCifrado: null, versaoChave: 1,
      expiraEm: null, escopo: null, conectadoPor: 'u1',
    })
    const r = await tratar(pedir('DELETE', '/v1/oauth/conexao'), deps({ repo }))
    expect(r.status).toBe(200)
    // D-27: não há revocation_endpoint no metadado do provedor. Dizer o contrário seria mentir.
    expect(r.corpo).toEqual({ desconectado: true, revogado_no_provedor: false })
    expect(credenciais.size).toBe(0)
  })

  it('recusa não-admin', async () => {
    const r = await tratar(pedir('DELETE', '/v1/oauth/conexao'),
      deps({ perfil: async () => ({ org_id: 'org1', is_active: true, is_admin: false }) }))
    expect(r.status).toBe(403)
  })
})

describe('pedidoDe', () => {
  it('separa caminho e query da url relativa do node:http', () => {
    const p = pedidoDe({
      url: '/v1/oauth/callback?code=abc&state=xyz',
      method: 'GET',
      headers: { authorization: 'Bearer t' },
    } as never)
    expect(p.caminho).toBe('/v1/oauth/callback')
    expect(p.query.get('code')).toBe('abc')
    expect(p.metodo).toBe('GET')
  })
})
