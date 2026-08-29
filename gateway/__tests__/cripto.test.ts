import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { chaveDaEnv, cifrar, decifrar, ErroCripto, iguaisEmTempoConstante, segredoUrlSafe } from '../src/cripto.js'

const chave = randomBytes(32)

describe('chaveDaEnv', () => {
  it('aceita 32 bytes em base64', () => {
    expect(chaveDaEnv(chave.toString('base64'))).toHaveLength(32)
  })

  // Chave ausente ou do tamanho errado NÃO pode degradar para "sem cifragem".
  it('falha alto quando ausente ou do tamanho errado', () => {
    expect(() => chaveDaEnv(undefined)).toThrow(ErroCripto)
    expect(() => chaveDaEnv(randomBytes(16).toString('base64'))).toThrow(/32 bytes/)
  })
})

describe('cifrar/decifrar', () => {
  it('ida e volta preserva o token', () => {
    const token = 'jp_access_' + segredoUrlSafe(24)
    expect(decifrar(cifrar(token, chave), chave)).toBe(token)
  })

  // IV aleatório por operação: dois envelopes do mesmo texto têm de diferir, senão o GCM quebra.
  it('nunca produz o mesmo envelope duas vezes', () => {
    expect(cifrar('mesmo-token', chave)).not.toBe(cifrar('mesmo-token', chave))
  })

  it('recusa envelope adulterado — é o motivo de usar GCM e não CBC', () => {
    const envelope = cifrar('token-secreto', chave)
    const bruto = Buffer.from(envelope, 'base64')
    bruto[bruto.length - 1] ^= 0xff // vira um bit do ciphertext
    expect(() => decifrar(bruto.toString('base64'), chave)).toThrow(ErroCripto)
  })

  it('recusa tag adulterada', () => {
    const bruto = Buffer.from(cifrar('token-secreto', chave), 'base64')
    bruto[12] ^= 0xff // primeiro byte da tag
    expect(() => decifrar(bruto.toString('base64'), chave)).toThrow(ErroCripto)
  })

  it('recusa chave errada', () => {
    expect(() => decifrar(cifrar('t', chave), randomBytes(32))).toThrow(ErroCripto)
  })

  it('recusa envelope curto demais', () => {
    expect(() => decifrar(Buffer.alloc(10).toString('base64'), chave)).toThrow(/curto/)
  })

  it('não vaza o texto puro na mensagem de erro', () => {
    try {
      decifrar(cifrar('TOKEN-ULTRA-SECRETO', chave), randomBytes(32))
      throw new Error('deveria ter falhado')
    } catch (e) {
      expect((e as Error).message).not.toContain('TOKEN-ULTRA-SECRETO')
    }
  })
})

describe('iguaisEmTempoConstante', () => {
  it('compara sem vazar por tamanho diferente', () => {
    expect(iguaisEmTempoConstante('abc', 'abc')).toBe(true)
    expect(iguaisEmTempoConstante('abc', 'abd')).toBe(false)
    expect(iguaisEmTempoConstante('abc', 'abcd')).toBe(false)
    expect(iguaisEmTempoConstante('', '')).toBe(true)
  })
})

describe('segredoUrlSafe', () => {
  it('é url-safe e não se repete', () => {
    const s = segredoUrlSafe()
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(s).not.toBe(segredoUrlSafe())
  })
})
