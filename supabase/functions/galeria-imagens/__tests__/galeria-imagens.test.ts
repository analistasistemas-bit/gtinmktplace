import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({ serve: vi.fn(), fake: null as unknown as { admin: unknown }, org: 'org' }))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: f.org, isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))

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
    organizations: [{ id: 'org' }, { id: 'org2' }],
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
      { id: 'rot2', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', versao: 2, status: 'aprovado' },
    ],
    galeria_referencias: [{ id: 'refR', org_id: 'org', anuncio_externo_id: 'an1', path: 'org/galeria-ia/famB/referencias/rosa.jpg' }],
    galeria_imagens: [],
    platform_image_deliveries: [],
  }
  fake = fakeAdmin(db)
  f.fake = fake
  fake.respostasRpc.platform_resolve_terms = () => ({ id: 'termos1', image_unit_cents: 50 })
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
  it('devolve imagens do roteiro da família vigente com URL assinada e o preço do mês, sem gravar nada', async () => {
    db.galeria_imagens.push(
      img(1),
      img(2, { roteiro_id: 'rotA2', familia_id: 'famA' }), // mesma versão, família anterior: fora da lista
      img(3, { missao: 7, origem: 'recorte', cena_path: null, custo_usd: null }),
    )
    const r = await chamar({ acao: 'listar', ml_item_id: 'MLB1', roteiro_versao: 2 })
    expect(r.status).toBe(200)
    expect(r.body.unit_cents).toBe(50)
    const imgs = r.body.imagens as Linha[]
    expect(imgs.map((i) => i.id)).toEqual([U(1), U(3)])
    expect(imgs[0]).toMatchObject({ url: `https://signed/org/galeria-ia/famB/cenas/1.png`, exibida: false, origem: 'gerador' })
    expect(imgs[1]).toMatchObject({ url: 'https://signed/org/galeria-ia/famB/referencias/rosa.jpg', origem: 'recorte' })
    expect(fake.escritas).toEqual([])
    expect(fake.rpcs.map((x) => x.nome)).not.toContain('galeria_confirmar_exibicao')
    expect(db.galeria_imagens.every((i) => i.entregue_em === null)).toBe(true)
  })

  it('sem condição comercial → preço 0 (mesma regra do galeria-gerar)', async () => {
    fake.respostasRpc.platform_resolve_terms = () => null
    const r = await chamar({ acao: 'listar', ml_item_id: 'MLB1', roteiro_versao: 2 })
    expect(r.body.unit_cents).toBe(0)
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
    const r = await chamar({ acao: 'listar', ml_item_id: 'MLB1', roteiro_versao: 2 })
    const pode = Object.fromEntries((r.body.imagens as Linha[]).map((i) => [i.id, i.pode_gerar_de_novo]))
    expect(pode).toMatchObject({ [U(1)]: false, [U(3)]: false, [U(4)]: true, [U(6)]: true, [U(7)]: false })
  })

  it('versão sem roteiro na família vigente → lista vazia', async () => {
    const r = await chamar({ acao: 'listar', ml_item_id: 'MLB1', roteiro_versao: 9 })
    expect(r).toMatchObject({ status: 200, body: { imagens: [], unit_cents: 50 } })
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
})
