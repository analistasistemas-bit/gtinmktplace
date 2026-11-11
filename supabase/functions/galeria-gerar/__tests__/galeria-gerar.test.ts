import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as { admin: unknown },
  vigencia: null as unknown as Record<string, unknown>,
  batch: vi.fn(),
  garantir: vi.fn(async () => {}),
  /** null = a trava real (MISSOES_LUPA_PENDENTE); {geral:[],moda:[]} = ramo liberado depois do portão (Task 16). */
  travas: null as null | { geral: number[]; moda: number[] },
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org', isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../_shared/galeria/referencias.ts', () => ({ calcularVigencia: vi.fn(async () => f.vigencia) }))
vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => { throw new Error('nunca chama IA') } }))
vi.mock('../../_shared/galeria/regras.ts', async (orig) => {
  const r = await orig<typeof import('../../_shared/galeria/regras.ts')>()
  return { ...r, lupaPendente: (m: number, moda: boolean) => r.lupaPendente(m, moda, f.travas ?? r.MISSOES_LUPA_PENDENTE) }
})
vi.mock('../../_shared/queue.ts', () => ({ qstashClient: () => ({ batchJSON: f.batch }), garantirFilaSerial: f.garantir }))

const { VERSAO_LEITURA } = await import('../../_shared/galeria/detalhes.ts')

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fetchs: string[]
let itemML: Linha
let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : undefined) } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

const PEDIDO = '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6'
const ref = (id: string) => ({ id, path: `org/galeria-ia/famB/referencias/${id}.jpg`, sha256: id })
const SEM = { erro: 'sem_referencia' }
const PRODUTO = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
/** Leitura da lupa (galeria_referencias.detalhes) com dois detalhes disjuntos: geral 3/7 e Moda 5/7 cabem. */
const lupaOk = (extra: Linha = {}) => ({
  estado: 'ok', versao: VERSAO_LEITURA, tentado_em: '2026-11-11T10:00:00Z', produto: PRODUTO, ref_w: 1200, ref_h: 1500, hash: 'h',
  detalhes: [{ x: 0.15, y: 0.15, w: 0.1, h: 0.1 }, { x: 0.7, y: 0.7, w: 0.1, h: 0.1 }], ...extra,
})
const refLinha = (id: string, detalhes: unknown) => ({ id, org_id: 'org', vista: 'frente', detalhes })
const missoes = (n: number[]) => n.map((missao) => ({ missao, ativa: true, cena: `cena ${missao}`, fatosUsados: [] }))
const roteiro = (extra: Linha = {}) => ({
  id: 'rot2', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', versao: 2, status: 'aprovado', moda: false,
  fatos_hash: 'h', conteudo: { categoria: 'Rendas', contrato: 'Renda', missoes: missoes([1, 2, 3, 4, 5, 6, 7]) }, ...extra,
})

beforeEach(() => {
  db = {
    organizations: [{ id: 'org', modulos_habilitados: ['imagem_ia'] }],
    anuncios_externos: [{ id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1', variacoes_externas: { '100R': {}, '100A': {} } }],
    anuncios_externos_itens: [],
    familias: [
      { id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z', variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }] },
      { id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }] },
    ],
    galeria_roteiros: [roteiro()],
    galeria_pedidos: [], galeria_imagens: [], configuracoes: [],
    galeria_referencias: [refLinha('refR', lupaOk()), refLinha('refA', lupaOk())],
  }
  f.travas = null
  fake = fakeAdmin(db)
  f.fake = fake
  fake.respostasRpc.platform_resolve_terms = () => ({ id: 'termos1', image_unit_cents: 50 })
  // Espelho da RPC: grava pedido e linhas (recorte já nasce gerada com alertas []).
  fake.respostasRpc.galeria_reservar_pedido = ({ p_pedido }) => {
    const p = p_pedido as Linha & { itens: Linha[] }
    db.galeria_pedidos.push({ id: p.id, org_id: p.org_id, anuncio_externo_id: p.anuncio_externo_id, unit_cents: p.unit_cents, terms_id: p.terms_id, elegivel: p.elegivel })
    const linhas = p.itens.map((it, n) => ({
      id: `img${n}`, org_id: p.org_id, anuncio_externo_id: p.anuncio_externo_id, pedido_id: p.id, roteiro_id: p.roteiro_id,
      cor: it.cor, missao: it.missao, geracao: 1, origem: it.origem, status: it.origem === 'recorte' ? 'gerada' : 'pendente',
      alertas: it.origem === 'recorte' ? [] : null, fase: 0, tentativa: 0, despacho_seq: 0, publicado_em: null,
    }))
    db.galeria_imagens.push(...linhas)
    return linhas
  }
  f.vigencia = {
    fatos: [], fatos_hash: 'h',
    referencias: { Rosa: { frente: ref('refR'), costas: ref('refRc'), lateral: SEM }, Azul: { frente: ref('refA'), costas: SEM, lateral: SEM } },
  }
  f.batch.mockReset()
  f.batch.mockImplementation(async (msgs: unknown[]) => msgs.map((_, i) => ({ messageId: `m${i}` })))
  itemML = { id: 'MLB1', catalog_listing: false, variations: [{ id: 11, seller_custom_field: '100R' }, { id: 12, seller_custom_field: '100A' }] }
  fetchs = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetchs.push(url)
    if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) return itemML.__status ? new Response('{}', { status: itemML.__status as number }) : Response.json(itemML)
    return new Response('{}', { status: 500 })
  }))
})

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-gerar', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const pedido = (extra: Linha = {}) => ({
  pedido_id: PEDIDO, ml_item_id: 'MLB1', roteiro_versao: 2, cores: ['Rosa', 'Azul'], missoes: [1, 2], unit_cents_exibido: 50, ...extra,
})
const semCusto = () => {
  expect(db.galeria_pedidos).toEqual([])
  expect(db.galeria_imagens).toEqual([])
  expect(fake.rpcs.map((r) => r.nome)).not.toContain('galeria_reservar_pedido')
  expect(fetchs.filter((u) => /openrouter|higgsfield/.test(u))).toEqual([])
  expect(f.batch).not.toHaveBeenCalled()
}

describe('galeria-gerar', () => {
  it('reserva o pedido com preço e termos congelados, recortes já gerada, e publica um job por imagem gerador', async () => {
    f.travas = { geral: [], moda: [] } // ramo liberado: missão 7 com lupa_ok
    const r = await chamar(pedido({ missoes: [1, 2, 7] }))
    expect(r.status).toBe(200)
    const reserva = fake.rpcs.find((x) => x.nome === 'galeria_reservar_pedido')!.args.p_pedido as Linha & { itens: Linha[] }
    expect(reserva).toMatchObject({ id: PEDIDO, org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', roteiro_id: 'rot2',
      unit_cents: 50, terms_id: 'termos1', elegivel: true, criado_por: 'u1' })
    expect(reserva.itens).toEqual([
      { cor: 'Rosa', missao: 1, origem: 'gerador', referencia_id: 'refR', modelo: 'google/gemini-nano-banana-2.1', provedor: 'openrouter' },
      { cor: 'Rosa', missao: 2, origem: 'gerador', referencia_id: 'refR', modelo: 'google/gemini-nano-banana-2.1', provedor: 'openrouter' },
      { cor: 'Azul', missao: 1, origem: 'gerador', referencia_id: 'refA', modelo: 'google/gemini-nano-banana-2.1', provedor: 'openrouter' },
      { cor: 'Azul', missao: 2, origem: 'gerador', referencia_id: 'refA', modelo: 'google/gemini-nano-banana-2.1', provedor: 'openrouter' },
      { cor: 'Rosa', missao: 7, origem: 'recorte', referencia_id: 'refR' },
      { cor: 'Azul', missao: 7, origem: 'recorte', referencia_id: 'refA' },
    ])
    const msgs = f.batch.mock.calls[0][0] as Linha[]
    expect(msgs).toHaveLength(4)
    expect(msgs[0]).toMatchObject({ url: 'https://x.supabase.co/functions/v1/galeria-worker', retries: 0, deduplicationId: 'img0_1',
      body: { tipo: 'imagem', id: 'img0', fase: 0, tentativa: 0, despacho_seq: 1, acao: 'submeter' } })
    expect(db.galeria_imagens.filter((i) => i.origem === 'recorte').every((i) => i.status === 'gerada')).toBe(true)
    expect((r.body.imagens as Linha[])).toHaveLength(6)
  })

  it('sem condição comercial → pedido não elegível, preço 0', async () => {
    fake.respostasRpc.platform_resolve_terms = () => ({ id: null, image_unit_cents: null })
    expect((await chamar(pedido({ unit_cents_exibido: 0 }))).status).toBe(200)
    expect(fake.rpcs.find((x) => x.nome === 'galeria_reservar_pedido')!.args.p_pedido).toMatchObject({ unit_cents: 0, terms_id: null, elegivel: false })
  })

  it('preço do mês ≠ exibido → preco_mudou com o novo preço, sem pedido', async () => {
    const r = await chamar(pedido({ unit_cents_exibido: 40 }))
    expect(r).toEqual({ status: 409, body: { error: 'preco_mudou', unit_cents: 50 } })
    semCusto()
  })

  it('roteiro aprovado de família antiga do mesmo anúncio → 409 familia_nao_vigente com o id vigente', async () => {
    db.galeria_roteiros = [roteiro({ familia_id: 'famA' })]
    const r = await chamar(pedido())
    expect(r).toEqual({ status: 409, body: { error: 'familia_nao_vigente', familia_id_vigente: 'famB' } })
    semCusto()
  })

  it('roteiro não aprovado (ou outra versão) → recusa', async () => {
    db.galeria_roteiros = [roteiro({ status: 'rascunho' })]
    expect((await chamar(pedido())).body.error).toBe('roteiro_nao_aprovado')
    db.galeria_roteiros = [roteiro()]
    expect((await chamar(pedido({ roteiro_versao: 3 }))).body.error).toBe('roteiro_nao_aprovado')
    semCusto()
  })

  it.each([[true, 'catalogo'], [undefined, 'catalogo_desconhecido']])('item com catalog_listing %s → %s, zero linhas e nenhum provedor', async (cat, motivo) => {
    itemML = { ...itemML, catalog_listing: cat }
    const r = await chamar(pedido())
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ error: motivo, item_id: 'MLB1' })
    semCusto()
  })

  it('cor com conjunto incompleto → recusa sem pedido', async () => {
    // SKU vivo no anúncio sem variação em nenhuma família publicada.
    db.anuncios_externos[0].variacoes_externas = { '100R': {}, '100A': {}, '100X': {} }
    const r = await chamar(pedido())
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ error: 'conjunto_incompleto', cor: 'Rosa' })
    semCusto()
  })

  it('SKU que não casa no GET → variacao_nao_casa, sem pedido', async () => {
    itemML = { ...itemML, variations: [{ id: 11, seller_custom_field: '100R' }] }
    const r = await chamar(pedido())
    expect(r.body).toMatchObject({ error: 'variacao_nao_casa', cor: 'Azul' })
    semCusto()
  })

  it('GET do ML com 5xx → ml_indisponivel (503, retentável), nunca catalogo_desconhecido, sem pedido', async () => {
    itemML = { __status: 500 }
    const r = await chamar(pedido())
    expect(r).toEqual({ status: 503, body: { error: 'ml_indisponivel' } })
    semCusto()
  })

  it('fato NAO_CONFERIDO citado sem ciência do operador → conteudo.ciencia_nao_conferido', async () => {
    db.galeria_roteiros[0].conteudo = { categoria: 'Rendas', contrato: 'Renda', missoes: [{ missao: 1, ativa: true, cena: 'c', fatosUsados: ['marca'] }] }
    f.vigencia = { ...f.vigencia, fatos: [{ campo: 'marca', valor: 'Avil', estado: 'NAO_CONFERIDO', origem: 'planilha', evidencia: {} }] }
    const r = await chamar(pedido({ missoes: [1] }))
    expect(r).toEqual({ status: 409, body: { error: 'conteudo.ciencia_nao_conferido', campos: ['marca'] } })
    semCusto()
  })

  it('Moda: "De costas" sem referência de costas na cor → sem_vista (por cor), sem pedido', async () => {
    db.galeria_roteiros = [roteiro({ moda: true })]
    const r = await chamar(pedido({ missoes: [3] }))
    expect(r).toEqual({ status: 409, body: { error: 'sem_vista', bloqueadas: [{ cor: 'Azul', missao: 3, motivo: 'sem_vista' }] } })
    semCusto()
  })

  it('missão desativada no roteiro → recusa', async () => {
    db.galeria_roteiros[0].conteudo = { categoria: 'Rendas', contrato: 'Renda', missoes: [{ missao: 1, ativa: true, cena: 'c', fatosUsados: [] }, { missao: 2, ativa: false, cena: 'c', fatosUsados: [] }] }
    expect((await chamar(pedido({ missoes: [2] }))).body).toEqual({ error: 'missao_inativa', missoes: [2] })
    semCusto()
  })

  it('repetir o mesmo pedido_id devolve as linhas existentes, sem nova reserva nem conferência de preço', async () => {
    await chamar(pedido())
    const reservas = fake.rpcs.filter((x) => x.nome === 'galeria_reservar_pedido').length
    f.batch.mockClear()
    fake.respostasRpc.platform_resolve_terms = () => ({ id: 'termos2', image_unit_cents: 99 })
    const r = await chamar(pedido())
    expect(r.status).toBe(200)
    expect((r.body.imagens as Linha[])).toHaveLength(4)
    expect(fake.rpcs.filter((x) => x.nome === 'galeria_reservar_pedido')).toHaveLength(reservas)
  })

  it('corrida: a RPC recusa em_andamento → 409', async () => {
    fake.respostasRpc.galeria_reservar_pedido = () => { throw { message: 'em_andamento', code: 'P0001' } }
    expect(await chamar(pedido())).toEqual({ status: 409, body: { error: 'em_andamento' } })
  })

  // Revisão geral (bloqueador 3): fato editado em outra tela depois do roteiro aprovado → mesma comparação do `preparar`
  // do galeria-aplicar; nunca reserva nem cobra imagem que o aplicar recusaria.
  it('fatos_hash vigente ≠ o do roteiro aprovado → 409 desatualizada antes de reservar (zero linhas, zero provedor)', async () => {
    f.vigencia.fatos_hash = 'h2'
    expect(await chamar(pedido())).toMatchObject({ status: 409, body: { error: 'desatualizada' } })
    semCusto()
  })

  it('org sem o módulo imagem_ia → 403', async () => {
    db.organizations[0].modulos_habilitados = []
    expect((await chamar(pedido())).status).toBe(403)
    semCusto()
  })

  it('falha ao publicar o job não derruba o pedido (o despachante retoma)', async () => {
    f.batch.mockRejectedValueOnce(new Error('qstash fora'))
    expect((await chamar(pedido())).status).toBe(200)
  })

  describe('lupa pela caixa do produto (nunca cobra o que não aprova)', () => {
    it.each([
      ['geral 3 (gerador)', false, [3]], ['geral 7 (recorte)', false, [7]], ['Moda 5 (recorte)', true, [5]], ['Moda 7 (recorte)', true, [7]],
    ])('%s em MISSOES_LUPA_PENDENTE com lupa_ok → 409 lupa_pendente, zero linhas', async (_n, moda, ms) => {
      db.galeria_roteiros = [roteiro({ moda })]
      const r = await chamar(pedido({ missoes: [1, ...ms] }))
      expect(r).toEqual({ status: 409, body: { error: 'lupa_pendente', missoes: ms } })
      semCusto()
    })

    it('geral 3 com cor sem detalhe (lupa_ok=false) → 409 lupa_indisponivel, zero linhas e nenhum provedor', async () => {
      f.travas = { geral: [], moda: [] }
      db.galeria_referencias = [refLinha('refR', lupaOk()), refLinha('refA', { estado: 'sem_detalhe', versao: VERSAO_LEITURA, tentado_em: 't' })]
      const r = await chamar(pedido({ missoes: [1, 3] }))
      expect(r).toEqual({ status: 409, body: { error: 'lupa_indisponivel', bloqueadas: [{ cor: 'Azul', missao: 3, motivo: 'lupa_indisponivel' }] } })
      semCusto()
    })

    it.each([
      ['nunca lida', null], ['falhou', { estado: 'falhou', versao: VERSAO_LEITURA, tentado_em: 't' }],
      ['versão antiga', lupaOk({ versao: 'openai/velho#lupa-v0' })],
    ])('leitura %s → 409 lupa_lendo (retentável, distinta de sem_detalhe), zero linhas', async (_n, d) => {
      f.travas = { geral: [], moda: [] }
      db.galeria_referencias = [refLinha('refR', d), refLinha('refA', lupaOk())]
      const r = await chamar(pedido({ missoes: [3] }))
      expect(r).toEqual({ status: 409, body: { error: 'lupa_lendo', bloqueadas: [{ cor: 'Rosa', missao: 3, motivo: 'lupa_lendo' }] } })
      semCusto()
    })

    it('recorte (geral 7) com um só detalhe (não cabe) → nenhuma linha reservada', async () => {
      f.travas = { geral: [], moda: [] }
      db.galeria_referencias = [refLinha('refR', lupaOk({ detalhes: [{ x: 0.15, y: 0.15, w: 0.1, h: 0.1 }] })), refLinha('refA', lupaOk())]
      const r = await chamar(pedido({ missoes: [1, 7] }))
      expect(r.body).toEqual({ error: 'lupa_indisponivel', bloqueadas: [{ cor: 'Rosa', missao: 7, motivo: 'lupa_indisponivel' }] })
      semCusto()
    })

    it('ramo liberado com lupa_ok em todas as cores → reserva geral 3 (gerador) normalmente', async () => {
      f.travas = { geral: [], moda: [] }
      expect((await chamar(pedido({ missoes: [3] }))).status).toBe(200)
      expect((fake.rpcs.find((x) => x.nome === 'galeria_reservar_pedido')!.args.p_pedido as { itens: Linha[] }).itens.map((i) => i.missao)).toEqual([3, 3])
    })
  })
})
