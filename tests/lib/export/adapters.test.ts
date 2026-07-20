import { describe, it, expect } from 'vitest';
import {
  buildDashboardReport,
  buildVendasReport,
  buildFinanceiroDetalheReport,
  buildFinanceiroReport,
  buildGeografiaReport,
  buildPublicadosReport,
  rotuloPeriodo,
} from '@/lib/export/adapters';
import type { ExportConfig } from '@/lib/export/tipos';
import type { Pedido, KpisPedidos } from '@/lib/pedidos-faturamento';
import type { PublicadoItem } from '@/lib/publicados';
import { fmtBRL } from '@/lib/formato';

const cfg = (over: Partial<ExportConfig> = {}): ExportConfig => ({
  formato: 'pdf',
  expandido: false,
  incluirKpis: true,
  ...over,
});

const kpisVendas: KpisPedidos = {
  pedidos: 2, unidades: 5, bruto: 300, ticket: 150, itensPorPedido: 2.5,
  markup: 0.4, compradoresUnicos: 2, pctRecompra: 0, porStatusEnvio: {},
};

const pedido = (chave: string, over: Partial<Pedido> = {}): Pedido => ({
  chave, isPack: false, orderIds: [Number(chave)], data: '2026-06-10T00:00:00Z',
  comprador_id: 1, comprador_nick: 'fulano', comprador_nome: null, status: 'paid', statusDetail: null,
  shipping_status: 'shipped', shipping_substatus: null, uf: 'SP', cidade: 'São Paulo',
  unidades: 2, bruto: 150, frete: null, liquido: 120, money_release_date: null, estorno: 0,
  custo: 80, imposto: 12, markup: 0.5, comissao: 20, rastreio: null, is_publiai: true, tem_devolucao: false,
  itens: [
    { id: 'i1', ml_item_id: 'MLB1', titulo: 'Fita', codigo: 'C1', cor: 'azul', ean: '789',
      quantity: 2, unit_price: 75, imagem_path: null, custo: 80, liquido: 120, imposto: 12, markup: 0.5 },
  ],
  ...over,
});

describe('buildDashboardReport', () => {
  it('exporta o conteúdo do Dashboard com período e canal ativos', () => {
    const r = buildDashboardReport({
      resumo: { bruto: 1234.56, liquido: 987.65, markup: 0.42, aLiberar: 321.09 } as never,
      kpisPedidos: {
        liquido: 876.54, compradoresUnicos: 7, pedidos: 9, ticket: 137.17,
      } as never,
      serie: [{ chave: '2026-07-01', rotulo: '01/07', bruto: 400, liquido: 350, pedidos: 3 }],
      top: [{ mlItemId: 'MLB1', titulo: 'Produto campeão', valor: 250.5, unidades: 4 }],
      geografia: {
        porUf: [{ uf: 'SP', pedidos: 5, unidades: 8, valor: 600, pctPedidos: 62.5 }],
        porCidade: [], estadosAtingidos: 1, totalPedidos: 5, semGeo: 0,
      },
      periodo: { tipo: 'preset', dias: 30 },
      canal: 'mercado_livre',
      config: cfg(),
    });

    expect(r.titulo).toBe('Dashboard');
    expect(r.periodo).toBe('Últimos 30 dias');
    expect(r.filtros).toEqual(['Canal: Mercado Livre']);
    expect(r.kpis).toEqual([
      { label: 'Faturamento bruto', valor: fmtBRL(1234.56) },
      { label: 'Líquido das vendas', valor: fmtBRL(987.65) },
      { label: 'Líquido no faturamento', valor: fmtBRL(876.54) },
      { label: 'Markup no período', valor: '+42%' },
      { label: 'Compradores', valor: '7' },
      { label: 'Pedidos', valor: '9' },
      { label: 'Ticket médio', valor: fmtBRL(137.17) },
      { label: 'A receber', valor: fmtBRL(321.09) },
    ]);
    expect(r.linhas[0].celulas).toEqual({
      periodo: '01/07', faturamento: fmtBRL(400), liquido: fmtBRL(350), pedidos: '3',
    });
    expect(r.blocos?.[0].itens[0]).toEqual({
      label: 'Produto campeão', valor: `${fmtBRL(250.5)} · 4 un.`,
    });
    expect(r.blocos?.[1].itens[0]).toEqual({
      label: 'SP', valor: '5 pedidos · 62,5%',
    });
  });

  it('omite KPIs e blocos quando incluirKpis está desligado', () => {
    const r = buildDashboardReport({
      resumo: { bruto: 0, liquido: 0, markup: null, aLiberar: 0 } as never,
      kpisPedidos: { liquido: 0, compradoresUnicos: 0, pedidos: 0, ticket: 0 } as never,
      serie: [],
      top: [{ mlItemId: 'MLB1', titulo: 'Produto', valor: 10, unidades: 1 }],
      geografia: {
        porUf: [{ uf: 'SP', pedidos: 1, unidades: 1, valor: 10, pctPedidos: 100 }],
        porCidade: [], estadosAtingidos: 1, totalPedidos: 1, semGeo: 0,
      },
      periodo: { tipo: 'hoje' },
      canal: 'todos',
      config: cfg({ incluirKpis: false }),
    });

    expect(r.filtros).toEqual(['Canal: Todos']);
    expect(r.kpis).toBeUndefined();
    expect(r.linhas).toHaveLength(0);
    expect(r.blocos).toBeUndefined();
  });
});

describe('rotuloPeriodo', () => {
  it('preset → "Últimos N dias"', () => {
    expect(rotuloPeriodo({ tipo: 'preset', dias: 30 })).toBe('Últimos 30 dias');
  });
  it('mes_atual → "Mês atual"', () => {
    expect(rotuloPeriodo({ tipo: 'mes_atual' })).toBe('Mês atual');
  });
  it('range → intervalo de datas', () => {
    const s = rotuloPeriodo({ tipo: 'range', desde: '2026-06-01', ate: '2026-06-30' });
    expect(s).toContain('–');
  });
});

describe('buildVendasReport', () => {
  it('inclui kpis só quando incluirKpis', () => {
    const com = buildVendasReport({ pedidos: [pedido('1')], kpis: kpisVendas, periodo: { tipo: 'preset', dias: 30 }, origem: 'publiai', filtroEnvio: null, config: cfg() });
    expect(com.kpis?.some((k) => k.label === 'Faturamento')).toBe(true);
    const sem = buildVendasReport({ pedidos: [pedido('1')], kpis: kpisVendas, periodo: { tipo: 'preset', dias: 30 }, origem: 'publiai', filtroEnvio: null, config: cfg({ incluirKpis: false }) });
    expect(sem.kpis).toBeUndefined();
  });

  it('inclui sublinhas de itens só quando expandido', () => {
    const exp = buildVendasReport({ pedidos: [pedido('1')], kpis: kpisVendas, periodo: { tipo: 'preset', dias: 30 }, origem: 'todos', filtroEnvio: null, config: cfg({ expandido: true }) });
    expect(exp.linhas[0].sublinhas?.linhas).toHaveLength(1);
    const rec = buildVendasReport({ pedidos: [pedido('1')], kpis: kpisVendas, periodo: { tipo: 'preset', dias: 30 }, origem: 'todos', filtroEnvio: null, config: cfg({ expandido: false }) });
    expect(rec.linhas[0].sublinhas).toBeUndefined();
  });

  it('reflete o filtro de origem e envio no cabeçalho', () => {
    const r = buildVendasReport({ pedidos: [], kpis: kpisVendas, periodo: { tipo: 'preset', dias: 7 }, origem: 'fora', filtroEnvio: 'A caminho', config: cfg() });
    expect(r.filtros).toContain('Origem: Fora');
    expect(r.filtros).toContain('Envio: A caminho');
  });

  it('líquido continua líquido de imposto (ADR-0055) — fora do escopo da correção do Financeiro', () => {
    const p = pedido('1');
    const r = buildVendasReport({ pedidos: [p], kpis: kpisVendas, periodo: { tipo: 'preset', dias: 30 }, origem: 'todos', filtroEnvio: null, config: cfg({ expandido: true }) });
    expect(r.linhas[0].celulas.liquido).toBe(fmtBRL(p.liquido));
    expect(r.linhas[0].sublinhas?.linhas[0].liquido).toBe(fmtBRL(p.itens[0].liquido));
  });
});

describe('buildFinanceiroDetalheReport', () => {
  const totais = { bruto: 150, retido: 30, liquido: 120, markup: 0.5 };

  it('Liberação inclui "liberado" quando data no passado (sem coluna Situação separada, como a tela)', () => {
    const p = pedido('1', { comprador_nome: 'Maria de Fatima Braga', money_release_date: '2020-01-01T00:00:00Z' });
    const r = buildFinanceiroDetalheReport({ pedidos: [p], totais, filtroLib: 'todos', periodo: { tipo: 'preset', dias: 30 }, config: cfg() });
    expect(r.linhas[0].celulas.situacao).toBeUndefined();
    expect(String(r.linhas[0].celulas.liberacao)).toContain('liberado');
    expect(r.colunas.some((c) => c.chave === 'situacao')).toBe(false);
  });

  it('primeiras colunas espelham o Faturamento: Data, Comprador, Produtos, Un.', () => {
    const p = pedido('1', { comprador_nome: 'Maria de Fatima Braga' });
    const r = buildFinanceiroDetalheReport({ pedidos: [p], totais, filtroLib: 'todos', periodo: { tipo: 'preset', dias: 30 }, config: cfg() });
    expect(r.colunas.slice(0, 4).map((c) => c.titulo)).toEqual(['Data', 'Comprador', 'Produtos', 'Un.']);
    expect(r.linhas[0].celulas.comprador).toBe('Maria de Fatima Braga');
    expect(r.linhas[0].celulas.unidades).toBe('2');
    expect(r.linhas[0].celulas.produtos).toBe('C1'); // código do item (texto), como no Faturamento
  });

  it('Liberação inclui "a liberar" quando data no futuro', () => {
    const p = pedido('1', { money_release_date: '2099-01-01T00:00:00Z' });
    const r = buildFinanceiroDetalheReport({ pedidos: [p], totais: { ...totais, markup: null }, filtroLib: 'aliberar', periodo: { tipo: 'preset', dias: 30 }, config: cfg() });
    expect(String(r.linhas[0].celulas.liberacao)).toContain('a liberar');
  });

  it('expandido: inclui sublinhas com os itens do pedido', () => {
    const p = pedido('1');
    const r = buildFinanceiroDetalheReport({ pedidos: [p], totais, filtroLib: 'todos', periodo: { tipo: 'preset', dias: 30 }, config: cfg({ expandido: true }) });
    expect(r.linhas[0].sublinhas?.linhas).toHaveLength(1);
    expect(r.linhas[0].sublinhas?.linhas[0].item).toBe('Fita');
  });

  it('líquido nunca desconta imposto — tem que bater com o Mercado Pago; markup continua líquido de imposto', () => {
    const p = pedido('1'); // liquido=120, imposto=12 → líquido bruto 132; markup=0.5 (inalterado)
    const r = buildFinanceiroDetalheReport({ pedidos: [p], totais, filtroLib: 'todos', periodo: { tipo: 'preset', dias: 30 }, config: cfg({ expandido: true }) });
    expect(r.linhas[0].celulas.liquido).toBe(fmtBRL(132));
    expect(r.linhas[0].sublinhas?.linhas[0].liquido).toBe(fmtBRL(132));
    expect(r.linhas[0].celulas.markup).toBe('+50%');
  });
});

const labels = (r: { kpis?: { label: string }[] }) => (r.kpis ?? []).map((k) => k.label);

const pub = (over: Partial<PublicadoItem> = {}): PublicadoItem =>
  ({ familiaId: 'f', titulo: 'Produto', status: 'ativo', unidadesVendidas: 1, valorVendido: 100, ...over } as unknown as PublicadoItem);

describe('buildPublicadosReport — KPIs batem com a tela', () => {
  // todosItens = base de Saúde/Encalhados/Top: 2 ativos (1 encalhado), 1 com problema, top = Linha.
  const todos = [
    pub({ familiaId: 'a', titulo: 'Linha', status: 'ativo', valorVendido: 300, unidadesVendidas: 5, qtdVariacoes: 10 }),
    pub({ familiaId: 'b', titulo: 'Cola', status: 'ativo', valorVendido: 0, unidadesVendidas: 0, qtdVariacoes: 5 }),
    pub({ familiaId: 'c', titulo: 'Fita', status: 'pausado', valorVendido: 0, unidadesVendidas: 0, qtdVariacoes: 3 }),
  ];
  const base = {
    itens: [], todosItens: todos, liquido: 602.92,
    totais: { faturamento: 926.89, unidades: 56, pedidos: 38 },
    filtro: {}, periodo: { tipo: 'preset', dias: 30 } as const,
  };

  it('com custo: inclui Líquido, 6 KPIs e cards de saúde, na ordem da tela', () => {
    const r = buildPublicadosReport({ ...base, markupPct: 1.29, lucro: 262.67, config: cfg() });
    expect(labels(r)).toEqual([
      'Líquido das vendas (você recebe)',
      'Faturamento', 'Unidades vendidas', 'Pedidos', 'Ticket médio',
      'Markup no período', 'Lucro no período',
      'Ativos', 'Com problema', 'Variações publicadas', 'Encalhados (sem venda no período)',
    ]);
    expect(r.kpis?.find((k) => k.label === 'Líquido das vendas (você recebe)')?.valor).toContain('602,92');
    expect(r.kpis?.find((k) => k.label === 'Ticket médio')?.valor).toContain('24,39'); // 926,89/38
    expect(r.kpis?.find((k) => k.label === 'Ativos')?.valor).toBe('2/3');
    expect(r.kpis?.find((k) => k.label === 'Com problema')?.valor).toBe('1');
    expect(r.kpis?.find((k) => k.label === 'Variações publicadas')?.valor).toBe('18'); // 10+5+3
    expect(r.kpis?.find((k) => k.label === 'Encalhados (sem venda no período)')?.valor).toBe('1');
  });

  it('bloco "Top produtos (faturamento)" espelha o card da tela', () => {
    const r = buildPublicadosReport({ ...base, markupPct: 1.29, lucro: 262.67, config: cfg() });
    const top = r.blocos?.find((b) => b.titulo === 'Top produtos (faturamento)');
    expect(top?.itens[0].label).toBe('Linha');
    expect(top?.itens[0].valor).toContain('300,00');
  });

  it('sem custo: oculta Markup e Lucro (como a tela)', () => {
    const r = buildPublicadosReport({ ...base, markupPct: null, lucro: 0, config: cfg() });
    expect(labels(r)).not.toContain('Markup no período');
    expect(labels(r)).not.toContain('Lucro no período');
  });

  it('sem pedidos: oculta o banner Líquido (como a tela)', () => {
    const r = buildPublicadosReport({ ...base, totais: { faturamento: 0, unidades: 0, pedidos: 0 }, markupPct: null, lucro: 0, config: cfg() });
    expect(labels(r)).not.toContain('Líquido das vendas (você recebe)');
  });

  it('sem KPIs: não emite blocos', () => {
    const r = buildPublicadosReport({ ...base, markupPct: 1.29, lucro: 262.67, config: cfg({ incluirKpis: false }) });
    expect(r.kpis).toBeUndefined();
    expect(r.blocos).toBeUndefined();
  });
});

describe('buildVendasReport — KPIs completos', () => {
  it('inclui Itens / pedido e % recompra', () => {
    const r = buildVendasReport({ pedidos: [], kpis: kpisVendas, periodo: { tipo: 'preset', dias: 30 }, origem: 'todos', filtroEnvio: null, config: cfg() });
    expect(labels(r)).toContain('Itens / pedido');
    expect(labels(r)).toContain('% recompra');
    expect(labels(r)).toContain('Compradores');
  });
});

describe('buildFinanceiroReport — KPIs completos', () => {
  it('inclui Vendas no período e rótulos da tela', () => {
    const r = buildFinanceiroReport({
      r: { liquido: 100, bruto: 200, descontos: 100, estornos: 0, pedidos: 5, markup: 0.5, margem: 0.3, lucro: 30, liberado: 60, aLiberar: 40, vendas: [] } as never,
      ticketLiquido: 20, serie: [], periodo: { tipo: 'preset', dias: 30 }, config: cfg(),
    });
    expect(labels(r)).toEqual([
      'Líquido das vendas', 'Faturamento bruto', 'Taxas e frete (ML)', 'Estornos',
      'Ticket médio líquido', 'Já liberado', 'A liberar', 'Vendas no período',
      'Markup no período', 'Lucro líquido no período',
    ]);
  });
});

describe('buildGeografiaReport', () => {
  it('aninha cidades sob cada UF', () => {
    const geo = {
      porUf: [{ uf: 'SP', pedidos: 3, unidades: 5, valor: 300, pctPedidos: 75 }],
      porCidade: [
        { cidade: 'São Paulo', uf: 'SP', pedidos: 2, valor: 200 },
        { cidade: 'Rio', uf: 'RJ', pedidos: 1, valor: 100 },
      ],
      estadosAtingidos: 2, totalPedidos: 3, semGeo: 0,
    };
    const r = buildGeografiaReport({ geo, periodo: { tipo: 'preset', dias: 30 }, config: cfg() });
    expect(r.linhas).toHaveLength(1); // só SP em porUf
    expect(r.linhas[0].sublinhas?.linhas).toHaveLength(1); // só a cidade de SP
    expect(r.linhas[0].sublinhas?.linhas[0].cidade).toBe('São Paulo');
  });
});
