import { describe, it, expect } from 'vitest';
import { agruparPorPedido, calcularKpisPedidos } from '@/lib/pedidos-faturamento';
import {
  agregarPorSku, SEM_CODIGO,
  classificarTendencia, coberturaDias, alertasSku, unidadesPorCodigo, metricas, somarAcumuladores,
  calcularKpisSku, deltaValor, deltaPp, curvaAbc, explicarVariacao, gerarInsights, agruparPorFamilia, type LinhaSku,
} from '@/lib/vendas-sku';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver } from '@/lib/resumo-vendas';
import type { Janela } from '@/lib/metricas';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return { id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: '001', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over };
}
function venda(over: Partial<Venda> = {}): Venda {
  return { id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-09-10T12:00:00Z', date_created: null, comprador_nick: 'c', comprador_id: 100,
    total_amount: 10, paid_amount: 10, sale_fee_total: 1, frete_vendedor: null, liquido: 9, estorno: null,
    money_release_date: null, currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over };
}
const SET: Janela = { desde: '2026-09-01T00:00:00.000Z', ate: '2026-09-30T23:59:59.999Z' };
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('agregarPorSku', () => {
  it('soma dos SKUs bate com os KPIs da aba Vendas (bruto, líquido, unidades)', () => {
    const custo: CustoResolver = () => 4;
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 9, total_amount: 30, sale_fee_total: 3,
        itens: [item({ id: 'i1', codigo: 'A', unit_price: 10 }), item({ id: 'i2', codigo: 'B', unit_price: 20 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 9, status: 'cancelled', total_amount: 10,
        itens: [item({ id: 'i3', codigo: 'A', unit_price: 10 })] }),
      venda({ id: 'c', order_id: 3, total_amount: 10, itens: [item({ id: 'i4', codigo: 'A' })] }),
    ];
    const pedidos = agruparPorPedido(vendas, custo);
    const linhas = agregarPorSku(pedidos, SET, new Map());
    const k = calcularKpisPedidos(pedidos);
    expect(r2(linhas.reduce((s, l) => s + l.acc.bruto, 0))).toBe(k.bruto);
    expect(r2(linhas.reduce((s, l) => s + l.acc.liquido, 0))).toBe(k.liquido);
    expect(linhas.reduce((s, l) => s + l.acc.unidades, 0)).toBe(k.unidades);
    expect(linhas.find((l) => l.codigo === 'A')!.acc.canceladas).toBe(1);
  });

  it('lucro só dos itens com custo; fonte parcial; margem sobre o bruto desses itens', () => {
    const custo: CustoResolver = (it) => (it.id === 'i1' ? 4 : null);
    const vendas = [
      // Pedido avulso sem frete usa v.liquido direto (sales-summary.ts:336): liquido 10 explícito.
      venda({ id: 'a', order_id: 1, total_amount: 10, sale_fee_total: 0, liquido: 10, itens: [item({ id: 'i1', codigo: 'A', custo_congelado: 4 })] }),
      venda({ id: 'b', order_id: 2, total_amount: 10, sale_fee_total: 0, liquido: 10, itens: [item({ id: 'i2', codigo: 'A' })] }),
    ];
    const [l] = agregarPorSku(agruparPorPedido(vendas, custo), SET, new Map());
    expect(l.m.fonteCusto).toBe('parcial');
    expect(l.m.lucro).toBe(6);                 // 10 − 4, o item sem custo fica fora
    expect(l.m.markup).toBeCloseTo(1.5, 5);    // 6 ÷ 4
    expect(l.m.margemSVenda).toBeCloseTo(0.6, 5); // 6 ÷ 10 (bruto do item com custo)
    expect(l.m.lucroPorUnidade).toBe(6);
  });

  it('sem custo nenhum → lucro null e fonte sem_custo (nunca lucro = líquido)', () => {
    const [l] = agregarPorSku(agruparPorPedido([venda()]), SET, new Map());
    expect(l.m.lucro).toBeNull();
    expect(l.m.fonteCusto).toBe('sem_custo');
  });

  it('custo atual (não congelado) → fonte estimado', () => {
    const [l] = agregarPorSku(agruparPorPedido([venda()], () => 3), SET, new Map());
    expect(l.m.fonteCusto).toBe('estimado');
  });

  it('taxa de devolução conta pedidos: 1 devolvido em 2', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, tem_devolucao: true, status: 'cancelled', itens: [item({ id: 'i1', codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, itens: [item({ id: 'i2', codigo: 'A', quantity: 3 })] }),
    ];
    const [l] = agregarPorSku(agruparPorPedido(vendas), SET, new Map());
    expect(l.m.taxaDevolucao).toBe(0.5);
    expect(l.acc.canceladas).toBe(0);  // devolvida não é "cancelada"
  });

  it('item sem código vira a linha SEM_CODIGO e não some do total', () => {
    const linhas = agregarPorSku(agruparPorPedido([venda({ itens: [item({ codigo: null })] })]), SET, new Map());
    expect(linhas.map((l) => l.codigo)).toEqual([SEM_CODIGO]);
    expect(linhas[0].acc.bruto).toBe(10);
  });

  it('pedido fora da janela não entra', () => {
    const linhas = agregarPorSku(agruparPorPedido([venda({ date_closed: '2026-08-31T23:59:59.000Z' })]), SET, new Map());
    expect(linhas).toHaveLength(0);
  });

  it('usa o catálogo para título, família, fornecedor, estoque', () => {
    const cat = new Map([['001', { codigo: '001', codigoPai: '000', nomeFamilia: 'Fitas', nome: 'Fita azul', cor: null,
      tamanho: null, estoque: 7, fornecedor: 'F', origem: 'nacional' as const, ehKit: false, primeiraVenda: null, ultimaVenda: null }]]);
    const [l] = agregarPorSku(agruparPorPedido([venda()]), SET, cat);
    expect([l.titulo, l.nomeFamilia, l.fornecedor, l.estoque, l.origem]).toEqual(['Fita azul', 'Fitas', 'F', 7, 'nacional']);
  });
});

const DIA = 86_400_000;
const FIM = Date.parse('2026-09-30T23:59:59.999Z');

describe('classificarTendencia', () => {
  it('precedência: novo > parado > baixo giro > alta/queda/estável', () => {
    expect(classificarTendencia(10, 0, new Date(FIM - 10 * DIA).toISOString(), FIM)).toBe('novo');
    expect(classificarTendencia(0, 8, '2026-06-01T00:00:00Z', FIM)).toBe('parado');
    expect(classificarTendencia(2, 1, '2026-06-01T00:00:00Z', FIM)).toBe('baixo_giro'); // 2 vs 1 não é "+100%"
    expect(classificarTendencia(12, 10, '2026-06-01T00:00:00Z', FIM)).toBe('em_alta');  // +20%
    expect(classificarTendencia(8, 10, '2026-06-01T00:00:00Z', FIM)).toBe('em_queda');  // −20%
    expect(classificarTendencia(11, 10, '2026-06-01T00:00:00Z', FIM)).toBe('estavel');
    expect(classificarTendencia(6, 0, '2026-06-01T00:00:00Z', FIM)).toBe('em_alta');    // voltou a vender
  });
});

describe('coberturaDias', () => {
  it('estoque ÷ média diária dos últimos 30 dias', () => {
    expect(coberturaDias(30, 60, false)).toBe(15); // 2/dia
  });
  it('kit vinculado → compartilhado; sem venda → null (não infinito)', () => {
    expect(coberturaDias(30, 60, true)).toBe('compartilhado');
    expect(coberturaDias(30, 0, false)).toBeNull();
  });
});

describe('alertasSku', () => {
  it('devolução alta só com ≥ 20 pedidos; lucro negativo; cobertura baixa; sem custo', () => {
    const base = somarAcumuladores([]);
    const l = (over: Partial<typeof base>) => {
      const acc = { ...base, ...over };
      return { acc, m: metricas(acc) } as unknown as Parameters<typeof alertasSku>[0];
    };
    expect(alertasSku(l({ pedidosBaseDevolucao: 19, pedidosDevolvidos: 5 }), null)).toEqual([]);
    expect(alertasSku(l({ pedidosBaseDevolucao: 20, pedidosDevolvidos: 2 }), null)).toEqual(['devolucao_alta']);
    expect(alertasSku(l({ itensComCusto: 1, liquidoComCusto: 5, custo: 8 }), 10)).toEqual(['lucro_negativo', 'cobertura_baixa']);
    expect(alertasSku(l({ itensSemCusto: 1 }), 'compartilhado')).toEqual(['sem_custo']);
  });
});

describe('unidadesPorCodigo', () => {
  it('soma só itens faturáveis dentro da janela', () => {
    const pedidos = agruparPorPedido([
      venda({ id: 'a', order_id: 1, itens: [item({ codigo: 'A', quantity: 2 })] }),
      venda({ id: 'b', order_id: 2, status: 'cancelled', itens: [item({ codigo: 'A', quantity: 5 })] }),
    ]);
    expect(unidadesPorCodigo(pedidos, SET).get('A')).toBe(2);
  });
});

function linha(codigo: string, lucro: number | null, bruto = 100, extra: Partial<LinhaSku> = {}): LinhaSku {
  const acc = somarAcumuladores([]);
  acc.bruto = bruto; acc.unidades = 1; acc.pedidos = 1; acc.brutoCustoReal = bruto;
  if (lucro != null) { acc.itensComCusto = 1; acc.unidadesComCusto = 1; acc.custo = 10; acc.liquidoComCusto = lucro + 10; acc.brutoComCusto = bruto; }
  return { codigo, titulo: codigo, imagemPath: null, codigoPai: null, nomeFamilia: null, fornecedor: null,
    origem: null, ehKit: false, estoque: null, primeiraVenda: null, acc, m: metricas(acc), pedidoChaves: [], ...extra };
}
const brl = (n: number) => `R$ ${n.toFixed(2)}`;

describe('deltas', () => {
  it('base anterior zero ou negativa → Δ em R$, não %', () => {
    expect(deltaValor(50, 0, brl)).toEqual({ texto: '+R$ 50.00', tendencia: 'up' });
    expect(deltaValor(-20, -50, brl)).toEqual({ texto: '+R$ 30.00', tendencia: 'up' });
    expect(deltaValor(120, 100, brl)).toEqual({ texto: '+20,0%', tendencia: 'up' });
    expect(deltaValor(null, 100, brl)).toBeNull();
  });
  it('percentuais variam em pontos percentuais', () => {
    expect(deltaPp(0.35, 0.3)).toEqual({ texto: '+5,0 p.p.', tendencia: 'up' });
  });
});

describe('curvaAbc por lucro', () => {
  it('só lucro positivo entra em A/B/C; prejuízo é D; sem custo fica sem classe', () => {
    const ls = [linha('a', 80), linha('b', 15), linha('c', 5), linha('d', -30), linha('e', null)];
    const abc = curvaAbc(ls, 'lucro');
    expect([abc.get('a'), abc.get('b'), abc.get('c'), abc.get('d'), abc.get('e')]).toEqual(['A', 'B', 'C', 'D', undefined]);
  });
});

describe('calcularKpisSku', () => {
  it('prejuízo total, concentração sobre lucro positivo e % do bruto com custo real', () => {
    const k = calcularKpisSku([linha('a', 80), linha('b', 20), linha('d', -30), linha('e', null)]);
    expect(k.prejuizo).toBe(-30);
    expect(k.concentracaoTop5).toBe(1);   // 100 de 100 positivos
    expect(k.skusComVenda).toBe(4);
    expect(k.pctBrutoCustoReal).toBe(1);
  });
});

describe('explicarVariacao', () => {
  it('ordena por |Δ lucro| e marca entrou/saiu', () => {
    const v = explicarVariacao([linha('a', 100), linha('n', 40)], [linha('a', 150), linha('x', 10)]);
    expect(v.map((x) => [x.codigo, x.delta, x.situacao])).toEqual([
      ['a', -50, 'mudou'], ['n', 40, 'entrou'], ['x', -10, 'saiu'],
    ]);
  });
});

describe('gerarInsights', () => {
  it('no máximo 3, e só com evidência', () => {
    expect(gerarInsights({ linhas: [linha('a', 10)], variacoes: [], coberturaBaixa: 0, parados: 0 })).toEqual([]);
    const ins = gerarInsights({ linhas: [], variacoes: [{ codigo: 'a', titulo: 'Fita', delta: -50, situacao: 'mudou' }], coberturaBaixa: 2, parados: 3 });
    expect(ins.length).toBeLessThanOrEqual(3);
    expect(ins[0]).toContain('Fita');
  });
});

describe('agruparPorFamilia', () => {
  it('soma os filhos e recalcula as razões pelo total', () => {
    const fams = agruparPorFamilia([linha('a', 10, 100, { codigoPai: 'P' }), linha('b', 30, 100, { codigoPai: 'P' })]);
    expect(fams).toHaveLength(1);
    expect(fams[0].m.lucro).toBe(40);
    expect(fams[0].m.margemSVenda).toBeCloseTo(0.2, 5);
    expect(fams[0].filhos).toHaveLength(2);
  });
});
