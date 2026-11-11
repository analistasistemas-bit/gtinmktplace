import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from './fake-admin'
import { alvosDaCor, lerElegibilidadeItemML, motivoElegibilidade, type ItemElegibilidade, type LeitorML } from '../alvos'

type Linha = Record<string, unknown>

const fam = (id: string, publicado_em: string, variacoes: Array<[string, string]>, extra: Linha = {}) => ({
  id, org_id: 'org', codigo_pai: '100', publicado_em, variacoes: variacoes.map(([codigo, cor]) => ({ codigo, cor, imagem_path: null })), ...extra,
})
const legacy = (id: string, mlb: string | null, skus: string[], extra: Linha = {}) => ({
  id, org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: mlb,
  variacoes_externas: Object.fromEntries(skus.map((s) => [s, {}])), ...extra,
})
const filho = (sku: string, mlb: string | null, status = 'ativo', extra: Linha = {}) => ({
  org_id: 'org', anuncio_externo_id: 'up', sku, item_externo_id: mlb, status, retirado: false, ...extra,
})
const itemVar = (id: string, vars: Array<[number, string | null]>, extra: Partial<ItemElegibilidade> = {}): ItemElegibilidade => ({
  id, catalogListing: false, tags: [], sku: null, pictures: [], variacoes: vars.map(([vid, sku]) => ({ id: vid, sku, pictureIds: [] })), ...extra,
})

function leitor(itens: Record<string, ItemElegibilidade | null>, backfill: Record<string, { sku: string | null; temVariacoes: boolean } | null> = {}) {
  const l = { lerItem: vi.fn(async (id: string) => itens[id] ?? null), lerBackfill: vi.fn(async (id: string) => backfill[id] ?? null) }
  return l as LeitorML & typeof l
}

const UP_PMG = () => ({
  anuncios_externos: [{ id: 'up', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: null, variacoes_externas: {} }],
  anuncios_externos_itens: [filho('100P', 'MLB-P'), filho('100M', 'MLB-M'), filho('100G', 'MLB-G')],
  familias: [fam('famA', '2026-11-01T10:00:00Z', [['100P', 'Rosa'], ['100M', 'Rosa'], ['100G', 'Rosa']])],
})
const BF_PMG = { 'MLB-P': { sku: '100P', temVariacoes: false }, 'MLB-M': { sku: '100M', temVariacoes: false }, 'MLB-G': { sku: '100G', temVariacoes: false } }

describe('alvosDaCor — User Products', () => {
  it('UP P/M/G → 3 alvos sem variação, conferidos pelo SKU da raiz', async () => {
    const r = await alvosDaCor(fakeAdmin(UP_PMG()).admin as never, 'org', 'up', 'Rosa', leitor({}, BF_PMG))
    expect(r).toEqual({ alvos: [
      { itemId: 'MLB-G', variacoes: [{ sku: '100G', variationId: null }] },
      { itemId: 'MLB-M', variacoes: [{ sku: '100M', variationId: null }] },
      { itemId: 'MLB-P', variacoes: [{ sku: '100P', variationId: null }] },
    ] })
  })

  it('P ativo, M pausado, G ativo → 3 alvos', async () => {
    const db = UP_PMG()
    db.anuncios_externos_itens[1].status = 'pausado'
    const r = await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'up', 'Rosa', leitor({}, BF_PMG))
    expect('alvos' in r && r.alvos).toHaveLength(3)
  })

  it.each(['criacao_incerta', 'erro', 'criado'])('filho M em %s → conjunto_incompleto e nenhum alvo', async (status) => {
    const db = UP_PMG()
    db.anuncios_externos_itens[1].status = status
    const l = leitor({}, BF_PMG)
    const r = await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'up', 'Rosa', l)
    expect(r).toMatchObject({ erro: 'conjunto_incompleto' })
    expect('alvos' in r).toBe(false)
  })

  it('SKU com 2 itens vivos → conjunto_incompleto', async () => {
    const db = UP_PMG()
    db.anuncios_externos_itens.push(filho('100M', 'MLB-M2'))
    expect(await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'up', 'Rosa', leitor({}, { ...BF_PMG, 'MLB-M2': { sku: '100M', temVariacoes: false } })))
      .toMatchObject({ erro: 'conjunto_incompleto' })
  })

  it('SKU sem endereço (filho sem MLB) → conjunto_incompleto', async () => {
    const db = UP_PMG()
    db.anuncios_externos_itens[2].item_externo_id = null
    expect(await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'up', 'Rosa', leitor({}, BF_PMG))).toMatchObject({ erro: 'conjunto_incompleto' })
  })

  it('vínculo de outra org ou de outro anúncio com o mesmo SKU é ignorado', async () => {
    const db = UP_PMG()
    db.anuncios_externos_itens.push(
      filho('100P', 'MLB-OUTRA-ORG', 'ativo', { org_id: 'org2' }),
      filho('100P', 'MLB-OUTRO-AN', 'ativo', { anuncio_externo_id: 'outro' }),
    )
    const r = await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'up', 'Rosa', leitor({}, BF_PMG))
    expect('alvos' in r && r.alvos.map((a) => a.itemId)).toEqual(['MLB-G', 'MLB-M', 'MLB-P'])
  })

  it('família de outro codigo_pai ou de outra org com o mesmo SKU (cor diferente, mais nova) é ignorada', async () => {
    const db = UP_PMG()
    db.familias.push(
      fam('famX', '2026-11-09T10:00:00Z', [['100M', 'Azul']], { codigo_pai: '200' }),
      fam('famY', '2026-11-09T10:00:00Z', [['100M', 'Azul']], { org_id: 'org2' }),
    )
    const r = await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'up', 'Rosa', leitor({}, BF_PMG))
    expect('alvos' in r && r.alvos.map((a) => a.itemId)).toEqual(['MLB-G', 'MLB-M', 'MLB-P'])
  })

  it('buscarItemBackfill null → conjunto_incompleto', async () => {
    expect(await alvosDaCor(fakeAdmin(UP_PMG()).admin as never, 'org', 'up', 'Rosa', leitor({}, { ...BF_PMG, 'MLB-G': null })))
      .toMatchObject({ erro: 'conjunto_incompleto' })
  })

  it('UP plano com GET 200 sem seller_custom_field (sku null) → conjunto_incompleto', async () => {
    expect(await alvosDaCor(fakeAdmin(UP_PMG()).admin as never, 'org', 'up', 'Rosa', leitor({}, { ...BF_PMG, 'MLB-M': { sku: null, temVariacoes: false } })))
      .toMatchObject({ erro: 'conjunto_incompleto' })
  })

  it('UP plano com sku de outra cor → conjunto_incompleto', async () => {
    expect(await alvosDaCor(fakeAdmin(UP_PMG()).admin as never, 'org', 'up', 'Rosa', leitor({}, { ...BF_PMG, 'MLB-M': { sku: '200M', temVariacoes: false } })))
      .toMatchObject({ erro: 'conjunto_incompleto' })
  })

  it('família A publicada + UPDATE parcial B (só P e M; G vivo) → P/M/G, sem conjunto_incompleto', async () => {
    const db = UP_PMG()
    db.familias.push(fam('famB', '2026-11-05T10:00:00Z', [['100P', 'Rosa'], ['100M', 'Rosa']]))
    const r = await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'up', 'Rosa', leitor({}, BF_PMG))
    expect('alvos' in r && r.alvos.map((a) => a.variacoes[0].sku)).toEqual(['100G', '100M', '100P'])
  })

  it('SKU vivo sem variação em nenhuma família publicada → conjunto_incompleto', async () => {
    const db = UP_PMG()
    db.anuncios_externos_itens.push(filho('100GG', 'MLB-GG'))
    expect(await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'up', 'Rosa', leitor({}, BF_PMG))).toMatchObject({ erro: 'conjunto_incompleto' })
  })
})

describe('alvosDaCor — Legacy (variações no item, partições)', () => {
  it('cor local "Rosa" e COLOR remoto "Rosa Bebê" casam pelo SKU (seller_custom_field)', async () => {
    const db = { anuncios_externos: [legacy('an1', 'MLB1', ['100R', '100A'])], anuncios_externos_itens: [],
      familias: [fam('famA', '2026-11-01T10:00:00Z', [['100R', 'Rosa'], ['100A', 'Azul']])] }
    const r = await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'an1', 'Rosa', leitor({ MLB1: itemVar('MLB1', [[11, '100R'], [12, '100A']]) }))
    expect(r).toEqual({ alvos: [{ itemId: 'MLB1', variacoes: [{ sku: '100R', variationId: 11 }] }] })
  })

  it('SKU não encontrado no GET → variacao_nao_casa', async () => {
    const db = { anuncios_externos: [legacy('an1', 'MLB1', ['100R'])], anuncios_externos_itens: [],
      familias: [fam('famA', '2026-11-01T10:00:00Z', [['100R', 'Rosa']])] }
    expect(await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'an1', 'Rosa', leitor({ MLB1: itemVar('MLB1', [[12, '100A']]) })))
      .toMatchObject({ erro: 'variacao_nao_casa' })
  })

  it('vínculo local apontando para item cujo SKU remoto é outro → variacao_nao_casa', async () => {
    const db = { anuncios_externos: [legacy('an1', 'MLB1', ['100R'])], anuncios_externos_itens: [],
      familias: [fam('famA', '2026-11-01T10:00:00Z', [['100R', 'Rosa']])] }
    expect(await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'an1', 'Rosa', leitor({ MLB1: itemVar('MLB1', [], { sku: '999' }) })))
      .toMatchObject({ erro: 'variacao_nao_casa' })
  })

  it('Legacy com 2 partições e SKUs da cor nas duas → só o item da partição selecionada', async () => {
    const db = { anuncios_externos: [legacy('p0', 'MLB-A', ['100R1', '100A']), legacy('p1', 'MLB-B', ['100R2'])], anuncios_externos_itens: [],
      familias: [fam('famA', '2026-11-01T10:00:00Z', [['100R1', 'Rosa'], ['100A', 'Azul'], ['100R2', 'Rosa']])] }
    const l = leitor({ 'MLB-A': itemVar('MLB-A', [[1, '100R1'], [2, '100A']]), 'MLB-B': itemVar('MLB-B', [[3, '100R2']]) })
    const r = await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'p0', 'Rosa', l)
    expect(r).toEqual({ alvos: [{ itemId: 'MLB-A', variacoes: [{ sku: '100R1', variationId: 1 }] }] })
    expect(l.lerItem).not.toHaveBeenCalledWith('MLB-B')
  })

  it('duas linhas de Publicados com a mesma família e anúncios distintos → escopos distintos', async () => {
    const db = { anuncios_externos: [legacy('p0', 'MLB-A', ['100R1']), legacy('p1', 'MLB-B', ['100R2'])], anuncios_externos_itens: [],
      familias: [fam('famA', '2026-11-01T10:00:00Z', [['100R1', 'Rosa'], ['100R2', 'Rosa']])] }
    const l = leitor({ 'MLB-A': itemVar('MLB-A', [[1, '100R1']]), 'MLB-B': itemVar('MLB-B', [[3, '100R2']]) })
    const fake = fakeAdmin(db)
    expect(await alvosDaCor(fake.admin as never, 'org', 'p0', 'Rosa', l)).toEqual({ alvos: [{ itemId: 'MLB-A', variacoes: [{ sku: '100R1', variationId: 1 }] }] })
    expect(await alvosDaCor(fake.admin as never, 'org', 'p1', 'Rosa', l)).toEqual({ alvos: [{ itemId: 'MLB-B', variacoes: [{ sku: '100R2', variationId: 3 }] }] })
  })

  it('produto em 2 partições: cada partição só com as suas famílias', async () => {
    // Família B (mais nova) só tem o SKU da partição 1: a partição 0 continua com os dados da A.
    const db = { anuncios_externos: [legacy('p0', 'MLB-A', ['100R1']), legacy('p1', 'MLB-B', ['100R2'])], anuncios_externos_itens: [],
      familias: [fam('famA', '2026-11-01T10:00:00Z', [['100R1', 'Rosa']]), fam('famB', '2026-11-05T10:00:00Z', [['100R2', 'Azul']])] }
    const l = leitor({ 'MLB-A': itemVar('MLB-A', [[1, '100R1']]), 'MLB-B': itemVar('MLB-B', [[3, '100R2']]) })
    const fake = fakeAdmin(db)
    expect(await alvosDaCor(fake.admin as never, 'org', 'p0', 'Rosa', l)).toMatchObject({ alvos: [{ itemId: 'MLB-A' }] })
    expect(await alvosDaCor(fake.admin as never, 'org', 'p1', 'Rosa', l)).toMatchObject({ erro: 'conjunto_incompleto' })
  })

  it('partição sem MLB (SKU sem endereço) → conjunto_incompleto', async () => {
    const db = { anuncios_externos: [legacy('an1', null, ['100R'])], anuncios_externos_itens: [],
      familias: [fam('famA', '2026-11-01T10:00:00Z', [['100R', 'Rosa']])] }
    expect(await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'an1', 'Rosa', leitor({}))).toMatchObject({ erro: 'conjunto_incompleto' })
  })

  it('anúncio de outra org ou de outro canal → sem_anuncio', async () => {
    const db = { anuncios_externos: [legacy('an1', 'MLB1', ['100R'], { org_id: 'org2' }), legacy('an2', 'MLB2', ['100R'], { canal: 'shopee' })],
      anuncios_externos_itens: [], familias: [fam('famA', '2026-11-01T10:00:00Z', [['100R', 'Rosa']])] }
    expect(await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'an1', 'Rosa', leitor({}))).toMatchObject({ erro: 'sem_anuncio' })
    expect(await alvosDaCor(fakeAdmin(db).admin as never, 'org', 'an2', 'Rosa', leitor({}))).toMatchObject({ erro: 'sem_anuncio' })
  })
})

describe('lerElegibilidadeItemML e motivoElegibilidade', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('GET próprio com os campos da galeria; catalog_listing true → catalogo, ausente → catalogo_desconhecido', async () => {
    const urls: string[] = []
    let corpo: Linha = { id: 'MLB1', catalog_listing: true, tags: ['x'], seller_custom_field: 'S',
      pictures: [{ id: 'P1', secure_url: 'https://ml/P1.jpg' }, { id: 'P2' }], variations: [{ id: 7, seller_custom_field: '100R', picture_ids: ['P1'] }] }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); return Response.json(corpo) }))
    const item = await lerElegibilidadeItemML('tok', 'MLB1')
    expect(urls[0]).toBe('https://api.mercadolibre.com/items/MLB1?attributes=id,catalog_listing,tags,variations,pictures,seller_custom_field')
    expect(item).toEqual({ id: 'MLB1', catalogListing: true, tags: ['x'], sku: 'S', pictures: ['P1', 'P2'], variacoes: [{ id: 7, sku: '100R', pictureIds: ['P1'] }], urls: { P1: 'https://ml/P1.jpg' } })
    expect(motivoElegibilidade(item!)).toBe('catalogo')

    corpo = { id: 'MLB1', variations: [] }
    const semCampo = await lerElegibilidadeItemML('tok', 'MLB1')
    expect(semCampo?.catalogListing).toBeNull()
    expect(motivoElegibilidade(semCampo!)).toBe('catalogo_desconhecido')

    corpo = { id: 'MLB1', catalog_listing: false, variations: [] }
    expect(motivoElegibilidade((await lerElegibilidadeItemML('tok', 'MLB1'))!)).toBeNull()
  })

  it('GET com erro → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    expect(await lerElegibilidadeItemML('tok', 'MLB1')).toBeNull()
  })
})
