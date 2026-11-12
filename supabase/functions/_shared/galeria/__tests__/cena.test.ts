// Corte (R9.1) e corpo das chamadas ao gerador. Sem rede.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => { throw new Error('sem rede') } }))
import { cenaUtil, planejarCorte } from '../corte'
import { corpoOpenRouter } from '../prompt'
import { corpoHF, MODELOS_GALERIA } from '../provedores'

describe('corte', () => {
  it('quadrada: missão interna corta >15% → inútil; capa preenche com branco', () => {
    expect(cenaUtil(2, 1024, 1024)).toBe(false)
    expect(cenaUtil(1, 1024, 1024)).toBe(true)
    expect(planejarCorte(1024, 1024, true).modo).toBe('preenchimento')
    expect(planejarCorte(1024, 1024, false).modo).toBe('bloqueado')
  })
  it('3:4 corta pouco ao centro, nunca estica', () => {
    const p = planejarCorte(896, 1200, false)
    expect(p.modo).toBe('corte')
    if (p.modo !== 'corte') return
    expect(p.perda).toBeLessThan(0.15)
    expect(p.largura).toBe(896)
    expect(p.altura / p.largura).toBeCloseTo(1540 / 1200, 2)
    expect(p.y).toBe(Math.round((1200 - p.altura) / 2))
    expect(cenaUtil(3, 896, 1200)).toBe(true)
  })
  it('4:5 em 2K (1856×2304, medido em 12/11) serve: corte lateral de ~3,3%', () => {
    expect(cenaUtil(2, 1856, 2304)).toBe(true)
    const p = planejarCorte(1856, 2304, false)
    expect(p.modo).toBe('corte')
    expect(p.perda).toBeCloseTo(0.033, 2)
  })
  it('dimensão inválida → bloqueado', () => {
    expect(planejarCorte(0, 100, true).modo).toBe('bloqueado')
  })
})

describe('corpo das chamadas pede 3:4', () => {
  it('OpenRouter: image_config.aspect_ratio 3:4 e referência como image_url', () => {
    const c = corpoOpenRouter('google/gemini-nano-banana-2.1', 'P', ['https://signed/ref.jpg']) as Record<string, any>
    expect(c.image_config).toEqual({ aspect_ratio: '3:4' })
    expect(c.modalities).toEqual(['image', 'text'])
    expect(c.messages[0].content).toEqual([{ type: 'text', text: 'P' }, { type: 'image_url', image_url: { url: 'https://signed/ref.jpg' } }])
  })
  it('OpenRouter com formato e tamanho: 4:5 em 2K (ADR-0203)', () => {
    const c = corpoOpenRouter('google/gemini-nano-banana-2.1', 'P', [], { aspecto: '4:5', tamanho: '2K' }) as Record<string, any>
    expect(c.image_config).toEqual({ aspect_ratio: '4:5', image_size: '2K' })
  })
  it('Higgsfield: campo de proporção medido recebe 3:4 (todo modelo com proporção medida)', () => {
    const medidos = Object.values(MODELOS_GALERIA).filter((m) => m.provedor === 'higgsfield' && m.campoProporcao)
    expect(medidos.map((m) => m.slug)).toContain('xai/grok-imagine-image-2.0')
    for (const m of medidos) expect(corpoHF(m, 'P', ['https://signed/ref.jpg'])[m.campoProporcao!]).toBe('3:4')
  })
})
