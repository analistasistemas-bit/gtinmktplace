import { describe, it, expect } from 'vitest';
import { calcularKpis, marcaDagua, mesclarVendas, type Venda } from '../faturamento';

const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 0, paid_amount: null, sale_fee_total: 0,
  frete_vendedor: null, liquido: null, estorno: null, money_release_date: null, sacado_em: null, sacado_por: null,
  atualizado_em: '2026-07-01T00:00:00Z',
  currency: 'BRL', shipping_id: null, shipping_status: null,
  shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  uf: null, cidade: null, itens: [], ...over,
});

describe('calcularKpis', () => {
  it('agrega faturamento, líquido, unidades, pedidos e ticket', () => {
    const k = calcularKpis([
      venda({ total_amount: 90.2, liquido: 83, itens: [{ id: 'a', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 2, unit_price: 45.1, sale_fee: 7.2, is_publiai: true }] }),
      venda({ total_amount: 10, liquido: 9, itens: [{ id: 'b', ml_item_id: 'N', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 1, unit_price: 10, sale_fee: 1, is_publiai: false }] }),
    ]);
    expect(k.faturamento).toBe(100.2);
    expect(k.liquido).toBe(92);
    expect(k.unidades).toBe(3);
    expect(k.pedidos).toBe(2);
    expect(k.ticket).toBe(50.1);
  });
  it('ignora pedidos não pagos (cancelado) no faturamento', () => {
    const k = calcularKpis([
      venda({ status: 'paid', total_amount: 50, liquido: 45, itens: [{ id: 'a', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 1, unit_price: 50, sale_fee: 5, is_publiai: true }] }),
      venda({ status: 'cancelled', total_amount: 999, liquido: 900, itens: [{ id: 'b', ml_item_id: 'N', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 9, unit_price: 111, sale_fee: 99, is_publiai: false }] }),
    ]);
    expect(k.faturamento).toBe(50);
    expect(k.pedidos).toBe(1);
    expect(k.unidades).toBe(1);
  });
  it('conta venda reembolsada (partially_refunded) no faturamento, igual ML', () => {
    const k = calcularKpis([
      venda({ status: 'paid', total_amount: 50, liquido: 45, itens: [{ id: 'a', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 1, unit_price: 50, sale_fee: 5, is_publiai: true }] }),
      venda({ status: 'partially_refunded', total_amount: 25, liquido: 9.58, itens: [{ id: 'b', ml_item_id: 'N', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 2, unit_price: 12.5, sale_fee: 2, is_publiai: false }] }),
    ]);
    expect(k.faturamento).toBe(75);
    expect(k.pedidos).toBe(2);
    expect(k.unidades).toBe(3);
  });
  it('vazio → zeros e ticket 0', () => {
    expect(calcularKpis([])).toEqual({ faturamento: 0, liquido: 0, unidades: 0, pedidos: 0, ticket: 0, porStatusEnvio: {} });
  });
  it('conta TODOS os pedidos por status de envio (indep. de pagamento)', () => {
    const k = calcularKpis([
      venda({ status: 'paid', shipping_status: 'ready_to_ship' }),
      venda({ status: 'paid', shipping_status: 'ready_to_ship' }),
      venda({ status: 'paid', shipping_status: 'delivered' }),
      venda({ status: 'cancelled', shipping_status: 'shipped' }),
    ]);
    expect(k.porStatusEnvio).toEqual({ 'Pronto p/ envio': 2, 'Entregue': 1, 'Enviado': 1 });
  });
});

describe('marcaDagua', () => {
  it('vazio → null', () => {
    expect(marcaDagua([])).toBeNull();
  });
  it('parte do maior atualizado_em, recuado pela folga de 60s', () => {
    const max = marcaDagua([
      venda({ id: 'a', atualizado_em: '2026-07-01T10:00:00Z' }),
      venda({ id: 'b', atualizado_em: '2026-07-03T08:00:00Z' }),
      venda({ id: 'c', atualizado_em: '2026-07-02T12:00:00Z' }),
    ]);
    expect(max).toBe('2026-07-03T07:59:00.000Z');
  });
  // A folga existe porque `atualizado_em = now()` é o timestamp do INÍCIO da transação: uma
  // escrita que começou antes e commitou depois tem timestamp menor que outra já visível, e
  // sem a folga o delta a pularia para sempre — venda sumindo do Faturamento em silêncio.
  it('a folga cobre linha commitada fora de ordem dentro da mesma janela', () => {
    const marca = marcaDagua([venda({ id: 'b', atualizado_em: '2026-07-03T08:00:00Z' })])!;
    const atrasada = '2026-07-03T07:59:30Z'; // começou 30s antes, commitou depois
    expect(Date.parse(atrasada) >= Date.parse(marca)).toBe(true);
  });
  it('timestamp inválido não quebra o poll — devolve o valor cru', () => {
    expect(marcaDagua([venda({ id: 'a', atualizado_em: 'lixo' })])).toBe('lixo');
  });
});

describe('mesclarVendas', () => {
  it('delta vazio devolve a MESMA referência', () => {
    const atuais = [venda({ id: 'a' })];
    expect(mesclarVendas(atuais, [])).toBe(atuais);
  });
  it('substitui por id (ex.: status paid → cancelled)', () => {
    const atuais = [venda({ id: 'a', status: 'paid' })];
    const delta = [venda({ id: 'a', status: 'cancelled' })];
    const out = mesclarVendas(atuais, delta);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('cancelled');
  });
  it('insere venda nova e reordena por date_closed desc', () => {
    const atuais = [venda({ id: 'a', date_closed: '2026-07-01T00:00:00Z' })];
    const delta = [venda({ id: 'b', date_closed: '2026-07-05T00:00:00Z' })];
    const out = mesclarVendas(atuais, delta);
    expect(out.map((v) => v.id)).toEqual(['b', 'a']);
  });
  it('é idempotente: aplicar o mesmo delta duas vezes dá o mesmo resultado', () => {
    const atuais = [venda({ id: 'a', date_closed: '2026-07-01T00:00:00Z' })];
    const delta = [venda({ id: 'a', status: 'cancelled', date_closed: '2026-07-01T00:00:00Z' })];
    const uma = mesclarVendas(atuais, delta);
    const duas = mesclarVendas(uma, delta);
    expect(duas).toEqual(uma);
  });
  it('não perde vendas não tocadas pelo delta', () => {
    const atuais = [venda({ id: 'a' }), venda({ id: 'b' })];
    const delta = [venda({ id: 'a', status: 'cancelled' })];
    const out = mesclarVendas(atuais, delta);
    expect(out.map((v) => v.id).sort()).toEqual(['a', 'b']);
  });
});
