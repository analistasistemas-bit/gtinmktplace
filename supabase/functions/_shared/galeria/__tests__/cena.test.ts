// Task 9: corte (R9.1), prompt da cena (R3, R5.2, R5.4, R6.3, ADR §11) e alertas da visão (R8.5). Sem rede.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => { throw new Error('sem rede') } }))
import { cenaUtil, planejarCorte } from '../corte'
import { corpoOpenRouter, montarPromptCena } from '../prompt'
import { interpretarAlertas } from '../alertas'
import { BLOCO_TECNICO } from '../regras'
import { corpoHF, MODELOS_GALERIA } from '../provedores'
import type { MissaoRoteiro, Roteiro } from '../roteiro'

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
  it('dimensão inválida → bloqueado', () => {
    expect(planejarCorte(0, 100, true).modo).toBe('bloqueado')
  })
})

const roteiro: Roteiro = { categoria: 'Rendas', contrato: 'Renda de algodão; sem flores; não vira cetim.', missoes: [] }
const missao = (n: number, extra: Partial<MissaoRoteiro> = {}): MissaoRoteiro =>
  ({ missao: n as MissaoRoteiro['missao'], ativa: true, cena: `cena da missão ${n}`, fatosUsados: [], ...extra })

describe('montarPromptCena', () => {
  const layout = { areaTexto: 'o terço superior' }
  it('termina literalmente com o BLOCO_TECNICO e repete o contrato e a cor', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const p = montarPromptCena(missao(n), roteiro, false, 'Rosa Bebê', layout)
      expect(p.endsWith(BLOCO_TECNICO)).toBe(true)
      expect(p).toContain(roteiro.contrato)
      expect(p).toContain('Rosa Bebê')
      expect(p).toContain('3:4')
    }
  })
  it('nunca leva o texto do roteiro; fora de Moda reserva a área do layout', () => {
    const m = missao(2, { headline: 'Renda que encanta', beneficios: ['Toque macio'], etapas: ['Corte a peça'] })
    const p = montarPromptCena(m, roteiro, false, 'Preto', layout)
    for (const t of ['Renda que encanta', 'Toque macio', 'Corte a peça']) expect(p).not.toContain(t)
    expect(p).toContain('o terço superior')
  })
  it('Moda: sem "headline", sem área de texto', () => {
    const p = montarPromptCena(missao(2, { headline: 'Vestido lindo' }), roteiro, true, 'Preto', layout)
    expect(p.toLowerCase()).not.toContain('headline')
    expect(p).not.toContain('Vestido lindo')
    expect(p).not.toContain('o terço superior')
    expect(p.endsWith(BLOCO_TECNICO)).toBe(true)
  })
  it('capa: fundo branco, sem área de texto', () => {
    const p = montarPromptCena(missao(1), roteiro, false, 'Preto', layout)
    expect(p).toContain('#FFFFFF')
    expect(p).not.toContain('o terço superior')
  })
})

describe('corpo das chamadas pede 3:4', () => {
  it('OpenRouter: image_config.aspect_ratio 3:4 e referência como image_url', () => {
    const c = corpoOpenRouter('google/gemini-nano-banana-2.1', 'P', ['https://signed/ref.jpg']) as Record<string, any>
    expect(c.image_config).toEqual({ aspect_ratio: '3:4' })
    expect(c.modalities).toEqual(['image', 'text'])
    expect(c.messages[0].content).toEqual([{ type: 'text', text: 'P' }, { type: 'image_url', image_url: { url: 'https://signed/ref.jpg' } }])
  })
  it('Higgsfield: campo de proporção medido recebe 3:4 (Qwen e Grok)', () => {
    for (const slug of ['alibaba/qwen-image-3/edit', 'xai/grok-imagine-image-2.0']) {
      const m = MODELOS_GALERIA[slug]
      expect(m.campoProporcao).not.toBeNull()
      const refs = m.campoReferencia ? ['https://signed/ref.jpg'] : []
      expect(corpoHF(m, 'P', refs)[m.campoProporcao!]).toBe('3:4')
    }
  })
})

const resp = (content: unknown) => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] })

describe('interpretarAlertas', () => {
  it('mapeia os tipos', () => {
    expect(interpretarAlertas(resp({ alertas: [
      { tipo: 'cor', nota: 'cor pode estar diferente' }, { tipo: 'produto', nota: 'produto ausente' },
      { tipo: 'texto_na_cena', nota: 'texto na cena' }, { tipo: 'rotulo_alterado', nota: 'rótulo distorcido' },
    ] }))).toEqual([
      { tipo: 'cor', nota: 'cor pode estar diferente' }, { tipo: 'produto', nota: 'produto ausente' },
      { tipo: 'texto_na_cena', nota: 'texto na cena' }, { tipo: 'rotulo_alterado', nota: 'rótulo distorcido' },
    ])
  })
  it('resposta válida sem alertas → []', () => {
    expect(interpretarAlertas(resp({ alertas: [] }))).toEqual([])
  })
  it('ilegível ou fora do formato → verificacao_indisponivel', () => {
    for (const r of [resp('não sei'), resp({}), resp({ alertas: [{ tipo: 'outro', nota: 'x' }] }),
      resp({ alertas: [{ tipo: 'cor' }] }), resp({ alertas: 'cor' }), null, {}]) {
      const a = interpretarAlertas(r)
      expect(a).toHaveLength(1)
      expect(a[0].tipo).toBe('verificacao_indisponivel')
    }
  })
})
