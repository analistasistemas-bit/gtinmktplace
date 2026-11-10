import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as jpeg from 'jpeg-js'
import { validarArquivoFinal } from '../arquivo-final'
import { PESO_MAXIMO_FINAL } from '../corte'

// Task 12 (R9.1): o arquivo final é conferido de novo no servidor — JPEG, 1200×1540, ≤1 MB e não branco.
const jpegDe = (w: number, h: number, cor: (i: number) => number) => {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) { const c = cor(i); data.set([c, c, c, 255], i * 4) }
  return new Uint8Array(jpeg.encode({ width: w, height: h, data }, 90).data)
}
const real = () => new Uint8Array(readFileSync('supabase/functions/_shared/galeria/__tests__/fixtures/final-real.jpg'))

describe('validarArquivoFinal', () => {
  it('PNG → formato', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    expect(validarArquivoFinal(png)).toEqual(['formato'])
  })

  it('JPEG corrompido → formato', () => {
    expect(validarArquivoFinal(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]))).toEqual(['formato'])
  })

  it('1200×1200 → dimensoes', () => {
    expect(validarArquivoFinal(jpegDe(1200, 1200, (i) => (i % 1200) >> 3))).toEqual(['dimensoes'])
  })

  it('2 MB → peso (sem decodificar)', () => {
    const b = new Uint8Array(2 * 1024 * 1024); b.set([0xff, 0xd8, 0xff, 0xe0])
    expect(validarArquivoFinal(b)).toEqual(['peso'])
    expect(PESO_MAXIMO_FINAL).toBe(1_000_000)
  })

  it('JPEG 1200×1540 todo branco → branca', () => {
    expect(validarArquivoFinal(jpegDe(1200, 1540, () => 255))).toEqual(['branca'])
  })

  it('final real passa e decodifica em ≤800 ms de CPU', () => {
    const b = real()
    const antes = process.cpuUsage()
    const erros = validarArquivoFinal(b)
    const d = process.cpuUsage(antes)
    const ms = (d.user + d.system) / 1000
    console.info(`[arquivo-final] CPU da validação de ${b.length} bytes: ${ms.toFixed(0)} ms`)
    expect(erros).toEqual([])
    expect(ms).toBeLessThanOrEqual(800)
  })
})
