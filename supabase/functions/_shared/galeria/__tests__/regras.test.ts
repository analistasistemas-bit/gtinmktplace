import { describe, expect, it } from 'vitest'
import {
  BLOCO_TECNICO,
  CATEGORIAS_MODA,
  contarPalavras,
  ehModa,
  LIMITES,
  missoesDisponiveis,
  missoesSugeridas,
  termosProibidos,
} from '../regras'

describe('BLOCO_TECNICO', () => {
  it('é a frase literal da R5.4', () => {
    expect(BLOCO_TECNICO).toBe(
      'photorealistic, ultra detailed, commercial product photography, studio lighting, realistic shadows, sharp focus, clean composition, high resolution, professional catalog, no distortion, no blur, no watermark, premium marketplace standard',
    )
  })
})

describe('LIMITES', () => {
  it('segue a R6.1', () => {
    expect(LIMITES).toEqual({ headline: 5, subheadline: 10, beneficio: 6, etapa: 7, legenda: 5 })
  })
})

describe('missoesSugeridas', () => {
  it('até 3 cores sugere as sete; 4 ou mais, as quatro primeiras', () => {
    expect(missoesSugeridas(1)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(missoesSugeridas(3)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(missoesSugeridas(4)).toEqual([1, 2, 3, 4])
    expect(missoesSugeridas(10)).toEqual([1, 2, 3, 4])
  })
})

describe('missoesDisponiveis', () => {
  it('fora de Moda: sete missões; só a 7 é recorte (sem gerador); texto nas 2 a 7', () => {
    const m = missoesDisponiveis(false, ['frente'])
    expect(m.map((x) => x.missao)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(m.filter((x) => !x.usaGerador).map((x) => x.missao)).toEqual([7])
    expect(m.find((x) => x.missao === 1)?.comTexto).toBe(false)
    expect(m.find((x) => x.missao === 4)?.comTexto).toBe(true)
  })

  it('Moda: nenhuma missão leva texto', () => {
    const m = missoesDisponiveis(true, ['frente', 'costas', 'lateral'])
    expect(m).toHaveLength(7)
    expect(m.every((x) => x.comTexto === false)).toBe(true)
  })

  it('Moda: a missão 5 (detalhe do tecido) é recorte, sem gerador', () => {
    const m = missoesDisponiveis(true, ['frente', 'costas', 'lateral'])
    expect(m.find((x) => x.missao === 5)?.usaGerador).toBe(false)
    expect(m.filter((x) => x.usaGerador).map((x) => x.missao)).toEqual([1, 2, 3, 4, 6, 7])
  })

  it('Moda sem foto de costas não oferece "De costas"; com foto oferece', () => {
    const sem = missoesDisponiveis(true, ['frente'])
    expect(sem.some((x) => x.nome === 'De costas')).toBe(false)
    const com = missoesDisponiveis(true, ['frente', 'costas'])
    expect(com.find((x) => x.nome === 'De costas')?.vista).toBe('costas')
  })

  it('Moda sem vista lateral não oferece "Lateral"', () => {
    expect(missoesDisponiveis(true, ['frente', 'costas']).some((x) => x.nome === 'Lateral')).toBe(false)
    expect(missoesDisponiveis(true, ['frente', 'lateral']).some((x) => x.nome === 'Lateral')).toBe(true)
  })
})

describe('ehModa', () => {
  it('verdadeiro para o caminho de uma regata', () => {
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB31447' }])).toBe(true)
  })
  it('falso para renda (aviamentos) e calçado', () => {
    expect(ehModa([{ id: 'MLB1271' }, { id: 'MLB1276' }, { id: 'MLB458220' }])).toBe(false)
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB23262' }])).toBe(false)
  })
  it('falso para bolsa, calçado de bebê e bolsa esportiva', () => {
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB1457' }])).toBe(false)
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB5366' }, { id: 'MLB28158' }])).toBe(false)
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB270215' }, { id: 'MLB432028' }])).toBe(false)
  })
  it('falso para caminho vazio ou ausente', () => {
    expect(ehModa([])).toBe(false)
    expect(ehModa(undefined)).toBe(false)
  })
  it('conjunto contém as raízes de roupa e não as de calçado', () => {
    expect(CATEGORIAS_MODA.has('MLB31447')).toBe(true)
    expect(CATEGORIAS_MODA.has('MLB23262')).toBe(false)
  })
})

describe('contarPalavras', () => {
  it('conta palavras separadas por espaço', () => {
    expect(contarPalavras('Largura certa: 20 mm')).toBe(4)
    expect(contarPalavras('  ')).toBe(0)
    expect(contarPalavras('  um   dois ')).toBe(2)
  })
})

describe('termosProibidos', () => {
  it('pega frete e premium (R4.2, R4.3)', () => {
    expect(termosProibidos('Frete grátis e premium', 'geral')).toEqual(
      expect.arrayContaining(['frete', 'premium']),
    )
  })
  it('pega "100%" como prova/garantia', () => {
    expect(termosProibidos('100% natural', 'geral')).toContain('100%')
  })
  it('texto limpo não devolve nada', () => {
    expect(termosProibidos('Largura certa: 20 mm', 'geral')).toEqual([])
  })
  it('vestuário acrescenta termos da categoria', () => {
    expect(termosProibidos('Tecido anti-odor', 'vestuario')).toContain('anti-odor')
    expect(termosProibidos('Tecido anti-odor', 'geral')).toEqual([])
  })
})
