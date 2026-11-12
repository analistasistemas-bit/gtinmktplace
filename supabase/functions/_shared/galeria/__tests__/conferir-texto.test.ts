import { beforeEach, describe, expect, it, vi } from 'vitest'

const v = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: v.create } } }) }))

const { compararTextos, conferirTexto, divergente, TIMEOUT_LEITURA_MS } = await import('../conferir-texto')

const resp = (content: string) => ({ choices: [{ message: { content } }] })

describe('compararTextos', () => {
  it('iguais, com quebra de linha e caixa diferentes → []', () =>
    expect(compararTextos(['254 METROS POR UNIDADE'], ['254 metros', 'POR UNIDADE'])).toEqual([]))

  it('faltando', () =>
    expect(compararTextos(['FIO PARA CRIAR'], [])).toEqual([{ tipo: 'texto_faltando', nota: 'FIO PARA CRIAR' }]))

  it('escrito errado vira faltando + extra', () =>
    expect(compararTextos(['FORÇA E QUALIDADE'], ['FOUÇA E QUALIDADE'])).toEqual([
      { tipo: 'texto_faltando', nota: 'FORÇA E QUALIDADE' },
      { tipo: 'texto_extra', nota: 'FOUÇA E QUALIDADE' },
    ]))

  it('acento trocado conta como errado', () =>
    expect(compararTextos(['ALGODÃO'], ['ALGODAO'])).toEqual([
      { tipo: 'texto_faltando', nota: 'ALGODÃO' },
      { tipo: 'texto_extra', nota: 'ALGODAO' },
    ]))

  it('extra', () =>
    expect(compararTextos(['FIO PARA CRIAR'], ['FIO PARA CRIAR', 'MATERIAL RESISTENTE'])).toEqual([
      { tipo: 'texto_extra', nota: 'MATERIAL RESISTENTE' },
    ]))

  it('capa: qualquer texto lido é extra', () =>
    expect(compararTextos([], ['PROMOÇÃO', 'LEVE 3'])).toEqual([
      { tipo: 'texto_extra', nota: 'PROMOÇÃO' },
      { tipo: 'texto_extra', nota: 'LEVE 3' },
    ]))

  it('capa sem texto lido → []', () => expect(compararTextos([], [])).toEqual([]))

  it('pontuação e bullet não contam', () =>
    expect(compararTextos(['Algodão mercerizado • 254 m'], ['Algodão mercerizado - 254 m'])).toEqual([]))

  it('palavra repetida em dois esperados não gera extra', () =>
    expect(compararTextos(['FIO DE ALGODÃO', 'ALGODÃO 254 M'], ['FIO DE ALGODÃO', 'ALGODÃO 254 M'])).toEqual([]))

  it('item lido que junta vários esperados → []', () =>
    expect(compararTextos(['FIO', 'ALGODÃO'], ['FIO ALGODÃO'])).toEqual([]))

  it('lido sem texto útil (só pontuação) é ignorado', () =>
    expect(compararTextos(['FIO'], ['FIO', ' • '])).toEqual([]))

  describe('repetição', () => {
    const ETAPAS = ['1. PUXE A FITA', '2. AMARRE O LAÇO']

    it('"1." lido duas vezes com um só nos esperados → extra repetido', () =>
      expect(compararTextos(ETAPAS, ['1.', 'PUXE A FITA', '1.', '2.', 'AMARRE O LAÇO'])).toEqual([
        { tipo: 'texto_extra', nota: '1. (repetido)' },
      ]))

    it('etapa lida inteira uma vez e o número de novo solto → repetido', () =>
      expect(compararTextos(ETAPAS, ['1. PUXE A FITA', '1', '2. AMARRE O LAÇO'])).toEqual([
        { tipo: 'texto_extra', nota: '1. (repetido)' },
      ]))

    it('etapas lidas certas (número separado ou junto) → []', () => {
      expect(compararTextos(ETAPAS, ['1.', 'PUXE A FITA', '2.', 'AMARRE O LAÇO'])).toEqual([])
      expect(compararTextos(ETAPAS, ['1. PUXE A FITA', '2. AMARRE O LAÇO'])).toEqual([])
    })

    it('número que não está nos esperados não vira repetição (já é extra pela palavra)', () =>
      expect(compararTextos(['PUXE A FITA'], ['PUXE A FITA', '3.', '3.'])).toEqual([
        { tipo: 'texto_extra', nota: '3.' },
        { tipo: 'texto_extra', nota: '3.' },
      ]))

    it('headline lida duas vezes → extra repetido', () =>
      expect(compararTextos(['FIO PARA CRIAR', '254 METROS'], ['FIO PARA CRIAR', '254 metros', 'Fio para criar'])).toEqual([
        { tipo: 'texto_extra', nota: 'FIO PARA CRIAR (repetido)' },
      ]))

    it('texto pedido duas vezes e lido duas vezes → []; lido três vezes → repetido', () => {
      expect(compararTextos(['MACIO', 'MACIO'], ['MACIO', 'MACIO'])).toEqual([])
      expect(compararTextos(['MACIO', 'MACIO'], ['MACIO', 'MACIO', 'MACIO'])).toEqual([{ tipo: 'texto_extra', nota: 'MACIO (repetido)' }])
    })

    it('esperado curto dentro de esperado longo → []', () => {
      expect(compararTextos(['PARA CRIAR', 'FIO PARA CRIAR AMIGURUMIS'], ['FIO PARA CRIAR AMIGURUMIS', 'PARA CRIAR'])).toEqual([])
      expect(compararTextos(['FIO PARA CRIAR', 'PARA CRIAR AMIGURUMIS'], ['FIO PARA CRIAR', 'PARA CRIAR AMIGURUMIS'])).toEqual([])
    })

    it('quebra de linha e junção de blocos não geram repetição falsa', () => {
      expect(compararTextos(['254 METROS POR UNIDADE'], ['254', 'METROS POR', 'UNIDADE'])).toEqual([])
      expect(compararTextos(['FIO', 'ALGODÃO', '254 M'], ['FIO ALGODÃO 254 M'])).toEqual([])
      expect(compararTextos(['FIO DE ALGODÃO', 'ALGODÃO 254 M'], ['FIO DE ALGODÃO ALGODÃO 254 M'])).toEqual([])
    })
  })
})

describe('divergente', () => {
  it('ignora verificacao_indisponivel', () => {
    expect(divergente([{ tipo: 'verificacao_indisponivel', nota: 'x' }])).toBe(false)
    expect(divergente([])).toBe(false)
    expect(divergente([{ tipo: 'texto_extra', nota: 'x' }])).toBe(true)
  })
})

describe('conferirTexto', () => {
  beforeEach(() => { v.create.mockReset() }) // sem retorno: o vitest trata o retorno de beforeEach como cleanup

  it('lê, compara e usa timeout e maxRetries 0', async () => {
    v.create.mockResolvedValue(resp(JSON.stringify({ textos: ['FIO PARA CRIAR'] })))
    const r = await conferirTexto({ imagemUrl: 'data:image/png;base64,AAA', esperados: ['fio para criar'] })
    expect(r).toEqual([])
    const [corpo, opts] = v.create.mock.calls[0]
    expect(corpo.response_format.json_schema.strict).toBe(true)
    expect(JSON.stringify(corpo.messages)).toContain('data:image/png;base64,AAA')
    expect(opts.maxRetries).toBe(0)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(TIMEOUT_LEITURA_MS).toBe(15_000)
  })

  it('imagem sem texto → faltando para cada esperado', async () => {
    v.create.mockResolvedValue(resp('{"textos":[]}'))
    expect(await conferirTexto({ imagemUrl: 'u', esperados: ['A B'] })).toEqual([{ tipo: 'texto_faltando', nota: 'A B' }])
  })

  it.each([
    ['resposta ilegível', resp('não é json')],
    ['fora do formato', resp('{"outro":1}')],
    ['item que não é texto', resp('{"textos":[1]}')],
    ['sem choices', {}],
  ])('%s → verificacao_indisponivel', async (_n, r) => {
    v.create.mockResolvedValue(r)
    const a = await conferirTexto({ imagemUrl: 'u', esperados: ['A'] })
    expect(a).toHaveLength(1)
    expect(a[0].tipo).toBe('verificacao_indisponivel')
  })

  it('erro ou timeout → verificacao_indisponivel', async () => {
    v.create.mockRejectedValue(new Error('boom'))
    expect((await conferirTexto({ imagemUrl: 'u', esperados: ['A'] }))[0].tipo).toBe('verificacao_indisponivel')
    v.create.mockImplementation(() => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })))
    expect((await conferirTexto({ imagemUrl: 'u', esperados: [] }))[0].tipo).toBe('verificacao_indisponivel')
  })
})
