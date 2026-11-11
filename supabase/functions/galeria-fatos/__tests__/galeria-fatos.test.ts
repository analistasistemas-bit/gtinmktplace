import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, JPEG } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as { admin: unknown },
  leitura: {} as Record<string, { legivel: boolean; valor?: string; recorte?: string }>,
  conferir: vi.fn(async (..._a: unknown[]) => false),
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org', isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../_shared/galeria/etiqueta.ts', () => ({
  lerLeituraEtiqueta: vi.fn(async () => f.leitura), conferirEtiqueta: f.conferir,
}))
// Lupa pela caixa do produto: coberta em galeria-fatos-lupa.test.ts.
vi.mock('../../_shared/galeria/detalhes.ts', () => ({ garantirDetalhes: vi.fn(async () => ({})), VERSAO_LEITURA: 'v' }))
// Dicionário da categoria (closed-set): o mesmo formato que a Revisão usa em validarValorAtributo.
vi.mock('../../_shared/categoria/schema.ts', () => ({
  lerSchemaAtributos: vi.fn(async () => [
    { id: 'MAIN_MATERIAL', nome: 'Material', required: false, conditionalRequired: false, valueType: 'list',
      valores: [{ id: '111', nome: 'Poliamida' }, { id: '999', nome: 'Poliéster' }], allowedUnits: [], tags: [] },
    { id: 'PATTERN', nome: 'Estampa', required: false, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [] },
  ]),
}))

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fetchs: string[]
let handler: (req: Request) => Promise<Response>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

beforeEach(() => {
  db = {
    anuncios_externos: [{
      id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1',
      variacoes_externas: { '100P': {}, '100M': {} },
    }],
    anuncios_externos_itens: [],
    profiles: [{ id: 'u1', org_id: 'org' }],
    familias: [
      {
        id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z', nome_pai: 'Renda',
        atributos_ml: [{ id: 'MAIN_MATERIAL', value_name: 'Poliamida' }],
        variacoes: [{ codigo: '100P', cor: 'Preto', imagem_path: 'org/l/00100P.jpg' }],
      },
      {
        id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', nome_pai: 'Renda Búfalo', categoria_ml_id: 'MLB1234',
        marca: 'Avil', atributos_editados_pelo_operador: true, titulo_ml: 'Renda Búfalo Poliéster',
        atributos_ml: [{ id: 'MAIN_MATERIAL', name: 'Material', value_name: '100% POLIÉSTER', value_id: '999' }, { id: 'PATTERN', value_name: 'Floral' }],
        variacoes: [
          { codigo: '100P', cor: 'Preto', imagem_path: 'org/l/00100P.jpg', comprimento_cm: 60 },
          { codigo: '100M', cor: 'Preto', imagem_path: 'org/l/00100P.jpg', comprimento_cm: 62 },
        ],
      },
    ],
    galeria_fatos: [], galeria_referencias: [], galeria_imagem_itens: [],
    galeria_roteiros: [], galeria_imagens: [], galeria_aplicacoes: [],
  }
  fake = fakeAdmin(db, new Map([['org/l/00100P.jpg', JPEG('preto')]]))
  f.fake = fake
  fetchs = []
  f.leitura = {}
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => { fetchs.push(`${init?.method ?? 'GET'} ${url}`); return new Response('{}', { status: 500 }) }))
})

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-fatos', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const fatoDe = (body: Linha, campo: string) => (body.fatos as Linha[]).find((x) => x.campo === campo)

describe('galeria-fatos', () => {
  it('MLB que não identifica um único anúncio da org → 409 anuncio_ambiguo', async () => {
    expect(await chamar({ acao: 'montar', ml_item_id: 'MLB404' })).toMatchObject({ status: 409, body: { error: 'anuncio_ambiguo' } })
  })

  it('montar: família vigente, ficha (atributo SUGERIDO mesmo com a família editada; medida que varia) e referência', async () => {
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ anuncio_externo_id: 'an1', familia_id: 'famB' })
    expect(fatoDe(r.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'SUGERIDO' })
    expect(fatoDe(r.body, 'nome')).toMatchObject({ estado: 'CONFIRMADO', valor: 'Renda Búfalo' })
    expect(fatoDe(r.body, 'comprimento_cm')).toMatchObject({ estado: 'VARIA_POR_TAMANHO' })
    expect(r.body.referencias).toMatchObject({ Preto: { frente: { path: expect.stringMatching(/^org\/galeria-ia\/famB\/referencias\/preto-frente-/) } } })
    expect(r.body.fatos_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('montar confere a etiqueta (Task 6b) com as referências reais e a ficha, antes do hash', async () => {
    f.conferir.mockClear()
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.status).toBe(200)
    expect(f.conferir).toHaveBeenCalledTimes(1)
    const [, org, a, ctx] = f.conferir.mock.calls[0] as [unknown, string, { anuncioId: string }, { refs: Linha[]; fatos: Linha[]; descartados: string[]; aplicadas: Set<string> }]
    expect([org, a.anuncioId]).toEqual(['org', 'an1'])
    expect(ctx.refs.map((x) => x.path)).toEqual([expect.stringMatching(/^org\/galeria-ia\/famB\/referencias\/preto-frente-/)])
    expect(ctx.fatos.some((x) => x.campo === 'atributo:MAIN_MATERIAL')).toBe(true)
    expect(ctx.aplicadas).toBeInstanceOf(Set)
    expect(ctx.descartados).toEqual([])
  })

  it('montar com hash diferente do roteiro aprovado: pendente→falhou, não aplicadas→desatualizada, submetendo/gerando intactas, roteiro desatualizado', async () => {
    db.galeria_roteiros.push({ id: 'r1', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', status: 'aprovado', fatos_hash: 'velho' })
    db.galeria_aplicacoes.push(
      { id: 'ap1', org_id: 'org', anuncio_externo_id: 'an1', status: 'aplicada', manifesto: [{ imagem_id: 'i5' }] },
      { id: 'ap2', org_id: 'org', anuncio_externo_id: 'an1', status: 'falhou', manifesto: [{ imagem_id: 'i6' }] },
    )
    const img = (id: string, status: string) => ({ id, org_id: 'org', anuncio_externo_id: 'an1', roteiro_id: 'r1', status })
    db.galeria_imagens.push(img('i1', 'pendente'), img('i2', 'submetendo'), img('i3', 'gerando'), img('i4', 'gerada'),
      img('i5', 'aprovada'), img('i6', 'aprovada'), img('i7', 'descartada'), { ...img('i8', 'gerada'), anuncio_externo_id: 'an2' })
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.status).toBe(200)
    expect(r.body.roteiro_desatualizado).toBe(true)
    const st = Object.fromEntries(db.galeria_imagens.map((i) => [i.id, i.status]))
    expect(st).toEqual({ i1: 'falhou', i2: 'submetendo', i3: 'gerando', i4: 'desatualizada', i5: 'aprovada', i6: 'desatualizada', i7: 'descartada', i8: 'gerada' })
    expect(db.galeria_imagens.find((i) => i.id === 'i1')?.erro).toBe('roteiro_trocado')
    expect(db.galeria_roteiros[0].status).toBe('desatualizado')
  })

  it('montar com o mesmo hash do roteiro aprovado não mexe em nada', async () => {
    const { body } = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    db.galeria_roteiros.push({ id: 'r1', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', status: 'aprovado', fatos_hash: body.fatos_hash })
    db.galeria_imagens.push({ id: 'i1', org_id: 'org', anuncio_externo_id: 'an1', roteiro_id: 'r1', status: 'gerada' })
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.body.roteiro_desatualizado).toBe(false)
    expect(db.galeria_roteiros[0].status).toBe('aprovado')
    expect(db.galeria_imagens[0].status).toBe('gerada')
  })

  it('ação com família que não é a vigente → 409 familia_nao_vigente com o id vigente', async () => {
    expect(await chamar({ acao: 'confirmar', ml_item_id: 'MLB1', familia_id: 'famA', campo: 'atributo:MAIN_MATERIAL' }))
      .toMatchObject({ status: 409, body: { error: 'familia_nao_vigente', familia_id_vigente: 'famB' } })
    expect(db.galeria_fatos).toHaveLength(0)
  })

  it('confirmar: SUGERIDO vira CONFIRMADO com quem e quando; campo da planilha não é confirmável', async () => {
    const r = await chamar({ acao: 'confirmar', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL' })
    expect(r.status).toBe(200)
    expect(db.galeria_fatos).toEqual([expect.objectContaining({
      org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: '100% POLIÉSTER',
      origem: 'confirmado_operador', confirmado_por: 'u1', descartado: false,
    })])
    expect(db.galeria_fatos[0].confirmado_em).toBeTruthy()
    expect(fatoDe(r.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'CONFIRMADO' })
    expect((await chamar({ acao: 'confirmar', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'nome' })).status).toBe(400)
  })

  it('descartar: o SUGERIDO sai da ficha', async () => {
    const r = await chamar({ acao: 'descartar', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:PATTERN' })
    expect(r.status).toBe(200)
    expect(fatoDe(r.body, 'atributo:PATTERN')).toBeUndefined()
    expect(db.galeria_fatos[0]).toMatchObject({ campo: 'atributo:PATTERN', descartado: true })
  })

  // A leitura vem do servidor: o cliente não pré-autoriza ignorar etiqueta nem confirma SUGERIDO por este caminho.
  it('manter_cadastro em fato que não está DIVERGENTE → 409, sem gravar (mesmo com etiqueta no corpo)', async () => {
    const r = await chamar({ acao: 'manter_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', etiqueta: '100% Poliamida' })
    expect(r).toMatchObject({ status: 409, body: { error: 'campo_nao_divergente' } })
    expect(db.galeria_fatos).toHaveLength(0)
  })

  it('corrigir_cadastro: grava só na família vigente o value_id do dicionário (como a Revisão), confirma o fato e não toca no ML', async () => {
    const r = await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: 'poliamida' })
    expect(r.status).toBe(200)
    const b = db.familias.find((x) => x.id === 'famB') as Linha
    // value_id novo (111): o UPDATE UP compara por value_id — sem ele "conferia" com o 999 do ML e nunca reenviava.
    expect(b.atributos_ml).toEqual([{ id: 'MAIN_MATERIAL', name: 'Material', value_name: 'Poliamida', value_id: '111' }, { id: 'PATTERN', value_name: 'Floral' }])
    expect(b.atributos_editados_pelo_operador).toBe(true)
    expect((db.familias.find((x) => x.id === 'famA') as Linha).atributos_ml).toEqual([{ id: 'MAIN_MATERIAL', value_name: 'Poliamida' }])
    expect(fatoDe(r.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'CONFIRMADO', valor: 'Poliamida' })
    expect(fetchs).toEqual([])
    expect(fake.escritas.map((e) => e.tabela).filter((t) => !t.startsWith('galeria_'))).toEqual(['familias'])
  })

  it('corrigir_cadastro: texto livre sem value_id; fora do dicionário → 422; nome/BRAND/vazio → 400', async () => {
    const r = await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:PATTERN', valor: 'Liso' })
    expect(r.status).toBe(200)
    expect((db.familias.find((x) => x.id === 'famB') as Linha).atributos_ml).toContainEqual({ id: 'PATTERN', value_name: 'Liso' })
    expect((await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: 'Couro' })).status).toBe(422)
    expect((await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'nome', valor: 'X' })).status).toBe(400)
    expect((await chamar({ acao: 'corrigir_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: ' ' })).status).toBe(400)
  })

  it('manter_cadastro com leitura DIVERGENTE persistida → 200: grava a leitura do servidor e o fato volta CONFIRMADO', async () => {
    f.leitura = { 'atributo:MAIN_MATERIAL': { legivel: true, valor: '100% Poliamida', recorte: 'r.jpg' } }
    const antes = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(fatoDe(antes.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'DIVERGENTE' })
    const r = await chamar({ acao: 'manter_cadastro', ml_item_id: 'MLB1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', etiqueta: 'qualquer coisa do cliente' })
    expect(r.status).toBe(200)
    expect(db.galeria_fatos[0]).toMatchObject({
      valor: '100% POLIÉSTER', origem: 'confirmado_operador', confirmado_por: 'u1',
      evidencia: expect.objectContaining({ manter_cadastro: true, etiqueta_lida: '100% Poliamida' }),
    })
    expect(fatoDe(r.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'CONFIRMADO' })
  })

  it('DIVERGENTE devolve a URL do recorte já resolvida: referência assinada e foto do ML pela secure_url; falha → sem url', async () => {
    const foto = (origem: string, ref: string) => ({ legivel: true, valor: '100% Poliamida', foto: { origem, ref }, caixa: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } })
    f.leitura = { 'atributo:MAIN_MATERIAL': foto('referencia', 'org/r.jpg') } as typeof f.leitura
    const ref = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(fatoDe(ref.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'DIVERGENTE', etiqueta: { foto: { origem: 'referencia', url: 'https://signed/org/r.jpg' } } })

    f.leitura = { 'atributo:MAIN_MATERIAL': foto('ml', 'PIC1') } as typeof f.leitura
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchs.push(`GET ${url}`)
      return url === 'https://api.mercadolibre.com/pictures/PIC1' ? Response.json({ variations: [{ secure_url: 'https://http2.mlstatic.com/D_NQ_X-O.jpg' }] }) : new Response('{}', { status: 500 })
    }))
    const ml = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(fatoDe(ml.body, 'atributo:MAIN_MATERIAL')).toMatchObject({ etiqueta: { foto: { origem: 'ml', ref: 'PIC1', url: 'https://http2.mlstatic.com/D_NQ_X-O.jpg' } } })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const falhou = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(falhou.status).toBe(200)
    expect((fatoDe(falhou.body, 'atributo:MAIN_MATERIAL') as { etiqueta: { foto: Linha } }).etiqueta.foto.url).toBeUndefined()
  })

  it('varredura em todo montar: submetendo que conclui gerada depois da troca do roteiro vira desatualizada', async () => {
    db.galeria_roteiros.push({ id: 'r1', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', status: 'aprovado', fatos_hash: 'velho' })
    db.galeria_imagens.push({ id: 'i2', org_id: 'org', anuncio_externo_id: 'an1', roteiro_id: 'r1', status: 'submetendo' })
    await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(db.galeria_roteiros[0].status).toBe('desatualizado')
    expect(db.galeria_imagens[0].status).toBe('submetendo')
    db.galeria_imagens[0].status = 'gerada' // o worker concluiu entre dois montar
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.body.roteiro_desatualizado).toBe(false)
    expect(db.galeria_imagens[0].status).toBe('desatualizada')
  })

  it('varredura poupa a do roteiro aprovado vigente com o hash atual e a aplicada', async () => {
    const { body } = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    db.galeria_roteiros.push(
      { id: 'r0', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famA', status: 'desatualizado', fatos_hash: 'x' },
      { id: 'r1', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', status: 'aprovado', fatos_hash: body.fatos_hash },
    )
    db.galeria_aplicacoes.push({ id: 'ap1', org_id: 'org', anuncio_externo_id: 'an1', status: 'aplicada', manifesto: [{ imagem_id: 'i0b' }] })
    const img = (id: string, roteiro: string, status: string) => ({ id, org_id: 'org', anuncio_externo_id: 'an1', roteiro_id: roteiro, status })
    db.galeria_imagens.push(img('i0', 'r0', 'gerada'), img('i0b', 'r0', 'aprovada'), img('i0c', 'r0', 'gerando'), img('i1', 'r1', 'gerada'))
    await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(Object.fromEntries(db.galeria_imagens.map((i) => [i.id, i.status]))).toEqual({ i0: 'desatualizada', i0b: 'aprovada', i0c: 'gerando', i1: 'gerada' })
  })

  it('enviar_vista A → B → A: a vigente volta a ser A', async () => {
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const enviar = async (marca: string, t: string) => {
        vi.setSystemTime(new Date(t))
        return (await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Preto', vista: 'lateral', imagem_base64: b64(JPEG(marca)) })).body
      }
      const a1 = await enviar('A', '2026-11-09T10:00:00Z')
      const b = await enviar('B', '2026-11-09T10:01:00Z')
      const a2 = await enviar('A', '2026-11-09T10:02:00Z')
      const lat = (x: Linha) => (x.referencias as Record<string, Record<string, Linha>>).Preto.lateral
      expect(lat(b).sha256).not.toBe(lat(a1).sha256)
      expect(lat(a2)).toEqual(lat(a1))
      expect(db.galeria_referencias.filter((x) => x.vista === 'lateral')).toHaveLength(2)
    } finally { vi.useRealTimers() }
  })

  it('SKU UP vivo sem MLB entra nas medidas (P=60 com MLB, M=62 sem → VARIA_POR_TAMANHO)', async () => {
    db.anuncios_externos[0].item_externo_id = null
    db.anuncios_externos_itens.push(
      { anuncio_externo_id: 'an1', org_id: 'org', sku: '100P', item_externo_id: 'MLB1', retirado: false },
      { anuncio_externo_id: 'an1', org_id: 'org', sku: '100M', item_externo_id: null, retirado: false },
    )
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.status).toBe(200)
    expect(fatoDe(r.body, 'comprimento_cm')).toMatchObject({ estado: 'VARIA_POR_TAMANHO' })
  })

  it('item plano Legacy (variacoes_externas = {}): resolve o SKU único da raiz', async () => {
    db.anuncios_externos[0].variacoes_externas = {}
    ;(db.familias.find((x) => x.id === 'famB') as Linha).variacoes = [{ codigo: '100U', cor: 'Preto', imagem_path: 'org/l/00100P.jpg', comprimento_cm: 70 }]
    const r = await chamar({ acao: 'montar', ml_item_id: 'MLB1' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ familia_id: 'famB', cores: ['Preto'] })
    expect(fatoDe(r.body, 'comprimento_cm')).toMatchObject({ estado: 'CONFIRMADO', valor: '70' })
  })

  it('enviar_vista: JPEG de costas vira referência upload_operador imutável; frente, não-JPEG ou cor de fora → 400', async () => {
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
    const ok = await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Preto', vista: 'costas', imagem_base64: b64(JPEG('costas')) })
    expect(ok.status).toBe(200)
    const ref = db.galeria_referencias.find((x) => x.vista === 'costas')
    expect(ref).toMatchObject({ origem: 'upload_operador', cor: 'Preto', familia_id: 'famB', anuncio_externo_id: 'an1' })
    expect(ref?.path).toMatch(/^org\/galeria-ia\/famB\/referencias\/preto-costas-[0-9a-f]{64}\.jpg$/)
    expect(ok.body.referencias).toMatchObject({ Preto: { costas: { id: ref?.id } } })
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    expect((await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Preto', vista: 'costas', imagem_base64: b64(png) })).status).toBe(400)
    expect((await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Preto', vista: 'frente', imagem_base64: b64(JPEG('f')) })).status).toBe(400)
    expect((await chamar({ acao: 'enviar_vista', ml_item_id: 'MLB1', familia_id: 'famB', cor: 'Azul', vista: 'costas', imagem_base64: b64(JPEG('a')) })).status).toBe(400)
  })

  it('ação desconhecida → 400', async () => {
    expect((await chamar({ acao: 'apagar', ml_item_id: 'MLB1' })).status).toBe(400)
  })
})
