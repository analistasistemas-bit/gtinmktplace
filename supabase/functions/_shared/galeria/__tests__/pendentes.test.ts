// Lista "imagens prontas, não aplicadas" (aba Imagens IA de Publicados). Pura: sem banco, sem ML.
import { describe, expect, it } from 'vitest'
import { agruparPendentes } from '../pendentes'

const img = (id: string, anuncio: string, cor: string, status: string, roteiro = 'r1', missao = 1) =>
  ({ id, anuncio_externo_id: anuncio, cor, status, roteiro_id: roteiro, missao })
const apl = (anuncio: string, cor: string, status: string, ids: string[]) =>
  ({ anuncio_externo_id: anuncio, cor, status, manifesto: ids.map((imagem_id) => ({ imagem_id })) })
const ROT = new Map([['a1', 'r1'], ['a2', 'r2']])   // roteiro aprovado por anúncio

describe('agruparPendentes', () => {
  it('aprovadas sem aplicação viram uma linha por anúncio e cor, com as contagens', () => {
    const r = agruparPendentes([img('i1', 'a1', 'Branco', 'aprovada'), img('i2', 'a1', 'Branco', 'aprovada', 'r1', 2), img('i3', 'a1', 'Branco', 'gerada', 'r1', 3)], [], ROT)
    expect(r).toEqual([{ anuncio_externo_id: 'a1', cor: 'Branco', prontas: 2, aguardando_aprovacao: 1, aplicando: false }])
  })

  it('cor já aplicada (manifesto contém todas) não aparece', () => {
    const r = agruparPendentes([img('i1', 'a1', 'Branco', 'aprovada')], [apl('a1', 'Branco', 'aplicada', ['i1'])], ROT)
    expect(r).toEqual([])
  })

  it('aplicação revertida ou falha não cobre: as imagens voltam a aparecer como prontas', () => {
    for (const status of ['revertida', 'falhou', 'reversao_incompleta', 'preparada']) {
      const r = agruparPendentes([img('i1', 'a1', 'Branco', 'aprovada')], [apl('a1', 'Branco', status, ['i1'])], ROT)
      expect(r.map((x) => x.prontas), status).toEqual([1])
    }
  })

  it('imagem aprovada depois da aplicação (fora do manifesto) fica pendente', () => {
    const r = agruparPendentes([img('i1', 'a1', 'Branco', 'aprovada'), img('i2', 'a1', 'Branco', 'aprovada', 'r1', 2)], [apl('a1', 'Branco', 'aplicada', ['i1'])], ROT)
    expect(r).toEqual([{ anuncio_externo_id: 'a1', cor: 'Branco', prontas: 1, aguardando_aprovacao: 0, aplicando: false }])
  })

  it('aplicação em andamento cobre as imagens e marca a linha como aplicando só se sobrar algo; sem sobra, some', () => {
    expect(agruparPendentes([img('i1', 'a1', 'Branco', 'aprovada')], [apl('a1', 'Branco', 'em_andamento', ['i1'])], ROT)).toEqual([])
    const r = agruparPendentes([img('i1', 'a1', 'Branco', 'aprovada'), img('i2', 'a1', 'Branco', 'gerada', 'r1', 2)], [apl('a1', 'Branco', 'em_andamento', ['i1'])], ROT)
    expect(r).toEqual([{ anuncio_externo_id: 'a1', cor: 'Branco', prontas: 0, aguardando_aprovacao: 1, aplicando: true }])
  })

  it('só conta imagem do roteiro aprovado do anúncio; roteiro antigo e anúncio sem roteiro aprovado ficam de fora', () => {
    const r = agruparPendentes([
      img('i1', 'a1', 'Branco', 'aprovada', 'r-antigo'), img('i2', 'a2', 'Azul', 'aprovada', 'r2'), img('i3', 'a3', 'Rosa', 'aprovada', 'r3'),
    ], [], ROT)
    expect(r).toEqual([{ anuncio_externo_id: 'a2', cor: 'Azul', prontas: 1, aguardando_aprovacao: 0, aplicando: false }])
  })

  it('status que não é aprovada nem gerada (falhou, descartada) não conta; ordena por prontas desc e depois cor', () => {
    const r = agruparPendentes([
      img('i1', 'a1', 'Verde', 'aprovada'), img('i2', 'a1', 'Azul', 'aprovada'), img('i3', 'a1', 'Azul', 'aprovada', 'r1', 2),
      img('i4', 'a1', 'Rosa', 'falhou'), img('i5', 'a1', 'Rosa', 'descartada', 'r1', 2),
    ], [], ROT)
    expect(r.map((x) => [x.cor, x.prontas])).toEqual([['Azul', 2], ['Verde', 1]])
  })
})
