import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as ReturnType<typeof import('../../_shared/galeria/__tests__/fake-admin').fakeAdmin>,
  assinatura: true, objetos: [] as Array<{ id: string; name: string; created_at: string }>,
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {} }))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/queue.ts', () => ({ verificarAssinatura: vi.fn(async () => f.assinatura) }))

let handler: (req: Request) => Promise<Response>
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

const ORG = '11111111-1111-4111-8111-111111111111'
const FAM = '22222222-2222-4222-8222-222222222222'
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const P1 = u(901), P2 = u(902), N1 = u(951), N2 = u(952)
const base = `${ORG}/galeria-ia/${FAM}`
const VELHO = new Date(Date.now() - 3 * 86400_000).toISOString()

// Imagens: gerada com cena publicada e cena órfã da posse perdida; aprovada (final aprovado + preparo antigo);
// aprovada que virou desatualizada; gerada com preparo em curso e preparo antigo; recorte (sem arquivo).
const G = u(1), A = u(2), D = u(3), V = u(4), R = u(5)
const caminhos = {
  cenaCitada: `${base}/rosa/2-1-${G}-${P1}.png`,
  cenaOrfa: `${base}/rosa/2-1-${G}-${P2}.png`,
  finalAprovado: `${base}/finais/${A}-${N1}.jpg`,
  finalAntigoDaAprovada: `${base}/finais/${A}-${N2}.jpg`,
  cenaDaAprovada: `${base}/rosa/1-1-${A}-${P1}.png`,
  cenaOrfaDaAprovada: `${base}/rosa/1-1-${A}-${P2}.png`,
  finalDesatualizada: `${base}/finais/${D}-${N1}.jpg`,
  cenaOrfaDesatualizada: `${base}/rosa/3-1-${D}-${P2}.png`,
  finalUpload: `${base}/finais/${V}-${N1}.jpg`,
  finalNaoCitado: `${base}/finais/${V}-${N2}.jpg`,
  referencia: `${base}/referencias/rosa-frente-abc123.jpg`,
  semLinha: `${base}/rosa/2-1-${u(99)}-${P1}.png`,
  outraOrg: `${u(77)}/galeria-ia/${FAM}/rosa/2-1-${G}-${u(903)}.png`,
  formatoEstranho: `${base}/rosa/qualquer.png`,
  fundo: `${base}/rosa/sub/2-1-${G}-${u(904)}.png`,
  foraDaGaleria: `${ORG}/lotes/2-1-${G}-${P2}.png`,
  orfaRecente: `${base}/rosa/2-1-${G}-${u(905)}.png`,
}
const APAGAVEIS = [caminhos.cenaOrfa, caminhos.finalNaoCitado]

function montar() {
  const img = (id: string, o: Record<string, unknown>) => ({ id, org_id: ORG, familia_id: FAM, origem: 'gerador', aprovado_em: null, cena_path: null, final_path: null, final_upload_path: null, ...o })
  const db = {
    galeria_imagens: [
      img(G, { status: 'gerada', cena_path: caminhos.cenaCitada }),
      img(A, { status: 'aprovada', aprovado_em: VELHO, cena_path: caminhos.cenaDaAprovada, final_path: caminhos.finalAprovado, final_upload_path: caminhos.finalAprovado }),
      img(D, { status: 'desatualizada', aprovado_em: VELHO, cena_path: `${base}/rosa/3-1-${D}-${P1}.png`, final_path: caminhos.finalDesatualizada }),
      img(V, { status: 'gerada', cena_path: `${base}/rosa/4-1-${V}-${P1}.png`, final_upload_path: caminhos.finalUpload }),
      img(R, { status: 'gerada', origem: 'recorte' }),
    ],
    galeria_cursores: [] as Array<Record<string, unknown>>,
  }
  const arquivos = new Map<string, Uint8Array>()
  f.objetos = Object.entries(caminhos).map(([, name], i) => ({
    id: u(500 + i), name, created_at: name === caminhos.orfaRecente ? new Date().toISOString() : VELHO,
  }))
  for (const o of f.objetos) arquivos.set(o.name, new Uint8Array([1]))
  f.fake = fakeAdmin(db, arquivos)
  // Listagem como a RPC: objetos ainda existentes, depois do cursor (created_at, id), em ordem, até p_limite.
  f.fake.respostasRpc.galeria_retencao_listar = (a) => f.objetos
    .filter((o) => f.fake.arquivos.has(o.name))
    .filter((o) => !a.p_cursor_em || `${o.created_at}|${o.id}` > `${a.p_cursor_em}|${a.p_cursor_id}`)
    .sort((x, y) => (`${x.created_at}|${x.id}` < `${y.created_at}|${y.id}` ? -1 : 1))
    .slice(0, a.p_limite as number)
}

beforeEach(() => { f.assinatura = true; montar() })

const chamar = () => handler(new Request('http://x/galeria-retencao', { method: 'POST', body: '' }))

describe('galeria-retencao', () => {
  it('assinatura do QStash inválida → 401, sem listar nem apagar', async () => {
    f.assinatura = false
    expect((await chamar()).status).toBe(401)
    expect(f.fake.rpcs).toEqual([])
    expect(f.fake.removidos).toEqual([])
  })

  it('apaga só a cena órfã de posse perdida e o final não citado, com mais de 1 dia', async () => {
    const r = await chamar()
    expect(r.status).toBe(200)
    expect([...f.fake.removidos].sort()).toEqual([...APAGAVEIS].sort())
  })

  it('cena citada em cena_path nunca é apagada', async () => {
    await chamar()
    expect(f.fake.removidos).not.toContain(caminhos.cenaCitada)
  })

  it('final aprovado e qualquer arquivo de imagem aprovada (inclusive órfão) nunca são apagados', async () => {
    await chamar()
    for (const p of [caminhos.finalAprovado, caminhos.finalAntigoDaAprovada, caminhos.cenaDaAprovada, caminhos.cenaOrfaDaAprovada])
      expect(f.fake.removidos).not.toContain(p)
  })

  it('aprovada que virou desatualizada nunca é apagada', async () => {
    await chamar()
    expect(f.fake.removidos).not.toContain(caminhos.finalDesatualizada)
    expect(f.fake.removidos).not.toContain(caminhos.cenaOrfaDesatualizada)
  })

  it('aprovada que voltou a gerada (aprovado_em preenchido) continua protegida', async () => {
    const a = f.fake.admin
    await a.from('galeria_imagens').update({ status: 'gerada' }).eq('id', A)
    await chamar()
    expect(f.fake.removidos).not.toContain(caminhos.finalAprovado)
    expect(f.fake.removidos).not.toContain(caminhos.cenaOrfaDaAprovada)
  })

  it('final citado em final_upload_path (preparo em curso) não é apagado', async () => {
    await chamar()
    expect(f.fake.removidos).not.toContain(caminhos.finalUpload)
  })

  it('arquivo de referencias/ nunca é apagado; recorte não tem arquivo próprio', async () => {
    await chamar()
    expect(f.fake.removidos).not.toContain(caminhos.referencia)
    expect(f.fake.removidos.some((p) => p.includes(R))).toBe(false)
  })

  it('na dúvida não apaga: sem linha, outra org, formato estranho, profundidade errada, fora da galeria, recente', async () => {
    await chamar()
    for (const p of [caminhos.semLinha, caminhos.outraOrg, caminhos.formatoEstranho, caminhos.fundo, caminhos.foraDaGaleria, caminhos.orfaRecente])
      expect(f.fake.removidos).not.toContain(p)
  })

  it('erro ao consultar as linhas → 500, nada apagado e cursor não avança', async () => {
    const orig = f.fake.admin.from
    f.fake.admin.from = ((t: string) => {
      const q = orig(t) as Record<string, unknown>
      if (t !== 'galeria_imagens') return q
      return { ...q, select: () => ({ in: async () => ({ data: null, error: { message: 'down' } }) }) }
    }) as typeof orig
    expect((await chamar()).status).toBe(500)
    expect(f.fake.removidos).toEqual([])
    f.fake.admin.from = orig
    const { data } = await f.fake.admin.from('galeria_cursores').select('*').eq('chave', 'galeria-retencao').maybeSingle()
    expect(data?.cursor_em ?? null).toBeNull()
  })

  it('idempotente: a segunda execução não apaga mais nada', async () => {
    await chamar()
    const n = f.fake.removidos.length
    expect(n).toBe(APAGAVEIS.length)
    expect((await chamar()).status).toBe(200)
    expect(f.fake.removidos.length).toBe(n)
  })

  it('lotes de 100 com cursor persistido; lote final curto zera o cursor', async () => {
    // 150 cenas órfãs de G: 2 lotes (100 + 50) numa execução.
    for (let i = 0; i < 150; i++) {
      const o = { id: u(10_000 + i), name: `${base}/rosa/2-1-${G}-${u(20_000 + i)}.png`, created_at: VELHO }
      f.objetos.push(o)
      f.fake.arquivos.set(o.name, new Uint8Array([1]))
    }
    await chamar()
    const listagens = f.fake.rpcs.filter((x) => x.nome === 'galeria_retencao_listar')
    expect(listagens.every((x) => x.args.p_limite === 100)).toBe(true)
    expect(listagens.length).toBeGreaterThanOrEqual(2)
    expect(listagens[1].args.p_cursor_em).not.toBeNull()
    expect(f.fake.removidos.length).toBe(150 + APAGAVEIS.length)
    const { data } = await f.fake.admin.from('galeria_cursores').select('*').eq('chave', 'galeria-retencao').maybeSingle()
    expect(data?.cursor_em ?? null).toBeNull()
  })
})
