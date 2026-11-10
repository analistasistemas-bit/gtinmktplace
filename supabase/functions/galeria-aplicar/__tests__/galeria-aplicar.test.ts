// ADR-0201 Task 14 — edge galeria-aplicar (preparar, confirmar, reverter). Sem rede: ML por fetch fake (só GET), banco
// em memória, RPCs atômicas com a resposta do SQL (o comportamento delas é testado nos testes SQL das Tasks 2 e 14).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'
import { CORPO_MINIMO } from '../../_shared/galeria/aplicar'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as { admin: unknown },
  auth: { userId: 'u1', orgId: 'org', isAdmin: true, support: null } as Record<string, unknown>,
  fatosHash: 'h',
  batch: vi.fn(),
  garantir: vi.fn(async () => {}),
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({ requireUserOrg: vi.fn(async () => f.auth) }))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../_shared/galeria/referencias.ts', () => ({ calcularVigencia: vi.fn(async () => ({ fatos: [], referencias: {}, fatos_hash: f.fatosHash })) }))
vi.mock('../../_shared/queue.ts', () => ({ qstashClient: () => ({ batchJSON: f.batch }), garantirFilaSerial: f.garantir }))

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let itensML: Record<string, Linha>
let metodos: string[]
let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : undefined) } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

const legacyML = (id: string) => ({ id, catalog_listing: false, tags: [], pictures: [{ id: 'R0' }, { id: 'A0' }],
  variations: [{ id: 11, seller_custom_field: '100R', picture_ids: ['R0'] }, { id: 12, seller_custom_field: '100A', picture_ids: ['A0'] }] })
const planoML = (id: string, sku: string) => ({ id, catalog_listing: false, tags: [], seller_custom_field: sku, pictures: [{ id: `F-${sku}` }], variations: [] })
const aprovada = (id: string, missao: number, extra: Linha = {}) => ({ id, org_id: 'org', anuncio_externo_id: 'an1', roteiro_id: 'rotB',
  cor: 'Rosa', missao, status: 'aprovada', final_sha256: `sha-${id}`, ...extra })

beforeEach(() => {
  f.auth = { userId: 'u1', orgId: 'org', isAdmin: true, support: null }
  f.fatosHash = 'h'
  db = {
    anuncios_externos: [
      { id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1', variacoes_externas: { '100R': {}, '100A': {} } },
      // Split: partição 2 do mesmo produto.
      { id: 'an2', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB2', variacoes_externas: { '100V': {} } },
      // UP P/M/G.
      { id: 'an3', org_id: 'org', canal: 'mercado_livre', codigo_pai: '300', item_externo_id: null, variacoes_externas: {} },
    ],
    anuncios_externos_itens: ['P', 'M', 'G'].map((t) => ({ anuncio_externo_id: 'an3', org_id: 'org', sku: `300${t}`, item_externo_id: `MLB3${t}`, status: 'ativo', retirado: false })),
    familias: [
      { id: 'famA', org_id: 'org', user_id: 'imp-A', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z',
        variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }, { codigo: '100V', cor: 'Verde' }] },
      { id: 'famB', org_id: 'org', user_id: 'imp-B', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z',
        variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }, { codigo: '100V', cor: 'Verde' }] },
      { id: 'famU', org_id: 'org', user_id: 'imp-U', codigo_pai: '300', publicado_em: '2026-11-05T10:00:00Z',
        variacoes: ['P', 'M', 'G'].map((t) => ({ codigo: `300${t}`, cor: 'Rosa' })) },
    ],
    galeria_roteiros: [
      { id: 'rotB', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', status: 'aprovado', fatos_hash: 'h' },
      { id: 'rotU', org_id: 'org', anuncio_externo_id: 'an3', familia_id: 'famU', status: 'aprovado', fatos_hash: 'h' },
    ],
    galeria_imagens: [aprovada('g3', 3), aprovada('g1', 1), aprovada('gX', 2, { cor: 'Azul' }), aprovada('gU', 1, { anuncio_externo_id: 'an3', roteiro_id: 'rotU' })],
    galeria_aplicacoes: [], galeria_aplicacao_itens: [],
  }
  fake = fakeAdmin(db)
  f.fake = fake
  f.batch.mockReset()
  f.batch.mockImplementation(async (msgs: unknown[]) => msgs.map((_, i) => ({ messageId: `m${i}` })))
  itensML = { MLB1: legacyML('MLB1'), MLB2: legacyML('MLB2'), ...Object.fromEntries(['P', 'M', 'G'].map((t) => [`MLB3${t}`, planoML(`MLB3${t}`, `300${t}`)])) }
  metodos = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    metodos.push(init?.method ?? 'GET')
    const id = /items\/([^?]+)/.exec(url)?.[1]
    const item = id && itensML[decodeURIComponent(id)]
    return item ? Response.json(item) : new Response('{}', { status: 404 })
  }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.stubGlobal('Deno', { serve: f.serve, env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : undefined) } }) })

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-aplicar', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const preparar = (extra: Linha = {}) => chamar({ acao: 'preparar', ml_item_id: 'MLB1', cor: 'Rosa', modo: 'substituir', ...extra })
const APL = '11111111-1111-4111-8111-111111111111'

describe('galeria-aplicar — preparar', () => {
  it('não admin → 403 (todas as ações)', async () => {
    f.auth = { ...f.auth, isAdmin: false }
    for (const acao of ['preparar', 'confirmar', 'reverter']) {
      expect((await chamar({ acao, ml_item_id: 'MLB1', cor: 'Rosa', modo: 'substituir', aplicacao_id: APL })).status).toBe(403)
    }
    expect(db.galeria_aplicacoes).toEqual([])
  })

  it('Legacy: grava preparada com retrato, manifesto congelado na ordem das missões (com sha) e itens pendente; só GET no ML', async () => {
    const r = await preparar()
    expect(r.status).toBe(200)
    expect(db.galeria_aplicacoes).toHaveLength(1)
    expect(db.galeria_aplicacoes[0]).toMatchObject({ org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', cor: 'Rosa',
      modo: 'substituir', roteiro_id: 'rotB', fatos_hash: 'h', status: 'preparada', aplicado_por: 'u1',
      manifesto: [{ imagem_id: 'g1', missao: 1, final_sha256: 'sha-g1' }, { imagem_id: 'g3', missao: 3, final_sha256: 'sha-g3' }],
      retrato: { MLB1: { pictures: ['R0', 'A0'] } } })
    expect(db.galeria_aplicacao_itens).toHaveLength(1)
    expect(db.galeria_aplicacao_itens[0]).toMatchObject({ item_id: 'MLB1', variacoes_alvo: [{ sku: '100R', variationId: 11 }],
      fotos_antes: { '100R': ['R0'] } })
    expect((db.galeria_aplicacao_itens[0].fotos_novas as Linha[]).map((x) => [x.imagem_id, x.upload_id, x.pronta])).toEqual([['g1', null, false], ['g3', null, false]])
    expect(metodos.every((m) => m === 'GET')).toBe(true)
    expect(f.batch).not.toHaveBeenCalled()
  })

  it('UP P/M/G → 3 itens (um por MLB da cor), cada um com o próprio retrato', async () => {
    const r = await preparar({ ml_item_id: 'MLB3M' })
    expect(r.status).toBe(200)
    expect(db.galeria_aplicacao_itens.map((i) => i.item_id).sort()).toEqual(['MLB3G', 'MLB3M', 'MLB3P'])
    expect(Object.keys(db.galeria_aplicacoes[0].retrato as Linha).sort()).toEqual(['MLB3G', 'MLB3M', 'MLB3P'])
    expect(db.galeria_aplicacao_itens.find((i) => i.item_id === 'MLB3P')!.fotos_antes).toEqual({ '300P': ['F-300P'] })
  })

  it('imagem aprovada depois do preparar não entra (manifesto e fotos_novas congelados)', async () => {
    await preparar()
    db.galeria_imagens.push(aprovada('g7', 7))
    expect((db.galeria_aplicacoes[0].manifesto as Linha[]).map((m) => m.imagem_id)).toEqual(['g1', 'g3'])
    expect((db.galeria_aplicacao_itens[0].fotos_novas as Linha[]).map((m) => m.imagem_id)).toEqual(['g1', 'g3'])
  })

  it('roteiro aprovado da família A com a B vigente → 409 familia_nao_vigente', async () => {
    db.galeria_roteiros[0].familia_id = 'famA'
    expect(await preparar()).toEqual({ status: 409, body: { error: 'familia_nao_vigente', familia_id_vigente: 'famB' } })
    expect(db.galeria_aplicacoes).toEqual([])
  })

  it('fatos mudaram desde o roteiro → 409 desatualizada', async () => {
    f.fatosHash = 'h2'
    expect((await preparar()).body).toEqual({ error: 'desatualizada' })
  })

  it.each([
    ['catalog_listing verdadeiro', { catalog_listing: true }, 'catalogo'],
    ['catalog_listing ausente', { catalog_listing: undefined }, 'catalogo_desconhecido'],
    ['variations_migration_pending', { tags: ['variations_migration_pending'] }, 'migracao_pendente'],
  ])('%s → 409 com o motivo, nada gravado', async (_n, extra, erro) => {
    itensML.MLB1 = { ...legacyML('MLB1'), ...extra }
    const r = await preparar()
    expect(r.status).toBe(409)
    expect(r.body.error).toBe(erro)
    expect(db.galeria_aplicacoes).toEqual([])
  })

  it('formato que exige quantidade no PUT de fotos → 409 formato_bloqueado', async () => {
    ;(CORPO_MINIMO.legacy as unknown as string[]).push('available_quantity')
    try {
      expect((await preparar()).body).toMatchObject({ error: 'formato_bloqueado', item_id: 'MLB1' })
    } finally {
      ;(CORPO_MINIMO.legacy as unknown as string[]).pop()
    }
    expect(db.galeria_aplicacoes).toEqual([])
  })

  it('adicionar acima do limite de fotos por variação → 409 limite (a tela oferece Substituir)', async () => {
    itensML.MLB1 = { ...legacyML('MLB1'), variations: [{ id: 11, seller_custom_field: '100R', picture_ids: Array.from({ length: 9 }, (_, i) => `R${i}`) },
      { id: 12, seller_custom_field: '100A', picture_ids: ['A0'] }] }
    expect((await preparar({ modo: 'adicionar' })).body).toMatchObject({ error: 'limite' })
  })

  it('sem aprovadas da cor → 409 sem_aprovadas', async () => {
    expect((await preparar({ cor: 'Verde' })).body).toEqual({ error: 'sem_aprovadas' })
  })
})

describe('galeria-aplicar — confirmar e reverter', () => {
  const comAplicacao = (status = 'preparada', anuncio = 'an1', familia = 'famB') => {
    db.galeria_aplicacoes.push({ id: APL, org_id: 'org', anuncio_externo_id: anuncio, familia_id: familia, status })
    for (const [n, st] of [['MLB1', status === 'preparada' ? 'pendente' : 'aplicado']]) {
      db.galeria_aplicacao_itens.push({ id: `it-${n}`, org_id: 'org', aplicacao_id: APL, item_id: n, status: st, fase: 0, despacho_seq: 0 })
    }
  }

  it('confirmar ok → RPC atômica com a vigente/roteiro/fatos atuais e um job por item na fila do dono (publish-ml-<user_id>)', async () => {
    comAplicacao()
    fake.respostasRpc.galeria_confirmar_aplicacao = (a) => {
      db.galeria_aplicacao_itens.forEach((i) => { i.status = 'pendente' })
      return a.p_aplicacao === APL ? 'ok' : 'x'
    }
    const r = await chamar({ acao: 'confirmar', ml_item_id: 'MLB1', aplicacao_id: APL })
    expect(r).toEqual({ status: 200, body: { status: 'em_andamento' } })
    expect(fake.rpcs.find((x) => x.nome === 'galeria_confirmar_aplicacao')!.args).toEqual(
      { p_org: 'org', p_familia: 'famB', p_aplicacao: APL, p_roteiro_id: 'rotB', p_fatos_hash: 'h' })
    expect(f.garantir).toHaveBeenCalledWith('imp-B')
    const msgs = f.batch.mock.calls[0][0] as Linha[]
    expect(msgs).toEqual([expect.objectContaining({ url: 'https://x.supabase.co/functions/v1/galeria-aplicar-worker',
      queueName: 'publish-ml-imp-B', retries: 3, body: expect.objectContaining({ tipo: 'aplicacao_item', id: 'it-MLB1', fase: 0 }) })])
    expect(metodos).toEqual([])   // confirmar não fala com o ML
  })

  it.each([['item_ocupado'], ['escrita_pendente'], ['desatualizada']])('confirmar recusado pela RPC (%s) → 409 sem publicar', async (codigo) => {
    comAplicacao()
    fake.respostasRpc.galeria_confirmar_aplicacao = () => codigo
    expect(await chamar({ acao: 'confirmar', ml_item_id: 'MLB1', aplicacao_id: APL })).toEqual({ status: 409, body: { error: codigo } })
    expect(f.batch).not.toHaveBeenCalled()
  })

  it('reverter é operação histórica: aplicação da família A depois que B virou vigente é aceita e compensa', async () => {
    comAplicacao('aplicada', 'an1', 'famA')
    fake.respostasRpc.galeria_iniciar_reversao = () => {
      db.galeria_aplicacao_itens.forEach((i) => { i.status = 'compensando' })
      return 'ok'
    }
    const r = await chamar({ acao: 'reverter', ml_item_id: 'MLB1', aplicacao_id: APL })
    expect(r).toEqual({ status: 200, body: { status: 'revertendo' } })
    expect(fake.rpcs.find((x) => x.nome === 'galeria_iniciar_reversao')!.args).toEqual({ p_org: 'org', p_familia: 'famA', p_aplicacao: APL })
    expect((f.batch.mock.calls[0][0] as Linha[])[0]).toMatchObject({ queueName: 'publish-ml-imp-A' })
  })

  it.each([['item_ocupado'], ['escrita_pendente']])('reverter recusado (%s, ex.: aplicação B com a trava) → 409, estado intacto', async (codigo) => {
    comAplicacao('aplicada')
    fake.respostasRpc.galeria_iniciar_reversao = () => codigo
    expect(await chamar({ acao: 'reverter', ml_item_id: 'MLB1', aplicacao_id: APL })).toEqual({ status: 409, body: { error: codigo } })
    expect(db.galeria_aplicacoes[0].status).toBe('aplicada')
    expect(f.batch).not.toHaveBeenCalled()
  })

  it('split: a aplicação da partição 1 não é alcançada pela linha da partição 2 (404, nenhuma RPC)', async () => {
    comAplicacao('aplicada', 'an1')
    for (const acao of ['confirmar', 'reverter']) {
      expect((await chamar({ acao, ml_item_id: 'MLB2', aplicacao_id: APL })).status).toBe(404)
    }
    expect(fake.rpcs.map((x) => x.nome)).toEqual([])
  })

  it('outra org → 404', async () => {
    comAplicacao('aplicada')
    db.galeria_aplicacoes[0].org_id = 'outra'
    expect((await chamar({ acao: 'reverter', ml_item_id: 'MLB1', aplicacao_id: APL })).status).toBe(404)
  })
})
