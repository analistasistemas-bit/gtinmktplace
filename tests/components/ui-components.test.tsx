import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPill } from '@/components/ui/status-pill';
import { KpiCard } from '@/components/ui/kpi-card';
import { DataTable, type Column } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';

describe('StatusPill', () => {
  it('aplica o tom via data-tone', () => {
    render(<StatusPill tone="success">Ativo</StatusPill>);
    expect(screen.getByText('Ativo').getAttribute('data-tone')).toBe('success');
  });
});

describe('KpiCard', () => {
  it('mostra label, valor e delta', () => {
    render(<KpiCard label="Publicados" value={42} delta="+3" deltaTrend="up" />);
    expect(screen.getByText('Publicados')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('mostra skeleton quando loading', () => {
    const { container } = render(<KpiCard label="x" value={0} loading />);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });
});

interface Linha { id: string; nome: string }
const cols: Column<Linha>[] = [
  { key: 'nome', header: 'Nome', cell: (r) => r.nome },
];

describe('DataTable', () => {
  it('renderiza linhas', () => {
    render(<DataTable columns={cols} rows={[{ id: '1', nome: 'Fita' }]} rowKey={(r) => r.id} />);
    expect(screen.getByText('Fita')).toBeInTheDocument();
  });

  it('mostra empty quando sem linhas', () => {
    render(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} empty={<EmptyState title="Vazio" />} />);
    expect(screen.getByText('Vazio')).toBeInTheDocument();
  });

  it('mostra skeleton quando loading', () => {
    const { container } = render(<DataTable columns={cols} rows={[]} rowKey={(r) => r.id} loading skeletonRows={3} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(3);
  });
});
