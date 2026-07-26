import { describe, it, expect } from 'vitest';
import {
  parseWebhookNotification,
  extrairIdDoResource,
  extrairPackIdDeMensagem,
  mapearPedidoParaVenda,
  calcularLiquido,
  extrairGeo,
  extrairReceiverNome,
  escolherCompradorNome,
  preservarDadosMP,
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

describe('extrairReceiverNome', () => {
  it('extrai o nome do destinatário de destination.receiver_name (formato novo do ML)', () => {
    expect(extrairReceiverNome({ destination: { receiver_name: 'Bárbara Bertoldi' } })).toBe('Bárbara Bertoldi');
  });
  it('faz trim e devolve null para vazio/ausente/null', () => {
    expect(extrairReceiverNome({ destination: { receiver_name: '  Ana Costa  ' } })).toBe('Ana Costa');
    expect(extrairReceiverNome({ destination: { receiver_name: '   ' } })).toBeNull();
    expect(extrairReceiverNome({ destination: {} })).toBeNull();
    expect(extrairReceiverNome({ status: 'shipped' })).toBeNull();
    expect(extrairReceiverNome(null)).toBeNull();
  });
});

describe('escolherCompradorNome', () => {
  it('prioriza o nome real vindo agora', () => {
    expect(escolherCompradorNome('Leonardo Teixeira', 'Loni Giebmeier', 'Loni Giebmeier')).toBe('Leonardo Teixeira');
  });
  it('mantém o nome real já salvo quando o ML não manda o buyer nesse sync (não regride)', () => {
    expect(escolherCompradorNome(null, 'Leonardo Teixeira', 'Loni Giebmeier')).toBe('Leonardo Teixeira');
  });
  it('usa o destinatário do envio só quando nunca teve nada melhor', () => {
    expect(escolherCompradorNome(null, null, 'Loni Giebmeier')).toBe('Loni Giebmeier');
  });
  it('sem nenhuma fonte disponível → null (cai pro nick na UI)', () => {
    expect(escolherCompradorNome(null, null, null)).toBeNull();
  });
});

describe('preservarDadosMP', () => {
  it('sem dado do MP agora (null) mantém o que já estava gravado', () => {
    expect(preservarDadosMP(
      { estorno: null, money_release_date: null },
      { estorno: 12.5, money_release_date: '2026-07-30T00:00:00.000-04:00' },
    )).toEqual({ estorno: 12.5, money_release_date: '2026-07-30T00:00:00.000-04:00' });
  });
  it('dado novo do MP sobrescreve o anterior', () => {
    expect(preservarDadosMP(
      { estorno: 30, money_release_date: '2026-08-05' },
      { estorno: 12.5, money_release_date: '2026-07-30' },
    )).toEqual({ estorno: 30, money_release_date: '2026-08-05' });
  });
  it('estorno 0 sobrescreve valor antigo (estorno cancelado no MP não fica travado)', () => {
    expect(preservarDadosMP(
      { estorno: 0, money_release_date: '2026-08-05' },
      { estorno: 12.5, money_release_date: '2026-07-30' },
    )).toEqual({ estorno: 0, money_release_date: '2026-08-05' });
  });
  it('campos independentes: estorno novo entra, data null preserva a antiga', () => {
    expect(preservarDadosMP(
      { estorno: 30, money_release_date: null },
      { estorno: 12.5, money_release_date: '2026-07-30' },
    )).toEqual({ estorno: 30, money_release_date: '2026-07-30' });
  });
  it('venda nova (sem linha anterior) grava o que veio', () => {
    expect(preservarDadosMP({ estorno: 0, money_release_date: '2026-08-01' }, null))
      .toEqual({ estorno: 0, money_release_date: '2026-08-01' });
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

describe('extrairPackIdDeMensagem', () => {
  it('extrai o pack de /messages/packs/123/sellers/456 (não o seller)', () => {
    expect(extrairPackIdDeMensagem('/messages/packs/123/sellers/456')).toBe('123');
  });
  it('null quando não há segmento packs', () => {
    expect(extrairPackIdDeMensagem('/messages/999')).toBeNull();
    expect(extrairPackIdDeMensagem('')).toBeNull();
    expect(extrairPackIdDeMensagem(null)).toBeNull();
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

  // F10: o endpoint é público (verify_jwt=false) e `resource` ia cru para uma coluna coberta
  // por índice único. Um valor gigante ou com byte de controle falha o INSERT com SQLSTATE
  // != 23505, e o ramo de fail-open enfileirava assim mesmo — sem gravar linha, o throttle
  // que conta linhas nunca via o tráfego.
  it('null quando o resource passa do tamanho máximo aceitável', () => {
    const gigante = `/orders/${'A'.repeat(4000)}/123`;
    expect(parseWebhookNotification({ topic: 'orders_v2', user_id: 1, resource: gigante })).toBeNull();
  });

  it('null quando o resource tem caractere de controle ou fora do formato de path', () => {
    // O byte NUL e o caso que mais importa, e vai como escape de fonte, nunca literal: um
    // NUL cru no arquivo faz o git tratar o teste como binario e o diff some. Coluna text
    // do Postgres nao aceita NUL — era ele o gatilho do erro != 23505 que fazia o ramo de
    // fail-open enfileirar sem gravar linha.
    for (const resource of [
      '/orders/123 ',
      '/orders/12 3',
      '/orders/<script>/123',
      '/orders/123\n',
      '/orders/123\u0000',
    ]) {
      expect(parseWebhookNotification({ topic: 'orders_v2', user_id: 1, resource })).toBeNull();
    }
  });

  // extrairIdDoResource sempre aceitou barra final ('/questions/999/' → '999', teste acima),
  // então a validação não pode passar a recusá-la: seria descartar pergunta real em silêncio.
  it('aceita barra final, como o extrator de id já fazia', () => {
    expect(parseWebhookNotification({ topic: 'questions', user_id: 1, resource: '/questions/999/' })).not.toBeNull();
  });

  it('aceita os resources reais do ML (orders, questions, claims, packs de mensagem)', () => {
    for (const resource of [
      '/orders/2000003508419013',
      '/questions/12345678',
      '/post-purchase/v1/claims/5299104175',
      '/messages/packs/2000012345678/sellers/123456',
    ]) {
      expect(parseWebhookNotification({ topic: 'orders_v2', user_id: 1, resource })).not.toBeNull();
    }
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
    expect(venda.sale_fee_total).toBe(14.4); // sale_fee 7.20 é POR UNIDADE × 2 un = 14.40
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

  it('mapeia nome real do comprador a partir do buyer do pedido', () => {
    const { venda } = mapearPedidoParaVenda({
      ...pedidoBase,
      buyer: { id: 555, nickname: 'TELE859877', first_name: 'Leonardo', last_name: 'Teixeira' },
    }, {
      idsPubliai: new Set(),
      codigoResolver: () => null,
    });
    expect(venda.comprador_nome).toBe('Leonardo Teixeira');
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
    // 90.20 - (7.20 × 2 un) - 10 = 65.80
    expect(venda.liquido).toBe(65.8);
  });

  it('sem frete informado: líquido = total - comissão', () => {
    const { venda } = mapearPedidoParaVenda(pedidoBase, { idsPubliai: new Set(), codigoResolver: () => null });
    expect(venda.frete_vendedor).toBeNull();
    expect(venda.liquido).toBe(75.8); // 90.20 - (7.20 × 2 un)
  });

  it('sale_fee é POR UNIDADE: comissão total = sale_fee × quantity (regressão qty>1)', () => {
    // Caso real (pedido 2000017176641832): 3 un, sale_fee 2.06/un → tarifa ML 6.18, não 2.06.
    const pedido = {
      ...pedidoBase,
      total_amount: 36.36,
      order_items: [{ item: { id: 'MLB111', title: 'FITA', variation_id: null }, quantity: 3, unit_price: 12.12, sale_fee: 2.06 }],
    };
    const { venda, itens } = mapearPedidoParaVenda(pedido, {
      idsPubliai: new Set(['MLB111']), codigoResolver: () => '01813412', freteVendedor: 16.95,
    });
    expect(venda.sale_fee_total).toBe(6.18);      // 2.06 × 3
    expect(itens[0].sale_fee).toBe(2.06);          // item guarda o valor unitário cru
    expect(venda.liquido).toBe(13.23);             // 36.36 - 6.18 - 16.95 (= "Total" do ML)
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
      liquidoPorPayment: new Map([['1', { estorno: 2.5, releaseDate: '2026-06-24T11:00:00Z' }]]),
    });
    expect(venda.liquido).toBe(25.8); // 90.20 − (7.20 × 2 un) − 50, sem nada vindo do net do MP
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
