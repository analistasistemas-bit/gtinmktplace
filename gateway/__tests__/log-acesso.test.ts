import { describe, expect, it } from 'vitest'
import { formatarAcesso, resumirAgente } from '../src/log-acesso.js'

describe('formatarAcesso', () => {
  it('registra método, caminho, status e duração', () => {
    expect(formatarAcesso({
      metodo: 'GET', caminho: '/v1/client-metadata.json', status: 200, duracaoMs: 12, agente: null,
    })).toBe('[gateway] GET /v1/client-metadata.json 200 12ms')
  })

  it('inclui o user-agent, que é o que distingue o provedor de um browser', () => {
    const linha = formatarAcesso({
      metodo: 'GET', caminho: '/v1/client-metadata.json', status: 200, duracaoMs: 8,
      agente: 'JoomPulse-OAuth/1.0',
    })
    expect(linha).toContain('ua="JoomPulse-OAuth/1.0"')
  })
})

describe('resumirAgente', () => {
  it('corta agente muito longo e trata ausência', () => {
    expect(resumirAgente(undefined)).toBeNull()
    expect(resumirAgente('curto')).toBe('curto')
    const longo = resumirAgente('x'.repeat(200))!
    expect(longo.length).toBeLessThanOrEqual(81)
    expect(longo.endsWith('…')).toBe(true)
  })
})

// A trava que importa: a query carrega `code` e `state`, e um redirect de erro do provedor pode
// carregar pedaço de credencial. Nada disso pode entrar no log.
describe('o log nunca vaza segredo', () => {
  it('não tem como registrar query string — o formatador só aceita o caminho', () => {
    const linha = formatarAcesso({
      metodo: 'GET',
      caminho: '/v1/oauth/callback',
      status: 302,
      duracaoMs: 40,
      agente: null,
    })
    expect(linha).not.toContain('?')
    expect(linha).not.toMatch(/code=|state=|token/i)
  })
})
