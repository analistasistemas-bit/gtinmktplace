import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin } from './fake-admin'
import { filtrarFicha, garantirPlano, type AtributoML } from '../plano-vigente.ts'
import { hashDados, type DadosPlanejador } from '../planejador.ts'
import type { Plano } from '../plano.ts'
import type { AnuncioGaleria } from '../anuncio.ts'

vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => { throw new Error('nunca chama IA real') } }))

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let ficha: AtributoML[] | null
let path: Array<{ id: string }> | null
let planejar: ReturnType<typeof vi.fn>
let lerCategoria: ReturnType<typeof vi.fn>

const plano = (dadosHash: string, extra: Partial<Plano> = {}): Plano => ({
  formato: 2, dados_hash: dadosHash, conflitos: [],
  paleta: { cor1: { nome: 'Rosa', hex: '#D91F58' }, cor2: { nome: 'Amarelo', hex: '#F2D631' } },
  imagens: ([1, 2, 3, 4, 5, 6, 7] as const).map((posicao) => ({ posicao, funcao: `f${posicao}`, textos: [], prompt: `p${posicao} {{COR}}` })),
  ...extra,
})

const anuncio = (vig: Partial<AnuncioGaleria['vigente']> = {}): AnuncioGaleria => ({
  anuncioId: 'an1', codigoPai: '100', skus: ['100A', '100R'], itemPorSku: { '100A': 'MLB1', '100R': 'MLB1' },
  vigente: {
    id: 'famB', publicado_em: '2026-11-05T10:00:00Z', categoria_ml_id: 'MLB999', nome_pai: 'Fio Amigurumi', descricao_pai: 'Fio 100% algodão, 254 m',
    marca: 'Círculo', titulo_ml: 'TITULO_PUBLICADO', descricao_ml: 'DESCRICAO_PUBLICADA', variacoes: [], ...vig,
  },
  porSku: {
    '100A': { codigo: '100A', cor: 'Azul Und 3528', imagem_path: null, familia_id: 'famB', publicado_em: '2026-11-05T10:00:00Z' },
    '100R': { codigo: '100R', cor: 'Rosa', imagem_path: null, familia_id: 'famB', publicado_em: '2026-11-05T10:00:00Z' },
  },
})

const FICHA: AtributoML[] = [{ id: 'MATERIAL', name: 'Material', value_name: 'Algodão' }, { id: 'BRAND', name: 'Marca', value_name: 'Círculo' }]
/** dados_hash esperado para anuncio() + FICHA. */
const HASH = hashDados({
  nome: 'Fio Amigurumi', descricao_fornecedor: 'Fio 100% algodão, 254 m', marca: 'Círculo',
  ficha_do_anuncio: { Marca: 'Círculo', Material: 'Algodão' }, total_de_cores: 2, conteudo_da_embalagem: '1 unidade na cor escolhida',
})

/** Espelho de galeria_aprovar_roteiro (20261109153037). */
const espelhoAprovar = (d: Record<string, Linha[]>) => (args: Linha) => {
  const r = d.galeria_roteiros.find((x) => x.id === args.p_roteiro && x.org_id === args.p_org)
  if (!r) return 'nao_encontrado'
  if (r.status !== 'rascunho') return 'nao_rascunho'
  if (r.familia_id !== args.p_familia) return 'familia_nao_vigente'
  if (JSON.stringify(r.conteudo) !== JSON.stringify(args.p_conteudo_lido)) return 'conteudo_mudou'
  d.galeria_roteiros.filter((x) => x.anuncio_externo_id === r.anuncio_externo_id && x.status === 'aprovado').forEach((x) => { x.status = 'desatualizado' })
  const aplicadas = new Set((d.galeria_aplicacoes ?? []).filter((ap) => ap.status === 'aplicada')
    .flatMap((ap) => (ap.manifesto as Linha[]).map((m) => m.imagem_id)))
  for (const i of d.galeria_imagens ?? []) {
    if (i.anuncio_externo_id !== r.anuncio_externo_id || i.roteiro_id === r.id) continue
    if (i.status === 'pendente') Object.assign(i, { status: 'falhou', erro: 'roteiro_trocado' })
    else if ((i.status === 'gerada' || i.status === 'aprovada') && !aplicadas.has(i.id)) i.status = 'desatualizada'
  }
  Object.assign(r, { status: 'aprovado', fatos_hash: args.p_fatos_hash, conteudo: args.p_conteudo, aprovado_por: args.p_usuario })
  return 'ok'
}

const aprovado = (extra: Linha = {}): Linha => ({
  id: 'rotV', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', versao: 2, status: 'aprovado', moda: false,
  fatos_hash: 'h', conteudo: { categoria: 'Rendas', missoes: [] }, ...extra,
})
const img = (id: string, extra: Linha = {}): Linha => ({
  id, org_id: 'org', anuncio_externo_id: 'an1', roteiro_id: 'rotV', cor: 'Rosa', missao: 2, status: 'gerada', entregue_em: '2026-11-10T10:00:00Z', ...extra,
})

beforeEach(() => {
  db = { galeria_roteiros: [], galeria_imagens: [], galeria_aplicacoes: [] }
  fake = fakeAdmin(db)
  fake.respostasRpc.galeria_aprovar_roteiro = espelhoAprovar(db)
  ficha = [...FICHA]
  path = [{ id: 'MLB1574' }, { id: 'MLB999' }]
  planejar = vi.fn(async (q: { dados: DadosPlanejador }) => ({ plano: plano(hashDados(q.dados)) }))
  lerCategoria = vi.fn(async () => path)
})

const garantir = (extra: Partial<Parameters<typeof garantirPlano>[1]> = {}, admin: unknown = fake.admin) =>
  garantirPlano(admin as never, {
    orgId: 'org', userId: 'u1', a: anuncio(), fatosHash: 'h', refUrl: 'https://signed/ref.jpg', confirmarTroca: false, modelo: 'openai/gpt-6-luna',
    lerFichaML: async () => ficha, lerCategoria: lerCategoria as never, planejar: planejar as never, ...extra,
  })
const insertsRoteiro = () => fake.escritas.filter((e) => e.tabela === 'galeria_roteiros' && e.op === 'insert')
const aprovados = () => db.galeria_roteiros.filter((r) => r.status === 'aprovado')

describe('garantirPlano', () => {
  it('reaproveita o aprovado quando é formato 2, da família vigente, com o mesmo fatos_hash e o mesmo dados_hash (não chama a IA)', async () => {
    const r1 = await garantir()
    expect(planejar).toHaveBeenCalledTimes(1)
    const r2 = await garantir()
    expect(planejar).toHaveBeenCalledTimes(1)
    expect(r2).toEqual(r1)
    expect(insertsRoteiro()).toHaveLength(1)
    expect(fake.rpcs.filter((x) => x.nome === 'galeria_aprovar_roteiro')).toHaveLength(1)
  })

  it('aprovado formato 2 de outra família (mesmos hashes) → plano novo', async () => {
    const r1 = await garantir() as { roteiroId: string }
    db.galeria_roteiros.find((x) => x.id === r1.roteiroId)!.familia_id = 'famA'
    const r2 = await garantir() as { roteiroId: string }
    expect(planejar).toHaveBeenCalledTimes(2)
    expect(r2.roteiroId).not.toBe(r1.roteiroId)
  })

  it('roteiro aprovado em formato antigo → cria plano novo, sem pedir confirmação', async () => {
    db.galeria_roteiros.push(aprovado())
    db.galeria_imagens.push(img('i1'), img('i2', { status: 'aprovada' }))
    const r = await garantir() as { roteiroId: string; moda: boolean }
    expect(planejar).toHaveBeenCalledTimes(1)
    expect(r.roteiroId).not.toBe('rotV')
    expect(db.galeria_roteiros.find((x) => x.id === 'rotV')!.status).toBe('desatualizado')
    expect(db.galeria_imagens.map((i) => i.status)).toEqual(['desatualizada', 'desatualizada'])
  })

  it('fatos_hash diferente, sem imagens exibidas → cria plano novo (rascunho versao = max+1 + galeria_aprovar_roteiro)', async () => {
    const p0 = plano('x')
    db.galeria_roteiros.push(aprovado({ fatos_hash: 'h_velho', conteudo: p0 }),
      aprovado({ id: 'rotA', familia_id: 'famA', versao: 5, status: 'desatualizado' }))
    db.galeria_imagens.push(img('i1', { entregue_em: null }), img('i2', { status: 'pendente', entregue_em: null }))
    const r = await garantir() as { roteiroId: string; plano: Plano; moda: boolean }
    expect(planejar).toHaveBeenCalledTimes(1)
    const ins = insertsRoteiro()[0].payload as Linha
    expect(ins).toEqual({
      org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famB', versao: 6, conteudo: r.plano, fatos_hash: 'h',
      moda: false, status: 'rascunho', criado_por: 'u1',
    })
    const rpc = fake.rpcs.find((x) => x.nome === 'galeria_aprovar_roteiro')!.args
    expect(rpc).toEqual({ p_org: 'org', p_roteiro: r.roteiroId, p_familia: 'famB', p_fatos_hash: 'h', p_conteudo_lido: r.plano, p_conteudo: r.plano, p_usuario: 'u1' })
    expect(aprovados().map((x) => x.id)).toEqual([r.roteiroId])
    expect(db.galeria_imagens.find((i) => i.id === 'i2')).toMatchObject({ status: 'falhou', erro: 'roteiro_trocado' })
  })

  it('ficha do ML mudou (dados_hash diferente) → trata como plano desatualizado', async () => {
    const r1 = await garantir() as { roteiroId: string }
    ficha = [...FICHA, { id: 'LENGTH', name: 'Comprimento', value_name: '254 m' }]
    // Sem imagens exibidas: plano novo direto.
    const r2 = await garantir() as { roteiroId: string; plano: Plano }
    expect(planejar).toHaveBeenCalledTimes(2)
    expect(r2.roteiroId).not.toBe(r1.roteiroId)
    expect((planejar.mock.calls[1][0] as { dados: DadosPlanejador }).dados.ficha_do_anuncio).toHaveProperty('Comprimento', '254 m')
    // Com imagem exibida do plano vigente: pede confirmação.
    db.galeria_imagens.push(img('i1', { roteiro_id: r2.roteiroId }))
    ficha = [...FICHA]
    expect(await garantir()).toEqual({ erro: 'plano_desatualizado', imagens: 1 })
    expect(planejar).toHaveBeenCalledTimes(2)
  })

  it('plano formato 2 desatualizado com imagens exibidas e não aplicadas, sem confirmarTroca → { erro: "plano_desatualizado", imagens: N }, sem chamar a IA', async () => {
    db.galeria_roteiros.push(aprovado({ fatos_hash: 'h_velho', conteudo: plano('x') }))
    db.galeria_imagens.push(
      img('i1'), img('i2', { status: 'aprovada' }), // contam
      img('i3'), // aplicada: não conta
      img('i4', { entregue_em: null }), // nunca exibida
      img('i5', { roteiro_id: 'outro' }), // de outro roteiro
      img('i6', { status: 'desatualizada' }), img('i7', { status: 'falhou' }),
    )
    db.galeria_aplicacoes.push(
      { id: 'ap1', org_id: 'org', anuncio_externo_id: 'an1', status: 'aplicada', manifesto: [{ imagem_id: 'i3', final_sha256: 's' }] },
      { id: 'ap2', org_id: 'org', anuncio_externo_id: 'an1', status: 'revertida', manifesto: [{ imagem_id: 'i1', final_sha256: 's' }] },
    )
    expect(await garantir()).toEqual({ erro: 'plano_desatualizado', imagens: 2 })
    expect(planejar).not.toHaveBeenCalled()
    expect(lerCategoria).toHaveBeenCalled()
    expect(fake.escritas).toEqual([])
    expect(fake.rpcs).toEqual([])
  })

  it('o mesmo caso com confirmarTroca: true → cria o plano novo', async () => {
    db.galeria_roteiros.push(aprovado({ fatos_hash: 'h_velho', conteudo: plano('x') }))
    db.galeria_imagens.push(img('i1'), img('i3'))
    db.galeria_aplicacoes.push({ id: 'ap1', org_id: 'org', anuncio_externo_id: 'an1', status: 'aplicada', manifesto: [{ imagem_id: 'i3' }] })
    const r = await garantir({ confirmarTroca: true }) as { roteiroId: string }
    expect(planejar).toHaveBeenCalledTimes(1)
    expect(aprovados().map((x) => x.id)).toEqual([r.roteiroId])
    expect(db.galeria_imagens.map((i) => i.status)).toEqual(['desatualizada', 'gerada'])
  })

  it('outra aba criou o plano durante a chamada da IA: relê o aprovado antes do insert e usa o dela, sem inserir', async () => {
    planejar.mockImplementationOnce(async (q: { dados: DadosPlanejador }) => {
      db.galeria_roteiros.push(aprovado({ id: 'rotOutra', versao: 7, conteudo: plano(hashDados(q.dados)) }))
      return { plano: plano(hashDados(q.dados), { conflitos: ['meu'] }) }
    })
    const r = await garantir() as { roteiroId: string; plano: Plano }
    expect(r.roteiroId).toBe('rotOutra')
    expect(r.plano.conflitos).toEqual([])
    expect(insertsRoteiro()).toEqual([])
    expect(fake.rpcs).toEqual([])
  })

  describe('insert do rascunho com 23505', () => {
    const comDuplicata = (outro: Linha | null) => ({
      ...fake.admin,
      from: (t: string) => {
        const q = fake.admin.from(t) as Record<string, unknown>
        if (t === 'galeria_roteiros') {
          q.insert = () => {
            if (outro) db.galeria_roteiros.push(outro)
            return { select: () => ({ single: async () => ({ data: null, error: { message: 'duplicate key', code: '23505' } }) }) }
          }
        }
        return q
      },
    })

    it('relê o aprovado e usa', async () => {
      const r = await garantir({}, comDuplicata(aprovado({ id: 'rotOutra', versao: 3, conteudo: plano(HASH) })))
      expect(r).toMatchObject({ roteiroId: 'rotOutra', moda: false })
      expect(fake.rpcs).toEqual([])
    })

    it('aprovado relido não serve → plano_ia_falhou, sem RPC', async () => {
      const r = await garantir({}, comDuplicata(aprovado({ id: 'rotOutra', fatos_hash: 'outro' })))
      expect(r).toEqual({ erro: 'plano_ia_falhou' })
      expect(fake.rpcs).toEqual([])
    })
  })

  it.each([['plano_ia_falhou'], ['plano_invalido']])('IA falhou (%s) → devolve o erro e não grava nada', async (erro) => {
    db.galeria_roteiros.push(aprovado())
    planejar.mockResolvedValueOnce({ erro, erros: ['x'] })
    expect(await garantir()).toEqual({ erro })
    expect(fake.escritas).toEqual([])
    expect(fake.rpcs).toEqual([])
  })

  it('aprovar devolve código ≠ ok → apaga o rascunho e devolve plano_ia_falhou', async () => {
    fake.respostasRpc.galeria_aprovar_roteiro = () => 'conteudo_mudou'
    expect(await garantir()).toEqual({ erro: 'plano_ia_falhou' })
    expect(db.galeria_roteiros).toEqual([])
  })

  it('categoria ilegível → categoria_indisponivel, sem chamar a IA', async () => {
    path = null
    expect(await garantir()).toEqual({ erro: 'categoria_indisponivel' })
    expect(planejar).not.toHaveBeenCalled()
    // Família sem categoria gravada: nem consulta.
    lerCategoria.mockClear()
    expect(await garantir({ a: anuncio({ categoria_ml_id: null }) })).toEqual({ erro: 'categoria_indisponivel' })
    expect(lerCategoria).not.toHaveBeenCalled()
    expect(planejar).not.toHaveBeenCalled()
    expect(fake.escritas).toEqual([])
  })

  it('Moda pela categoria: planejador recebe moda e o rascunho grava moda', async () => {
    path = [{ id: 'MLB1430' }, { id: 'MLB31447' }]
    const r = await garantir() as { moda: boolean }
    expect(r.moda).toBe(true)
    expect(planejar.mock.calls[0][0]).toMatchObject({ moda: true, modelo: 'openai/gpt-6-luna', refUrl: 'https://signed/ref.jpg', cores: ['Azul Und 3528', 'Rosa'] })
    expect((insertsRoteiro()[0].payload as Linha).moda).toBe(true)
  })

  it('ficha do ML fora do ar → ml_indisponivel, sem chamar a IA', async () => {
    ficha = null
    expect(await garantir()).toEqual({ erro: 'ml_indisponivel' })
    expect(planejar).not.toHaveBeenCalled()
    expect(fake.escritas).toEqual([]) // a categoria é lida em paralelo com a ficha (GET público, sem custo)
  })
  it('plano com texto não é reaproveitado quando a categoria passou a ser Moda', async () => {
    db.galeria_roteiros.push(aprovado())
    path = [{ id: 'MLB31447' }]
    await garantir()
    expect(planejar).toHaveBeenCalledTimes(1)
    expect(planejar.mock.calls[0][0].moda).toBe(true)
  })

  it('ficha enviada ao planejador não leva atributos de embalagem nem de variação', async () => {
    ficha = [
      { id: 'MATERIAL', name: 'Material', value_name: 'Algodão' },
      { id: 'COLOR', name: 'Cor', value_name: 'Rosa' }, { id: 'MAIN_COLOR', name: 'Cor principal', value_name: 'Rosa' },
      { id: 'SIZE', name: 'Tamanho', value_name: 'Único' }, { id: 'GTIN', name: 'Código universal', value_name: '789' },
      { id: 'SELLER_SKU', name: 'SKU', value_name: '100R' }, { id: 'ITEM_CONDITION', name: 'Condição', value_name: 'Novo' },
      { id: 'PACKAGE_LENGTH', name: 'Comprimento da EMBALAGEM', value_name: '10 cm' },
      { id: 'VENDOR_CODE', name: 'Código do vendor', value_name: 'V1' },
      { id: 'X1', name: 'Cor do fio', value_name: 'azul und 3528' }, // igual a uma cor do anúncio (caixa)
      { id: 'X2', name: 'Tom', value_name: 'RÓSA' }, // igual a uma cor (acento)
      { id: 'X3', name: 'Vazio', value_name: null }, { id: 'X4', name: 'Branco', value_name: '  ' },
      { id: 'BRAND', name: 'Marca', value_name: 'Círculo' },
    ]
    await garantir()
    const dados = (planejar.mock.calls[0][0] as { dados: DadosPlanejador }).dados
    expect(dados).toEqual({
      nome: 'Fio Amigurumi', descricao_fornecedor: 'Fio 100% algodão, 254 m', marca: 'Círculo',
      ficha_do_anuncio: { Marca: 'Círculo', Material: 'Algodão' }, total_de_cores: 2, conteudo_da_embalagem: '1 unidade na cor escolhida',
    })
    expect(Object.keys(dados.ficha_do_anuncio)).toEqual(['Marca', 'Material'])
    expect(JSON.stringify(planejar.mock.calls[0][0])).not.toMatch(/TITULO_PUBLICADO|DESCRICAO_PUBLICADA/)
  })

  it('ficha em ordem diferente dá o mesmo dados_hash', async () => {
    const r1 = await garantir() as { plano: Plano }
    expect(r1.plano.dados_hash).toBe(HASH)
    ficha = [...FICHA].reverse()
    expect(await garantir()).toEqual(r1) // mesmo hash → reaproveita
    expect(planejar).toHaveBeenCalledTimes(1)
    expect(Object.keys(filtrarFicha([...FICHA].reverse(), []))).toEqual(['Marca', 'Material'])
  })
})
