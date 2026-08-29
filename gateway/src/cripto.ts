// Cifragem das credenciais da JoomPulse (ADR-0132 D-15; Errata 1).
//
// AES-256-GCM. GCM e não CBC porque autentica: um ciphertext adulterado falha ao abrir em vez de
// devolver lixo que o resto do código trataria como token.
//
// A chave vive na env do Web Service e NUNCA no banco. Um dump do Postgres, sozinho, não dá acesso
// à JoomPulse — é o ponto de guardar cifrado em vez de confiar só na RLS.
//
// Envelope: base64( iv[12] || tag[16] || ciphertext ). O IV é aleatório por operação; repetir IV
// com a mesma chave quebra o GCM por completo, então ele nunca é derivado nem reaproveitado.

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGORITMO = 'aes-256-gcm'
const TAM_IV = 12
const TAM_TAG = 16
const TAM_CHAVE = 32

export class ErroCripto extends Error {}

/** Lê a chave de 32 bytes em base64. Falha alto: chave errada não pode virar "sem cifragem". */
export function chaveDaEnv(valor: string | undefined): Buffer {
  if (!valor) throw new ErroCripto('CREDENCIAL_CHAVE_BASE64 ausente')
  let bruta: Buffer
  try {
    bruta = Buffer.from(valor, 'base64')
  } catch {
    throw new ErroCripto('CREDENCIAL_CHAVE_BASE64 não é base64 válido')
  }
  if (bruta.length !== TAM_CHAVE) {
    throw new ErroCripto(`CREDENCIAL_CHAVE_BASE64 precisa ter ${TAM_CHAVE} bytes, tem ${bruta.length}`)
  }
  return bruta
}

export function cifrar(textoPuro: string, chave: Buffer): string {
  const iv = randomBytes(TAM_IV)
  const cipher = createCipheriv(ALGORITMO, chave, iv)
  const ct = Buffer.concat([cipher.update(textoPuro, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

export function decifrar(envelope: string, chave: Buffer): string {
  const bruto = Buffer.from(envelope, 'base64')
  if (bruto.length <= TAM_IV + TAM_TAG) throw new ErroCripto('envelope curto demais')

  const iv = bruto.subarray(0, TAM_IV)
  const tag = bruto.subarray(TAM_IV, TAM_IV + TAM_TAG)
  const ct = bruto.subarray(TAM_IV + TAM_TAG)

  const decipher = createDecipheriv(ALGORITMO, chave, iv)
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    // Mensagem genérica de propósito: distinguir "tag inválida" de "chave errada" é oráculo.
    throw new ErroCripto('não foi possível decifrar a credencial')
  }
}

/**
 * Comparação de `state` do OAuth em tempo constante. O state é segredo de uso único e a comparação
 * ingênua vaza, por tempo, quantos caracteres iniciais o atacante acertou.
 */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Segredo aleatório url-safe, para `state` e `code_verifier`. */
export function segredoUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}
