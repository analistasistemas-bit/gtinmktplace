import { describe, expect, it } from 'vitest'
import { aplicarEtiqueta, hashFatos, mesmoValor, montarFicha, type Fato } from '../fatos'

const base = {
  planilha: { nome: 'Renda Búfalo', marca: 'Avil', descricao_fornecedor: '' },
  medidasPorSku: {} as Record<string, Record<string, string>>,
  atributosML: [] as Array<{ id?: string; name?: string; value_name?: string }>,
  textosIA: {},
  confirmados: [],
}
const fato = (fs: Fato[], campo: string) => fs.find((f) => f.campo === campo)

describe('montarFicha', () => {
  it('coluna da planilha vira CONFIRMADO, com campo e trecho na evidência; vazio não vira fato', () => {
    const fs = montarFicha(base)
    expect(fato(fs, 'nome')).toMatchObject({ valor: 'Renda Búfalo', estado: 'CONFIRMADO', origem: 'planilha' })
    expect(fato(fs, 'nome')?.evidencia).toMatchObject({ coluna: 'nome', trecho: 'Renda Búfalo' })
    expect(fato(fs, 'descricao_fornecedor')).toBeUndefined()
  })

  // A marca "editada pelo operador" é da família inteira, não do campo: nem entra na entrada (ver o teste da edge).
  it('atributo escrito pela IA e textos da IA são SUGERIDO', () => {
    const fs = montarFicha({
      ...base,
      atributosML: [{ id: 'MAIN_MATERIAL', name: 'Material', value_name: '100% POLIÉSTER' }],
      textosIA: { titulo_ml: 'Renda Búfalo Poliéster', descricao_ml: 'Tecido 100% poliéster' },
    })
    expect(fato(fs, 'atributo:MAIN_MATERIAL')).toMatchObject({ valor: '100% POLIÉSTER', estado: 'SUGERIDO', origem: 'atributo_ml' })
    expect(fato(fs, 'titulo_ml')?.estado).toBe('SUGERIDO')
    expect(fato(fs, 'descricao_ml')?.estado).toBe('SUGERIDO')
  })

  it('confirmação do operador vira CONFIRMADO; descarte tira o fato da ficha', () => {
    const fs = montarFicha({
      ...base,
      atributosML: [{ id: 'MAIN_MATERIAL', value_name: 'Poliamida' }, { id: 'PATTERN', value_name: 'Floral' }],
      confirmados: [
        { campo: 'atributo:MAIN_MATERIAL', valor: 'Poliamida', origem: 'confirmado_operador', evidencia: { confirmado_por: 'u1' }, descartado: false },
        { campo: 'atributo:PATTERN', valor: 'Floral', origem: 'confirmado_operador', evidencia: null, descartado: true },
      ],
    })
    expect(fato(fs, 'atributo:MAIN_MATERIAL')).toMatchObject({ estado: 'CONFIRMADO', origem: 'confirmado_operador' })
    expect(fato(fs, 'atributo:PATTERN')).toBeUndefined()
  })

  it('P=60, M=62, G=64 cm de comprimento → VARIA_POR_TAMANHO; medida igual em todos → CONFIRMADO', () => {
    const fs = montarFicha({
      ...base,
      medidasPorSku: {
        P1: { comprimento_cm: '60', peso_gramas: '200' },
        M1: { comprimento_cm: '62', peso_gramas: '200' },
        G1: { comprimento_cm: '64', peso_gramas: '200' },
      },
    })
    expect(fato(fs, 'comprimento_cm')?.estado).toBe('VARIA_POR_TAMANHO')
    expect(fato(fs, 'comprimento_cm')?.evidencia).toMatchObject({ porSku: { P1: '60', M1: '62', G1: '64' } })
    expect(fato(fs, 'peso_gramas')).toMatchObject({ valor: '200', estado: 'CONFIRMADO', origem: 'planilha' })
  })

  it('medida ausente em um dos SKUs atendidos não vale para todos → VARIA_POR_TAMANHO', () => {
    const fs = montarFicha({ ...base, medidasPorSku: { P1: { altura_cm: '5' }, M1: {} } })
    expect(fato(fs, 'altura_cm')?.estado).toBe('VARIA_POR_TAMANHO')
  })
})

describe('aplicarEtiqueta', () => {
  const renda = montarFicha({ ...base, atributosML: [{ id: 'MAIN_MATERIAL', value_name: '100% POLIÉSTER' }] })

  it('renda: atributo "100% POLIÉSTER" × etiqueta "100% Poliamida" → DIVERGENTE com o valor lido e o recorte', () => {
    const fs = aplicarEtiqueta(renda, { 'atributo:MAIN_MATERIAL': { legivel: true, valor: '100% Poliamida', recorte: 'r.jpg' } })
    expect(fato(fs, 'atributo:MAIN_MATERIAL')).toMatchObject({
      estado: 'DIVERGENTE', valor: '100% POLIÉSTER', etiqueta: { legivel: true, valor: '100% Poliamida', recorte: 'r.jpg' },
    })
  })

  it('regata: "Poliamida" × "96% poliéster" → DIVERGENTE', () => {
    const regata = montarFicha({ ...base, atributosML: [{ id: 'MAIN_MATERIAL', value_name: 'Poliamida' }] })
    const fs = aplicarEtiqueta(regata, { 'atributo:MAIN_MATERIAL': { legivel: true, valor: '96% poliéster' } })
    expect(fato(fs, 'atributo:MAIN_MATERIAL')?.estado).toBe('DIVERGENTE')
  })

  it('mesmo material com e sem percentual é consistente: mantém o estado', () => {
    const fs = aplicarEtiqueta(
      montarFicha({ ...base, planilha: { composicao: 'Poliamida' } }),
      { composicao: { legivel: true, valor: '100% Poliamida' } },
    )
    expect(fato(fs, 'composicao')?.estado).toBe('CONFIRMADO')
  })

  it('etiqueta ilegível → NAO_CONFERIDO (o fato continua usável)', () => {
    const fs = aplicarEtiqueta(
      montarFicha({ ...base, planilha: { composicao: '100% Algodão' } }),
      { composicao: { legivel: false } },
    )
    expect(fato(fs, 'composicao')).toMatchObject({ estado: 'NAO_CONFERIDO', valor: '100% Algodão' })
  })

  it('"Manter cadastro" com a mesma leitura destrava: volta CONFIRMADO', () => {
    const fs = aplicarEtiqueta(
      montarFicha({
        ...base,
        atributosML: [{ id: 'MAIN_MATERIAL', value_name: '100% POLIÉSTER' }],
        confirmados: [{
          campo: 'atributo:MAIN_MATERIAL', valor: '100% POLIÉSTER', origem: 'confirmado_operador',
          evidencia: { manter_cadastro: true, etiqueta_lida: '100% Poliamida' }, descartado: false,
        }],
      }),
      { 'atributo:MAIN_MATERIAL': { legivel: true, valor: '100% Poliamida' } },
    )
    expect(fato(fs, 'atributo:MAIN_MATERIAL')?.estado).toBe('CONFIRMADO')
  })

  it('fato que só existe na etiqueta entra como SUGERIDO (nunca vira texto sozinho)', () => {
    const fs = aplicarEtiqueta(montarFicha(base), { composicao: { legivel: true, valor: '100% Poliamida' } })
    expect(fato(fs, 'composicao')).toMatchObject({ estado: 'SUGERIDO', origem: 'etiqueta', valor: '100% Poliamida' })
  })
})

describe('mesmoValor', () => {
  it('números e unidades contam: "20 mm" × "35 mm" diferem', () => {
    expect(mesmoValor('20 mm', '35 mm')).toBe(false)
    expect(mesmoValor('Largura 2 cm', 'Largura 2 m')).toBe(false)
  })
  it('composição compara o percentual de cada material', () => {
    expect(mesmoValor('90% Poliéster 10% Elastano', '10% Poliéster 90% Elastano')).toBe(false)
    expect(mesmoValor('96% poliéster e 4% elastano', '100% Poliéster')).toBe(false)
    expect(mesmoValor('Poliamida', '96% poliéster')).toBe(false)
    expect(mesmoValor('100% POLIÉSTER', '100% Poliamida')).toBe(false)
  })
  it('mesmo valor com formatação diferente é igual; só "100% X" ≡ "X"', () => {
    expect(mesmoValor('90% Poliéster 10% Elastano', 'Poliéster 90%, Elastano 10%')).toBe(true)
    expect(mesmoValor('96% poliéster e 4% elastano', '4% ELASTANO / 96% POLIESTER')).toBe(true)
    expect(mesmoValor('100% Poliamida', 'Poliamida')).toBe(true)
    expect(mesmoValor('20mm', '20 mm')).toBe(true)
    expect(mesmoValor('1,5 m', '1.5 m')).toBe(true)
    expect(mesmoValor('90% Algodão', 'Algodão')).toBe(false)
  })
  it('composição só é igual quando todos os termos casam: palavra sobrando nunca é ignorada', () => {
    expect(mesmoValor('100% Poliamida algodão', '100% Poliamida')).toBe(false)
    expect(mesmoValor('100% Poliamida, algodão', '100% Poliamida')).toBe(false)
    expect(mesmoValor('90% Poliéster 10% Elastano linho', '90% Poliéster 10% Elastano')).toBe(false)
    expect(mesmoValor('90% Poliéster, 10% Elastano, linho', '90% Poliéster 10% Elastano')).toBe(false)
    expect(mesmoValor('100% Poliamida 30', '100% Poliamida')).toBe(false)
  })
  it('ordem mista "90% A, B 10%" casa com o mesmo par em outra ordem', () => {
    expect(mesmoValor('90% Poliéster, Elastano 10%', '10% Elastano 90% Poliéster')).toBe(true)
    expect(mesmoValor('90% Poliéster, Elastano 10%', '90% Poliéster 10% Algodão')).toBe(false)
  })
  it('com % em qualquer lado, composição não reconhecida nunca é igual (sem fallback por sequência)', () => {
    expect(mesmoValor('90% Poliéster 10% Elastano linho', '90% Poliéster, 10% Elastano, linho')).toBe(false)
    expect(mesmoValor('90% Poliéster 10% Elastano', '90% Poliéster 10 Elastano')).toBe(false)
    expect(mesmoValor('Poliamida algodão', '100% Poliamida')).toBe(false)
    expect(mesmoValor('100% Poliamida algodão', '100% Poliamida algodão')).toBe(true) // material composto idêntico
    expect(mesmoValor('70% Fibra de Bambu, 30% Algodão', '30% algodao 70% fibra de bambu')).toBe(true)
  })
  it('reflexivo: texto normalizado idêntico é igual mesmo com % não reconhecido', () => {
    for (const x of ['90% Poliéster 10 Elastano', '90% Poliéster 10% Elastano linho', '100% Poliamida, algodão']) {
      expect(mesmoValor(x, x)).toBe(true)
    }
    expect(mesmoValor('90% Poliéster 10 Elastano', '90%  POLIESTER 10 elastano')).toBe(true)
    expect(mesmoValor('90% Poliéster 10 Elastano', '90% Poliéster 10% Elastano')).toBe(false)
    expect(mesmoValor('90% Poliéster 10% Elastano linho', '90% Poliéster, 10% Elastano, linho')).toBe(false)
  })
  it('manter cadastro com leitura % não reconhecida destrava; leitura mudou → DIVERGENTE de novo', () => {
    const lida = '90% Poliéster 10 Elastano'
    const ficha = montarFicha({
      ...base,
      planilha: { composicao: '100% Poliamida' },
      confirmados: [{
        campo: 'composicao', valor: '100% Poliamida', origem: 'planilha',
        evidencia: { manter_cadastro: true, etiqueta_lida: lida }, descartado: false,
      }],
    })
    expect(fato(aplicarEtiqueta(ficha, { composicao: { legivel: true, valor: lida } }), 'composicao')?.estado).toBe('CONFIRMADO')
    expect(fato(aplicarEtiqueta(ficha, { composicao: { legivel: true, valor: '90% Poliéster 10 Elastano linho' } }), 'composicao')?.estado).toBe('DIVERGENTE')
  })
  it('números pt-BR: "1.500" é milhar, "1,5" é decimal', () => {
    expect(mesmoValor('1.500 m', '1,5 m')).toBe(false)
    expect(mesmoValor('1.500 m', '1500 m')).toBe(true)
    expect(mesmoValor('1.500,5 g', '1500,5 g')).toBe(true)
  })
  it('aplicarEtiqueta com palavra sobrando na etiqueta → DIVERGENTE (nunca consistente por omissão)', () => {
    const fs = aplicarEtiqueta(
      montarFicha({ ...base, planilha: { composicao: '100% Poliamida' } }),
      { composicao: { legivel: true, valor: '100% Poliamida algodão' } },
    )
    expect(fato(fs, 'composicao')?.estado).toBe('DIVERGENTE')
  })
})

describe('hashFatos', () => {
  const fs = montarFicha({ ...base, atributosML: [{ id: 'MAIN_MATERIAL', value_name: 'Poliamida' }] })
  const refs = { 'Preto:frente': 'aaa' }
  const h = hashFatos(fs, refs)

  it('é hex de 64 e estável', () => {
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashFatos([...fs].reverse(), { ...refs })).toBe(h)
  })

  it('muda com um CONFIRMADO novo ou alterado', () => {
    expect(hashFatos([...fs, { campo: 'x', valor: '1', estado: 'CONFIRMADO', origem: 'planilha', evidencia: {} }], refs)).not.toBe(h)
    expect(hashFatos(fs.map((f) => (f.campo === 'nome' ? { ...f, valor: 'Outro' } : f)), refs)).not.toBe(h)
  })

  it('muda com o sha de uma referência', () => {
    expect(hashFatos(fs, { 'Preto:frente': 'bbb' })).not.toBe(h)
    expect(hashFatos(fs, { ...refs, 'Branco:frente': 'ccc' })).not.toBe(h)
  })

  it('não muda com SUGERIDO', () => {
    const outro = fs.map((f) => (f.estado === 'SUGERIDO' ? { ...f, valor: 'Algodão' } : f))
    expect(hashFatos([...outro, { campo: 'titulo_ml', valor: 'T', estado: 'SUGERIDO', origem: 'titulo_ml', evidencia: {} }], refs)).toBe(h)
  })
})
