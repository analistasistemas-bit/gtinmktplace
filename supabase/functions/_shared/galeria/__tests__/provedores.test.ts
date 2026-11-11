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
    expect(MODELOS_GALERIA['google/gemini-nano-banana-2.1'].custoUsd).toBe(0.06) // 2K (ADR-0203)
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
    // Proporção do Qwen não medida na saída (Task 9 Step 5: bloqueio de copyright) → não é enviada.
    expect(corpo).toEqual({ prompt: 'x', image_urls: ['a', 'b', 'c'], prompt_extend: true })
  })
  // Medido na Task 9 Step 5 (10/11): o validador da Higgsfield cita `image_urls` (array de string, máx. 10) e
  // `aspect_ratio` (enum com '3:4') no Grok; a geração real com image_urls reproduziu o produto da referência.
  it('grok: referências em image_urls (corta em 3) e aspect_ratio 3:4', () => {
    const g = modeloGaleria('xai/grok-imagine-image-2.0')
    expect(corpoHF(g, 'x', ['a', 'b', 'c', 'd'])).toEqual({ prompt: 'x', image_urls: ['a', 'b', 'c'], aspect_ratio: '3:4' })
  })
  it('proporção: aspect_ratio 3:4 só onde a saída foi medida (Grok)', () => {
    expect(corpoHF(modeloGaleria('xai/grok-imagine-image-2.0'), 'x', []).aspect_ratio).toBe('3:4')
    expect(corpoHF(modeloGaleria('alibaba/qwen-image-3/edit'), 'x', [])).not.toHaveProperty('aspect_ratio')
  })
})

describe('resolverModeloGaleria', () => {
  it('usa o slug configurado na org', async () => {
    const m = await resolverModeloGaleria(fakeAdmin('xai/grok-imagine-image-2.0'), 'org')
    expect(m.slug).toBe('xai/grok-imagine-image-2.0')
  })
  it('modelo Higgsfield sem proporção confirmada na saída (Qwen) cai no padrão', async () => {
    expect(await resolverModeloGaleria(fakeAdmin('alibaba/qwen-image-3/edit'), 'o')).toBe(MODELO_GALERIA_PADRAO)
  })
  it('Grok (referência medida na Task 9) é usado quando configurado', async () => {
    expect((await resolverModeloGaleria(fakeAdmin('xai/grok-imagine-image-2.0'), 'o')).slug).toBe('xai/grok-imagine-image-2.0')
  })
  it('null, desconhecido ou erro caem no padrão', async () => {
    expect(await resolverModeloGaleria(fakeAdmin(null), 'o')).toBe(MODELO_GALERIA_PADRAO)
    expect(await resolverModeloGaleria(fakeAdmin('zzz'), 'o')).toBe(MODELO_GALERIA_PADRAO)
    expect(await resolverModeloGaleria(fakeAdmin(null, true), 'o')).toBe(MODELO_GALERIA_PADRAO)
  })
})
