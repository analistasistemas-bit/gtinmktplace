import { describe, expect, it } from 'vitest'
import {
  BLOCO_TECNICO,
  CATEGORIAS_MODA,
  contarPalavras,
  ehModa,
  missoesDisponiveis,
  termosProibidos,
} from '../regras'

describe('BLOCO_TECNICO', () => {
  it('é a frase literal da R5.4', () => {
    expect(BLOCO_TECNICO).toBe(
      'photorealistic, ultra detailed, commercial product photography, studio lighting, realistic shadows, sharp focus, clean composition, high resolution, professional catalog, no distortion, no blur, no watermark, premium marketplace standard',
    )
  })
})

describe('missoesDisponiveis', () => {
  const TEXTO_GERAL = { 1: false, 2: true, 3: true, 4: true, 5: true, 6: true, 7: true }

  // ADR-0203: imagem inteira do gerador nas sete, só com a foto de frente; nomes = fonte única da tela.
  it('fora de Moda: as sete pelo gerador, vista frente, com os nomes novos', () => {
    const m = missoesDisponiveis(false, ['frente'])
    expect(m.map((x) => x.nome)).toEqual(['Capa', 'Em uso', 'Tira-dúvida', 'Benefícios', 'Ficha técnica', 'Como usar', 'Detalhes'])
    expect(m.every((x) => x.usaGerador && x.vista === 'frente')).toBe(true)
  })

  it('Moda: só com a foto de frente, as sete pelo gerador e vista frente', () => {
    const m = missoesDisponiveis(true, ['frente'])
    expect(m.map((x) => x.missao)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(m.every((x) => x.usaGerador && x.vista === 'frente')).toBe(true)
  })

  it('fora de Moda: a capa não leva texto e as missões 2 a 7 levam, cada uma', () => {
    const m = missoesDisponiveis(false, ['frente'])
    for (const x of m) expect(x.comTexto, `missão ${x.missao}`).toBe(TEXTO_GERAL[x.missao])
  })

  it('Moda: nenhuma das sete missões leva texto, cada uma', () => {
    const m = missoesDisponiveis(true, ['frente', 'costas', 'lateral'])
    expect(m.map((x) => x.missao)).toEqual([1, 2, 3, 4, 5, 6, 7])
    for (const x of m) expect(x.comTexto, `missão ${x.missao}`).toBe(false)
  })

  it('Moda sem nenhuma foto de frente não oferece nada', () => {
    expect(missoesDisponiveis(true, ['costas', 'lateral'])).toEqual([])
  })
})

// path_from_root REAL, medido em 2026-11-09 via GET https://api.mercadolibre.com/categories/{id}.
const PATH_REGATA = [
  { id: 'MLB1430', name: 'Calçados, Roupas e Bolsas' },
  { id: 'MLB31447', name: 'Camisetas e Regatas' },
]
const PATH_RENDA = [
  { id: 'MLB1368', name: 'Arte, Papelaria e Armarinho' },
  { id: 'MLB270263', name: 'Artigos de Armarinho' },
  { id: 'MLB271477', name: 'Rendas' },
]
const PATH_CALCADO = [
  { id: 'MLB1430', name: 'Calçados, Roupas e Bolsas' },
  { id: 'MLB23262', name: 'Calçados' },
  { id: 'MLB275584', name: 'Alpargata' },
]

describe('ehModa', () => {
  it('verdadeiro para o path real de uma regata', () => {
    expect(ehModa(PATH_REGATA)).toBe(true)
  })
  it('falso para os paths reais de renda (armarinho) e de calçado', () => {
    expect(ehModa(PATH_RENDA)).toBe(false)
    // calçado compartilha a raiz MLB1430 com a regata: prova que a raiz sozinha não basta
    expect(ehModa(PATH_CALCADO)).toBe(false)
  })
  it('falso para bolsa, calçado de bebê e bolsa esportiva (aninhados sob roupa)', () => {
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB1457' }])).toBe(false)
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB5366' }, { id: 'MLB28158' }])).toBe(false)
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB270215' }, { id: 'MLB432028' }])).toBe(false)
  })
  it('falso para Acessórios de Moda (decisão: não é roupa)', () => {
    expect(ehModa([{ id: 'MLB1430' }, { id: 'MLB1451' }])).toBe(false)
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
      expect.arrayContaining(['frete', 'gratis', 'premium']),
    )
  })
  it('pega o claim "100% natural", não o percentual de composição', () => {
    expect(termosProibidos('100% natural', 'geral')).toContain('100% (claim)')
    expect(termosProibidos('100% Poliamida', 'geral')).toEqual([])
    expect(termosProibidos('96% poliéster', 'geral')).toEqual([])
  })
  it('pega valor em reais', () => {
    expect(termosProibidos('R$ 19,90', 'geral')).toEqual(['valor em R$'])
    expect(termosProibidos('R$19', 'geral')).toEqual(['valor em R$'])
  })
  it('aceita o plural dos termos', () => {
    expect(termosProibidos('Descontos especiais', 'geral')).toContain('desconto')
    expect(termosProibidos('Garantias de fábrica', 'geral')).toContain('garantia')
    expect(termosProibidos('Mais vendidos', 'geral')).toContain('mais vendido')
    expect(termosProibidos('fretes', 'geral')).toContain('frete')
    expect(termosProibidos('selos', 'geral')).toContain('selo')
  })
  it('não casa quando o termo só aparece no meio de outra palavra', () => {
    expect(termosProibidos('freteiro', 'geral')).toEqual([])
    expect(termosProibidos('preciosa', 'geral')).toEqual([])
    expect(termosProibidos('anselo', 'geral')).toEqual([])
    expect(termosProibidos('Reserva de R e S', 'geral')).toEqual([])
  })
  it('claim 100% flexionado em gênero e número (minor da Task 3)', () => {
    for (const t of ['100% orgânica', '100% orgânicos', '100% segura', '100% seguros', '100% eficazes', '100% naturais', '100% pura'])
      expect(termosProibidos(t, 'geral'), t).toContain('100% (claim)')
  })
  it('"100% puro algodão" é composição, não claim', () => {
    expect(termosProibidos('100% puro algodão', 'geral')).toEqual([])
    expect(termosProibidos('100% pura seda', 'geral')).toEqual([])
    expect(termosProibidos('100% puro', 'geral')).toContain('100% (claim)')
    expect(termosProibidos('100% puro e natural', 'geral')).toContain('100% (claim)')
  })
  it('claim com "de" opcional ("100% de natural", "100% de puro")', () => {
    expect(termosProibidos('100% de natural', 'geral')).toContain('100% (claim)')
    expect(termosProibidos('100% de puro', 'geral')).toContain('100% (claim)')
    expect(termosProibidos('100% de algodão', 'geral')).toEqual([])
  })
  it('plural em -ões ("promoções")', () => {
    expect(termosProibidos('Promoções da semana', 'geral')).toContain('promocao')
    expect(termosProibidos('promoção', 'geral')).toContain('promocao')
  })
  it('texto limpo não devolve nada', () => {
    expect(termosProibidos('Largura certa: 20 mm', 'geral')).toEqual([])
  })
  it('vestuário não proíbe termo citável quando confirmado (lista fechada no roteiro)', () => {
    expect(termosProibidos('Tecido impermeável', 'vestuario')).toEqual([])
  })
})
