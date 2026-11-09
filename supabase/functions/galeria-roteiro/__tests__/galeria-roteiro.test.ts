import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, JPEG } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as { admin: unknown },
  leitura: {} as Record<string, unknown>,
  ia: vi.fn(),
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org', isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../_shared/galeria/etiqueta.ts', () => ({ lerLeituraEtiqueta: vi.fn(async () => f.leitura), conferirEtiqueta: vi.fn() }))
vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: f.ia } } }) }))

import { calcularVigencia } from '../../_shared/galeria/referencias'
import { carregarAnuncio } from '../../_shared/galeria/anuncio'

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fetchs: string[]
let handler: (req: Request) => Promise<Response>
// path_from_root da categoria lido "ao vivo" (fetch mockado): Rendas (fora de Moda) ou Blusas (Moda).
let caminho: Array<{ id: string; name: string }>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
})

const respostaIA = (missoes: Linha[]) => ({ choices: [{ message: { content: JSON.stringify({ moda: false, contrato: 'Renda de poliamida', missoes }) } }] })
const missaoIA = (missao: number, extra: Linha = {}) => ({
  missao, cena: `cena ${missao}`, headline: '', subheadline: '', beneficios: [], specs: [], etapas: [], legendas: [], fatosUsados: [], ...extra,
})

beforeEach(() => {
  db = {
    anuncios_externos: [{
      id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1', variacoes_externas: { '100P': {} },
    }],
    anuncios_externos_itens: [],
    profiles: [{ id: 'u1', org_id: 'org' }],
    familias: [
      { id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z', nome_pai: 'Renda', variacoes: [{ codigo: '100P', cor: 'Preto', imagem_path: 'org/l/00100P.jpg' }] },
      {
        id: 'famB', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-05T10:00:00Z', nome_pai: 'Renda Búfalo', categoria_ml_id: 'MLB-VELHA',
        marca: 'Avil', origem: 'NACIONAL', atributos_ml: [{ id: 'MAIN_MATERIAL', name: 'Material', value_name: '100% Poliamida' }],
        variacoes: [{ codigo: '100P', cor: 'Preto', imagem_path: 'org/l/00100P.jpg', largura_cm: 20 }],
      },
    ],
    galeria_fatos: [], galeria_referencias: [], galeria_imagem_itens: [],
    galeria_roteiros: [], galeria_imagens: [], galeria_aplicacoes: [], configuracoes: [],
  }
  fake = fakeAdmin(db, new Map([['org/l/00100P.jpg', JPEG('preto')]]))
  fake.respostasRpc.galeria_aprovar_roteiro = () => 'ok'
  f.fake = fake
  f.leitura = {}
  f.ia.mockReset()
  caminho = [{ id: 'MLB1574', name: 'Casa' }, { id: 'MLB9999', name: 'Rendas' }]
  fetchs = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetchs.push(url)
    if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) return Response.json({ id: 'MLB1', category_id: 'MLB9999', variations: [], pictures: [] })
    if (url === 'https://api.mercadolibre.com/categories/MLB9999') return Response.json({ id: 'MLB9999', name: caminho.at(-1)!.name, path_from_root: caminho })
    return new Response('{}', { status: 500 })
  }))
})

const chamar = async (body: Linha) => {
  const r = await handler(new Request('http://x/galeria-roteiro', { method: 'POST', body: JSON.stringify(body) }))
  return { status: r.status, body: await r.json() as Linha }
}
const base = { ml_item_id: 'MLB1', familia_id: 'famB' }

// Roteiro de renda válido para a ficha acima depois que o operador confirma o material (atributo do ML é SUGERIDO).
const confirmarMaterial = () => db.galeria_fatos.push({
  org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', campo: 'atributo:MAIN_MATERIAL', valor: '100% Poliamida',
  origem: 'confirmado_operador', evidencia: {}, descartado: false,
})
const rendaValida = () => ({
  categoria: 'Rendas', contrato: 'Renda de poliamida; desenho preservado',
  missoes: [
    { missao: 1, ativa: true, cena: 'capa', fatosUsados: ['nome'] },
    { missao: 5, ativa: true, cena: 'ficha', headline: 'Ficha técnica', specs: [{ campo: 'atributo:MAIN_MATERIAL', rotulo: 'Material', valor: '100% Poliamida' }], fatosUsados: [] },
  ],
})
const roteiro = (extra: Linha) => db.galeria_roteiros.push({
  org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', moda: false, fatos_hash: 'h0', conteudo: rendaValida(), ...extra,
})

describe('galeria-roteiro: criar', () => {
  it('categoria e Moda ao vivo; o texto do modelo some em Moda; grava rascunho v1 na família vigente', async () => {
    caminho = [{ id: 'MLB1430', name: 'Calçados, Roupas e Bolsas' }, { id: 'MLB3112', name: 'Blusas' }]
    f.ia.mockResolvedValueOnce(respostaIA([missaoIA(1), missaoIA(2, { headline: 'Blusa linda', fatosUsados: ['nome'] })]))
    const r = await chamar({ ...base, acao: 'criar' })
    expect(r.status).toBe(200)
    expect(fetchs).toEqual(expect.arrayContaining([expect.stringMatching(/^https:\/\/api\.mercadolibre\.com\/items\/MLB1/), 'https://api.mercadolibre.com/categories/MLB9999']))
    const [linha] = db.galeria_roteiros
    expect(linha).toMatchObject({ familia_id: 'famB', anuncio_externo_id: 'an1', versao: 1, status: 'rascunho', moda: true, criado_por: 'u1' })
    const conteudo = linha.conteudo as { categoria: string; missoes: Linha[] }
    expect(conteudo.categoria).toBe('Blusas')
    expect(conteudo.missoes.map((m) => m.missao)).toEqual([1, 2, 5, 6, 7]) // sem costas/lateral: sem referência
    expect(conteudo.missoes.some((m) => 'headline' in m)).toBe(false)
  })

  it('recusa com fato DIVERGENTE pendente (sem chamar o modelo)', async () => {
    f.leitura = { marca: { legivel: true, valor: 'Outra Marca' } }
    const r = await chamar({ ...base, acao: 'criar' })
    expect(r).toMatchObject({ status: 409, body: { error: 'fato_divergente', campos: ['marca'] } })
    expect(f.ia).not.toHaveBeenCalled()
    expect(db.galeria_roteiros).toHaveLength(0)
  })

  it('categoria ilegível → recusa; nunca presume "não é Moda"', async () => {
    caminho = []
    const r = await chamar({ ...base, acao: 'criar' })
    expect(r).toMatchObject({ status: 502, body: { error: 'categoria_indisponivel' } })
    expect(f.ia).not.toHaveBeenCalled()
  })

  it('família que deixou de ser vigente não cria trabalho novo', async () => {
    const r = await chamar({ ...base, familia_id: 'famA', acao: 'criar' })
    expect(r).toMatchObject({ status: 409, body: { error: 'familia_nao_vigente', familia_id_vigente: 'famB' } })
  })

  it('modelo falhou → 502 e nada gravado', async () => {
    f.ia.mockRejectedValueOnce(new Error('timeout'))
    const r = await chamar({ ...base, acao: 'criar' })
    expect(r).toMatchObject({ status: 502, body: { error: 'roteiro_ia_falhou' } })
    expect(db.galeria_roteiros).toHaveLength(0)
  })
})

describe('galeria-roteiro: salvar', () => {
  it('sobre a versão aprovada cria a versão seguinte em rascunho e a aprovada continua igual', async () => {
    confirmarMaterial()
    roteiro({ id: 'r1', versao: 1, status: 'aprovado', fatos_hash: 'hA' })
    const antes = structuredClone(db.galeria_roteiros[0])
    const editado = { ...rendaValida(), categoria: 'Do cliente', contrato: 'Contrato editado' }
    const r = await chamar({ ...base, acao: 'salvar', roteiro_id: 'r1', conteudo: editado })
    expect(r.status).toBe(200)
    expect(r.body.erros).toEqual([])
    expect(db.galeria_roteiros[0]).toEqual(antes)
    expect(db.galeria_roteiros).toHaveLength(2)
    expect(db.galeria_roteiros[1]).toMatchObject({ versao: 2, status: 'rascunho', familia_id: 'famB', moda: false })
    expect((db.galeria_roteiros[1].conteudo as Linha).contrato).toBe('Contrato editado')
    // categoria é a da edge, nunca a do cliente.
    expect((db.galeria_roteiros[1].conteudo as Linha).categoria).toBe('Rendas')
  })

  it('rascunho é editado no lugar e revalidado com a Moda da linha (não a do cliente)', async () => {
    confirmarMaterial()
    roteiro({ id: 'r1', versao: 1, status: 'rascunho', moda: true })
    const r = await chamar({ ...base, acao: 'salvar', roteiro_id: 'r1', conteudo: { ...rendaValida(), moda: false } })
    expect(r.status).toBe(200)
    expect(db.galeria_roteiros).toHaveLength(1)
    expect(r.body.erros).toEqual(expect.arrayContaining([expect.stringMatching(/Missão 5: Moda é sem texto/)]))
  })

  it('conteúdo fora do formato → 400', async () => {
    roteiro({ id: 'r1', versao: 1, status: 'rascunho' })
    const r = await chamar({ ...base, acao: 'salvar', roteiro_id: 'r1', conteudo: { missoes: [{ missao: 9 }] } })
    expect(r).toMatchObject({ status: 400, body: { error: 'conteudo_invalido' } })
  })
})

describe('galeria-roteiro: aprovar', () => {
  it('grava fatos_hash = calcularVigencia (o mesmo do montar) pela RPC atômica', async () => {
    confirmarMaterial()
    roteiro({ id: 'r2', versao: 2, status: 'rascunho' })
    const r = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2' })
    expect(r.status).toBe(200)
    const a = await carregarAnuncio(fake.admin as never, 'org', 'an1')
    if ('erro' in a) throw new Error('fixture')
    const { fatos_hash } = await calcularVigencia(fake.admin as never, 'org', a)
    expect(fake.rpcs).toEqual([{ nome: 'galeria_aprovar_roteiro', args: expect.objectContaining({
      p_org: 'org', p_roteiro: 'r2', p_familia: 'famB', p_fatos_hash: fatos_hash, p_usuario: 'u1',
    }) }])
    expect(r.body).toMatchObject({ status: 'aprovado', fatos_hash })
  })

  it('roteiro inválido não aprova (erros do código)', async () => {
    roteiro({ id: 'r2', versao: 2, status: 'rascunho' }) // material ainda SUGERIDO
    const r = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2' })
    expect(r).toMatchObject({ status: 422, body: { error: 'roteiro_invalido' } })
    expect((r.body.erros as string[]).some((e) => /SUGERIDO/.test(e))).toBe(true)
    expect(fake.rpcs).toHaveLength(0)
  })

  it('fato NAO_CONFERIDO citado exige ciência do operador, que fica gravada no roteiro', async () => {
    confirmarMaterial()
    f.leitura = { marca: { legivel: false, estado: 'inconclusiva' } }
    const conteudo = rendaValida()
    conteudo.missoes[1].fatosUsados = ['marca']
    roteiro({ id: 'r2', versao: 2, status: 'rascunho', conteudo })
    const sem = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2' })
    expect(sem).toMatchObject({ status: 409, body: { error: 'ciencia_pendente', campos: ['marca'] } })
    const com = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2', ciencia_nao_conferido: ['marca'] })
    expect(com.status).toBe(200)
    expect(fake.rpcs[0].args.p_conteudo).toMatchObject({ ciencia_nao_conferido: { campos: ['marca'], por: 'u1' } })
  })

  it('RPC recusa (outra aba aprovou antes) → 409 com o código', async () => {
    confirmarMaterial()
    roteiro({ id: 'r2', versao: 2, status: 'rascunho' })
    fake.respostasRpc.galeria_aprovar_roteiro = () => 'nao_rascunho'
    const r = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2' })
    expect(r).toMatchObject({ status: 409, body: { error: 'nao_rascunho' } })
  })

  it('roteiro de outro anúncio não é encontrado', async () => {
    roteiro({ id: 'r9', versao: 1, status: 'rascunho', anuncio_externo_id: 'outro' })
    const r = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r9' })
    expect(r).toMatchObject({ status: 404, body: { error: 'roteiro_nao_encontrado' } })
  })
})
