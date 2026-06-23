import { describe, it, expect } from 'vitest';
import { agruparPorGeografia } from '@/lib/geografia-vendas';
import type { Pedido } from '@/lib/pedidos-faturamento';

/** Monta um Pedido mínimo para os testes de geografia. */
function pedido(over: Partial<Pedido> = {}): Pedido {
  return {
    chave: '1',
    isPack: false,
    orderIds: [1],
    data: '2026-06-15T00:00:00Z',
    comprador_id: null,
    comprador_nick: null,
    status: 'paid',
    statusDetail: null,
    shipping_status: null,
    shipping_substatus: null,
    uf: 'SP',
    cidade: 'São Paulo',
    unidades: 1,
    bruto: 100,
    frete: null,
    liquido: 90,
    custo: null,
    markup: null,
    comissao: 5,
    rastreio: null,
    is_publiai: true,
    tem_devolucao: false,
    itens: [],
    ...over,
  };
}

describe('agruparPorGeografia', () => {
  it('agrupa 2 UFs corretamente (pedidos, valor, pctPedidos)', () => {
    const pedidos = [
      pedido({ chave: '1', uf: 'SP', cidade: 'São Paulo', bruto: 100, unidades: 2 }),
      pedido({ chave: '2', uf: 'SP', cidade: 'Campinas',  bruto: 80,  unidades: 1 }),
      pedido({ chave: '3', uf: 'RJ', cidade: 'Rio de Janeiro', bruto: 50, unidades: 1 }),
    ];
    const geo = agruparPorGeografia(pedidos);

    expect(geo.totalPedidos).toBe(3);
    expect(geo.semGeo).toBe(0);
    expect(geo.estadosAtingidos).toBe(2);

    const sp = geo.porUf.find((u) => u.uf === 'SP')!;
    expect(sp).toBeDefined();
    expect(sp.pedidos).toBe(2);
    expect(sp.valor).toBe(180);
    expect(sp.unidades).toBe(3);
    expect(sp.pctPedidos).toBe(66.7); // 2/3 * 100, 1 casa

    const rj = geo.porUf.find((u) => u.uf === 'RJ')!;
    expect(rj.pedidos).toBe(1);
    expect(rj.pctPedidos).toBe(33.3);
  });

  it('ordena porUf por pedidos desc', () => {
    const pedidos = [
      pedido({ chave: '1', uf: 'MG', cidade: 'BH', bruto: 10, unidades: 1 }),
      pedido({ chave: '2', uf: 'SP', cidade: 'SP', bruto: 10, unidades: 1 }),
      pedido({ chave: '3', uf: 'SP', cidade: 'Campinas', bruto: 10, unidades: 1 }),
    ];
    const geo = agruparPorGeografia(pedidos);
    expect(geo.porUf[0].uf).toBe('SP');  // 2 pedidos
    expect(geo.porUf[1].uf).toBe('MG');  // 1 pedido
  });

  it('conta estadosAtingidos corretamente', () => {
    const pedidos = [
      pedido({ chave: '1', uf: 'SP', cidade: 'SP', bruto: 10, unidades: 1 }),
      pedido({ chave: '2', uf: 'SP', cidade: 'Campinas', bruto: 10, unidades: 1 }),
      pedido({ chave: '3', uf: 'RS', cidade: 'Porto Alegre', bruto: 10, unidades: 1 }),
      pedido({ chave: '4', uf: 'PR', cidade: 'Curitiba', bruto: 10, unidades: 1 }),
    ];
    const geo = agruparPorGeografia(pedidos);
    expect(geo.estadosAtingidos).toBe(3); // SP, RS, PR
  });

  it('pedido sem uf vai para semGeo e não entra em porUf/porCidade', () => {
    const pedidos = [
      pedido({ chave: '1', uf: 'SP', cidade: 'SP', bruto: 100, unidades: 1 }),
      pedido({ chave: '2', uf: null, cidade: null,  bruto: 50,  unidades: 1 }),
    ];
    const geo = agruparPorGeografia(pedidos);
    expect(geo.semGeo).toBe(1);
    expect(geo.totalPedidos).toBe(1); // só o com UF
    expect(geo.porUf).toHaveLength(1);
    expect(geo.porCidade).toHaveLength(1);
  });

  it('pedido cancelled (não-faturável) é ignorado completamente', () => {
    const pedidos = [
      pedido({ chave: '1', uf: 'SP', cidade: 'SP', bruto: 100, unidades: 1 }),
      pedido({ chave: '2', uf: 'SP', cidade: 'SP', bruto: 999, unidades: 1, status: 'cancelled' }),
    ];
    const geo = agruparPorGeografia(pedidos);
    expect(geo.totalPedidos).toBe(1);
    expect(geo.semGeo).toBe(0);
    const sp = geo.porUf.find((u) => u.uf === 'SP')!;
    expect(sp.valor).toBe(100); // cancelled não conta
    expect(sp.pedidos).toBe(1);
  });

  it('ranqueia cidades por pedidos desc', () => {
    const pedidos = [
      pedido({ chave: '1', uf: 'SP', cidade: 'Campinas', bruto: 10, unidades: 1 }),
      pedido({ chave: '2', uf: 'SP', cidade: 'São Paulo', bruto: 10, unidades: 1 }),
      pedido({ chave: '3', uf: 'SP', cidade: 'São Paulo', bruto: 10, unidades: 1 }),
    ];
    const geo = agruparPorGeografia(pedidos);
    expect(geo.porCidade[0].cidade).toBe('São Paulo'); // 2 pedidos
    expect(geo.porCidade[1].cidade).toBe('Campinas');  // 1 pedido
  });

  it('agrupa cidade por (cidade+uf) — mesma cidade em UFs diferentes são entradas distintas', () => {
    const pedidos = [
      pedido({ chave: '1', uf: 'SP', cidade: 'Santos', bruto: 10, unidades: 1 }),
      pedido({ chave: '2', uf: 'BA', cidade: 'Santos', bruto: 10, unidades: 1 }),
    ];
    const geo = agruparPorGeografia(pedidos);
    expect(geo.porCidade).toHaveLength(2);
    const spSantos = geo.porCidade.find((c) => c.uf === 'SP' && c.cidade === 'Santos');
    const baSantos = geo.porCidade.find((c) => c.uf === 'BA' && c.cidade === 'Santos');
    expect(spSantos).toBeDefined();
    expect(baSantos).toBeDefined();
  });
});
