import { describe, expect, it } from 'vitest'
import { autorizar, extrairToken, statusDe, MODULO, type DepsAutorizacao } from '../src/autorizacao.js'
import { cabecalhosCors, origemPermitida, origensDaEnv } from '../src/cors.js'

const OK: DepsAutorizacao = {
  usuarioDoToken: async () => ({ id: 'u1' }),
  perfil: async () => ({ org_id: 'org1', is_active: true, is_admin: false }),
  modulosDaOrg: async () => [MODULO],
}

const deps = (over: Partial<DepsAutorizacao> = {}): DepsAutorizacao => ({ ...OK, ...over })

describe('extrairToken', () => {
  it('aceita Bearer e devolve o token', () => {
    expect(extrairToken('Bearer abc.def')).toBe('abc.def')
  })

  it('recusa header ausente, esquema errado e Bearer vazio', () => {
    expect(extrairToken(null)).toBeNull()
    expect(extrairToken('Basic abc')).toBeNull()
    expect(extrairToken('Bearer   ')).toBeNull()
  })
})

describe('autorizar', () => {
  it('autoriza e deriva org do perfil, nunca do payload', async () => {
    const r = await autorizar('Bearer t', deps())
    expect(r).toEqual({ ok: true, chamador: { userId: 'u1', orgId: 'org1', isAdmin: false } })
  })

  it('recusa sem token e com token inválido', async () => {
    expect(await autorizar(null, deps())).toEqual({ ok: false, motivo: 'sem_token' })
    expect(await autorizar('Bearer t', deps({ usuarioDoToken: async () => null })))
      .toEqual({ ok: false, motivo: 'token_invalido' })
  })

  it('recusa perfil ausente, inativo e sem org', async () => {
    expect(await autorizar('Bearer t', deps({ perfil: async () => null })))
      .toEqual({ ok: false, motivo: 'perfil_ausente' })
    expect(await autorizar('Bearer t', deps({ perfil: async () => ({ org_id: 'o', is_active: false, is_admin: false }) })))
      .toEqual({ ok: false, motivo: 'perfil_inativo' })
    expect(await autorizar('Bearer t', deps({ perfil: async () => ({ org_id: null, is_active: true, is_admin: false }) })))
      .toEqual({ ok: false, motivo: 'sem_org' })
  })

  // `is_active` nulo não prova acesso: tratar como ativo abriria a porta para perfil migrado
  // cuja flag ainda não foi preenchida.
  it('trata is_active nulo como inativo', async () => {
    expect(await autorizar('Bearer t', deps({ perfil: async () => ({ org_id: 'o', is_active: null, is_admin: false }) })))
      .toEqual({ ok: false, motivo: 'perfil_inativo' })
  })

  it('recusa quando o módulo está desligado na org — o gate é server-side (D-4)', async () => {
    expect(await autorizar('Bearer t', deps({ modulosDaOrg: async () => ['pulse'] })))
      .toEqual({ ok: false, motivo: 'modulo_desligado' })
    expect(await autorizar('Bearer t', deps({ modulosDaOrg: async () => [] })))
      .toEqual({ ok: false, motivo: 'modulo_desligado' })
  })

  // A ordem é regra, não acaso: token ruim não pode virar "módulo desligado", que mandaria o
  // operador procurar problema na configuração da organização.
  it('reporta token inválido antes de olhar módulo', async () => {
    const r = await autorizar('Bearer t', deps({
      usuarioDoToken: async () => null,
      modulosDaOrg: async () => { throw new Error('não deveria ser consultado') },
    }))
    expect(r).toEqual({ ok: false, motivo: 'token_invalido' })
  })
})

describe('statusDe', () => {
  it('401 para identidade, 403 para permissão', () => {
    expect(statusDe('sem_token')).toBe(401)
    expect(statusDe('token_invalido')).toBe(401)
    expect(statusDe('perfil_inativo')).toBe(403)
    expect(statusDe('modulo_desligado')).toBe(403)
  })
})

describe('cors', () => {
  it('só libera origem que está na allowlist', () => {
    const permitidas = ['https://app.publiai.com.br']
    expect(origemPermitida('https://app.publiai.com.br', permitidas)).toBe('https://app.publiai.com.br')
    expect(origemPermitida('https://evil.example', permitidas)).toBeNull()
    expect(origemPermitida(undefined, permitidas)).toBeNull()
  })

  it('nunca emite curinga e sempre varia por origem', () => {
    const h = cabecalhosCors('https://app.publiai.com.br')
    expect(h['Access-Control-Allow-Origin']).toBe('https://app.publiai.com.br')
    expect(Object.values(h)).not.toContain('*')
    expect(h.Vary).toBe('Origin')
    expect(cabecalhosCors(null)).toEqual({})
  })

  it('lê a allowlist da env ignorando espaços e vazios', () => {
    expect(origensDaEnv(' https://a.com , https://b.com ,, ')).toEqual(['https://a.com', 'https://b.com'])
    expect(origensDaEnv(undefined)).toEqual([])
  })
})
