import { describe, expect, it } from 'vitest';
import {
  aplicarFiltrosAnuncios,
  FILTROS_ANUNCIOS_VAZIOS,
  temFiltroAnunciosAtivo,
} from '@/lib/sonar-filtros';
import type { ItemVendasSonar, VisitasAnuncio } from '@/lib/sonar';

const itemV2 = (over: Partial<ItemVendasSonar> = {}): ItemVendasSonar => ({
  titulo: 'X', preco: 50, vendidos: 100, link: null, imagem: null, vendedor: null,
  frete_gratis: null, loja_oficial: false, internacional: null, full: null, item_id: 'MLB1',
  catalog_product_id: null, avaliacao_nota: 4.5, avaliacao_qtd: null, posicao: 1,
  patrocinado: false, selo: null, preco_anterior: null, desconto_pct: null, flex: null, ...over,
});
const visitas = (total: number): VisitasAnuncio => ({ total, por_dia: [] });

describe('aplicarFiltrosAnuncios — D14 sobre a unidade anúncio (null nunca vira 0)', () => {
  it('FILTROS_ANUNCIOS_VAZIOS devolve todos os itens com excluidasSemDado 0', () => {
    const itens = [itemV2({ item_id: 'MLB1' }), itemV2({ item_id: 'MLB2', vendidos: null, preco: null })];
    const r = aplicarFiltrosAnuncios(itens, new Map(), FILTROS_ANUNCIOS_VAZIOS);
    expect(r.visiveis).toHaveLength(2);
    expect(r.excluidasSemDado).toBe(0);
  });

  it('minVendas: null no item EXCLUI e conta em excluidasSemDado', () => {
    const r = aplicarFiltrosAnuncios(
      [itemV2({ item_id: 'MLB1', vendidos: 500 }), itemV2({ item_id: 'MLB2', vendidos: null })],
      new Map(), { ...FILTROS_ANUNCIOS_VAZIOS, minVendas: 100 });
    expect(r.visiveis.map((i) => i.item_id)).toEqual(['MLB1']);
    expect(r.excluidasSemDado).toBe(1);
  });

  it('minVisitas: total 0 é ZERO MEDIDO (compara normal, D8); ausente/null no mapa é sem dado', () => {
    const mapa = new Map<string, VisitasAnuncio | null>([['MLB1', visitas(0)], ['MLB2', null]]);
    const r = aplicarFiltrosAnuncios(
      [itemV2({ item_id: 'MLB1' }), itemV2({ item_id: 'MLB2' }), itemV2({ item_id: 'MLB3' })],
      mapa, { ...FILTROS_ANUNCIOS_VAZIOS, minVisitas: 1 });
    expect(r.visiveis).toEqual([]);          // MLB1: 0 < 1 (medido); MLB2/MLB3: sem dado
    expect(r.excluidasSemDado).toBe(2);      // só os sem dado contam
  });

  it('faixa de preço sobre item.preco; toggles não contam em excluidasSemDado', () => {
    const r = aplicarFiltrosAnuncios(
      [itemV2({ item_id: 'MLB1', preco: 10 }), itemV2({ item_id: 'MLB2', preco: 90, patrocinado: true })],
      new Map(), { ...FILTROS_ANUNCIOS_VAZIOS, precoMin: 50, esconderPatrocinados: true });
    expect(r.visiveis).toEqual([]);
    expect(r.excluidasSemDado).toBe(0);
  });

  it('temFiltroAnunciosAtivo: vazio false, qualquer campo true', () => {
    expect(temFiltroAnunciosAtivo(FILTROS_ANUNCIOS_VAZIOS)).toBe(false);
    expect(temFiltroAnunciosAtivo({ ...FILTROS_ANUNCIOS_VAZIOS, soFull: true })).toBe(true);
    expect(temFiltroAnunciosAtivo({ ...FILTROS_ANUNCIOS_VAZIOS, minVisitas: 10 })).toBe(true);
  });
});
