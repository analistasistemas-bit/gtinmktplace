// ADR-0201 Task 14 — saga de aplicar e reverter (worker por fase), sem rede. O banco é o fake em memória com as RPCs da
// saga espelhadas (assumir, concluir com aborto atômico, manter/agregar); o ML é um fake com estado por item. O "tick"
// faz o que o despachante faz: ação de nível da aplicação + uma mensagem por item acionável.
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeAdmin, JPEG } from './fake-admin'
import { createHash } from 'node:crypto'
import type { ItemElegibilidade } from '../alvos'
import type { CorpoFotosML } from '../../ml/atualizar-item'
import { decidirReconciliacao, executarItem, passoSaga, type AplicacaoSaga, type ItemSaga, type PortasML } from '../saga'

type Linha = Record<string, unknown>
const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const T0 = Date.parse('2026-11-10T12:00:00.000Z')
let agora = T0
const em = (min: number) => new Date(T0 + min * 60_000).toISOString()
const avancar = (min: number) => { agora += min * 60_000 }
const iso = (t = agora) => new Date(t).toISOString()

// ── ML fake ────────────────────────────────────────────────────────────────────────────────────────────────────
type ComportamentoPut = 'ok' | '400' | '502_aplicado' | 'timeout_aplicado' | 'timeout_nada' | 'atrasado' | 'ignorado'
class MLFake implements PortasML {
  itens = new Map<string, ItemElegibilidade>()
  uploads: string[] = []
  puts: Array<{ itemId: string; corpo: CorpoFotosML }> = []
  gets = 0
  indisponivel = new Set<string>()
  /** GET fica indisponível logo depois de um PUT efetivado neste item. */
  indisponivelAposPut = new Set<string>()
  put = new Map<string, ComportamentoPut>()
  prontaAoSubir = true
  prontas = new Set<string>()
  falhaUpload: 'nenhuma' | 'timeout' | '400' = 'nenhuma'
  pendentes: Array<{ itemId: string; corpo: CorpoFotosML; em: number }> = []
  private n = 0

  item(id: string, pictures: string[], variacoes: Array<{ id: number; sku: string; pictureIds: string[] }> = []) {
    this.itens.set(id, { id, catalogListing: false, tags: [], sku: variacoes.length ? null : 'SKU-' + id, pictures, variacoes })
  }
  async lerItem(_t: string, id: string) {
    this.gets++
    for (const p of this.pendentes.filter((x) => x.itemId === id && x.em <= agora)) this.aplicar(p.itemId, p.corpo)
    this.pendentes = this.pendentes.filter((x) => !(x.itemId === id && x.em <= agora))
    if (this.indisponivel.has(id)) return null
    const i = this.itens.get(id)!
    return structuredClone(i)
  }
  async subir() {
    if (this.falhaUpload === 'timeout') throw new DOMException('timeout', 'TimeoutError')
    if (this.falhaUpload === '400') throw Object.assign(new Error('400'), { status: 400 })
    const id = `UP${++this.n}`
    this.uploads.push(id)
    if (this.prontaAoSubir) this.prontas.add(id)
    return { id, pronta: this.prontaAoSubir }
  }
  async lerFotoPronta(_t: string, id: string) { return this.prontas.has(id) }
  aplicar(itemId: string, corpo: CorpoFotosML) {
    const i = this.itens.get(itemId)!
    i.pictures = corpo.pictures.map((p) => p.id)
    for (const v of corpo.variations ?? []) i.variacoes.find((x) => x.id === v.id)!.pictureIds = [...v.picture_ids]
  }
  async putFotos(_t: string, itemId: string, corpo: CorpoFotosML) {
    this.puts.push({ itemId, corpo: structuredClone(corpo) })
    const c = this.put.get(itemId) ?? 'ok'
    if (c === '400') throw Object.assign(new Error('recusado'), { status: 400 })
    if (c === 'timeout_nada') throw new DOMException('timeout', 'TimeoutError')
    if (c === 'ignorado') return
    if (c === 'atrasado') { this.pendentes.push({ itemId, corpo, em: agora + 12 * 60_000 }); return }
    this.aplicar(itemId, corpo)
    if (this.indisponivelAposPut.has(itemId)) this.indisponivel.add(itemId)
    if (c === '502_aplicado') throw Object.assign(new Error('bad gateway'), { status: 502 })
    if (c === 'timeout_aplicado') throw new DOMException('timeout', 'TimeoutError')
  }
}

// ── Banco fake com as RPCs da saga ─────────────────────────────────────────────────────────────────────────────
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let ml: MLFake
const EXEC = ['em_andamento', 'abortando', 'revertendo']
const ABERTOS = ['pendente', 'subindo', 'aplicando', 'compensando']
const aplicacao = () => db.galeria_aplicacoes[0]
const itemDe = (mlb: string) => db.galeria_aplicacao_itens.find((i) => i.item_id === mlb)!

function agregar(aid: string): string {
  const a = db.galeria_aplicacoes.find((x) => x.id === aid)!
  if (!EXEC.includes(a.status as string)) return a.status as string
  const term = a.status === 'em_andamento' ? ['aplicado', 'falhou', 'pulado', 'reversao_incompleta'] : ['compensado', 'falhou', 'pulado', 'reversao_incompleta']
  const its = db.galeria_aplicacao_itens.filter((i) => i.aplicacao_id === aid)
  if (its.some((i) => !term.includes(i.status as string))) return a.status as string
  a.status = its.some((i) => i.status === 'reversao_incompleta') ? 'reversao_incompleta'
    : a.status === 'em_andamento' && its.every((i) => i.status === 'aplicado') ? 'aplicada'
    : its.some((i) => i.status === 'compensado') ? 'revertida' : 'falhou'
  db.ml_item_travas = db.ml_item_travas.filter((t) => t.dono_id !== aid)
  return a.status as string
}
const compensarAplicados = (aid: string) => db.galeria_aplicacao_itens.filter((i) => i.aplicacao_id === aid && i.status === 'aplicado')
  .forEach((i) => Object.assign(i, { status: 'compensando', compensar_ate: iso(agora + 60 * 60_000), publicado_em: null }))
function instalarRpcs() {
  fake.respostasRpc.galeria_assumir_item = ({ p_item, p_fase, p_posse, p_lease_seg }) => {
    const i = db.galeria_aplicacao_itens.find((x) => x.id === p_item)
    const a = i && db.galeria_aplicacoes.find((x) => x.id === i.aplicacao_id)
    if (!i || !a || i.fase !== p_fase || !ABERTOS.includes(i.status as string)) return []
    if (i.lease_ate && Date.parse(i.lease_ate as string) >= agora) return []
    if (!EXEC.includes(a.status as string) || !(Date.parse(a.ciclo_ate as string) > agora)) return []
    Object.assign(i, { posse: p_posse, lease_ate: iso(agora + (p_lease_seg as number) * 1000) })
    return [structuredClone(i)]
  }
  fake.respostasRpc.galeria_concluir_item = ({ p_item, p_posse, p_status, p_dados }) => {
    const i = db.galeria_aplicacao_itens.find((x) => x.id === p_item)!
    const a = db.galeria_aplicacoes.find((x) => x.id === i.aplicacao_id)!
    if (i.posse !== p_posse) return a.status
    const d = (p_dados ?? {}) as Linha
    Object.assign(i, { status: p_status, posse: null, lease_ate: null, publicado_em: null,
      ...('fotos_depois' in d ? { fotos_depois: d.fotos_depois } : {}), ...('erro' in d ? { erro: d.erro } : {}) })
    if (a.status === 'em_andamento' && (['falhou', 'reversao_incompleta'].includes(p_status as string) || d.abortar === true)) {
      Object.assign(a, { status: 'abortando', abortar_em: a.abortar_em ?? iso() })
      db.galeria_aplicacao_itens.filter((x) => x.aplicacao_id === a.id && ['pendente', 'subindo'].includes(x.status as string))
        .forEach((x) => Object.assign(x, { status: 'pulado', erro: x.erro ?? 'abortada', posse: null, lease_ate: null }))
      compensarAplicados(a.id as string)
    }
    return agregar(a.id as string)
  }
}
/** = galeria_manter_aplicacao + galeria_iniciar_reversao (espelhos do SQL, testados nos testes SQL das Tasks 2/8/14). */
function manter() {
  const a = aplicacao()
  if (!EXEC.includes(a.status as string)) return
  if (a.status === 'em_andamento' && Date.parse(a.prazo_ate as string) < agora) {
    Object.assign(a, { status: 'abortando', abortar_em: a.abortar_em ?? iso() })
    db.galeria_aplicacao_itens.filter((x) => ['pendente', 'subindo'].includes(x.status as string) && !(x.lease_ate && Date.parse(x.lease_ate as string) >= agora))
      .forEach((x) => Object.assign(x, { status: 'pulado', erro: 'prazo_vencido' }))
  }
  if (a.status !== 'em_andamento') compensarAplicados(a.id as string)
  agregar(a.id as string)
}
function iniciarReversao() {
  const a = aplicacao()
  expect(a.status).toBe('aplicada')
  Object.assign(a, { status: 'revertendo', ciclo_ate: iso(agora + 3 * 3600_000) })
  for (const i of db.galeria_aplicacao_itens) db.ml_item_travas.push({ org_id: 'org', item_id: i.item_id, dono_tipo: 'galeria', dono_id: a.id, expira_em: null })
  compensarAplicados(a.id as string)
}

let vigente = 'fam'
const deps = () => ({ agora: () => new Date(agora), token: async () => 'tok', ml, familiaVigente: async () => vigente })
/** Um tick do despachante: ação da aplicação + uma mensagem por item acionável (na ordem dos itens). */
async function tick(min = 1) {
  avancar(min)
  manter()
  for (const i of [...db.galeria_aplicacao_itens]) {
    const atual = db.galeria_aplicacao_itens.find((x) => x.id === i.id)!
    if (!ABERTOS.includes(atual.status as string)) continue
    await executarItem(fake.admin as never, { id: atual.id as string, fase: atual.fase as number }, deps())
  }
}
async function ticks(n: number, min = 1) { for (let k = 0; k < n; k++) await tick(min) }

// ── Cenário ────────────────────────────────────────────────────────────────────────────────────────────────────
// Cada item (P, M, G) tem a Rosa (cor-alvo, var 1) e a Azul (var 2). O manifesto tem `n` fotos (missões 1..n).
const ALVO = (mlb: string) => [{ sku: `R-${mlb}`, variationId: 1 }]
function montar(mlbs: string[], n = 1, opts: { plano?: boolean; status?: string } = {}) {
  agora = T0
  vigente = 'fam'
  ml = new MLFake()
  const arquivos = new Map<string, Uint8Array>()
  const imagens: Linha[] = []
  const manifesto = Array.from({ length: n }, (_, k) => {
    const bytes = JPEG(`final-${k + 1}`)
    arquivos.set(`org/galeria-ia/fam/finais/img${k + 1}.jpg`, bytes)
    imagens.push({ id: `img${k + 1}`, org_id: 'org', final_path: `org/galeria-ia/fam/finais/img${k + 1}.jpg`, final_sha256: sha256Hex(bytes) })
    return { imagem_id: `img${k + 1}`, missao: k + 1, final_sha256: sha256Hex(bytes) }
  })
  const retrato: Record<string, Linha> = {}
  const itens: Linha[] = mlbs.map((mlb) => {
    if (opts.plano) ml.item(mlb, [`F-${mlb}`])
    else ml.item(mlb, [`R0-${mlb}`, `A0-${mlb}`], [{ id: 1, sku: `R-${mlb}`, pictureIds: [`R0-${mlb}`] }, { id: 2, sku: `A-${mlb}`, pictureIds: [`A0-${mlb}`] }])
    const i = ml.itens.get(mlb)!
    retrato[mlb] = structuredClone({ pictures: i.pictures, variacoes: i.variacoes })
    const alvo = opts.plano ? [{ sku: `R-${mlb}`, variationId: null }] : ALVO(mlb)
    return {
      id: `it-${mlb}`, org_id: 'org', anuncio_externo_id: 'an1', aplicacao_id: 'apl1', item_id: mlb, status: 'pendente', fase: 0,
      despacho_seq: 0, posse: null, lease_ate: null, publicado_em: null, put_em: null, compensar_ate: null,
      variacoes_alvo: alvo, fotos_antes: { [`R-${mlb}`]: opts.plano ? [`F-${mlb}`] : [`R0-${mlb}`] },
      fotos_novas: manifesto.map((m) => ({ ...m, upload_id: null, pronta: false })), fotos_depois: null,
      corpo_planejado: null, base_esperada: null, destino: null, erro: null,
    }
  })
  db = {
    galeria_aplicacoes: [{ id: 'apl1', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'fam', status: opts.status ?? 'em_andamento',
      modo: 'substituir', roteiro_id: 'rot1', fatos_hash: 'h1', prazo_ate: em(30), ciclo_ate: em(180), abortar_em: null, retrato, manifesto }],
    galeria_aplicacao_itens: itens,
    galeria_roteiros: [{ id: 'rot1', status: 'aprovado', fatos_hash: 'h1' }],
    galeria_imagens: imagens,
    galeria_imagem_itens: [],
    ml_item_travas: (opts.status ?? 'em_andamento') === 'preparada' ? []
      : mlbs.map((mlb) => ({ org_id: 'org', item_id: mlb, dono_tipo: 'galeria', dono_id: 'apl1', expira_em: null })),
  }
  fake = fakeAdmin(db, arquivos)
  instalarRpcs()
}
const putsDe = (mlb: string) => ml.puts.filter((p) => p.itemId === mlb)
const corRosa = (mlb: string) => ml.itens.get(mlb)!.variacoes.find((v) => v.id === 1)?.pictureIds ?? ml.itens.get(mlb)!.pictures

beforeEach(() => montar(['P']))

describe('saga — caminho feliz', () => {
  it('UP P/M/G com 2 fotos: upload foto a foto, PUT com todas prontas, aplicado com fotos_depois do GET e travas soltas', async () => {
    montar(['P', 'M', 'G'], 2)
    await ticks(3)
    expect(db.galeria_aplicacao_itens.map((i) => i.status)).toEqual(['aplicado', 'aplicado', 'aplicado'])
    expect(aplicacao().status).toBe('aplicada')
    expect(db.ml_item_travas).toEqual([])
    expect(ml.uploads).toHaveLength(6)
    for (const mlb of ['P', 'M', 'G']) {
      expect(putsDe(mlb)).toHaveLength(1)
      expect(itemDe(mlb).fotos_depois).toEqual({ [`R-${mlb}`]: corRosa(mlb) })
      // Azul preservada no corpo (todas as variações vão; o ML apaga a omitida); nada de preço/status/estoque.
      expect(putsDe(mlb)[0].corpo.variations?.find((v) => v.id === 2)?.picture_ids).toEqual([`A0-${mlb}`])
      expect(JSON.stringify(putsDe(mlb)[0].corpo)).not.toMatch(/price|status|available_quantity/)
    }
    // Um registro por imagem e por item, com o id lido no GET (P/M/G com ids distintos).
    expect(db.galeria_imagem_itens).toHaveLength(6)
    // A próxima referência exclui os três: carregarFotosAplicadas filtra por org + anúncio + picture_id.
    expect(db.galeria_imagem_itens.every((r) => r.org_id === 'org' && r.anuncio_externo_id === 'an1' && r.picture_id)).toBe(true)
    const img1 = db.galeria_imagem_itens.filter((r) => r.imagem_id === 'img1')
    expect(new Set(img1.map((r) => r.picture_id)).size).toBe(3)
    for (const r of db.galeria_imagem_itens) expect(Object.values(itemDe(r.item_id as string).fotos_depois as Linha).flat()).toContain(r.picture_id)
  })

  it('fotos_depois guarda os ids do GET de conferência (o que o item exibe), não a lista planejada', async () => {
    await ticks(2)
    const lido = corRosa('P')
    expect(itemDe('P').fotos_depois).toEqual({ 'R-P': lido })
    expect(db.galeria_imagem_itens[0]).toMatchObject({ upload_id: 'UP1', picture_id: 'UP1', item_id: 'P', aplicacao_id: 'apl1' })
  })

  it('item plano (UP): corpo só { pictures }', async () => {
    montar(['P'], 1, { plano: true })
    await ticks(2)
    expect(itemDe('P').status).toBe('aplicado')
    expect(Object.keys(putsDe('P')[0].corpo)).toEqual(['pictures'])
  })

  it('foto pronta:false no 1º minuto → nenhuma re-subida, nenhum PUT até ficar pronta', async () => {
    ml.prontaAoSubir = false
    await ticks(4)
    expect(ml.uploads).toEqual(['UP1'])
    expect(ml.puts).toEqual([])
    expect(itemDe('P').status).toBe('subindo')
    ml.prontas.add('UP1')
    await ticks(2)
    expect(ml.uploads).toEqual(['UP1'])
    expect(itemDe('P').status).toBe('aplicado')
  })

  it('aplicação preparada com o despachante rodando → nenhum upload nem PUT', async () => {
    montar(['P'], 1, { status: 'preparada' })
    for (let k = 0; k < 5; k++) {
      avancar(1)
      expect(await executarItem(fake.admin as never, { id: 'it-P', fase: 0 }, deps())).toBe('ocupado')
    }
    expect(ml.uploads).toEqual([])
    expect(ml.puts).toEqual([])
  })

  it('mensagem de fase velha → ocupado, sem efeito', async () => {
    await tick()
    expect(await executarItem(fake.admin as never, { id: 'it-P', fase: 0 }, deps())).toBe('ocupado')
    expect(ml.uploads).toHaveLength(1)
  })

  it('estoque mexido no ML durante a saga não entra no PUT de fotos (corpo nunca leva quantidade)', async () => {
    await tick()
    ;(ml.itens.get('P') as unknown as Linha).available_quantity = 0
    await tick()
    expect((ml.itens.get('P') as unknown as Linha).available_quantity).toBe(0)
    expect(JSON.stringify(ml.puts[0].corpo)).not.toContain('available_quantity')
  })
})

describe('saga — falhas na ida, aborto e compensação', () => {
  it('PUT do M recusado (4xx) → G pulado sem PUT, P compensado com a Azul preservada no corpo', async () => {
    montar(['P', 'M', 'G'])
    ml.put.set('M', '400')
    await ticks(2)
    expect(itemDe('M')).toMatchObject({ status: 'falhou', erro: 'put_recusado_400' })
    expect(itemDe('G').status).toBe('pulado')
    expect(putsDe('G')).toEqual([])
    expect(aplicacao()).toMatchObject({ status: 'abortando' })
    expect(aplicacao().abortar_em).not.toBeNull()
    expect(itemDe('P').status).toBe('compensando')
    await tick()
    expect(itemDe('P').status).toBe('compensado')
    const volta = putsDe('P')[1].corpo
    expect(volta.variations).toEqual([{ id: 1, picture_ids: ['R0-P'] }, { id: 2, picture_ids: ['A0-P'] }])
    expect(volta.pictures.map((p) => p.id)).toEqual(['R0-P', 'A0-P'])
    expect(aplicacao().status).toBe('revertida')
    expect(db.ml_item_travas).toEqual([])
  })

  it('P aplicado, M com PUT incerto e fotos divergentes na reconciliação → M reversao_incompleta (divergência preservada), G pulado, P compensado, final reversao_incompleta', async () => {
    montar(['P', 'M', 'G'])
    ml.put.set('M', 'timeout_nada')
    ml.put.set('G', 'timeout_nada')
    await tick()   // uploads
    // G ainda não fez PUT neste tick: ordem P, M, G — mas G também está pronto. Segura G com lease para ele não chegar ao PUT.
    itemDe('G').lease_ate = em(10)
    await tick()   // P aplicado; M PUT incerto → aplicando
    expect(itemDe('P').status).toBe('aplicado')
    expect(itemDe('M').status).toBe('aplicando')
    ml.itens.get('M')!.variacoes[0].pictureIds = ['OUTRA']   // alguém mexeu
    await tick()
    expect(itemDe('M')).toMatchObject({ status: 'reversao_incompleta', erro: 'fotos_divergentes' })
    expect(ml.itens.get('M')!.variacoes[0].pictureIds).toEqual(['OUTRA'])
    expect(aplicacao().status).toBe('abortando')
    expect(itemDe('G').status).toBe('pulado')
    expect(putsDe('G')).toEqual([])
    await tick()
    expect(itemDe('P').status).toBe('compensado')
    expect(aplicacao().status).toBe('reversao_incompleta')
    expect(db.ml_item_travas).toEqual([])
  })

  it('queda entre marcar a falha e enfileirar → o despachante encontra compensando e executa', async () => {
    montar(['P', 'M'])
    ml.put.set('M', '400')
    await ticks(2)
    expect(itemDe('P')).toMatchObject({ status: 'compensando', publicado_em: null, posse: null })
    await tick()
    expect(itemDe('P').status).toBe('compensado')
  })

  it('sha dos bytes ≠ manifesto → falha sem upload nem PUT', async () => {
    db.galeria_aplicacao_itens[0].fotos_novas = [{ imagem_id: 'img1', missao: 1, final_sha256: 'outro', upload_id: null, pronta: false }]
    await tick()
    expect(itemDe('P')).toMatchObject({ status: 'falhou', erro: 'sha_divergente' })
    expect(ml.uploads).toEqual([])
    expect(ml.puts).toEqual([])
  })

  it('upload sem resposta (timeout) → falhou como incerto; a marca `enviando` impede re-subir depois de uma queda', async () => {
    ml.falhaUpload = 'timeout'
    await tick()
    expect(itemDe('P')).toMatchObject({ status: 'falhou', erro: 'upload_incerto' })
    // Queda entre o POST e a gravação do id: marca presente, id ausente → falhou, sem novo POST.
    montar(['P'])
    const f = (itemDe('P').fotos_novas as Linha[])[0]
    f.enviando = true
    itemDe('P').status = 'subindo'
    await tick()
    expect(itemDe('P')).toMatchObject({ status: 'falhou', erro: 'upload_incerto' })
    expect(ml.uploads).toEqual([])
  })

  it.each([['item com variações', false], ['item plano', true]])('foto trocada no ML entre preparar e PUT (%s) → zero PUT, aborta e compensa os anteriores', async (_n, plano) => {
    montar(['P', 'M'], 1, { plano })
    await tick()
    itemDe('M').lease_ate = em(2)   // M fica para depois de P
    await tick()
    expect(itemDe('P').status).toBe('aplicado')
    if (plano) ml.itens.get('M')!.pictures = ['TROCADA']
    else ml.itens.get('M')!.variacoes[1].pictureIds = ['A-TROCADA']
    await tick(2)
    expect(itemDe('M').status).toBe('falhou')
    expect(String(itemDe('M').erro)).toMatch(/^mudou:/)
    expect(putsDe('M')).toEqual([])
    await tick()
    expect(itemDe('P').status).toBe('compensado')
  })

  it('roteiro aprovado de novo entre confirmar e o PUT do 2º item → 2º pulado, 1º compensado', async () => {
    montar(['P', 'M'])
    await tick()
    itemDe('M').lease_ate = em(2)
    await tick()
    db.galeria_roteiros[0].status = 'desatualizado'
    await tick(2)
    expect(itemDe('M')).toMatchObject({ status: 'pulado', erro: 'roteiro_trocado' })
    expect(putsDe('M')).toEqual([])
    expect(aplicacao().status).toBe('abortando')
    await tick()
    expect(itemDe('P').status).toBe('compensado')
    expect(aplicacao().status).toBe('revertida')
  })

  it('família vigente do anúncio troca entre o upload e o PUT do 2º item (UPDATE dispensado da trava) → 2º pulado sem PUT, 1º compensado', async () => {
    montar(['P', 'M'])
    await tick()
    itemDe('M').lease_ate = em(2)
    await tick()
    expect(itemDe('P').status).toBe('aplicado')
    vigente = 'famB'
    await tick(2)
    expect(itemDe('M')).toMatchObject({ status: 'pulado', erro: 'familia_nao_vigente' })
    expect(putsDe('M')).toEqual([])
    expect(aplicacao().status).toBe('abortando')
    await tick()
    expect(itemDe('P').status).toBe('compensado')
  })

  it('prazo_ate vencido → aborta e compensa (sem PUT de ida novo)', async () => {
    montar(['P', 'M'])
    await tick()
    itemDe('M').lease_ate = em(40)
    await tick()
    agora = T0 + 31 * 60_000
    itemDe('M').lease_ate = null
    await tick()   // manter: abortando + M pulado + P compensando; o worker compensa P no mesmo tick
    expect(aplicacao().abortar_em).not.toBeNull()
    expect(itemDe('M')).toMatchObject({ status: 'pulado', erro: 'prazo_vencido' })
    expect(itemDe('P').status).toBe('compensado')
    expect(aplicacao().status).toBe('revertida')
    expect(putsDe('M')).toEqual([])
  })
})

describe('saga — PUT incerto e reconciliação', () => {
  it('queda depois do PUT (timeout) com GET mostrando as fotos novas → aplicado sem novo PUT', async () => {
    ml.put.set('P', 'timeout_aplicado')
    await ticks(2)
    expect(itemDe('P').status).toBe('aplicando')
    await tick()
    expect(itemDe('P').status).toBe('aplicado')
    expect(ml.puts).toHaveLength(1)
  })

  it('PUT de ida efetivado seguido de HTTP 502 → continua aplicando (nunca falhou) e a reconciliação conclui', async () => {
    ml.put.set('P', '502_aplicado')
    await ticks(2)
    expect(itemDe('P').status).toBe('aplicando')
    await tick()
    expect(itemDe('P').status).toBe('aplicado')
    expect(ml.puts).toHaveLength(1)
  })

  it('PUT efetivado + GET indisponível + reinício → continua aplicando; a reconciliação seguinte conclui sem novo PUT', async () => {
    ml.indisponivelAposPut.add('P')
    await ticks(2)
    expect(ml.puts).toHaveLength(1)
    expect(itemDe('P').status).toBe('aplicando')
    await tick()
    expect(itemDe('P').status).toBe('aplicando')
    ml.indisponivel.delete('P')
    await tick()
    expect(itemDe('P').status).toBe('aplicado')
    expect(ml.puts).toHaveLength(1)
  })

  it('GET logo após o PUT ainda igual a fotos_antes → espera sem refazer até 10 min; depois refaz', async () => {
    ml.put.set('P', 'ignorado')
    await ticks(2)
    expect(itemDe('P').status).toBe('aplicando')
    await ticks(8)
    expect(ml.puts).toHaveLength(1)
    await ticks(2)
    expect(ml.puts).toHaveLength(2)
  })

  it('PUT de ida incerto e aplicação passada a abortando: GET = destino → aplicado e compensa; nenhum PUT de ida novo', async () => {
    montar(['P', 'M'])
    ml.put.set('P', 'timeout_aplicado')
    ml.put.set('M', '400')
    await ticks(2)
    expect(itemDe('P').status).toBe('aplicando')
    expect(aplicacao().status).toBe('abortando')
    await tick()
    expect(itemDe('P').status).toBe('aplicado')
    await ticks(2)   // manter → compensando; o PUT de volta também fica incerto e a reconciliação conclui
    expect(itemDe('P').status).toBe('compensado')
    expect(putsDe('P').map((p) => p.corpo.variations?.[0].picture_ids)).toEqual([['UP1'], ['R0-P']])
  })

  it('PUT de ida incerto sem efeito e aplicação abortando: GET = base depois de 10 min → pulado, sem PUT', async () => {
    montar(['P', 'M'])
    ml.put.set('P', 'timeout_nada')
    ml.put.set('M', '400')
    await ticks(2)
    expect(aplicacao().status).toBe('abortando')
    await ticks(8)
    expect(itemDe('P').status).toBe('aplicando')
    await ticks(3)
    expect(itemDe('P')).toMatchObject({ status: 'pulado', erro: 'put_incerto_sem_efeito' })
    expect(putsDe('P')).toHaveLength(1)
    expect(aplicacao().status).toBe('falhou')
  })

  it('GET indisponível por 31 min em aplicando → reversao_incompleta e trava solta', async () => {
    ml.put.set('P', 'timeout_aplicado')
    await ticks(2)
    ml.indisponivel.add('P')
    await ticks(30)
    expect(itemDe('P').status).toBe('aplicando')
    await ticks(2)
    expect(itemDe('P')).toMatchObject({ status: 'reversao_incompleta', erro: 'get_indisponivel' })
    expect(db.ml_item_travas).toEqual([])
  })
})

describe('saga — reversão', () => {
  async function aplicado(mlbs = ['P']) {
    montar(mlbs)
    await ticks(2)
    expect(aplicacao().status).toBe('aplicada')
  }

  it('reverter 3 dias depois (queda antes de qualquer job) → o despachante executa as compensações', async () => {
    await aplicado(['P', 'M'])
    agora += 3 * 24 * 3600_000
    db.galeria_roteiros[0].status = 'desatualizado'   // roteiro novo depois: a compensação não passa pelo portão de avanço
    iniciarReversao()
    await tick()
    expect(db.galeria_aplicacao_itens.map((i) => i.status)).toEqual(['compensado', 'compensado'])
    expect(aplicacao().status).toBe('revertida')
    expect(corRosa('P')).toEqual(['R0-P'])
  })

  it('compensação com fotos atuais ≠ fotos_depois → reversao_incompleta sem PUT', async () => {
    await aplicado()
    ml.itens.get('P')!.variacoes[0].pictureIds = ['MEXIDA']
    iniciarReversao()
    await tick()
    expect(itemDe('P')).toMatchObject({ status: 'reversao_incompleta', erro: 'fotos_divergentes' })
    expect(ml.puts).toHaveLength(1)
  })

  it('compensação sem efeito (GET = fotos_depois) → espera 10 min e refaz, sem cair em reversao_incompleta', async () => {
    await aplicado()
    iniciarReversao()
    ml.put.set('P', 'ignorado')
    await tick()
    expect(ml.puts).toHaveLength(2)
    await ticks(8)
    expect(ml.puts).toHaveLength(2)
    expect(itemDe('P').status).toBe('compensando')
    ml.put.set('P', 'ok')
    await ticks(3)
    expect(ml.puts).toHaveLength(3)
    expect(itemDe('P').status).toBe('compensado')
  })

  it('PUTs de compensação sem efeito por 61 min desde a entrada → reversao_incompleta (compensar_ate não é renovado)', async () => {
    await aplicado()
    iniciarReversao()
    const prazo = itemDe('P').compensar_ate
    ml.put.set('P', 'ignorado')
    await ticks(62)
    expect(itemDe('P')).toMatchObject({ status: 'reversao_incompleta', erro: 'compensar_ate_vencido' })
    expect(itemDe('P').compensar_ate).toBe(prazo)
    expect(db.ml_item_travas).toEqual([])
  })

  it('GET indisponível por 31 min em compensando → reversao_incompleta', async () => {
    await aplicado()
    iniciarReversao()
    ml.indisponivel.add('P')
    await ticks(30)
    expect(itemDe('P').status).toBe('compensando')
    await ticks(2)
    expect(itemDe('P')).toMatchObject({ status: 'reversao_incompleta', erro: 'get_indisponivel' })
  })

  it('catálogo/migração na volta → retenta no tick seguinte (não vira reversao_incompleta antes de compensar_ate)', async () => {
    await aplicado()
    iniciarReversao()
    ml.itens.get('P')!.tags = ['variations_migration_pending']
    await ticks(3)
    expect(itemDe('P').status).toBe('compensando')
    ml.itens.get('P')!.tags = []
    await tick()
    expect(itemDe('P').status).toBe('compensado')
  })
})

describe('passoSaga e decidirReconciliacao (puros)', () => {
  const apl = (x: Partial<AplicacaoSaga> = {}): AplicacaoSaga => ({ id: 'a', org_id: 'o', status: 'em_andamento', modo: 'substituir',
    roteiro_id: 'r', fatos_hash: 'h', prazo_ate: em(30), abortar_em: null, retrato: {}, ...x })
  const it0 = (x: Partial<ItemSaga> = {}) => ({ id: 'i', status: 'pendente', lease_ate: null, compensar_ate: null,
    fotos_novas: [{ imagem_id: 'g', missao: 1, final_sha256: 's', upload_id: null, pronta: false }], ...x }) as ItemSaga
  const ctx = { agora: new Date(T0), vigente: true, trava: true }

  it('portão de avanço fecha só a ida; a compensação ignora prazo, roteiro e abortar_em', () => {
    expect(passoSaga(it0(), apl(), ctx)).toBe('subir')
    expect(passoSaga(it0(), apl({ abortar_em: em(0) }), ctx)).toBe('pular')
    expect(passoSaga(it0(), apl({ prazo_ate: em(-1) }), ctx)).toBe('pular')
    expect(passoSaga(it0(), apl(), { ...ctx, vigente: false })).toBe('pular')
    const comp = it0({ status: 'compensando', compensar_ate: em(30) })
    expect(passoSaga(comp, apl({ status: 'revertendo', prazo_ate: em(-999), abortar_em: em(-5) }), { ...ctx, vigente: false })).toBe('compensar')
    expect(passoSaga({ ...comp, compensar_ate: em(-1) }, apl({ status: 'abortando' }), ctx)).toBe('marcar_incompleta')
  })

  it('preparada nunca executa; sem trava ninguém escreve; lease vigente = ocupado', () => {
    expect(passoSaga(it0(), apl({ status: 'preparada' }), ctx)).toBe('ignorar')
    expect(passoSaga(it0(), apl(), { ...ctx, trava: false })).toBe('ignorar')
    expect(passoSaga(it0({ lease_ate: em(1) }), apl(), ctx)).toBe('ocupado')
  })

  it('reconciliação: destino → concluir; base dentro de 10 min → esperar; depois → refazer ou pular; outra → incompleta', () => {
    const base = { s: ['A'] }, destino = { s: ['N'] }
    const r = (atual: Record<string, string[]> | null, extra: Partial<Parameters<typeof decidirReconciliacao>[0]> = {}) =>
      decidirReconciliacao({ atual, getOk: atual !== null, base, destino, putEm: em(0), desde: T0, agora: new Date(T0 + 5 * 60_000), podeRefazer: true, ...extra })
    expect(r(destino)).toBe('concluir')
    expect(r(base)).toBe('esperar')
    expect(r(base, { agora: new Date(T0 + 11 * 60_000) })).toBe('refazer')
    expect(r(base, { agora: new Date(T0 + 11 * 60_000), podeRefazer: false })).toBe('pular')
    expect(r({ s: ['X'] })).toBe('incompleta')
    expect(r(null)).toBe('esperar')
    expect(r(null, { agora: new Date(T0 + 31 * 60_000) })).toBe('incompleta')
  })
})
