import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, JPEG } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({ serve: vi.fn(), fake: null as unknown as { admin: unknown } }))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org', isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fetchs: string[]
let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

beforeEach(() => {
  db = {
    anuncios_externos: [{
      id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1',
      variacoes_externas: { '100P': {}, '100M': {} },
    }],
    anuncios_externos_itens: [],
    profiles: [{ id: 'u1', org_id: 'org' }],
    familias: [
      {
        id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z', nome_pai: 'Renda',
        atributos_ml: [{ id: 'MAIN_MATERIAL', value_name: 'Poliamida' }],
        variacoes: [{ codigo: '100P', cor: 'Preto', imagem_path: 'org/l/00100P.jpg' }],
      },
      {
        id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', nome_pai: 'Renda Búfalo',
        marca: 'Avil', atributos_editados_pelo_operador: true, titulo_ml: 'Renda Búfalo Poliéster',
        atributos_ml: [{ id: 'MAIN_MATERIAL', name: 'Material', value_name: '100% POLIÉSTER', value_id: '999' }, { id: 'PATTERN', value_name: 'Floral' }],
        variacoes: [
          { codigo: '100P', cor: 'Preto', imagem_path: 'org/l/00100P.jpg', comprimento_cm: 60 },
          { codigo: '100M', cor: 'Preto', imagem_path: 'org/l/00100P.jpg', comprimento_cm: 62 },
        ],
      },
    ],
    galeria_fatos: [], galeria_referencias: [], galeria_imagem_itens: [],
    galeria_roteiros: [], galeria_imagens: [], galeria_aplicacoes: [],
  }
  fake = fakeAdmin(db, new Map([['org/l/00100P.jpg', JPEG('preto')]]))
  f.fake = fake
  fetchs = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { fetchs.push(`${init?.method ?? 'GET'} ${url}`); return new Response('{}', { status: 500 }) }))
})

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-fatos', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const fatoDe = (body: Linha, campo: string) => (body.fatos as Linha[]).find((x) => x.campo === campo)

describe('galeria-fatos', () => {
  it('MLB que não identifica um único anúncio da org → 409 anuncio_ambiguo', async () => {
    expect(await chamar({ acao: 'montar', ml_item_id: 'MLB404' })).toMatchObject({ status: 409, body: { error: 'anuncio_ambiguo' } })
  })

  it('montar: família vigente, ficha (atributo SUGERIDO mesmo com a família editada; medida que varia) e referência', async () => {
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ anuncio_externo_id: 'an1', familia_id: 'famB' })
    expect(fatoDe(r.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'SUGERIDO' })
    expect(fatoDe(r.body, 'nome')).toMatchObject({ estado: 'CONFIRMADO', valor: 'Renda Búfalo' })
    expect(fatoDe(r.body, 'comprimento_cm')).toMatchObject({ estado: 'VARIA_POR_TAMANHO' })
    expect(r.body.referencias).toMatchObject({ Preto: { frente: { path: expect.stringMatching(/^org\/galeria-ia\/famB\/referencias\/preto-frente-/) } } })
    expect(r.body.fatos_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('montar com hash diferente do roteiro aprovado: pendente→falhou, não aplicadas→desatualizada, submetendo/gerando intactas, roteiro desatualizado', async () => {
    db.galeria_roteiros.push({ id: 'r1', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', status: 'aprovado', fatos_hash: 'velho' })
    db.galeria_aplicacoes.push(
      { id: 'ap1', org_id: 'org', anuncio_externo_id: 'an1', status: 'aplicada', manifesto: [{ imagem_id: 'i5' }] },
      { id: 'ap2', org_id: 'org', anuncio_externo_id: 'an1', status: 'falhou', manifesto: [{ imagem_id: 'i6' }] },
    )
    const img = (id: string, status: string) => ({ id, org_id: 'org', anuncio_externo_id: 'an1', roteiro_id: 'r1', status })
    db.galeria_imagens.push(img('i1', 'pendente'), img('i2', 'submetendo'), img('i3', 'gerando'), img('i4', 'gerada'),
      img('i5', 'aprovada'), img('i6', 'aprovada'), img('i7', 'descartada'), { ...img('i8', 'gerada'), anuncio_externo_id: 'an2' })
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.status).toBe(200)
    expect(r.body.roteiro_desatualizado).toBe(true)
    const st = Object.fromEntries(db.galeria_imagens.map((i) => [i.id, i.status]))
    expect(st).toEqual({ i1: 'falhou', i2: 'submetendo', i3: 'gerando', i4: 'desatualizada', i5: 'aprovada', i6: 'desatualizada', i7: 'descartada', i8: 'gerada' })
    expect(db.galeria_imagens.find((i) => i.id === 'i1')?.erro).toBe('roteiro_trocado')
    expect(db.galeria_roteiros[0].status).toBe('desatualizado')
  })

  it('montar com o mesmo hash do roteiro aprovado não mexe em nada', async () => {
    const { body } = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    db.galeria_roteiros.push({ id: 'r1', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', status: 'aprovado', fatos_hash: body.fatos_hash })
    db.galeria_imagens.push({ id: 'i1', org_id: 'org', anuncio_externo_id: 'an1', roteiro_id: 'r1', status: 'gerada' })
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.body.roteiro_desatualizado).toBe(false)
    expect(db.galeria_roteiros[0].status).toBe('aprovado')
    expect(db.galeria_imagens[0].status).toBe('gerada')
  })

  it('ação com família que não é a vigente → 409 familia_nao_vigente com o id vigente', async () => {
    expect(await chamar({ acao: 'confirmar', ml_item_id: 'MLB1', familia_id: 'famA', campo: 'atributo:MAIN_MATERIAL' }))
      .toMatchObject({ status: 409, body: { error: 'familia_nao_vigente', familia_id_vigente: 'famB' } })
    expect(db.galeria_fatos).toHaveLength(0)
  })

  it('confirmar: SUGERIDO vira CONFIRMADO com quem e quando; campo da planilha não é confirmável', async () => {
    const r = await chamar({ acao: 'confirmar', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL' })
    expect(r.status).toBe(200)
    expect(db.galeria_fatos).toEqual([expect.objectContaining({
      org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: '100% POLIÉSTER',
      origem: 'confirmado_operador', confirmado_por: 'u1', descartado: false,
    })])
    expect(db.galeria_fatos[0].confirmado_em).toBeTruthy()
    expect(fatoDe(r.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'CONFIRMADO' })
    expect((await chamar({ acao: 'confirmar', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'nome' })).status).toBe(400)
  })

  it('descartar: o SUGERIDO sai da ficha', async () => {
    const r = await chamar({ acao: 'descartar', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:PATTERN' })
    expect(r.status).toBe(200)
    expect(fatoDe(r.body, 'atributo:PATTERN')).toBeUndefined()
    expect(db.galeria_fatos[0]).toMatchObject({ campo: 'atributo:PATTERN', descartado: true })
  })

  // A leitura vem do servidor: o cliente não pré-autoriza ignorar etiqueta nem confirma SUGERIDO por este caminho.
  it('manter_cadastro em fato que não está DIVERGENTE → 409, sem gravar (mesmo com etiqueta no corpo)', async () => {
    const r = await chamar({ acao: 'manter_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', etiqueta: '100% Poliamida' })
    expect(r).toMatchObject({ status: 409, body: { error: 'campo_nao_divergente' } })
    expect(db.galeria_fatos).toHaveLength(0)
  })

  it('corrigir_cadastro: grava só na família vigente (atributo), confirma o fato e não toca no ML', async () => {
    const r = await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: '100% Poliamida' })
    expect(r.status).toBe(200)
    const b = db.familias.find((x) => x.id === 'famB') as Linha
    expect(b.atributos_ml).toEqual([{ id: 'MAIN_MATERIAL', name: 'Material', value_name: '100% Poliamida' }, { id: 'PATTERN', value_name: 'Floral' }])
    expect((db.familias.find((x) => x.id === 'famA') as Linha).atributos_ml).toEqual([{ id: 'MAIN_MATERIAL', value_name: 'Poliamida' }])
    expect(fatoDe(r.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'CONFIRMADO', valor: '100% Poliamida' })
    expect(fetchs).toEqual([])
    expect(fake.escritas.map((e) => e.tabela).filter((t) => !t.startsWith('galeria_'))).toEqual(['familias'])
    expect((await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'nome', valor: 'X' })).status).toBe(400)
    expect((await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: ' ' })).status).toBe(400)
  })

  it('enviar_vista: JPEG de costas vira referência upload_operador imutável; frente, não-JPEG ou cor de fora → 400', async () => {
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
    const ok = await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Preto', vista: 'costas', imagem_base64: b64(JPEG('costas')) })
    expect(ok.status).toBe(200)
    const ref = db.galeria_referencias.find((x) => x.vista === 'costas')
    expect(ref).toMatchObject({ origem: 'upload_operador', cor: 'Preto', familia_id: 'famB', anuncio_externo_id: 'an1' })
    expect(ref?.path).toMatch(/^org\/galeria-ia\/famB\/referencias\/preto-costas-[0-9a-f]{64}\.jpg$/)
    expect(ok.body.referencias).toMatchObject({ Preto: { costas: { id: ref?.id } } })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    expect((await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Preto', vista: 'costas', imagem_base64: b64(png) })).status).toBe(400)
    expect((await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Preto', vista: 'frente', imagem_base64: b64(JPEG('f')) })).status).toBe(400)
    expect((await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Azul', vista: 'costas', imagem_base64: b64(JPEG('a')) })).status).toBe(400)
  })

  it('ação desconhecida → 400', async () => {
    expect((await chamar({ acao: 'apagar', ml_item_id: 'MLB1' })).status).toBe(400)
  })
})
