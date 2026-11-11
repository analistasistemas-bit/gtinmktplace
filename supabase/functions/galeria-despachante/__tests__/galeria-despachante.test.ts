import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as ReturnType<typeof import('../../_shared/galeria/__tests__/fake-admin').fakeAdmin>,
  assinatura: true, batch: vi.fn(), enqueue: vi.fn(), filas: [] as string[],
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {} }))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/queue.ts', () => ({
  verificarAssinatura: vi.fn(async () => f.assinatura),
  qstashClient: () => ({ batchJSON: f.batch, queue: ({ queueName }: { queueName: string }) => { f.filas.push(queueName); return { enqueueJSON: f.enqueue } } }),
  garantirFilaSerial: vi.fn(async () => {}),
  enfileirarJobPublicacaoML: vi.fn(async () => 'm'),
}))

let handler: (req: Request) => Promise<Response>
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: (k: string) => (k === 'SUPABASE_URL' ? 'https://x.supabase.co' : undefined) } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

beforeEach(() => {
  const g1 = { id: 'g1', origem: 'gerador', status: 'gerando', fase: 1, tentativa: 1, despacho_seq: 0, provedor: 'higgsfield', lease_ate: null }
  f.fake = fakeAdmin({ galeria_imagens: [g1] })
  f.fake.respostasRpc.galeria_trabalho_pendente = () => [{ ...g1 }]
  f.assinatura = true
  f.batch.mockReset()
  f.batch.mockImplementation(async (msgs: unknown[]) => msgs.map((_, i) => ({ messageId: `m${i}` })))
})

const chamar = () => handler(new Request('http://x/galeria-despachante', { method: 'POST', body: '' }))

describe('galeria-despachante', () => {
  it('assinatura inválida → 401, sem consultar nada', async () => {
    f.assinatura = false
    expect((await chamar()).status).toBe(401)
    expect(f.fake.rpcs).toEqual([])
  })

  it('agendamento válido → consulta as três filas e publica no galeria-worker via batchJSON', async () => {
    const r = await chamar()
    expect(r.status).toBe(200)
    expect(f.fake.rpcs.map((x) => [x.nome, x.args.p_limite])).toEqual(expect.arrayContaining([
      ['galeria_trabalho_pendente', 50], ['galeria_visao_pendente', 20], ['galeria_trabalho_pendente_aplicacao', 20],
    ]))
    expect(f.batch.mock.calls[0][0]).toEqual([expect.objectContaining({ url: 'https://x.supabase.co/functions/v1/galeria-worker', deduplicationId: 'g1_1' })])
  })
})
