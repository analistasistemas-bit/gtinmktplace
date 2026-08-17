// Regressão do bug de 2026-08-17: produto que já vendia no ML como N anúncios (um MLB por cor) e
// entrou no app com só um MLB vinculado. As vendas dos irmãos ficavam órfãs — a linha da tela
// Publicados mostrava 7 un / R$ 538,30 enquanto o produto vendera 49 un / R$ 3.757 em 90 dias.
// O critério de fusão é o GTIN (mesmo do ADR-0045 server-side), com guard de unicidade.
import { describe, it, expect } from 'vitest';
import { calcularResumo } from '../resumo-vendas';
import { topProdutos } from '../cockpit';
import { montarDetalheVendas } from '../detalhe-vendas';
import { montarMapaCanonico } from '../anuncio-canonico';
import type { Venda, VendaItem } from '../faturamento';

const DONO = 'MLB_DONO';
const IRMAO = 'MLB_IRMAO';

const item = (o: Partial<VendaItem>): VendaItem => ({
  id: 'i1', ml_item_id: DONO, variation_id: null, titulo: 'Tecido Helanca 10m', codigo: null,
  cor: null, ean: null, quantity: 1, unit_price: 76.9, sale_fee: 0, is_publiai: true, ...o,
});

const venda = (id: string, itens: VendaItem[]): Venda => ({
  id, order_id: Number(id.replace(/\D/g, '')) || 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-08-01T00:00:00Z', date_created: '2026-08-01T00:00:00Z', comprador_nick: null,
  comprador_nome: null, comprador_id: null, uf: null, cidade: null,
  total_amount: itens.reduce((s, i) => s + i.unit_price * i.quantity, 0), paid_amount: null,
  sale_fee_total: 0, frete_vendedor: null, liquido: 0, estorno: null, money_release_date: null,
  sacado_em: null, sacado_por: null, atualizado_em: '2026-08-01T00:00:00Z', currency: 'BRL',
  shipping_id: null, shipping_status: null, shipping_substatus: null, shipping_logistic: null,
  tracking_number: null, is_publiai: true, tem_devolucao: false, itens,
});

// Cadastro: as duas cores pertencem à mesma família, cujo anúncio publicado é DONO.
const canonico = montarMapaCanonico([], [], [
  { gtin: '111', familias: { ml_item_id: DONO } },
  { gtin: '222', familias: { ml_item_id: DONO } },
], [DONO]);

const vendas = [
  venda('1', [item({ id: 'a', ml_item_id: DONO, ean: '111', quantity: 7, unit_price: 76.9 })]),
  venda('2', [item({ id: 'b', ml_item_id: IRMAO, ean: '222', quantity: 27, unit_price: 76.9, titulo: 'Helanca Branco' })]),
];

describe('anúncio irmão legado (um MLB por cor)', () => {
  it('calcularResumo.porItem soma o irmão na linha do anúncio dono', () => {
    const r = calcularResumo(vendas, undefined, undefined, Date.parse('2026-08-05T00:00:00Z'), undefined, canonico);
    expect(r.porItem[DONO]).toEqual({ unidades: 34, valor: 2614.6 });
    expect(r.porItem[IRMAO]).toBeUndefined();
  });

  it('sem o mapa, o comportamento antigo se mantém (degradação segura)', () => {
    const r = calcularResumo(vendas, undefined, undefined, Date.parse('2026-08-05T00:00:00Z'));
    expect(r.porItem[DONO].unidades).toBe(7);
    expect(r.porItem[IRMAO].unidades).toBe(27);
  });

  it('topProdutos funde o irmão e mantém o título do anúncio dono', () => {
    const top = topProdutos(vendas, 5, canonico);
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ mlItemId: DONO, titulo: 'Tecido Helanca 10m', unidades: 34 });
  });

  it('montarDetalheVendas funde as duas linhas numa só', () => {
    const d = montarDetalheVendas(vendas, undefined, undefined, undefined, canonico);
    const linhas = [...d.app.linhas, ...d.externo.linhas];
    expect(linhas).toHaveLength(1);
    expect(linhas[0].unidades).toBe(34);
  });

  it('NÃO funde quando o GTIN é ambíguo (kit x unidade / split de faixa — ADR-0045)', () => {
    const ambiguo = montarMapaCanonico([], [], [
      { gtin: '222', familias: { ml_item_id: DONO } },
      { gtin: '222', familias: { ml_item_id: 'MLB_KIT' } },
    ], [DONO, 'MLB_KIT']);
    const r = calcularResumo(vendas, undefined, undefined, Date.parse('2026-08-05T00:00:00Z'), undefined, ambiguo);
    expect(r.porItem[DONO].unidades).toBe(7);
    expect(r.porItem[IRMAO].unidades).toBe(27);
  });

  it('NÃO move venda de um anúncio que o app já lista (família irmã com o mesmo GTIN)', () => {
    const outroAnuncio = 'MLB_OUTRA_FAMILIA';
    const mapa = montarMapaCanonico([], [], [{ gtin: '222', familias: { ml_item_id: DONO } }], [DONO, outroAnuncio]);
    const v = [venda('3', [item({ id: 'c', ml_item_id: outroAnuncio, ean: '222', quantity: 4 })])];
    const r = calcularResumo(v, undefined, undefined, Date.parse('2026-08-05T00:00:00Z'), undefined, mapa);
    expect(r.porItem[outroAnuncio].unidades).toBe(4);
    expect(r.porItem[DONO]).toBeUndefined();
  });
});
