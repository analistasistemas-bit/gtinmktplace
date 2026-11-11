import { describe, expect, it, vi } from 'vitest'
import type { Fato } from '../fatos'

const ia = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: ia.create } } }) }))

import { cienciaPendente, errosPorMissao, gerarRoteiroIA, sanearRoteiro, validarRoteiro, type Roteiro } from '../roteiro'
import { motivosDeTexto } from '../layouts'
import { fatosFita, retornoFita } from './fixtures/fita-veludo'

const fato = (campo: string, valor: string, estado: Fato['estado'] = 'CONFIRMADO'): Fato =>
  ({ campo, valor, estado, origem: 'planilha', evidencia: {} })

// Renda Búfalo (R1.6): material confirmado pelo operador; comprimento varia entre os SKUs.
const FATOS: Fato[] = [
  fato('nome', 'Renda Búfalo'),
  fato('atributo:MAIN_MATERIAL', '100% Poliamida'),
  fato('largura_cm', '20'),
  fato('comprimento_cm', '60 / 62', 'VARIA_POR_TAMANHO'),
  fato('titulo_ml', 'Renda Búfalo Poliéster Premium', 'SUGERIDO'),
  fato('marca', 'Avil', 'NAO_CONFERIDO'),
  fato('descricao_fornecedor', 'Lavar à mão em água fria. Secar à sombra.\nNão lavar em água quente; nunca usar alvejante!'),
]

const renda = (): Roteiro => ({
  categoria: 'Rendas',
  contrato: 'Renda de poliamida; desenho e transparência preservados; não vira cetim nem gorgurão.',
  missoes: [
    { missao: 1, ativa: true, cena: 'Rolo com parte desenrolada em curvas, fundo branco, luz premium', fatosUsados: ['nome'] },
    {
      missao: 4, ativa: true, cena: 'Renda sobre mesa de costura', headline: 'Renda Búfalo 100% Poliamida',
      beneficios: ['Desenho delicado e transparente', 'Largura de 20 cm'], fatosUsados: ['atributo:MAIN_MATERIAL', 'largura_cm'],
    },
    {
      missao: 5, ativa: true, cena: 'Renda estendida com régua', headline: 'Ficha técnica',
      // Ajuste v2-4 (Fase A): largura_cm é medida da embalagem e não vira spec (antes: 2ª spec "Largura 20 cm").
      specs: [{ campo: 'atributo:MAIN_MATERIAL', rotulo: 'Material', valor: '100% Poliamida' }],
      fatosUsados: [],
    },
  ],
})

const comMissao = (patch: Partial<Roteiro['missoes'][number]>, missao = 4): Roteiro => {
  const r = renda()
  r.missoes = r.missoes.map((m) => (m.missao === missao ? { ...m, ...patch } : m))
  return r
}

describe('validarRoteiro', () => {
  it('caso renda válido → [] ("premium" na cena é direção de arte, R4.3)', () => {
    expect(validarRoteiro(renda(), FATOS, false)).toEqual([])
  })

  it('headline de 6 palavras', () => {
    expect(validarRoteiro(comMissao({ headline: 'Renda Búfalo de poliamida muito delicada' }), FATOS, false))
      .toEqual([expect.stringMatching(/Missão 4: headline com 6 palavras/)])
  })

  it('4 benefícios', () => {
    expect(validarRoteiro(comMissao({ beneficios: ['Leve', 'Macia', 'Delicada', 'Transparente'] }), FATOS, false))
      .toEqual([expect.stringMatching(/Missão 4: 4 benefícios/)])
  })

  it('benefício com 7 palavras', () => {
    expect(validarRoteiro(comMissao({ beneficios: ['Uma renda feita para durar muito tempo'] }), FATOS, false))
      .toEqual([expect.stringMatching(/benefício com 7 palavras/)])
  })

  it('spec fora dos CONFIRMADO (sugerido, inexistente ou valor diferente do fato)', () => {
    const erros = validarRoteiro(comMissao({
      specs: [
        { campo: 'titulo_ml', rotulo: 'Nome', valor: 'Renda Búfalo Poliéster Premium' },
        { campo: 'atributo:GSM', rotulo: 'Gramatura', valor: '120 g' },
        { campo: 'atributo:MAIN_MATERIAL', rotulo: 'Material', valor: '100% Poliéster' },
      ],
    }, 5), FATOS, false)
    expect(erros).toEqual(expect.arrayContaining([
      expect.stringMatching(/titulo_ml.*SUGERIDO/),
      expect.stringMatching(/atributo:GSM.*não está na Ficha/),
      expect.stringMatching(/atributo:MAIN_MATERIAL.*difere do fato/),
    ]))
  })

  it('spec com fato VARIA_POR_TAMANHO (R1.5)', () => {
    expect(validarRoteiro(comMissao({ specs: [{ campo: 'comprimento_cm', rotulo: 'Comprimento', valor: '60 cm' }] }, 5), FATOS, false))
      .toEqual(expect.arrayContaining([expect.stringMatching(/comprimento_cm.*varia entre os tamanhos/), expect.stringMatching(/sem fato confirmado/)]))
  })

  it('fatosUsados com SUGERIDO também reprova', () => {
    expect(validarRoteiro(comMissao({ fatosUsados: ['titulo_ml'] }), FATOS, false))
      .toEqual(expect.arrayContaining([expect.stringMatching(/titulo_ml.*SUGERIDO/), expect.stringMatching(/sem fato confirmado/)]))
  })

  it('"premium" no texto da imagem (R4.3)', () => {
    expect(validarRoteiro(comMissao({ headline: 'Renda premium' }), FATOS, false))
      .toEqual([expect.stringMatching(/Missão 4: termo proibido "premium"/)])
  })

  it('Moda com headline, mesmo com o JSON dizendo moda: false', () => {
    const r = { ...renda(), moda: false } as Roteiro
    const erros = validarRoteiro(r, FATOS, true, ['frente', 'costas', 'lateral'])
    expect(erros).toEqual(expect.arrayContaining([expect.stringMatching(/Missão 4: .*sem texto/), expect.stringMatching(/Missão 5: .*sem texto/)]))
  })

  it('missão 1 com headline', () => {
    expect(validarRoteiro(comMissao({ headline: 'Renda Búfalo' }, 1), FATOS, false))
      .toEqual([expect.stringMatching(/Missão 1: .*sem texto/)])
  })

  it('DIVERGENTE pendente na Ficha trava o roteiro (R1.3)', () => {
    const fatos = [...FATOS, fato('atributo:COLOR', 'Preto', 'DIVERGENTE')]
    expect(validarRoteiro(renda(), fatos, false)).toEqual([expect.stringMatching(/atributo:COLOR.*divergente/)])
  })

  it('Moda: "De costas" só com referência de costas (R3.2)', () => {
    const r: Roteiro = { categoria: 'Blusas', contrato: 'Blusa preta', missoes: [
      { missao: 1, ativa: true, cena: 'Capa', fatosUsados: [] },
      { missao: 3, ativa: true, cena: 'Costas', fatosUsados: [] },
    ] }
    expect(validarRoteiro(r, FATOS, true, ['frente'])).toEqual([expect.stringMatching(/Missão 3: .*não disponível/)])
    expect(validarRoteiro(r, FATOS, true, ['frente', 'costas'])).toEqual([])
  })

  it('missão 3–6 fora de Moda sem fato confirmado não é oferecida (R2.1, R5.3)', () => {
    expect(validarRoteiro(comMissao({ fatosUsados: [], headline: undefined, beneficios: undefined }), FATOS, false))
      .toEqual([expect.stringMatching(/Missão 4: .*sem fato/)])
  })

  it('texto ancorado: etapa de frase livre ("Lave em água quente") com fatosUsados ["nome"] → erro', () => {
    const r = renda()
    r.missoes.push({ missao: 6, ativa: true, cena: 'mãos lavando a renda', etapas: ['Lave em água quente'], fatosUsados: ['nome'] })
    expect(validarRoteiro(r, FATOS, false)).toEqual([expect.stringMatching(/Missão 6: etapa "Lave em água quente" não é trecho de fato confirmado/)])
  })

  it('texto ancorado: etapa que é trecho da descrição confirmada citada passa', () => {
    const r = renda()
    r.missoes.push({ missao: 6, ativa: true, cena: 'mãos lavando a renda', etapas: ['Lavar à mão em água fria.', 'Secar à sombra'], fatosUsados: ['descricao_fornecedor'] })
    expect(validarRoteiro(r, FATOS, false)).toEqual([])
  })

  it('texto ancorado: headline "100% algodão" com fato "100% poliéster" → erro (material fora do fato)', () => {
    const fatos = FATOS.map((f) => (f.campo === 'atributo:MAIN_MATERIAL' ? { ...f, valor: '100% poliéster' } : f))
    const r = comMissao({ headline: '100% algodão', beneficios: [], fatosUsados: ['atributo:MAIN_MATERIAL'] })
    r.missoes = r.missoes.filter((m) => m.missao !== 5)
    expect(validarRoteiro(r, fatos, false)).toEqual([expect.stringMatching(/Missão 4: "algodão" no texto não vem de fato citado/)])
  })

  // Revisão geral (item 6), caso Renda Búfalo: o modelo escreve sem acento e o material passava sem âncora.
  it('material sem acento: "100% algodao" × fato "100% poliéster" → erro; "poliester" × "poliéster" passa; "lá" não é lã', () => {
    const fatos = FATOS.map((f) => (f.campo === 'atributo:MAIN_MATERIAL' ? { ...f, valor: '100% poliéster' } : f))
    const com = (headline: string) => {
      const r = comMissao({ headline, beneficios: [], fatosUsados: ['atributo:MAIN_MATERIAL'] })
      r.missoes = r.missoes.filter((m) => m.missao !== 5)
      return validarRoteiro(r, fatos, false)
    }
    expect(com('100% algodao')).toEqual([expect.stringMatching(/Missão 4: "algodão" no texto não vem de fato citado/)])
    expect(com('Renda Búfalo 100% poliamida')).toEqual([expect.stringMatching(/"poliamida" no texto não vem de fato citado/)])
    expect(com('100% poliester')).toEqual([])
    expect(com('Leve para lá')).toEqual([])
  })

  it('texto ancorado: número sem fato citado → erro; medida convertida do fato citado passa', () => {
    expect(validarRoteiro(comMissao({ beneficios: ['Rolo com 50 metros'] }), FATOS, false))
      .toEqual([expect.stringMatching(/Missão 4: "50 metros" no texto não vem de fato citado/)])
    expect(validarRoteiro(comMissao({ beneficios: ['Largura de 200 mm'] }), FATOS, false)).toEqual([])
  })

  it('unidade conhecida compara por medida: largura_cm "20" × "Rolo de 20 metros" → erro; "20 cm" e "200 mm" → ok', () => {
    expect(validarRoteiro(comMissao({ beneficios: ['Rolo de 20 metros'] }), FATOS, false))
      .toEqual([expect.stringMatching(/Missão 4: "20 metros" no texto não vem de fato citado/)])
    expect(validarRoteiro(comMissao({ beneficios: ['Largura de 20 cm'] }), FATOS, false)).toEqual([])
    expect(validarRoteiro(comMissao({ beneficios: ['Largura de 200 mm'] }), FATOS, false)).toEqual([])
  })

  it('etapa = oração inteira do fato; negação não pode ser cortada', () => {
    const comEtapas = (etapas: string[]) => {
      const r = renda()
      r.missoes.push({ missao: 6, ativa: true, cena: 'cuidados', etapas, fatosUsados: ['descricao_fornecedor'] })
      return validarRoteiro(r, FATOS, false)
    }
    expect(comEtapas(['lavar em água quente'])).toEqual([expect.stringMatching(/etapa "lavar em água quente" não é trecho/)])
    expect(comEtapas(['usar alvejante'])).toEqual([expect.stringMatching(/etapa "usar alvejante" não é trecho/)])
    expect(comEtapas(['Lavar à mão'])).toEqual([expect.stringMatching(/etapa "Lavar à mão" não é trecho/)])
    expect(comEtapas(['Não lavar em água quente', 'Nunca usar alvejante!', 'Secar à sombra'])).toEqual([])
  })

  it('"lá" (advérbio) não vira o material "lã"; "lã" sem fato citado continua barrada', () => {
    expect(validarRoteiro(comMissao({ beneficios: ['Fica lá no ateliê'] }), FATOS, false)).toEqual([])
    expect(validarRoteiro(comMissao({ beneficios: ['Toque de lã'] }), FATOS, false))
      .toEqual([expect.stringMatching(/Missão 4: "lã" no texto não vem de fato citado/)])
  })

  it('missão 2 ou 7 com texto e sem fato utilizável citado → erro', () => {
    const r = renda()
    r.missoes.push({ missao: 2, ativa: true, cena: 'ateliê', headline: 'Para seus projetos', fatosUsados: [] })
    r.missoes.push({ missao: 7, ativa: true, cena: 'recorte', legendas: ['Acabamento'], fatosUsados: ['titulo_ml'] })
    expect(validarRoteiro(r, FATOS, false)).toEqual(expect.arrayContaining([
      expect.stringMatching(/Missão 2: sem fato confirmado/), expect.stringMatching(/Missão 7: sem fato confirmado/),
    ]))
  })

  it('spec sem rótulo → erro (e sanearRoteiro não apaga a spec parcial)', () => {
    const r = sanearRoteiro(comMissao({ specs: [{ campo: 'atributo:MAIN_MATERIAL', rotulo: '', valor: '100% Poliamida' }] }, 5), 'Rendas')!
    expect(r.missoes.find((m) => m.missao === 5)?.specs).toEqual([{ campo: 'atributo:MAIN_MATERIAL', rotulo: '', valor: '100% Poliamida' }])
    expect(validarRoteiro(r, FATOS, false)).toEqual([expect.stringMatching(/Missão 5: spec sem rótulo/)])
  })

  it('missão inativa não é validada', () => {
    expect(validarRoteiro(comMissao({ ativa: false, headline: 'Renda premium com frete grátis' }), FATOS, false)).toEqual([])
  })
})

describe('cienciaPendente (R1.3: não conferido na etiqueta)', () => {
  it('fato NAO_CONFERIDO citado exige ciência; registrada, nada pendente', () => {
    const r = comMissao({ fatosUsados: ['atributo:MAIN_MATERIAL', 'largura_cm', 'marca'] })
    expect(validarRoteiro(r, FATOS, false)).toEqual([])
    expect(cienciaPendente(r, FATOS)).toEqual(['marca'])
    expect(cienciaPendente({ ...r, ciencia_nao_conferido: { campos: ['marca'], por: 'u1', em: 'x' } }, FATOS)).toEqual([])
  })
})

describe('cienciaPendente: valor NAO_CONFERIDO no texto, fora de fatosUsados', () => {
  it('marca "Avil" no headline exige ciência', () => {
    const r = comMissao({ headline: 'Renda Avil 100% Poliamida' })
    expect(validarRoteiro(r, FATOS, false)).toEqual([])
    expect(cienciaPendente(r, FATOS)).toEqual(['marca'])
  })
})

describe('gerarRoteiroIA', () => {
  const resposta = (conteudo: unknown) => ({ choices: [{ message: { content: JSON.stringify(conteudo) } }] })

  it('Moda é do código: texto do modelo some, missões só as disponíveis, sem retry e com timeout', async () => {
    ia.create.mockResolvedValueOnce(resposta({
      moda: false, contrato: 'Blusa preta de viscose',
      missoes: [1, 2, 3, 4].map((missao) => ({
        missao, cena: `cena ${missao}`, headline: 'Blusa linda', subheadline: '', beneficios: ['Leve'], specs: [], etapas: [], legendas: [], fatosUsados: ['nome'],
      })),
    }))
    const r = await gerarRoteiroIA({ modelo: 'openai/gpt-6-luna', categoria: 'Blusas', moda: true, vistas: ['frente'], fatos: FATOS })
    expect(r.missoes.map((m) => m.missao)).toEqual([1, 2, 5, 6, 7])
    expect(r.missoes.every((m) => m.headline === undefined && m.beneficios === undefined)).toBe(true)
    expect(r.missoes.find((m) => m.missao === 2)?.cena).toBe('cena 2')
    expect(r.categoria).toBe('Blusas')
    expect(r).not.toHaveProperty('moda')
    const [corpo, opcoes] = ia.create.mock.calls[0]
    expect(corpo.model).toBe('openai/gpt-6-luna')
    expect(opcoes).toMatchObject({ maxRetries: 0 })
    expect(opcoes.signal).toBeInstanceOf(AbortSignal)
    // O modelo só vê fatos utilizáveis (nunca SUGERIDO nem VARIA_POR_TAMANHO).
    const dados = JSON.stringify(corpo.messages)
    expect(dados).not.toContain('titulo_ml')
    expect(dados).not.toContain('comprimento_cm')
    expect(dados).toContain('largura_cm')
  })

  it('fora de Moda mantém o texto (NFC) e tira só o da capa', async () => {
    ia.create.mockResolvedValueOnce(resposta({
      contrato: 'Renda', missoes: [
        { missao: 1, cena: 'capa', headline: 'Não pode', subheadline: '', beneficios: [], specs: [], etapas: [], legendas: [], fatosUsados: [] },
        { missao: 4, cena: 'b', headline: 'Renda Búfalo', subheadline: '', beneficios: ['100% Poliamida'], specs: [], etapas: [], legendas: [], fatosUsados: ['nome'] },
      ],
    }))
    const r = await gerarRoteiroIA({ modelo: 'm', categoria: 'Rendas', moda: false, vistas: ['frente'], fatos: FATOS })
    expect(r.missoes.find((m) => m.missao === 1)?.headline).toBeUndefined()
    expect(r.missoes.find((m) => m.missao === 4)?.headline).toBe('Renda Búfalo'.normalize('NFC'))
    expect(r.missoes.find((m) => m.missao === 4)?.beneficios).toEqual(['100% Poliamida'])
    expect(r.missoes.find((m) => m.missao === 4)?.ativa).toBe(true)
    expect(r.missoes).toHaveLength(7)
  })

  it('missão com erro depois da poda nasce desligada com motivo (Ajuste v2-2; antes ficava ativa com o erro)', async () => {
    ia.create.mockResolvedValueOnce(resposta({
      contrato: 'Renda de poliamida', missoes: [
        { missao: 1, cena: 'capa', headline: '', subheadline: '', beneficios: [], specs: [], etapas: [], legendas: [], fatosUsados: ['nome'] },
        { missao: 2, cena: '', headline: '', subheadline: '', beneficios: [], specs: [], etapas: [], legendas: [], fatosUsados: ['nome'] },
        { missao: 3, cena: 'objeção', headline: 'Renda Búfalo', subheadline: '', beneficios: [], specs: [], etapas: [], legendas: [], fatosUsados: ['titulo_ml'] },
        { missao: 4, cena: 'benefícios', headline: 'Renda Búfalo 100% Poliamida', subheadline: '', beneficios: ['Largura de 20 cm'], specs: [], etapas: [], legendas: [], fatosUsados: ['atributo:MAIN_MATERIAL', 'largura_cm'] },
      ],
    }))
    const r = await gerarRoteiroIA({ modelo: 'm', categoria: 'Rendas', moda: false, vistas: ['frente'], fatos: FATOS })
    expect(r.missoes.filter((m) => m.ativa).map((m) => m.missao)).toEqual([1])
    const motivo = (n: number) => r.missoes.find((m) => m.missao === n)?.motivoDesligada
    expect(motivo(2)).toMatch(/cena vazia/)
    expect(motivo(3)).toMatch(/lupa/i) // travada: nem vai ao modelo
    expect(motivo(4)).toMatch(/benefício/) // "Largura de 20 cm" não está escrito em fato nenhum
    expect(motivo(5)).toMatch(/não escreveu/)
    expect(validarRoteiro(r, FATOS, false)).toEqual([])
  })

  it('resposta fora do formato lança (a edge não grava rascunho)', async () => {
    ia.create.mockResolvedValueOnce({ choices: [{ message: { content: 'não é json' } }] })
    await expect(gerarRoteiroIA({ modelo: 'm', categoria: 'x', moda: false, vistas: ['frente'], fatos: FATOS })).rejects.toThrow(/roteiro_ia_invalido/)
  })
})

// Fase A (plano 2026-11-11-galeria-ux-correcoes): o roteiro nasce aprovável — campos e largura por missão, poda,
// missões impossíveis desligadas com motivo, ancoragem por contenção normalizada.
describe('gerarRoteiroIA: roteiro nasce aprovável (Fase A)', () => {
  const resposta = (conteudo: unknown) => ({ choices: [{ message: { content: JSON.stringify(conteudo) } }] })
  const gerar = async (retorno: unknown, fatos: Fato[], moda = false) => {
    ia.create.mockResolvedValueOnce(resposta(retorno))
    return gerarRoteiroIA({ modelo: 'm', categoria: 'Fechos de Contato', moda, vistas: ['frente'], fatos })
  }
  const dadosEnviados = () => JSON.parse(ia.create.mock.calls.at(-1)![0].messages[1].content.replace(/^DATA \(JSON\):\n/, ''))
  /** Invariante: toda missão ativa sem erro do servidor nem de largura; toda desligada (não omitida) com motivo. */
  const semErroNasAtivas = (r: Roteiro, fatos: Fato[], moda = false) => {
    const porMissao = errosPorMissao(validarRoteiro(r, fatos, moda, ['frente']))
    expect(porMissao.geral ?? [], 'gerais').toEqual([])
    for (const m of r.missoes.filter((x) => x.ativa)) {
      expect(porMissao[String(m.missao)] ?? [], `missão ${m.missao}`).toEqual([])
      expect(motivosDeTexto(m.missao, m, moda), `largura ${m.missao}`).toEqual([])
    }
    expect(r.missoes.find((m) => m.missao === 1)?.ativa).toBe(true)
  }

  it('Fita Veludo (retorno real): ativas 1, 2, 4, 5; 3 e 7 travadas pela lupa; 6 sem etapa dos dados', async () => {
    const fatos = fatosFita()
    const r = await gerar(retornoFita(), fatos)
    expect(r.missoes.filter((m) => m.ativa).map((m) => m.missao)).toEqual([1, 2, 4, 5])
    const motivo = (n: number) => r.missoes.find((m) => m.missao === n)?.motivoDesligada ?? ''
    expect(motivo(3)).toMatch(/lupa/i)
    expect(motivo(7)).toMatch(/lupa/i)
    expect(motivo(6)).toMatch(/etapa/i)
    const m4 = r.missoes.find((m) => m.missao === 4)!
    expect(m4.subheadline).toBeUndefined()
    expect(m4.beneficios).toEqual(['Alta resistência', 'Praticidade na aplicação', 'Excelente aderência'])
    // Spec por contenção na descrição confirmada; "Produto" (34 caracteres) não cabe na caixa; "Branco ou preto" não está escrito.
    expect(r.missoes.find((m) => m.missao === 5)?.specs).toEqual([
      { campo: 'descricao_ml', rotulo: 'Composição', valor: '100% poliéster' },
      { campo: 'descricao_ml', rotulo: 'Metragem', valor: '25 metros' },
    ])
    expect(r.missoes.find((m) => m.missao === 5)?.subheadline).toBeUndefined()
    // fatosUsados podado aos utilizáveis citados.
    expect(r.missoes.find((m) => m.missao === 2)?.fatosUsados).toEqual(['descricao_fornecedor', 'descricao_ml'])
    semErroNasAtivas(r, fatos)
    expect(validarRoteiro(r, fatos, false, ['frente'])).toEqual([])
  })

  it('missões travadas pela lupa nem vão ao modelo; schema por missão (sem os 7 campos em todas)', async () => {
    await gerar(retornoFita(), fatosFita())
    const corpo = ia.create.mock.calls.at(-1)![0]
    const dados = dadosEnviados()
    expect(dados.missoes.map((m: { missao: number }) => m.missao)).toEqual([1, 2, 4, 5, 6])
    expect(dados.missoes.find((m: { missao: number }) => m.missao === 4)).toMatchObject({ campos: ['headline', 'beneficios'], capacidade: { beneficios: 3 } })
    const ramos = corpo.response_format.json_schema.schema.properties.missoes.items.anyOf
    const ramo4 = ramos.find((x: { properties: { missao: { enum: number[] } } }) => x.properties.missao.enum[0] === 4)
    expect([...ramo4.required].sort()).toEqual(['beneficios', 'cena', 'fatosUsados', 'headline', 'missao'])
    // Medida da embalagem (R8.1) nunca é candidata a spec.
    const m5 = dados.missoes.find((m: { missao: number }) => m.missao === 5)
    expect(JSON.stringify(m5)).not.toMatch(/largura_cm|peso_gramas|altura_cm|comprimento_cm/)
  })

  it('Como usar sem oração candidata nos fatos confirmados nasce desligada e não vai ao modelo', async () => {
    const fatos = [fato('nome', 'Fita'), fato('atributo:MATERIAL', '100% poliéster')]
    const r = await gerar({ contrato: 'Fita', missoes: [{ missao: 1, cena: 'capa', fatosUsados: [] }] }, fatos)
    expect(r.missoes.find((m) => m.missao === 6)).toMatchObject({ ativa: false, motivoDesligada: expect.stringMatching(/etapa/i) })
    expect(dadosEnviados().missoes.map((m: { missao: number }) => m.missao)).not.toContain(6)
  })

  it('etapa candidata vinda de descricao_fornecedor: oferecida ao modelo e aceita; a inventada cai', async () => {
    const r = await gerar({
      contrato: 'Renda', missoes: [
        { missao: 1, cena: 'capa', fatosUsados: [] },
        { missao: 6, cena: 'mãos lavando', headline: 'Cuidados', etapas: ['Lavar à mão em água fria', 'Secar à sombra', 'Passe a ferro quente'], fatosUsados: [] },
      ],
    }, FATOS)
    expect(dadosEnviados().missoes.find((m: { missao: number }) => m.missao === 6).etapas_permitidas)
      .toEqual(expect.arrayContaining(['Lavar à mão em água fria', 'Secar à sombra']))
    expect(r.missoes.find((m) => m.missao === 6)).toMatchObject({
      ativa: true, etapas: ['Lavar à mão em água fria', 'Secar à sombra'], fatosUsados: ['descricao_fornecedor'],
    })
    semErroNasAtivas(r, FATOS)
  })

  it('invariante: N retornos sujos → zero erro (servidor + largura) em toda missão ativa', async () => {
    const sujos: Array<(x: ReturnType<typeof retornoFita>) => void> = [
      () => {},
      (x) => { x.missoes[1].legendas = ['a', 'b', 'c'] }, // campo fora do layout
      (x) => { x.missoes[3].beneficios = ['Frete grátis para todo o Brasil', 'Qualidade premium', 'Rolo com 50 metros', 'Alta resistência', 'Excelente aderência', 'Praticidade na aplicação'] },
      (x) => { x.missoes[3].headline = 'Fita premium com frete grátis' },
      (x) => { x.missoes[1].headline = 'Rolo com 50 metros' },
      (x) => { x.missoes[1].fatosUsados = ['titulo_ml', 'atributo:BRAND', 'campo_que_nao_existe'] },
      (x) => { x.missoes[0].headline = 'Texto na capa' },
      (x) => { x.missoes[4].specs = [{ campo: 'largura_cm', rotulo: 'Largura', valor: '24,5 cm' }, { campo: 'titulo_ml', rotulo: 'Título', valor: 'FITAS VELUDO' }, { campo: 'atributo:MATERIAL', rotulo: 'Material', valor: '100% algodão' }] },
      (x) => { x.missoes[4].specs = [{ campo: 'descricao_ml', rotulo: 'Composição do tecido', valor: '100% poliéster' }] }, // rótulo largo e sem tabela
      (x) => { x.missoes[1].headline = 'Uma fita de veludo realmente muito versátil' }, // headline longo demais
      (x) => { x.missoes[2].cena = ''; x.missoes[1].cena = '' },
      (x) => { x.missoes.splice(3, 1) }, // missão omitida
    ]
    for (const sujar of sujos) {
      const fatos = fatosFita()
      const x = retornoFita()
      sujar(x)
      const r = await gerar(x, fatos)
      semErroNasAtivas(r, fatos)
      for (const m of r.missoes.filter((y) => !y.ativa)) expect(m.motivoDesligada, `missão ${m.missao}`).toBeTruthy()
    }
  })

  it('Moda: tudo sem texto, recortes travados pela lupa nascem desligados, sem erro nas ativas', async () => {
    const r = await gerar(retornoFita(), fatosFita(), true)
    expect(r.missoes.filter((m) => !m.ativa).map((m) => m.missao)).toEqual(expect.arrayContaining([5, 7]))
    semErroNasAtivas(r, fatosFita(), true)
  })

  it('spec "100% poliéster" ancorada no atributo MATERIAL confirmado confere; rótulo curto vem do código', async () => {
    const fatos = [...fatosFita().filter((f) => f.campo !== 'atributo:MATERIAL'), fato('atributo:MATERIAL', '100% poliéster')]
    const x = retornoFita()
    x.missoes[4].specs = [{ campo: 'atributo:MATERIAL', rotulo: 'Composição do tecido', valor: '100% Poliéster' }]
    const r = await gerar(x, fatos)
    expect(r.missoes.find((m) => m.missao === 5)?.specs).toEqual([{ campo: 'atributo:MATERIAL', rotulo: 'Material', valor: '100% Poliéster' }])
    semErroNasAtivas(r, fatos)
  })
})

describe('validarRoteiro: ancoragem e regras da Fase A', () => {
  const ficha = (specs: Roteiro['missoes'][number]['specs']): Roteiro => ({ categoria: 'x', contrato: 'Fita', missoes: [
    { missao: 1, ativa: true, cena: 'capa', fatosUsados: [] },
    { missao: 5, ativa: true, cena: 'ficha', headline: 'Dados do produto', specs, fatosUsados: [] },
  ] })

  it('spec por contenção normalizada no fato citado; trecho que não está escrito não ancora', () => {
    const fatos = fatosFita()
    expect(validarRoteiro(ficha([{ campo: 'descricao_ml', rotulo: 'Composição', valor: '100% POLIESTER' }]), fatos, false)).toEqual([])
    expect(validarRoteiro(ficha([{ campo: 'descricao_ml', rotulo: 'Cores', valor: 'Branco ou preto' }]), fatos, false))
      .toEqual([expect.stringMatching(/descricao_ml.*difere/)])
    // Borda de palavra: "5 metros" não está dentro de "25 metros".
    expect(validarRoteiro(ficha([{ campo: 'descricao_ml', rotulo: 'Metragem', valor: '5 metros' }]), fatos, false))
      .toEqual([expect.stringMatching(/difere/)])
  })

  it('medida da embalagem não vira spec (R8.1)', () => {
    expect(validarRoteiro(ficha([{ campo: 'largura_cm', rotulo: 'Largura', valor: '24.50' }]), fatosFita(), false))
      .toEqual([expect.stringMatching(/largura_cm.*embalagem/)])
  })

  it('recorte (missão 7 geral) não exige cena', () => {
    const r: Roteiro = { categoria: 'x', contrato: 'Renda', missoes: [
      { missao: 1, ativa: true, cena: 'capa', fatosUsados: [] },
      { missao: 7, ativa: true, cena: '', headline: 'Renda Búfalo', fatosUsados: ['nome'] },
    ] }
    expect(validarRoteiro(r, FATOS, false)).toEqual([])
  })

  it('etapa de linha com marcador ("✔ Fechamentos de roupas") casa sem o marcador', () => {
    const r: Roteiro = { categoria: 'x', contrato: 'Fita', missoes: [
      { missao: 1, ativa: true, cena: 'capa', fatosUsados: [] },
      { missao: 6, ativa: true, cena: 'uso', headline: 'Como usar', etapas: ['Fechamentos de roupas'], fatosUsados: ['descricao_ml'] },
    ] }
    expect(validarRoteiro(r, fatosFita(), false)).toEqual([])
  })
})

describe('sanearRoteiro: motivo de missão desligada', () => {
  it('fica enquanto a missão está desligada; some ao religar', () => {
    const r = sanearRoteiro({ contrato: 'c', missoes: [
      { missao: 1, ativa: true, cena: 'capa', fatosUsados: [], motivoDesligada: 'x' },
      { missao: 3, ativa: false, cena: 'c', fatosUsados: [], motivoDesligada: 'Lupa em ajuste' },
    ] }, 'Rendas')!
    expect(r.missoes.map((m) => m.motivoDesligada)).toEqual([undefined, 'Lupa em ajuste'])
  })
})

// Fix round 1 (revisão Grok da Fase A): contenção não aceita fragmento; spec fora do nome; capa obrigatória.
describe('ancoragem sem fragmento (fix round 1)', () => {
  const ficha = (specs: Roteiro['missoes'][number]['specs']): Roteiro => ({ categoria: 'x', contrato: 'Fita', missoes: [
    { missao: 1, ativa: true, cena: 'capa', fatosUsados: [] },
    { missao: 5, ativa: true, cena: 'ficha', headline: 'Dados do produto', specs, fatosUsados: [] },
  ] })
  const confirmados = () => [...fatosFita().filter((f) => !['atributo:WIDTH', 'atributo:MATERIAL'].includes(f.campo)),
    fato('atributo:WIDTH', '16 mm'), fato('atributo:MATERIAL', '100% poliéster')]

  it('atributo curto exige o valor inteiro: "16" × "16 mm" e "100" × "100% poliéster" recusados', () => {
    const fatos = confirmados()
    expect(validarRoteiro(ficha([{ campo: 'atributo:WIDTH', rotulo: 'Largura', valor: '16' }]), fatos, false)).toEqual([expect.stringMatching(/difere/)])
    expect(validarRoteiro(ficha([{ campo: 'atributo:MATERIAL', rotulo: 'Material', valor: '100' }]), fatos, false)).toEqual([expect.stringMatching(/difere/)])
    expect(validarRoteiro(ficha([{ campo: 'atributo:WIDTH', rotulo: 'Largura', valor: '16mm' }]), fatos, false)).toEqual([])
  })

  it('descrição: número cortado da unidade não ancora', () => {
    const fatos = fatosFita()
    for (const valor of ['100', '16', '25', 'metros']) { // cores: regra própria (fix round 3)
      expect(validarRoteiro(ficha([{ campo: 'descricao_ml', rotulo: 'X', valor }]), fatos, false), valor).toEqual([expect.stringMatching(/difere/)])
    }
    for (const valor of ['100% poliéster', '25 metros']) {
      expect(validarRoteiro(ficha([{ campo: 'descricao_ml', rotulo: 'X', valor }]), fatos, false), valor).toEqual([])
    }
  })

  it('benefício "algodão" em "Não contém algodão." é recusado na poda; o da oração afirmativa fica', async () => {
    const fatos = [fato('nome', 'Fita'), fato('descricao_fornecedor', 'Não contém algodão. Toque macio.')]
    ia.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ contrato: 'Fita', missoes: [
      { missao: 1, cena: 'capa', fatosUsados: [] },
      { missao: 4, cena: 'mesa', headline: 'Fita', beneficios: ['algodão', 'Toque macio'], fatosUsados: [] },
    ] }) } }] })
    const r = await gerarRoteiroIA({ modelo: 'm', categoria: 'x', moda: false, vistas: ['frente'], fatos })
    expect(r.missoes.find((m) => m.missao === 4)).toMatchObject({ ativa: true, beneficios: ['Toque macio'] })
  })

  it('spec não ancora no fato nome ("Produto: 16MM" recortado do nome)', async () => {
    expect(validarRoteiro(ficha([{ campo: 'nome', rotulo: 'Produto', valor: '16MM' }]), fatosFita(), false))
      .toEqual(expect.arrayContaining([expect.stringMatching(/"nome".*não vira spec/)]))
    const x = retornoFita()
    x.missoes[4].specs = [{ campo: 'nome', rotulo: 'Produto', valor: '16MM' }, { campo: 'descricao_ml', rotulo: 'Metragem', valor: '25 metros' }]
    ia.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(x) } }] })
    const r = await gerarRoteiroIA({ modelo: 'm', categoria: 'x', moda: false, vistas: ['frente'], fatos: fatosFita() })
    expect(r.missoes.find((m) => m.missao === 5)?.specs).toEqual([{ campo: 'descricao_ml', rotulo: 'Metragem', valor: '25 metros' }])
    const dados = JSON.parse(ia.create.mock.calls.at(-1)![0].messages[1].content.replace(/^DATA \(JSON\):\n/, ''))
    expect(dados.missoes.find((m: { missao: number }) => m.missao === 5).fatos_para_spec).not.toContain('nome')
  })

  it('capa omitida, capa sem cena ou contrato vazio → roteiro_ia_invalido (a capa não desliga, R5.2)', async () => {
    const sujos: Array<(x: ReturnType<typeof retornoFita>) => void> = [
      (x) => { x.missoes.splice(0, 1) },
      (x) => { x.missoes[0].cena = '  ' },
      (x) => { x.contrato = '' },
    ]
    for (const sujar of sujos) {
      const x = retornoFita()
      sujar(x)
      ia.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(x) } }] })
      await expect(gerarRoteiroIA({ modelo: 'm', categoria: 'x', moda: false, vistas: ['frente'], fatos: fatosFita() })).rejects.toThrow(/roteiro_ia_invalido/)
    }
  })

  it('missão nascida desligada não guarda texto residual', async () => {
    const r = await (async () => {
      ia.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(retornoFita()) } }] })
      return gerarRoteiroIA({ modelo: 'm', categoria: 'x', moda: false, vistas: ['frente'], fatos: fatosFita() })
    })()
    for (const m of r.missoes.filter((y) => !y.ativa)) {
      expect(m, `missão ${m.missao}`).not.toHaveProperty('headline')
      expect(m).not.toHaveProperty('subheadline')
      expect(m).not.toHaveProperty('etapas')
      expect(m).not.toHaveProperty('specs')
      expect(m.fatosUsados).toEqual([])
    }
  })
})

// Fix round 3 (decisão do controller): sem heurística de seção. Nome de QUALQUER cor do anúncio no texto da imagem é
// recusado — o roteiro vale para todas as cores; a cor de cada imagem vai pela foto/cena. "sem" corta só o que vem depois.
describe('cores do anúncio nunca ancoram texto (fix round 3)', () => {
  const CORES = ['Branco', 'Preto']
  const comBeneficios = async (descricao: string, beneficios: string[], cores = CORES) => {
    ia.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ contrato: 'Fita', missoes: [
      { missao: 1, cena: 'capa', fatosUsados: [] },
      { missao: 4, cena: 'mesa', headline: 'Fita', beneficios, fatosUsados: [] },
    ] }) } }] })
    const r = await gerarRoteiroIA({ modelo: 'm', categoria: 'x', moda: false, vistas: ['frente'], fatos: [fato('nome', 'Fita'), fato('descricao_fornecedor', descricao)], cores })
    return r.missoes.find((m) => m.missao === 4)!
  }
  const ficha = (valor: string): Roteiro => ({ categoria: 'x', contrato: 'Fita', missoes: [
    { missao: 1, ativa: true, cena: 'capa', fatosUsados: [] },
    { missao: 5, ativa: true, cena: 'ficha', headline: 'Dados do produto', specs: [{ campo: 'descricao_ml', rotulo: 'X', valor }], fatosUsados: [] },
  ] })

  it('"Modelo clássico: alta resistência" → "alta resistência" ancora', async () => {
    expect(await comBeneficios('Modelo clássico: alta resistência', ['Alta resistência'])).toMatchObject({ ativa: true, beneficios: ['Alta resistência'] })
  })

  it('"Cores disponíveis." + "- Branco", título longo + "- Preto" e "Branco ou preto" → recusados', async () => {
    expect((await comBeneficios('Cores disponíveis.\n- Branco\nToque macio.', ['Branco', 'Toque macio'])).beneficios).toEqual(['Toque macio'])
    expect((await comBeneficios('Cores disponíveis para todos os pedidos da loja\n- Preto\nToque macio.', ['Preto', 'Toque macio'])).beneficios).toEqual(['Toque macio'])
    expect((await comBeneficios('Branco ou preto. Toque macio.', ['Branco ou preto', 'Toque macio'])).beneficios).toEqual(['Toque macio'])
  })

  it('descrição real da Fita: benefícios aceitos, cores recusadas (validador)', () => {
    const fatos = fatosFita()
    for (const v of ['Branco', 'Preto', 'Branco ou preto']) {
      expect(validarRoteiro(ficha(v), fatos, false, ['frente'], CORES), v).toEqual(expect.arrayContaining([expect.stringMatching(/cor do anúncio/)]))
    }
    for (const v of ['Alta resistência', 'Excelente aderência', 'Discrição no visual']) expect(validarRoteiro(ficha(v), fatos, false, ['frente'], CORES), v).toEqual([])
  })

  it('título com cor do anúncio desliga a missão (texto vale para todas as cores)', async () => {
    const x = retornoFita()
    x.missoes[1].headline = 'Fita preta versátil'
    x.missoes[3].headline = 'Fita Preto versátil'
    ia.create.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(x) } }] })
    const r = await gerarRoteiroIA({ modelo: 'm', categoria: 'x', moda: false, vistas: ['frente'], fatos: fatosFita(), cores: CORES })
    expect(r.missoes.find((m) => m.missao === 4)).toMatchObject({ ativa: false, motivoDesligada: expect.stringMatching(/cor do anúncio/) })
    // ponytail: comparação por palavra inteira — "preta" (flexão) não é o nome cadastrado "Preto" e passa.
    expect(r.missoes.find((m) => m.missao === 2)?.ativa).toBe(true)
  })

  it('intencional: cor "Rosa" recusa "Acabamento rosa vibrante" mesmo sendo a cor do produto', async () => {
    expect((await comBeneficios('Acabamento rosa vibrante. Toque macio.', ['Acabamento rosa vibrante', 'Toque macio'], ['Rosa'])).beneficios).toEqual(['Toque macio'])
  })

  it('"sem": aceita o trecho antes dele, recusa o depois; não/nunca seguem derrubando a oração', async () => {
    expect((await comBeneficios('Excelente aderência sem pesar no visual.', ['Excelente aderência', 'pesar no visual'])).beneficios).toEqual(['Excelente aderência'])
    expect((await comBeneficios('Algodão não incluso.\nToque macio.', ['Algodão', 'Toque macio'])).beneficios).toEqual(['Toque macio'])
  })
})
