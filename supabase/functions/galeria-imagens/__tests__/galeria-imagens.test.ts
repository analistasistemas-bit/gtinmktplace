import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({ serve: vi.fn(), fake: null as unknown as { admin: unknown }, org: 'org' }))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: f.org, isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => { throw new Error('nunca chama IA') } }))
const { VERSAO_LEITURA } = await import('../../_shared/galeria/detalhes.ts')

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const img = (n: number, extra: Linha = {}): Linha => ({
  id: U(n), org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', roteiro_id: 'rot2', pedido_id: 'p1',
  cor: 'Rosa', missao: 1, geracao: 1, origem: 'gerador', status: 'gerada', cena_path: `org/galeria-ia/famB/cenas/${n}.png`,
  custo_usd: 0.04, alertas: [], erro: null, entregue_em: null, referencia_id: 'refR', ...extra,
})

beforeEach(() => {
  f.org = 'org'
  db = {
    organizations: [{ id: 'org', modulos_habilitados: ['imagem_ia'] }, { id: 'org2', modulos_habilitados: ['imagem_ia'] }],
    anuncios_externos: [
      { id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1', variacoes_externas: { '100R': {} } },
      // Split: outra partição do mesmo produto (mesma família).
      { id: 'an2', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB2', variacoes_externas: { '100A': {} } },
      { id: 'an9', org_id: 'org2', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB9', variacoes_externas: { '100R': {} } },
    ],
    anuncios_externos_itens: [],
    familias: [
      { id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z', variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }] },
      { id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }] },
    ],
    galeria_roteiros: [
      // Versão 2 existe nas duas famílias do mesmo anúncio: `listar` usa a da família vigente.
      { id: 'rotA2', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famA', versao: 2, status: 'desatualizado' },
      { id: 'rot2', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', versao: 2, status: 'aprovado', moda: false,
        conteudo: { missoes: [1, 2, 3, 4, 7].map((missao) => ({ missao, ativa: missao !== 4 })) } },
    ],
    galeria_referencias: [{ id: 'refR', org_id: 'org', anuncio_externo_id: 'an1', path: 'org/galeria-ia/famB/referencias/rosa.jpg' }],
    galeria_imagens: [],
    galeria_pedidos: [{ id: 'p1', org_id: 'org', anuncio_externo_id: 'an1', unit_cents: 50 }],
    platform_image_deliveries: [],
  }
  fake = fakeAdmin(db)
  f.fake = fake
  // Mês a 80, pedido congelado a 50: a imagem mostra 50, a confirmação de pedido novo 80.
  fake.respostasRpc.platform_resolve_terms = () => ({ id: 'termos1', image_unit_cents: 80 })
  // Espelho de galeria_confirmar_exibicao (migration 20261109093335) — mesmo WHERE, linha a linha.
  fake.respostasRpc.galeria_confirmar_exibicao = ({ p_org, p_anuncio, p_ids }) => {
    let n = 0
    for (const g of db.galeria_imagens) {
      if (g.org_id === p_org && g.anuncio_externo_id === p_anuncio && (p_ids as string[]).includes(g.id as string)
        && g.origem === 'gerador' && ['gerada', 'aprovada', 'descartada', 'desatualizada'].includes(g.status as string)
        && g.cena_path != null && g.custo_usd != null && g.entregue_em == null) {
        g.entregue_em = '2026-11-10T12:00:00Z'
        db.platform_image_deliveries.push({ org_id: g.org_id, request_id: g.id, origem: 'galeria' })
        n++
      }
    }
    return n
  }
})

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-imagens', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const confirmar = (ids: string[], ml = 'MLB1') => chamar({ acao: 'confirmar_exibicao', ml_item_id: ml, imagem_ids: ids })

describe('galeria-imagens — listar', () => {
  const listar = (ml = 'MLB1') => chamar({ acao: 'listar', ml_item_id: ml })

  it('roteiro aprovado do anúncio + imagens com URL assinada, preço do pedido e preço do mês, sem gravar nada', async () => {
    db.galeria_imagens.push(
      img(1),
      img(3, { missao: 7, origem: 'recorte', cena_path: null, custo_usd: null }),
      img(4, { anuncio_externo_id: 'an2' }), // outra partição: fora
    )
    const r = await listar()
    expect(r.status).toBe(200)
    expect(r.body.unit_cents).toBe(80) // mês: só para pedido novo
    expect(r.body.roteiro).toMatchObject({ id: 'rot2', versao: 2, familia_id: 'famB', moda: false, missoes_ativas: [1, 2, 3, 7] })
    const imgs = r.body.imagens as Linha[]
    expect(imgs.map((i) => i.id)).toEqual([U(1), U(3)])
    expect(imgs[0]).toMatchObject({ url: 'https://signed/org/galeria-ia/famB/cenas/1.png', exibida: false, origem: 'gerador', unit_cents: 50 })
    expect(imgs[1]).toMatchObject({ url: 'https://signed/org/galeria-ia/famB/referencias/rosa.jpg', origem: 'recorte' })
    expect(fake.escritas).toEqual([])
    expect(fake.rpcs.map((x) => x.nome)).not.toContain('galeria_confirmar_exibicao')
    expect(db.galeria_imagens.every((i) => i.entregue_em === null)).toBe(true)
  })

  it('Task 12: cada imagem traz a URL da referência (lupa) e o roteiro traz os textos das missões', async () => {
    db.galeria_roteiros[1].conteudo = { missoes: [
      { missao: 2, ativa: true, headline: 'Prende firme', subheadline: 'Sem costura', cena: 'x', fatosUsados: [] },
      { missao: 4, ativa: false, headline: 'Inativa', beneficios: ['a'], cena: 'x', fatosUsados: [] },
    ] }
    db.galeria_imagens.push(img(1, { missao: 2 }))
    const r = await listar()
    expect((r.body.imagens as Linha[])[0]).toMatchObject({ ref_url: 'https://signed/org/galeria-ia/famB/referencias/rosa.jpg', roteiro_id: 'rot2' })
    expect((r.body.roteiro as Linha).textos).toEqual({ 2: { headline: 'Prende firme', subheadline: 'Sem costura' } })
  })

  it('lupa pela caixa do produto: missão com lupa traz caixas, dimensões, hash e situação; sem lupa → null; nunca chama visão', async () => {
    const d = {
      estado: 'ok', versao: VERSAO_LEITURA, tentado_em: 't', produto: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      detalhes: [{ x: 0.15, y: 0.15, w: 0.1, h: 0.1 }], ref_w: 1200, ref_h: 1500, hash: 'hashR',
    }
    db.galeria_referencias[0].detalhes = d
    db.galeria_imagens.push(img(1, { missao: 3 }), img(2, { missao: 7, origem: 'recorte', cena_path: null }), img(3, { missao: 2 }))
    const imgs = (await listar()).body.imagens as Linha[]
    expect(imgs.find((i) => i.id === U(1))!.lupa).toEqual({
      situacao: 'ok', produto: d.produto, detalhes: d.detalhes, ref_w: 1200, ref_h: 1500, hash: 'hashR',
    })
    // Missão 7 com um só detalhe: não cabe → indisponível (a tela não compõe).
    expect(imgs.find((i) => i.id === U(2))!.lupa).toMatchObject({ situacao: 'indisponivel' })
    expect(imgs.find((i) => i.id === U(3))!.lupa).toBeNull()
    db.galeria_referencias[0].detalhes = null
    expect(((await listar()).body.imagens as Linha[]).find((i) => i.id === U(1))!.lupa).toEqual({ situacao: 'lendo' })
  })

  it('histórico: cenas da família A (B publicada depois) não exibidas aparecem e cobram 1', async () => {
    db.galeria_imagens.push(
      img(1, { familia_id: 'famA', roteiro_id: 'rotA2' }),
      img(2, { familia_id: 'famA', roteiro_id: 'rotA2', entregue_em: '2026-11-09T10:00:00Z' }), // já cobrada: fora
      img(5, { familia_id: 'famA', roteiro_id: 'rotA2', status: 'falhou' }), // falhou: fora
    )
    const imgs = (await listar()).body.imagens as Linha[]
    expect(imgs.map((i) => i.id)).toEqual([U(1)])
    expect(imgs[0].pode_gerar_de_novo).toBe(false) // gerar novo só pelo roteiro aprovado
    expect((await confirmar([U(1)])).body).toEqual({ cobradas: 1 })
  })

  it('v2 aprovado + rascunho v3: o roteiro é o v2 e as imagens do v2 aparecem e cobram', async () => {
    db.galeria_roteiros.push({ id: 'rot3', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', versao: 3, status: 'rascunho', moda: false, conteudo: { missoes: [] } })
    db.galeria_imagens.push(img(1))
    const r = await listar()
    expect((r.body.roteiro as Linha).id).toBe('rot2')
    expect((r.body.imagens as Linha[]).map((i) => i.id)).toEqual([U(1)])
    expect((await confirmar([U(1)])).body).toEqual({ cobradas: 1 })
  })

  it('sem roteiro aprovado nem imagem pendente → roteiro null e lista vazia', async () => {
    db.galeria_roteiros = db.galeria_roteiros.filter((x) => x.status !== 'aprovado')
    fake = fakeAdmin(db); f.fake = fake
    fake.respostasRpc.platform_resolve_terms = () => ({ id: 'termos1', image_unit_cents: 80 })
    expect((await listar()).body).toMatchObject({ roteiro: null, imagens: [], unit_cents: 80 })
  })

  it('sem condição comercial → preço do mês 0 (mesma regra do galeria-gerar)', async () => {
    fake.respostasRpc.platform_resolve_terms = () => null
    expect((await listar()).body.unit_cents).toBe(0)
  })

  it('"Gerar de novo" some com 3 gerações gerador fora de falhou (exibidas ou não) e com geração aberta', async () => {
    db.galeria_imagens.push(
      img(1, { geracao: 1, entregue_em: '2026-11-10T10:00:00Z' }),
      img(2, { geracao: 2, status: 'descartada' }),
      img(3, { geracao: 3 }), // produzida e ainda não exibida: conta
      img(4, { missao: 2, geracao: 1 }),
      img(5, { missao: 2, geracao: 2, status: 'falhou' }),
      img(6, { missao: 2, geracao: 2 }), // missão 2: 2 válidas → ainda pode
      img(7, { missao: 3, geracao: 1 }),
      img(8, { missao: 3, geracao: 2, status: 'gerando', cena_path: null, custo_usd: null }), // aberta → não
    )
    const pode = Object.fromEntries(((await listar()).body.imagens as Linha[]).map((i) => [i.id, i.pode_gerar_de_novo]))
    expect(pode).toMatchObject({ [U(1)]: false, [U(3)]: false, [U(4)]: true, [U(6)]: true, [U(7)]: false })
  })
})

describe('galeria-imagens — confirmar_exibicao (cobrança = exibição)', () => {
  it('chama a RPC com a org do auth e o anúncio resolvido do MLB; 2× cobra uma vez', async () => {
    db.galeria_imagens.push(img(1))
    expect((await confirmar([U(1)])).body).toEqual({ cobradas: 1 })
    expect((await confirmar([U(1)])).body).toEqual({ cobradas: 0 })
    expect(db.platform_image_deliveries).toHaveLength(1)
    expect(fake.rpcs.find((x) => x.nome === 'galeria_confirmar_exibicao')!.args).toEqual({ p_org: 'org', p_anuncio: 'an1', p_ids: [U(1)] })
  })

  it('id de outra partição do mesmo produto ou de outra org → nenhuma cobrança', async () => {
    db.galeria_imagens.push(img(1, { anuncio_externo_id: 'an2' }), img(2, { org_id: 'org2', anuncio_externo_id: 'an9' }))
    expect((await confirmar([U(1), U(2)])).body).toEqual({ cobradas: 0 })
    // A outra org chamando com o próprio MLB também não alcança a imagem desta.
    db.galeria_imagens.push(img(3))
    f.org = 'org2'
    expect((await confirmar([U(3)], 'MLB9')).body).toEqual({ cobradas: 0 })
    expect(db.platform_image_deliveries).toEqual([])
  })

  it('imagem de família anterior do mesmo anúncio → cobra 1 (operação histórica)', async () => {
    db.galeria_imagens.push(img(1, { familia_id: 'famA', roteiro_id: 'rotA2', status: 'desatualizada' }))
    expect((await confirmar([U(1)])).body).toEqual({ cobradas: 1 })
  })

  it('ids inválidos, vazios ou demais → 400 sem RPC', async () => {
    for (const ids of [[], ['x'], Array.from({ length: 101 }, (_, i) => U(i))]) {
      expect((await confirmar(ids as string[])).status).toBe(400)
    }
    expect(fake.rpcs.map((x) => x.nome)).not.toContain('galeria_confirmar_exibicao')
  })

  it('MLB que não é da org → 409 anuncio_ambiguo, sem RPC', async () => {
    expect((await confirmar([U(1)], 'MLB9')).status).toBe(409)
    expect(fake.rpcs.map((x) => x.nome)).not.toContain('galeria_confirmar_exibicao')
  })
})

describe('galeria-imagens — reportar_invalida', () => {
  const reportar = (id: string, ml = 'MLB1') => chamar({ acao: 'reportar_invalida', ml_item_id: ml, imagem_id: id })

  it('imagem branca: gerada → falhou, e a confirmação seguinte não cobra (zero entregas)', async () => {
    db.galeria_imagens.push(img(1))
    expect((await reportar(U(1))).body).toEqual({ reportada: true })
    expect(db.galeria_imagens[0]).toMatchObject({ status: 'falhou', erro: 'imagem_invalida' })
    expect((await confirmar([U(1)])).body).toEqual({ cobradas: 0 })
    expect(db.platform_image_deliveries).toEqual([])
  })

  it('aceita imagem histórica do mesmo anúncio (família anterior) se gerada e não cobrada', async () => {
    db.galeria_imagens.push(img(6, { familia_id: 'famA', roteiro_id: 'rotA2' }))
    expect((await reportar(U(6))).body).toEqual({ reportada: true })
  })

  it('só linha gerada, gerador, não exibida, deste anúncio e desta org', async () => {
    db.galeria_imagens.push(
      img(1, { status: 'aprovada' }),
      img(2, { entregue_em: '2026-11-10T10:00:00Z' }),
      img(3, { origem: 'recorte' }),
      img(4, { anuncio_externo_id: 'an2' }),
      img(5, { org_id: 'org2', anuncio_externo_id: 'an9' }),
    )
    for (let n = 1; n <= 5; n++) expect((await reportar(U(n))).body).toEqual({ reportada: false })
    expect(db.galeria_imagens.every((i) => i.status !== 'falhou')).toBe(true)
  })

  // Revisão geral (bloqueador 2): reportar não devolve a vaga — 3 reportes seguidos esgotam o teto da (cor, missão).
  it('3 reportes seguidos → "Gerar de novo" some (conta no teto) e o erro fica imagem_invalida', async () => {
    for (let g = 1; g <= 3; g++) {
      db.galeria_imagens.push(img(g, { missao: 2, geracao: g }))
      expect((await reportar(U(g))).body).toEqual({ reportada: true })
    }
    expect(db.galeria_imagens.every((i) => i.status === 'falhou' && i.erro === 'imagem_invalida')).toBe(true)
    const imgs = (await chamar({ acao: 'listar', ml_item_id: 'MLB1' })).body.imagens as Linha[]
    expect(imgs.filter((i) => i.missao === 2).map((i) => i.pode_gerar_de_novo)).toEqual([false, false, false])
  })
})

describe('galeria-imagens — módulo imagem_ia', () => {
  it('desligado → 403 modulo_desligado em toda ação, sem ler, cobrar nem gravar', async () => {
    db.organizations[0].modulos_habilitados = []
    db.galeria_imagens.push(img(1))
    for (const body of [{ acao: 'listar', ml_item_id: 'MLB1' }, { acao: 'confirmar_exibicao', ml_item_id: 'MLB1', imagem_ids: [U(1)] },
      { acao: 'reportar_invalida', ml_item_id: 'MLB1', imagem_id: U(1) }]) {
      expect(await chamar(body)).toMatchObject({ status: 403, body: { error: 'modulo_desligado' } })
    }
    expect(fake.rpcs).toEqual([])
    expect(db.galeria_imagens[0]).toMatchObject({ status: 'gerada', entregue_em: null })
  })
})
