import { describe, expect, it } from 'vitest'
import {
  corpoHF,
  MODELO_GALERIA_PADRAO,
  MODELOS_GALERIA,
  modeloGaleria,
  resolverModeloGaleria,
} from '../provedores'

function fakeAdmin(valor: string | null, falha = false) {
  return {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (falha) throw new Error('rede')
          return { data: { ai_model_galeria: valor }, error: null }
        },
      }
      return chain
    },
  } as any
}

describe('modeloGaleria', () => {
  it('slug desconhecido ou nulo cai no padrão', () => {
    expect(modeloGaleria('foo/bar')).toBe(MODELO_GALERIA_PADRAO)
    expect(modeloGaleria(null)).toBe(MODELO_GALERIA_PADRAO)
  })
  it('padrão é o Nano Banana via OpenRouter', () => {
    expect(MODELO_GALERIA_PADRAO.slug).toBe('google/gemini-nano-banana-2.1')
    expect(MODELO_GALERIA_PADRAO.provedor).toBe('openrouter')
  })
  it('qwen exige prompt_extend true e aceita no máximo 3 referências', () => {
    const q = modeloGaleria('alibaba/qwen-image-3/edit')
    expect(q.slug).toBe('alibaba/qwen-image-3/edit')
    expect(q.extra.prompt_extend).toBe(true)
    expect(q.maxReferencias).toBe(3)
    expect(q.provedor).toBe('higgsfield')
  })
  it('todo modelo tem custo positivo e rótulo', () => {
    for (const m of Object.values(MODELOS_GALERIA)) {
      expect(m.custoUsd).toBeGreaterThan(0)
      expect(m.rotulo.length).toBeGreaterThan(0)
    }
  })
})

describe('custos e endpoints', () => {
  it('custo exato de cada modelo (medição de 08/11)', () => {
    expect(MODELOS_GALERIA['google/gemini-nano-banana-2.1'].custoUsd).toBe(0.039)
    expect(MODELOS_GALERIA['xai/grok-imagine-image-2.0'].custoUsd).toBe(0.06)
    expect(MODELOS_GALERIA['alibaba/qwen-image-3/edit'].custoUsd).toBe(0.04)
  })
  it('todo modelo higgsfield tem endpoint não vazio', () => {
    for (const m of Object.values(MODELOS_GALERIA).filter((x) => x.provedor === 'higgsfield')) {
      expect(m.endpoint?.length).toBeGreaterThan(0)
    }
  })
})

describe('corpoHF', () => {
  it('qwen: referências em image_urls (literal), corta em 3 e mantém prompt_extend', () => {
    const q = modeloGaleria('alibaba/qwen-image-3/edit')
    const corpo = corpoHF(q, 'x', ['a', 'b', 'c', 'd'])
    expect(corpo).toEqual({ prompt: 'x', image_urls: ['a', 'b', 'c'], prompt_extend: true })
  })
  it('grok: sem campo de referência medido, recusa referência e sem referência só envia prompt', () => {
    const g = modeloGaleria('xai/grok-imagine-image-2.0')
    expect(g.maxReferencias).toBe(0)
    expect(() => corpoHF(g, 'x', ['a'])).toThrow()
    expect(corpoHF(g, 'x', [])).toEqual({ prompt: 'x' })
  })
  it('proporção não medida: nenhum campo de proporção é enviado', () => {
    for (const m of Object.values(MODELOS_GALERIA).filter((x) => x.provedor === 'higgsfield')) {
      expect(Object.keys(corpoHF(m, 'x', [])).some((k) => /aspect|ratio|proporc/i.test(k))).toBe(false)
    }
  })
})

describe('resolverModeloGaleria', () => {
  it('usa o slug configurado na org', async () => {
    const m = await resolverModeloGaleria(fakeAdmin('xai/grok-imagine-image-2.0'), 'org')
    expect(m.slug).toBe('xai/grok-imagine-image-2.0')
  })
  it('null, desconhecido ou erro caem no padrão', async () => {
    expect(await resolverModeloGaleria(fakeAdmin(null), 'o')).toBe(MODELO_GALERIA_PADRAO)
    expect(await resolverModeloGaleria(fakeAdmin('zzz'), 'o')).toBe(MODELO_GALERIA_PADRAO)
    expect(await resolverModeloGaleria(fakeAdmin(null, true), 'o')).toBe(MODELO_GALERIA_PADRAO)
  })
})
