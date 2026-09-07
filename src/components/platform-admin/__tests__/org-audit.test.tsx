import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OrgAudit } from '../org-audit';
import type { AuditRow, Page } from '@/lib/platform-admin';

// jsdom não implementa scrollIntoView, e o Radix Select chama ao mover o item ativo pelo teclado.
beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });

const mocks = vi.hoisted(() => ({
  useAudit: vi.fn(),
}));

vi.mock('@/hooks/usePlatformAdmin', () => ({
  usePlatformAudit: mocks.useAudit,
}));

function makeRow(overrides: Partial<AuditRow> = {}): AuditRow {
  return {
    id: 'evt-1',
    org_id: 'org-a',
    actor_id: 'user-1',
    actor_name: 'Diego Souza',
    at: '2026-09-06T15:00:00Z',
    category: 'billing',
    action: 'platform_billing_close',
    result: 'success',
    target: null,
    reason: null,
    details: {},
    ...overrides,
  };
}

function makePage(rows: AuditRow[], overrides: Partial<Page<AuditRow>> = {}): Page<AuditRow> {
  return { rows, total: rows.length, page: 1, page_size: 20, ...overrides };
}

afterEach(() => {
  cleanup();
  mocks.useAudit.mockReset();
});

describe('OrgAudit', () => {
  it('mostra o nome do ator e "Sistema" quando não há ator — nunca o UUID', async () => {
    mocks.useAudit.mockReturnValue({
      data: makePage([
        makeRow({ id: 'evt-1', actor_name: 'Diego Souza' }),
        makeRow({ id: 'evt-2', actor_id: 'user-2', actor_name: null }),
      ]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<OrgAudit orgId="org-a" month="2026-09" />);

    expect(screen.getByText('Diego Souza')).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();
    expect(screen.queryByText('user-2')).not.toBeInTheDocument();
  });

  it('abre o payload sanitizado num Popover em vez de imprimir JSON cru na célula', async () => {
    const user = userEvent.setup();
    mocks.useAudit.mockReturnValue({
      data: makePage([makeRow({ details: { org_id: 'org-a', field: 'markup' }, reason: 'ajuste manual' })]),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<OrgAudit orgId="org-a" month="2026-09" />);

    expect(screen.queryByText(/"org_id"/)).not.toBeInTheDocument();
    expect(screen.getByText('ajuste manual')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ver' }));
    expect(await screen.findByText(/"field": "markup"/)).toBeInTheDocument();
  });

  it('mostra a faixa de erro com Tentar novamente e não confunde falha com ausência de evento', () => {
    const refetch = vi.fn();
    mocks.useAudit.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    render(<OrgAudit orgId="org-a" month="2026-09" />);

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar a auditoria.');
    screen.getByRole('button', { name: 'Tentar novamente' }).click();
    expect(refetch).toHaveBeenCalled();
  });

  it('mostra o vazio dedicado quando não há eventos', () => {
    mocks.useAudit.mockReturnValue({ data: makePage([]), isLoading: false, isError: false, refetch: vi.fn() });

    render(<OrgAudit orgId="org-a" month="2026-09" />);

    expect(screen.getByText('Nenhum evento encontrado')).toBeInTheDocument();
  });

  // Radix Select usa `hasPointerCapture`, que o jsdom não implementa — teclado cobre o mesmo
  // fio sem exigir stub global (mesmo padrão de barra-filtros-estoque.test.tsx).
  it('filtra por categoria repassando o valor ao hook (por teclado)', async () => {
    const user = userEvent.setup();
    mocks.useAudit.mockReturnValue({ data: makePage([makeRow()]), isLoading: false, isError: false, refetch: vi.fn() });

    render(<OrgAudit orgId="org-a" month="2026-09" />);

    screen.getByRole('combobox', { name: 'Categoria' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('option', { name: 'Administração' });
    await user.keyboard('{ArrowDown}{Enter}');

    expect(mocks.useAudit).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'admin', page: 1 }));
  });
});
