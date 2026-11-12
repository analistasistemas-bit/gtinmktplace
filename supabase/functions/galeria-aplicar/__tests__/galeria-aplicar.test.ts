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
    organizations: [{ id: 'org', modulos_habilitados: ['imagem_ia'] }, { id: 'org2', modulos_habilitados: ['imagem_ia'] }],
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
  // Revisão geral (item 4): aplicar foto nova exige o módulo imagem_ia. Reverter e estado ficam fora do gate: desligar
  // o módulo é o plano de volta e não pode prender fotos já aplicadas no ML.
  it('módulo imagem_ia desligado → preparar e confirmar 403; estado e reverter seguem', async () => {
    db.organizations[0].modulos_habilitados = []
    for (const acao of ['preparar', 'confirmar']) {
      expect(await chamar({ acao, ml_item_id: 'MLB1', cor: 'Rosa', modo: 'substituir', aplicacao_id: APL }))
        .toMatchObject({ status: 403, body: { error: 'modulo_desligado' } })
    }
    expect(db.galeria_aplicacoes).toEqual([])
    expect(metodos).toEqual([])
    expect((await chamar({ acao: 'estado', ml_item_id: 'MLB1' })).status).toBe(200)
    expect((await chamar({ acao: 'reverter', ml_item_id: 'MLB1', aplicacao_id: APL })).body).not.toEqual({ error: 'modulo_desligado' })
  })

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

  // Fase C2: prévia "Hoje no anúncio" × "Depois" na resposta; nada dela é gravado e o ML só recebe GET.
  describe('prévia', () => {
    const comUrls = (i: Linha) => ({ ...i, pictures: (i.pictures as Linha[]).map((p) => ({ ...p, secure_url: `https://ml/${p.id}.jpg` })) })
    const comFinal = () => db.galeria_imagens.forEach((i) => { i.final_path = `final/${i.id}.jpg` })

    it('Substituir com capa aprovada: hoje riscada, depois só as novas na ordem, com URL assinada; manifesto gravado igual', async () => {
      itensML.MLB1 = comUrls(legacyML('MLB1'))
      comFinal()
      const r = await preparar()
      expect(r.status).toBe(200)
      expect(r.body.previa).toEqual([{
        item_id: 'MLB1',
        variacoes: 1,
        antes: [{ id: 'R0', url: 'https://ml/R0.jpg', sai: true }],
        depois: [{ id: 'novo-1', url: 'https://signed/final/g1.jpg', nova: true, missao: 1 }, { id: 'novo-3', url: 'https://signed/final/g3.jpg', nova: true, missao: 3 }],
      }])
      expect(db.galeria_aplicacoes[0].manifesto).toEqual([{ imagem_id: 'g1', missao: 1, final_sha256: 'sha-g1' }, { imagem_id: 'g3', missao: 3, final_sha256: 'sha-g3' }])
      expect(JSON.stringify(db.galeria_aplicacoes[0]) + JSON.stringify(db.galeria_aplicacao_itens)).not.toContain('https://')
      expect(metodos.every((m) => m === 'GET')).toBe(true)
      expect(f.batch).not.toHaveBeenCalled()
    })

    it('cor com 2 variações no MLB: a prévia diz quantas serão alteradas (prévia pela 1ª, confirmar vale para todas)', async () => {
      db.anuncios_externos[0].variacoes_externas = { '100R': {}, '100R2': {}, '100A': {} }
      const famB = db.familias.find((x) => x.id === 'famB')!
      famB.variacoes = [...(famB.variacoes as Linha[]), { codigo: '100R2', cor: 'Rosa' }]
      itensML.MLB1 = comUrls({ ...legacyML('MLB1'), variations: [{ id: 11, seller_custom_field: '100R', picture_ids: ['R0'] },
        { id: 13, seller_custom_field: '100R2', picture_ids: ['R0'] }, { id: 12, seller_custom_field: '100A', picture_ids: ['A0'] }] })
      const r = await preparar()
      expect(r.status).toBe(200)
      expect((r.body.previa as Linha[])[0].variacoes).toBe(2)
      expect(metodos.every((m) => m === 'GET')).toBe(true)
    })

    it('Substituir sem a capa aprovada: a 1ª foto atual fica e não sai riscada', async () => {
      db.galeria_imagens = db.galeria_imagens.filter((i) => i.id !== 'g1')
      itensML.MLB1 = comUrls({ ...legacyML('MLB1'), pictures: [{ id: 'R0' }, { id: 'R1' }, { id: 'A0' }],
        variations: [{ id: 11, seller_custom_field: '100R', picture_ids: ['R0', 'R1'] }, { id: 12, seller_custom_field: '100A', picture_ids: ['A0'] }] })
      const p = ((await preparar()).body.previa as Linha[])[0]
      expect(p.antes).toEqual([{ id: 'R0', url: 'https://ml/R0.jpg', sai: false }, { id: 'R1', url: 'https://ml/R1.jpg', sai: true }])
      expect((p.depois as Linha[]).map((d) => [d.id, d.nova])).toEqual([['R0', false], ['novo-3', true]])
    })

    it('Adicionar: nada riscado, as atuais seguem e as novas entram depois', async () => {
      itensML.MLB1 = comUrls(legacyML('MLB1'))
      const p = ((await preparar({ modo: 'adicionar' })).body.previa as Linha[])[0]
      expect((p.antes as Linha[]).map((x) => x.sai)).toEqual([false])
      expect((p.depois as Linha[]).map((d) => d.id)).toEqual(['R0', 'novo-1', 'novo-3'])
    })

    it('UP P/M/G → uma prévia por MLB; sem secure_url nem final_path a URL é null (sem GET extra por foto)', async () => {
      const r = await preparar({ ml_item_id: 'MLB3M' })
      const previa = r.body.previa as Linha[]
      expect(previa.map((x) => x.item_id).sort()).toEqual(['MLB3G', 'MLB3M', 'MLB3P'])
      expect(previa[0].antes).toEqual([{ id: `F-${(previa[0].item_id as string).replace('MLB3', '300')}`, url: null, sai: true }])
      expect(previa[0].depois).toEqual([{ id: 'novo-1', url: null, nova: true, missao: 1 }])
      expect(metodos.filter((m) => m === 'GET').length).toBeLessThanOrEqual(6)
      expect(metodos.every((m) => m === 'GET')).toBe(true)
    })
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

describe('galeria-aplicar — estado (somente leitura)', () => {
  const semear = (anuncio = 'an1', id = APL, criado = '2026-11-10T10:00:00Z') => {
    db.galeria_aplicacoes.push({ id, org_id: 'org', anuncio_externo_id: anuncio, familia_id: 'famB', cor: 'Rosa', modo: 'substituir',
      status: 'aplicada', manifesto: [{ imagem_id: 'g1', missao: 1, final_sha256: 's' }], criado_em: criado, retrato: { segredo: true } })
    db.galeria_aplicacao_itens.push({ id: `it-${id}`, org_id: 'org', aplicacao_id: id, item_id: 'MLB1', status: 'pulado', erro: 'x', fotos_antes: {} })
  }
  const B = '22222222-2222-4222-8222-222222222222'

  it('não admin → 403', async () => {
    f.auth = { ...f.auth, isAdmin: false }
    expect((await chamar({ acao: 'estado', ml_item_id: 'MLB1' })).status).toBe(403)
  })

  it('sem aplicacao_id lista as do anúncio da linha (mais nova primeiro), com itens e manifesto, sem escrever nem chamar o ML', async () => {
    semear('an1', APL, '2026-11-10T10:00:00Z')
    semear('an1', B, '2026-11-11T10:00:00Z')
    semear('an2', '33333333-3333-4333-8333-333333333333')
    const r = await chamar({ acao: 'estado', ml_item_id: 'MLB1' })
    expect(r.status).toBe(200)
    const lista = r.body.aplicacoes as Linha[]
    expect(lista.map((a) => a.id)).toEqual([B, APL])
    expect(lista[0]).toEqual({ id: B, cor: 'Rosa', modo: 'substituir', status: 'aplicada',
      manifesto: [{ imagem_id: 'g1', missao: 1, final_sha256: 's' }],
      itens: [{ item_id: 'MLB1', status: 'pulado', erro: 'x', fotos_total: 0, fotos_enviadas: 0, trocado: false, conferido: false }] })
    expect(fake.rpcs).toEqual([])
    expect(metodos).toEqual([])
  })

  it('progresso por item: fotos enviadas, troca e conferência; nada interno sai', async () => {
    semear('an1', APL)
    const novas = (prontas: number) => Array.from({ length: 7 }, (_, k) => ({ imagem_id: `g${k}`, missao: k + 1, final_sha256: 's',
      upload_id: k < prontas + 1 ? `U${k}` : null, pronta: k < prontas }))
    Object.assign(db.galeria_aplicacao_itens[0], { status: 'subindo', erro: null, fotos_novas: novas(4), put_em: null, publicado_em: '2026-11-11T10:00:00Z' })
    db.galeria_aplicacao_itens.push({ id: 'it-2', org_id: 'org', aplicacao_id: APL, item_id: 'MLB9', status: 'aplicado', erro: null,
      fotos_novas: novas(7), put_em: '2026-11-11T10:05:00Z', publicado_em: null, corpo_planejado: { direcao: 'ida' } })
    const itens = ((await chamar({ acao: 'estado', ml_item_id: 'MLB1' })).body.aplicacoes as Linha[])[0].itens as Linha[]
    expect(itens).toEqual([
      { item_id: 'MLB1', status: 'subindo', erro: null, fotos_total: 7, fotos_enviadas: 4, trocado: false, conferido: false },
      { item_id: 'MLB9', status: 'aplicado', erro: null, fotos_total: 7, fotos_enviadas: 7, trocado: true, conferido: true },
    ])
  })

  it('com aplicacao_id devolve só essa; de outra org → lista vazia', async () => {
    semear('an1', APL)
    semear('an1', B)
    expect(((await chamar({ acao: 'estado', ml_item_id: 'MLB1', aplicacao_id: APL })).body.aplicacoes as Linha[]).map((a) => a.id)).toEqual([APL])
    db.galeria_aplicacoes.forEach((a) => { a.org_id = 'outra' })
    expect((await chamar({ acao: 'estado', ml_item_id: 'MLB1' })).body).toEqual({ aplicacoes: [] })
  })
})
