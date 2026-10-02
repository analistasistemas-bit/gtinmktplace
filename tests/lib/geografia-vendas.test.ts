import { describe, it, expect } from 'vitest';
import { agruparPorGeografia } from '@/lib/geografia-vendas';
import type { Pedido } from '@/lib/pedidos-faturamento';
import { ehFaturavel } from '@/lib/resumo-vendas';

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
    unidadesFaturaveis: over.unidadesFaturaveis ?? over.unidades ?? 1,
    faturavel: over.faturavel ?? ehFaturavel(over.status ?? 'paid'),
    brutoFaturavel: over.brutoFaturavel ?? (ehFaturavel(over.status ?? 'paid') ? (over.bruto ?? 100) : 0),
  } as Pedido;
}

describe('agruparPorGeografia — unidades', () => {
  it('pack com order cancelada conta só as unidades faturáveis na UF', () => {
    const geo = agruparPorGeografia([pedido({ uf: 'SP', unidades: 2, unidadesFaturaveis: 1 })]);
    expect(geo.porUf.find((u) => u.uf === 'SP')!.unidades).toBe(1);
  });
});

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

describe('agruparPorGeografia — pack misto', () => {
  it('pack cujo membro mais antigo foi cancelado conta e soma só o bruto faturável', () => {
    const geo = agruparPorGeografia([
      pedido({ status: 'cancelled', faturavel: true, bruto: 150, brutoFaturavel: 100 }),
    ]);
    const sp = geo.porUf.find((u) => u.uf === 'SP')!;
    expect(sp.pedidos).toBe(1);
    expect(sp.valor).toBe(100);
    expect(geo.porCidade[0].valor).toBe(100);
  });
});

describe('agruparPorGeografia — rentabilidade por UF', () => {
  it('ticket médio, frete médio (sem frete = 0) e markup só dos pedidos com custo', () => {
    const geo = agruparPorGeografia([
      pedido({ chave: '1', bruto: 100, liquido: 80, custo: 40, frete: 20 }),
      pedido({ chave: '2', bruto: 60, liquido: 50, custo: 20, frete: null }),
      pedido({ chave: '3', bruto: 40, liquido: 30, custo: null, frete: 10 }),
    ]);
    const sp = geo.porUf[0];
    expect(sp.ticketMedio).toBe(66.67); // 200 / 3
    expect(sp.freteMedio).toBe(10); // (20 + 0 + 10) / 3
    expect(sp.markup).toBeCloseTo(1.1667, 4); // (130 − 60) / 60
  });

  it('markup null quando nenhum pedido da UF tem custo', () => {
    const geo = agruparPorGeografia([pedido({ custo: null })]);
    expect(geo.porUf[0].markup).toBeNull();
  });
});

describe('agruparPorGeografia — concentração', () => {
  it('pctValor por UF e menor nº de estados que soma ≥ 80% do valor', () => {
    const geo = agruparPorGeografia([
      pedido({ chave: '1', uf: 'SP', bruto: 500 }),
      pedido({ chave: '2', uf: 'MG', bruto: 300 }),
      pedido({ chave: '3', uf: 'RJ', bruto: 150 }),
      pedido({ chave: '4', uf: 'RJ', bruto: 50 }),
    ]);
    expect(geo.valorTotal).toBe(1000);
    expect(geo.porUf.find((u) => u.uf === 'SP')!.pctValor).toBe(50);
    expect(geo.concentracao).toEqual({ estados: 2, pctValor: 80 });
  });

  it('valor faturável sem UF entra no denominador do % e da concentração', () => {
    const geo = agruparPorGeografia([
      pedido({ chave: '1', uf: 'SP', bruto: 100 }),
      pedido({ chave: '2', uf: null, cidade: null, bruto: 50 }),
    ]);
    expect(geo.valorTotal).toBe(150);
    expect(geo.porUf[0].pctValor).toBe(66.7);
    expect(geo.concentracao).toBeNull(); // UFs somam só 66,7% < 80%
  });

  it('concentração null sem pedidos', () => {
    expect(agruparPorGeografia([]).concentracao).toBeNull();
  });
});
