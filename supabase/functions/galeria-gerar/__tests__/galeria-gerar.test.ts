import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'
import type { Plano } from '../../_shared/galeria/plano.ts'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as { admin: unknown },
  vigencia: null as unknown as Record<string, unknown>,
  batch: vi.fn(),
  garantir: vi.fn(async () => {}),
  planejar: vi.fn(),
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org', isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../_shared/galeria/referencias.ts', () => ({ calcularVigencia: vi.fn(async () => f.vigencia) }))
vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => { throw new Error('nunca chama IA real') } }))
vi.mock('../../_shared/galeria/planejador.ts', async (orig) => ({
  ...(await orig<typeof import('../../_shared/galeria/planejador.ts')>()), gerarPlanoIA: f.planejar,
}))
vi.mock('../../_shared/queue.ts', () => ({ qstashClient: () => ({ batchJSON: f.batch }), garantirFilaSerial: f.garantir }))

const { hashDados } = await import('../../_shared/galeria/planejador.ts')

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fetchs: string[]
let itemML: Linha
let fichaML: { status?: number; attributes?: unknown[] }
let categoria: Array<{ id: string }> | null
let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : undefined) } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

const PEDIDO = '6f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6'
const ref = (id: string) => ({ id, path: `org/galeria-ia/famB/referencias/${id}.jpg`, sha256: id })
const SEM = { erro: 'sem_referencia' }

const planoDe = (dadosHash: string, indisponiveis: number[] = []): Plano => ({
  formato: 2, dados_hash: dadosHash, conflitos: [],
  paleta: { cor1: { nome: 'Rosa', hex: '#D91F58' }, cor2: { nome: 'Amarelo', hex: '#F2D631' } },
  imagens: ([1, 2, 3, 4, 5, 6, 7] as const).map((posicao) => indisponiveis.includes(posicao)
    ? { posicao, funcao: `f${posicao}`, textos: [], prompt: '', indisponivel: 'poucos dados' }
    : { posicao, funcao: `f${posicao}`, textos: [], prompt: `p${posicao} {{COR}}` }),
})

/** Espelho de galeria_aprovar_roteiro (20261109153037). */
const espelhoAprovar = (d: Record<string, Linha[]>) => (args: Linha) => {
  const r = d.galeria_roteiros.find((x) => x.id === args.p_roteiro && x.org_id === args.p_org)
  if (!r) return 'nao_encontrado'
  if (r.status !== 'rascunho') return 'nao_rascunho'
  if (r.familia_id !== args.p_familia) return 'familia_nao_vigente'
  d.galeria_roteiros.filter((x) => x.anuncio_externo_id === r.anuncio_externo_id && x.status === 'aprovado').forEach((x) => { x.status = 'desatualizado' })
  for (const i of d.galeria_imagens) {
    if (i.anuncio_externo_id !== r.anuncio_externo_id || i.roteiro_id === r.id) continue
    if (i.status === 'pendente') Object.assign(i, { status: 'falhou', erro: 'roteiro_trocado' })
    else if (i.status === 'gerada' || i.status === 'aprovada') i.status = 'desatualizada'
  }
  Object.assign(r, { status: 'aprovado', fatos_hash: args.p_fatos_hash, conteudo: args.p_conteudo })
  return 'ok'
}

beforeEach(() => {
  db = {
    organizations: [{ id: 'org', modulos_habilitados: ['imagem_ia'] }],
    anuncios_externos: [{ id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1', variacoes_externas: { '100R': {}, '100A': {} } }],
    anuncios_externos_itens: [],
    familias: [
      { id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z', categoria_ml_id: 'MLB999', variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }] },
      { id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', categoria_ml_id: 'MLB999', nome_pai: 'Renda',
        variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }] },
    ],
    galeria_roteiros: [],
    galeria_pedidos: [], galeria_imagens: [], galeria_aplicacoes: [], configuracoes: [],
  }
  fake = fakeAdmin(db)
  f.fake = fake
  fake.respostasRpc.platform_resolve_terms = () => ({ id: 'termos1', image_unit_cents: 50 })
  fake.respostasRpc.galeria_aprovar_roteiro = espelhoAprovar(db)
  // Espelho da RPC: grava pedido e linhas.
  fake.respostasRpc.galeria_reservar_pedido = ({ p_pedido }) => {
    const p = p_pedido as Linha & { itens: Linha[] }
    db.galeria_pedidos.push({ id: p.id, org_id: p.org_id, anuncio_externo_id: p.anuncio_externo_id, unit_cents: p.unit_cents, terms_id: p.terms_id, elegivel: p.elegivel })
    const linhas = p.itens.map((it, n) => ({
      id: `img${n}`, org_id: p.org_id, anuncio_externo_id: p.anuncio_externo_id, pedido_id: p.id, roteiro_id: p.roteiro_id,
      cor: it.cor, missao: it.missao, geracao: 1, origem: it.origem, status: 'pendente',
      alertas: null, fase: 0, tentativa: 0, despacho_seq: 0, publicado_em: null,
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
  f.planejar.mockReset()
  f.planejar.mockImplementation(async (q: { dados: Parameters<typeof hashDados>[0] }) => ({ plano: planoDe(hashDados(q.dados)) }))
  itemML = { id: 'MLB1', catalog_listing: false, variations: [{ id: 11, seller_custom_field: '100R' }, { id: 12, seller_custom_field: '100A' }] }
  fichaML = { attributes: [{ id: 'MATERIAL', name: 'Material', value_name: 'Algodão' }] }
  categoria = [{ id: 'MLB1574' }, { id: 'MLB999' }]
  fetchs = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetchs.push(url)
    if (url === 'https://api.mercadolibre.com/items/MLB1?attributes=attributes') {
      return fichaML.status ? new Response('{}', { status: fichaML.status }) : Response.json({ attributes: fichaML.attributes })
    }
    if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) return itemML.__status ? new Response('{}', { status: itemML.__status as number }) : Response.json(itemML)
    if (url === 'https://api.mercadolibre.com/categories/MLB999') return categoria ? Response.json({ path_from_root: categoria }) : new Response('{}', { status: 500 })
    return new Response('{}', { status: 500 })
  }))
})

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-gerar', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const pedido = (extra: Linha = {}) => ({
  pedido_id: PEDIDO, ml_item_id: 'MLB1', cores: ['Rosa', 'Azul'], missoes: [1, 2], unit_cents_exibido: 50, ...extra,
})
const semPedido = () => {
  expect(db.galeria_pedidos.filter((p) => p.id === PEDIDO)).toEqual([])
  expect(db.galeria_imagens.filter((i) => i.pedido_id === PEDIDO)).toEqual([])
  expect(fake.rpcs.map((r) => r.nome)).not.toContain('galeria_reservar_pedido')
  expect(fetchs.filter((u) => /openrouter|higgsfield/.test(u))).toEqual([])
  expect(f.batch).not.toHaveBeenCalled()
}
/** Recusa antes do plano: além de sem pedido, sem IA e sem plano gravado. */
const semCusto = () => {
  semPedido()
  expect(f.planejar).not.toHaveBeenCalled()
  expect(db.galeria_roteiros).toEqual([])
}
const reserva = () => fake.rpcs.find((x) => x.nome === 'galeria_reservar_pedido')!.args.p_pedido as Linha & { itens: Linha[] }
const aprovado = () => db.galeria_roteiros.find((r) => r.status === 'aprovado')!

describe('galeria-gerar', () => {
  it('sem plano: cria o plano e reserva todas como origem gerador', async () => {
    const r = await chamar(pedido({ missoes: [1, 2, 7] }))
    expect(r.status).toBe(200)
    expect(f.planejar).toHaveBeenCalledTimes(1)
    expect(f.planejar.mock.calls[0][0]).toMatchObject({
      refUrl: 'https://signed/org/galeria-ia/famB/referencias/refR.jpg', moda: false, cores: ['Azul', 'Rosa'],
      dados: { nome: 'Renda', ficha_do_anuncio: { Material: 'Algodão' }, total_de_cores: 2 },
    })
    expect(fetchs).toContain('https://api.mercadolibre.com/items/MLB1?attributes=attributes')
    const rot = aprovado()
    expect(rot).toMatchObject({ familia_id: 'famB', fatos_hash: 'h', moda: false, versao: 1 })
    expect(reserva()).toMatchObject({ id: PEDIDO, org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', roteiro_id: rot.id,
      unit_cents: 50, terms_id: 'termos1', elegivel: true, criado_por: 'u1' })
    const g = (cor: string, missao: number, referencia_id: string) =>
      ({ cor, missao, origem: 'gerador', referencia_id, modelo: 'google/gemini-nano-banana-2.1', provedor: 'openrouter' })
    expect(reserva().itens).toEqual([g('Rosa', 1, 'refR'), g('Rosa', 2, 'refR'), g('Rosa', 7, 'refR'), g('Azul', 1, 'refA'), g('Azul', 2, 'refA'), g('Azul', 7, 'refA')])
    const msgs = f.batch.mock.calls[0][0] as Linha[]
    expect(msgs).toHaveLength(6)
    expect(msgs[0]).toMatchObject({ url: 'https://x.supabase.co/functions/v1/galeria-worker', retries: 0, deduplicationId: 'img0_1',
      body: { tipo: 'imagem', id: 'img0', fase: 0, tentativa: 0, despacho_seq: 1, acao: 'submeter' } })
    expect((r.body.imagens as Linha[])).toHaveLength(6)
  })

  it('segundo pedido com o plano ainda válido reaproveita (sem nova IA nem novo roteiro)', async () => {
    await chamar(pedido({ missoes: [1] }))
    const rot = aprovado()
    db.galeria_imagens.forEach((i) => { i.status = 'gerada' })
    expect((await chamar(pedido({ pedido_id: '7f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', missoes: [2] }))).status).toBe(200)
    expect(f.planejar).toHaveBeenCalledTimes(1)
    expect(db.galeria_roteiros).toHaveLength(1)
    expect((fake.rpcs.filter((x) => x.nome === 'galeria_reservar_pedido')[1].args.p_pedido as Linha).roteiro_id).toBe(rot.id)
  })

  it('sem condição comercial → pedido não elegível, preço 0', async () => {
    fake.respostasRpc.platform_resolve_terms = () => ({ id: null, image_unit_cents: null })
    expect((await chamar(pedido({ unit_cents_exibido: 0 }))).status).toBe(200)
    expect(reserva()).toMatchObject({ unit_cents: 0, terms_id: null, elegivel: false })
  })

  it('preço do mês ≠ exibido → preco_mudou com o novo preço, sem pedido', async () => {
    const r = await chamar(pedido({ unit_cents_exibido: 40 }))
    expect(r).toEqual({ status: 409, body: { error: 'preco_mudou', unit_cents: 50 } })
    semCusto()
  })

  it('nenhuma recusa anterior ao plano chama a IA (preço mudou, catálogo, cor inválida)', async () => {
    expect((await chamar(pedido({ unit_cents_exibido: 40 }))).body.error).toBe('preco_mudou')
    expect(await chamar(pedido({ cores: ['Rosa', 'Verde'] }))).toEqual({ status: 400, body: { error: 'cor_invalida', cores: ['Verde'] } })
    itemML = { ...itemML, catalog_listing: true }
    expect((await chamar(pedido())).body.error).toBe('catalogo')
    semCusto()
    expect(fetchs.filter((u) => u.includes('attributes=attributes') || u.includes('/categories/'))).toEqual([])
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

  describe('elegibilidade das cores em paralelo (UP: um MLB por SKU)', () => {
    const up = (statusRosa: string) => {
      db.anuncios_externos_itens.push(
        { anuncio_externo_id: 'an1', org_id: 'org', sku: '100R', item_externo_id: 'MLB1', status: statusRosa, retirado: false },
        { anuncio_externo_id: 'an1', org_id: 'org', sku: '100A', item_externo_id: 'MLB2', status: 'ativo', retirado: false },
      )
    }

    it('a 1ª cor pedida com problema define o erro, mesmo que um GET só da cor seguinte falhe antes', async () => {
      up('encerrado') // Rosa recusa sem GET; Azul lê MLB2, que falha
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        fetchs.push(url)
        if (url.includes('/items/MLB2?attributes=id,status')) return Response.json({ id: 'MLB2', variations: [{ id: 1 }] })
        return new Response('{}', { status: 500 })
      }))
      const r = await chamar(pedido())
      expect(r).toEqual({ status: 409, body: { error: 'conjunto_incompleto', cor: 'Rosa', detalhe: '100R:encerrado' } })
      semCusto()
    })

    it('as leituras do ML das cores correm ao mesmo tempo', async () => {
      up('ativo')
      let ativos = 0
      let max = 0
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        fetchs.push(url)
        const m = url.match(/\/items\/(MLB\d)\?attributes=id,status/)
        if (!m) return new Response('{}', { status: 500 })
        ativos++
        max = Math.max(max, ativos)
        await new Promise((res) => setTimeout(res, 10))
        ativos--
        return Response.json({ id: m[1], seller_custom_field: m[1] === 'MLB1' ? '100R' : '100A', variations: [] })
      }))
      await chamar(pedido())
      expect(fetchs.filter((u) => u.includes('attributes=id,status'))).toHaveLength(2)
      expect(max).toBe(2)
    })

    // UP plano: backfill casa o SKU e não há lerItem dentro de alvosDaCor; o GET de elegibilidade também corre junto.
    const upPlano = (eleg: (id: string) => Response) => {
      let ativos = 0
      const r = { max: 0 }
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        fetchs.push(url)
        const bf = url.match(/\/items\/(MLB\d)\?attributes=id,status/)
        if (bf) return Response.json({ id: bf[1], seller_custom_field: bf[1] === 'MLB1' ? '100R' : '100A', variations: [] })
        const el = url.match(/\/items\/(MLB\d)\?attributes=id,catalog_listing/)
        if (!el) return new Response('{}', { status: 500 })
        ativos++
        r.max = Math.max(r.max, ativos)
        await new Promise((res) => setTimeout(res, 10))
        ativos--
        return eleg(el[1])
      }))
      return r
    }

    it('UP plano: GETs de elegibilidade das cores ao mesmo tempo', async () => {
      up('ativo')
      const r = upPlano((id) => Response.json({ id, catalog_listing: false, variations: [] }))
      await chamar(pedido())
      expect(fetchs.filter((u) => u.includes('attributes=id,catalog_listing'))).toHaveLength(2)
      expect(r.max).toBe(2)
    })

    it('UP com fichas diferentes por MLB: a ficha do plano é a do menor SKU, qualquer que seja a cor pedida (plano reaproveitado)', async () => {
      up('ativo') // 100A → MLB2 é o menor SKU; 100R → MLB1
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        fetchs.push(url)
        const bf = url.match(/\/items\/(MLB\d)\?attributes=id,status/)
        if (bf) return Response.json({ id: bf[1], seller_custom_field: bf[1] === 'MLB1' ? '100R' : '100A', variations: [] })
        const el = url.match(/\/items\/(MLB\d)\?attributes=id,catalog_listing/)
        if (el) return Response.json({ id: el[1], catalog_listing: false, variations: [] })
        const ficha = url.match(/\/items\/(MLB\d)\?attributes=attributes$/)
        if (ficha) return Response.json({ attributes: [{ id: 'MATERIAL', name: 'Material', value_name: ficha[1] === 'MLB1' ? 'Algodão' : 'Poliéster' }] })
        if (url === 'https://api.mercadolibre.com/categories/MLB999') return Response.json({ path_from_root: categoria })
        return new Response('{}', { status: 500 })
      }))
      expect((await chamar(pedido({ cores: ['Rosa'], missoes: [1] }))).status).toBe(200)
      db.galeria_imagens.forEach((i) => { Object.assign(i, { status: 'gerada', entregue_em: '2026-11-10T10:00:00Z' }) })
      expect((await chamar(pedido({ pedido_id: '7f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', cores: ['Azul'], missoes: [1] }))).status).toBe(200)
      expect(fetchs.filter((u) => u.includes('attributes=attributes'))).toEqual([
        'https://api.mercadolibre.com/items/MLB2?attributes=attributes', 'https://api.mercadolibre.com/items/MLB2?attributes=attributes',
      ])
      expect(f.planejar).toHaveBeenCalledTimes(1)
      expect(f.planejar.mock.calls[0][0]).toMatchObject({ dados: { ficha_do_anuncio: { Material: 'Poliéster' } } })
    })

    it('UP plano: o GET adiantado da cor seguinte não muda a resposta da 1ª (catálogo, não ml_indisponivel)', async () => {
      up('ativo')
      upPlano((id) => (id === 'MLB1' ? Response.json({ id, catalog_listing: true, variations: [] }) : new Response('{}', { status: 500 })))
      expect(await chamar(pedido())).toEqual({ status: 409, body: { error: 'catalogo', cor: 'Rosa', item_id: 'MLB1' } })
      semCusto()
    })
  })

  it('cor sem foto de referência → 409 { error: "sem_referencia", cores: [...] }', async () => {
    // Costas existe, frente não: o gerador só usa a frente.
    f.vigencia.referencias = { Rosa: { frente: SEM, costas: ref('refRc'), lateral: SEM }, Azul: { frente: SEM, costas: SEM, lateral: SEM } }
    expect(await chamar(pedido())).toEqual({ status: 409, body: { error: 'sem_referencia', cores: ['Rosa', 'Azul'] } })
    semCusto()
  })

  it('plano falhou → 502 { error: "plano_ia_falhou" } e nenhum pedido reservado', async () => {
    f.planejar.mockResolvedValueOnce({ erro: 'plano_ia_falhou' })
    expect(await chamar(pedido())).toEqual({ status: 502, body: { error: 'plano_ia_falhou' } })
    f.planejar.mockResolvedValueOnce({ erro: 'plano_invalido', erros: ['posicoes'] })
    expect(await chamar(pedido())).toEqual({ status: 502, body: { error: 'plano_invalido' } })
    semPedido()
    expect(db.galeria_roteiros).toEqual([])
  })

  it('ficha do ML ou categoria ilegível → 503, sem IA nem pedido', async () => {
    fichaML = { status: 500 }
    expect(await chamar(pedido())).toEqual({ status: 503, body: { error: 'ml_indisponivel' } })
    fichaML = { attributes: [] }
    categoria = null
    expect(await chamar(pedido())).toEqual({ status: 503, body: { error: 'categoria_indisponivel' } })
    semCusto()
  })

  it('posição indisponível pedida → 422 { error: "posicao_indisponivel", missoes: [5] }', async () => {
    f.planejar.mockImplementationOnce(async (q: { dados: Parameters<typeof hashDados>[0] }) => ({ plano: planoDe(hashDados(q.dados), [5]) }))
    expect(await chamar(pedido({ missoes: [1, 4, 5] }))).toEqual({ status: 422, body: { error: 'posicao_indisponivel', missoes: [5] } })
    semPedido()
    // O plano fica (vale para as outras posições): o próximo pedido sem a 5 reaproveita.
    expect((await chamar(pedido({ missoes: [1, 4] }))).status).toBe(200)
    expect(f.planejar).toHaveBeenCalledTimes(1)
  })

  describe('plano desatualizado', () => {
    beforeEach(async () => {
      await chamar(pedido({ pedido_id: '7f1c2a3e-8b4d-4c5e-9f60-718293a4b5c6', missoes: [1] }))
      db.galeria_imagens.forEach((i) => { Object.assign(i, { status: 'gerada', entregue_em: '2026-11-10T10:00:00Z' }) })
      fake.rpcs.length = 0
      f.batch.mockClear()
      f.vigencia.fatos_hash = 'h2' // planilha ou foto mudou
    })

    it('sem confirmar_troca → 409 { error: "plano_desatualizado", imagens: N } e nenhum pedido reservado', async () => {
      expect(await chamar(pedido())).toEqual({ status: 409, body: { error: 'plano_desatualizado', imagens: 2 } })
      expect(f.planejar).toHaveBeenCalledTimes(1) // só o do beforeEach
      semPedido()
    })

    it('confirmar_troca só é repassado como true quando o corpo traz exatamente true', async () => {
      for (const v of ['true', 1, 'sim', {}]) {
        expect((await chamar(pedido({ confirmar_troca: v }))).body).toEqual({ error: 'plano_desatualizado', imagens: 2 })
      }
      expect(f.planejar).toHaveBeenCalledTimes(1)
      const r = await chamar(pedido({ confirmar_troca: true }))
      expect(r.status).toBe(200)
      expect(f.planejar).toHaveBeenCalledTimes(2)
      expect(aprovado()).toMatchObject({ fatos_hash: 'h2', versao: 2 })
      expect(reserva().roteiro_id).toBe(aprovado().id)
    })
  })

  it('repetição do mesmo pedido_id devolve as linhas existentes sem chamar a IA', async () => {
    await chamar(pedido())
    const reservas = fake.rpcs.filter((x) => x.nome === 'galeria_reservar_pedido').length
    f.batch.mockClear()
    f.planejar.mockClear()
    fake.respostasRpc.platform_resolve_terms = () => ({ id: 'termos2', image_unit_cents: 99 })
    f.vigencia.fatos_hash = 'h2' // nem a vigência mudada é conferida de novo
    const r = await chamar(pedido({ unit_cents_exibido: 99 }))
    expect(r.status).toBe(200)
    expect((r.body.imagens as Linha[])).toHaveLength(4)
    expect(fake.rpcs.filter((x) => x.nome === 'galeria_reservar_pedido')).toHaveLength(reservas)
    expect(f.planejar).not.toHaveBeenCalled()
    expect(f.batch).not.toHaveBeenCalled()
  })

  it.each(['em_andamento', 'teto'])('corrida: a RPC recusa %s → 409', async (motivo) => {
    fake.respostasRpc.galeria_reservar_pedido = () => { throw { message: motivo, code: 'P0001' } }
    expect(await chamar(pedido())).toEqual({ status: 409, body: { error: motivo } })
  })

  it('roteiro_versao no corpo é ignorado', async () => {
    expect((await chamar(pedido({ roteiro_versao: 99 }))).status).toBe(200)
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
})
