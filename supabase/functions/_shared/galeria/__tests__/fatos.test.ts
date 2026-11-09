import { describe, expect, it } from 'vitest'
import { aplicarEtiqueta, hashFatos, montarFicha, type Fato } from '../fatos'

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
