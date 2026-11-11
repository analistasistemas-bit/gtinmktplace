import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as jpeg from 'jpeg-js'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as { admin: unknown }, org: 'org',
  refAtual: { id: 'refR', path: 'p', sha256: 'shaR' } as { id: string; path: string; sha256: string } | { erro: string },
  preparar: vi.fn(),
  /** null = a trava real (MISSOES_LUPA_PENDENTE); {geral:[],moda:[]} = ramo liberado depois do portão (Task 16). */
  travas: null as null | { geral: number[]; moda: number[] },
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: f.org, isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
// Referência atual = a mesma função que o galeria-gerar usou (calcularVigencia → prepararReferencia); aqui controlada.
vi.mock('../../_shared/galeria/referencias.ts', async () => {
  const { createHash: h } = await import('node:crypto')
  return {
    sha256Hex: (b: Uint8Array) => h('sha256').update(b).digest('hex'),
    carregarFotosAplicadas: vi.fn(async () => new Set<string>()),
    prepararReferencia: f.preparar,
  }
})

vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => { throw new Error('nunca chama IA') } }))
vi.mock('../../_shared/galeria/regras.ts', async (orig) => {
  const r = await orig<typeof import('../../_shared/galeria/regras.ts')>()
  return { ...r, lupaPendente: (m: number, moda: boolean) => r.lupaPendente(m, moda, f.travas ?? r.MISSOES_LUPA_PENDENTE) }
})
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
  cor: 'Rosa', missao: 1, geracao: 1, origem: 'gerador', status: 'gerada', cena_path: `c/${n}.png`,
  alertas: [], referencia_id: 'refR', final_upload_path: null, final_path: null, final_sha256: null,
  // Gerador já exibida (cobrada) por padrão; recorte nunca é cobrado.
  entregue_em: extra.origem === 'recorte' ? null : '2026-11-10T10:00:00Z',
  aprovado_em: null, aprovado_por: null, ...extra,
})
const FINAL_REAL = new Uint8Array(readFileSync('supabase/functions/_shared/galeria/__tests__/fixtures/final-real.jpg'))
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const branco = () => {
  const data = new Uint8Array(1200 * 1540 * 4).fill(255)
  return new Uint8Array(jpeg.encode({ width: 1200, height: 1540, data }, 90).data)
}

const lupaOk = (extra: Linha = {}) => ({
  estado: 'ok', versao: VERSAO_LEITURA, tentado_em: '2026-11-11T10:00:00Z', produto: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
  detalhes: [{ x: 0.15, y: 0.15, w: 0.1, h: 0.1 }, { x: 0.7, y: 0.7, w: 0.1, h: 0.1 }], ref_w: 1200, ref_h: 1500, hash: 'hashR', ...extra,
})

beforeEach(() => {
  f.org = 'org'
  f.travas = null
  f.refAtual = { id: 'refR', path: 'org/galeria-ia/famB/referencias/rosa-frente-shaR.jpg', sha256: 'shaR' }
  f.preparar.mockReset()
  f.preparar.mockImplementation(async () => f.refAtual)
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
      { id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', variacoes: [{ codigo: '100R', cor: 'Rosa' }, { codigo: '100A', cor: 'Azul' }] },
      { id: 'famZ', org_id: 'org2', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', variacoes: [{ codigo: '100R', cor: 'Rosa' }] },
    ],
    galeria_roteiros: [{ id: 'rot2', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', versao: 2, status: 'aprovado', moda: false }],
    galeria_referencias: [{ id: 'refR', org_id: 'org', anuncio_externo_id: 'an1', cor: 'Rosa', vista: 'frente', sha256: 'shaR', path: 'x' }],
    galeria_imagens: [],
  }
  fake = fakeAdmin(db)
  f.fake = fake
  // Espelho de galeria_aprovar_imagem (migration 20261110214652) — o SQL real é provado em supabase/tests.
  fake.respostasRpc.galeria_aprovar_imagem = ({ p_org, p_anuncio, p_imagem, p_upload_path, p_sha256, p_usuario }) => {
    const i = db.galeria_imagens.find((g) => g.id === p_imagem && g.org_id === p_org && g.anuncio_externo_id === p_anuncio)
    if (!i) return 'nao_encontrada'
    if (i.status === 'aprovada') return i.final_path === p_upload_path && i.final_sha256 === p_sha256 ? 'ok' : 'nao_aprovavel'
    if (i.status === 'desatualizada') return 'desatualizada'
    if (i.status !== 'gerada') return 'nao_aprovavel'
    if (i.final_upload_path !== p_upload_path) return 'upload_trocado'
    if (i.origem === 'gerador' && i.alertas == null) return 'verificacao_pendente'
    if (i.origem === 'gerador' && i.entregue_em == null) return 'exibicao_pendente'
    for (const g of db.galeria_imagens) {
      if (g.org_id === p_org && g.roteiro_id === i.roteiro_id && g.cor === i.cor && g.missao === i.missao && g.status === 'aprovada' && g.id !== i.id) g.status = 'gerada'
    }
    Object.assign(i, { status: 'aprovada', final_path: p_upload_path, final_sha256: p_sha256, aprovado_em: '2026-11-10T12:00:00Z', aprovado_por: p_usuario })
    return 'ok'
  }
})

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-aprovar', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const preparar = (id: string, ml = 'MLB1') => chamar({ acao: 'preparar_upload', ml_item_id: ml, imagem_id: id })
const aprovar = (id: string, ml = 'MLB1', extra: Linha = {}) => chamar({ acao: 'aprovar', ml_item_id: ml, imagem_id: id, ...extra })
/** O navegador sobe pela URL assinada (upsert:false): mesmo caminho duas vezes → recusado. */
const subir = (path: string, bytes: Uint8Array) =>
  (fake.admin.storage.from('imagens') as unknown as { upload: (p: string, b: Blob, o: { upsert: boolean }) => Promise<{ error: unknown }> })
    .upload(path, new Blob([bytes as Uint8Array<ArrayBuffer>]), { upsert: false })
const linha = (n: number) => db.galeria_imagens.find((g) => g.id === U(n))!

async function prepararESubir(n: number, bytes = FINAL_REAL, ml = 'MLB1') {
  const r = await preparar(U(n), ml)
  expect(r.status).toBe(200)
  await subir(r.body.path as string, bytes)
  return r.body.path as string
}

describe('galeria-aprovar — preparar_upload', () => {
  it('caminho novo a cada chamada, gravado em final_upload_path, URL assinada com upsert:false', async () => {
    db.galeria_imagens.push(img(1))
    const a = await preparar(U(1)); const b = await preparar(U(1))
    expect(a.status).toBe(200)
    expect(a.body.path).toMatch(new RegExp(`^org/galeria-ia/famB/finais/${U(1)}-[0-9a-f-]{36}\\.jpg$`))
    expect(b.body.path).not.toBe(a.body.path)
    expect(a.body).toMatchObject({ token: 't' })
    expect(linha(1).final_upload_path).toBe(b.body.path)
    expect(fake.uploadsAssinados.every((u) => u.upsert === false)).toBe(true)
  })

  it('recusa imagem aprovada, desatualizada ou não produzida, sem gravar', async () => {
    db.galeria_imagens.push(img(1, { status: 'aprovada' }), img(2, { status: 'desatualizada' }), img(3, { status: 'gerando' }))
    expect(await preparar(U(1))).toMatchObject({ status: 409, body: { error: 'ja_aprovada' } })
    expect(await preparar(U(2))).toMatchObject({ status: 409, body: { error: 'desatualizada' } })
    expect(await preparar(U(3))).toMatchObject({ status: 409, body: { error: 'nao_aprovavel' } })
    expect(fake.uploadsAssinados).toEqual([])
    expect(db.galeria_imagens.every((g) => g.final_upload_path === null)).toBe(true)
  })

  it('split: imagem de outra partição pelo MLB desta linha, ou de outra org → 404 sem gravar', async () => {
    db.galeria_imagens.push(img(1, { anuncio_externo_id: 'an2' }), img(2, { org_id: 'org2', anuncio_externo_id: 'an9' }))
    expect((await preparar(U(1), 'MLB1')).status).toBe(404)
    expect((await preparar(U(2), 'MLB1')).status).toBe(404)
    // A própria linha (MLB2) alcança a imagem dela.
    expect((await preparar(U(1), 'MLB2')).status).toBe(200)
    expect(linha(2).final_upload_path).toBeNull()
  })
})

describe('galeria-aprovar — aprovar', () => {
  it('arquivo válido → aprovada com final_path, final_sha256, aprovado_em e aprovado_por', async () => {
    db.galeria_imagens.push(img(1))
    const path = await prepararESubir(1)
    const r = await aprovar(U(1))
    expect(r).toMatchObject({ status: 200, body: { status: 'aprovada' } })
    expect(linha(1)).toMatchObject({ status: 'aprovada', final_path: path, final_sha256: sha(FINAL_REAL), aprovado_por: 'u1' })
    expect(linha(1).aprovado_em).not.toBeNull()
    expect(fake.rpcs.find((x) => x.nome === 'galeria_aprovar_imagem')!.args).toMatchObject({ p_org: 'org', p_anuncio: 'an1', p_upload_path: path })
  })

  it.each([
    ['PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'formato'],
    ['branco 1200×1540', branco(), 'branca'],
  ])('%s → 422 e a imagem não vira aprovada', async (_n, bytes, erro) => {
    db.galeria_imagens.push(img(1))
    await prepararESubir(1, bytes as Uint8Array)
    const r = await aprovar(U(1))
    expect(r).toMatchObject({ status: 422, body: { error: 'arquivo_invalido', erros: [erro] } })
    expect(linha(1).status).toBe('gerada')
    expect(fake.rpcs.map((x) => x.nome)).not.toContain('galeria_aprovar_imagem')
  })

  it('sem preparar ou sem arquivo subido → recusa', async () => {
    db.galeria_imagens.push(img(1), img(2))
    expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'sem_upload' } })
    await preparar(U(2))
    expect(await aprovar(U(2))).toMatchObject({ status: 409, body: { error: 'sem_arquivo' } })
  })

  it('desatualizada → recusa', async () => {
    db.galeria_imagens.push(img(1, { status: 'desatualizada', final_upload_path: 'org/galeria-ia/famB/finais/x.jpg' }))
    expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'desatualizada' } })
    expect(linha(1).status).toBe('desatualizada')
  })

  it('referência trocada (sha da atual ≠ da imagem) → recusa', async () => {
    db.galeria_imagens.push(img(1))
    await prepararESubir(1)
    f.refAtual = { id: 'refN', path: 'n', sha256: 'shaNovo' }
    expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'referencia_trocada' } })
    expect(linha(1).status).toBe('gerada')
    // Consultou a referência da cor e vista da missão (frente na capa).
    expect(f.preparar.mock.calls[0].slice(1, 5)).toEqual(['org', 'an1', 'Rosa', 'frente'])
  })

  it('referência sumiu → recusa', async () => {
    db.galeria_imagens.push(img(1))
    await prepararESubir(1)
    f.refAtual = { erro: 'sem_referencia' }
    expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'referencia_trocada' } })
  })

  it('gerador com alertas nulo → verificacao_pendente', async () => {
    db.galeria_imagens.push(img(1, { alertas: null }))
    await prepararESubir(1)
    expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'verificacao_pendente' } })
  })

  // Revisão geral (bloqueador 1): aprovar sem cobrança. Recusa antes de baixar o arquivo; o espelho da RPC também recusa.
  it('gerador ainda não exibida (sem entregue_em) → 409 exibicao_pendente, sem RPC nem gravar', async () => {
    db.galeria_imagens.push(img(1, { entregue_em: null }))
    await prepararESubir(1)
    expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'exibicao_pendente' } })
    expect(fake.rpcs.map((x) => x.nome)).not.toContain('galeria_aprovar_imagem')
    expect(linha(1)).toMatchObject({ status: 'gerada', final_path: null })
  })

  it('módulo imagem_ia desligado → 403 modulo_desligado, sem ler nem gravar', async () => {
    db.organizations[0].modulos_habilitados = []
    db.galeria_imagens.push(img(1))
    expect(await preparar(U(1))).toMatchObject({ status: 403, body: { error: 'modulo_desligado' } })
    expect(await aprovar(U(1))).toMatchObject({ status: 403, body: { error: 'modulo_desligado' } })
    expect(linha(1)).toMatchObject({ status: 'gerada', final_upload_path: null })
  })

  // Fix round 1: lupa é recorte cego da referência; até a decisão do Diego, a edge recusa (a tela só esconde).
  it.each([
    ['missão 3 (lupa)', { missao: 3 }, false],
    ['missão 7 (recorte)', { missao: 7, origem: 'recorte', cena_path: null }, false],
    ['Moda 5 (recorte)', { missao: 5, origem: 'recorte', cena_path: null }, true],
    ['Moda 7 (recorte)', { missao: 7, origem: 'recorte', cena_path: null }, true],
  ])('%s → 409 lupa_pendente, sem RPC', async (_n, extra, moda) => {
    db.galeria_roteiros[0].moda = moda
    db.galeria_imagens.push(img(1, extra as Linha))
    await prepararESubir(1)
    expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'lupa_pendente' } })
    expect(fake.rpcs.map((x) => x.nome)).not.toContain('galeria_aprovar_imagem')
    expect(linha(1).status).toBe('gerada')
  })

  describe('ramo liberado (MISSOES_LUPA_PENDENTE esvaziada no teste): lupa pela caixa do produto', () => {
    const casos = [
      ['missão 3 (lupa)', { missao: 3 }, false],
      ['missão 7 (recorte)', { missao: 7, origem: 'recorte', cena_path: null }, false],
      ['Moda 5 (recorte)', { missao: 5, origem: 'recorte', cena_path: null }, true],
      ['Moda 7 (recorte)', { missao: 7, origem: 'recorte', cena_path: null }, true],
    ] as const
    const preparo = async (extra: Linha, moda: boolean, detalhes: unknown) => {
      f.travas = { geral: [], moda: [] }
      db.galeria_roteiros[0].moda = moda
      db.galeria_referencias[0].detalhes = detalhes
      db.galeria_imagens.push(img(1, extra))
      await prepararESubir(1)
    }
    const semRpc = () => {
      expect(fake.rpcs.map((x) => x.nome)).not.toContain('galeria_aprovar_imagem')
      expect(linha(1).status).toBe('gerada')
    }

    it.each(casos)('%s: sem lupa_hash (bundle antigo) → 409 lupa_desatualizada', async (_n, extra, moda) => {
      await preparo(extra as Linha, moda, lupaOk())
      expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'lupa_desatualizada' } })
      semRpc()
    })

    it.each(casos)('%s: lupa_hash divergente → 409 lupa_desatualizada', async (_n, extra, moda) => {
      await preparo(extra as Linha, moda, lupaOk())
      expect(await aprovar(U(1), 'MLB1', { lupa_hash: 'outro' })).toMatchObject({ status: 409, body: { error: 'lupa_desatualizada' } })
      semRpc()
    })

    it.each([
      ['detalhes nulo', null], ['falhou', { estado: 'falhou', versao: VERSAO_LEITURA, tentado_em: 't' }],
      ['sem_detalhe', { estado: 'sem_detalhe', versao: VERSAO_LEITURA, tentado_em: 't' }],
      ['não cabe (um só detalhe na missão 7)', lupaOk({ detalhes: [{ x: 0.15, y: 0.15, w: 0.1, h: 0.1 }] })],
    ])('%s → 409 lupa_indisponivel', async (_n, d) => {
      await preparo({ missao: 7, origem: 'recorte', cena_path: null }, false, d)
      expect(await aprovar(U(1), 'MLB1', { lupa_hash: 'hashR' })).toMatchObject({ status: 409, body: { error: 'lupa_indisponivel' } })
      semRpc()
    })

    it.each(casos)('%s: hash certo + lupa_ok → aprova', async (_n, extra, moda) => {
      await preparo(extra as Linha, moda, lupaOk())
      expect(await aprovar(U(1), 'MLB1', { lupa_hash: 'hashR' })).toEqual({ status: 200, body: { status: 'aprovada' } })
      expect(linha(1).status).toBe('aprovada')
    })

    it('missão sem lupa não exige lupa_hash', async () => {
      await preparo({ missao: 2 }, false, null)
      expect((await aprovar(U(1))).status).toBe(200)
    })
  })

  it('Moda 3 (cena de costas, sem lupa) não é barrada', async () => {
    db.galeria_roteiros[0].moda = true
    db.galeria_imagens.push(img(1, { missao: 3 }))
    await prepararESubir(1)
    f.refAtual = { id: 'refR', path: 'x', sha256: 'shaR' }
    expect((await aprovar(U(1))).status).toBe(200)
  })

  it('aprovação simultânea (índice único) → 409 aprovacao_concorrente', async () => {
    db.galeria_imagens.push(img(1))
    await prepararESubir(1)
    fake.respostasRpc.galeria_aprovar_imagem = () => 'aprovacao_concorrente'
    expect(await aprovar(U(1))).toMatchObject({ status: 409, body: { error: 'aprovacao_concorrente' } })
  })

  it('verificacao_indisponivel não bloqueia', async () => {
    db.galeria_imagens.push(img(1, { alertas: [{ tipo: 'verificacao_indisponivel', nota: 'x' }] }))
    await prepararESubir(1)
    expect((await aprovar(U(1))).status).toBe(200)
  })

  it('geração 2 da missão 1 com a 1 aprovada → só a 2 fica aprovada (uma capa)', async () => {
    db.galeria_imagens.push(img(1), img(2, { geracao: 2 }))
    await prepararESubir(1); await aprovar(U(1))
    await prepararESubir(2); expect((await aprovar(U(2))).status).toBe(200)
    expect(linha(1).status).toBe('gerada')
    expect(db.galeria_imagens.filter((g) => g.missao === 1 && g.status === 'aprovada').map((g) => g.id)).toEqual([U(2)])
  })

  // Prova só a lógica do servidor: aprovar lê o caminho do preparo atual e um preparo novo é recusado depois.
  // Que o Storage real recusa um 2º PUT na URL assinada do caminho aprovado é conferido na Task 16 (procedimento de
  // CORS/Storage), e a Task 14 reconfere o sha dos bytes ao aplicar.
  it('depois da aprovação: preparo novo recusado, repetição idempotente e final_path/final_sha256 inalterados', async () => {
    db.galeria_imagens.push(img(1))
    const antiga = (await preparar(U(1))).body.path as string
    const path = await prepararESubir(1)
    await aprovar(U(1))
    const antes = { final_path: linha(1).final_path, final_sha256: linha(1).final_sha256 }
    // URL do caminho aprovado: upsert:false → recusada. URL de um preparo anterior: cai em caminho próprio.
    expect((await subir(path, branco())).error).not.toBeNull()
    expect((await subir(antiga, branco())).error).toBeNull()
    expect(fake.arquivos.get(path)).toEqual(FINAL_REAL)
    expect(await preparar(U(1))).toMatchObject({ status: 409, body: { error: 'ja_aprovada' } })
    expect((await aprovar(U(1))).status).toBe(200) // repetição idempotente
    expect({ final_path: linha(1).final_path, final_sha256: linha(1).final_sha256 }).toEqual(antes)
  })

  it('split: aprovar leva o ml_item_id da própria linha; outra partição ou org → 404', async () => {
    db.galeria_imagens.push(img(1, { anuncio_externo_id: 'an2' }))
    await prepararESubir(1, FINAL_REAL, 'MLB2')
    expect((await aprovar(U(1), 'MLB1')).status).toBe(404)
    f.org = 'org2'
    expect((await aprovar(U(1), 'MLB9')).status).toBe(404)
    f.org = 'org'
    expect((await aprovar(U(1), 'MLB2')).status).toBe(200)
    expect(fake.rpcs.find((x) => x.nome === 'galeria_aprovar_imagem')!.args).toMatchObject({ p_anuncio: 'an2' })
  })

  it('pedido inválido → 400; MLB de outra org → 409', async () => {
    expect((await chamar({ acao: 'x', ml_item_id: 'MLB1', imagem_id: U(1) })).status).toBe(400)
    expect((await chamar({ acao: 'aprovar', ml_item_id: 'MLB1', imagem_id: 'x' })).status).toBe(400)
    expect((await aprovar(U(1), 'MLB9')).status).toBe(409)
  })
})
