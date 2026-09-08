import type { UseQueryResult } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgResults } from '../org-results';
import type { OrgMetrics, OrgSummary } from '@/lib/platform-admin';
import { fmtMilhar } from '@/lib/formato';

const refetch = vi.fn();

function makeMetrics(overrides: Partial<OrgMetrics> = {}): OrgMetrics {
  return {
    org_id: 'org-a',
    month: '2026-08',
    gross_cents: 1_000_000,
    orders: 42,
    ticket_cents: 23_800,
    markup: 0.44,
    cost_covered_orders: 40,
    total_orders: 42,
    active_ads: null,
    publications: null,
    pending_operations: null,
    updated_at: null,
    previous: { gross_cents: 900_000, orders: 38, markup: 0.4 },
    series: [{ month: '2026-08', gross_cents: 1_000_000, markup: 0.44 }],
    warnings: [],
    ...overrides,
  };
}

// `OrgResults` recebe o mesmo `usePlatformOrganization` da página de detalhe (item 1.4 do plano de
// performance) — não chama mais a action `metrics` isoladamente.
function makeOrganization(
  metrics: OrgMetrics | null,
  overrides: Partial<Pick<UseQueryResult<OrgSummary>, 'isLoading' | 'isError'>> = {},
): UseQueryResult<OrgSummary> {
  return {
    data: {
      id: 'org-a', nome: 'Org A', slug: 'org-a', is_test: false, modality: 1,
      metrics, forecast_cents: null, billable_units: null, daludi_searches: null, pending_count: null,
    },
    isLoading: false,
    isError: false,
    refetch,
    ...overrides,
  } as unknown as UseQueryResult<OrgSummary>;
}

beforeEach(() => {
  refetch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('OrgResults', () => {
  it('markup 0.44 vira +44% com cor de sucesso', () => {
    render(<OrgResults organization={makeOrganization(makeMetrics())} />);
    expect(screen.getByText('+44%')).toBeInTheDocument();
  });

  it('markup null vira — com o motivo, nunca um número inventado', () => {
    render(<OrgResults organization={makeOrganization(makeMetrics({ markup: null }))} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Sem custo ou alíquota confirmada')).toBeInTheDocument();
  });

  it('nunca mostra a palavra Indisponível', () => {
    render(<OrgResults organization={makeOrganization(makeMetrics())} />);
    expect(screen.queryByText(/Indisponível/)).not.toBeInTheDocument();
  });

  it('erro sem dado mostra faixa de erro com Tentar novamente', () => {
    const organization = {
      data: undefined, isLoading: false, isError: true, refetch,
    } as unknown as UseQueryResult<OrgSummary>;
    render(<OrgResults organization={organization} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('aviso de falha (severity error) vai na faixa destrutiva com Tentar novamente', () => {
    const metrics = makeMetrics({ warnings: [{ code: 'cost_catalog_read_failed', severity: 'error', message: 'Falha ao carregar os custos: timeout' }] });
    render(<OrgResults organization={makeOrganization(metrics)} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Falha ao carregar os custos: timeout');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('ausência acionável (severity warning) vai na faixa de aviso, sem Tentar novamente', () => {
    const metrics = makeMetrics({ warnings: [{ code: 'tax_config_unconfirmed', severity: 'warning', message: 'Configuração tributária não confirmada' }] });
    render(<OrgResults organization={makeOrganization(metrics)} />);
    expect(screen.getByText('Configuração tributária não confirmada')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Recharts não desenha eixos em jsdom (ResponsiveContainer fica em 0x0, sem ResizeObserver
  // real) — não dá para inspecionar o SVG do eixo aqui. O que se verifica: o gráfico renderiza
  // sem quebrar com um valor largo (80 mil reais, o caso que cortava "R$" em produção), e a
  // fórmula exata usada no `tickFormatter` (fmtMilhar em reais, não fmtBRL em centavos) produz um
  // rótulo curto que nunca começa com "R$" — `fmtMilhar` já tem cobertura própria em
  // `formato.test.ts` para os valores-limite (mil/milhão).
  it('gráfico renderiza com valor largo (80 mil) sem quebrar, e o eixo usa formato compacto', () => {
    const metrics = makeMetrics({ series: [{ month: '2026-08', gross_cents: 8_000_000, markup: 0.44 }] });
    render(<OrgResults organization={makeOrganization(metrics)} />);
    expect(screen.getByRole('img', { name: 'Faturamento bruto dos últimos seis meses' })).toBeInTheDocument();
    expect(fmtMilhar(8_000_000 / 100)).toBe('80 mil');
    expect(fmtMilhar(8_000_000 / 100).startsWith('R$')).toBe(false);
  });
});
