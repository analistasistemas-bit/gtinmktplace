import { describe, expect, it, vi } from 'vitest'
import { consultarHF, credenciaisHF, submeterHF } from '../higgsfield'

const resp = (status: number, corpo: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => corpo, text: async () => JSON.stringify(corpo) }) as any

describe('credenciaisHF', () => {
  it('com 3 partes usa só as duas últimas', () => {
    expect(credenciaisHF('copy-id:ID:SECRET')).toBe('ID:SECRET')
  })
  it('com 2 partes mantém', () => {
    expect(credenciaisHF('ID:SECRET')).toBe('ID:SECRET')
  })
  it('ausente, vazia ou sem ID:SECRET lança', () => {
    for (const ruim of [undefined, null, '', '  ', 'so-um-valor', 'ID:']) {
      expect(() => credenciaisHF(ruim)).toThrow()
    }
  })
})

describe('submeterHF', () => {
  it('faz POST no endpoint com header Key e devolve o request_id', async () => {
    const f = vi.fn(async (..._a: any[]) => resp(200, { status: 'queued', request_id: 'r1' }))
    const id = await submeterHF('xai/grok-imagine-image-2.0', { prompt: 'p' }, { fetchFn: f as any, credenciais: 'a:b' })
    expect(id).toBe('r1')
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe('https://api.higgsfield.ai/xai/grok-imagine-image-2.0')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Key a:b')
    expect(JSON.parse(init.body)).toEqual({ prompt: 'p' })
  })
  it('credencial inválida lança antes de qualquer fetch', async () => {
    const f = vi.fn(async () => resp(200, {}))
    await expect(submeterHF('x', {}, { fetchFn: f as any, credenciais: '' })).rejects.toThrow(/HF_CREDENTIALS/)
    await expect(consultarHF('r', { fetchFn: f as any, credenciais: 'x' })).rejects.toThrow(/HF_CREDENTIALS/)
    expect(f).not.toHaveBeenCalled()
  })
  it('credencial de 3 partes envia só ID:SECRET', async () => {
    const f = vi.fn(async (..._a: any[]) => resp(200, { request_id: 'r1' }))
    await submeterHF('x', {}, { fetchFn: f as any, credenciais: 'copy:ID:SECRET' })
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe('Key ID:SECRET')
  })
  it('timeout: fetch que nunca resolve aborta no teto', async () => {
    const pendura = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(init.signal!.reason)))) as any
    await expect(submeterHF('x', {}, { fetchFn: pendura, credenciais: 'a:b', timeoutMs: 20 })).rejects.toBeTruthy()
    await expect(consultarHF('r', { fetchFn: pendura, credenciais: 'a:b', timeoutMs: 20 })).rejects.toBeTruthy()
  })
  it('401 lança erro com o status', async () => {
    const f = vi.fn(async () => resp(401, { detail: 'no' }))
    await expect(submeterHF('x', {}, { fetchFn: f as any, credenciais: 'a:b' })).rejects.toMatchObject({ status: 401 })
  })
})

describe('consultarHF', () => {
  const op = (corpo: unknown) => ({ fetchFn: (async () => resp(200, corpo)) as any, credenciais: 'a:b' })
  it('completed devolve a url da primeira imagem', async () => {
    const r = await consultarHF('r1', op({ status: 'completed', images: [{ url: 'https://i/1.png' }] }))
    expect(r).toEqual({ status: 'concluida', url: 'https://i/1.png' })
  })
  it('nsfw vira falhou com erro nsfw', async () => {
    expect(await consultarHF('r1', op({ status: 'nsfw' }))).toEqual({ status: 'falhou', erro: 'nsfw' })
  })
  it('failed vira falhou e queued/in_progress ficam pendentes', async () => {
    expect((await consultarHF('r1', op({ status: 'failed' }))).status).toBe('falhou')
    expect((await consultarHF('r1', op({ status: 'queued' }))).status).toBe('pendente')
    expect((await consultarHF('r1', op({ status: 'in_progress' }))).status).toBe('pendente')
  })
  it('completed sem imagem é falha', async () => {
    expect((await consultarHF('r1', op({ status: 'completed', images: [] }))).status).toBe('falhou')
  })
  it('usa GET em /requests/{id}/status e lança com status em não-2xx', async () => {
    const f = vi.fn(async (..._a: any[]) => resp(401, {}))
    await expect(consultarHF('r9', { fetchFn: f as any, credenciais: 'a:b' })).rejects.toMatchObject({ status: 401 })
    expect((f.mock.calls[0] as any)[0]).toBe('https://api.higgsfield.ai/requests/r9/status')
    expect((f.mock.calls[0] as any)[1].method).toBe('GET')
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe('Key a:b')
  })
})
