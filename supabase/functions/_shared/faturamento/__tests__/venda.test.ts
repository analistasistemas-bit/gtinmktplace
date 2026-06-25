import { describe, it, expect } from 'vitest';
import {
  parseWebhookNotification,
  extrairIdDoResource,
  mapearPedidoParaVenda,
  calcularLiquido,
  extrairGeo,
} from '../venda';

describe('extrairGeo', () => {
  it('extrai cidade e UF (sem prefixo BR-) de destination.shipping_address (formato novo do ML)', () => {
    const shipment = { destination: { shipping_address: { city: { name: 'Recife' }, state: { id: 'BR-PE', name: 'Pernambuco' } } } };
    expect(extrairGeo(shipment)).toEqual({ cidade: 'Recife', uf: 'PE' });
  });
  it('fallback para receiver_address (formato antigo)', () => {
    const shipment = { receiver_address: { city: { name: 'São Paulo' }, state: { id: 'BR-SP' } } };
    expect(extrairGeo(shipment)).toEqual({ cidade: 'São Paulo', uf: 'SP' });
  });
  it('sem endereço → cidade/uf null', () => {
    expect(extrairGeo({ status: 'shipped' })).toEqual({ cidade: null, uf: null });
    expect(extrairGeo(null)).toEqual({ cidade: null, uf: null });
  });
  it('state.id sem prefixo BR- é mantido', () => {
    expect(extrairGeo({ destination: { shipping_address: { state: { id: 'SP' } } } })).toEqual({ cidade: null, uf: 'SP' });
  });
});

describe('extrairIdDoResource', () => {
  it('extrai id de /orders/123', () => {
    expect(extrairIdDoResource('/orders/123')).toBe('123');
  });
  it('extrai id de /questions/999 com barra final', () => {
    expect(extrairIdDoResource('/questions/999/')).toBe('999');
  });
  it('null para resource vazio', () => {
    expect(extrairIdDoResource('')).toBeNull();
    expect(extrairIdDoResource('/orders/')).toBeNull();
  });
});

describe('parseWebhookNotification', () => {
  it('extrai topic, resource, id e userId do payload do ML', () => {
    const ev = parseWebhookNotification({
      resource: '/orders/2000003508419013',
      user_id: 123456,
      topic: 'orders_v2',
      application_id: 7,
      attempts: 1,
      sent: '2026-06-22T10:00:00Z',
    });
    expect(ev).toEqual({
      topic: 'orders_v2',
      resource: '/orders/2000003508419013',
      resourceId: '2000003508419013',
      mlUserId: 123456,
    });
  });
  it('null quando faltam campos obrigatórios', () => {
    expect(parseWebhookNotification({})).toBeNull();
    expect(parseWebhookNotification({ topic: 'orders_v2' })).toBeNull();
    expect(parseWebhookNotification(null)).toBeNull();
  });
});

describe('calcularLiquido', () => {
  it('total - comissão - frete', () => {
    expect(calcularLiquido(100, 16, 10)).toBe(74);
  });
  it('frete null → total - comissão', () => {
    expect(calcularLiquido(100, 16, null)).toBe(84);
  });
  it('arredonda 2 casas', () => {
    expect(calcularLiquido(99.99, 16.001, 0)).toBe(83.99);
  });
});

describe('mapearPedidoParaVenda', () => {
  const pedidoBase = {
    id: 2000003508419013,
    status: 'paid',
    status_detail: null,
    pack_id: null,
    date_created: '2026-06-20T12:00:00.000-03:00',
    date_closed: '2026-06-20T12:05:00.000-03:00',
    currency_id: 'BRL',
    total_amount: 90.2,
    paid_amount: 90.2,
    buyer: { id: 555, nickname: 'COMPRADOR1' },
    shipping: { id: 40404 },
    order_items: [
      {
        item: {
          id: 'MLB111', title: 'LINHA LINHANYL 150', variation_id: 700,
          variation_attributes: [{ id: 'COLOR', name: 'Cor', value_name: 'Branco 01' }],
        },
        quantity: 2,
        unit_price: 45.1,
        sale_fee: 7.2,
      },
    ],
    payments: [{ id: 1 }],
  };

  it('mapeia pedido de 1 item do PubliAI', () => {
    const { venda, itens } = mapearPedidoParaVenda(pedidoBase, {
      idsPubliai: new Set(['MLB111']),
      codigoResolver: () => '02543826',
      eanResolver: () => '7891521371181',
    });
    expect(venda.order_id).toBe(2000003508419013);
    expect(venda.status).toBe('paid');
    expect(venda.comprador_nick).toBe('COMPRADOR1');
    expect(venda.total_amount).toBe(90.2);
    expect(venda.sale_fee_total).toBe(7.2);
    expect(venda.shipping_id).toBe(40404);
    expect(venda.is_publiai).toBe(true);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({
      ml_item_id: 'MLB111',
      variation_id: 700,
      titulo: 'LINHA LINHANYL 150',
      codigo: '02543826',
      cor: 'Branco 01',
      ean: '7891521371181',
      quantity: 2,
      unit_price: 45.1,
      sale_fee: 7.2,
      is_publiai: true,
    });
  });

  it('is_publiai=false quando nenhum item é gerenciado pelo app', () => {
    const { venda, itens } = mapearPedidoParaVenda(pedidoBase, {
      idsPubliai: new Set(['OUTRO']),
      codigoResolver: () => null,
    });
    expect(venda.is_publiai).toBe(false);
    expect(itens[0].is_publiai).toBe(false);
    expect(itens[0].codigo).toBeNull();
  });

  it('pedido multi-item soma sale_fee e marca publiai se ao menos um for do app', () => {
    const pedido = {
      ...pedidoBase,
      total_amount: 130,
      order_items: [
        { item: { id: 'MLB111', title: 'A', variation_id: null }, quantity: 1, unit_price: 80, sale_fee: 10 },
        { item: { id: 'EXT999', title: 'B', variation_id: null }, quantity: 1, unit_price: 50, sale_fee: 6 },
      ],
    };
    const { venda, itens } = mapearPedidoParaVenda(pedido, {
      idsPubliai: new Set(['MLB111']),
      codigoResolver: (id) => (id === 'MLB111' ? '001' : null),
    });
    expect(venda.sale_fee_total).toBe(16);
    expect(venda.is_publiai).toBe(true);
    expect(itens).toHaveLength(2);
    expect(itens.find((i) => i.ml_item_id === 'MLB111')?.is_publiai).toBe(true);
    expect(itens.find((i) => i.ml_item_id === 'EXT999')?.is_publiai).toBe(false);
  });

  it('aplica frete do vendedor e calcula líquido', () => {
    const { venda } = mapearPedidoParaVenda(pedidoBase, {
      idsPubliai: new Set(),
      codigoResolver: () => null,
      freteVendedor: 10,
    });
    expect(venda.frete_vendedor).toBe(10);
    // 90.20 - 7.20 - 10 = 73.00
    expect(venda.liquido).toBe(73);
  });

  it('sem frete informado: líquido = total - comissão', () => {
    const { venda } = mapearPedidoParaVenda(pedidoBase, { idsPubliai: new Set(), codigoResolver: () => null });
    expect(venda.frete_vendedor).toBeNull();
    expect(venda.liquido).toBe(83); // 90.20 - 7.20
  });

  it('venda de catálogo: casa PubliAI por GTIN quando o item.id não bate', () => {
    const pedido = {
      ...pedidoBase,
      order_items: [{ item: { id: 'MLB_CATALOGO_999', title: 'Fita X', variation_id: null }, quantity: 1, unit_price: 25, sale_fee: 4 }],
    };
    const { venda, itens } = mapearPedidoParaVenda(pedido, {
      idsPubliai: new Set(['MLB_PROPRIO']), // não contém o id de catálogo
      codigoResolver: () => null,
      gtinPorItem: new Map([['MLB_CATALOGO_999', '7891521360659']]),
      infoPorGtin: new Map([['7891521360659', { codigo: '00445975', ean: '7891521360659' }]]),
    });
    expect(venda.is_publiai).toBe(true);
    expect(itens[0].is_publiai).toBe(true);
    expect(itens[0].codigo).toBe('00445975');
    expect(itens[0].ean).toBe('7891521360659');
  });

  it('líquido é a estimativa econômica (bruto − comissão − frete); estorno/liberação vêm do MP', () => {
    // ADR-0042: o net_received_amount do MP NÃO é o líquido da venda — em envio cross-docking o
    // pagamento do item é debitado o frete CHEIO e o reembolso do comprador vem num pagamento à
    // parte (marketplace_shipment); a comissão é cobrada fora do pagamento. O líquido econômico é
    // bruto − comissão − frete real do vendedor. Estorno/liberação seguem vindo do MP.
    const { venda } = mapearPedidoParaVenda(pedidoBase, {
      idsPubliai: new Set(), codigoResolver: () => null, freteVendedor: 50,
      liquidoPorPayment: new Map([['1', { net: 6.3, estorno: 2.5, releaseDate: '2026-06-24T11:00:00Z' }]]),
    });
    expect(venda.liquido).toBe(33); // 90.20 − 7.20 − 50, ignora o net (6.3) do MP
    expect(venda.estorno).toBe(2.5);
    expect(venda.money_release_date).toBe('2026-06-24T11:00:00Z');
  });

  it('sem MP: estorno e liberação ficam null (líquido estimado)', () => {
    const { venda } = mapearPedidoParaVenda(pedidoBase, {
      idsPubliai: new Set(), codigoResolver: () => null, freteVendedor: 5,
    });
    expect(venda.estorno).toBeNull();
    expect(venda.money_release_date).toBeNull();
  });
});
