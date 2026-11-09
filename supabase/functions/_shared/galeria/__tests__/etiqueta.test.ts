// Task 6b: leitura da etiqueta por visão (R1.3/R1.6). Sem rede: visão e ML mockados.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from './fake-admin'

const v = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: v.create } } }) }))
vi.mock('../../canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))

const { lerEtiquetaPorVisao, conferirEtiqueta, CAMPO_ETIQUETA } = await import('../etiqueta')
const { lerFicha } = await import('../referencias')

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fotosItem: string[]
let fotosBaixadas: string[]

const resposta = (campos: unknown[]) => ({ choices: [{ message: { content: JSON.stringify({ campos }) } }], usage: {} })
const lido = (campo: string, valor: string, foto = 1, caixa = { x: 0.1, y: 0.2, w: 0.3, h: 0.2 }) =>
  ({ campo, situacao: 'lido', valor, foto, caixa })
const FOTO = { url: 'https://x/1.jpg', sha256: 'sha-1', origem: 'referencia' as const, ref: 'org/ref/1.jpg' }

// Anúncio já carregado (formato de carregarAnuncio): um SKU, família vigente famB.
const anuncio = () => ({
  anuncioId: 'an1', codigoPai: '100', skus: ['100P'], itemPorSku: { '100P': 'MLB1' },
  vigente: db.familias[0] as never,
  porSku: { '100P': { codigo: '100P', cor: 'Preto', imagem_path: null, comprimento_cm: 60, familia_id: 'famB', publicado_em: '2026-11-05T10:00:00Z' } },
})
const refs = [{ id: 'r1', path: 'org/galeria-ia/famB/referencias/preto-frente-shaR.jpg', sha256: 'shaR' }]
const conferir = async () => {
  const a = anuncio()
  return conferirEtiqueta(fake.admin as never, 'org', a, { refs, fatos: await lerFicha(fake.admin as never, 'org', a), aplicadas: new Set(['P_APL']) })
}
const fato = async (campo: string) => (await lerFicha(fake.admin as never, 'org', anuncio())).find((f) => f.campo === campo)

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
  fotosItem = ['P_CAPA', 'P_APL', 'P_ETQ']
  fotosBaixadas = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) {
      return Response.json({ id: 'MLB1', pictures: fotosItem.map((id) => ({ id })), variations: [] })
    }
    const pic = url.match(/^https:\/\/api\.mercadolibre\.com\/pictures\/(\w+)$/)
    if (pic) { fotosBaixadas.push(pic[1]); return Response.json({ variations: [{ secure_url: `https://ml/${pic[1]}.jpg` }] }) }
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

  it('mesmo valor com formatação diferente → consistente; medida "60 cm" ≡ 60; origem só NACIONAL/IMPORTADO', async () => {
    v.create.mockResolvedValueOnce(resposta([
      lido('atributo:MAIN_MATERIAL', 'Poliéster 100%'), lido('comprimento_cm', '60 cm'),
      lido('origem', 'Made in China'), lido('marca', 'AVIL'),
    ]))
    const r = await lerEtiquetaPorVisao({
      fotos: [FOTO], campos: ['atributo:MAIN_MATERIAL', 'comprimento_cm', 'origem', 'marca'],
      cadastro: { 'atributo:MAIN_MATERIAL': '100% POLIÉSTER', comprimento_cm: '60', origem: 'IMPORTADO', marca: 'Avil' },
    })
    expect(r['atributo:MAIN_MATERIAL'].estado).toBe('consistente')
    expect(r.comprimento_cm).toMatchObject({ estado: 'consistente', valor_lido: '60' })
    // Texto livre de origem nunca vira divergência (IMPORTADO ≢ "Made in China" seria trava falsa).
    expect(r.origem.estado).toBe('inconclusiva')
    expect(r.marca.estado).toBe('consistente')
  })

  it('resposta ilegível ou fora do formato → todos indisponivel (nunca consistente por omissão)', async () => {
    v.create.mockResolvedValueOnce({ choices: [{ message: { content: 'não consegui ler' } }] })
    const r = await lerEtiquetaPorVisao({ fotos: [FOTO], campos: ['marca', 'origem'], cadastro: { marca: 'Avil', origem: 'IMPORTADO' } })
    expect(Object.values(r).map((x) => x.estado)).toEqual(['indisponivel', 'indisponivel'])
  })

  it('campo omitido, foto fora da lista ou caixa fora de [0,1] → indisponivel; ilegível → inconclusiva', async () => {
    v.create.mockResolvedValueOnce(resposta([
      lido('marca', 'Avil', 7), lido('origem', 'IMPORTADO', 1, { x: 0.5, y: 0.5, w: 0.9, h: 0.1 }),
      { campo: 'peso_gramas', situacao: 'ilegivel', valor: null, foto: null, caixa: null },
    ]))
    const r = await lerEtiquetaPorVisao({
      fotos: [FOTO], campos: ['marca', 'origem', 'peso_gramas', 'altura_cm'],
      cadastro: { marca: 'Avil', origem: 'IMPORTADO', peso_gramas: '150', altura_cm: '2' },
    })
    expect(Object.fromEntries(Object.entries(r).map(([k, x]) => [k, x.estado])))
      .toEqual({ marca: 'indisponivel', origem: 'indisponivel', peso_gramas: 'inconclusiva', altura_cm: 'indisponivel' })
  })

  it('maxRetries 0 e timeout aplicados na chamada', async () => {
    v.create.mockResolvedValueOnce(resposta([]))
    await lerEtiquetaPorVisao({ fotos: [FOTO], campos: ['marca'], cadastro: { marca: 'Avil' } })
    const opcoes = v.create.mock.calls[0][1]
    expect(opcoes.maxRetries).toBe(0)
    expect(opcoes.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('conferirEtiqueta + lerFicha', () => {
  it('Renda Búfalo: cadastro 100% POLIÉSTER, etiqueta 100% Poliamida → ficha DIVERGENTE com recorte; sem cobrança', async () => {
    v.create.mockResolvedValueOnce(resposta([lido('atributo:MAIN_MATERIAL', '100% Poliamida', 2)]))
    expect(await conferir()).toBe(true)
    const f = await fato('atributo:MAIN_MATERIAL')
    expect(f).toMatchObject({ estado: 'DIVERGENTE', etiqueta: { valor: '100% Poliamida', caixa: { x: 0.1 }, foto: { origem: 'ml', ref: 'P_ETQ' } } })
    // Marca CONFIRMADA não achada na etiqueta → NAO_CONFERIDO ("não conferido na etiqueta").
    expect((await fato('marca'))?.estado).toBe('NAO_CONFERIDO')
    // Só a linha sentinela em galeria_fatos; nada em platform_image_deliveries.
    expect(fake.escritas.map((e) => e.tabela)).toEqual(['galeria_fatos'])
    expect(db.platform_image_deliveries ?? []).toEqual([])
    // A sentinela não vira fato.
    expect(await fato(CAMPO_ETIQUETA)).toBeUndefined()
  })

  it('foto aplicada pela galeria nunca vai à visão; referência vai por URL assinada; só campos de etiqueta', async () => {
    v.create.mockResolvedValueOnce(resposta([]))
    await conferir()
    const conteudo = v.create.mock.calls[0][0].messages[1].content as Array<{ type: string; image_url?: { url: string }; text?: string }>
    const urls = conteudo.filter((c) => c.type === 'image_url').map((c) => c.image_url!.url)
    expect(urls).toEqual(['https://ml/P_CAPA.jpg', 'https://ml/P_ETQ.jpg', 'https://signed/org/galeria-ia/famB/referencias/preto-frente-shaR.jpg'])
    expect(fotosBaixadas).not.toContain('P_APL')
    const pedido = JSON.parse(conteudo[0].text!.slice(conteudo[0].text!.indexOf('{')))
    expect(pedido.campos.map((c: { campo: string }) => c.campo).sort()).toEqual(['atributo:MAIN_MATERIAL', 'comprimento_cm', 'marca', 'origem'])
  })

  it('segunda conferência sem mudança não chama a visão; foto nova → nova leitura', async () => {
    v.create.mockResolvedValue(resposta([lido('atributo:MAIN_MATERIAL', '100% Poliamida')]))
    await conferir()
    expect(await conferir()).toBe(false)
    expect(v.create).toHaveBeenCalledTimes(1)
    fotosItem = [...fotosItem, 'P_NOVA']
    expect(await conferir()).toBe(true)
    expect(v.create).toHaveBeenCalledTimes(2)
  })

  it('corrigir o cadastro para o valor da etiqueta → consistente sem nova visão (comparação é do código)', async () => {
    v.create.mockResolvedValueOnce(resposta([lido('atributo:MAIN_MATERIAL', '100% Poliamida')]))
    await conferir()
    ;(db.familias[0].atributos_ml as Linha[])[0].value_name = 'Poliamida'
    expect(await conferir()).toBe(false)
    expect(v.create).toHaveBeenCalledTimes(1)
    expect((await fato('atributo:MAIN_MATERIAL'))?.estado).toBe('SUGERIDO')
  })

  it('falha de transporte → todos indisponivel gravados (nunca a leitura antiga) e a próxima conferência tenta de novo', async () => {
    v.create.mockResolvedValueOnce(resposta([lido('marca', 'Avil')]))
    await conferir()
    expect((await fato('marca'))?.estado).toBe('CONFIRMADO')
    fotosItem = [...fotosItem, 'P_NOVA']
    v.create.mockRejectedValueOnce(new Error('timeout'))
    expect(await conferir()).toBe(true)
    expect((await fato('marca'))?.estado).toBe('NAO_CONFERIDO')
    v.create.mockResolvedValueOnce(resposta([lido('marca', 'Avil')]))
    await conferir()
    expect(v.create).toHaveBeenCalledTimes(3)
    expect((await fato('marca'))?.estado).toBe('CONFIRMADO')
  })

  it('sem campos de etiqueta ou sem foto → não chama a visão', async () => {
    db.familias[0] = { ...db.familias[0], marca: null, origem: null, atributos_ml: [] }
    const a = { ...anuncio(), porSku: {} }
    await conferirEtiqueta(fake.admin as never, 'org', a as never, { refs, fatos: await lerFicha(fake.admin as never, 'org', a as never), aplicadas: new Set() })
    expect(v.create).not.toHaveBeenCalled()
  })
})
