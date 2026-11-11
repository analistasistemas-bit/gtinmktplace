import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, JPEG } from '../../_shared/galeria/__tests__/fake-admin'

const f = vi.hoisted(() => ({
  serve: vi.fn(), fake: null as unknown as { admin: unknown },
  leitura: {} as Record<string, unknown>,
  ia: vi.fn(),
  conferir: vi.fn(async (..._a: unknown[]) => false),
}))

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }))
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org', isAdmin: false, support: null })),
}))
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => f.fake.admin }))
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }))
vi.mock('../../_shared/galeria/etiqueta.ts', () => ({ lerLeituraEtiqueta: vi.fn(async () => f.leitura), conferirEtiqueta: f.conferir }))
vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: f.ia } } }) }))

import { calcularVigencia } from '../../_shared/galeria/referencias'
import { carregarAnuncio } from '../../_shared/galeria/anuncio'

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let fetchs: string[]
let handler: (req: Request) => Promise<Response>
let handlerFatos: (req: Request) => Promise<Response>
// path_from_root da categoria lido "ao vivo" (fetch mockado): Rendas (fora de Moda) ou Blusas (Moda).
let caminho: Array<{ id: string; name: string }>

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } })
  await import('../index.ts')
  await import('../../galeria-fatos/index.ts')
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>
  handlerFatos = f.serve.mock.calls[1][0] as (req: Request) => Promise<Response>
})

const respostaIA = (missoes: Linha[]) => ({ choices: [{ message: { content: JSON.stringify({ moda: false, contrato: 'Renda de poliamida', missoes }) } }] })
const missaoIA = (missao: number, extra: Linha = {}) => ({
  missao, cena: `cena ${missao}`, headline: '', subheadline: '', beneficios: [], specs: [], etapas: [], legendas: [], fatosUsados: [], ...extra,
})

beforeEach(() => {
  db = {
    organizations: [{ id: 'org', modulos_habilitados: ['imagem_ia'] }, { id: 'org2', modulos_habilitados: ['imagem_ia'] }],
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
  f.conferir.mockReset()
  f.conferir.mockImplementation(async () => false)
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
  // Revisão geral (item 4): o roteiro chama o modelo de texto por conta da Daludi; exige o módulo imagem_ia.
  it('módulo imagem_ia desligado → 403 modulo_desligado em toda ação, sem IA nem gravação', async () => {
    db.organizations[0].modulos_habilitados = []
    for (const acao of ['criar', 'ler', 'salvar', 'aprovar']) {
      expect(await chamar({ ...base, acao })).toMatchObject({ status: 403, body: { error: 'modulo_desligado' } })
    }
    expect(f.ia).not.toHaveBeenCalled()
    expect(db.galeria_roteiros).toEqual([])
  })

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
    // Missões que o modelo omitiu nascem inativas: o rascunho não nasce travado.
    expect(conteudo.missoes.filter((m) => m.ativa).map((m) => m.missao)).toEqual([1, 2])
    expect(r.body.erros).toEqual([])
  })

  // Fase A (Ajuste v2-2) inverte o teste antigo ("erro visível, missão segue ativa"): o que a poda não resolve nasce
  // desligado com motivo e o rascunho já é aprovável.
  it('fora de Moda: missão com erro depois da poda nasce desligada com motivo; o rascunho já aprova', async () => {
    f.ia.mockResolvedValueOnce(respostaIA([
      missaoIA(1, { fatosUsados: ['nome'] }),
      missaoIA(4, { headline: 'Renda Búfalo', beneficios: ['Largura de 20 cm'], fatosUsados: ['nome', 'largura_cm'] }),
      missaoIA(5, { headline: 'Ficha técnica', specs: [{ campo: 'largura_cm', rotulo: 'Largura', valor: '20 cm' }] }),
      missaoIA(6, { etapas: ['Lave em água quente'], fatosUsados: ['nome'] }),
    ]))
    const r = await chamar({ ...base, acao: 'criar' })
    expect(r.status).toBe(200)
    expect(db.galeria_roteiros[0]).toMatchObject({ moda: false })
    const missoes = (db.galeria_roteiros[0].conteudo as { missoes: Array<Linha & { motivoDesligada?: string }> }).missoes
    for (const n of [4, 5, 6]) expect(missoes.find((m) => m.missao === n)).toMatchObject({ ativa: false, motivoDesligada: expect.any(String) })
    expect(r.body).toMatchObject({ erros: [], ciencia_pendente: [] })
    const id = db.galeria_roteiros[0].id
    expect((await chamar({ ...base, acao: 'aprovar', roteiro_id: id })).status).toBe(200)
  })

  it('criar confere a etiqueta (mesmo gancho do montar): DIVERGENTE nova recusa antes da IA', async () => {
    f.conferir.mockImplementationOnce(async () => { f.leitura = { marca: { legivel: true, valor: 'Outra Marca' } }; return true })
    const r = await chamar({ ...base, acao: 'criar' })
    expect(r).toMatchObject({ status: 409, body: { error: 'fato_divergente', campos: ['marca'] } })
    expect(f.conferir).toHaveBeenCalledTimes(1)
    expect(f.ia).not.toHaveBeenCalled()
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
    expect(r).toMatchObject({ status: 503, body: { error: 'categoria_indisponivel' } })
    expect(f.ia).not.toHaveBeenCalled()
  })

  it('GET do item falhou → recusa; nunca usa a categoria gravada na família', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => {
      fetchs.push(String(url))
      return new Response('{}', { status: 500 })
    })
    const r = await chamar({ ...base, acao: 'criar' })
    expect(r).toMatchObject({ status: 503, body: { error: 'categoria_indisponivel' } })
    expect(fetchs.some((u) => u.includes('/categories/'))).toBe(false)
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

describe('galeria-roteiro: ler', () => {
  it('sem roteiro → roteiro null e Moda ao vivo; não escreve nada', async () => {
    const r = await chamar({ ml_item_id: 'MLB1', acao: 'ler' })
    expect(r).toMatchObject({ status: 200, body: { roteiro: null, moda: false, familia_id: 'famB' } })
    expect(db.galeria_roteiros).toEqual([])
  })

  it('rascunho mais novo que o aprovado vence; devolve erros, erros_por_missao, ciencia_pendente e moda ao vivo', async () => {
    confirmarMaterial()
    roteiro({ id: 'r1', versao: 1, status: 'aprovado' })
    roteiro({ id: 'r2', versao: 2, status: 'rascunho', conteudo: { ...rendaValida(), missoes: [...rendaValida().missoes, { missao: 6, ativa: true, cena: 'x', etapas: ['Lave em água quente'], fatosUsados: ['nome'] }] } })
    const r = await chamar({ ml_item_id: 'MLB1', acao: 'ler' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ moda: false, roteiro: { id: 'r2', versao: 2, status: 'rascunho' }, ciencia_pendente: [], erros_por_missao: { 6: [expect.any(String)] } })
    expect((r.body.erros as string[]).length).toBeGreaterThan(0)
  })

  it('sem rascunho mais novo, devolve o aprovado vigente', async () => {
    confirmarMaterial()
    roteiro({ id: 'r1', versao: 1, status: 'aprovado' })
    const r = await chamar({ ml_item_id: 'MLB1', acao: 'ler' })
    expect(r.body).toMatchObject({ roteiro: { id: 'r1', status: 'aprovado' }, erros: [] })
  })

  it('só da família vigente: roteiro de família antiga não aparece', async () => {
    roteiro({ id: 'rA', familia_id: 'famA', versao: 3, status: 'aprovado' })
    expect((await chamar({ ml_item_id: 'MLB1', acao: 'ler' })).body.roteiro).toBeNull()
  })

  it('categoria ilegível → moda null + aviso, sem quebrar nem cair no banco', async () => {
    roteiro({ id: 'r1', versao: 1, status: 'rascunho', moda: true })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const r = await chamar({ ml_item_id: 'MLB1', acao: 'ler' })
    expect(r).toMatchObject({ status: 200, body: { moda: null, aviso: 'categoria_indisponivel', roteiro: { id: 'r1' } } })
  })

  it('MLB que não identifica um único anúncio → 409', async () => {
    expect((await chamar({ ml_item_id: 'MLB404', acao: 'ler' })).status).toBe(409)
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
    expect(f.conferir).toHaveBeenCalledTimes(1) // mesmo gancho da etiqueta do montar
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
      p_conteudo_lido: db.galeria_roteiros[0].conteudo,
    }) }])
    expect(r.body).toMatchObject({ status: 'aprovado', fatos_hash })
  })

  it('aprovar e depois montar (galeria-fatos): o roteiro continua aprovado, mesmo com a leitura da etiqueta velha', async () => {
    confirmarMaterial()
    roteiro({ id: 'r2', versao: 2, status: 'rascunho' })
    fake.respostasRpc.galeria_aprovar_roteiro = (args) => {
      Object.assign(db.galeria_roteiros.find((x) => x.id === args.p_roteiro)!, { status: 'aprovado', fatos_hash: args.p_fatos_hash })
      return 'ok'
    }
    // Leitura gravada velha: a primeira conferência lê a etiqueta (marca ilegível → NAO_CONFERIDO); depois, cache.
    f.conferir.mockImplementationOnce(async () => { f.leitura = { marca: { legivel: false, estado: 'indisponivel' } }; return true })
    expect((await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2' })).status).toBe(200)
    const r = await handlerFatos(new Request('http://x/galeria-fatos', { method: 'POST', body: JSON.stringify({ acao: 'montar', ml_item_id: 'MLB1' }) }))
    const montado = await r.json() as Linha
    expect(montado.roteiro_desatualizado).toBe(false)
    expect(db.galeria_roteiros[0]).toMatchObject({ status: 'aprovado', fatos_hash: montado.fatos_hash })
  })

  it('aprovar relê a categoria: Moda mudou desde o criar → 409 categoria_mudou, sem aprovar', async () => {
    confirmarMaterial()
    roteiro({ id: 'r2', versao: 2, status: 'rascunho', moda: false })
    caminho = [{ id: 'MLB1430', name: 'Calçados, Roupas e Bolsas' }, { id: 'MLB3112', name: 'Blusas' }]
    const r = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2' })
    expect(r).toMatchObject({ status: 409, body: { error: 'categoria_mudou' } })
    expect(fake.rpcs).toHaveLength(0)
  })

  it('aprovar com categoria ilegível → 503, sem aprovar', async () => {
    confirmarMaterial()
    roteiro({ id: 'r2', versao: 2, status: 'rascunho' })
    caminho = []
    const r = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2' })
    expect(r).toMatchObject({ status: 503, body: { error: 'categoria_indisponivel' } })
    expect(fake.rpcs).toHaveLength(0)
  })

  it('RPC recusa conteúdo que mudou (salvar no meio) → 409 conteudo_mudou', async () => {
    confirmarMaterial()
    roteiro({ id: 'r2', versao: 2, status: 'rascunho' })
    fake.respostasRpc.galeria_aprovar_roteiro = () => 'conteudo_mudou'
    const r = await chamar({ ...base, acao: 'aprovar', roteiro_id: 'r2' })
    expect(r).toMatchObject({ status: 409, body: { error: 'conteudo_mudou' } })
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
