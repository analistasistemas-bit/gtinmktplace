import { describe, expect, it, vi } from 'vitest'
import type { Fato } from '../fatos'

const ia = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../../ai/client.ts', () => ({ openrouterClient: () => ({ chat: { completions: { create: ia.create } } }) }))

import { cienciaPendente, gerarRoteiroIA, validarRoteiro, type Roteiro } from '../roteiro'

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
      specs: [{ campo: 'atributo:MAIN_MATERIAL', rotulo: 'Material', valor: '100% Poliamida' }, { campo: 'largura_cm', rotulo: 'Largura', valor: '20 cm' }],
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
      .toEqual([expect.stringMatching(/comprimento_cm.*varia entre os tamanhos/), expect.stringMatching(/sem fato confirmado/)])
  })

  it('fatosUsados com SUGERIDO também reprova', () => {
    expect(validarRoteiro(comMissao({ fatosUsados: ['titulo_ml'] }), FATOS, false))
      .toEqual([expect.stringMatching(/titulo_ml.*SUGERIDO/), expect.stringMatching(/sem fato confirmado/)])
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
    expect(validarRoteiro(comMissao({ fatosUsados: [] }), FATOS, false)).toEqual([expect.stringMatching(/Missão 4: .*sem fato/)])
  })

  it('missão inativa não é validada', () => {
    expect(validarRoteiro(comMissao({ ativa: false, headline: 'Renda premium com frete grátis' }), FATOS, false)).toEqual([])
  })
})

describe('cienciaPendente (R1.3: não conferido na etiqueta)', () => {
  it('fato NAO_CONFERIDO citado exige ciência; registrada, nada pendente', () => {
    const r = comMissao({ fatosUsados: ['atributo:MAIN_MATERIAL', 'marca'] })
    expect(validarRoteiro(r, FATOS, false)).toEqual([])
    expect(cienciaPendente(r, FATOS)).toEqual(['marca'])
    expect(cienciaPendente({ ...r, ciencia_nao_conferido: { campos: ['marca'], por: 'u1', em: 'x' } }, FATOS)).toEqual([])
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
        { missao: 4, cena: 'b', headline: 'Renda Búfalo', subheadline: '', beneficios: ['Leve'], specs: [], etapas: [], legendas: [], fatosUsados: ['nome'] },
      ],
    }))
    const r = await gerarRoteiroIA({ modelo: 'm', categoria: 'Rendas', moda: false, vistas: ['frente'], fatos: FATOS })
    expect(r.missoes.find((m) => m.missao === 1)?.headline).toBeUndefined()
    expect(r.missoes.find((m) => m.missao === 4)?.headline).toBe('Renda Búfalo'.normalize('NFC'))
    expect(r.missoes.find((m) => m.missao === 4)?.beneficios).toEqual(['Leve'])
    expect(r.missoes).toHaveLength(7)
  })

  it('resposta fora do formato lança (a edge não grava rascunho)', async () => {
    ia.create.mockResolvedValueOnce({ choices: [{ message: { content: 'não é json' } }] })
    await expect(gerarRoteiroIA({ modelo: 'm', categoria: 'x', moda: false, vistas: ['frente'], fatos: FATOS })).rejects.toThrow(/roteiro_ia_invalido/)
  })
})
