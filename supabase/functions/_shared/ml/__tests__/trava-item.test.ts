// ADR-0201 Task 14 — trava de escrita por MLB dos escritores comuns e adiamento durável (sem rede).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { publishJSON } = vi.hoisted(() => ({ publishJSON: vi.fn(async () => ({ messageId: 'm1' })) }))
vi.mock('../../queue.ts', () => ({ qstashClient: () => ({ publishJSON }) }))

import { fakeAdmin } from '../../galeria/__tests__/fake-admin'
import {
  acordarEscritaAdiada, agendarAcordar, controleTrava, decidirAcordar, donoEscritor, encerrarEscritaAdiada,
  reservarEscrita, QUARENTENA_PUT_S, TTL_TRAVA_S,
} from '../trava-item'

const AGORA = new Date('2026-11-10T12:00:00.000Z')
const min = (m: number) => new Date(AGORA.getTime() + m * 60_000).toISOString()
type Linha = Record<string, unknown>

function banco(extra: Record<string, Linha[]> = {}) {
  const db: Record<string, Linha[]> = {
    ml_escritas_adiadas: [], ml_item_travas: [],
    familias: [{ id: 'fam1', status: 'publicando', user_id: 'imp-1', lote_id: 'lote1' }],
    lotes: [{ id: 'lote1', status: 'processando' }],
    variacoes: [{ id: 'v1', familia_id: 'fam1', ml_picture_id: 'PIC-1' }],
    ...extra,
  }
  const f = fakeAdmin(db)
  return { db, ...f, admin: f.admin as never }
}
const pedido = (extra: Partial<Parameters<typeof reservarEscrita>[1]> = {}) => ({
  orgId: 'org1', familiaId: 'fam1', loteId: 'lote1', endpoint: 'update-familia-ml', itens: ['MLB1'],
  job: { familia_id: 'fam1', lote_id: 'lote1' }, ...extra,
})

beforeEach(() => { publishJSON.mockClear() })

describe('reservarEscrita', () => {
  it('item livre → trava escritor de 600 s com dono estável por job (retry reencontra a própria trava)', async () => {
    const b = banco()
    b.respostasRpc.ml_travar_itens = () => true
    const r = await reservarEscrita(b.admin, pedido(), { agora: () => AGORA })
    expect(r).toEqual({ tipo: 'livre', dono: donoEscritor('update-familia-ml', 'fam1', 'lote1'), posseAdiada: null })
    expect(b.rpcs[0]).toEqual({ nome: 'ml_travar_itens', args: {
      p_org: 'org1', p_itens: ['MLB1'], p_tipo: 'escritor', p_dono: donoEscritor('update-familia-ml', 'fam1', 'lote1'), p_ttl_seg: TTL_TRAVA_S } })
    expect(TTL_TRAVA_S).toBe(600)
    expect(donoEscritor('update-familia-ml', 'fam1', 'lote1')).toBe(donoEscritor('update-familia-ml', 'fam1', 'lote1'))
    expect(donoEscritor('publicar-split-ml', 'fam1', 'lote1')).not.toBe(donoEscritor('update-familia-ml', 'fam1', 'lote1'))
    expect(b.db.ml_escritas_adiadas).toEqual([])
  })

  it('item travado → adiamento durável (linha + acordar SEM fila com delay 60), sem GET nem PUT', async () => {
    const b = banco()
    b.respostasRpc.ml_travar_itens = () => false
    const acordar = vi.fn(async () => {})
    const r = await reservarEscrita(b.admin, pedido({ job: { familia_id: 'fam1', lote_id: 'lote1', somenteEstoque: true } }),
      { agora: () => AGORA, acordar })
    expect(r.tipo).toBe('adiada')
    expect(b.db.ml_escritas_adiadas).toHaveLength(1)
    const l = b.db.ml_escritas_adiadas[0]
    expect(l).toMatchObject({ org_id: 'org1', familia_id: 'fam1', lote_id: 'lote1', endpoint: 'update-familia-ml', itens: ['MLB1'],
      job: { familia_id: 'fam1', lote_id: 'lote1', somenteEstoque: true }, proxima_em: min(1),
      trava_dono: donoEscritor('update-familia-ml', 'fam1', 'lote1') })
    expect(acordar).toHaveBeenCalledWith('update-familia-ml', { acordar: true, adiada_id: l.id }, 60)
    expect(b.db.familias[0].status).toBe('publicando')
  })

  it('agendarAcordar usa publishJSON sem queueName e com delay (nenhuma mensagem com delay entra em publish-ml-*)', async () => {
    vi.stubGlobal('Deno', { env: { get: () => 'https://x.supabase.co' } })
    await agendarAcordar('update-familia-ml', { acordar: true, adiada_id: 'a1' })
    expect(publishJSON).toHaveBeenCalledTimes(1)
    const arg = (publishJSON.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(arg).toMatchObject({ url: 'https://x.supabase.co/functions/v1/update-familia-ml', delay: 60, body: { acordar: true, adiada_id: 'a1' } })
    expect(arg).not.toHaveProperty('queueName')
    vi.unstubAllGlobals()
  })

  it('falha ao gravar a linha de adiamento → lança (o worker responde 5xx e a mensagem original repete)', async () => {
    const b = banco()
    b.respostasRpc.ml_travar_itens = () => false
    const admin = { ...b.admin as object, from: (t: string) => t === 'ml_escritas_adiadas'
      ? { upsert: () => ({ select: async () => ({ data: null, error: { message: 'boom' } }) }) }
      : (b.admin as { from: (t: string) => unknown }).from(t) }
    await expect(reservarEscrita(admin as never, pedido(), { agora: () => AGORA, acordar: async () => {} })).rejects.toThrow(/gravar escrita adiada/)
  })

  it('dois jobs adiados da mesma família e lote com endpoint diferente → duas linhas; o mesmo job repetido → uma', async () => {
    const b = banco()
    b.respostasRpc.ml_travar_itens = () => false
    const deps = { agora: () => AGORA, acordar: async () => {} }
    await reservarEscrita(b.admin, pedido(), deps)
    b.db.ml_escritas_adiadas[0].adiado_desde = min(-30)
    await reservarEscrita(b.admin, pedido({ endpoint: 'publicar-split-ml' }), deps)
    await reservarEscrita(b.admin, pedido(), { ...deps, agora: () => new Date(AGORA.getTime() + 120_000) })
    expect(b.db.ml_escritas_adiadas.map((l) => l.endpoint).sort()).toEqual(['publicar-split-ml', 'update-familia-ml'])
    const upd = b.db.ml_escritas_adiadas.find((l) => l.endpoint === 'update-familia-ml')!
    expect(upd.adiado_desde).toBe(min(-30))
    expect(upd.proxima_em).toBe(min(3))
  })

  it('job reenfileirado duas vezes → só um assume (o outro encontra assumida_ate vigente e não trava)', async () => {
    const b = banco({ ml_escritas_adiadas: [{ id: 'ad1', org_id: 'org1', familia_id: 'fam1', lote_id: 'lote1', endpoint: 'update-familia-ml',
      itens: ['MLB1'], job: {}, adiado_desde: min(-20), proxima_em: min(4), posse: null, assumida_ate: null }] })
    b.respostasRpc.ml_travar_itens = () => true
    const r1 = await reservarEscrita(b.admin, pedido({ adiadaId: 'ad1' }), { agora: () => AGORA })
    const r2 = await reservarEscrita(b.admin, pedido({ adiadaId: 'ad1' }), { agora: () => AGORA })
    expect(r1.tipo).toBe('livre')
    expect(r2).toEqual({ tipo: 'assumida' })
    expect(b.rpcs.filter((x) => x.nome === 'ml_travar_itens')).toHaveLength(1)
    expect(b.db.ml_escritas_adiadas[0]).toMatchObject({ assumida_ate: min(10), trava_dono: donoEscritor('update-familia-ml', 'fam1', 'lote1') })
    // Desfecho persistido → apaga só se a posse é minha.
    await encerrarEscritaAdiada(b.admin, 'ad1', 'outra')
    expect(b.db.ml_escritas_adiadas).toHaveLength(1)
    await encerrarEscritaAdiada(b.admin, 'ad1', (r1 as { posseAdiada: string }).posseAdiada)
    expect(b.db.ml_escritas_adiadas).toEqual([])
  })

  it('queda logo depois do claim → assumida_ate vence e outro job assume a mesma linha', async () => {
    const b = banco({ ml_escritas_adiadas: [{ id: 'ad1', org_id: 'org1', familia_id: 'fam1', lote_id: 'lote1', endpoint: 'update-familia-ml',
      itens: ['MLB1'], job: {}, adiado_desde: min(-20), proxima_em: min(-1), posse: 'morta', assumida_ate: min(-1) }] })
    b.respostasRpc.ml_travar_itens = () => true
    expect((await reservarEscrita(b.admin, pedido({ adiadaId: 'ad1' }), { agora: () => AGORA })).tipo).toBe('livre')
  })

  it('reenfileirado que perde a trava de novo → mesma linha, adiado_desde original, proxima_em +60 s, posse solta', async () => {
    const b = banco({ ml_escritas_adiadas: [{ id: 'ad1', org_id: 'org1', familia_id: 'fam1', lote_id: 'lote1', endpoint: 'update-familia-ml',
      itens: ['MLB1'], job: {}, adiado_desde: min(-125), proxima_em: min(4), posse: null, assumida_ate: null }] })
    b.respostasRpc.ml_travar_itens = () => false
    const acordar = vi.fn(async () => {})
    const r = await reservarEscrita(b.admin, pedido({ adiadaId: 'ad1' }), { agora: () => AGORA, acordar })
    expect(r).toEqual({ tipo: 'adiada', adiadaId: 'ad1' })
    expect(b.db.ml_escritas_adiadas).toHaveLength(1)
    expect(b.db.ml_escritas_adiadas[0]).toMatchObject({ adiado_desde: min(-125), proxima_em: min(1), posse: null, assumida_ate: null })
    expect(acordar).toHaveBeenCalledWith('update-familia-ml', { acordar: true, adiada_id: 'ad1' }, 60)
  })
})

describe('decidirAcordar (relógio = adiado_desde, nunca Upstash-Retried)', () => {
  it('travado → reagendar; livre → enfileirar; 240 min → erro mesmo com 40 mensagens novas', () => {
    expect(decidirAcordar({ adiado_desde: min(-5) }, AGORA, true)).toBe('reagendar')
    expect(decidirAcordar({ adiado_desde: min(-5) }, AGORA, false)).toBe('enfileirar')
    expect(decidirAcordar({ adiado_desde: min(-239) }, AGORA, true)).toBe('reagendar')
    expect(decidirAcordar({ adiado_desde: min(-240) }, AGORA, true)).toBe('erro')
    // Colisão no minuto 0 com saga que solta a trava no minuto 125 (e relógio com tick 10 min atrasado): abaixo do teto.
    expect(decidirAcordar({ adiado_desde: min(-135) }, AGORA, false)).toBe('enfileirar')
  })
})

describe('acordarEscritaAdiada (mensagem de acordar; nunca escreve no ML)', () => {
  const linha = (extra: Linha = {}) => ({ id: 'ad1', org_id: 'org1', familia_id: 'fam1', lote_id: 'lote1', endpoint: 'update-familia-ml',
    itens: ['MLB1'], job: { familia_id: 'fam1', lote_id: 'lote1' }, adiado_desde: min(-10), proxima_em: min(0), posse: null, assumida_ate: null, ...extra })
  const deps = () => ({ agora: AGORA, base: 'https://x', publicar: vi.fn(), garantirFila: vi.fn(), enfileirar: vi.fn(async () => 'm') })

  it('item ainda travado → reagenda (+60 s), sem enfileirar', async () => {
    const b = banco({ ml_escritas_adiadas: [linha()], ml_item_travas: [{ org_id: 'org1', item_id: 'MLB1', dono_tipo: 'galeria', expira_em: null }] })
    const d = deps()
    await acordarEscritaAdiada(b.admin, 'ad1', d)
    expect(d.enfileirar).not.toHaveBeenCalled()
    expect(b.db.ml_escritas_adiadas[0].proxima_em).toBe(min(1))
  })

  it('item livre → enfileira o job normal (com adiada_id) na fila do dono, sem delay', async () => {
    const b = banco({ ml_escritas_adiadas: [linha()] })
    const d = deps()
    await acordarEscritaAdiada(b.admin, 'ad1', d)
    expect(d.enfileirar).toHaveBeenCalledWith('imp-1', 'https://x/functions/v1/update-familia-ml',
      { familia_id: 'fam1', lote_id: 'lote1', adiada_id: 'ad1' })
    expect(b.db.ml_escritas_adiadas[0].proxima_em).toBe(min(5))
  })

  it('linha assumida por job vivo → nada', async () => {
    const b = banco({ ml_escritas_adiadas: [linha({ posse: 'p', assumida_ate: min(5) })] })
    const d = deps()
    await acordarEscritaAdiada(b.admin, 'ad1', d)
    expect(d.enfileirar).not.toHaveBeenCalled()
    expect(b.db.ml_escritas_adiadas[0].proxima_em).toBe(min(0))
  })

  it.each([['publicado'], ['erro']])('família já %s (queda antes de apagar a linha) → finaliza o lote e apaga, sem erro', async (st) => {
    const b = banco({ ml_escritas_adiadas: [linha()] })
    b.db.familias[0].status = st
    const d = deps()
    await acordarEscritaAdiada(b.admin, 'ad1', d)
    expect(d.enfileirar).not.toHaveBeenCalled()
    expect(b.db.familias[0].status).toBe(st)
    expect(b.db.ml_escritas_adiadas).toEqual([])
  })

  it('240 min → família erro (item_reservado_galeria), lote finalizado, linha apagada, variacoes intactas', async () => {
    const b = banco({ ml_escritas_adiadas: [linha({ adiado_desde: min(-240) })], ml_item_travas: [{ org_id: 'org1', item_id: 'MLB1', dono_tipo: 'galeria', expira_em: null }] })
    await acordarEscritaAdiada(b.admin, 'ad1', deps())
    expect(b.db.familias[0]).toMatchObject({ status: 'erro', erro_mensagem: 'item_reservado_galeria' })
    expect(b.db.lotes[0].status).not.toBe('processando')
    expect(b.db.ml_escritas_adiadas).toEqual([])
    expect(b.db.variacoes[0].ml_picture_id).toBe('PIC-1')
  })
})

describe('controleTrava (soltura só com resposta definitiva)', () => {
  const montar = () => {
    const b = banco()
    b.respostasRpc.ml_estender_trava = () => true
    return { b, t: controleTrava(b.admin, 'org1', ['MLB1'], 'dono-1') }
  }
  const soltou = (b: ReturnType<typeof banco>) => b.rpcs.some((r) => r.nome === 'ml_soltar_itens')

  it('antesDoPut estende por 900 s (nunca encurta: greatest no SQL)', async () => {
    const { b, t } = montar()
    expect(await t.antesDoPut()).toBe(true)
    expect(b.rpcs[0]).toEqual({ nome: 'ml_estender_trava', args: { p_org: 'org1', p_itens: ['MLB1'], p_dono: 'dono-1', p_seg: QUARENTENA_PUT_S } })
    expect(QUARENTENA_PUT_S).toBe(900)
  })

  it('extensão recusada → false (o conector não envia o PUT)', async () => {
    const b = banco()
    b.respostasRpc.ml_estender_trava = () => false
    expect(await controleTrava(b.admin, 'org1', ['MLB1'], 'd').antesDoPut()).toBe(false)
  })

  it('PUT sem resposta (timeout) ou 5xx → trava mantida; 4xx definitivo → solta; 2xx → solta', async () => {
    for (const [r, esperado] of [[{ ok: false }, false], [{ ok: false, status: 502 }, false], [{ ok: false, status: 400 }, true], [{ ok: true }, true]] as const) {
      const { b, t } = montar()
      await t.antesDoPut()
      await t.resolver(r)
      expect(soltou(b)).toBe(esperado)
    }
  })

  it('nenhum PUT saiu (erro antes, ex.: GET 5xx) → solta; exceção depois do PUT → mantém', async () => {
    const { b, t } = montar()
    await t.resolver({ ok: false, status: 503 })
    expect(soltou(b)).toBe(true)
    const m = montar()
    await m.t.antesDoPut()
    await m.t.abandonar()
    expect(soltou(m.b)).toBe(false)
  })
})
