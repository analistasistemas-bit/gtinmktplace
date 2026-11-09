// Task 6b: leitura da etiqueta por visão (R1.3/R1.6). Sem rede: visão e ML mockados.
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from './fake-admin'

const v = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: v.create } } }) }))
vi.mock('../../canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))

const { lerEtiquetaPorVisao, conferirEtiqueta, MAX_FOTOS } = await import('../etiqueta')
const { lerFicha } = await import('../referencias')

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fotosItem: string[]
let bytesFoto: Record<string, string>
let fotosBaixadas: string[]
let refs: Array<{ id: string; path: string; sha256: string }>

const hex = (s: string) => createHash('sha256').update(new TextEncoder().encode(s)).digest('hex')
const resposta = (campos: unknown[]) => ({ choices: [{ message: { content: JSON.stringify({ campos }) } }], usage: {} })
const lido = (campo: string, valor: string, foto = 1, caixa = { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }) =>
  ({ campo, situacao: 'lido', valor, foto, caixa })
const FOTO = { url: 'https://x/1.jpg', sha256: 'sha-1', origem: 'referencia' as const, ref: 'org/ref/1.jpg' }
const tabela = () => db.galeria_leituras_etiqueta ?? []

// Anúncio já carregado (formato de carregarAnuncio): um SKU, família vigente = db.familias[0].
const anuncio = () => ({
  anuncioId: 'an1', codigoPai: '100', skus: ['100P'], itemPorSku: { '100P': 'MLB1' },
  vigente: db.familias[0] as never,
  porSku: { '100P': { codigo: '100P', cor: 'Preto', imagem_path: null, comprimento_cm: 60, familia_id: 'famB', publicado_em: '2026-11-05T10:00:00Z' } },
})
const conferir = async (descartados: string[] = []) => {
  const a = anuncio()
  return conferirEtiqueta(fake.admin as never, 'org', a, {
    refs, fatos: await lerFicha(fake.admin as never, 'org', a), descartados, aplicadas: new Set(['P_APL']),
  })
}
const fato = async (campo: string) => (await lerFicha(fake.admin as never, 'org', anuncio())).find((f) => f.campo === campo)
const urlsEnviadas = (chamada = 0) =>
  (v.create.mock.calls[chamada][0].messages[1].content as Array<{ type: string; image_url?: { url: string } }>)
    .filter((c) => c.type === 'image_url').map((c) => c.image_url!.url)

beforeEach(() => {
  v.create.mockReset()
  db = {
    familias: [{
      id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', nome_pai: 'Renda Búfalo',
      marca: 'Avil', origem: 'IMPORTADO',
      atributos_ml: [{ id: 'MAIN_MATERIAL', name: 'Material', value_name: '100% POLIÉSTER' }, { id: 'PATTERN', value_name: 'Floral' }],
      variacoes: [],
    }],
    galeria_fatos: [],
  }
  fake = fakeAdmin(db)
  refs = [{ id: 'r1', path: 'org/galeria-ia/famB/referencias/preto-frente-shaR.jpg', sha256: hex('ref-preto') }]
  fotosItem = ['P_CAPA', 'P_APL', 'P_ETQ']
  bytesFoto = {}
  fotosBaixadas = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) {
      return Response.json({ id: 'MLB1', pictures: fotosItem.map((id) => ({ id })), variations: [] })
    }
    const pic = url.match(/^https:\/\/api\.mercadolibre\.com\/pictures\/(\w+)$/)
    if (pic) { fotosBaixadas.push(pic[1]); return Response.json({ variations: [{ secure_url: `https://ml/${pic[1]}.jpg` }] }) }
    const ml = url.match(/^https:\/\/ml\/(\w+)\.jpg$/)
    if (ml) return new Response(new TextEncoder().encode(bytesFoto[ml[1]] ?? ml[1]))
    return new Response('{}', { status: 404 })
  }))
})

describe('lerEtiquetaPorVisao', () => {
  it('regata: cadastro Poliamida, etiqueta 96% poliéster → divergente com foto e caixa', async () => {
    v.create.mockResolvedValueOnce(resposta([lido('atributo:MAIN_MATERIAL', '96% poliéster')]))
    const r = await lerEtiquetaPorVisao({ fotos: [FOTO], campos: ['atributo:MAIN_MATERIAL'], cadastro: { 'atributo:MAIN_MATERIAL': 'Poliamida' } })
    expect(r['atributo:MAIN_MATERIAL']).toEqual({
      estado: 'divergente', valor_lido: '96% poliéster', foto_sha256: 'sha-1', foto: { origem: 'referencia', ref: 'org/ref/1.jpg' },
      caixa: { x: 0.1, y: 0.2, w: 0.3, h: 0.2 },
    })
  })

  it('formatação diferente → consistente; unidades convertidas (500 g ≡ 0,5 kg; 60 cm; 600 mm)', async () => {
    v.create.mockResolvedValueOnce(resposta([
      lido('atributo:MAIN_MATERIAL', 'Poliéster 100%'), lido('comprimento_cm', '600 mm'), lido('peso_gramas', '0,5 kg'),
      lido('atributo:WEIGHT', '500 g'), lido('marca', 'AVIL'),
    ]))
    const r = await lerEtiquetaPorVisao({
      fotos: [FOTO], campos: ['atributo:MAIN_MATERIAL', 'comprimento_cm', 'peso_gramas', 'atributo:WEIGHT', 'marca'],
      cadastro: { 'atributo:MAIN_MATERIAL': '100% POLIÉSTER', comprimento_cm: '60', peso_gramas: '500', 'atributo:WEIGHT': '0,5 kg', marca: 'Avil' },
    })
    expect(Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.estado]))).toEqual({
      'atributo:MAIN_MATERIAL': 'consistente', comprimento_cm: 'consistente', peso_gramas: 'consistente', 'atributo:WEIGHT': 'consistente', marca: 'consistente',
    })
    expect(r.comprimento_cm).toMatchObject({ valor_lido: '60', valor_cru: '600 mm' })
  })

  it('resposta ilegível ou fora do formato → todos indisponivel (nunca consistente por omissão)', async () => {
    v.create.mockResolvedValueOnce({ choices: [{ message: { content: 'não consegui ler' } }] })
    const r = await lerEtiquetaPorVisao({ fotos: [FOTO], campos: ['marca', 'atributo:BRAND'], cadastro: { marca: 'Avil', 'atributo:BRAND': 'Avil' } })
    expect(Object.values(r).map((x) => x.estado)).toEqual(['indisponivel', 'indisponivel'])
  })

  it('campo omitido, foto fora da lista ou caixa fora de [0,1] → indisponivel; ilegível → inconclusiva; parcial: não achado → inconclusiva', async () => {
    const corpo = resposta([
      lido('marca', 'Avil', 7), lido('atributo:BRAND', 'Avil', 1, { x: 0.5, y: 0.5, w: 0.9, h: 0.1 }),
      { campo: 'peso_gramas', situacao: 'ilegivel', valor: null, foto: null, caixa: null },
      { campo: 'largura_cm', situacao: 'ausente', valor: null, foto: null, caixa: null },
    ])
    const entrada = {
      fotos: [FOTO], campos: ['marca', 'atributo:BRAND', 'peso_gramas', 'largura_cm', 'altura_cm'],
      cadastro: { marca: 'Avil', 'atributo:BRAND': 'Avil', peso_gramas: '150', largura_cm: '3', altura_cm: '2' },
    }
    v.create.mockResolvedValueOnce(corpo)
    const estados = (r: Record<string, { estado: string }>) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.estado]))
    expect(estados(await lerEtiquetaPorVisao(entrada)))
      .toEqual({ marca: 'indisponivel', 'atributo:BRAND': 'indisponivel', peso_gramas: 'inconclusiva', largura_cm: 'indisponivel', altura_cm: 'indisponivel' })
    v.create.mockResolvedValueOnce(corpo)
    expect(estados(await lerEtiquetaPorVisao({ ...entrada, parcial: true })))
      .toEqual({ marca: 'inconclusiva', 'atributo:BRAND': 'inconclusiva', peso_gramas: 'inconclusiva', largura_cm: 'inconclusiva', altura_cm: 'inconclusiva' })
  })

  it('maxRetries 0 e AbortSignal.timeout(60000) na chamada', async () => {
    const espia = vi.spyOn(AbortSignal, 'timeout')
    v.create.mockResolvedValueOnce(resposta([]))
    await lerEtiquetaPorVisao({ fotos: [FOTO], campos: ['marca'], cadastro: { marca: 'Avil' } })
    expect(espia).toHaveBeenCalledWith(60_000)
    const opcoes = v.create.mock.calls[0][1]
    expect(opcoes.maxRetries).toBe(0)
    expect(opcoes.signal).toBe(espia.mock.results[0].value)
    espia.mockRestore()
  })
})

describe('conferirEtiqueta + lerFicha', () => {
  it('Renda Búfalo: cadastro 100% POLIÉSTER, etiqueta 100% Poliamida → ficha DIVERGENTE com recorte; sem cobrança', async () => {
    v.create.mockResolvedValueOnce(resposta([lido('atributo:MAIN_MATERIAL', '100% Poliamida', 3)]))
    expect(await conferir()).toBe(true)
    const f = await fato('atributo:MAIN_MATERIAL')
    expect(f).toMatchObject({
      estado: 'DIVERGENTE',
      etiqueta: { valor: '100% Poliamida', caixa: { x: 0.1 }, foto: { origem: 'ml', ref: 'P_ETQ' } },
    })
    // Marca CONFIRMADA não achada na etiqueta → NAO_CONFERIDO ("não conferido na etiqueta").
    expect((await fato('marca'))?.estado).toBe('NAO_CONFERIDO')
    // Só a tabela da leitura recebe escrita; nada em galeria_fatos nem em platform_image_deliveries.
    expect(fake.escritas.map((e) => e.tabela)).toEqual(['galeria_leituras_etiqueta'])
    expect(db.platform_image_deliveries ?? []).toEqual([])
    expect(tabela()[0]).toMatchObject({ org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', falhou: false, parcial: false })
    expect((tabela()[0].leitura as Linha)['atributo:MAIN_MATERIAL']).toMatchObject({ foto_sha256: hex('P_ETQ') })
  })

  it('referências primeiro, depois ML; foto aplicada nunca vai; foto do ML igual a uma referência não vai duas vezes', async () => {
    bytesFoto = { P_CAPA: 'ref-preto' } // P_CAPA virou a referência da frente (mesmo sha)
    v.create.mockResolvedValueOnce(resposta([]))
    await conferir()
    expect(urlsEnviadas()).toEqual(['https://signed/org/galeria-ia/famB/referencias/preto-frente-shaR.jpg', 'https://ml/P_ETQ.jpg'])
    expect(fotosBaixadas).not.toContain('P_APL')
    const texto = (v.create.mock.calls[0][0].messages[1].content[0] as { text: string }).text
    const pedido = JSON.parse(texto.slice(texto.indexOf('{')))
    expect(pedido.campos.map((c: { campo: string }) => c.campo).sort()).toEqual(['atributo:MAIN_MATERIAL', 'comprimento_cm', 'marca'])
  })

  it('teto: 6 cores × 3 fotos → referências primeiro, corta no teto, grava parcial e não achado vira inconclusiva', async () => {
    const cores = ['preto', 'branco', 'azul', 'rosa', 'verde', 'cinza']
    refs = cores.map((c, i) => ({ id: `r${i}`, path: `org/galeria-ia/famB/referencias/${c}-frente.jpg`, sha256: hex(`ref-${c}`) }))
    fotosItem = cores.flatMap((c) => [`P_${c}1`, `P_${c}2`, `P_${c}3`])
    bytesFoto = { P_preto1: 'ref-preto' }
    v.create.mockResolvedValueOnce(resposta([lido('atributo:MAIN_MATERIAL', '100% POLIÉSTER', 1)]))
    await conferir()
    const urls = urlsEnviadas()
    expect(urls).toHaveLength(MAX_FOTOS)
    expect(urls.slice(0, 6)).toEqual(cores.map((c) => `https://signed/org/galeria-ia/famB/referencias/${c}-frente.jpg`))
    expect(urls).not.toContain('https://ml/P_preto1.jpg')
    expect(tabela()[0]).toMatchObject({ parcial: true, falhou: false })
    expect((tabela()[0].leitura as Record<string, Linha>).marca.estado).toBe('inconclusiva')
  })

  it('segunda conferência sem mudança não chama a visão; foto nova → nova leitura; família vigente nova → nova leitura', async () => {
    v.create.mockResolvedValue(resposta([lido('atributo:MAIN_MATERIAL', '100% Poliamida')]))
    await conferir()
    expect(await conferir()).toBe(false)
    expect(v.create).toHaveBeenCalledTimes(1)
    fotosItem = [...fotosItem, 'P_NOVA']
    expect(await conferir()).toBe(true)
    expect(v.create).toHaveBeenCalledTimes(2)
    db.familias[0] = { ...db.familias[0], id: 'famC' }
    expect(await conferir()).toBe(true)
    expect(v.create).toHaveBeenCalledTimes(3)
    expect(tabela().map((l) => l.familia_id)).toEqual(['famB', 'famC'])
  })

  it('descarte editorial: o campo descartado não volta como sugestão da etiqueta e não muda a chave', async () => {
    v.create.mockResolvedValueOnce(resposta([lido('atributo:MAIN_MATERIAL', '100% Poliamida')]))
    await conferir()
    db.galeria_fatos.push({ org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: '100% POLIÉSTER', origem: 'confirmado_operador', evidencia: {}, descartado: true })
    expect(await fato('atributo:MAIN_MATERIAL')).toBeUndefined()
    expect(await conferir(['atributo:MAIN_MATERIAL'])).toBe(false)
    expect(v.create).toHaveBeenCalledTimes(1)
  })

  it('falha da visão depois de mudança real → indisponivel para a chave nova (nunca a leitura velha); a próxima tenta de novo', async () => {
    v.create.mockResolvedValueOnce(resposta([lido('marca', 'Avil')]))
    await conferir()
    expect((await fato('marca'))?.estado).toBe('CONFIRMADO')
    fotosItem = [...fotosItem, 'P_NOVA']
    v.create.mockRejectedValueOnce(new Error('timeout'))
    expect(await conferir()).toBe(true)
    expect(tabela()[0]).toMatchObject({ falhou: true, chave: expect.any(String) })
    expect((await fato('marca'))?.estado).toBe('NAO_CONFERIDO')
    v.create.mockResolvedValueOnce(resposta([lido('marca', 'Outra Marca')]))
    expect(await conferir()).toBe(true)
    expect(v.create).toHaveBeenCalledTimes(3)
    expect((await fato('marca'))?.estado).toBe('DIVERGENTE')
  })

  it('ML fora do ar antes da chave, com leitura gravada → false, sem visão, leitura intacta', async () => {
    v.create.mockResolvedValueOnce(resposta([lido('marca', 'Avil')]))
    await conferir()
    const antes = structuredClone(tabela()[0])
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await conferir()).toBe(false)
    expect(v.create).toHaveBeenCalledTimes(1)
    expect(tabela()[0]).toEqual(antes)
  })

  it('primeira leitura que falha → todos indisponivel (marca NAO_CONFERIDO) e a próxima tenta de novo', async () => {
    v.create.mockRejectedValueOnce(new Error('timeout'))
    expect(await conferir()).toBe(true)
    expect((await fato('marca'))?.estado).toBe('NAO_CONFERIDO')
    v.create.mockResolvedValueOnce(resposta([lido('marca', 'Avil')]))
    expect(await conferir()).toBe(true)
    expect((await fato('marca'))?.estado).toBe('CONFIRMADO')
  })

  it('origem obedece o cadastro: NACIONAL + etiqueta "Made in China" → CONFIRMADO, sem trava nem sugestão; origem não vai à visão', async () => {
    db.familias[0] = { ...db.familias[0], origem: 'NACIONAL' }
    v.create.mockResolvedValueOnce(resposta([lido('origem', 'Made in China'), lido('marca', 'Avil')]))
    await conferir()
    const texto = (v.create.mock.calls[0][0].messages[1].content[0] as { text: string }).text
    expect(texto).not.toContain('origem')
    // Mesmo uma leitura gravada com origem divergente não conta.
    ;(tabela()[0].leitura as Record<string, Linha>).origem = { estado: 'divergente', valor_lido: 'IMPORTADO', foto: null, caixa: null, foto_sha256: null }
    const fs = await lerFicha(fake.admin as never, 'org', anuncio())
    expect(fs.filter((f) => f.campo === 'origem')).toEqual([expect.objectContaining({ estado: 'CONFIRMADO', valor: 'NACIONAL', origem: 'planilha' })])
    expect(fs.find((f) => f.campo === 'origem')?.etiqueta).toBeUndefined()
  })

  it('foto do ML com erro é pulada (6 refs + 20 do ML, a 18ª em 404 e a 3ª em 500): leitura normal, sem falhou; baixa só o necessário', async () => {
    const cores = ['preto', 'branco', 'azul', 'rosa', 'verde', 'cinza']
    refs = cores.map((c, i) => ({ id: `r${i}`, path: `org/galeria-ia/famB/referencias/${c}-frente.jpg`, sha256: hex(`ref-${c}`) }))
    fotosItem = Array.from({ length: 20 }, (_, i) => `P${i + 1}`)
    const baixadas: string[] = []
    const base = globalThis.fetch as unknown as (u: string) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const ml = url.match(/^https:\/\/ml\/(\w+)\.jpg$/)
      if (ml) baixadas.push(ml[1])
      if (url === 'https://ml/P18.jpg') return new Response('x', { status: 404 })
      if (url === 'https://ml/P3.jpg') return new Response('x', { status: 500 })
      return base(url)
    }))
    v.create.mockResolvedValueOnce(resposta([lido('marca', 'Avil', 8)]))
    await conferir()
    const urls = urlsEnviadas()
    expect(urls).toHaveLength(MAX_FOTOS)
    expect(urls.slice(6)).toEqual(['P1', 'P2', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'].map((p) => `https://ml/${p}.jpg`))
    expect(baixadas).not.toContain('P18') // só o necessário para o teto
    expect(tabela()[0]).toMatchObject({ falhou: false, parcial: true })
    expect((await fato('marca'))?.estado).toBe('CONFIRMADO')
  })

  it('a 18ª em 404 quando precisa ser baixada (sem refs, P2/P3 repetem P1): pulada, a 19ª completa o teto', async () => {
    refs = []
    fotosItem = Array.from({ length: 20 }, (_, i) => `P${i + 1}`)
    bytesFoto = { P2: 'P1', P3: 'P1' }
    const baixadas: string[] = []
    const base = globalThis.fetch as unknown as (u: string) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://ml/')) baixadas.push(url)
      return url === 'https://ml/P18.jpg' ? new Response('x', { status: 404 }) : base(url)
    }))
    v.create.mockResolvedValueOnce(resposta([lido('marca', 'Avil')]))
    await conferir()
    expect(baixadas).toContain('https://ml/P18.jpg')
    expect(urlsEnviadas()).toHaveLength(MAX_FOTOS)
    expect(urlsEnviadas()).not.toContain('https://ml/P18.jpg')
    expect(urlsEnviadas().at(-1)).toBe('https://ml/P19.jpg')
    expect(tabela()[0]).toMatchObject({ falhou: false })
  })

  it('nenhuma foto pôde ser lida → falhou com todos indisponivel, e a próxima tenta de novo', async () => {
    refs = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) return Response.json({ id: 'MLB1', pictures: [{ id: 'P1' }], variations: [] })
      if (url.startsWith('https://api.mercadolibre.com/pictures/')) return Response.json({ variations: [{ secure_url: 'https://ml/P1.jpg' }] })
      return new Response('x', { status: 404 })
    }))
    expect(await conferir()).toBe(true)
    expect(v.create).not.toHaveBeenCalled()
    expect(tabela()[0]).toMatchObject({ falhou: true })
    expect((await fato('marca'))?.estado).toBe('NAO_CONFERIDO')
  })

  it('sem campos de etiqueta → não chama a visão', async () => {
    db.familias[0] = { ...db.familias[0], marca: null, origem: null, atributos_ml: [] }
    const a = { ...anuncio(), porSku: {} }
    await conferirEtiqueta(fake.admin as never, 'org', a as never, { refs, fatos: await lerFicha(fake.admin as never, 'org', a as never), descartados: [], aplicadas: new Set() })
    expect(v.create).not.toHaveBeenCalled()
  })
})
