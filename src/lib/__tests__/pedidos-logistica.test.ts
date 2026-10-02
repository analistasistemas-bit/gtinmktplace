import { describe, it, expect } from 'vitest';
import { agruparPorPedido } from '../pedidos-faturamento';
import { labelLogisticaEnvio } from '../ml-status';
import type { Venda } from '../faturamento';

const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 44.55, paid_amount: null,
  sale_fee_total: 0, frete_vendedor: null, liquido: 40, estorno: null, money_release_date: null,
  sacado_em: null, sacado_por: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  uf: null, cidade: null, itens: [], atualizado_em: '2026-06-20T00:00:00Z', ...over,
});

describe('agruparPorPedido — logística do envio', () => {
  it('expõe shipping_logistic do primeiro membro', () => {
    const [p] = agruparPorPedido([
      venda({ id: 'a', order_id: 1, pack_id: 9, shipping_logistic: 'xd_drop_off' }),
      venda({ id: 'b', order_id: 2, pack_id: 9, shipping_logistic: 'fulfillment' }),
    ]);
    expect(p.shipping_logistic).toBe('xd_drop_off');
  });

  it('é null quando a venda não tem logística', () => {
    expect(agruparPorPedido([venda({})])[0].shipping_logistic).toBeNull();
  });
});

describe('labelLogisticaEnvio', () => {
  it('traduz os tipos conhecidos e devolve o valor cru nos demais', () => {
    expect(labelLogisticaEnvio('fulfillment')).toBe('Full');
    expect(labelLogisticaEnvio('self_service')).toBe('Flex');
    expect(labelLogisticaEnvio('xd_drop_off')).toBe('Places');
    expect(labelLogisticaEnvio('drop_off')).toBe('Agência/Correios');
    expect(labelLogisticaEnvio('cross_docking')).toBe('Coleta');
    expect(labelLogisticaEnvio('outra_coisa')).toBe('outra_coisa');
    expect(labelLogisticaEnvio(null)).toBeNull();
  });
});
