// Lupa pela caixa do produto (plano 2026-11-11, teste 7 e ajustes v3 itens 3, 4 e 6): geometria pura.
import { describe, expect, it } from 'vitest'
import { comLupa, LADO_MINIMO, recortesLupa, situacaoLupa, type DetalhesLupa, type Quadrado } from '../lupa'

const W = 1200
const H = 1200
const dentro = (q: Quadrado, p: { x: number; y: number; w: number; h: number }, w = W, h = H) =>
  q.x >= p.x * w - 1e-9 && q.y >= p.y * h - 1e-9 && q.x + q.w <= (p.x + p.w) * w + 1e-9 && q.y + q.h <= (p.y + p.h) * h + 1e-9
const PRODUTO = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
const ok = (extra: Partial<Extract<DetalhesLupa, { estado: 'ok' }>> = {}): DetalhesLupa => ({
  estado: 'ok', versao: 'v1', tentado_em: '2026-11-11T10:00:00Z', produto: PRODUTO,
  detalhes: [{ x: 0.2, y: 0.2, w: 0.1, h: 0.1 }, { x: 0.6, y: 0.6, w: 0.1, h: 0.1 }], ref_w: W, ref_h: H, hash: 'h', ...extra,
})

describe('recortesLupa', () => {
  it('detalhe central → cabe, quadrado centrado no detalhe e contido no produto', () => {
    const d = { produto: PRODUTO, detalhes: [{ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] }
    const [q] = recortesLupa(W, H, d, 3, false)!
    // Caixa de 240 px expande a 300, centrada em 600.
    expect(q).toEqual({ x: 450, y: 450, w: 300, h: 300 })
    expect(dentro(q, PRODUTO)).toBe(true)
    // Detalhe grande (480 px) mantém o próprio lado.
    const [g] = recortesLupa(W, H, { produto: PRODUTO, detalhes: [{ x: 0.3, y: 0.3, w: 0.4, h: 0.2 }] }, 3, false)!
    expect(g).toEqual({ x: 360, y: 240, w: 480, h: 480 })
  })

  it('caixa alongada (alça 0,05 × 0,4) num produto estreito → não cabe (nunca quadrado de fundo)', () => {
    const d = { produto: { x: 0.45, y: 0.1, w: 0.1, h: 0.8 }, detalhes: [{ x: 0.475, y: 0.2, w: 0.05, h: 0.4 }] }
    expect(recortesLupa(W, H, d, 3, false)).toBeNull()
  })

  it('caixa de 120 px expande ao mínimo de 300 dentro do produto (não rejeita)', () => {
    // Detalhe no canto do produto: o quadrado de 300 é deslocado para dentro.
    const d = { produto: PRODUTO, detalhes: [{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }] }
    const [q] = recortesLupa(W, H, d, 3, false)!
    expect(q.w).toBe(LADO_MINIMO.geral)
    expect(q).toEqual({ x: 120, y: 120, w: 300, h: 300 })
    expect(dentro(q, PRODUTO)).toBe(true)
  })

  it('mínimo maior que o menor lado do produto → não cabe (geral 300, Moda 600)', () => {
    const pequeno = { produto: { x: 0.4, y: 0.4, w: 0.24, h: 0.24 }, detalhes: [{ x: 0.45, y: 0.45, w: 0.05, h: 0.05 }] } // 288 px
    expect(recortesLupa(W, H, pequeno, 3, false)).toBeNull()
    const medio = { produto: { x: 0.2, y: 0.2, w: 0.45, h: 0.45 }, detalhes: [{ x: 0.3, y: 0.3, w: 0.05, h: 0.05 }] } // 540 px
    expect(recortesLupa(W, H, medio, 3, false)).toHaveLength(1)
    expect(recortesLupa(W, H, medio, 5, true)).toBeNull()
  })

  it('Moda: lado mínimo 600 px, contido no produto', () => {
    const [q] = recortesLupa(W, H, { produto: PRODUTO, detalhes: [{ x: 0.3, y: 0.3, w: 0.1, h: 0.1 }] }, 5, true)!
    expect(q.w).toBe(LADO_MINIMO.moda)
    expect(dentro(q, PRODUTO)).toBe(true)
  })

  it('missão 7 com um só detalhe → não cabe; dois detalhes → dois quadrados disjuntos dentro do produto', () => {
    expect(recortesLupa(W, H, { produto: PRODUTO, detalhes: [{ x: 0.2, y: 0.2, w: 0.1, h: 0.1 }] }, 7, false)).toBeNull()
    const qs = recortesLupa(W, H, ok() as never, 7, false)!
    expect(qs).toHaveLength(2)
    qs.forEach((q) => expect(dentro(q, PRODUTO)).toBe(true))
  })

  it('dois detalhes que se sobrepõem (ou cujos quadrados expandidos se sobrepõem) → não cabe', () => {
    const sobrepostos = { produto: PRODUTO, detalhes: [{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }, { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }] }
    expect(recortesLupa(W, H, sobrepostos, 7, false)).toBeNull()
    // Caixas disjuntas de 60 px, a 120 px uma da outra: expandidas a 300 se sobrepõem.
    const pertos = { produto: PRODUTO, detalhes: [{ x: 0.4, y: 0.4, w: 0.05, h: 0.05 }, { x: 0.55, y: 0.4, w: 0.05, h: 0.05 }] }
    expect(recortesLupa(W, H, pertos, 7, false)).toBeNull()
  })

  it('Moda 5 ≠ Moda 7: cada uma usa uma caixa diferente; Moda 7 sem 2º detalhe → não cabe', () => {
    const d = { produto: { x: 0, y: 0, w: 1, h: 1 }, detalhes: [{ x: 0.05, y: 0.05, w: 0.1, h: 0.1 }, { x: 0.8, y: 0.8, w: 0.1, h: 0.1 }] }
    const [cinco] = recortesLupa(W, H, d, 5, true)!
    const [sete] = recortesLupa(W, H, d, 7, true)!
    expect(cinco).not.toEqual(sete)
    expect(recortesLupa(W, H, { ...d, detalhes: [d.detalhes[0]] }, 7, true)).toBeNull()
  })

  it('missão sem lupa → []', () => {
    expect(recortesLupa(W, H, ok() as never, 2, false)).toEqual([])
    expect(recortesLupa(W, H, ok() as never, 3, true)).toEqual([])
  })
})

describe('situacaoLupa', () => {
  it('nunca lida, falhou ou versão antiga → lendo; sem_detalhe ou não cabe → indisponivel; ok → ok', () => {
    expect(situacaoLupa(null, 3, false, 'v1')).toBe('lendo')
    expect(situacaoLupa({ estado: 'falhou', versao: 'v1', tentado_em: 't' }, 3, false, 'v1')).toBe('lendo')
    expect(situacaoLupa(ok({ versao: 'v0' }), 3, false, 'v1')).toBe('lendo')
    expect(situacaoLupa({ estado: 'sem_detalhe', versao: 'v1', tentado_em: 't' }, 3, false, 'v1')).toBe('indisponivel')
    expect(situacaoLupa(ok({ detalhes: [{ x: 0.2, y: 0.2, w: 0.1, h: 0.1 }] }), 7, false, 'v1')).toBe('indisponivel')
    expect(situacaoLupa(ok(), 3, false, 'v1')).toBe('ok')
    expect(situacaoLupa(null, 2, false, 'v1')).toBe('ok')
  })

  it('missões com lupa: geral 3 e 7, Moda 5 e 7', () => {
    expect([1, 2, 3, 4, 5, 6, 7].filter((m) => comLupa(m, false))).toEqual([3, 7])
    expect([1, 2, 3, 4, 5, 6, 7].filter((m) => comLupa(m, true))).toEqual([5, 7])
  })
})
