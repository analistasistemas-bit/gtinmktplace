import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, JPEG } from './fake-admin'

vi.mock('../../canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => { throw new Error('IA real proibida em teste') } }))

const { prepararReferencia, carregarFotosAplicadas, corSlug } = await import('../referencias')
const { resolverAnuncio, carregarAnuncio } = await import('../anuncio')

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fotosML: Record<string, string[]>
let chamadas: string[]

const famA = () => ({
  id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z',
  variacoes: [
    { codigo: '100P', cor: 'Preto', imagem_path: 'org/lote/00100P.jpg' },
    { codigo: '100M', cor: 'Preto', imagem_path: 'org/lote/00100P.jpg' },
    { codigo: '100B', cor: 'Off White', imagem_path: null },
  ],
})
// UPDATE publicou B sem imagem_path (a foto do lote não veio de novo).
const famB = () => ({
  id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z',
  variacoes: [
    { codigo: '100P', cor: 'Preto', imagem_path: null },
    { codigo: '100M', cor: 'Preto', imagem_path: null },
  ],
})

beforeEach(() => {
  db = {
    anuncios_externos: [{
      id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1',
      variacoes_externas: { '100P': { variation_id: 11 }, '100M': { variation_id: 12 }, '100B': { variation_id: 13 } },
    }],
    anuncios_externos_itens: [],
    familias: [famA()],
    profiles: [{ id: 'u1', org_id: 'org' }],
    galeria_referencias: [],
    galeria_imagem_itens: [],
  }
  fake = fakeAdmin(db, new Map([['org/lote/00100P.jpg', JPEG('real-preto')]]))
  fotosML = { 11: ['R1', 'R2'], 12: ['R1'], 13: [] }
  chamadas = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) {
      return Response.json({
        id: 'MLB1', pictures: [],
        variations: [
          { id: 11, seller_custom_field: '100P', picture_ids: fotosML[11] },
          { id: 12, seller_custom_field: '100M', picture_ids: fotosML[12] },
          { id: 13, seller_custom_field: '100B', picture_ids: fotosML[13] },
        ],
      })
    }
    const pic = url.match(/^https:\/\/api\.mercadolibre\.com\/pictures\/(\w+)$/)
    if (pic) return Response.json({ id: pic[1], variations: [{ secure_url: `https://http2.mlstatic.com/${pic[1]}-F.jpg` }] })
    const img = url.match(/^https:\/\/http2\.mlstatic\.com\/(\w+)-F\.jpg$/)
    if (img) return new Response(JPEG(`ml-${img[1]}`))
    return new Response('?', { status: 404 })
  }))
})

const ctx = async () => {
  const a = await carregarAnuncio(fake.admin as never, 'org', 'an1')
  if ('erro' in a) throw new Error(a.erro)
  return a
}

describe('resolverAnuncio / carregarAnuncio', () => {
  it('acha o anúncio pelo MLB da partição ou pelo filho UP; nenhum ou dois → anuncio_ambiguo', async () => {
    expect(await resolverAnuncio(fake.admin as never, 'org', 'MLB1')).toEqual({ anuncioId: 'an1' })
    db.anuncios_externos_itens.push({ anuncio_externo_id: 'an2', org_id: 'org', sku: 'X', item_externo_id: 'MLB9', retirado: false })
    expect(await resolverAnuncio(fake.admin as never, 'org', 'MLB9')).toEqual({ anuncioId: 'an2' })
    expect(await resolverAnuncio(fake.admin as never, 'org', 'MLB404')).toEqual({ erro: 'anuncio_ambiguo' })
    expect(await resolverAnuncio(fake.admin as never, 'outra', 'MLB1')).toEqual({ erro: 'anuncio_ambiguo' })
    db.anuncios_externos.push({ id: 'an3', org_id: 'org', canal: 'mercado_livre', codigo_pai: '200', item_externo_id: 'MLB1', variacoes_externas: {} })
    expect(await resolverAnuncio(fake.admin as never, 'org', 'MLB1')).toEqual({ erro: 'anuncio_ambiguo' })
  })

  it('vigente = família mais nova publicada com SKU vivo; dados por SKU = variação mais nova', async () => {
    db.familias.push(famB())
    const a = await ctx()
    expect(a.vigente.id).toBe('famB')
    expect(a.porSku['100P'].familia_id).toBe('famB')
    expect(a.porSku['100B'].familia_id).toBe('famA') // B não trouxe o 100B: fica a variação de A
  })
})

describe('prepararReferencia', () => {
  it('(1) imagem_path da variação da cor: copia para caminho imutável com o sha e grava origem storage', async () => {
    const r = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(), await ctx())
    if ('erro' in r) throw new Error('sem referência')
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(r.path).toBe(`org/galeria-ia/famA/referencias/preto-frente-${r.sha256}.jpg`)
    expect(fake.arquivos.get(r.path)).toEqual(JPEG('real-preto'))
    expect(db.galeria_referencias).toEqual([expect.objectContaining({
      id: r.id, anuncio_externo_id: 'an1', familia_id: 'famA', cor: 'Preto', vista: 'frente', origem: 'storage', sha256: r.sha256,
    })])
    expect(chamadas).toEqual([]) // sem ML
    // Repetir não duplica arquivo nem linha.
    const r2 = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(), await ctx())
    expect(r2).toEqual(r)
    expect(db.galeria_referencias).toHaveLength(1)
  })

  it('(3) sem imagem_path nem referência: 1ª foto do ML da variação da cor, pulando a que está em fotosAplicadas', async () => {
    db.familias = [famB()]
    const r = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(['R1']), await ctx())
    if ('erro' in r) throw new Error('sem referência')
    expect(fake.arquivos.get(r.path)).toEqual(JPEG('ml-R2'))
    expect(db.galeria_referencias[0]).toMatchObject({ origem: 'ml', familia_id: 'famB', cor: 'Preto' })
    expect(chamadas.some((c) => c.includes('/pictures/R1'))).toBe(false)
    expect(chamadas.every((c) => c.startsWith('GET '))).toBe(true) // nunca escreve no ML
  })

  it('(3) nunca a capa: foto que também está em variação de outra cor fica fora', async () => {
    db.familias = [famB()]
    fotosML = { 11: ['CAPA', 'R2'], 12: ['CAPA'], 13: ['CAPA', 'B1'] }
    const r = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(), await ctx())
    if ('erro' in r) throw new Error('sem referência')
    expect(fake.arquivos.get(r.path)).toEqual(JPEG('ml-R2'))
  })

  it('A aplica → UPDATE publica B sem imagem_path → reusa a referência real anterior, nunca a foto aplicada', async () => {
    const antes = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(), await ctx())
    if ('erro' in antes) throw new Error('sem referência')
    // A aplicou G1 nas variações do Preto; B é publicada sem imagem_path.
    fotosML = { 11: ['G1'], 12: ['G1'], 13: [] }
    db.galeria_imagem_itens.push({ org_id: 'org', anuncio_externo_id: 'an1', item_id: 'MLB1', picture_id: 'G1' })
    db.familias.push(famB())
    const aplicadas = await carregarFotosAplicadas(fake.admin as never, 'org', 'an1')
    expect(aplicadas).toEqual(new Set(['G1']))
    const depois = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', aplicadas, await ctx())
    expect(depois).toEqual(antes)
    expect(chamadas).toEqual([])
  })

  it('sem referência anterior e o ML só com fotos aplicadas → sem_referencia (nada baixado)', async () => {
    db.familias = [famB()]
    fotosML = { 11: ['G1'], 12: ['G1'], 13: [] }
    const r = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(['G1']), await ctx())
    expect(r).toEqual({ erro: 'sem_referencia' })
    expect(chamadas.some((c) => c.includes('/pictures/'))).toBe(false)
    expect(db.galeria_referencias).toHaveLength(0)
  })

  it('fotosAplicadas só conta o anúncio e a org pedidos', async () => {
    db.galeria_imagem_itens.push(
      { org_id: 'org', anuncio_externo_id: 'an1', picture_id: 'G1' },
      { org_id: 'org', anuncio_externo_id: 'an2', picture_id: 'G2' },
      { org_id: 'outra', anuncio_externo_id: 'an1', picture_id: 'G3' },
      { org_id: 'org', anuncio_externo_id: 'an1', picture_id: null },
    )
    expect(await carregarFotosAplicadas(fake.admin as never, 'org', 'an1')).toEqual(new Set(['G1']))
  })

  it('costas/lateral: só a referência cadastrada daquela vista (nunca imagem_path nem ML)', async () => {
    expect(await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'costas', new Set(), await ctx())).toEqual({ erro: 'sem_referencia' })
    expect(chamadas).toEqual([])
    db.galeria_referencias.push({
      id: 'ref-costas', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famA', cor: 'Preto', vista: 'costas',
      path: 'org/galeria-ia/famA/referencias/preto-costas-abc.jpg', sha256: 'abc', origem: 'upload_operador', criado_em: '2026-11-02',
    })
    expect(await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'costas', new Set(), await ctx()))
      .toEqual({ id: 'ref-costas', path: 'org/galeria-ia/famA/referencias/preto-costas-abc.jpg', sha256: 'abc' })
  })

  it('imagem_path de fora da org não é usada', async () => {
    db.familias[0].variacoes = [{ codigo: '100P', cor: 'Preto', imagem_path: 'outra-org/x.jpg' }]
    fake.arquivos.set('outra-org/x.jpg', JPEG('alheia'))
    fotosML = { 11: [], 12: [], 13: [] }
    expect(await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(), await ctx())).toEqual({ erro: 'sem_referencia' })
  })

  it('(1) não-JPEG em imagem_path nunca vai para .jpg: segue para o ML; foto do ML não-JPEG → tenta a próxima', async () => {
    fake.arquivos.set('org/lote/00100P.jpg', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]))
    fotosML = { 11: ['PNG1', 'R2'], 12: [], 13: [] }
    const fetchOriginal = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (
      url.includes('PNG1-F.jpg') ? new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) : fetchOriginal(url, init))))
    const r = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(), await ctx())
    if ('erro' in r) throw new Error('sem referência')
    expect(fake.arquivos.get(r.path)).toEqual(JPEG('ml-R2'))
    expect(db.galeria_referencias).toHaveLength(1)
  })

  it('só fotos não-JPEG → sem_referencia, nada gravado', async () => {
    fake.arquivos.set('org/lote/00100P.jpg', new Uint8Array([0x52, 0x49, 0x46, 0x46]))
    fotosML = { 11: ['PNG1'], 12: [], 13: [] }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('https://api.mercadolibre.com/items/')) return Response.json({ id: 'MLB1', pictures: [], variations: [{ id: 11, seller_custom_field: '100P', picture_ids: ['PNG1'] }] })
      if (url.includes('/pictures/')) return Response.json({ variations: [{ secure_url: 'https://http2.mlstatic.com/PNG1-F.jpg' }] })
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
    }))
    expect(await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(), await ctx())).toEqual({ erro: 'sem_referencia' })
    expect(db.galeria_referencias).toHaveLength(0)
    expect(fake.uploads).toEqual([])
  })

  it('(1) famílias não vigentes: vence a variação da família publicada mais recente, não o SKU alfabético', async () => {
    db.anuncios_externos[0].variacoes_externas = { '100A': {}, '100B': {}, '100C': {} }
    db.familias = [
      { id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z', variacoes: [{ codigo: '100A', cor: 'Preto', imagem_path: 'org/lote/a.jpg' }] },
      { id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-03T10:00:00Z', variacoes: [{ codigo: '100B', cor: 'Preto', imagem_path: 'org/lote/b.jpg' }] },
      { id: 'famC', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', variacoes: [{ codigo: '100C', cor: 'Preto', imagem_path: null }] },
    ]
    fake.arquivos.set('org/lote/a.jpg', JPEG('a'))
    fake.arquivos.set('org/lote/b.jpg', JPEG('b'))
    const a = await ctx()
    expect(a.vigente.id).toBe('famC')
    const r = await prepararReferencia(fake.admin as never, 'org', 'an1', 'Preto', 'frente', new Set(), a)
    if ('erro' in r) throw new Error('sem referência')
    expect(fake.arquivos.get(r.path)).toEqual(JPEG('b'))
  })

  it('corSlug', () => {
    expect(corSlug('Off White / Rosa Bebê')).toBe('off-white-rosa-bebe')
  })
})
