// Worker de geração (claim + lease + posse, tentativa, vigência editorial, visão em fase própria) e, desde o ADR-0203
// (Task 4), imagem inteira do plano em 4:5/2K, conferência do texto inline e uma regeração. Sem rede: OpenRouter
// mockado (client.ts), Higgsfield e download por fetchFn, conferência injetada (`deps.conferir`) ou pelo conferirTexto
// real sobre o mock, banco e Storage em memória.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from './fake-admin'

const v = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: v.create } } }) }))
vi.mock('../../canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn() }))
vi.mock('../../ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn() }))

const { executarImagem, proximaFase, LEASE_MS, PRAZO_GERACAO_MS, VALIDADE_REFERENCIA_S } = await import('../worker-estado')

type Linha = Record<string, any>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let agora: number
let fetchs: Array<{ url: string; method: string; body?: string }>
let hf: { submit: () => Response; status: () => Response; download: () => Response }
let conferir: ReturnType<typeof vi.fn> | undefined

const T0 = Date.parse('2026-11-10T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const ID = '11111111-1111-4111-8111-111111111111'

/** JPEG mínimo com SOF0 (dimensões) e preenchimento até `tam` bytes. */
function jpeg(w: number, h: number, marca = 0, tam = 41_000) {
  const b = new Uint8Array(tam)
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, marca])
  return b
}
/** 4:5 em 2K, como o Nano Banana entrega (medido em 12/11). */
const IMG = (marca = 0) => jpeg(1856, 2304, marca)
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const respOR = (bytes: Uint8Array, cost = 0.041) =>
  ({ choices: [{ message: { images: [{ image_url: { url: `data:image/jpeg;base64,${b64(bytes)}` } }] } }], usage: { cost } })
const erroHTTP = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })

const ESPERADOS = ['FIO PARA CRIAR', '254 METROS']
const FALTANDO = [{ tipo: 'texto_faltando', nota: 'FIO PARA CRIAR' }]
const INDISP = [{ tipo: 'verificacao_indisponivel', nota: 'leitura sem resposta a tempo' }]

/** Plano formato 2 (ADR-0203) com as 7 posições; a 2 leva os ESPERADOS. */
function plano() {
  return {
    formato: 2, dados_hash: 'h', conflitos: [],
    paleta: { cor1: { nome: 'Carmim', hex: '#D91F58' }, cor2: { nome: 'Amarelo', hex: '#F2D631' } },
    imagens: [1, 2, 3, 4, 5, 6, 7].map((posicao) => posicao === 2
      ? { posicao, funcao: 'Em uso', textos: ESPERADOS,
        prompt: 'Imagem vertical, mesa de costura. Produto: fio na cor {{COR}}. Inserir exatamente os textos: "FIO PARA CRIAR" "254 METROS".' }
      : { posicao, funcao: `f${posicao}`, textos: [], prompt: `Imagem ${posicao} do fio {{COR}}.` }),
  }
}

function linha(extra: Linha = {}): Linha {
  return {
    id: ID, org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', pedido_id: 'ped', roteiro_id: 'rot1',
    cor: 'Rosa Bebê', missao: 2, geracao: 1, origem: 'gerador', referencia_id: 'ref1',
    modelo: 'google/gemini-nano-banana-2.1', provedor: 'openrouter', provider_request_id: null,
    fase: 0, tentativa: 0, despacho_seq: 1, posse: null, lease_ate: null, prazo_ate: null, status: 'pendente',
    prompt: null, cena_path: null, custo_usd: null, alertas: null, erro: null, criado_em: iso(T0), ...extra,
  }
}
const img = () => db.galeria_imagens[0]
const msg = (l = img(), acao = 'submeter') => ({ tipo: 'imagem', id: l.id, fase: l.fase, tentativa: l.tentativa, despacho_seq: l.despacho_seq, acao })
const deps = () => ({
  agora: () => new Date(agora),
  fetchFn: (async (url: string, init?: RequestInit) => {
    fetchs.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined })
    if (url.includes('/requests/')) return hf.status()
    if (url.startsWith('https://api.higgsfield.ai/')) return hf.submit()
    return hf.download()
  }) as typeof fetch,
  credenciaisHF: 'id:secret',
  conferir: conferir as never,
})
const rodar = (m = msg()) => executarImagem(fake.admin as never, m, deps())
const chamadasProvedor = () => v.create.mock.calls.filter((c) => c[0].modalities).length
const custoRpc = () => fake.rpcs.filter((r) => r.nome === 'galeria_concluir_geracao').map((r) => r.args.p_custo)

beforeEach(() => {
  v.create.mockReset()
  conferir = vi.fn(async () => [])
  agora = T0
  fetchs = []
  hf = {
    submit: () => new Response(JSON.stringify({ status: 'queued', request_id: 'hf-1' }), { status: 200 }),
    status: () => new Response(JSON.stringify({ status: 'in_progress' }), { status: 200 }),
    download: () => new Response(jpeg(1536, 2048, 9), { status: 200, headers: { 'content-type': 'image/jpeg' } }),
  }
  db = {
    galeria_imagens: [linha()],
    galeria_roteiros: [{ id: 'rot1', status: 'aprovado', moda: false, conteudo: plano() }],
    galeria_referencias: [{ id: 'ref1', path: 'org/galeria-ia/famB/referencias/rosa-bebe-frente-sha.jpg' }],
    platform_image_deliveries: [],
  }
  fake = fakeAdmin(db)
  // Espelho de galeria_concluir_geracao (migration 20261110182442): um update condicionado à posse; status pela vigência.
  fake.respostasRpc.galeria_concluir_geracao = (a) => {
    const l = db.galeria_imagens.find((x) => x.id === a.p_imagem && x.posse === a.p_posse && ['submetendo', 'gerando'].includes(x.status))
    if (!l) return null
    const vigente = db.galeria_roteiros.some((r) => r.id === l.roteiro_id && r.status === 'aprovado')
    Object.assign(l, { status: vigente ? 'gerada' : 'desatualizada', cena_path: a.p_cena_path, prompt: a.p_prompt ?? l.prompt,
      custo_usd: a.p_custo, posse: null, lease_ate: null, fase: l.fase + 1 })
    return l.status
  }
})

describe('proximaFase (pura)', () => {
  const m = (l: Linha) => ({ fase: l.fase, tentativa: l.tentativa })
  it('provider_request_id preenchido nunca submete', () => {
    for (const status of ['submetendo', 'gerando']) {
      const l = linha({ status, provider_request_id: 'hf-1', tentativa: 1 })
      expect(proximaFase(l, m(l), new Date(T0))).toBe('consultar')
    }
  })
  it('fase ou tentativa antiga → ignorar; lease ativo → ocupado; terminal → ignorar', () => {
    const l = linha({ fase: 2, tentativa: 1, status: 'submetendo' })
    expect(proximaFase(l, { fase: 1, tentativa: 1 }, new Date(T0))).toBe('ignorar')
    expect(proximaFase(l, { fase: 2, tentativa: 0 }, new Date(T0))).toBe('ignorar')
    const ocupada = linha({ status: 'submetendo', tentativa: 1, lease_ate: iso(T0 + 60_000) })
    expect(proximaFase(ocupada, m(ocupada), new Date(T0))).toBe('ocupado')
    for (const status of ['falhou', 'gerada', 'aprovada', 'descartada', 'desatualizada']) {
      const t = linha({ status, alertas: [] })
      expect(proximaFase(t, m(t), new Date(T0))).toBe('ignorar')
    }
  })
  it('submetendo com lease vencido e sem id: nova submissão só com tentativa < 2', () => {
    const um = linha({ status: 'submetendo', tentativa: 1, lease_ate: iso(T0 - 1) })
    expect(proximaFase(um, m(um), new Date(T0))).toBe('submeter')
    const dois = linha({ status: 'submetendo', tentativa: 2, lease_ate: iso(T0 - 1) })
    expect(proximaFase(dois, m(dois), new Date(T0))).toBe('falhar')
  })
  it('depois de 12 min → consulta_final; concluída nela → baixar; falha ou pendente nela → falhar', () => {
    const l = linha({ status: 'gerando', tentativa: 1, provider_request_id: 'hf-1' })
    const depois = new Date(T0 + 12 * 60_000 + 1)
    expect(proximaFase(l, m(l), depois)).toBe('consulta_final')
    expect(proximaFase(l, m(l), depois, 'concluida')).toBe('baixar')
    expect(proximaFase(l, m(l), depois, 'pendente')).toBe('falhar')
    expect(proximaFase(l, m(l), new Date(T0), 'pendente')).toBe('ignorar')
    expect(proximaFase(l, m(l), new Date(T0), 'concluida')).toBe('baixar')
  })
  it('cena gravada e alertas nulos → alertar em qualquer status, mesmo com mensagem antiga', () => {
    for (const status of ['gerada', 'aprovada', 'descartada', 'desatualizada']) {
      const l = linha({ status, cena_path: 'x.jpg', fase: 3 })
      expect(proximaFase(l, { fase: 0, tentativa: 0 }, new Date(T0))).toBe('alertar')
    }
    const recorte = linha({ origem: 'recorte', status: 'gerada', alertas: [] })
    expect(proximaFase(recorte, m(recorte), new Date(T0))).toBe('ignorar')
  })
})

describe('OpenRouter', () => {
  it('submeter monta o prompt do plano com a cor da linha e pede 4:5 em 2K', async () => {
    v.create.mockResolvedValue(respOR(IMG()))
    expect(await rodar()).toBe('gerada')
    const [corpo] = v.create.mock.calls[0]
    expect(corpo.image_config).toEqual({ aspect_ratio: '4:5', image_size: '2K' })
    const texto = corpo.messages[0].content[0].text as string
    expect(texto).toContain('fio na cor Rosa Bebê')
    expect(texto).toContain('"FIO PARA CRIAR"')
    expect(texto).toContain('#D91F58') // paleta (posição com texto)
    expect(texto).not.toContain('{{COR}}')
    expect(img().prompt).toBe(texto)
  })
  it('gera, grava cena_path, prompt, custo e alertas; maxRetries 0 e timeout ≤100 s', async () => {
    v.create.mockImplementation(async () => { agora += 95_000; return respOR(IMG(1)) })
    expect(await rodar()).toBe('gerada')
    const l = img()
    expect(l.status).toBe('gerada')
    expect(l.cena_path).toMatch(new RegExp(`^org/galeria-ia/famB/rosa-bebe/2-1-${ID}-[0-9a-f-]{36}\\.jpg$`))
    expect(l.custo_usd).toBe(0.041)
    expect(l.prompt).toContain('mesa de costura')
    expect(l.alertas).toEqual([])
    expect(l).toMatchObject({ posse: null, lease_ate: null, fase: 1, tentativa: 1 })
    expect(fake.arquivos.get(l.cena_path)![11]).toBe(1)
    const [corpo, opcoes] = v.create.mock.calls[0]
    expect(corpo.messages[0].content[1].image_url.url).toBe('https://signed/org/galeria-ia/famB/referencias/rosa-bebe-frente-sha.jpg')
    expect(opcoes.maxRetries).toBe(0)
    expect(opcoes.signal).toBeInstanceOf(AbortSignal)
    expect(v.create).toHaveBeenCalledTimes(1) // a conferência é injetada; a visão antiga não roda
  })
  it('sem usage.cost → custo do registro do modelo (sempre preenchido)', async () => {
    v.create.mockResolvedValue({ ...respOR(IMG()), usage: {} })
    await rodar()
    expect(img().custo_usd).toBe(0.06)
  })
  it('cena quadrada (missão 2) ou < 40 KB → falhou sem cena_path, com o custo da chamada e sem gastar a conferência', async () => {
    v.create.mockResolvedValue(respOR(jpeg(1024, 1024)))
    expect(await rodar()).toBe('falhou')
    expect(img()).toMatchObject({ status: 'falhou', cena_path: null, custo_usd: 0.041, erro: 'cena_inutil', posse: null, lease_ate: null, fase: 1 })
    db.galeria_imagens = [linha()]
    v.create.mockResolvedValue(respOR(jpeg(1856, 2304, 0, 30_000)))
    expect(await rodar()).toBe('falhou')
    expect(img().cena_path).toBeNull()
    expect(conferir).not.toHaveBeenCalled()
  })
  it('imagem inútil na regeração soma o custo da chamada ao que já havia na linha', async () => {
    Object.assign(img(), { status: 'submetendo', tentativa: 1, custo_usd: 0.05, posse: null, lease_ate: null })
    v.create.mockResolvedValue(respOR(jpeg(1024, 1024)))
    expect(await rodar()).toBe('falhou')
    expect(img()).toMatchObject({ status: 'falhou', erro: 'cena_inutil', tentativa: 2, cena_path: null })
    expect(img().custo_usd).toBeCloseTo(0.091, 10)
  })
  // Conta só o create do mock (regra de tentativa). "Uma requisição HTTP" com o SDK real: worker-http.denotest.ts.
  it('502 → uma chamada, lease solto com tentativa 1; 2ª queda → falhou sem 3ª chamada', async () => {
    v.create.mockRejectedValue(erroHTTP(502))
    await rodar()
    expect(v.create).toHaveBeenCalledTimes(1)
    expect(img()).toMatchObject({ status: 'submetendo', tentativa: 1, posse: null, lease_ate: null })
    await rodar()
    expect(v.create).toHaveBeenCalledTimes(2)
    expect(img()).toMatchObject({ status: 'falhou', tentativa: 2 })
    await rodar()
    expect(v.create).toHaveBeenCalledTimes(2)
  })
  it('4xx definitivo → falhou na hora', async () => {
    v.create.mockRejectedValue(erroHTTP(400))
    await rodar()
    expect(img()).toMatchObject({ status: 'falhou', tentativa: 1, erro: 'provedor_400' })
  })
  it('queda durante a chamada (lease vencido, sem id): 1 nova submissão; na 2ª queda → falhou sem chamar', async () => {
    Object.assign(img(), { status: 'submetendo', tentativa: 1, lease_ate: iso(T0 - 1), posse: 'morta' })
    v.create.mockResolvedValue(respOR(IMG()))
    expect(await rodar()).toBe('gerada')
    expect(img().tentativa).toBe(2)
    db.galeria_imagens = [linha({ status: 'submetendo', tentativa: 2, lease_ate: iso(T0 - 1), posse: 'morta' })]
    v.create.mockClear()
    expect(await rodar()).toBe('falhou')
    expect(v.create).not.toHaveBeenCalled()
    expect(img()).toMatchObject({ status: 'falhou', cena_path: null, custo_usd: null })
  })
  it('lease ativo → ocupado sem chamar; mensagem antiga → ignorar', async () => {
    Object.assign(img(), { status: 'submetendo', tentativa: 1, lease_ate: iso(T0 + 60_000), posse: 'outra' })
    expect(await rodar()).toBe('ocupado')
    expect(await rodar({ ...msg(), tentativa: 0 })).toBe('ignorar')
    expect(v.create).not.toHaveBeenCalled()
  })
  it('roteiro novo aprovado enquanto submetendo → conclui desatualizada (com os alertas da conferência)', async () => {
    v.create.mockImplementation(async () => { db.galeria_roteiros[0].status = 'desatualizado'; return respOR(IMG()) })
    const extra = [{ tipo: 'texto_extra', nota: 'X' }]
    conferir!.mockResolvedValue(extra)
    Object.assign(img(), { tentativa: 1, status: 'submetendo' }) // 2ª submissão: divergente não regera mais
    expect(await rodar({ ...msg(), tentativa: 1 })).toBe('desatualizada')
    expect(img()).toMatchObject({ status: 'desatualizada', alertas: extra })
    expect(img().cena_path).not.toBeNull()
  })
  it('pendente do roteiro antigo → falhou/roteiro_trocado sem chamada paga', async () => {
    db.galeria_roteiros[0].status = 'desatualizado'
    expect(await rodar()).toBe('falhou')
    expect(img()).toMatchObject({ status: 'falhou', erro: 'roteiro_trocado', tentativa: 0 })
    expect(v.create).not.toHaveBeenCalled()
  })
  it('roteiro em formato antigo → falhou com erro plano_antigo, sem chamada paga', async () => {
    db.galeria_roteiros[0].conteudo = { categoria: 'Rendas', contrato: 'Renda', missoes: [{ missao: 2, ativa: true, cena: 'mesa', fatosUsados: [] }] }
    expect(await rodar()).toBe('falhou')
    expect(img()).toMatchObject({ status: 'falhou', erro: 'plano_antigo', tentativa: 0, posse: null, lease_ate: null })
    expect(v.create).not.toHaveBeenCalled()
    expect(conferir).not.toHaveBeenCalled()
  })
  it('posição indisponível no plano → falhou com erro posicao_indisponivel, sem chamada paga', async () => {
    db.galeria_roteiros[0].conteudo.imagens[1] = { posicao: 2, funcao: 'Em uso', textos: [], prompt: '', indisponivel: 'poucos dados' }
    expect(await rodar()).toBe('falhou')
    expect(img()).toMatchObject({ status: 'falhou', erro: 'posicao_indisponivel', posse: null, lease_ate: null })
    expect(v.create).not.toHaveBeenCalled()
  })
  it('perdeu a posse: gravação final rejeitada, sem cena_path nem custo', async () => {
    v.create.mockImplementation(async () => {
      Object.assign(img(), { posse: 'outro-worker', lease_ate: iso(T0 + 999_000) })
      return respOR(IMG())
    })
    expect(await rodar()).toBe('perdeu_posse')
    expect(img()).toMatchObject({ cena_path: null, custo_usd: null, posse: 'outro-worker', alertas: null })
  })
  it('dois workers: o antigo termina por último e não sobrescreve o vencedor', async () => {
    let liberarA!: (v: unknown) => void
    let chegouA!: () => void
    const aChegou = new Promise<void>((r) => { chegouA = r })
    v.create.mockImplementationOnce(() => { chegouA(); return new Promise((r) => { liberarA = r }) })
    const a = rodar()
    await aChegou
    const posseA = img().posse
    agora = T0 + LEASE_MS + 1_000 // lease de A venceu; o despachante republica
    v.create.mockResolvedValueOnce(respOR(IMG(0xb)))
    expect(await rodar()).toBe('gerada')
    const pathB = img().cena_path
    liberarA(respOR(IMG(0xa), 0.5))
    expect(await a).toBe('perdeu_posse')
    expect(img().cena_path).toBe(pathB)
    expect(fake.arquivos.get(pathB)![11]).toBe(0xb)
    const pathA = [...fake.arquivos.keys()].find((p) => p.includes(posseA))!
    expect(pathA).not.toBe(pathB)
    expect(fake.arquivos.get(pathA)![11]).toBe(0xa)
    expect(img().custo_usd).toBe(0.041)
  })
})

describe('conferência inline e regeração (ADR-0203 item 6)', () => {
  it('texto divergente na 1ª tentativa: não grava a cena, grava o custo na linha, solta o lease e devolve "liberada"', async () => {
    v.create.mockResolvedValue(respOR(IMG(), 0.05))
    conferir!.mockResolvedValue(FALTANDO)
    expect(await rodar()).toBe('liberada')
    expect(img()).toMatchObject({
      status: 'submetendo', tentativa: 1, fase: 0, custo_usd: 0.05, posse: null, lease_ate: null,
      provider_request_id: null, cena_path: null, alertas: null,
    })
    expect(fake.uploads).toEqual([])
    expect(fake.rpcs).toEqual([])
    const [arg] = conferir!.mock.calls[0]
    expect(arg.imagemUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(arg.esperados).toEqual(ESPERADOS)
    // A regra existente faz a 2ª submissão no próximo despacho (sem mudar proximaFase).
    expect(proximaFase(img() as never, { fase: 0, tentativa: 1 }, new Date(T0))).toBe('submeter')
  })
  it('texto divergente na 2ª tentativa: conclui, com p_custo = c1 + c2 e alertas = os da conferência feita', async () => {
    v.create.mockResolvedValueOnce(respOR(IMG(), 0.05)).mockResolvedValueOnce(respOR(IMG(), 0.06))
    const segunda = [{ tipo: 'texto_extra', nota: 'MATERIAL RESISTENTE' }]
    conferir!.mockResolvedValueOnce(FALTANDO).mockResolvedValueOnce(segunda)
    expect(await rodar()).toBe('liberada')
    expect(await rodar()).toBe('gerada')
    expect(custoRpc()).toHaveLength(1)
    expect(custoRpc()[0]).toBeCloseTo(0.11, 10)
    expect(img()).toMatchObject({ status: 'gerada', tentativa: 2, alertas: segunda })
    expect(img().custo_usd).toBeCloseTo(0.11, 10)
    expect(fake.uploads).toHaveLength(1)
    // Nunca uma 3ª geração: a linha concluída só aceita a visão, e já tem alertas.
    expect(await rodar()).toBe('ignorar')
    expect(chamadasProvedor()).toBe(2)
    expect(conferir).toHaveBeenCalledTimes(2)
  })
  it('linha que já está na 2ª tentativa nunca regera, mesmo com texto divergente', async () => {
    Object.assign(img(), { status: 'submetendo', tentativa: 1, custo_usd: 0.05 })
    v.create.mockResolvedValue(respOR(IMG(), 0.06))
    conferir!.mockResolvedValue(FALTANDO)
    expect(await rodar()).toBe('gerada')
    expect(img()).toMatchObject({ tentativa: 2, alertas: FALTANDO })
    expect(img().custo_usd).toBeCloseTo(0.11, 10)
  })
  it('divergente na 1ª e 502 na 2ª → falhou, com o custo da 1ª na linha', async () => {
    v.create.mockResolvedValueOnce(respOR(IMG(), 0.05)).mockRejectedValueOnce(erroHTTP(502))
    conferir!.mockResolvedValue(FALTANDO)
    expect(await rodar()).toBe('liberada')
    expect(await rodar()).toBe('falhou')
    expect(img()).toMatchObject({ status: 'falhou', erro: 'provedor_indisponivel', tentativa: 2, custo_usd: 0.05, cena_path: null })
    expect(await rodar()).toBe('ignorar')
    expect(chamadasProvedor()).toBe(2)
  })
  it('conferência limpa: conclui e grava alertas = [] sem esperar a fase alertar', async () => {
    v.create.mockResolvedValue(respOR(IMG(), 0.05))
    expect(await rodar()).toBe('gerada')
    expect(img()).toMatchObject({ status: 'gerada', alertas: [], custo_usd: 0.05, tentativa: 1 })
    expect(custoRpc()).toEqual([0.05])
    // A mensagem de visão que o despachante mandaria não roda nada.
    expect(await rodar(msg(img(), 'alertar'))).toBe('ignorar')
    expect(v.create).toHaveBeenCalledTimes(1)
  })
  it('imagem sem texto pedido (capa): não chama a visão, não regera e grava alertas = []', async () => {
    // Teste real 12/11: a visão lia o rótulo do produto como texto a mais e toda capa regerava.
    db.galeria_imagens = [linha({ missao: 1 })]
    v.create.mockResolvedValue(respOR(IMG(), 0.05))
    conferir!.mockResolvedValue([{ tipo: 'texto_extra', nota: 'AMIGURUMI' }])
    expect(await rodar()).toBe('gerada')
    expect(conferir).not.toHaveBeenCalled()
    expect(img()).toMatchObject({ status: 'gerada', alertas: [], tentativa: 1 })
    expect(chamadasProvedor()).toBe(1)
  })
  it('visão indisponível na 1ª tentativa: conclui (não regera) e deixa a conferência para a fase alertar', async () => {
    v.create.mockResolvedValue(respOR(IMG(), 0.05))
    conferir!.mockResolvedValue(INDISP)
    expect(await rodar()).toBe('gerada')
    expect(img()).toMatchObject({ status: 'gerada', tentativa: 1 })
    expect(img().alertas ?? null).toBeNull()
    expect(chamadasProvedor()).toBe(1)
    // A fase alertar lê pela URL assinada; se a visão seguir fora do ar, aí sim grava o indisponível (nunca fica null).
    expect(await rodar(msg(img(), 'alertar'))).toBe('alertada')
    expect(img().alertas).toEqual(INDISP)
  })
  it('perdeu a posse antes de soltar a imagem divergente → perdeu_posse, sem custo gravado', async () => {
    v.create.mockImplementation(async () => {
      Object.assign(img(), { posse: 'outro-worker', lease_ate: iso(T0 + 999_000) })
      return respOR(IMG(), 0.05)
    })
    conferir!.mockResolvedValue(FALTANDO)
    expect(await rodar()).toBe('perdeu_posse')
    expect(img()).toMatchObject({ posse: 'outro-worker', custo_usd: null })
  })
})

describe('Higgsfield', () => {
  beforeEach(() => {
    Object.assign(img(), { modelo: 'alibaba/qwen-image-3/edit', provedor: 'higgsfield' })
  })
  it('submete (uma requisição, referência no corpo) e grava provider_request_id + gerando', async () => {
    expect(await rodar()).toBe('gerando')
    expect(fetchs).toHaveLength(1)
    const corpo = JSON.parse(fetchs[0].body!)
    expect(fetchs[0].url).toBe('https://api.higgsfield.ai/alibaba/qwen-image-3/edit')
    expect(corpo.image_urls).toEqual(['https://signed/org/galeria-ia/famB/referencias/rosa-bebe-frente-sha.jpg'])
    expect(corpo.prompt_extend).toBe(true)
    expect(img()).toMatchObject({ status: 'gerando', provider_request_id: 'hf-1', tentativa: 1, fase: 1, posse: null, lease_ate: null })
    expect(img().prompt).toContain('mesa de costura')
  })
  it('Higgsfield: prompt do plano, 3:4, sem conferência inline', async () => {
    Object.assign(img(), { modelo: 'xai/grok-imagine-image-2.0' })
    expect(await rodar()).toBe('gerando')
    const corpo = JSON.parse(fetchs[0].body!)
    expect(fetchs[0].url).toBe('https://api.higgsfield.ai/xai/grok-imagine-image-2.0')
    expect(corpo.aspect_ratio).toBe('3:4')
    expect(corpo.prompt).toContain('fio na cor Rosa Bebê')
    expect(corpo.prompt).toContain('"FIO PARA CRIAR"')
    hf.status = () => new Response(JSON.stringify({ status: 'completed', images: [{ url: 'https://cdn.hf/x.jpg' }] }))
    expect(await rodar(msg(img(), 'consultar'))).toBe('gerada')
    expect(img()).toMatchObject({ status: 'gerada', alertas: null }) // os alertas vêm da fase alertar
    expect(conferir).not.toHaveBeenCalled()
  })
  it('submeterHF 502 → uma requisição, lease solto e a regra de tentativa segue', async () => {
    hf.submit = () => new Response('bad gateway', { status: 502 })
    await rodar()
    expect(fetchs).toHaveLength(1)
    expect(img()).toMatchObject({ status: 'submetendo', tentativa: 1, provider_request_id: null, posse: null })
  })
  it('consulta pendente só libera o lease; concluída baixa e grava gerada', async () => {
    await rodar()
    agora += 60_000
    expect(await rodar(msg(img(), 'consultar'))).toBe('pendente')
    expect(img()).toMatchObject({ status: 'gerando', posse: null, lease_ate: null, fase: 1 })
    hf.status = () => new Response(JSON.stringify({ status: 'completed', images: [{ url: 'https://cdn.hf/x.jpg' }] }))
    expect(await rodar(msg(img(), 'consultar'))).toBe('gerada')
    expect(img()).toMatchObject({ status: 'gerada', custo_usd: 0.04, fase: 2 })
    expect(img().cena_path).toMatch(/\.jpg$/)
  })
  it('roteiro novo aprovado enquanto gerando → conclui desatualizada', async () => {
    await rodar()
    db.galeria_roteiros[0].status = 'desatualizado'
    hf.status = () => new Response(JSON.stringify({ status: 'completed', images: [{ url: 'https://cdn.hf/x.jpg' }] }))
    expect(await rodar(msg(img(), 'consultar'))).toBe('desatualizada')
  })
  it('referência assinada por mais que o prazo inteiro (a Higgsfield baixa quando processa)', async () => {
    const validades: number[] = []
    const orig = fake.admin.storage.from
    fake.admin.storage.from = (b: string) => {
      const o = orig(b)
      return { ...o, createSignedUrl: (p: string, s: number) => { validades.push(s); return o.createSignedUrl(p) } }
    }
    await rodar()
    expect(validades).toHaveLength(1)
    expect(validades[0]).toBeGreaterThanOrEqual(VALIDADE_REFERENCIA_S)
    expect(VALIDADE_REFERENCIA_S * 1000).toBeGreaterThan(PRAZO_GERACAO_MS)
  })
  it('consulta final concluída + 502 no download → só solta o lease; o tick seguinte baixa e grava gerada', async () => {
    await rodar()
    agora = T0 + 12 * 60_000 + 1
    hf.status = () => new Response(JSON.stringify({ status: 'completed', images: [{ url: 'https://cdn.hf/x.jpg' }] }))
    const bom = hf.download
    hf.download = () => new Response('bad gateway', { status: 502 })
    expect(await rodar(msg(img(), 'consultar'))).toBe('liberada')
    expect(img()).toMatchObject({ status: 'gerando', posse: null, lease_ate: null, cena_path: null, erro: null })
    hf.download = bom
    agora += 60_000
    expect(await rodar(msg(img(), 'consultar'))).toBe('gerada')
    expect(img()).toMatchObject({ status: 'gerada', custo_usd: 0.04 })
  })
  it('consulta final com erro de rede na consulta → só solta o lease (o relógio no banco é o teto)', async () => {
    await rodar()
    agora = T0 + 12 * 60_000 + 1
    hf.status = () => { throw new TypeError('network') }
    expect(await rodar(msg(img(), 'consultar'))).toBe('liberada')
    expect(img()).toMatchObject({ status: 'gerando', posse: null, erro: null })
  })
  it('passado o prazo de 12 min: consulta final; pendente → falhou sem custo', async () => {
    await rodar()
    agora = T0 + 12 * 60_000 + 1
    expect(await rodar(msg(img(), 'consultar'))).toBe('falhou')
    expect(img()).toMatchObject({ status: 'falhou', cena_path: null, custo_usd: null, erro: 'prazo_esgotado' })
  })
})

// Fase alertar pelo conferirTexto REAL sobre o mock do OpenRouter (prova a troca de verificarCena por conferirTexto).
describe('visão (fase própria)', () => {
  beforeEach(() => { conferir = undefined })
  const gerada = (extra: Linha = {}) => Object.assign(img(), { status: 'gerada', cena_path: 'org/c.jpg', custo_usd: 0.04, fase: 1, tentativa: 1, ...extra })
  const lidos = (textos: string[]) => ({ choices: [{ message: { content: JSON.stringify({ textos }) } }] })
  it('fase alertar (Higgsfield, ou gravação dos alertas que falhou) grava os alertas de conferirTexto', async () => {
    gerada()
    v.create.mockResolvedValue(lidos(['FIO PARA CRIAR', 'MATERIAL RESISTENTE']))
    expect(await rodar(msg(img(), 'alertar'))).toBe('alertada')
    expect(img().alertas).toEqual([
      { tipo: 'texto_faltando', nota: '254 METROS' }, { tipo: 'texto_extra', nota: 'MATERIAL RESISTENTE' },
    ])
    const [corpo, opcoes] = v.create.mock.calls[0]
    expect(corpo.messages[1].content[1].image_url.url).toBe('https://signed/org/c.jpg')
    expect(opcoes.maxRetries).toBe(0)
    expect(chamadasProvedor()).toBe(0)
  })
  it('claim de alertar numa gerada não muda status, fase nem tentativa e nunca chama o gerador', async () => {
    gerada()
    v.create.mockResolvedValue(lidos(ESPERADOS))
    expect(await rodar(msg(img(), 'alertar'))).toBe('alertada')
    expect(img()).toMatchObject({ status: 'gerada', fase: 1, tentativa: 1, cena_path: 'org/c.jpg', custo_usd: 0.04, posse: null, lease_ate: null })
    expect(img().alertas).toEqual([])
    expect(chamadasProvedor()).toBe(0)
  })
  it('descartada com alertas nulos também recebe a visão', async () => {
    gerada({ status: 'descartada' })
    v.create.mockResolvedValue(lidos(ESPERADOS))
    expect(await rodar(msg(img(), 'alertar'))).toBe('alertada')
    expect(img()).toMatchObject({ status: 'descartada', alertas: [] })
  })
  it('fase alertar com visão fora do ar grava verificacao_indisponivel', async () => {
    gerada()
    v.create.mockRejectedValue(erroHTTP(502))
    expect(await rodar(msg(img(), 'alertar'))).toBe('alertada')
    expect(v.create).toHaveBeenCalledTimes(1)
    expect(img().alertas).toEqual([expect.objectContaining({ tipo: 'verificacao_indisponivel' })])
    expect(img()).toMatchObject({ status: 'gerada', cena_path: 'org/c.jpg', tentativa: 1 })
  })
  it('roteiro que não é plano ou posição ausente → verificacao_indisponivel sem chamar a visão (nunca fica null)', async () => {
    gerada()
    db.galeria_roteiros[0].conteudo = { categoria: 'Rendas', contrato: 'Renda', missoes: [] }
    expect(await rodar(msg(img(), 'alertar'))).toBe('alertada')
    expect(img().alertas).toEqual([expect.objectContaining({ tipo: 'verificacao_indisponivel' })])
    db.galeria_roteiros[0].conteudo = plano()
    db.galeria_imagens = [linha({ missao: 9 })]
    gerada()
    expect(await rodar(msg(img(), 'alertar'))).toBe('alertada')
    expect(img().alertas).toEqual([expect.objectContaining({ tipo: 'verificacao_indisponivel' })])
    expect(v.create).not.toHaveBeenCalled()
  })
  it('queda durante a visão → lease vence e repete só a visão, sem nova geração nem custo', async () => {
    gerada({ posse: 'morta', lease_ate: iso(T0 + 30_000) })
    expect(await rodar(msg(img(), 'alertar'))).toBe('ocupado')
    agora = T0 + 31_000
    v.create.mockResolvedValue(lidos(ESPERADOS))
    expect(await rodar(msg(img(), 'alertar'))).toBe('alertada')
    expect(chamadasProvedor()).toBe(0)
    expect(img()).toMatchObject({ custo_usd: 0.04, tentativa: 1 })
  })
  it('geração com a conferência inline real: a visão roda uma vez e a mensagem de alertar seguinte é ignorada', async () => {
    v.create.mockResolvedValueOnce(respOR(IMG())).mockResolvedValueOnce(lidos(ESPERADOS))
    expect(await rodar()).toBe('gerada')
    expect(img().alertas).toEqual([])
    expect(v.create.mock.calls[1][0].messages[1].content[1].image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(await rodar(msg(img(), 'alertar'))).toBe('ignorar')
    expect(v.create).toHaveBeenCalledTimes(2)
    expect(chamadasProvedor()).toBe(1)
  })
})

describe('cobrança e recorte', () => {
  it('recorte nunca vai ao provedor nem à visão; nada é cobrado pelo worker', async () => {
    db.galeria_imagens = [linha({ origem: 'recorte', status: 'gerada', alertas: [], cena_path: null })]
    expect(await rodar()).toBe('ignorar')
    expect(v.create).not.toHaveBeenCalled()
    expect(fetchs).toHaveLength(0)
  })
  it('nenhuma entrega faturável em todo o ciclo (regeração + conclusão + visão)', async () => {
    v.create.mockResolvedValueOnce(respOR(IMG())).mockResolvedValueOnce(respOR(IMG()))
    conferir!.mockResolvedValueOnce(FALTANDO).mockResolvedValueOnce([])
    await rodar()
    await rodar()
    await rodar(msg(img(), 'alertar'))
    expect(db.platform_image_deliveries).toHaveLength(0)
    expect(fake.rpcs.map((r) => r.nome)).toEqual(['galeria_concluir_geracao'])
  })
})
