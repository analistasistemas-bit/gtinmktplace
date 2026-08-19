import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}))

import { buscarCategoriasML } from '../categorias-ml'

describe('buscarCategoriasML', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('normaliza as sugestões e preserva id, nome e caminho disponível', async () => {
    invoke.mockResolvedValue({
      data: {
        categorias: [
          { id: 'MLB123', nome: 'Canetas', caminho: 'Papelaria > Canetas' },
          { id: 'MLB456', nome: 'Marcadores' },
          { id: '', nome: 'Inválida' },
        ],
      },
      error: null,
    })

    await expect(buscarCategoriasML('caneta')).resolves.toEqual([
      { id: 'MLB123', nome: 'Canetas', caminho: 'Papelaria > Canetas' },
      { id: 'MLB456', nome: 'Marcadores' },
    ])
  })

  it('não chama a Edge Function para consulta com menos de três caracteres', async () => {
    await expect(buscarCategoriasML('ab')).resolves.toEqual([])

    expect(invoke).not.toHaveBeenCalled()
  })

  it('expõe a mensagem legível devolvida pela Edge Function', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('FunctionsHttpError'), {
        context: new Response(JSON.stringify({ error: 'Busca de categorias indisponível.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      }),
    })

    await expect(buscarCategoriasML('caneta')).rejects.toThrow(
      'Busca de categorias indisponível.',
    )
  })
})
