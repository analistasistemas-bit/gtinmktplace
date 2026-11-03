import type { UseQueryResult } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgResults } from '../org-results';
import { pontosDiarios, pontosMensais } from '../org-results-graficos';
import type { MonthlyReport } from '@/lib/platform-admin';
import { kpisFixture, relatorioFixture } from '@/lib/export/__tests__/relatorio-mensal-fixture';

const refetch = vi.fn();

function query(data: MonthlyReport | undefined, o: { isLoading?: boolean; isError?: boolean } = {}): UseQueryResult<MonthlyReport> {
  return { data, isLoading: false, isError: false, refetch, ...o } as unknown as UseQueryResult<MonthlyReport>;
}

function comDiario(report: MonthlyReport): MonthlyReport {
  return {
    ...report,
    daily: [
      { day: '2026-10-01', gross_cents: 500_000, orders: 30, profit_after_ads_cents: 120_000, prev_gross_cents: 450_000 },
      // dia 02 ausente: lacuna
      { day: '2026-10-03', gross_cents: 610_000, orders: 41, profit_after_ads_cents: null, prev_gross_cents: null },
    ],
  };
}

beforeEach(() => refetch.mockReset());
afterEach(cleanup);

describe('OrgResults', () => {
  it('destaca Faturamento da loja e Lucro após Ads com variação vs mês anterior', () => {
    render(<OrgResults report={query(relatorioFixture())} />);
    expect(screen.getAllByText('Faturamento da loja').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/184\.523,90/).length).toBeGreaterThan(0);
    expect(screen.getByText('+14,6%')).toBeInTheDocument();
    expect(screen.getAllByText('vs setembro').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lucro após Ads').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Margem s/ venda após Ads').length).toBeGreaterThan(0);
    expect(screen.getByText('Markup após Ads')).toBeInTheDocument();
    expect(screen.queryByText(/Lucro após Ads indisponível/)).not.toBeInTheDocument();
  });

  it('usa os rótulos obrigatórios dos indicadores de tráfego e remove o card Operação', () => {
    render(<OrgResults report={query(relatorioFixture())} />);
    expect(screen.getByText('Visitas dos anúncios acompanhados')).toBeInTheDocument();
    expect(screen.getByText('212 anúncios · 31/31 dias')).toBeInTheDocument();
    expect(screen.getByText('Conversão dos anúncios acompanhados')).toBeInTheDocument();
    expect(screen.getByText('Principais produtos do mês')).toBeInTheDocument();
    expect(screen.queryByText('Operação')).not.toBeInTheDocument();
  });

  it('Ads indisponível: destaque vira Lucro antes de Ads, com o motivo; nada vira zero', () => {
    render(<OrgResults report={query(relatorioFixture({ adsIndisponivel: true }))} />);
    expect(screen.getAllByText('Lucro antes de Ads').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('status').some((e) => /Lucro após Ads indisponível: dados de Ads indisponíveis/.test(e.textContent ?? ''))).toBe(true);
    expect(screen.getAllByText('Margem s/ venda (antes de Ads)').length).toBeGreaterThan(0);
    expect(screen.getByText('Ads indisponível:')).toBeInTheDocument();
  });

  it('lucro parcial: rótulo (parcial), itens sem lucro calculável e cobertura', () => {
    const base = relatorioFixture();
    const parcial: MonthlyReport = {
      ...base,
      summary: {
        ...base.summary,
        current: kpisFixture({
          profit_partial: true, excluded_items: 3, covered_gross_cents: 17_000_000, profit_coverage: 0.9213,
          profit_after_ads_cents: null, margin_after_ads: null, markup_after_ads: null, unavailable_reason: 'lucro_parcial',
        }),
      },
    };
    render(<OrgResults report={query(parcial)} />);
    expect(screen.getByText('Lucro antes de Ads (parcial)')).toBeInTheDocument();
    expect(screen.getByText(/Itens sem lucro calculável: 3/)).toBeInTheDocument();
    expect(screen.getByText(/cobertura 92% do faturamento/)).toBeInTheDocument();
    expect(screen.getAllByText('só itens com lucro calculável').length).toBeGreaterThan(0);
  });

  it('imposto sem alíquota confirmada fica "—" com o motivo na cascata', () => {
    const base = relatorioFixture();
    const r: MonthlyReport = {
      ...base,
      summary: {
        ...base.summary,
        current: kpisFixture({
          tax_cents: null, profit_cents: null, profit_after_ads_cents: null, margin: null, markup: null,
          margin_after_ads: null, markup_after_ads: null, unavailable_reason: 'lucro_indisponivel',
        }),
      },
    };
    render(<OrgResults report={query(r)} />);
    expect(screen.getByText('alíquota não confirmada')).toBeInTheDocument();
  });

  it('com 1 mês de série a evolução é omitida; com 12 aparece', () => {
    const { unmount } = render(<OrgResults report={query(relatorioFixture({ meses: 1 }))} />);
    expect(screen.queryByText(/^Evolução de \d+ meses/)).not.toBeInTheDocument();
    expect(screen.getByText('Do faturamento ao lucro')).toBeInTheDocument();
    unmount();
    render(<OrgResults report={query(relatorioFixture({ meses: 12 }))} />);
    expect(screen.getByText('Evolução de 12 meses')).toBeInTheDocument();
  });

  it('série com um mês não calculado continua mostrando a evolução, com lacuna (achado 3)', () => {
    const base = relatorioFixture({ meses: 3 });
    const r = { ...base, series: base.series.map((p, i) => (i === 1 ? { ...p, gross_cents: null, profit_cents: null, profit_after_ads_cents: null,
      margin_after_ads: null, margin: null, markup: null, profit_coverage: null, unavailable_reason: 'volume' as const } : p)) };
    render(<OrgResults report={query(r)} />);
    expect(screen.getByText('Evolução de 3 meses')).toBeInTheDocument();
  });

  it('evolução escolhe o lucro por mês: mês antigo sem após Ads mostra o lucro antes de Ads, marcado (achado 2)', async () => {
    const base = relatorioFixture({ meses: 2 });
    const antigo = { ...base.series[0], profit_after_ads_cents: null, margin_after_ads: null, profit_cents: 2_000_00, margin: 0.5 };
    const pontos = pontosMensais([antigo, base.series[1]]);
    expect(pontos[0]).toMatchObject({ lucro: 2_000_00, margem: 0.5, aposAds: false });
    expect(pontos[1]).toMatchObject({ lucro: base.series[1].profit_after_ads_cents, aposAds: true });
    render(<OrgResults report={query({ ...base, series: [antigo, base.series[1]] })} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Ver dados' }).at(-1)!);
    const linha = screen.getByRole('rowheader', { name: /set\/26/ }).closest('tr')!;
    expect(within(linha).getByText(/R\$\s*2\.000,00/)).toBeInTheDocument();
    expect(within(linha).getByText('50,0%')).toBeInTheDocument();
    expect(linha.textContent).toMatch(/antes de Ads/);
  });

  it('sem mês anterior: sem variação e sem inventar base', () => {
    render(<OrgResults report={query(relatorioFixture({ semAnterior: true }))} />);
    expect(screen.queryByText('+14,6%')).not.toBeInTheDocument();
    expect(screen.getAllByText('sem mês anterior').length).toBeGreaterThan(0);
  });

  it('"Mostrar mais indicadores" revela os cartões escondidos no mobile', async () => {
    const user = userEvent.setup();
    render(<OrgResults report={query(relatorioFixture())} />);
    const escondido = () => document.querySelector('[data-kpi="Estornos"]')!;
    expect(escondido().className).toContain('hidden');
    expect(document.querySelector('[data-kpi="Pedidos"]')!.className).not.toContain('hidden');
    await user.click(screen.getByRole('button', { name: 'Mostrar mais indicadores' }));
    expect(escondido().className).not.toContain('hidden');
    expect(screen.queryByRole('button', { name: 'Mostrar mais indicadores' })).not.toBeInTheDocument();
  });

  it('tráfego e estornos ausentes viram "—" com motivo, nunca zero', () => {
    const base = relatorioFixture();
    const r: MonthlyReport = { ...base, traffic: null, summary: { ...base.summary, current: kpisFixture({ refunds_cents: null }) } };
    render(<OrgResults report={query(r)} />);
    expect(screen.getAllByText('dado indisponível')).toHaveLength(2);
    expect(screen.getByText('indisponível')).toBeInTheDocument();
  });

  it('"Ver dados" abre a tabela diária; dia ausente e lucro nulo são "—", não zero', async () => {
    const user = userEvent.setup();
    render(<OrgResults report={query(comDiario(relatorioFixture()))} />);
    expect(screen.queryByRole('table', { name: /por dia de outubro/ })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Ver dados' })[0]);
    const tabela = screen.getByRole('table', { name: /Faturamento por dia de outubro/ });
    const linhas = within(tabela).getAllByRole('row');
    expect(linhas).toHaveLength(1 + 31);
    expect(within(linhas[2]).getAllByText('—')).toHaveLength(3); // 02/10 sem dado
    await user.click(screen.getByRole('button', { name: 'Lucro após Ads' }));
    const t2 = screen.getByRole('table', { name: /Lucro após Ads por dia/ });
    expect(within(within(t2).getAllByRole('row')[3]).getByText('—')).toBeInTheDocument(); // 03/10 lucro nulo
  });

  it('pontosDiarios: lacuna é null; anterior só existe para faturamento', () => {
    const r = comDiario(relatorioFixture());
    const g = pontosDiarios(r, 'gross');
    expect(g).toHaveLength(31);
    expect(g[1].atual).toBeNull();
    expect(g[0]).toMatchObject({ atual: 500_000, anterior: 450_000, dataAnterior: '01/09' });
    expect(g[30].dataAnterior).toBeNull(); // 31/10 não tem par em setembro
    expect(pontosDiarios(r, 'orders')[0].anterior).toBeNull();
  });

  it('Ads com atribuição em aberto mostra o selo com o prazo; cobertura parcial esconde métricas', () => {
    const { unmount } = render(<OrgResults report={query(relatorioFixture())} />);
    expect(screen.getByText('Atribuição do ML em fechamento até 15/11')).toBeInTheDocument();
    expect(screen.getByText('ROAS')).toBeInTheDocument();
    unmount();
    const base = relatorioFixture();
    render(<OrgResults report={query({ ...base, ads: { ...base.ads!, coverage: 'partial', days_covered: 20, days_expected: 31, cost_cents: null } })} />);
    expect(screen.getByText(/Cobertura parcial do mês \(20 de 31 dias\)/)).toBeInTheDocument();
    expect(screen.queryByText('ROAS')).not.toBeInTheDocument();
  });

  it('top 5 mostra rodapé com participação e exclusões', () => {
    render(<OrgResults report={query(relatorioFixture())} />);
    expect(screen.getByText(/Top 5 = 65% do faturamento/)).toBeInTheDocument();
    expect(screen.getByText(/Vendas sem código de produto/)).toBeInTheDocument();
    expect(screen.getByText(/Família desconhecida/)).toBeInTheDocument();
    expect(screen.getByText('Conjunto Térmico Feminino Premium Inverno')).toBeInTheDocument();
  });

  it('catálogo de famílias ilegível: aviso em vez de tabela', () => {
    render(<OrgResults report={query({ ...relatorioFixture(), top_families: null })} />);
    expect(screen.getByText(/catálogo de famílias não pôde ser lido/)).toBeInTheDocument();
  });

  it('mês sem vendas: estado vazio só no bloco de vendas; Ads, visitas e estornos conhecidos continuam (achado 5)', () => {
    const base = relatorioFixture();
    const r: MonthlyReport = { ...base, summary: { ...base.summary, current: kpisFixture({ orders: 0, gross_cents: 0, units: 0 }) } };
    render(<OrgResults report={query(r)} />);
    expect(screen.getByText('Sem vendas em Outubro de 2026')).toBeInTheDocument();
    expect(screen.queryByText('Faturamento da loja')).not.toBeInTheDocument();
    expect(screen.getByText('Anúncios patrocinados (Mercado Ads)')).toBeInTheDocument();
    expect(screen.getByText('Investimento')).toBeInTheDocument();
    expect(screen.getByText('Visitas dos anúncios acompanhados')).toBeInTheDocument();
    expect(screen.getByText('Estornos')).toBeInTheDocument();
  });

  it('carregando mostra esqueleto; erro sem dado mostra alerta com Tentar novamente', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OrgResults report={query(undefined, { isLoading: true })} />);
    expect(screen.getByRole('status', { name: 'Carregando resultados' })).toBeInTheDocument();
    unmount();
    render(<OrgResults report={query(undefined, { isError: true })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar os resultados');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('falha de atualização com dado antigo mantém a tela e avisa', () => {
    render(<OrgResults report={query(relatorioFixture(), { isError: true })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('os últimos dados disponíveis permanecem na tela');
    expect(screen.getAllByText('Faturamento da loja').length).toBeGreaterThan(0);
  });

  it('avisos do contrato ficam visíveis: error com retry, warning sem', () => {
    const base = relatorioFixture();
    render(<OrgResults report={query({ ...base, warnings: [
      { code: 'cost_catalog_read_failed', severity: 'error', message: 'Falha ao carregar os custos: timeout' },
      { code: 'tax_config_unconfirmed', severity: 'warning', message: 'Configuração tributária não confirmada' },
    ] })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Falha ao carregar os custos: timeout');
    expect(screen.getByText('Configuração tributária não confirmada')).toBeInTheDocument();
  });
});
