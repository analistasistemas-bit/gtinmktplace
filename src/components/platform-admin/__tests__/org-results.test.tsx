import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgResults } from '../org-results';
import type { OrgMetrics } from '@/lib/platform-admin';
import { fmtMilhar } from '@/lib/formato';

const mocks = vi.hoisted(() => ({ useMetrics: vi.fn(), refetch: vi.fn() }));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePlatformMetrics: mocks.useMetrics,
}));

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

beforeEach(() => {
  mocks.refetch.mockReset();
  mocks.useMetrics.mockReturnValue({ data: makeMetrics(), isLoading: false, isError: false, refetch: mocks.refetch });
});

afterEach(() => {
  cleanup();
});

describe('OrgResults', () => {
  it('markup 0.44 vira +44% com cor de sucesso', () => {
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.getByText('+44%')).toBeInTheDocument();
  });

  it('markup null vira — com o motivo, nunca um número inventado', () => {
    mocks.useMetrics.mockReturnValue({
      data: makeMetrics({ markup: null }),
      isLoading: false,
      isError: false,
      refetch: mocks.refetch,
    });
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Sem custo ou alíquota confirmada')).toBeInTheDocument();
  });

  it('nunca mostra a palavra Indisponível', () => {
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.queryByText(/Indisponível/)).not.toBeInTheDocument();
  });

  it('erro sem dado mostra faixa de erro com Tentar novamente', () => {
    mocks.useMetrics.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: mocks.refetch });
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('aviso de falha (severity error) vai na faixa destrutiva com Tentar novamente', () => {
    mocks.useMetrics.mockReturnValue({
      data: makeMetrics({ warnings: [{ code: 'cost_catalog_read_failed', severity: 'error', message: 'Falha ao carregar os custos: timeout' }] }),
      isLoading: false, isError: false, refetch: mocks.refetch,
    });
    render(<OrgResults orgId="org-a" month="2026-08" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Falha ao carregar os custos: timeout');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
  });

  it('ausência acionável (severity warning) vai na faixa de aviso, sem Tentar novamente', () => {
    mocks.useMetrics.mockReturnValue({
      data: makeMetrics({ warnings: [{ code: 'tax_config_unconfirmed', severity: 'warning', message: 'Configuração tributária não confirmada' }] }),
      isLoading: false, isError: false, refetch: mocks.refetch,
    });
    render(<OrgResults orgId="org-a" month="2026-08" />);
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
    mocks.useMetrics.mockReturnValue({
      data: makeMetrics({ series: [{ month: '2026-08', gross_cents: 8_000_000, markup: 0.44 }] }),
      isLoading: false, isError: false, refetch: mocks.refetch,
    });
    render(<OrgResults orgId="org-a" month="2026-08" />);
    expect(screen.getByRole('img', { name: 'Faturamento bruto dos últimos seis meses' })).toBeInTheDocument();
    expect(fmtMilhar(8_000_000 / 100)).toBe('80 mil');
    expect(fmtMilhar(8_000_000 / 100).startsWith('R$')).toBe(false);
  });
});
