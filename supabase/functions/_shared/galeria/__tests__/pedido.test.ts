import { describe, expect, it } from 'vitest'
import { idDerivado, planejarGeracoes, type LinhaVaga } from '../pedido'

const ROT = 'rot-1'
const linha = (cor: string, missao: number, geracao: number, status: string, extra: Partial<LinhaVaga> = {}): LinhaVaga =>
  ({ roteiro_id: ROT, cor, missao, geracao, status, origem: 'gerador', ...extra })
const base = { roteiroId: ROT, moda: false, vistasPorCor: { Rosa: ['frente'], Azul: ['frente'] } as Record<string, Array<'frente' | 'costas' | 'lateral'>>, linhas: [] as LinhaVaga[] }

describe('idDerivado', () => {
  // Valores calculados por uuid.uuid5 (Python) = extensions.uuid_generate_v5 da RPC (conferido no teste SQL).
  it('UUID v5 igual ao da RPC (cor com acento)', () => {
    expect(idDerivado('6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', 'Rosa Bebê', 1, 1)).toBe('c4c5cdaa-477b-5040-addd-25d301820034')
    expect(idDerivado('6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', 'Preto', 7, 2)).toBe('a52a863a-eb2d-5c88-b0ed-20aec77a86db')
  })
})

describe('planejarGeracoes', () => {
  it('2 cores × 3 missões → 6 novas, geração 1', () => {
    const r = planejarGeracoes({ ...base, cores: ['Rosa', 'Azul'], missoes: [1, 2, 3] })
    expect(r.novas).toHaveLength(6)
    expect(r.novas.every((n) => n.geracao === 1)).toBe(true)
    expect(r.recortes).toEqual([])
    expect(r.bloqueadas).toEqual([])
  })

  // ADR-0203: nenhuma imagem é recorte; as sete vão ao gerador (geral e Moda).
  it('as sete vão para novas e nenhuma para recortes (geral e Moda)', () => {
    const todas = [1, 2, 3, 4, 5, 6, 7] as const
    for (const moda of [false, true]) {
      const r = planejarGeracoes({ ...base, moda, cores: ['Rosa'], missoes: [...todas] })
      expect(r.recortes).toEqual([])
      expect(r.novas).toEqual(todas.map((missao) => ({ cor: 'Rosa', missao, geracao: 1 })))
      expect(r.bloqueadas).toEqual([])
    }
  })

  it('3 entregues (inclusive desatualizada) → teto; falhou não conta; roteiro anterior não conta', () => {
    const linhas = [linha('Rosa', 2, 1, 'gerada'), linha('Rosa', 2, 2, 'aprovada'), linha('Rosa', 2, 3, 'descartada')]
    expect(planejarGeracoes({ ...base, linhas, cores: ['Rosa'], missoes: [2] }).bloqueadas)
      .toEqual([{ cor: 'Rosa', missao: 2, motivo: 'teto' }])
    const comFalha = [linha('Rosa', 2, 1, 'gerada'), linha('Rosa', 2, 2, 'falhou'), linha('Rosa', 2, 2, 'gerada'),
      linha('Rosa', 2, 1, 'gerada', { roteiro_id: 'rot-velho' }), linha('Rosa', 2, 2, 'gerada', { roteiro_id: 'rot-velho' })]
    expect(planejarGeracoes({ ...base, linhas: comFalha, cores: ['Rosa'], missoes: [2] }).novas)
      .toEqual([{ cor: 'Rosa', missao: 2, geracao: 3 }])
  })

  // Revisão geral (bloqueador 2): imagem reportada inválida pelo cliente (`falhou` + erro `imagem_invalida`) gastou
  // geração no provedor: conta no teto, igual à RPC. Falha técnica (outro erro) continua não contando.
  it('3 reportadas inválidas → 4ª geração recusada teto; falha técnica não conta; geração segue a numeração', () => {
    const inv = (g: number) => linha('Rosa', 2, g, 'falhou', { erro: 'imagem_invalida' })
    expect(planejarGeracoes({ ...base, linhas: [inv(1), inv(2), inv(3)], cores: ['Rosa'], missoes: [2] }).bloqueadas)
      .toEqual([{ cor: 'Rosa', missao: 2, motivo: 'teto' }])
    const tecnicas = [1, 1, 1].map((g) => linha('Rosa', 2, g, 'falhou', { erro: 'provedor_falhou' }))
    expect(planejarGeracoes({ ...base, linhas: tecnicas, cores: ['Rosa'], missoes: [2] }).novas)
      .toEqual([{ cor: 'Rosa', missao: 2, geracao: 1 }])
    expect(planejarGeracoes({ ...base, linhas: [inv(1), inv(2)], cores: ['Rosa'], missoes: [2] }).novas)
      .toEqual([{ cor: 'Rosa', missao: 2, geracao: 3 }])
  })

  it('geração aberta (de qualquer roteiro) → em_andamento', () => {
    const linhas = [linha('Rosa', 1, 1, 'gerando', { roteiro_id: 'rot-velho' })]
    expect(planejarGeracoes({ ...base, linhas, cores: ['Rosa'], missoes: [1] }).bloqueadas)
      .toEqual([{ cor: 'Rosa', missao: 1, motivo: 'em_andamento' }])
  })

  it('Moda só exige a foto de frente: sem frente → sem_vista só na cor que não tem', () => {
    const r = planejarGeracoes({ ...base, moda: true, vistasPorCor: { Rosa: ['frente'], Azul: ['costas'] }, cores: ['Rosa', 'Azul'], missoes: [3] })
    expect(r.novas).toEqual([{ cor: 'Rosa', missao: 3, geracao: 1 }])
    expect(r.bloqueadas).toEqual([{ cor: 'Azul', missao: 3, motivo: 'sem_vista' }])
  })

  it('cor sem foto real (nenhuma referência) → sem_vista', () => {
    const r = planejarGeracoes({ ...base, vistasPorCor: {}, cores: ['Rosa'], missoes: [1, 7] })
    expect(r.bloqueadas.map((b) => b.motivo)).toEqual(['sem_vista', 'sem_vista'])
  })
})
