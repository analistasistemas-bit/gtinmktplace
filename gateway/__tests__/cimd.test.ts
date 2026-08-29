import { describe, expect, it } from 'vitest'
import { CAMINHO_CIMD, cimdCoerente, documentoCimd, ehCimd } from '../src/cimd.js'
import { tratar, type DepsRotas, type Pedido } from '../src/rotas.js'
import { MODULO } from '../src/autorizacao.js'
import type { RepositorioCredenciais } from '../src/credenciais.js'

const CLIENT_ID = `https://gw.publiai.com.br${CAMINHO_CIMD}`
const REDIRECT = 'https://gw.publiai.com.br/v1/oauth/callback'

const repoVazio: RepositorioCredenciais = {
  gravarEstado: async () => {},
  lerEstado: async () => null,
  marcarEstadoUsado: async () => false,
  gravarCredencial: async () => {},
  lerCredencial: async () => null,
  apagarCredencial: async () => {},
}

function deps(over: Partial<DepsRotas> = {}): DepsRotas {
  return {
    usuarioDoToken: async () => ({ id: 'u1' }),
    perfil: async () => ({ org_id: 'org1', is_active: true, is_admin: true }),
    modulosDaOrg: async () => [MODULO],
    versao: 'test',
    repo: repoVazio,
    cliente: { clientId: CLIENT_ID, redirectUri: REDIRECT },
    chaveCredencial: Buffer.alloc(32),
    buscar: (async () => new Response('{}')) as unknown as typeof fetch,
    urlAppCanais: 'https://app.test/canais',
    ...over,
  }
}

const pedir = (metodo: string, caminho: string): Pedido => ({
  metodo, caminho, query: new URLSearchParams(), headerAutorizacao: null,
})

describe('ehCimd', () => {
  it('reconhece client_id em forma de URL https', () => {
    expect(ehCimd(CLIENT_ID)).toBe(true)
    expect(ehCimd('cliente-opaco-registrado')).toBe(false)
    expect(ehCimd('http://inseguro/doc.json')).toBe(false)
  })
})

describe('cimdCoerente', () => {
  // A especificação exige que o client_id do documento seja idêntico à URL que o serviu.
  // Um client_id https apontando para outro caminho jamais funcionaria.
  it('aceita a URL que aponta para o caminho publicado', () => {
    expect(cimdCoerente(CLIENT_ID)).toBe(true)
  })

  it('recusa URL https que aponta para outro caminho', () => {
    expect(cimdCoerente('https://gw.publiai.com.br/outro.json')).toBe(false)
    expect(cimdCoerente('https://gw.publiai.com.br/')).toBe(false)
  })

  it('não interfere no modo de client_id opaco registrado', () => {
    expect(cimdCoerente('id-emitido-pela-joompulse')).toBe(true)
  })

  it('recusa URL malformada', () => {
    expect(cimdCoerente('https://')).toBe(false)
  })
})

describe('documentoCimd', () => {
  it('declara o client_id idêntico à URL de publicação', () => {
    const d = documentoCimd({ clientId: CLIENT_ID, redirectUri: REDIRECT, temSecret: false })
    expect(d.client_id).toBe(CLIENT_ID)
  })

  it('lista apenas o redirect configurado', () => {
    const d = documentoCimd({ clientId: CLIENT_ID, redirectUri: REDIRECT, temSecret: false })
    expect(d.redirect_uris).toEqual([REDIRECT])
  })

  // Exatamente os grants que a JoomPulse anuncia — pedir mais seria pedir o que ela não dá.
  it('pede só os grants que o provedor suporta, e escopo mcp', () => {
    const d = documentoCimd({ clientId: CLIENT_ID, redirectUri: REDIRECT, temSecret: false })
    expect(d.grant_types).toEqual(['authorization_code', 'refresh_token'])
    expect(d.response_types).toEqual(['code'])
    expect(d.scope).toBe('mcp')
  })

  it('escolhe o método de auth conforme haja ou não secret', () => {
    expect(documentoCimd({ clientId: CLIENT_ID, redirectUri: REDIRECT, temSecret: false })
      .token_endpoint_auth_method).toBe('none')
    expect(documentoCimd({ clientId: CLIENT_ID, redirectUri: REDIRECT, temSecret: true })
      .token_endpoint_auth_method).toBe('client_secret_basic')
  })

  it('omite client_uri quando não informado', () => {
    const d = documentoCimd({ clientId: CLIENT_ID, redirectUri: REDIRECT, temSecret: false })
    expect(d.client_uri).toBeUndefined()
    const comApp = documentoCimd({
      clientId: CLIENT_ID, redirectUri: REDIRECT, temSecret: false, uriApp: 'https://app.test' })
    expect(comApp.client_uri).toBe('https://app.test')
  })

  // Nada de segredo entra num documento que é público por construção.
  it('nunca inclui segredo nem chave', () => {
    const bruto = JSON.stringify(documentoCimd({
      clientId: CLIENT_ID, redirectUri: REDIRECT, temSecret: true }))
    expect(bruto).not.toMatch(/secret["']?\s*:\s*["'][^"']/i)
    expect(bruto).not.toContain('client_secret"')
  })
})

describe(`GET ${CAMINHO_CIMD}`, () => {
  // O servidor de autorização busca este documento server-to-server, antes de qualquer usuário
  // existir. Exigir token aqui quebraria o fluxo inteiro.
  it('é público — responde 200 sem token', async () => {
    const r = await tratar(pedir('GET', CAMINHO_CIMD), deps())
    expect(r.status).toBe(200)
    expect(r.corpo).toMatchObject({ client_id: CLIENT_ID, scope: 'mcp' })
  })

  it('reflete o secret configurado no método de auth', async () => {
    const r = await tratar(pedir('GET', CAMINHO_CIMD),
      deps({ cliente: { clientId: CLIENT_ID, redirectUri: REDIRECT, clientSecret: 's' } }))
    expect(r.corpo).toMatchObject({ token_endpoint_auth_method: 'client_secret_basic' })
  })

  it('não responde a POST', async () => {
    expect((await tratar(pedir('POST', CAMINHO_CIMD), deps())).status).toBe(404)
  })
})
