import { describe, expect, it } from 'vitest';
import { buildDashboardReport } from '../adapters';
import type { DashboardPdfVisual, ExportConfig } from '../tipos';

const pdf: ExportConfig = { formato: 'pdf', expandido: false, incluirKpis: false };
const visual: NonNullable<Parameters<typeof buildDashboardReport>[0]['visual']> = {
  metrica: 'pedidos',
  pontos: [{ rotulo: '20/07', valor: 9 }],
  principais: [
    { label: 'Faturamento bruto', valor: 'R$ 456,56', delta: '+138% vs. anterior', tendencia: 'up', auxiliar: '9 pedidos · 11 unidades' },
    { label: 'Líquido das vendas', valor: 'R$ 319,55', delta: '+133% vs. anterior', tendencia: 'up', auxiliar: 'comissão R$ 52,35 · frete R$ 84,66' },
  ],
  secundarios: [
    { label: 'Líquido no faturamento', valor: 'R$ 276,98' },
    { label: 'Markup no período', valor: '+35%' },
    { label: 'Compradores', valor: '7', auxiliar: '33,3% recompra' },
    { label: 'Pedidos', valor: '9' },
    { label: 'Ticket médio', valor: 'R$ 50,73' },
    { label: 'A receber', valor: 'R$ 319,55', auxiliar: 'próxima em 18/08/2026' },
  ],
  alertas: ['1 lote a revisar'],
  liberacoes: Array.from({ length: 8 }, (_, i) => ({
    data: `2026-08-${String(i + 1).padStart(2, '0')}`,
    valor: i + 1,
  })),
  totalAReceber: 0,
};

function fixtureArgs({
  config = pdf,
  visual: visualPayload = visual,
  topCount = 1,
  ufCount = 1,
}: {
  config?: ExportConfig;
  visual?: NonNullable<Parameters<typeof buildDashboardReport>[0]['visual']>;
  topCount?: number;
  ufCount?: number;
} = {}): Parameters<typeof buildDashboardReport>[0] {
  return {
    resumo: {
      bruto: 0, liquido: 0, descontos: 0, estornos: 0, pedidos: 0, unidades: 0,
      ticket: 0, markup: null, lucro: 0, liberado: 0, aLiberar: 319.55,
      proximaLiberacao: null, comissao: 0, frete: 0, imposto: 0,
      vendasComCusto: 0, totalVendas: 0, margem: null, porItem: {}, vendas: [],
    },
    kpisPedidos: {
      pedidos: 0, unidades: 0, bruto: 0, liquido: 0, ticket: 0,
      itensPorPedido: 0, markup: null, compradoresUnicos: 0, pctRecompra: 0,
      porStatusEnvio: {},
    },
    serie: [{ chave: '2026-07-20', rotulo: '20/07', bruto: 0, liquido: 0, pedidos: 0 }],
    top: Array.from({ length: topCount }, (_, i) => ({
      mlItemId: `MLB${i + 1}`, titulo: `Produto ${i + 1}`, unidades: i + 1, valor: (i + 1) * 10,
    })),
    geografia: {
      porUf: Array.from({ length: ufCount }, (_, i) => ({
        uf: `U${i}`, pedidos: i + 1, unidades: 0, valor: 0, pctPedidos: i + 0.5,
      })),
      porCidade: [],
      estadosAtingidos: ufCount,
      totalPedidos: ufCount,
      semGeo: 2,
    },
    periodo: { tipo: 'hoje' },
    canal: 'todos',
    config,
    visual: visualPayload,
  };
}

describe('buildDashboardReport', () => {
  it('anexa payload visual completo somente ao PDF e aplica limites 5/6/5', () => {
    const report = buildDashboardReport(fixtureArgs({ config: pdf, visual, topCount: 7, ufCount: 7 }));
    expect(report.kpis).toBeUndefined();
    expect(report.dashboardPdf).toMatchObject<Partial<DashboardPdfVisual>>({
      tipo: 'dashboard',
      metrica: 'pedidos',
      alertas: ['1 lote a revisar'],
    });
    expect(report.dashboardPdf?.principais).toEqual(visual.principais);
    expect(report.dashboardPdf?.secundarios).toEqual(visual.secundarios);
    expect([
      ...(report.dashboardPdf?.principais ?? []),
      ...(report.dashboardPdf?.secundarios ?? []),
    ]).toHaveLength(8);
    expect(report.dashboardPdf?.produtos).toHaveLength(5);
    expect(report.dashboardPdf?.liberacoes).toHaveLength(6);
    expect(report.dashboardPdf?.geografia).toHaveLength(5);
    expect(report.dashboardPdf?.totalAReceber).toBe(319.55);
  });

  it.each(['excel', 'csv', 'imprimir'] as const)('não anexa payload visual em %s', (formato) => {
    const report = buildDashboardReport(fixtureArgs({
      config: { formato, expandido: false, incluirKpis: true },
      visual,
    }));
    expect(report.dashboardPdf).toBeUndefined();
  });
});
