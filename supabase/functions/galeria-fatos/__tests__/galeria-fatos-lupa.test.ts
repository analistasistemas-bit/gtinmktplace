// Lupa pela caixa do produto pelo `montar` (plano 2026-11-11, testes 4 e 6; ajuste v3 item 8). Usa o detalhes.ts real
// com a visão mockada; a etiqueta fica mockada (outro arquivo cobre).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({ serve: vi.fn(), create: vi.fn(), fake: null as unknown as { admin: unknown } }))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org', isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: f.create } } }) }))
vi.mock('../../_shared/galeria/etiqueta.ts', () => ({ lerLeituraEtiqueta: vi.fn(async () => ({})), conferirEtiqueta: vi.fn(async () => false) }))

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

/** JPEG mínimo 1200×1500 (só o SOF0): a leitura confere dimensões e EXIF sem decodificar. */
const jpeg = (marca: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x05, 0xdc, 0x04, 0xb0, 3, marca, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xd9])
const BOM = { produto: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, detalhes: [
  { tipo: 'trama', caixa: { x: 0.15, y: 0.15, w: 0.1, h: 0.1 } }, { tipo: 'costura', caixa: { x: 0.7, y: 0.7, w: 0.1, h: 0.1 } }] }
const resposta = (c: unknown) => ({ choices: [{ message: { content: JSON.stringify(c) } }] })
const urls = () => f.create.mock.calls.map((c) => (c[0].messages[1].content[0].image_url.url as string))

beforeEach(() => {
  f.create.mockReset()
  db = {
    anuncios_externos: [{ id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1', variacoes_externas: { '100P': {}, '100R': {} } }],
    anuncios_externos_itens: [], profiles: [{ id: 'u1', org_id: 'org' }],
    familias: [{
      id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', nome_pai: 'Bolsa',
      variacoes: [{ codigo: '100P', cor: 'Preto', imagem_path: 'org/l/00100P.jpg' }, { codigo: '100R', cor: 'Rosa', imagem_path: 'org/l/00100R.jpg' }],
    }],
    galeria_fatos: [], galeria_imagem_itens: [], galeria_roteiros: [], galeria_imagens: [], galeria_aplicacoes: [],
    // Costas já enviada pelo operador: nunca é lida pela visão.
    galeria_referencias: [{ id: 'refPc', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', cor: 'Preto', vista: 'costas',
      path: 'org/galeria-ia/famB/referencias/preto-costas-x.jpg', sha256: 'x', origem: 'upload_operador', criado_em: '2026-11-10T00:00:00Z', detalhes: null }],
  }
  fake = fakeAdmin(db, new Map([
    ['org/l/00100P.jpg', jpeg(1)], ['org/l/00100R.jpg', jpeg(2)], ['org/galeria-ia/famB/referencias/preto-costas-x.jpg', jpeg(3)],
  ]))
  f.fake = fake
  fake.respostasRpc.galeria_gravar_detalhes = ({ p_org, p_referencia, p_detalhes }) => {
    const r = db.galeria_referencias.find((x) => x.id === p_referencia && x.org_id === p_org)
    if (!r) return null
    const a = r.detalhes as Linha | null
    if (!a || a.estado === 'falhou' || a.versao !== (p_detalhes as Linha).versao) r.detalhes = p_detalhes
    return r.detalhes
  }
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
})

const montar = async () => {
  const r = await handler(new Request('http://x/galeria-fatos', { method: 'POST', body: JSON.stringify({ acao: 'montar', ml_item_id: 'MLB1' }) }))
  return { status: r.status, body: await r.json() as Linha }
}

describe('galeria-fatos × lupa', () => {
  it('lê só a referência frente de cada cor e devolve a situação por cor e missão', async () => {
    f.create.mockResolvedValue(resposta(BOM))
    const r = await montar()
    expect(r.status).toBe(200)
    expect(urls().sort()).toEqual([expect.stringMatching(/preto-frente-/), expect.stringMatching(/rosa-frente-/)])
    expect(r.body.lupa).toEqual({
      Preto: { geral: { 3: 'ok', 7: 'ok' }, moda: { 5: 'ok', 7: 'ok' } },
      Rosa: { geral: { 3: 'ok', 7: 'ok' }, moda: { 5: 'ok', 7: 'ok' } },
    })
    expect(db.galeria_referencias.find((x) => x.id === 'refPc')!.detalhes).toBeNull()
  })

  it('fatos_hash igual antes e depois da leitura (falhou → ok não desatualiza o roteiro)', async () => {
    f.create.mockRejectedValue(new Error('provedor fora'))
    const antes = await montar()
    expect((antes.body.lupa as Linha).Preto).toMatchObject({ geral: { 3: 'lendo' } })
    for (const r of db.galeria_referencias) if (r.detalhes) (r.detalhes as Linha).tentado_em = '2026-01-01T00:00:00Z'
    f.create.mockReset(); f.create.mockResolvedValue(resposta(BOM))
    const depois = await montar()
    expect((depois.body.lupa as Linha).Preto).toMatchObject({ geral: { 3: 'ok' } })
    expect(depois.body.fatos_hash).toBe(antes.body.fatos_hash)
  })

  it('perdeu a corrida: devolve a situação relida do banco (a do vencedor), não a da própria leitura', async () => {
    f.create.mockResolvedValue(resposta(BOM))
    fake.respostasRpc.galeria_gravar_detalhes = ({ p_referencia, p_detalhes }) => {
      const r = db.galeria_referencias.find((x) => x.id === p_referencia)!
      r.detalhes = { estado: 'sem_detalhe', versao: (p_detalhes as Linha).versao, tentado_em: 't' } // gravado por outro montar
      return r.detalhes
    }
    const r = await montar()
    expect((r.body.lupa as Linha).Preto).toEqual({ geral: { 3: 'indisponivel', 7: 'indisponivel' }, moda: { 5: 'indisponivel', 7: 'indisponivel' } })
  })

  it('visão quebrada nunca derruba o montar', async () => {
    fake.respostasRpc.galeria_gravar_detalhes = () => { throw { message: 'rpc fora' } }
    f.create.mockResolvedValue(resposta(BOM))
    const r = await montar()
    expect(r.status).toBe(200)
    expect((r.body.lupa as Linha).Rosa).toMatchObject({ geral: { 3: 'lendo' } })
  })
})
