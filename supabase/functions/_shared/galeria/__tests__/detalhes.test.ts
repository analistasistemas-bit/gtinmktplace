// Lupa pela caixa do produto (plano 2026-11-11, testes 1, 2, 3, 5 e 11; ajustes v3 itens 2, 5, 6 e 8). Sem rede:
// visão mockada; a RPC condicional é espelhada aqui (o SQL real é provado em supabase/tests/galeria_referencia_detalhes.sql).
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from './fake-admin'

const v = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: v.create } } }) }))

const { garantirDetalhes, infoJpeg, lerDetalhesPorVisao, VERSAO_LEITURA, RELER_FALHOU_MS } = await import('../detalhes')

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>

/** JPEG mínimo: SOF0 com as dimensões e, se pedido, APP1 Exif com a tag Orientation (TIFF big-endian). */
function jpeg(w: number, h: number, orientacao?: number): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, ...Array(9).fill(0)]
  let app1: number[] = []
  if (orientacao !== undefined) {
    const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientacao, 0, 0, 0, 0, 0, 0]
    const corpo = [...'Exif\0\0'].map((c) => c.charCodeAt(0)).concat(tiff)
    app1 = [0xff, 0xe1, (corpo.length + 2) >> 8, (corpo.length + 2) & 255, ...corpo]
  }
  return new Uint8Array([0xff, 0xd8, ...app1, ...sof, 0xff, 0xd9])
}
const resposta = (corpo: unknown) => ({ choices: [{ message: { content: typeof corpo === 'string' ? corpo : JSON.stringify(corpo) } }] })
const BOM = { produto: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, detalhes: [{ tipo: 'trama', caixa: { x: 0.2, y: 0.2, w: 0.1, h: 0.1 } }] }
const ref = (n: number) => ({ id: `ref${n}`, path: `org/galeria-ia/famB/referencias/c${n}-frente-s${n}.jpg` })
const det = (id: string) => db.galeria_referencias.find((r) => r.id === id)!.detalhes as Linha | null

beforeEach(() => {
  v.create.mockReset()
  db = {
    galeria_referencias: [1, 2, 3, 4, 5].map((n) => ({ id: `ref${n}`, org_id: 'org', vista: 'frente', path: ref(n).path, detalhes: null })),
  }
  fake = fakeAdmin(db, new Map([1, 2, 3, 4, 5].map((n) => [ref(n).path, jpeg(1200, 1500)])))
  // Espelho de galeria_gravar_detalhes: grava só sobre nula, falhou ou outra versão; devolve a vigente.
  fake.respostasRpc.galeria_gravar_detalhes = ({ p_org, p_referencia, p_detalhes }) => {
    const r = db.galeria_referencias.find((x) => x.id === p_referencia && x.org_id === p_org)
    if (!r) return null
    const a = r.detalhes as Linha | null
    if (!a || a.estado === 'falhou' || a.versao !== (p_detalhes as Linha).versao) r.detalhes = p_detalhes
    return r.detalhes
  }
})

describe('infoJpeg', () => {
  it('dimensões pelo SOF (fixture real 1200×1540) e EXIF Orientation; EXIF ilegível → 0', () => {
    const real = new Uint8Array(readFileSync('supabase/functions/_shared/galeria/__tests__/fixtures/final-real.jpg'))
    expect(infoJpeg(real)).toEqual({ w: 1200, h: 1540, orientacao: 1 })
    expect(infoJpeg(jpeg(800, 600, 6))).toEqual({ w: 800, h: 600, orientacao: 6 })
    expect(infoJpeg(jpeg(800, 600, 1))).toEqual({ w: 800, h: 600, orientacao: 1 })
    const ruim = jpeg(800, 600, 1); ruim[12] = 0x00 // quebra o "MM" do TIFF
    expect(infoJpeg(ruim)?.orientacao).toBe(0)
    expect(infoJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
})

describe('lerDetalhesPorVisao', () => {
  it('maxRetries 0 e timeout de 30 s; resposta válida → caixas (até 2 detalhes)', async () => {
    const espia = vi.spyOn(AbortSignal, 'timeout')
    v.create.mockResolvedValueOnce(resposta(BOM))
    expect(await lerDetalhesPorVisao('https://signed/x')).toEqual({ produto: BOM.produto, detalhes: [BOM.detalhes[0].caixa] })
    expect(espia).toHaveBeenCalledWith(30_000)
    expect(v.create.mock.calls[0][1].maxRetries).toBe(0)
    espia.mockRestore()
  })

  it.each([
    ['ilegível', 'não sei'],
    ['sem produto', { produto: null, detalhes: [] }],
    ['sem detalhe', { ...BOM, detalhes: [] }],
    ['caixa fora de [0,1]', { ...BOM, produto: { x: 0.5, y: 0.1, w: 0.8, h: 0.5 } }],
    ['detalhe fora do produto', { ...BOM, detalhes: [{ tipo: 'alça', caixa: { x: 0.02, y: 0.2, w: 0.1, h: 0.1 } }] }],
    ['um dos dois detalhes fora do produto', { ...BOM, detalhes: [BOM.detalhes[0], { tipo: 'x', caixa: { x: 0.85, y: 0.85, w: 0.1, h: 0.1 } }] }],
  ])('%s → null (sem caixas utilizáveis)', async (_n, corpo) => {
    v.create.mockResolvedValueOnce(resposta(corpo))
    expect(await lerDetalhesPorVisao('https://signed/x')).toBeNull()
  })
})

describe('garantirDetalhes', () => {
  it('resposta válida → ok com ref_w/ref_h e hash; segunda chamada não chama a visão; nada em platform_image_deliveries', async () => {
    v.create.mockResolvedValue(resposta(BOM))
    const r = await garantirDetalhes(fake.admin as never, 'org', [ref(1)])
    expect(r.ref1).toMatchObject({ estado: 'ok', versao: VERSAO_LEITURA, ref_w: 1200, ref_h: 1500, produto: BOM.produto })
    expect((r.ref1 as Linha).hash).toMatch(/^[0-9a-f]{64}$/)
    expect(det('ref1')).toEqual(r.ref1)
    await garantirDetalhes(fake.admin as never, 'org', [ref(1)])
    expect(v.create).toHaveBeenCalledTimes(1)
    expect(fake.escritas.map((e) => e.tabela)).not.toContain('platform_image_deliveries')
    expect(fake.rpcs.map((x) => x.nome)).toEqual(['galeria_gravar_detalhes'])
  })

  it('hash muda com as caixas e com as dimensões', async () => {
    v.create.mockResolvedValue(resposta(BOM))
    const a = (await garantirDetalhes(fake.admin as never, 'org', [ref(1)])).ref1 as Linha
    fake.arquivos.set(ref(2).path, jpeg(1200, 1600))
    const b = (await garantirDetalhes(fake.admin as never, 'org', [ref(2)])).ref2 as Linha
    expect(a.hash).not.toBe(b.hash)
  })

  it.each([
    ['ilegível', () => v.create.mockResolvedValue(resposta('???'))],
    ['detalhe fora do produto', () => v.create.mockResolvedValue(resposta({ ...BOM, detalhes: [{ tipo: 'x', caixa: { x: 0, y: 0, w: 0.05, h: 0.05 } }] }))],
    ['EXIF Orientation ≠ 1 (sem chamar a visão)', () => { fake.arquivos.set(ref(1).path, jpeg(1200, 1500, 6)) }],
  ])('%s → sem_detalhe definitivo: não relê nem depois de 5 min', async (_n, preparar) => {
    preparar()
    const r = await garantirDetalhes(fake.admin as never, 'org', [ref(1)])
    expect(r.ref1).toMatchObject({ estado: 'sem_detalhe', versao: VERSAO_LEITURA })
    const chamadas = v.create.mock.calls.length
    ;(det('ref1') as Linha).tentado_em = new Date(Date.now() - 2 * RELER_FALHOU_MS).toISOString()
    await garantirDetalhes(fake.admin as never, 'org', [ref(1)])
    expect(v.create.mock.calls.length).toBe(chamadas)
  })

  it('erro de transporte → falhou; recente não relê; depois de 5 min relê e grava ok', async () => {
    v.create.mockRejectedValueOnce(new Error('timeout'))
    expect((await garantirDetalhes(fake.admin as never, 'org', [ref(1)])).ref1).toMatchObject({ estado: 'falhou' })
    await garantirDetalhes(fake.admin as never, 'org', [ref(1)])
    expect(v.create).toHaveBeenCalledTimes(1)
    ;(det('ref1') as Linha).tentado_em = new Date(Date.now() - RELER_FALHOU_MS - 1000).toISOString()
    v.create.mockResolvedValueOnce(resposta(BOM))
    expect((await garantirDetalhes(fake.admin as never, 'org', [ref(1)])).ref1).toMatchObject({ estado: 'ok' })
    expect(v.create).toHaveBeenCalledTimes(2)
  })

  it('referência sumida do Storage → falhou (relê depois), nunca derruba', async () => {
    fake.arquivos.delete(ref(1).path)
    expect((await garantirDetalhes(fake.admin as never, 'org', [ref(1)])).ref1).toMatchObject({ estado: 'falhou' })
  })

  it('troca de versão relê ok e sem_detalhe', async () => {
    db.galeria_referencias[0].detalhes = { estado: 'ok', versao: 'openai/velho#lupa-v0', tentado_em: 't', hash: 'h0' }
    db.galeria_referencias[1].detalhes = { estado: 'sem_detalhe', versao: 'openai/velho#lupa-v0', tentado_em: 't' }
    v.create.mockResolvedValue(resposta(BOM))
    const r = await garantirDetalhes(fake.admin as never, 'org', [ref(1), ref(2)])
    expect(v.create).toHaveBeenCalledTimes(2)
    expect([r.ref1, r.ref2].map((d) => (d as Linha).versao)).toEqual([VERSAO_LEITURA, VERSAO_LEITURA])
  })

  it('5 cores em paralelo, uma presa: responde no prazo global; as outras gravam ok, a presa fica falhou', async () => {
    let iniciadas = 0
    v.create.mockImplementation((corpo: unknown, opcoes: { signal: AbortSignal }) => {
      iniciadas++
      const url = ((corpo as { messages: Array<{ content: unknown }> }).messages[1].content as Array<{ image_url: { url: string } }>)[0].image_url.url
      if (url.includes('c3-frente')) {
        return new Promise((_ok, falha) => opcoes.signal.addEventListener('abort', () => falha(new Error('abortado'))))
      }
      return Promise.resolve(resposta(BOM))
    })
    const t0 = Date.now()
    const r = await garantirDetalhes(fake.admin as never, 'org', [1, 2, 3, 4, 5].map(ref), 80)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(iniciadas).toBe(5)
    expect(Object.fromEntries(Object.entries(r).map(([k, d]) => [k, (d as Linha).estado])))
      .toEqual({ ref1: 'ok', ref2: 'ok', ref3: 'falhou', ref4: 'ok', ref5: 'ok' })
  })

  it('dois montar concorrentes → uma única gravação final; os dois devolvem a vencedora relida do banco', async () => {
    v.create
      .mockResolvedValueOnce(resposta(BOM))
      .mockResolvedValueOnce(resposta({ ...BOM, detalhes: [{ tipo: 'costura', caixa: { x: 0.5, y: 0.5, w: 0.1, h: 0.1 } }] }))
    const [a, b] = await Promise.all([
      garantirDetalhes(fake.admin as never, 'org', [ref(1)]), garantirDetalhes(fake.admin as never, 'org', [ref(1)]),
    ])
    expect(v.create).toHaveBeenCalledTimes(2)
    expect(a.ref1).toEqual(det('ref1'))
    expect(b.ref1).toEqual(det('ref1'))
  })
})
