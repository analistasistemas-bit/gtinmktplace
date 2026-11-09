import { describe, expect, it } from 'vitest'
import {
  CAMPO_PROPORCAO_HF,
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

describe('corpoHF', () => {
  it('pede 3:4 no corpo para cada modelo Higgsfield', () => {
    for (const m of Object.values(MODELOS_GALERIA).filter((x) => x.provedor === 'higgsfield')) {
      const corpo = corpoHF(m, 'cena', ['https://a/1.jpg'])
      expect(corpo[CAMPO_PROPORCAO_HF]).toBe('3:4')
      expect(corpo.prompt).toBe('cena')
    }
  })
  it('corta referências além do máximo do modelo e mantém prompt_extend', () => {
    const q = modeloGaleria('alibaba/qwen-image-3/edit')
    const corpo = corpoHF(q, 'x', ['a', 'b', 'c', 'd'])
    expect(corpo.image_urls).toEqual(['a', 'b', 'c'])
    expect(corpo.prompt_extend).toBe(true)
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
