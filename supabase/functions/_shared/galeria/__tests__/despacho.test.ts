import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from './fake-admin'
import {
  decidirAdiada, despachar, imagemAcionavel, itemAcionavel, LIMITES, selecionarTrabalho, visaoAcionavel, acaoDaAplicacao,
  type LinhaDespacho, type MensagemQStash,
} from '../despacho'

type Linha = Record<string, unknown>
const T0 = Date.parse('2026-11-10T12:00:00Z')
const min = (n: number) => new Date(T0 + n * 60_000).toISOString()

let agora: Date
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let publicados: MensagemQStash[][]
let rejeitar: (m: MensagemQStash) => boolean
let aoPublicar: (msgs: MensagemQStash[]) => void
let enfileirados: Array<{ userId: string; url: string; body: unknown }>

const deps = () => ({
  agora,
  base: 'https://x.supabase.co',
  publicar: vi.fn(async (msgs: MensagemQStash[]) => {
    publicados.push(msgs)
    aoPublicar(msgs)
    return msgs.map((m) => (rejeitar(m) ? { error: 'rejeitada' } : { messageId: `m-${m.deduplicationId}` }))
  }),
  garantirFila: vi.fn(async () => {}),
  enfileirar: vi.fn(async (userId: string, url: string, body: unknown) => { enfileirados.push({ userId, url, body }) }),
})

// Espelho das consultas SQL (o SQL real é provado em supabase/tests/galeria_despacho.sql): só linhas acionáveis,
// cabeça por prazo_ate (nulos por último), cada uma com a sua cota.
// Ações de aplicação sempre antes dos itens (cota de 20 nunca as engole).
const porPrazo = (a: Linha, b: Linha) => (a.tipo === 'aplicacao' ? 0 : 1) - (b.tipo === 'aplicacao' ? 0 : 1)
  || (a.prazo_ate == null ? 1 : 0) - (b.prazo_ate == null ? 1 : 0)
  || String(a.prazo_ate ?? '').localeCompare(String(b.prazo_ate ?? ''))
function instalarConsultas() {
  fake.respostasRpc.galeria_trabalho_pendente = ({ p_limite }) =>
    db.galeria_imagens.filter((l) => imagemAcionavel(l as never, agora)).slice(0, p_limite as number)
  fake.respostasRpc.galeria_visao_pendente = ({ p_limite }) =>
    db.galeria_imagens.filter((l) => visaoAcionavel(l as never, agora)).slice(0, p_limite as number)
  fake.respostasRpc.galeria_trabalho_pendente_aplicacao = ({ p_limite }) => {
    const linhas: Linha[] = []
    for (const a of db.galeria_aplicacoes) {
      const itens = db.galeria_aplicacao_itens.filter((i) => i.aplicacao_id === a.id)
      const fam = db.familias.find((f) => f.id === a.familia_id)
      for (const i of itens) {
        const l = { tipo: 'item', id: i.id, aplicacao_id: a.id, aplicacao_status: a.status, prazo_ate: a.prazo_ate, ciclo_ate: a.ciclo_ate,
          user_id: fam?.user_id ?? null, item_status: i.status, fase: i.fase, despacho_seq: i.despacho_seq, lease_ate: i.lease_ate,
          publicado_em: i.publicado_em, fotos_novas: i.fotos_novas }
        if (itemAcionavel(l as never, agora)) linhas.push(l)
      }
      const terminais = a.status === 'em_andamento' ? ['aplicado', 'falhou', 'pulado', 'reversao_incompleta'] : ['compensado', 'falhou', 'pulado', 'reversao_incompleta']
      const l = { tipo: 'aplicacao', id: a.id, aplicacao_id: a.id, aplicacao_status: a.status, prazo_ate: a.prazo_ate, ciclo_ate: a.ciclo_ate,
        itens_abertos: itens.filter((i) => !terminais.includes(i.status as string)).length,
        itens_aplicados: itens.filter((i) => i.status === 'aplicado').length }
      if (acaoDaAplicacao(l as never, agora)) linhas.push(l)
    }
    return linhas.sort(porPrazo).slice(0, p_limite as number)
  }
  fake.respostasRpc.galeria_escritas_adiadas_pendentes = () =>
    db.ml_escritas_adiadas.filter((e) => Date.parse(e.proxima_em as string) <= agora.getTime()
      && (e.assumida_ate == null || Date.parse(e.assumida_ate as string) < agora.getTime()))
  fake.respostasRpc.galeria_manter_aplicacao = () => 'ok'
}

const imagem = (id: string, extra: Linha = {}): Linha => ({
  id, origem: 'gerador', status: 'pendente', fase: 0, tentativa: 0, despacho_seq: 0, provedor: 'openrouter',
  lease_ate: null, cena_path: null, alertas: null, criado_em: min(-10), ...extra,
})
const aplicacao = (id: string, extra: Linha = {}): Linha => ({
  id, familia_id: 'fam', status: 'em_andamento', prazo_ate: min(30), ciclo_ate: min(180), ...extra,
})
const item = (id: string, aplicacao_id: string, extra: Linha = {}): Linha => ({
  id, aplicacao_id, status: 'pendente', fase: 0, despacho_seq: 0, lease_ate: null, publicado_em: null, fotos_novas: null, ...extra,
})

beforeEach(() => {
  agora = new Date(T0)
  db = { galeria_imagens: [], galeria_aplicacoes: [], galeria_aplicacao_itens: [], familias: [{ id: 'fam', user_id: 'u1', status: 'publicando', lote_id: 'lote1' }],
    ml_escritas_adiadas: [], ml_item_travas: [], lotes: [{ id: 'lote1', status: 'processando' }] }
  fake = fakeAdmin(db)
  instalarConsultas()
  publicados = []
  enfileirados = []
  rejeitar = () => false
  aoPublicar = () => {}
})

const msgs = () => publicados.flat()
const rodar = () => despachar(fake.admin as never, deps())

describe('selecionarTrabalho (puro)', () => {
  const linhaImg = (extra: Linha): LinhaDespacho => ({ fonte: 'imagem', ...imagem('i1'), ...extra }) as never

  it('gerando com lease nulo (queda entre gravar estado e publicar) → consultar', () => {
    expect(selecionarTrabalho([linhaImg({ status: 'gerando', provedor: 'higgsfield' })], agora, LIMITES))
      .toMatchObject([{ tipo: 'imagem', id: 'i1', acao: 'consultar' }])
  })

  it('pendente com lease vencido (queda logo após o claim) é selecionada; lease vigente não', () => {
    expect(selecionarTrabalho([linhaImg({ lease_ate: min(-1) })], agora, LIMITES)).toMatchObject([{ acao: 'submeter' }])
    expect(selecionarTrabalho([linhaImg({ lease_ate: min(1) })], agora, LIMITES)).toEqual([])
  })

  it('imagem da visão → alertar; terminal fora da visão → nada', () => {
    expect(selecionarTrabalho([{ ...linhaImg({ status: 'gerada', cena_path: 'c.jpg' }), fonte: 'visao' } as never], agora, LIMITES))
      .toMatchObject([{ acao: 'alertar' }])
    expect(selecionarTrabalho([linhaImg({ status: 'gerada', cena_path: 'c.jpg', alertas: [] })], agora, LIMITES)).toEqual([])
  })

  it('item de aplicação preparada nunca; ciclo vencido nunca; publicado há 1 min não, há 4 min sim', () => {
    const it = (extra: Linha) => ({ fonte: 'item', tipo: 'item', id: 'it1', aplicacao_id: 'a1', aplicacao_status: 'em_andamento',
      prazo_ate: min(30), ciclo_ate: min(180), user_id: 'u1', item_status: 'pendente', fase: 0, despacho_seq: 0, lease_ate: null,
      publicado_em: null, fotos_novas: null, ...extra }) as never
    expect(selecionarTrabalho([it({ aplicacao_status: 'preparada' })], agora, LIMITES)).toEqual([])
    expect(selecionarTrabalho([it({ ciclo_ate: min(-1) })], agora, LIMITES)).toEqual([])
    expect(selecionarTrabalho([it({ publicado_em: min(-1) })], agora, LIMITES)).toEqual([])
    expect(selecionarTrabalho([it({ publicado_em: min(-4) })], agora, LIMITES)).toMatchObject([{ tipo: 'aplicacao_item', id: 'it1' }])
    expect(selecionarTrabalho([it({ item_status: 'subindo', fotos_novas: [{ upload_id: 'u', pronta: false }] })], agora, LIMITES))
      .toMatchObject([{ tipo: 'aplicacao_foto' }])
  })

  it('aplicação: prazo vencido → abortar; abortando com aplicado → compensar; todos terminais → agregar', () => {
    const ap = (extra: Linha) => ({ fonte: 'aplicacao', tipo: 'aplicacao', id: 'a1', aplicacao_id: 'a1', aplicacao_status: 'em_andamento',
      prazo_ate: min(30), ciclo_ate: min(180), itens_abertos: 1, itens_aplicados: 0, ...extra }) as never
    expect(selecionarTrabalho([ap({ prazo_ate: min(-1) })], agora, LIMITES)).toMatchObject([{ tipo: 'aplicacao', acao: 'abortar' }])
    expect(selecionarTrabalho([ap({ aplicacao_status: 'abortando', itens_aplicados: 2 })], agora, LIMITES)).toMatchObject([{ acao: 'compensar' }])
    expect(selecionarTrabalho([ap({ aplicacao_status: 'revertendo', itens_abertos: 0 })], agora, LIMITES)).toMatchObject([{ acao: 'agregar' }])
    expect(selecionarTrabalho([ap({ aplicacao_status: 'preparada', itens_abertos: 0 })], agora, LIMITES)).toEqual([])
  })
})

describe('despachar', () => {
  it('60 imagens gerando + 1 compensação atrasada → a compensação sai na primeira execução', async () => {
    for (let n = 0; n < 60; n++) db.galeria_imagens.push(imagem(`g${n}`, { status: 'gerando', provedor: 'higgsfield' }))
    db.galeria_aplicacoes.push(aplicacao('a1', { status: 'abortando', prazo_ate: min(-20) }), aplicacao('a2', { prazo_ate: min(25) }))
    db.galeria_aplicacao_itens.push(item('itA', 'a1', { status: 'compensando' }), item('itB', 'a2'))
    await rodar()
    const ids = msgs().map((m) => (m.body as Linha).id)
    expect(ids).toContain('itA')
    expect(ids.filter((i) => String(i).startsWith('g'))).toHaveLength(50)
    expect(ids.indexOf('itA')).toBeLessThan(ids.indexOf('itB'))
    const itA = msgs().find((m) => (m.body as Linha).id === 'itA')!
    expect(itA).toMatchObject({ queueName: 'publish-ml-u1', retries: 3, url: 'https://x.supabase.co/functions/v1/galeria-aplicar-worker' })
  })

  it('item publicado há 1 min não sai; há 4 min sai; publicação otimista perdida (publicado_em nulo) sai', async () => {
    db.galeria_aplicacoes.push(aplicacao('a1'))
    db.galeria_aplicacao_itens.push(item('it1', 'a1', { publicado_em: min(-1) }), item('it2', 'a1', { publicado_em: min(-4) }), item('it3', 'a1'))
    await rodar()
    expect(msgs().map((m) => (m.body as Linha).id).sort()).toEqual(['it2', 'it3'])
  })

  it('item que concluiu uma fase há 30 s (worker zerou publicado_em) sai na execução seguinte', async () => {
    db.galeria_aplicacoes.push(aplicacao('a1'))
    db.galeria_aplicacao_itens.push(item('it1', 'a1'))
    await rodar()
    const it1 = db.galeria_aplicacao_itens[0]
    expect(it1.publicado_em).toBe(agora.toISOString())
    Object.assign(it1, { fase: 1, publicado_em: null }) // o worker concluiu a fase
    agora = new Date(T0 + 60_000)
    publicados = []
    await rodar()
    expect(msgs().map((m) => (m.body as Linha).id)).toEqual(['it1'])
  })

  it('worker conclui a fase antes de o despachante gravar publicado_em → gravação afeta 0 linhas e o item sai no tick seguinte', async () => {
    db.galeria_aplicacoes.push(aplicacao('a1'))
    db.galeria_aplicacao_itens.push(item('it1', 'a1'))
    aoPublicar = () => Object.assign(db.galeria_aplicacao_itens[0], { fase: 1, publicado_em: null })
    await rodar()
    const gravacao = fake.escritas.filter((e) => e.tabela === 'galeria_aplicacao_itens' && 'publicado_em' in (e.payload as Linha))
    expect(gravacao.map((e) => e.afetadas)).toEqual([0])
    expect(db.galeria_aplicacao_itens[0].publicado_em).toBeNull()
    aoPublicar = () => {}
    agora = new Date(T0 + 60_000)
    publicados = []
    await rodar()
    expect(msgs().map((m) => (m.body as Linha).id)).toEqual(['it1'])
  })

  it('batchJSON com uma mensagem rejeitada → só as aceitas ganham publicado_em', async () => {
    db.galeria_aplicacoes.push(aplicacao('a1'))
    db.galeria_aplicacao_itens.push(item('it1', 'a1'), item('it2', 'a1'))
    rejeitar = (m) => (m.body as Linha).id === 'it2'
    await rodar()
    expect(db.galeria_aplicacao_itens.map((i) => [i.id, i.publicado_em])).toEqual([['it1', agora.toISOString()], ['it2', null]])
  })

  it('batch inteiro falhando → ninguém ganha publicado_em e o despachante não cai', async () => {
    db.galeria_aplicacoes.push(aplicacao('a1'))
    db.galeria_aplicacao_itens.push(item('it1', 'a1'))
    const d = deps()
    d.publicar.mockRejectedValueOnce(new Error('qstash fora'))
    await despachar(fake.admin as never, d)
    expect(db.galeria_aplicacao_itens[0].publicado_em).toBeNull()
  })

  it('5 execuções com aplicação preparada → zero jobs de aplicação', async () => {
    db.galeria_aplicacoes.push(aplicacao('a1', { status: 'preparada', prazo_ate: null, ciclo_ate: null }))
    db.galeria_aplicacao_itens.push(item('it1', 'a1'))
    for (let n = 0; n < 5; n++) { agora = new Date(T0 + n * 60_000); await rodar() }
    expect(msgs()).toEqual([])
    expect(fake.rpcs.filter((r) => r.nome === 'galeria_manter_aplicacao')).toEqual([])
  })

  it('aplicação com prazo vencido → abortar; todos terminais com ela ainda em_andamento/revertendo → agregação (encerra e solta)', async () => {
    db.galeria_aplicacoes.push(aplicacao('a1', { prazo_ate: min(-1) }), aplicacao('a2', { status: 'revertendo' }), aplicacao('a3'))
    db.galeria_aplicacao_itens.push(item('i1', 'a1', { lease_ate: min(1) }), item('i2', 'a2', { status: 'compensado' }), item('i3', 'a3', { status: 'aplicado' }))
    await rodar()
    expect(fake.rpcs.filter((r) => r.nome === 'galeria_manter_aplicacao').map((r) => r.args.p_aplicacao).sort()).toEqual(['a1', 'a2', 'a3'])
  })

  it('21 itens vencidos de 7 sagas (mesmo prazo) → as 7 ações de aplicação saem mesmo com a cota cheia', async () => {
    for (let n = 0; n < 7; n++) {
      db.galeria_aplicacoes.push(aplicacao(`s${n}`, { prazo_ate: min(-5) }))
      for (let k = 0; k < 3; k++) db.galeria_aplicacao_itens.push(item(`s${n}i${k}`, `s${n}`, { status: 'subindo' }))
    }
    // saga com todos os itens terminais (queda antes da agregação), prazo vencido também
    db.galeria_aplicacoes.push(aplicacao('fim', { prazo_ate: min(-5), status: 'revertendo' }))
    db.galeria_aplicacao_itens.push(item('fimI', 'fim', { status: 'compensado' }))
    await rodar()
    expect(fake.rpcs.filter((r) => r.nome === 'galeria_manter_aplicacao').map((r) => r.args.p_aplicacao).sort())
      .toEqual(['fim', 's0', 's1', 's2', 's3', 's4', 's5', 's6'])
  })

  it('aplicação vencida + item pendente livre → aborta e não publica job do item no mesmo tick', async () => {
    db.galeria_aplicacoes.push(aplicacao('a1', { prazo_ate: min(-1) }))
    db.galeria_aplicacao_itens.push(item('i1', 'a1'))
    await rodar()
    expect(fake.rpcs.filter((r) => r.nome === 'galeria_manter_aplicacao').map((r) => r.args.p_aplicacao)).toEqual(['a1'])
    expect(msgs()).toEqual([])
  })

  it('200 gerada (alertas preenchido) + 1 gerando → a gerando sai na primeira execução', async () => {
    for (let n = 0; n < 200; n++) db.galeria_imagens.push(imagem(`ok${n}`, { status: 'gerada', cena_path: 'c.jpg', alertas: [] }))
    db.galeria_imagens.push(imagem('gx', { status: 'gerando', provedor: 'higgsfield' }))
    await rodar()
    expect(msgs().map((m) => (m.body as Linha).id)).toEqual(['gx'])
  })

  it('60 gerada com alertas nulo + 1 gerando Higgsfield → a gerando sai na primeira execução (cotas separadas)', async () => {
    for (let n = 0; n < 60; n++) db.galeria_imagens.push(imagem(`v${n}`, { status: 'gerada', cena_path: 'c.jpg' }))
    db.galeria_imagens.push(imagem('gx', { status: 'gerando', provedor: 'higgsfield' }))
    await rodar()
    const corpos = msgs().map((m) => m.body as Linha)
    expect(corpos.find((b) => b.id === 'gx')).toMatchObject({ acao: 'consultar' })
    expect(corpos.filter((b) => b.acao === 'alertar')).toHaveLength(20)
  })

  it('duas consultas Higgsfield da mesma fase em minutos seguidos → duas chaves de dedup diferentes; submissão paga sem retry', async () => {
    db.galeria_imagens.push(imagem('gx', { status: 'gerando', provedor: 'higgsfield', fase: 2, tentativa: 1 }), imagem('p1'))
    await rodar()
    agora = new Date(T0 + 60_000)
    await rodar()
    const gx = msgs().filter((m) => (m.body as Linha).id === 'gx')
    expect(gx.map((m) => m.deduplicationId)).toEqual(['gx_1', 'gx_2'])
    // QStash recusa o lote inteiro se o id de dedup tiver caractere fora de [A-Za-z0-9_-] (ex.: ':')
    expect(msgs().every((m) => /^[A-Za-z0-9_-]+$/.test(m.deduplicationId ?? ''))).toBe(true)
    expect(gx.every((m) => m.retries === 3 && m.url === 'https://x.supabase.co/functions/v1/galeria-worker' && !('queueName' in m))).toBe(true)
    expect(gx[0].body).toEqual({ tipo: 'imagem', id: 'gx', fase: 2, tentativa: 1, despacho_seq: 1, acao: 'consultar' })
    expect(msgs().find((m) => (m.body as Linha).id === 'p1')).toMatchObject({ retries: 0, body: { acao: 'submeter' } })
  })

  it('despacho_seq mudou entre a consulta e o incremento (outro despachante) → não publica de novo', async () => {
    db.galeria_imagens.push(imagem('p1'))
    fake.respostasRpc.galeria_trabalho_pendente = () => [{ ...db.galeria_imagens[0], despacho_seq: 0 }]
    db.galeria_imagens[0].despacho_seq = 5
    await rodar()
    expect(msgs()).toEqual([])
  })

  it('simulação por ticks de 1 min: Legacy 7 fotos e UP P/M/G 7 fotos cada → todos aplicado em ≤15 ticks', async () => {
    db.galeria_aplicacoes.push(aplicacao('leg'), aplicacao('up'))
    db.galeria_aplicacao_itens.push(item('L', 'leg'), item('P', 'up'), item('M', 'up'), item('G', 'up'))
    // Worker de mentira (contrato das Global Constraints): uma foto por fase; cada fase concluída avança `fase` e zera
    // `publicado_em`; foto fica pronta no tick seguinte ao upload; PUT e conferência são fases próprias.
    const fila: Array<{ id: string; fase: number }> = []
    aoPublicar = (ms) => { for (const m of ms) fila.push(m.body as never) }
    let tick = 0
    const todosAplicados = () => db.galeria_aplicacao_itens.every((i) => i.status === 'aplicado')
    while (!todosAplicados() && tick < 30) {
      tick++
      agora = new Date(T0 + tick * 60_000)
      for (const i of db.galeria_aplicacao_itens) for (const f of (i.fotos_novas as Linha[] | null) ?? []) f.pronta = true
      await rodar()
      for (const job of fila.splice(0)) {
        const i = db.galeria_aplicacao_itens.find((x) => x.id === job.id)!
        if (i.fase !== job.fase) continue
        const fotos = (i.fotos_novas as Linha[] | null) ?? []
        if (fotos.length < 7) Object.assign(i, { status: 'subindo', fotos_novas: [...fotos, { upload_id: `u${fotos.length}`, pronta: false }] })
        else if (fotos.some((f) => !f.pronta)) continue // só solta o lease: publicado_em fica, espera 3 min
        else if (i.status !== 'aplicando') i.status = 'aplicando'
        else i.status = 'aplicado'
        Object.assign(i, { fase: (i.fase as number) + 1, publicado_em: null })
      }
    }
    expect(todosAplicados()).toBe(true)
    expect(tick).toBeLessThanOrEqual(15)
  })
})

describe('escritas adiadas', () => {
  const adiada = (extra: Linha = {}): Linha => ({ id: 'ad1', org_id: 'org', familia_id: 'fam', lote_id: 'lote1', endpoint: 'update-familia-ml',
    itens: ['MLB1'], job: { familia_id: 'fam', lote_id: 'lote1' }, adiado_desde: min(-30), proxima_em: min(-1), assumida_ate: null, posse: null, ...extra })

  it('decidirAdiada: concluída, erro aos 240 min, travado, livre', () => {
    const a = { adiado_desde: min(-30) }
    expect(decidirAdiada(a, agora, 'publicado', false)).toBe('concluida')
    expect(decidirAdiada({ adiado_desde: min(-240) }, agora, 'publicando', false)).toBe('erro')
    expect(decidirAdiada(a, agora, 'publicando', true)).toBe('reagendar')
    expect(decidirAdiada(a, agora, 'publicando', false)).toBe('enfileirar')
  })

  it('proxima_em vencido e item livre → enqueueJSON na fila do dono e proxima_em +5 min', async () => {
    db.ml_escritas_adiadas.push(adiada())
    db.ml_item_travas.push({ org_id: 'org', item_id: 'MLB1', dono_tipo: 'escritor', expira_em: min(-1) }) // vencida
    await rodar()
    // Fila e opções de retry do job normal de publicação (enfileirarJobPublicacaoML em queue.ts).
    expect(enfileirados).toEqual([{ userId: 'u1', url: 'https://x.supabase.co/functions/v1/update-familia-ml',
      body: { familia_id: 'fam', lote_id: 'lote1', adiada_id: 'ad1' } }])
    expect(db.ml_escritas_adiadas[0].proxima_em).toBe(min(5))
  })

  it('item travado → proxima_em +60 s, sem enfileirar', async () => {
    db.ml_escritas_adiadas.push(adiada())
    db.ml_item_travas.push({ org_id: 'org', item_id: 'MLB1', dono_tipo: 'galeria', expira_em: null })
    await rodar()
    expect(enfileirados).toEqual([])
    expect(db.ml_escritas_adiadas[0].proxima_em).toBe(min(1))
  })

  it('240 min desde adiado_desde → família erro (só sobre publicando), lote recalculado, linha apagada', async () => {
    db.ml_escritas_adiadas.push(adiada({ adiado_desde: min(-240) }))
    await rodar()
    expect(enfileirados).toEqual([])
    expect(db.familias[0]).toMatchObject({ status: 'erro', erro_mensagem: 'item_reservado_galeria' })
    expect(db.lotes[0].status).toBe('revisao')
    expect(db.ml_escritas_adiadas).toEqual([])
  })

  it('família já fora de publicando → finaliza o lote e apaga, sem gravar erro', async () => {
    db.familias[0].status = 'publicado'
    db.ml_escritas_adiadas.push(adiada())
    await rodar()
    expect(db.familias[0].status).toBe('publicado')
    expect(db.lotes[0].status).toBe('concluido')
    expect(db.ml_escritas_adiadas).toEqual([])
    expect(enfileirados).toEqual([])
  })
})
