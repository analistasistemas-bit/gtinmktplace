import { describe, expect, it } from 'vitest'
import type { ItemElegibilidade } from '../alvos'
import { CORPO_MINIMO, fotosDaCorNoItem, planejarFotosItem, type EntradaIda, type EntradaVolta } from '../aplicar'

// Legacy Rosa (var 11) + Azul (var 12); 'CAPA' é comum às duas; 'SOLTA' só no item (nenhuma variação a usa).
const legacy = (extra: Partial<ItemElegibilidade> = {}): ItemElegibilidade => ({
  id: 'MLB1', catalogListing: false, tags: [], sku: null,
  pictures: ['CAPA', 'R1', 'R2', 'A1', 'SOLTA'],
  variacoes: [{ id: 11, sku: '100R', pictureIds: ['CAPA', 'R1', 'R2'] }, { id: 12, sku: '100A', pictureIds: ['CAPA', 'A1'] }],
  ...extra,
})
const plano = (pictures: string[], extra: Partial<ItemElegibilidade> = {}): ItemElegibilidade => ({
  id: 'MLB-P', catalogListing: false, tags: [], sku: '100P', pictures, variacoes: [], ...extra,
})
const retratoDe = (i: ItemElegibilidade) => ({ pictures: [...i.pictures], variacoes: i.variacoes.map((v) => ({ ...v, pictureIds: [...v.pictureIds] })) })
const MANIFESTO = [1, 2, 3, 4, 5, 6, 7].map((m) => ({ missao: m, id: `N${m}` }))

function ida(atual: ItemElegibilidade, extra: Partial<EntradaIda> = {}): EntradaIda {
  const alvo = atual.variacoes.length ? [{ sku: '100R', variationId: 11 }] : [{ sku: '100P', variationId: null }]
  return { direcao: 'ida', atual, retrato: retratoDe(atual), variacoesAlvo: alvo, fotosDaCor: MANIFESTO,
    capaAprovada: true, modo: 'substituir', limiteVar: 10, limiteItem: 12, ...extra }
}

const SEM_ESCRITA_PROIBIDA = (corpo: Record<string, unknown>) => {
  const json = JSON.stringify(corpo)
  for (const k of ['price', 'status', 'available_quantity']) expect(json).not.toContain(`"${k}"`)
}

describe('planejarFotosItem — ida', () => {
  it('Rosa+Azul, substituir Rosa → Azul com os ids atuais; novas no lugar da 1ª foto removida, órfã preservada', () => {
    const r = planejarFotosItem(ida(legacy()))
    expect(r).toEqual({ ok: true, corpo: {
      pictures: ['CAPA', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'A1', 'SOLTA'].map((id) => ({ id })),
      variations: [
        { id: 11, picture_ids: ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'] },
        { id: 12, picture_ids: ['CAPA', 'A1'] },
      ],
    } })
    if (r.ok) {
      SEM_ESCRITA_PROIBIDA(r.corpo)
      expect(Object.keys(r.corpo).sort()).toEqual([...CORPO_MINIMO.legacy].sort())
    }
  })

  it('manifesto embaralhado → ordem 1..7', () => {
    const r = planejarFotosItem(ida(legacy(), { fotosDaCor: [...MANIFESTO].reverse() }))
    expect(r.ok && r.corpo.variations?.[0].picture_ids).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'])
  })

  it('sem capa aprovada a 1ª foto atual fica na posição 1', () => {
    const r = planejarFotosItem(ida(legacy(), { capaAprovada: false, fotosDaCor: MANIFESTO.slice(1) }))
    expect(r.ok && r.corpo.variations?.[0].picture_ids).toEqual(['CAPA', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'])
  })

  it('cor sem foto, sem capa aprovada → só o manifesto', () => {
    const a = legacy({ variacoes: [{ id: 11, sku: '100R', pictureIds: [] }, { id: 12, sku: '100A', pictureIds: ['A1'] }], pictures: ['A1'] })
    const r = planejarFotosItem(ida(a, { capaAprovada: false, fotosDaCor: MANIFESTO.slice(1, 3) }))
    expect(r.ok && r.corpo.variations?.[0].picture_ids).toEqual(['N2', 'N3'])
  })

  it('adicionar 4+7 com limite 10 → limite; 3+7 cabe', () => {
    const quatro = legacy({ variacoes: [{ id: 11, sku: '100R', pictureIds: ['R1', 'R2', 'R3', 'R4'] }, { id: 12, sku: '100A', pictureIds: ['A1'] }] })
    expect(planejarFotosItem(ida(quatro, { modo: 'adicionar' }))).toMatchObject({ ok: false, motivo: 'limite' })
    const r = planejarFotosItem(ida(legacy(), { modo: 'adicionar' }))
    expect(r.ok && r.corpo.variations?.[0].picture_ids).toEqual(['CAPA', 'R1', 'R2', 'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'])
  })

  it('UP plano: limite do item (12) e corpo só { pictures }', () => {
    const r = planejarFotosItem(ida(plano(['F1', 'F2']), { capaAprovada: false, fotosDaCor: MANIFESTO.slice(1) }))
    expect(r).toEqual({ ok: true, corpo: { pictures: ['F1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'].map((id) => ({ id })) } })
    if (r.ok) expect(Object.keys(r.corpo)).toEqual([...CORPO_MINIMO.plano])
    const seis = plano(['F1', 'F2', 'F3', 'F4', 'F5', 'F6'])
    expect(planejarFotosItem(ida(seis, { modo: 'adicionar' }))).toMatchObject({ ok: false, motivo: 'limite' })
  })

  it('ordem de tags mudou com fotos iguais (efeito de PUT de estoque, ensaio (g)) → não é mudou', () => {
    const e = ida(legacy({ tags: ['a', 'b'] }))
    expect(planejarFotosItem({ ...e, atual: legacy({ tags: ['b', 'a'] }) }).ok).toBe(true)
  })

  it('cor-alvo dona de pictures[0] → capa nova em pictures[0]', () => {
    const a = legacy({ pictures: ['R1', 'R2', 'A1', 'A2'],
      variacoes: [{ id: 11, sku: '100R', pictureIds: ['R1', 'R2'] }, { id: 12, sku: '100A', pictureIds: ['A1', 'A2'] }] })
    const r = planejarFotosItem(ida(a, { fotosDaCor: MANIFESTO.slice(0, 2) }))
    expect(r.ok && r.corpo.pictures.map((p) => p.id)).toEqual(['N1', 'N2', 'A1', 'A2'])
  })

  it('foto da Azul mudou → mudou', () => {
    const e = ida(legacy())
    const atual = legacy({ variacoes: [{ id: 11, sku: '100R', pictureIds: ['CAPA', 'R1', 'R2'] }, { id: 12, sku: '100A', pictureIds: ['CAPA', 'A9'] }] })
    expect(planejarFotosItem({ ...e, atual })).toMatchObject({ ok: false, motivo: 'mudou' })
  })

  it('variação nova no item (conjunto de ids mudou) → mudou', () => {
    const e = ida(legacy())
    const atual = legacy()
    atual.variacoes.push({ id: 13, sku: '100V', pictureIds: [] })
    expect(planejarFotosItem({ ...e, atual })).toMatchObject({ ok: false, motivo: 'mudou' })
  })

  it.each([['trocada', ['F1', 'F9']], ['reordenada', ['F2', 'F1']]])('UP plano com foto %s entre preparar e aplicar → mudou', (_n, agora) => {
    const e = ida(plano(['F1', 'F2']))
    expect(planejarFotosItem({ ...e, atual: plano(agora) })).toMatchObject({ ok: false, motivo: 'mudou' })
  })

  it('catalog_listing verdadeiro → catalogo; ausente → catalogo_desconhecido; migration pending → migracao_pendente', () => {
    expect(planejarFotosItem(ida(legacy({ catalogListing: true })))).toMatchObject({ ok: false, motivo: 'catalogo' })
    expect(planejarFotosItem(ida(legacy({ catalogListing: null })))).toMatchObject({ ok: false, motivo: 'catalogo_desconhecido' })
    expect(planejarFotosItem(ida(legacy({ tags: ['variations_migration_pending'] })))).toMatchObject({ ok: false, motivo: 'migracao_pendente' })
  })

  it('manifesto vazio ou capaAprovada incoerente com a missão 1 → lança (contrato quebrado, nunca PUT)', () => {
    expect(() => planejarFotosItem(ida(legacy(), { fotosDaCor: [] }))).toThrow(/manifesto/)
    expect(() => planejarFotosItem(ida(legacy(), { capaAprovada: true, fotosDaCor: MANIFESTO.slice(1) }))).toThrow(/capa/)
    expect(() => planejarFotosItem(ida(legacy(), { capaAprovada: false, fotosDaCor: MANIFESTO }))).toThrow(/capa/)
  })

  it('variação-alvo ausente no GET → variacao_ausente', () => {
    expect(planejarFotosItem(ida(legacy(), { variacoesAlvo: [{ sku: '100R', variationId: 99 }] })))
      .toMatchObject({ ok: false, motivo: 'variacao_ausente' })
    expect(planejarFotosItem(ida(legacy(), { variacoesAlvo: [{ sku: '100R', variationId: null }] })))
      .toMatchObject({ ok: false, motivo: 'variacao_ausente' })
  })
})

describe('planejarFotosItem — volta (compensação)', () => {
  const ANTES = { '100R': ['CAPA', 'R1', 'R2'] }
  const DEPOIS = { '100R': ['N1', 'N2', 'N3'] }
  const aplicado = (azul = ['CAPA', 'A1']) => legacy({
    pictures: ['CAPA', 'A1', 'SOLTA', 'N1', 'N2', 'N3', ...azul.filter((x) => !['CAPA', 'A1'].includes(x))],
    variacoes: [{ id: 11, sku: '100R', pictureIds: ['N1', 'N2', 'N3'] }, { id: 12, sku: '100A', pictureIds: azul }],
  })
  const volta = (atual: ItemElegibilidade, extra: Partial<EntradaVolta> = {}): EntradaVolta => ({
    direcao: 'volta', atual, variacoesAlvo: [{ sku: '100R', variationId: 11 }], fotosDaCor: ANTES, fotosDepois: DEPOIS,
    picturesAntes: ['CAPA', 'R1', 'R2', 'A1', 'SOLTA'], ...extra,
  })

  it('atual = fotosDepois → ok; Rosa volta para fotos_antes, Azul com os ids atuais, pictures na ordem do retrato', () => {
    const r = planejarFotosItem(volta(aplicado()))
    expect(r).toEqual({ ok: true, corpo: {
      pictures: ['CAPA', 'R1', 'R2', 'A1', 'SOLTA'].map((id) => ({ id })),
      variations: [{ id: 11, picture_ids: ['CAPA', 'R1', 'R2'] }, { id: 12, picture_ids: ['CAPA', 'A1'] }],
    } })
    if (r.ok) SEM_ESCRITA_PROIBIDA(r.corpo)
  })

  it('Azul trocada depois da aplicação → ok, Azul vai como está no GET', () => {
    const r = planejarFotosItem(volta(aplicado(['A7', 'A8'])))
    expect(r.ok && r.corpo.variations?.[1]).toEqual({ id: 12, picture_ids: ['A7', 'A8'] })
  })

  it('Rosa diferente de fotosDepois → reversao_incompleta, sem corpo', () => {
    const atual = aplicado()
    atual.variacoes[0].pictureIds = ['N1', 'N3', 'N2']
    const r = planejarFotosItem(volta(atual))
    expect(r).toMatchObject({ ok: false, motivo: 'reversao_incompleta' })
    expect('corpo' in r).toBe(false)
  })

  it('SKU-alvo sem chave em fotos_antes ou fotos_depois → reversao_incompleta (nunca restaura lista vazia)', () => {
    expect(planejarFotosItem(volta(aplicado(), { fotosDaCor: {} }))).toMatchObject({ ok: false, motivo: 'reversao_incompleta' })
    const semFoto = aplicado()
    semFoto.variacoes[0].pictureIds = []
    expect(planejarFotosItem(volta(semFoto, { fotosDepois: {} }))).toMatchObject({ ok: false, motivo: 'reversao_incompleta' })
  })

  it('ida + volta com a cor-alvo dona de pictures[0] → restaura exatamente a ordem do retrato', () => {
    const antes = legacy({ pictures: ['R1', 'R2', 'A1', 'A2'],
      variacoes: [{ id: 11, sku: '100R', pictureIds: ['R1', 'R2'] }, { id: 12, sku: '100A', pictureIds: ['A1', 'A2'] }] })
    const ida1 = planejarFotosItem(ida(antes, { fotosDaCor: MANIFESTO.slice(0, 2) }))
    if (!ida1.ok) throw new Error('ida')
    const depois = legacy({ pictures: ida1.corpo.pictures.map((p) => p.id),
      variacoes: ida1.corpo.variations!.map((v) => ({ id: v.id, sku: v.id === 11 ? '100R' : '100A', pictureIds: v.picture_ids })) })
    const r = planejarFotosItem(volta(depois, { fotosDaCor: { '100R': ['R1', 'R2'] }, fotosDepois: { '100R': ['N1', 'N2'] }, picturesAntes: antes.pictures }))
    expect(r.ok && r.corpo.pictures.map((p) => p.id)).toEqual(['R1', 'R2', 'A1', 'A2'])
  })

  it('foto que não existe no retrato vai ao fim, na ordem atual', () => {
    const r = planejarFotosItem(volta(aplicado(['A7', 'A8'])))
    expect(r.ok && r.corpo.pictures.map((p) => p.id)).toEqual(['CAPA', 'R1', 'R2', 'A1', 'SOLTA', 'A7', 'A8'])
  })

  it.each([
    ['fotos_antes com elemento vazio', { fotosDaCor: { '100R': ['CAPA', ''] } }],
    ['fotos_antes com elemento não string', { fotosDaCor: { '100R': ['CAPA', 7] } }],
    ['fotos_depois com elemento não string', { fotosDepois: { '100R': ['N1', null] } }],
    ['picturesAntes não é lista de strings', { picturesAntes: ['CAPA', 1] }],
  ])('%s → reversao_incompleta', (_n, extra) => {
    expect(planejarFotosItem(volta(aplicado(), extra as never))).toMatchObject({ ok: false, motivo: 'reversao_incompleta' })
  })

  it('cor sem foto: lista vazia presente nas duas pontas é legítima', () => {
    const semFoto = aplicado()
    semFoto.variacoes[0].pictureIds = []
    const r = planejarFotosItem(volta(semFoto, { fotosDepois: { '100R': [] }, fotosDaCor: { '100R': [] } }))
    expect(r.ok && r.corpo.variations?.[0]).toEqual({ id: 11, picture_ids: [] })
  })

  it('variação-alvo ausente no GET → reversao_incompleta', () => {
    const atual = aplicado()
    atual.variacoes.shift()
    expect(planejarFotosItem(volta(atual))).toMatchObject({ ok: false, motivo: 'reversao_incompleta' })
  })

  it('UP plano com pictures = fotosDepois → corpo { pictures: fotos_antes }', () => {
    const r = planejarFotosItem({ direcao: 'volta', atual: plano(['N1', 'N2']), variacoesAlvo: [{ sku: '100P', variationId: null }],
      fotosDaCor: { '100P': ['F1', 'F2'] }, fotosDepois: { '100P': ['N1', 'N2'] }, picturesAntes: ['F1', 'F2'] })
    expect(r).toEqual({ ok: true, corpo: { pictures: [{ id: 'F1' }, { id: 'F2' }] } })
    if (r.ok) SEM_ESCRITA_PROIBIDA(r.corpo)
  })

  it('migration pending também bloqueia a volta (PUT nessa janela é aceito e perdido, ADR-0160)', () => {
    expect(planejarFotosItem(volta(legacy({ ...aplicado(), tags: ['variations_migration_pending'] }))))
      .toMatchObject({ ok: false, motivo: 'migracao_pendente' })
  })
})

describe('fotosDaCorNoItem', () => {
  it('SKU → picture_ids da variação-alvo; UP plano → pictures do item', () => {
    expect(fotosDaCorNoItem(legacy(), [{ sku: '100R', variationId: 11 }])).toEqual({ '100R': ['CAPA', 'R1', 'R2'] })
    expect(fotosDaCorNoItem(plano(['F1']), [{ sku: '100P', variationId: null }])).toEqual({ '100P': ['F1'] })
    expect(fotosDaCorNoItem(legacy(), [{ sku: '100R', variationId: 99 }])).toBeNull()
  })
})
