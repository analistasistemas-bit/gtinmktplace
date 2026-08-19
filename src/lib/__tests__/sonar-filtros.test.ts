import { describe, expect, it } from 'vitest';
import {
  FILTROS_VAZIOS,
  aplicarFiltros,
  temFiltroAtivo,
  type FiltrosSonar,
  aplicarFiltrosAnuncios,
  FILTROS_ANUNCIOS_VAZIOS,
  temFiltroAnunciosAtivo,
} from '@/lib/sonar-filtros';
import type { PainelSonar, ItemVendasSonar, VisitasAnuncio } from '@/lib/sonar';
import type { VendasFicha } from '@/lib/sonar-cruzamento';

type Ficha = PainelSonar['fichas'][number];

const ficha = (over: Partial<Ficha> & { product_id: string }): Ficha => ({
  nome: 'Produto', category_id: null, ofertas: 1, preco: { min: 10, mediana: 15, max: 20 },
  frete_gratis_pct: 0, visitas_30d: 100, visitas_por_dia: [], vendedores: [],
  ...over,
});

const vendasFicha = (over: Partial<VendasFicha>): VendasFicha => ({
  vendidos: null, faturamento: null, avaliacao_nota: null, avaliacao_qtd: null,
  preco_anterior: null, desconto_pct: null, selo: null, posicao_organica: null,
  patrocinado: null, full: null, flex: null, internacional: null, anuncios_casados: 0,
  ...over,
});

describe('temFiltroAtivo', () => {
  it('FILTROS_VAZIOS não está ativo', () => {
    expect(temFiltroAtivo(FILTROS_VAZIOS)).toBe(false);
  });
  it('qualquer campo setado ativa', () => {
    expect(temFiltroAtivo({ ...FILTROS_VAZIOS, minVendas: 10 })).toBe(true);
    expect(temFiltroAtivo({ ...FILTROS_VAZIOS, soFull: true })).toBe(true);
  });
});

describe('aplicarFiltros', () => {
  it('FILTROS_VAZIOS devolve todas as fichas com excluidasSemDado 0 (limpar restaura tudo)', () => {
    const fichas = [ficha({ product_id: 'A' }), ficha({ product_id: 'B' })];
    const r = aplicarFiltros(fichas, new Map(), FILTROS_VAZIOS);
    expect(r.visiveis).toHaveLength(2);
    expect(r.excluidasSemDado).toBe(0);
  });

  it('mín. vendas exclui ficha com vendidos null e conta em excluidasSemDado (D14: null nunca vira 0)', () => {
    const fichas = [ficha({ product_id: 'A' }), ficha({ product_id: 'B' })];
    const m = new Map<string, VendasFicha | null>([
      ['A', vendasFicha({ vendidos: 50 })],
      ['B', null],
    ]);
    const filtros: FiltrosSonar = { ...FILTROS_VAZIOS, minVendas: 10 };
    const r = aplicarFiltros(fichas, m, filtros);
    expect(r.visiveis.map((f) => f.product_id)).toEqual(['A']);
    expect(r.excluidasSemDado).toBe(1);
  });

  it('mín. vendas com valor abaixo do piso exclui SEM contar em excluidasSemDado (dado existe, só não passa)', () => {
    const fichas = [ficha({ product_id: 'A' })];
    const m = new Map<string, VendasFicha | null>([['A', vendasFicha({ vendidos: 5 })]]);
    const r = aplicarFiltros(fichas, m, { ...FILTROS_VAZIOS, minVendas: 10 });
    expect(r.visiveis).toHaveLength(0);
    expect(r.excluidasSemDado).toBe(0);
  });

  it('faixa de preço invertida não lança e devolve vazio', () => {
    const fichas = [ficha({ product_id: 'A' })];
    const filtros: FiltrosSonar = { ...FILTROS_VAZIOS, precoMin: 100, precoMax: 10 };
    expect(() => aplicarFiltros(fichas, new Map(), filtros)).not.toThrow();
    expect(aplicarFiltros(fichas, new Map(), filtros).visiveis).toHaveLength(0);
  });

  it('faixa de preço sem dado (ficha.preco null) exclui e conta em excluidasSemDado', () => {
    const fichas = [ficha({ product_id: 'A', preco: null })];
    const r = aplicarFiltros(fichas, new Map(), { ...FILTROS_VAZIOS, precoMin: 10 });
    expect(r.visiveis).toHaveLength(0);
    expect(r.excluidasSemDado).toBe(1);
  });

  it('toggles combinados: só FULL + esconder patrocinados', () => {
    const fichas = [ficha({ product_id: 'A' }), ficha({ product_id: 'B' }), ficha({ product_id: 'C' })];
    const m = new Map<string, VendasFicha | null>([
      ['A', vendasFicha({ full: true, patrocinado: false })], // passa
      ['B', vendasFicha({ full: true, patrocinado: true })], // patrocinado → fora
      ['C', vendasFicha({ full: false, patrocinado: false })], // não full → fora
    ]);
    const filtros: FiltrosSonar = { ...FILTROS_VAZIOS, soFull: true, esconderPatrocinados: true };
    const r = aplicarFiltros(fichas, m, filtros);
    expect(r.visiveis.map((f) => f.product_id)).toEqual(['A']);
  });

  it('esconderLojaOficial funciona sem dado da Apify (API oficial, independe de por_anuncio)', () => {
    const fichas = [
      ficha({ product_id: 'A', vendedores: [{ seller_id: 1, uf: 'SP', transacoes_total: 10, loja_oficial: true }] }),
      ficha({ product_id: 'B', vendedores: [{ seller_id: 2, uf: 'RJ', transacoes_total: 5, loja_oficial: false }] }),
    ];
    const r = aplicarFiltros(fichas, new Map(), { ...FILTROS_VAZIOS, esconderLojaOficial: true });
    expect(r.visiveis.map((f) => f.product_id)).toEqual(['B']);
  });

  it('contador correto com múltiplos filtros numéricos ativos ao mesmo tempo', () => {
    const fichas = [ficha({ product_id: 'A' }), ficha({ product_id: 'B' }), ficha({ product_id: 'C' })];
    const m = new Map<string, VendasFicha | null>([
      ['A', vendasFicha({ vendidos: 100, avaliacao_nota: 4.8 })],
      ['B', null], // sem por_anuncio nenhum → conta 1x (minVendas é checado antes e já exclui)
      ['C', vendasFicha({ vendidos: null, avaliacao_nota: 4.5 })],
    ]);
    const filtros: FiltrosSonar = { ...FILTROS_VAZIOS, minVendas: 10, minNota: 4 };
    const r = aplicarFiltros(fichas, m, filtros);
    expect(r.visiveis.map((f) => f.product_id)).toEqual(['A']);
    expect(r.excluidasSemDado).toBe(2); // B (vendidos null) + C (vendidos null)
  });
});

const itemV2 = (over: Partial<ItemVendasSonar> = {}): ItemVendasSonar => ({
  titulo: 'X', preco: 50, vendidos: 100, link: null, imagem: null, vendedor: null,
  frete_gratis: null, loja_oficial: false, internacional: null, full: null, item_id: 'MLB1',
  catalog_product_id: null, avaliacao_nota: 4.5, avaliacao_qtd: null, posicao: 1,
  patrocinado: false, selo: null, preco_anterior: null, desconto_pct: null, flex: null, ...over,
});
const visitas = (total: number): VisitasAnuncio => ({ total, por_dia: [] });

describe('aplicarFiltrosAnuncios — D14 sobre a unidade anúncio (null nunca vira 0)', () => {
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
