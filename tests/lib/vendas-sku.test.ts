import { describe, it, expect } from 'vitest';
import { agruparPorPedido, calcularKpisPedidos } from '@/lib/pedidos-faturamento';
import {
  agregarPorSku, SEM_CODIGO,
  classificarTendencia, coberturaDias, alertasSku, unidadesPorCodigo, metricas, somarAcumuladores,
  calcularKpisSku, deltaValor, deltaPp, curvaAbc, explicarVariacao, gerarInsights, agruparPorFamilia, nomeSku, type LinhaSku,
  janelaEstendida, montarVendasSku,
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
    const linhas = agregarPorSku(pedidos, SET, new Map(), new Set());
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
    const [l] = agregarPorSku(agruparPorPedido(vendas, custo), SET, new Map(), new Set());
    expect(l.m.fonteCusto).toBe('parcial');
    expect(l.m.lucro).toBe(6);                 // 10 − 4, o item sem custo fica fora
    expect(l.m.markup).toBeCloseTo(1.5, 5);    // 6 ÷ 4
    expect(l.m.margemSVenda).toBeCloseTo(0.6, 5); // 6 ÷ 10 (bruto do item com custo)
    expect(l.m.lucroPorUnidade).toBe(6);
  });

  it('sem custo nenhum → lucro null e fonte sem_custo (nunca lucro = líquido)', () => {
    const [l] = agregarPorSku(agruparPorPedido([venda()]), SET, new Map(), new Set());
    expect(l.m.lucro).toBeNull();
    expect(l.m.fonteCusto).toBe('sem_custo');
  });

  it('custo atual (não congelado) → fonte estimado', () => {
    const [l] = agregarPorSku(agruparPorPedido([venda()], () => 3), SET, new Map(), new Set());
    expect(l.m.fonteCusto).toBe('estimado');
  });

  it('taxa de devolução conta pedidos: 1 devolvido em 2', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, tem_devolucao: true, status: 'cancelled', itens: [item({ id: 'i1', codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, itens: [item({ id: 'i2', codigo: 'A', quantity: 3 })] }),
    ];
    const [l] = agregarPorSku(agruparPorPedido(vendas), SET, new Map(), new Set([1]));
    expect(l.m.taxaDevolucao).toBe(0.5);
    expect(l.acc.canceladas).toBe(0);  // devolvida não é "cancelada"
  });

  it('claim de cancelamento (cancel_purchase) não é devolução: conta em canceladas, taxa 0', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, tem_devolucao: true, status: 'cancelled', itens: [item({ id: 'i1', codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, itens: [item({ id: 'i2', codigo: 'A' })] }),
    ];
    // Order 1 tem claim, mas cancel_purchase: fora do Set de devolução real.
    const [l] = agregarPorSku(agruparPorPedido(vendas), SET, new Map(), new Set());
    expect(l.acc.canceladas).toBe(1);
    expect(l.acc.pedidosDevolvidos).toBe(0);
    expect(l.m.taxaDevolucao).toBe(0);
  });

  it('claim returns conta como devolvido', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, tem_devolucao: true, status: 'cancelled', itens: [item({ id: 'i1', codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, itens: [item({ id: 'i2', codigo: 'A' })] }),
      venda({ id: 'c', order_id: 3, itens: [item({ id: 'i3', codigo: 'A' })] }),
    ];
    const [l] = agregarPorSku(agruparPorPedido(vendas), SET, new Map(), new Set([1]));
    expect(l.acc.canceladas).toBe(0);
    expect(l.acc.pedidosDevolvidos).toBe(1);
    expect(l.acc.pedidosBaseDevolucao).toBe(3);
    expect(l.m.taxaDevolucao).toBeCloseTo(1 / 3, 10);
  });

  it('item sem código vira a linha SEM_CODIGO e não some do total', () => {
    const linhas = agregarPorSku(agruparPorPedido([venda({ itens: [item({ codigo: null })] })]), SET, new Map(), new Set());
    expect(linhas.map((l) => l.codigo)).toEqual([SEM_CODIGO]);
    expect(linhas[0].acc.bruto).toBe(10);
  });

  it('pedido fora da janela não entra', () => {
    const linhas = agregarPorSku(agruparPorPedido([venda({ date_closed: '2026-08-31T23:59:59.000Z' })]), SET, new Map(), new Set());
    expect(linhas).toHaveLength(0);
  });

  it('usa o catálogo para título, família, fornecedor, estoque', () => {
    const cat = new Map([['001', { codigo: '001', codigoPai: '000', nomeFamilia: 'Fitas', nome: 'Fita azul', cor: null,
      tamanho: null, estoque: 7, fornecedor: 'F', origem: 'nacional' as const, ehKit: false, primeiraVenda: null, ultimaVenda: null }]]);
    const [l] = agregarPorSku(agruparPorPedido([venda()]), SET, cat, new Set());
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

describe('nomeSku', () => {
  it('variação que só tem a cor ganha o nome da família na frente', () => {
    expect(nomeSku({ codigo: '1', titulo: 'Preto', nomeFamilia: 'Fita de Cetim 10mm' })).toBe('Fita de Cetim 10mm · Preto');
    expect(nomeSku({ codigo: '1', titulo: 'LAPIS COMUM C/72', nomeFamilia: 'Lápis Comum' })).toBe('Lapis Comum C/72');
    expect(nomeSku({ codigo: '1', titulo: 'Fita', nomeFamilia: null })).toBe('Fita');
    expect(nomeSku({ codigo: '1', titulo: null, nomeFamilia: 'Fita' })).toBe('Fita');
    expect(nomeSku({ codigo: '1', titulo: null, nomeFamilia: null })).toBe('1');
  });
  it('explicarVariacao usa o nome com a família', () => {
    const v = explicarVariacao([linha('a', 100, 100, { titulo: 'Verde Musgo', nomeFamilia: 'Tecido Oxford' })], []);
    expect(v[0].titulo).toBe('Tecido Oxford · Verde Musgo');
  });
});

describe('gerarInsights', () => {
  const vazio = { variacoes: [], coberturaBaixa: [], parados: [] };
  it('no máximo 3, e só com evidência', () => {
    expect(gerarInsights({ ...vazio, linhas: [linha('a', 10)] })).toEqual([]);
    const it1 = { codigo: 'x', nome: 'X', detalhe: '' };
    const ins = gerarInsights({ linhas: [], variacoes: [{ codigo: 'a', titulo: 'Fita', delta: -50, situacao: 'mudou' }],
      coberturaBaixa: [it1, it1], parados: [it1, it1, it1] });
    expect(ins.length).toBeLessThanOrEqual(3);
    expect(ins[0].texto).toContain('Fita');
  });
  it('cada leitura diz de quais SKUs fala', () => {
    const ls = [linha('a', 100, 100, { titulo: 'Preto', nomeFamilia: 'Fita' }), ...['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((c) => linha(c, 1))];
    const cob = [{ codigo: 'b', nome: 'B', detalhe: '3 dias' }];
    const par = [{ codigo: 'z', nome: 'Z', detalhe: '9 un. em estoque' }];
    const ins = gerarInsights({ linhas: ls, variacoes: [], coberturaBaixa: cob, parados: par });
    expect(ins.map((i) => i.texto)).toEqual([
      '1 SKU faz metade do lucro do período.',
      '1 SKU tem estoque para menos de 15 dias.',
      '1 SKU parou de vender há mais de 30 dias.',
    ]);
    expect(ins[0].skus).toEqual([{ codigo: 'a', nome: 'Fita · Preto', detalhe: 'R$\u00a0100,00' }]);
    expect(ins[1].skus).toBe(cob);
    expect(ins[2].skus).toBe(par);
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

describe('janelaEstendida', () => {
  it('começa no menor entre o início do anterior e fim − 60 dias', () => {
    const atual = { desde: '2026-09-24T00:00:00.000Z', ate: '2026-09-30T23:59:59.999Z' };
    const ant = { desde: '2026-09-17T00:00:00.000Z', ate: '2026-09-24T00:00:00.000Z' };
    expect(janelaEstendida(atual, ant)).toEqual({ desde: new Date(Date.parse(atual.ate) - 60 * DIA).toISOString(), ate: atual.ate });
  });
});

describe('montarVendasSku', () => {
  const ANT = { desde: '2026-08-01T00:00:00.000Z', ate: '2026-08-31T23:59:59.999Z' };
  const agrupar = (vs: Venda[]) => agruparPorPedido(vs);

  it('ranking usa só o período; tendência usa os 60 dias até o fim; parados só com estoque', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, date_closed: '2026-09-10T12:00:00Z', itens: [item({ codigo: 'A', quantity: 6 })] }),
      venda({ id: 'b', order_id: 2, date_closed: '2026-08-10T12:00:00Z', itens: [item({ codigo: 'A', quantity: 5 })] }),
    ];
    const z = { codigo: 'Z', codigoPai: null, nomeFamilia: null, nome: 'Parado', cor: null, tamanho: null,
      estoque: 3, fornecedor: null, origem: null, ehKit: false, primeiraVenda: '2026-05-01T00:00:00Z', ultimaVenda: '2026-07-01T00:00:00Z' };
    const semEstoque = { ...z, codigo: 'Y', estoque: 0 };
    const r = montarVendasSku({ vendas, agrupar, janela: SET, anterior: ANT,
      catalogo: new Map([['Z', z], ['Y', semEstoque]]), devolucoes: [] });
    expect(r.linhas.map((l) => [l.codigo, l.acc.unidades])).toEqual([['A', 6]]);
    expect(r.linhasAnterior.map((l) => [l.codigo, l.acc.unidades])).toEqual([['A', 5]]);
    expect(r.tendencias.get('A')).toBe('em_alta');  // 6 vs 5 = +20%
    expect(r.parados).toBe(1);                       // Y tem estoque 0: não conta
    expect(r.historicoDesde).toBe('2026-05-01T00:00:00Z');
  });

  it('pack com uma order em agosto e outra em setembro é dividido, igual à aba Vendas', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 77, date_closed: '2026-08-31T20:00:00Z', itens: [item({ codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, pack_id: 77, date_closed: '2026-09-01T10:00:00Z', itens: [item({ codigo: 'B' })] }),
    ];
    const r = montarVendasSku({ vendas, agrupar, janela: SET, anterior: ANT, catalogo: new Map(), devolucoes: [] });
    expect(r.linhas.map((l) => l.codigo)).toEqual(['B']);
    expect(r.linhasAnterior.map((l) => l.codigo)).toEqual(['A']);
    const kpisVendasSet = calcularKpisPedidos(agrupar(vendas.filter((v) => v.date_closed! >= SET.desde)));
    expect(r.kpis.bruto).toBe(kpisVendasSet.bruto);
  });

  it('só claim type returns entra na taxa (cancel_purchase/mediations não)', () => {
    const dev = (order_id: number, type: string) => ({ id: `d${order_id}`, claim_id: order_id, order_id, stage: null,
      status: 'closed', type, reason_texto: null, valor_em_jogo: null, return_status: null, return_status_money: null,
      acoes_pendentes: null, aberto_em: '2026-09-05T00:00:00Z', fechado_em: '2026-09-06T00:00:00Z' });
    const vendas = [
      venda({ id: 'a', order_id: 1, tem_devolucao: true, status: 'cancelled', itens: [item({ id: 'i1', codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, tem_devolucao: true, status: 'cancelled', itens: [item({ id: 'i2', codigo: 'A' })] }),
      venda({ id: 'c', order_id: 3, tem_devolucao: true, itens: [item({ id: 'i3', codigo: 'A' })] }),
      venda({ id: 'd', order_id: 4, itens: [item({ id: 'i4', codigo: 'A' })] }),
    ];
    const r = montarVendasSku({ vendas, agrupar, janela: SET, anterior: ANT, catalogo: new Map(),
      devolucoes: [dev(1, 'cancel_purchase'), dev(2, 'returns'), dev(3, 'mediations')] });
    const [l] = r.linhas;
    expect(l.acc.canceladas).toBe(1);          // order 1
    expect(l.acc.pedidosDevolvidos).toBe(1);   // só order 2
    expect(l.acc.pedidosBaseDevolucao).toBe(3); // 2, 3, 4
    expect(l.m.taxaDevolucao).toBeCloseTo(1 / 3, 10);
  });

  it('devolução sem pedido conhecido conta como não atribuída', () => {
    const dev = [{ id: 'd', claim_id: 1, order_id: null, stage: null, status: 'closed', type: null, reason_texto: null,
      valor_em_jogo: null, return_status: null, return_status_money: null, acoes_pendentes: null,
      aberto_em: '2026-09-05T00:00:00Z', fechado_em: '2026-09-06T00:00:00Z' }];
    const r = montarVendasSku({ vendas: [], agrupar, janela: SET, anterior: SET, catalogo: new Map(), devolucoes: dev });
    expect(r.devolucoesNaoAtribuidas).toBe(1);
  });
});

describe('SEM_CODIGO fora dos rankings', () => {
  it('concentração top 5 ignora a linha sem código; o lucro total continua somando', () => {
    const ls = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => linha(c, 10));
    const k = calcularKpisSku([linha(SEM_CODIGO, 100), ...ls]);
    expect(k.concentracaoTop5).toBeCloseTo(50 / 60, 5);
    expect(k.lucro).toBe(160);
  });

  it('curva ABC não classifica a linha sem código nem a conta no total', () => {
    const abc = curvaAbc([linha(SEM_CODIGO, 1000), linha('a', 80), linha('b', 20)], 'lucro');
    expect([abc.get(SEM_CODIGO), abc.get('a'), abc.get('b')]).toEqual([undefined, 'A', 'B']);
    expect(curvaAbc([linha(SEM_CODIGO, -5)], 'lucro').has(SEM_CODIGO)).toBe(false);
  });

  it('insight "metade do lucro" não conta a linha sem código', () => {
    const ls = ['a', 'b', 'c', 'd', 'e'].map((c) => linha(c, 10));
    const ins = gerarInsights({ linhas: [linha(SEM_CODIGO, 1000), ...ls], variacoes: [], coberturaBaixa: [], parados: [] });
    expect(ins.some((s) => s.texto.includes('metade do lucro'))).toBe(false); // 5 × 10: 3 SKUs fazem metade, acima de 20%
  });

  it('explicarVariacao pula a linha sem código', () => {
    const v = explicarVariacao([linha(SEM_CODIGO, 100), linha('a', 10)], []);
    expect(v.map((x) => x.codigo)).toEqual(['a']);
  });
});
