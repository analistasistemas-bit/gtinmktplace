// Venda que entra pelo anúncio de catálogo do ML (MLB próprio, ADR-0021) tem de acumular no
// anúncio dono nos agregadores por anúncio — senão o produto aparece duas vezes (Dashboard/
// Detalhe de vendas) e a linha de Publicados mostra menos unidades do que vendeu.
import { describe, it, expect } from 'vitest';
import { calcularResumo } from '../resumo-vendas';
import { montarDetalheVendas } from '../detalhe-vendas';
import type { Venda, VendaItem } from '../faturamento';

const item = (over: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: 'MEU', variation_id: null, titulo: 'Protetor Eucerin', codigo: '00000005',
  cor: null, ean: '4005800241901', quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, ...over,
});
const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 100, paid_amount: null,
  sale_fee_total: 0, frete_vendedor: null, liquido: 100, estorno: null, money_release_date: null,
  sacado_em: null, sacado_por: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: true, tem_devolucao: false,
  uf: null, cidade: null, itens: [], atualizado_em: '2026-06-20T00:00:00Z', ...over,
});

const vendas = [
  venda({ id: 'a', order_id: 1, total_amount: 300, liquido: 300,
    itens: [item({ id: 'a1', ml_item_id: 'MEU', quantity: 3, unit_price: 100 })] }),
  venda({ id: 'b', order_id: 2, total_amount: 200, liquido: 200,
    itens: [item({ id: 'b1', ml_item_id: 'CAT', titulo: 'Título do catálogo', quantity: 2, unit_price: 100 })] }),
];
const canonico = { listings: { CAT: 'MEU' } };

describe('calcularResumo.porItem', () => {
  it('soma as unidades do anúncio de catálogo na linha do anúncio dono', () => {
    const r = calcularResumo(vendas, undefined, undefined, undefined, undefined, canonico);
    expect(r.porItem).toEqual({ MEU: { unidades: 5, valor: 500 } });
  });

  it('sem mapa, mantém as duas chaves (comportamento anterior)', () => {
    const r = calcularResumo(vendas);
    expect(Object.keys(r.porItem).sort()).toEqual(['CAT', 'MEU']);
  });
});

describe('montarDetalheVendas', () => {
  it('funde as duas linhas numa só, com o título do anúncio original', () => {
    const d = montarDetalheVendas(vendas, undefined, undefined, undefined, canonico);
    expect(d.app.linhas).toHaveLength(1);
    expect(d.app.linhas[0]).toMatchObject({ id: 'MEU', titulo: 'Protetor Eucerin', unidades: 5, valor: 500 });
  });

  it('sem mapa, mantém as duas linhas e o título de cada anúncio (comportamento anterior)', () => {
    const d = montarDetalheVendas(vendas);
    expect(d.app.linhas.map((l) => l.id).sort()).toEqual(['CAT', 'MEU']);
    expect(d.app.linhas.find((l) => l.id === 'CAT')?.titulo).toBe('Título do catálogo');
  });
});
