import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { OrgSettings } from '../org-settings';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const org = {
  id: 'org-a',
  nome: 'Avil',
  slug: 'avil',
  canais_habilitados: ['mercado_livre'],
  modulos_habilitados: [],
  tipos_produto_habilitados: [] as string[],
  tipo_pessoa: 'pj' as const,
};

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OrgSettings orgId="org-a" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (_fn: string, { body }: { body: Record<string, unknown> }) => {
    if (body.action === 'list_orgs') return { data: { orgs: [org] }, error: null };
    return { data: {}, error: null };
  });
});

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockClear();
});

describe('OrgSettings — card Tipo de produto (ADR-0166)', () => {
  it('o card Tipo de produto é separado do card Módulos', async () => {
    renderSettings();
    await screen.findByText('Módulos');
    expect(screen.getByText('Tipo de produto')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar módulos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar tipo de produto' })).toBeInTheDocument();
  });

  it('org sem tipo começa com os dois checkboxes desmarcados', async () => {
    renderSettings();
    await screen.findByLabelText(/Roupa/);
    expect(screen.getByLabelText(/Roupa/)).not.toBeChecked();
    expect(screen.getByLabelText(/Calçado/)).not.toBeChecked();
  });

  it('marca os dois e envia set_tipos_produto_org na ordem canonica, nao na ordem de clique', async () => {
    const user = userEvent.setup();
    renderSettings();
    await screen.findByLabelText(/Roupa/);
    // Clica Calçado primeiro e Roupa depois: se o payload saísse na ordem de clique (bug), este
    // teste pegaria ['calcado', 'roupa']. A ordem canônica de TIPOS_PRODUTO é ['roupa', 'calcado'].
    await user.click(screen.getByLabelText(/Calçado/));
    await user.click(screen.getByLabelText(/Roupa/));
    await user.click(screen.getByRole('button', { name: 'Salvar tipo de produto' }));
    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('usuarios', {
        body: { action: 'set_tipos_produto_org', org_id: 'org-a', tipos: ['roupa', 'calcado'] },
      });
    });
  });
});
