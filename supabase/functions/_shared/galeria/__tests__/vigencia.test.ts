import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeAdmin, JPEG } from './fake-admin'

vi.mock('../../canais/conexao.ts', () => ({ resolverConexaoEstrita: vi.fn(async () => ({ id: 'cx' })) }))
const t = vi.hoisted(() => ({ token: vi.fn(async () => 'tok') }))
vi.mock('../../ml/token.ts', () => ({ getValidAccessTokenConexao: t.token }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => { throw new Error('IA real proibida em teste') } }))

const { calcularVigencia } = await import('../referencias')
const { carregarAnuncio } = await import('../anuncio')
const { hashFatos } = await import('../fatos')

type Linha = Record<string, unknown>
let db: Record<string, Linha[]>
let fake: ReturnType<typeof fakeAdmin>
let ativos: number
let maxAtivos: number

// Baixa do Storage com atraso decrescente (a 1ª cor termina por último): o resultado não pode depender de quem
// termina antes. Conta downloads simultâneos (um por cor: só a frente lê imagem_path).
const lento = (admin: ReturnType<typeof fakeAdmin>['admin']) => ({
  ...admin,
  storage: {
    from: (b: string) => {
      const s = admin.storage.from(b)
      return {
        ...s,
        download: async (p: string) => {
          ativos++
          maxAtivos = Math.max(maxAtivos, ativos)
          await new Promise((r) => setTimeout(r, 2 + (20 - Number(p.match(/(\d+)\.\w+$/)?.[1] ?? 0)) % 20))
          try { return await s.download(p) } finally { ativos-- }
        },
      }
    },
  },
})

// 6 cores: C1/C2 imagem_path JPEG novo (insert); C3 PNG em imagem_path → ML; C4 sem imagem_path com frente gravada;
// C5 JPEG com costas e lateral gravadas e frente já gravada (update); C6 sem nada e o ML só com foto aplicada.
const preparar = () => {
  const cores = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']
  db = {
    anuncios_externos: [{
      id: 'an1', org_id: 'org', canal: 'mercado_livre', codigo_pai: '100', item_externo_id: 'MLB1',
      variacoes_externas: Object.fromEntries(cores.map((c, i) => [`100${c}`, { variation_id: i + 1 }])),
    }],
    anuncios_externos_itens: [],
    familias: [{
      id: 'famA', org_id: 'org', codigo_pai: '100', publicado_em: '2026-11-01T10:00:00Z',
      nome_pai: 'FIO AMIGURUMI', marca: 'Marca', origem: 'NACIONAL', atributos_ml: [{ id: 'MATERIAL', name: 'Material', value_name: 'Algodão' }],
      variacoes: cores.map((c, i) => ({
        codigo: `100${c}`, cor: c, peso_gramas: 100, altura_cm: 2,
        imagem_path: ['C1', 'C2', 'C5'].includes(c) ? `org/lote/${i + 1}.jpg` : c === 'C3' ? `org/lote/${i + 1}.png` : null,
      })),
    }],
    profiles: [{ id: 'u1', org_id: 'org' }],
    galeria_referencias: [
      { id: 'r-c4f', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famA', cor: 'C4', vista: 'frente', path: 'org/galeria-ia/famA/referencias/c4-frente-aaa.jpg', sha256: 'aaa', origem: 'ml', criado_em: '2026-11-02' },
      { id: 'r-c5c', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famA', cor: 'C5', vista: 'costas', path: 'org/galeria-ia/famA/referencias/c5-costas-bbb.jpg', sha256: 'bbb', origem: 'upload_operador', criado_em: '2026-11-02' },
      { id: 'r-c5l', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famA', cor: 'C5', vista: 'lateral', path: 'org/galeria-ia/famA/referencias/c5-lateral-ccc.jpg', sha256: 'ccc', origem: 'upload_operador', criado_em: '2026-11-02' },
    ],
    galeria_imagem_itens: [{ org_id: 'org', anuncio_externo_id: 'an1', picture_id: 'G6' }],
    galeria_fatos: [],
  }
  fake = fakeAdmin(db, new Map([
    ['org/lote/1.jpg', JPEG('c1')], ['org/lote/2.jpg', JPEG('c2')], ['org/lote/5.jpg', JPEG('c5')],
    ['org/lote/3.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
  ]))
  // C5: a frente já estava gravada com o mesmo sha → caminho do update (preserva o id).
  return cores
}

beforeEach(() => {
  ativos = 0
  maxAtivos = 0
  t.token.mockClear()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.startsWith('https://api.mercadolibre.com/items/MLB1')) {
      return Response.json({
        id: 'MLB1', pictures: [],
        variations: ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].map((c, i) => ({
          id: i + 1, seller_custom_field: `100${c}`, picture_ids: c === 'C3' ? ['P3'] : c === 'C6' ? ['G6'] : [],
        })),
      })
    }
    const pic = url.match(/^https:\/\/api\.mercadolibre\.com\/pictures\/(\w+)$/)
    if (pic) return Response.json({ id: pic[1], variations: [{ secure_url: `https://http2.mlstatic.com/${pic[1]}-F.jpg` }] })
    const img = url.match(/^https:\/\/http2\.mlstatic\.com\/(\w+)-F\.jpg$/)
    if (img) return new Response(JPEG(`ml-${img[1]}`))
    return new Response('?', { status: 404 })
  }))
})

const rodar = async () => {
  const a = await carregarAnuncio(fake.admin as never, 'org', 'an1')
  if ('erro' in a) throw new Error(a.erro)
  return calcularVigencia(lento(fake.admin) as never, 'org', a)
}

// Sem o id gerado pelo fake (sequência de insert; em produção é uuid novo a cada insert, nunca entra no hash).
const semIdNovo = (refs: Record<string, Record<string, Linha>>) => JSON.stringify(Object.fromEntries(Object.entries(refs).map(
  ([cor, vs]) => [cor, Object.fromEntries(Object.entries(vs).map(([v, r]) => [v, String(r.id ?? '').startsWith('id-') ? { ...r, id: 'novo' } : r]))],
)))

describe('calcularVigencia', () => {
  it('6 cores: hash, referências (com a ordem das chaves) e fatos idênticos ao sequencial de referência', async () => {
    preparar()
    const sha5 = (await import('../referencias')).sha256Hex(JPEG('c5'))
    db.galeria_referencias.push({ id: 'r-c5f', org_id: 'org', anuncio_externo_id: 'an1', familia_id: 'famA', cor: 'C5', vista: 'frente', path: `org/galeria-ia/famA/referencias/c5-frente-${sha5}.jpg`, sha256: sha5, origem: 'storage', criado_em: '2026-11-02' })
    const v = await rodar()
    expect(v.fatos_hash).toBe(ESPERADO.hash)
    expect(semIdNovo(v.referencias as never)).toBe(ESPERADO.referencias)
    expect(JSON.stringify(v.fatos)).toBe(ESPERADO.fatos)
    // 2ª chamada (tudo já gravado, ids reais): mesmo hash, mesmas referências.
    const v2 = await rodar()
    expect(v2.fatos_hash).toBe(ESPERADO.hash)
    expect(JSON.stringify(v2.referencias)).toBe(JSON.stringify(v.referencias))
  })

  it('no máximo 6 cores por vez (e de fato em paralelo)', async () => {
    preparar()
    const cores = Array.from({ length: 9 }, (_, i) => `K${i + 1}`)
    db.anuncios_externos[0].variacoes_externas = Object.fromEntries(cores.map((c) => [`100${c}`, {}]))
    db.familias[0].variacoes = cores.map((c, i) => ({ codigo: `100${c}`, cor: c, imagem_path: `org/lote/${i + 1}.jpg` }))
    cores.forEach((c, i) => fake.arquivos.set(`org/lote/${i + 1}.jpg`, JPEG(c)))
    const v = await rodar()
    expect(Object.keys(v.referencias)).toEqual(cores)
    expect(maxAtivos).toBe(6)
  })

  it('caminho do ML em várias cores: um token e um GET do item por chamada (sem refresh concorrente)', async () => {
    preparar()
    const v = await rodar()
    expect(v.fatos_hash).toBe(ESPERADO.hash)
    expect(t.token).toHaveBeenCalledTimes(1) // C3 e C6 vão ao ML
    const gets = vi.mocked(fetch).mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('https://api.mercadolibre.com/items/'))
    expect(gets).toHaveLength(1)
  })

  it('profiles da org lido uma vez por chamada', async () => {
    preparar()
    const de = vi.spyOn(fake.admin, 'from')
    await rodar()
    expect(de.mock.calls.filter(([tabela]) => tabela === 'profiles')).toHaveLength(1)
  })

  it('emParalelo: resultado na ordem de entrada; exceção = a do menor índice; nada novo começa depois dela', async () => {
    const { emParalelo } = await import('../paralelo')
    const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))
    expect(await emParalelo([30, 1, 10], 2, async (ms, i) => { await espera(ms); return i })).toEqual([0, 1, 2])
    const iniciados: number[] = []
    await expect(emParalelo([0, 1, 2, 3, 4, 5], 2, async (_, i) => {
      iniciados.push(i)
      await espera(i === 0 ? 20 : 1)
      if (i === 0 || i === 1) throw new Error(`e${i}`)
      return i
    })).rejects.toThrow('e0')
    expect(iniciados).toEqual([0, 1])
  })

  it('hashFatos não depende da ordem de inserção das chaves das referências', () => {
    const fatos = [{ campo: 'nome_pai', valor: 'X', estado: 'CONFIRMADO' as const, origem: 'planilha' as const, evidencia: {} }]
    expect(hashFatos(fatos, { 'B:frente': '2', 'A:costas': '1', 'A:frente': '0' }))
      .toBe(hashFatos(fatos, { 'A:frente': '0', 'A:costas': '1', 'B:frente': '2' }))
  })
})

// Fixado rodando este teste contra o calcularVigencia SEQUENCIAL (antes da concorrência, 12/11). Não editar à mão.
const SEM = { erro: 'sem_referencia' }
const ref = (cor: string, sha: string, id = 'novo') => ({ id, path: `org/galeria-ia/famA/referencias/${cor}-frente-${sha}.jpg`, sha256: sha })
const ESPERADO = {
  hash: '5807f5ff56fbadc2fcdc381cfcbebefaaa2cee5b919ed831944fb3ccba0ed764',
  referencias: JSON.stringify({
    C1: { frente: ref('c1', '13370589ff569ec8843b93082a79be14f8545869aeeb0305427b2372c84c83bc'), costas: SEM, lateral: SEM },
    C2: { frente: ref('c2', '3eb78ef101a513be90dcdfecee07dbfe538a95f8a83ec3ab2041cb8ef0e3c9c8'), costas: SEM, lateral: SEM },
    C3: { frente: ref('c3', '613e95df7a5da280ba32cfe6abce754d2a5f26606eae89e3f1c268055a80c56c'), costas: SEM, lateral: SEM },
    C4: { frente: ref('c4', 'aaa', 'r-c4f'), costas: SEM, lateral: SEM },
    C5: {
      frente: ref('c5', '3922a78f104db5326f2e616f331d7ce5e72fb314cc7807851aafc78f712dcd11', 'r-c5f'),
      costas: { id: 'r-c5c', path: 'org/galeria-ia/famA/referencias/c5-costas-bbb.jpg', sha256: 'bbb' },
      lateral: { id: 'r-c5l', path: 'org/galeria-ia/famA/referencias/c5-lateral-ccc.jpg', sha256: 'ccc' },
    },
    C6: { frente: SEM, costas: SEM, lateral: SEM },
  }),
  fatos: JSON.stringify([
    { campo: 'nome', valor: 'FIO AMIGURUMI', estado: 'CONFIRMADO', origem: 'planilha', evidencia: { coluna: 'nome', trecho: 'FIO AMIGURUMI' } },
    { campo: 'marca', valor: 'Marca', estado: 'CONFIRMADO', origem: 'planilha', evidencia: { coluna: 'marca', trecho: 'Marca' } },
    { campo: 'origem', valor: 'NACIONAL', estado: 'CONFIRMADO', origem: 'planilha', evidencia: { coluna: 'origem', trecho: 'NACIONAL' } },
    { campo: 'peso_gramas', valor: '100', estado: 'CONFIRMADO', origem: 'planilha', evidencia: { coluna: 'peso_gramas', trecho: '100', porSku: { '100C1': '100', '100C2': '100', '100C3': '100', '100C4': '100', '100C5': '100', '100C6': '100' } } },
    { campo: 'altura_cm', valor: '2', estado: 'CONFIRMADO', origem: 'planilha', evidencia: { coluna: 'altura_cm', trecho: '2', porSku: { '100C1': '2', '100C2': '2', '100C3': '2', '100C4': '2', '100C5': '2', '100C6': '2' } } },
    { campo: 'atributo:MATERIAL', valor: 'Algodão', estado: 'SUGERIDO', origem: 'atributo_ml', evidencia: { atributo: 'MATERIAL', nome: 'Material' } },
  ]),
}
