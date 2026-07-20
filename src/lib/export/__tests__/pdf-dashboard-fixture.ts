import type { DashboardPdfVisual } from '../tipos';

export function dashboardPdfFixture(
  overrides: Partial<DashboardPdfVisual> = {},
): DashboardPdfVisual {
  return {
    tipo: 'dashboard',
    periodo: '20/07/2026',
    canal: 'Todos os canais',
    metrica: 'pedidos',
    serie: [{ rotulo: '20/07', valor: 9 }],
    principais: [
      {
        label: 'Faturamento bruto',
        valor: 'R$ 456,56',
        delta: '+138% vs. anterior',
        tendencia: 'up',
        auxiliar: '9 pedidos · 11 unidades',
      },
      {
        label: 'Líquido das vendas',
        valor: 'R$ 319,55',
        delta: '+133% vs. anterior',
        tendencia: 'up',
        auxiliar: 'comissão R$ 52,35 · frete R$ 84,66',
      },
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
    produtos: [
      { posicao: 1, titulo: 'Produto principal', unidades: 4, faturamento: 200 },
      { posicao: 2, titulo: 'Produto secundário', unidades: 3, faturamento: 150 },
    ],
    liberacoes: [{ data: '2026-08-18', valor: 319.55 }],
    totalAReceber: 319.55,
    geografia: [{ uf: 'PE', pedidos: 9, participacao: 1 }],
    semLocalizacao: 0,
    ...overrides,
  };
}
