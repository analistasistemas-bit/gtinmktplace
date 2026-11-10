import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const f = vi.hoisted(() => ({ serve: vi.fn(), assinatura: true, executar: vi.fn() }))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {} }))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => ({}) }))
vi.mock('../../_shared/queue.ts', () => ({ verificarAssinatura: vi.fn(async () => f.assinatura) }))
vi.mock('../../_shared/galeria/worker-estado.ts', () => ({ executarImagem: f.executar }))

let handler: (req: Request) => Promise<Response>
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})
beforeEach(() => { f.assinatura = true; f.executar.mockReset() })

const chamar = (body: unknown) => handler(new Request('http://x/galeria-worker', { method: 'POST', body: JSON.stringify(body) }))
// Formato publicado por publicarJobs (despachante e galeria-gerar).
const MSG = { tipo: 'imagem', id: 'g1', fase: 1, tentativa: 1, despacho_seq: 3, acao: 'consultar' }

describe('galeria-worker', () => {
  it('assinatura inválida → 401, sem executar', async () => {
    f.assinatura = false
    expect((await chamar(MSG)).status).toBe(401)
    expect(f.executar).not.toHaveBeenCalled()
  })
  it('mensagem do despachante → executa a fase; ocupado responde 200', async () => {
    f.executar.mockResolvedValue('ocupado')
    const r = await chamar(MSG)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, resultado: 'ocupado' })
    expect(f.executar.mock.calls[0][1]).toEqual({ id: 'g1', fase: 1, tentativa: 1 })
  })
  it('mensagem fora do formato → 400', async () => {
    expect((await chamar({ tipo: 'aplicacao_item', id: 'x', fase: 0, tentativa: 0 })).status).toBe(400)
    expect((await chamar({ tipo: 'imagem', id: 'x' })).status).toBe(400)
  })
  it('erro inesperado → 500 (o QStash/despachante repete)', async () => {
    f.executar.mockRejectedValue(new Error('db'))
    expect((await chamar(MSG)).status).toBe(500)
  })
})
