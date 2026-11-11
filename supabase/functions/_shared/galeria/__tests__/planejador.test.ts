import { beforeEach, describe, expect, it, vi } from 'vitest'

const v = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: v.create } } }) }))

const { gerarPlanoIA, hashDados, montarMensagens, TIMEOUT_PLANO_MS } = await import('../planejador')
const { EXEMPLO_CAMISETA, EXEMPLO_FITA } = await import('../plano-exemplos')

const DADOS = {
  nome: 'AMIGURUMI CORES UND',
  descricao_fornecedor: 'FIO AMIGURUMI CÍRCULO. COMPOSIÇÃO: 100% ALGODÃO MERCERIZADO. COMPRIMENTO E PESO: 254 M E 125 G.',
  marca: 'Círculo S.A.',
  ficha_do_anuncio: { Composição: '100% algodão mercerizado', Comprimento: '254 m', 'Peso da unidade': '125 g' },
  total_de_cores: 2,
  conteudo_da_embalagem: '1 unidade na cor escolhida' as const,
}
const REF = 'https://x/ref.jpg'
const CORES = ['Carmim Und 3528', 'Branco Und 8001']

const img = (posicao: number, funcao: string, textos: string[]) => ({
  posicao, funcao, textos,
  prompt: `Foto do fio na cor {{COR}}.${textos.length ? ` Inserir exatamente os textos: ${textos.map((t) => `"${t}"`).join(', ')}.` : ''}`,
})
const planoBruto = (textos2: string[] = ['PARA CRIAR AMIGURUMIS']) => ({
  formato: 2, conflitos: [],
  paleta: { cor1: { nome: 'Vermelho da embalagem', hex: '#D91F58' }, cor2: { nome: 'Amarelo do logotipo', hex: '#F2D631' } },
  imagens: [
    img(1, 'Capa', []), img(2, 'Em uso', textos2), img(3, 'Tira-dúvida', ['IDEAL PARA AMIGURUMIS']),
    img(4, 'Benefícios', ['FIO PARA CRIAR', '254 METROS POR UNIDADE']),
    img(5, 'Ficha técnica', ['Composição: 100% algodão mercerizado', 'Comprimento: 254 m']),
    img(6, 'Como usar', ['DA ESCOLHA À CRIAÇÃO']), img(7, 'Detalhes', ['DETALHES DO FIO']),
  ],
})
const resp = (o: unknown) => ({ choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } }] })
const chamar = (moda = false) => gerarPlanoIA({ modelo: 'm', dados: DADOS, refUrl: REF, moda, cores: CORES })

describe('plano-exemplos', () => {
  it('EXEMPLO_FITA é JSON com 7 chaves e EXEMPLO_CAMISETA traz a imagem 7', () => {
    expect(Object.keys(JSON.parse(EXEMPLO_FITA))).toHaveLength(7)
    expect(EXEMPLO_CAMISETA).toContain('Imagem 7')
  })
})

describe('montarMensagens', () => {
  it('mensagens levam os dois exemplos, os DADOS em JSON e a foto', () => {
    // deno-lint-ignore no-explicit-any
    const [sistema, user] = montarMensagens(DADOS, REF, false) as any[]
    expect(sistema.role).toBe('system')
    const texto = user.content.find((c: { type: string }) => c.type === 'text').text
    expect(texto).toContain(EXEMPLO_FITA)
    expect(texto).toContain(EXEMPLO_CAMISETA)
    expect(texto).toContain(JSON.stringify(DADOS, null, 1))
    expect(user.content.find((c: { type: string }) => c.type === 'image_url').image_url.url).toBe(REF)
  })

  it('mensagens nunca levam descricao_ml nem titulo_ml', () => {
    const s = JSON.stringify(montarMensagens(DADOS, REF, false))
    expect(s).not.toContain('descricao_ml')
    expect(s).not.toContain('titulo_ml')
  })

  it('moda acrescenta a regra "nenhuma imagem leva texto"', () => {
    // deno-lint-ignore no-explicit-any
    const sistema = (m: boolean) => (montarMensagens(DADOS, REF, m)[0] as any).content as string
    expect(sistema(true)).toContain('MODA: nenhuma imagem leva texto')
    expect(sistema(false)).not.toContain('MODA: nenhuma imagem leva texto')
  })
})

describe('hashDados', () => {
  it('sha256 hex estável e sensível ao conteúdo', () => {
    expect(hashDados(DADOS)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashDados(DADOS)).toBe(hashDados({ ...DADOS }))
    expect(hashDados({ ...DADOS, nome: 'outro' })).not.toBe(hashDados(DADOS))
  })
})

describe('gerarPlanoIA', () => {
  beforeEach(() => { v.create.mockReset() })

  it('resposta válida vira plano com dados_hash = hashDados(dados)', async () => {
    v.create.mockResolvedValue(resp(planoBruto()))
    const r = await chamar()
    expect('plano' in r && r.plano.dados_hash).toBe(hashDados(DADOS))
    expect(v.create).toHaveBeenCalledTimes(1)
    const [corpo, opts] = v.create.mock.calls[0]
    expect(corpo.model).toBe('m')
    expect(corpo.response_format).toEqual({ type: 'json_object' })
    expect(corpo.temperature).toBe(0.4)
    expect(corpo.max_tokens).toBe(6000)
    expect(opts.maxRetries).toBe(0)
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('resposta inválida tenta uma segunda vez com os erros e, falhando de novo, devolve plano_invalido', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    v.create.mockResolvedValue(resp(planoBruto(['PARA CRIAR 999 AMIGURUMIS'])))
    const r = await chamar()
    expect(r).toEqual({ erro: 'plano_invalido', erros: ['numero_fora_dos_dados:2'] })
    expect(v.create).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls.map((c) => c[0])).toEqual([TIMEOUT_PLANO_MS[0], TIMEOUT_PLANO_MS[1]])
    expect(TIMEOUT_PLANO_MS).toEqual([60_000, 30_000])
    const msgs = v.create.mock.calls[1][0].messages
    expect(msgs).toHaveLength(4)
    expect(msgs[2].role).toBe('assistant')
    expect(msgs[3]).toEqual({ role: 'user', content: 'Corrija: imagem 2: há número que não está nos DADOS; use só números que aparecem nos DADOS. Responda de novo o JSON completo.' })
    expect(v.create.mock.calls[0][0].messages).toHaveLength(2)
    spy.mockRestore()
  })

  it('segunda tentativa que acerta devolve o plano', async () => {
    v.create.mockResolvedValueOnce(resp('não é json')).mockResolvedValueOnce(resp(planoBruto()))
    const r = await chamar()
    expect('plano' in r).toBe(true)
    expect(v.create).toHaveBeenCalledTimes(2)
    expect(v.create.mock.calls[1][0].messages[3].content).toContain('Corrija: JSON fora do formato pedido.')
  })

  it('timeout ou erro do provedor → plano_ia_falhou, sem segunda chamada', async () => {
    v.create.mockRejectedValue(new Error('boom'))
    expect(await chamar()).toEqual({ erro: 'plano_ia_falhou' })
    expect(v.create).toHaveBeenCalledTimes(1)
    v.create.mockReset()
    v.create.mockRejectedValue(Object.assign(new Error('t'), { name: 'TimeoutError' }))
    expect(await chamar()).toEqual({ erro: 'plano_ia_falhou' })
    expect(v.create).toHaveBeenCalledTimes(1)
  })

  it('erro de rede na segunda chamada → plano_ia_falhou', async () => {
    v.create.mockResolvedValueOnce(resp('x')).mockRejectedValueOnce(new Error('boom'))
    expect(await chamar()).toEqual({ erro: 'plano_ia_falhou' })
    expect(v.create).toHaveBeenCalledTimes(2)
  })

  it('moda: texto em qualquer imagem é recusado', async () => {
    v.create.mockResolvedValue(resp(planoBruto()))
    const r = await chamar(true)
    expect(r).toEqual({ erro: 'plano_invalido', erros: ['moda_com_texto'] })
  })
})
