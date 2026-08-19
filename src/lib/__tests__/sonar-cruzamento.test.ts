import { describe, expect, it } from 'vitest';
import {
  cruzarFichaComVendas, diasDesde, espalhamentoPct, vendedorMaisForte, visitasPorOferta,
  type VendasFicha,
} from '@/lib/sonar-cruzamento';
import type { ItemVendasSonar } from '@/lib/sonar';

const item = (over: Partial<ItemVendasSonar>): ItemVendasSonar => ({
  titulo: 'Produto', preco: null, vendidos: null, link: null, imagem: null, vendedor: null,
  frete_gratis: null, loja_oficial: null, internacional: null, full: null,
  item_id: null, catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null,
  posicao: null, patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null,
  flex: null, ...over,
});

describe('cruzarFichaComVendas', () => {
  it('casa por item_id (∈ item_ids da ficha)', () => {
    const a = item({ item_id: 'MLB1', vendidos: 100, preco: 10, posicao: 1, patrocinado: false });
    const porAnuncio = { MLB1: a, MLB2: item({ item_id: 'MLB2' }) };
    const r = cruzarFichaComVendas({ product_id: 'PROD1', item_ids: ['MLB1'] }, porAnuncio);
    expect(r?.vendidos).toBe(100);
    expect(r?.anuncios_casados).toBe(1);
  });

  it('casa por catalog_product_id quando o anúncio está em catálogo (atalho D4)', () => {
    const a = item({ item_id: 'MLB9', catalog_product_id: 'PROD1', vendidos: 50, preco: 20, posicao: 2, patrocinado: false });
    const porAnuncio = { MLB9: a };
    // ficha sem item_ids batendo, mas product_id bate com catalog_product_id do anúncio
    const r = cruzarFichaComVendas({ product_id: 'PROD1', item_ids: [] }, porAnuncio);
    expect(r?.vendidos).toBe(50);
    expect(r?.anuncios_casados).toBe(1);
  });

  it('anúncio SEM catálogo casa só por item_id', () => {
    const a = item({ item_id: 'MLB5', catalog_product_id: null, vendidos: 30, posicao: 1, patrocinado: false });
    const porAnuncio = { MLB5: a };
    expect(cruzarFichaComVendas({ product_id: 'PROD1', item_ids: ['MLB5'] }, porAnuncio)?.vendidos).toBe(30);
  });

  it('nenhum candidato → null', () => {
    const porAnuncio = { MLB1: item({ item_id: 'MLB1' }) };
    expect(cruzarFichaComVendas({ product_id: 'PROD1', item_ids: ['MLBX'] }, porAnuncio)).toBeNull();
  });

  it('porAnuncio ausente (cache v4 antigo, D2) → null', () => {
    expect(cruzarFichaComVendas({ product_id: 'PROD1', item_ids: ['MLB1'] }, undefined)).toBeNull();
  });

  it('múltiplos candidatos: maior vendidos vira o principal; faturamento/avaliação/desconto do MESMO anúncio (D1)', () => {
    const fraco = item({
      item_id: 'MLB1', vendidos: 10, preco: 100, posicao: 3, patrocinado: false,
      avaliacao_nota: 4.5, desconto_pct: 5,
    });
    const forte = item({
      item_id: 'MLB2', vendidos: 900, preco: 50, posicao: 1, patrocinado: false,
      avaliacao_nota: 4.9, avaliacao_qtd: 84, preco_anterior: 60, desconto_pct: 13, selo: 'MAIS VENDIDO',
    });
    const porAnuncio = { MLB1: fraco, MLB2: forte };
    const r = cruzarFichaComVendas({ product_id: 'PROD1', item_ids: ['MLB1', 'MLB2'] }, porAnuncio) as VendasFicha;
    expect(r.vendidos).toBe(900);
    expect(r.faturamento).toBe(900 * 50); // NUNCA soma dos dois — nem preço de um com vendidos do outro
    expect(r.avaliacao_nota).toBe(4.9);
    expect(r.avaliacao_qtd).toBe(84);
    expect(r.preco_anterior).toBe(60);
    expect(r.desconto_pct).toBe(13);
    expect(r.selo).toBe('MAIS VENDIDO');
    expect(r.anuncios_casados).toBe(2);
  });

  it('empate de vendidos desempata por menor posição; empate total fica com o primeiro', () => {
    const a = item({ item_id: 'MLB1', vendidos: 100, posicao: 5, patrocinado: false });
    const b = item({ item_id: 'MLB2', vendidos: 100, posicao: 2, patrocinado: false, selo: 'X' });
    const r1 = cruzarFichaComVendas({ product_id: 'P', item_ids: ['MLB1', 'MLB2'] }, { MLB1: a, MLB2: b });
    expect(r1?.selo).toBe('X'); // b tem posição menor → é o principal

    const c = item({ item_id: 'MLB3', vendidos: 5, posicao: 1, patrocinado: false, selo: 'PRIMEIRO' });
    const d = item({ item_id: 'MLB4', vendidos: 5, posicao: 1, patrocinado: false, selo: 'SEGUNDO' });
    const r2 = cruzarFichaComVendas({ product_id: 'P', item_ids: ['MLB3', 'MLB4'] }, { MLB3: c, MLB4: d });
    expect(r2?.selo).toBe('PRIMEIRO'); // empate total → mantém o primeiro (ordem de relevância)
  });

  it('candidato sem vendidos: vendidos null, mas envio/posição ainda casam (D1/D6 — null nunca vira 0)', () => {
    const a = item({ item_id: 'MLB1', vendidos: null, posicao: 3, patrocinado: false, full: true });
    const r = cruzarFichaComVendas({ product_id: 'P', item_ids: ['MLB1'] }, { MLB1: a });
    expect(r?.vendidos).toBeNull();
    expect(r?.faturamento).toBeNull();
    expect(r?.posicao_organica).toBe(3);
    expect(r?.full).toBe(true);
  });

  it('posicao_organica ignora patrocinados e vira null quando todos pagos (D6: null não é orgânico)', () => {
    const pago = item({ item_id: 'MLB1', vendidos: 10, posicao: 1, patrocinado: true });
    const desconhecido = item({ item_id: 'MLB2', vendidos: 5, posicao: 2, patrocinado: null });
    const r = cruzarFichaComVendas({ product_id: 'P', item_ids: ['MLB1', 'MLB2'] }, { MLB1: pago, MLB2: desconhecido });
    expect(r?.posicao_organica).toBeNull();
  });

  it('patrocinado da ficha: true se algum candidato true; false se nenhum true mas algum não-null; null se todos null', () => {
    const t = item({ item_id: 'MLB1', patrocinado: true });
    const f = item({ item_id: 'MLB2', patrocinado: false });
    const n = item({ item_id: 'MLB3', patrocinado: null });
    expect(cruzarFichaComVendas({ product_id: 'P', item_ids: ['MLB1', 'MLB2'] }, { MLB1: t, MLB2: f })?.patrocinado).toBe(true);
    expect(cruzarFichaComVendas({ product_id: 'P', item_ids: ['MLB2'] }, { MLB2: f })?.patrocinado).toBe(false);
    expect(cruzarFichaComVendas({ product_id: 'P', item_ids: ['MLB3'] }, { MLB3: n })?.patrocinado).toBeNull();
  });
});

describe('espalhamentoPct', () => {
  it('(max-min)/min*100', () => {
    expect(espalhamentoPct({ min: 10, mediana: 15, max: 20 })).toBe(100);
  });
  it('min<=0 ou preco null → null', () => {
    expect(espalhamentoPct({ min: 0, mediana: 5, max: 10 })).toBeNull();
    expect(espalhamentoPct(null)).toBeNull();
  });
});

describe('visitasPorOferta', () => {
  it('divide visitas por ofertas', () => {
    expect(visitasPorOferta(100, 4)).toBe(25);
  });
  it('null quando visitas null ou ofertas 0', () => {
    expect(visitasPorOferta(null, 4)).toBeNull();
    expect(visitasPorOferta(100, 0)).toBeNull();
  });
});

describe('vendedorMaisForte', () => {
  it('maior transacoes_total não-null', () => {
    const r = vendedorMaisForte([
      { seller_id: 1, uf: 'SP', transacoes_total: 10 },
      { seller_id: 2, uf: 'RJ', transacoes_total: 50 },
      { seller_id: 3, uf: null, transacoes_total: null },
    ]);
    expect(r).toEqual({ seller_id: 2, uf: 'RJ', transacoes_total: 50 });
  });
  it('todos null → null', () => {
    expect(vendedorMaisForte([{ seller_id: 1, uf: 'SP', transacoes_total: null }])).toBeNull();
    expect(vendedorMaisForte([])).toBeNull();
  });
});

describe('diasDesde', () => {
  it('diferença em dias inteiros', () => {
    expect(diasDesde('2026-08-01T00:00:00Z', new Date('2026-08-11T00:00:00Z'))).toBe(10);
  });
  it('null → null', () => {
    expect(diasDesde(null, new Date())).toBeNull();
  });
  it('data inválida → null', () => {
    expect(diasDesde('não é data', new Date())).toBeNull();
  });
});
