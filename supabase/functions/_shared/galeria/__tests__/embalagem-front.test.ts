// Paridade: a tela (src/lib/galeria/rotulos.ts) não importa roteiro.ts (puxa o cliente OpenRouter) e repete a lista.
import { describe, expect, it, vi } from 'vitest'
import { MEDIDAS_EMBALAGEM } from '../roteiro'
import { EMBALAGEM } from '../../../../../src/lib/galeria/rotulos'

vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({}) }))

describe('medidas da embalagem (R8.1)', () => {
  it('a lista do front é a mesma do servidor', () => {
    expect([...EMBALAGEM].sort()).toEqual([...MEDIDAS_EMBALAGEM].sort())
  })
})
