// Task 6b pela edge: montar lê a etiqueta (visão mockada) e "Corrigir cadastro" destrava a divergência
// sem nova chamada de visão. Usa o etiqueta.ts real (o outro arquivo de teste mocka o módulo).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, JPEG } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({ serve: vi.fn(), create: vi.fn(), fake: null as unknown as { admin: unknown } }))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org', isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: f.create } } }) }))
// Lupa pela caixa do produto: coberta em galeria-fatos-lupa.test.ts.
vi.mock('../../_shared/galeria/detalhes.ts', () => ({ garantirDetalhes: vi.fn(async () => ({})), VERSAO_LEITURA: 'v' }))
vi.mock('../../_shared/categoria/schema.ts', () => ({
  lerSchemaAtributos: vi.fn(async () => [
    { id: 'MAIN_MATERIAL', nome: 'Material', required: false, conditionalRequired: false, valueType: 'list',
      valores: [{ id: '111', nome: 'Poliamida' }, { id: '999', nome: 'Poliéster' }], allowedUnits: [], tags: [] },
  ]),
}))

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

const familia = (material: string, valueId: string) => ({
  id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', nome_pai: 'Peça', categoria_ml_id: 'MLB1234',
  atributos_ml: [{ id: 'MAIN_MATERIAL', name: 'Material', value_name: material, value_id: valueId }],
  variacoes: [{ codigo: '100P', cor: 'Preto', imagem_path: 'org/l/00100P.jpg' }],
})
const leitura = (valor: string) => ({
  choices: [{ message: { content: JSON.stringify({ campos: [
    { campo: 'atributo:MAIN_MATERIAL', situacao: 'lido', valor, foto: 2, caixa: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
  ] }) } }],
})

beforeEach(() => {
  f.create.mockReset()
  db = {
    organizations: [{ id: 'org', modulos_habilitados: ['imagem_ia'] }, { id: 'org2', modulos_habilitados: ['imagem_ia'] }],
    anuncios_externos: [{ id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1', variacoes_externas: { '100P': {} } }],
    anuncios_externos_itens: [], profiles: [{ id: 'u1', org_id: 'org' }], familias: [],
    galeria_fatos: [], galeria_referencias: [], galeria_imagem_itens: [], galeria_roteiros: [], galeria_imagens: [], galeria_aplicacoes: [],
  }
  f.fake = fakeAdmin(db, new Map([['org/l/00100P.jpg', JPEG('preto')]]))
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) return Response.json({ id: 'MLB1', pictures: [{ id: 'P_ETQ' }], variations: [] })
    if (url === 'https://api.mercadolibre.com/pictures/P_ETQ') return Response.json({ variations: [{ secure_url: 'https://ml/P_ETQ.jpg' }] })
    if (url === 'https://ml/P_ETQ.jpg') return new Response(new TextEncoder().encode('etiqueta'))
    return new Response('{}', { status: 404 })
  }))
})

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-fatos', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const material = (body: Linha) => (body.fatos as Linha[]).find((x) => x.campo === 'atributo:MAIN_MATERIAL')

describe('galeria-fatos × etiqueta', () => {
  it('Renda: lista fechada, "Corrigir cadastro" com a sugestão "100% Poliamida" grava Poliamida e destrava (uma visão só)', async () => {
    db.familias.push(familia('100% POLIÉSTER', '999'))
    f.create.mockResolvedValueOnce(leitura('100% Poliamida'))
    const m = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(material(m.body)).toMatchObject({ estado: 'DIVERGENTE', etiqueta: { valor: '100% Poliamida', foto: { origem: 'ml', ref: 'P_ETQ' } } })
    const r = await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: '100% Poliamida' })
    expect(r.status).toBe(200)
    expect(material(r.body)).toMatchObject({ estado: 'CONFIRMADO', valor: 'Poliamida' })
    expect((db.familias[0].atributos_ml as Linha[])[0]).toMatchObject({ value_name: 'Poliamida', value_id: '111' })
    expect(f.create).toHaveBeenCalledTimes(1)
  })

  it('regata: corrigida para "Poliéster" contra a leitura "96% poliéster" sai de DIVERGENTE e não volta enquanto a leitura não mudar', async () => {
    db.familias.push(familia('Poliamida', '111'))
    f.create.mockResolvedValueOnce(leitura('96% poliéster'))
    expect(material((await chamar({ acao: 'montar', ml_item_id: 'MLB1' })).body)).toMatchObject({ estado: 'DIVERGENTE' })
    const r = await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: 'Poliéster' })
    expect(material(r.body)).toMatchObject({ estado: 'CONFIRMADO', valor: 'Poliéster' })
    expect(db.galeria_fatos.find((l) => l.campo === 'atributo:MAIN_MATERIAL')?.evidencia).toMatchObject({ corrigido_cadastro: true, etiqueta_lida: '96% poliéster' })
    expect(material((await chamar({ acao: 'montar', ml_item_id: 'MLB1' })).body)).toMatchObject({ estado: 'CONFIRMADO' })
    expect(f.create).toHaveBeenCalledTimes(1)
  })
})
